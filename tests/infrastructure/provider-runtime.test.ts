import { describe, expect, it, vi } from "vitest";

import {
  FetchHttpTransport,
  resolveProviderCredential,
} from "../../src/infrastructure/providers/runtime.js";

describe("provider runtime", () => {
  it("sends exact request bytes and preserves response bytes and headers", async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      expect(request.method).toBe("POST");
      expect(await request.text()).toBe('{"request":true}');
      return new Response('{"response":true}', {
        status: 201,
        headers: { "x-request-id": "provider-request-1" },
      });
    });
    const transport = new FetchHttpTransport(fetchImplementation);
    const response = await transport.send({
      url: "https://provider.example/v1/generate",
      headers: { authorization: "Bearer secret" },
      body: Buffer.from('{"request":true}'),
      timeoutMs: 1_000,
    });
    expect(response.status).toBe(201);
    expect(response.headers["x-request-id"]).toBe("provider-request-1");
    expect(response.body).toEqual(
      new Uint8Array(Buffer.from('{"response":true}')),
    );
  });

  it("classifies a timeout after fetch starts as an ambiguous dispatched failure", async () => {
    const transport = new FetchHttpTransport(
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((_resolve, reject) => {
            (input as Request).signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    await expect(
      transport.send({
        url: "https://provider.example/v1/generate",
        headers: {},
        body: new Uint8Array(),
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      dispatched: true,
      retryable: true,
    });
  });

  it("rejects invalid requests before dispatch", async () => {
    const fetchImplementation = vi.fn();
    const transport = new FetchHttpTransport(fetchImplementation);
    await expect(
      transport.send({
        url: "not-a-url",
        headers: {},
        body: new Uint8Array(),
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      dispatched: false,
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("resolves environment and OS-store references without persisting values", async () => {
    await expect(
      resolveProviderCredential(
        { kind: "environment", reference: "PROVIDER_TOKEN" },
        { environment: { PROVIDER_TOKEN: "  secret-from-env  " } },
      ),
    ).resolves.toBe("  secret-from-env  ");
    const readOsCredential = vi.fn(() =>
      Promise.resolve("secret-from-store\n"),
    );
    await expect(
      resolveProviderCredential(
        { kind: "os_credential_store", reference: "factory/provider" },
        { readOsCredential },
      ),
    ).resolves.toBe("secret-from-store\n");
    expect(readOsCredential).toHaveBeenCalledWith("factory/provider");
  });

  it("reports only the missing reference name, never another secret value", async () => {
    await expect(
      resolveProviderCredential(
        { kind: "environment", reference: "MISSING_PROVIDER_TOKEN" },
        { environment: { OTHER_SECRET: "must-not-leak" } },
      ),
    ).rejects.toThrow("MISSING_PROVIDER_TOKEN");
    await expect(
      resolveProviderCredential(
        { kind: "environment", reference: "MISSING_PROVIDER_TOKEN" },
        { environment: { OTHER_SECRET: "must-not-leak" } },
      ),
    ).rejects.not.toThrow("must-not-leak");
  });

  it.each(["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED"])(
    "classifies %s as a retryable pre-dispatch connection failure",
    async (code) => {
      const cause = Object.assign(new Error("connect failed"), { code });
      const transport = new FetchHttpTransport(
        vi.fn(() => Promise.reject(new TypeError("fetch failed", { cause }))),
      );
      await expect(
        transport.send({
          url: "https://provider.example/v1/generate",
          headers: {},
          body: new Uint8Array(),
          timeoutMs: 100,
        }),
      ).rejects.toMatchObject({ dispatched: false, retryable: true });
    },
  );

  it("rejects unsupported credential-store platforms with a stable secret-safe error", async () => {
    await expect(
      resolveProviderCredential(
        { kind: "os_credential_store", reference: "factory/provider" },
        { platform: "win32" },
      ),
    ).rejects.toMatchObject({
      name: "ProviderCredentialError",
      reference: "factory/provider",
    });
  });

  it("discards secret-bearing credential reader errors", async () => {
    const secret = "retrieved-secret-must-not-survive";
    let caught: unknown;
    try {
      await resolveProviderCredential(
        { kind: "os_credential_store", reference: "factory/provider" },
        {
          readOsCredential: () =>
            Promise.reject(
              Object.assign(new Error(`reader failed: ${secret}`), {
                stdout: secret,
                stderr: `diagnostic ${secret}`,
              }),
            ),
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: "ProviderCredentialError",
      reference: "factory/provider",
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(String(caught)).not.toContain(secret);
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

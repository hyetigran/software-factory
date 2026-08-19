import { describe, expect, it } from "vitest";

import { providerSettlementMode } from "../../src/infrastructure/sqlite/provider-attempt-settlement.js";

const current = {
  commandStatus: "running",
  acceptedAttemptId: null,
  triggeringStateVersion: 4,
  attemptStatus: "started",
  currentStateVersion: 4,
};

describe("provider attempt settlement", () => {
  it("admits a current first result", () => {
    expect(
      providerSettlementMode({
        state: current,
        settledStatuses: ["failed", "unknown", "discarded"],
        explicitlyExpected: false,
      }),
    ).toBe("eligible");
  });

  it("treats an authorized rerun as explicitly expected", () => {
    expect(
      providerSettlementMode({
        state: { ...current, currentStateVersion: 5 },
        settledStatuses: ["failed", "unknown", "discarded"],
        explicitlyExpected: true,
      }),
    ).toBe("eligible");
  });

  it.each([
    ["stale state", { ...current, currentStateVersion: 5 }],
    [
      "accepted logical result",
      {
        ...current,
        commandStatus: "succeeded",
        acceptedAttemptId: "attempt_accepted",
      },
    ],
  ])("discards a started result after %s", (_label, state) => {
    expect(
      providerSettlementMode({
        state,
        settledStatuses: ["failed", "unknown", "discarded"],
        explicitlyExpected: false,
      }),
    ).toBe("discard");
  });

  it("reconciles an already settled callback as an exact replay", () => {
    expect(
      providerSettlementMode({
        state: { ...current, attemptStatus: "discarded" },
        settledStatuses: ["failed", "unknown", "discarded"],
        explicitlyExpected: false,
      }),
    ).toBe("exact_replay");
  });
});

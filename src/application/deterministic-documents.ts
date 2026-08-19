import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../domain/canonical-json.js";
import { assertJsonSchema } from "./json-schema-validator.js";

type ByteRange = { startByte: number; endByte: number };

export type LedgerValidationReport = {
  validator: "deterministic-ledger-validator-v1";
  ledgerContentHash: string;
  sourceContentHash: string;
  schemaValid: true;
  identityValid: true;
  lineageValid: true;
  coverageValid: boolean;
  coveredRanges: ByteRange[];
  excludedRanges: ByteRange[];
  uncoveredRanges: ByteRange[];
};

export type RenderedProjection = {
  mediaType: "text/markdown; charset=utf-8";
  bytes: Buffer;
  contentHash: string;
};

export type ProjectionVerification =
  | { status: "verified"; contentHash: string }
  | {
      status: "external_edit";
      expectedContentHash: string;
      actualContentHash: string;
      editedBytes: Buffer;
    };

function schema(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../../schemas/${name}`),
      "utf8",
    ),
  ) as unknown;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  const ordered = [...ranges].sort(
    (left, right) =>
      left.startByte - right.startByte || left.endByte - right.endByte,
  );
  const merged: ByteRange[] = [];
  for (const range of ordered) {
    const prior = merged.at(-1);
    if (prior !== undefined && range.startByte <= prior.endByte) {
      prior.endByte = Math.max(prior.endByte, range.endByte);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function uncoveredRanges(length: number, covered: ByteRange[]): ByteRange[] {
  const gaps: ByteRange[] = [];
  let cursor = 0;
  for (const range of mergeRanges(covered)) {
    if (range.startByte > cursor)
      gaps.push({ startByte: cursor, endByte: range.startByte });
    cursor = Math.max(cursor, range.endByte);
  }
  if (cursor < length) gaps.push({ startByte: cursor, endByte: length });
  return gaps;
}

function validRange(range: ByteRange, sourceLength: number): boolean {
  return (
    Number.isInteger(range.startByte) &&
    Number.isInteger(range.endByte) &&
    range.startByte >= 0 &&
    range.endByte > range.startByte &&
    range.endByte <= sourceLength
  );
}

export function validateLedger(input: {
  ledgerBytes: Uint8Array;
  sourceBytes: Uint8Array;
}): LedgerValidationReport {
  const parsed: unknown = JSON.parse(
    Buffer.from(input.ledgerBytes).toString("utf8"),
  );
  assertJsonSchema(parsed, schema("requirements-ledger.v1.schema.json"));
  const ledger = parsed as Record<string, unknown>;
  const requirements = ledger.requirements as Array<Record<string, unknown>>;
  const exclusions = ledger.source_exclusions as Array<Record<string, unknown>>;
  const ids = requirements.map(({ requirement_id }) => String(requirement_id));
  const identityValid = new Set(ids).size === ids.length;
  const knownIds = new Set(ids);
  const lineageValid = requirements.every(
    ({ lineage_roots, predecessor_ids }) =>
      [...(lineage_roots as string[]), ...(predecessor_ids as string[])].every(
        (id) => knownIds.has(id),
      ),
  );
  if (!identityValid || !lineageValid) {
    throw new TypeError("Ledger identities and lineage are invalid");
  }
  const coveredRanges = requirements
    .filter(({ status }) => status === "active")
    .flatMap(({ source_ranges }) =>
      (source_ranges as Array<Record<string, unknown>>).map((range) => ({
        startByte: Number(range.start_byte),
        endByte: Number(range.end_byte),
      })),
    );
  const excludedRanges = exclusions.map(({ source_range }) => {
    const range = source_range as Record<string, unknown>;
    return {
      startByte: Number(range.start_byte),
      endByte: Number(range.end_byte),
    };
  });
  if (
    [...coveredRanges, ...excludedRanges].some(
      (range) => !validRange(range, input.sourceBytes.byteLength),
    )
  ) {
    throw new TypeError("Ledger source range is outside the immutable source");
  }
  const gaps = uncoveredRanges(input.sourceBytes.byteLength, [
    ...coveredRanges,
    ...excludedRanges,
  ]);
  return {
    validator: "deterministic-ledger-validator-v1",
    ledgerContentHash: sha256(input.ledgerBytes),
    sourceContentHash: sha256(input.sourceBytes),
    schemaValid: true,
    identityValid: true,
    lineageValid: true,
    coverageValid: gaps.length === 0,
    coveredRanges: mergeRanges(coveredRanges),
    excludedRanges: mergeRanges(excludedRanges),
    uncoveredRanges: gaps,
  };
}

function projection(markdown: string): RenderedProjection {
  const bytes = Buffer.from(markdown, "utf8");
  return {
    mediaType: "text/markdown; charset=utf-8",
    bytes,
    contentHash: sha256(bytes),
  };
}

export function renderLedger(ledgerBytes: Uint8Array): RenderedProjection {
  const parsed: unknown = JSON.parse(Buffer.from(ledgerBytes).toString("utf8"));
  assertJsonSchema(parsed, schema("requirements-ledger.v1.schema.json"));
  const ledger = parsed as Record<string, unknown>;
  const requirements = ledger.requirements as Array<Record<string, unknown>>;
  const lines = [
    `# Requirements Ledger ${String(ledger.ledger_id)}`,
    "",
    `<!-- factory:ledger hash=${sha256(ledgerBytes)} -->`,
    "",
  ];
  for (const requirement of requirements) {
    lines.push(
      `<!-- factory:requirement id=${String(requirement.requirement_id)} -->`,
      `## ${String(requirement.display_id)} — ${String(requirement.status)}`,
      "",
      String(requirement.statement),
      "",
    );
  }
  return projection(`${lines.join("\n")}\n`);
}

export function renderPlan(planBytes: Uint8Array): RenderedProjection {
  const parsed: unknown = JSON.parse(Buffer.from(planBytes).toString("utf8"));
  assertJsonSchema(parsed, schema("plan.v1.schema.json"));
  const plan = parsed as Record<string, unknown>;
  const sections = plan.sections as Array<Record<string, unknown>>;
  const lines = [
    `# ${String(plan.title)}`,
    "",
    String(plan.summary),
    "",
    `<!-- factory:plan id=${String(plan.plan_id)} hash=${sha256(planBytes)} -->`,
    "",
  ];
  for (const section of sections) {
    const sectionIdentity = canonicalJson(section);
    lines.push(
      `<!-- factory:section id=${String(section.section_id)} hash=${sha256(Buffer.from(sectionIdentity))} -->`,
      `## ${String(section.title)}`,
      "",
      String(section.body),
      "",
    );
  }
  return projection(`${lines.join("\n")}\n`);
}

export function verifyProjection(
  workingBytes: Uint8Array,
  expectedContentHash: string,
): ProjectionVerification {
  const actualContentHash = sha256(workingBytes);
  return actualContentHash === expectedContentHash
    ? { status: "verified", contentHash: actualContentHash }
    : {
        status: "external_edit",
        expectedContentHash,
        actualContentHash,
        editedBytes: Buffer.from(workingBytes),
      };
}

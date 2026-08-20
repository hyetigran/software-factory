import { canonicalJson } from "../domain/canonical-json.js";
import type { ProviderExecution } from "./provider-port.js";

export function providerFailureEvidenceBytes(
  execution: Exclude<ProviderExecution, { kind: "completed" }>,
): Uint8Array {
  const result = structuredClone(execution) as Record<string, unknown>;
  delete result.recording;
  return Buffer.from(canonicalJson(result));
}

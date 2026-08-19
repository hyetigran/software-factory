import type { ProviderExecution } from "../../application/provider-port.js";

const authenticProviderExecutions = new WeakSet<object>();

export function sealProviderExecution<T extends ProviderExecution>(
  execution: T,
): T {
  const cloned = structuredClone(execution);
  const rawResponseBytes =
    execution.recording.rawResponseBytes === undefined
      ? undefined
      : Buffer.from(execution.recording.rawResponseBytes);
  const nativeUsageBytes =
    execution.recording.nativeUsageBytes === undefined
      ? undefined
      : Buffer.from(execution.recording.nativeUsageBytes);
  const copy = {
    ...cloned,
    recording: Object.freeze({
      ...(rawResponseBytes === undefined
        ? {}
        : {
            get rawResponseBytes() {
              return Buffer.from(rawResponseBytes);
            },
          }),
      ...(nativeUsageBytes === undefined
        ? {}
        : {
            get nativeUsageBytes() {
              return Buffer.from(nativeUsageBytes);
            },
          }),
    }),
  } as T;
  const freeze = (value: unknown): void => {
    if (
      value === null ||
      typeof value !== "object" ||
      ArrayBuffer.isView(value)
    ) {
      return;
    }
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(copy);
  authenticProviderExecutions.add(copy);
  return copy;
}

export function providerExecutionIsAuthentic(
  execution: ProviderExecution,
): boolean {
  return authenticProviderExecutions.has(execution);
}

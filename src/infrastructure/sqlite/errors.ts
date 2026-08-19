export class AuthorityIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthorityIntegrityError";
  }
}

export class StaleStateError extends Error {
  constructor(runId: string, expected: number, actual: number | null) {
    super(
      `Run ${runId} expected state version ${expected}, actual ${actual ?? "missing"}`,
    );
    this.name = "StaleStateError";
  }
}

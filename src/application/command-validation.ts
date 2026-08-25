import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { PersistableCommand } from "./authority-port.js";
import { providerCommandPayloadIsValid } from "./provider-command-specification.js";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(
  value: object,
  required: string[],
  optional: string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function stringSet(value: unknown, requireNonempty = true): value is string[] {
  return (
    Array.isArray(value) &&
    (!requireNonempty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assignment(value: unknown): boolean {
  return (
    record(value) &&
    hasExactKeys(value, ["provider", "modelId"]) &&
    (value.provider === "openai" || value.provider === "anthropic") &&
    typeof value.modelId === "string" &&
    value.modelId.length > 0
  );
}

function independence(value: unknown): boolean {
  return (
    record(value) &&
    ((value.reduced === false && hasExactKeys(value, ["reduced"])) ||
      (value.reduced === true &&
        hasExactKeys(value, ["reduced", "overrideEvidence"]) &&
        record(value.overrideEvidence) &&
        hasExactKeys(value.overrideEvidence, ["artifactId", "contentHash"]) &&
        typeof value.overrideEvidence.artifactId === "string" &&
        /^[a-f0-9]{64}$/u.test(String(value.overrideEvidence.contentHash))))
  );
}

function humanActor(value: unknown): boolean {
  return (
    record(value) &&
    hasExactKeys(value, ["kind", "displayName", "osAccount"]) &&
    value.kind === "human" &&
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    typeof value.osAccount === "string" &&
    value.osAccount.length > 0
  );
}

function sourceExclusions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    new Set(value.map((item) => (record(item) ? String(item.exclusionId) : "")))
      .size === value.length &&
    value.every(
      (item) =>
        record(item) &&
        hasExactKeys(item, ["exclusionId", "sourceRange", "reason"]) &&
        typeof item.exclusionId === "string" &&
        item.exclusionId.length > 0 &&
        typeof item.reason === "string" &&
        item.reason.trim().length > 0 &&
        record(item.sourceRange) &&
        hasExactKeys(item.sourceRange, ["startOffset", "endOffset"]) &&
        Number.isInteger(item.sourceRange.startOffset) &&
        Number.isInteger(item.sourceRange.endOffset) &&
        Number(item.sourceRange.startOffset) >= 0 &&
        Number(item.sourceRange.endOffset) >
          Number(item.sourceRange.startOffset),
    )
  );
}

function payloadIsValid(commandType: string, value: object): boolean {
  const payload = value as Record<string, unknown>;
  const providerPayload = providerCommandPayloadIsValid(commandType, payload);
  if (providerPayload !== null) return providerPayload;
  const stringFields = (keys: string[]): boolean =>
    keys.every(
      (key) =>
        typeof payload[key] === "string" && String(payload[key]).length > 0,
    );
  switch (commandType) {
    case "render_source_registration_report":
      return (
        hasExactKeys(value, ["sourceArtifactId", "configurationArtifactId"]) &&
        stringFields(["sourceArtifactId", "configurationArtifactId"])
      );
    case "validate_ledger":
      return (
        hasExactKeys(
          value,
          ["ledgerVersionId", "ledgerArtifactId", "sourceArtifactId"],
          ["sourceExclusions"],
        ) &&
        stringFields([
          "ledgerVersionId",
          "ledgerArtifactId",
          "sourceArtifactId",
        ]) &&
        (payload.sourceExclusions === undefined ||
          sourceExclusions(payload.sourceExclusions))
      );
    case "render_ledger":
      return (
        hasExactKeys(value, ["ledgerVersionId", "ledgerArtifactId"]) &&
        stringFields(["ledgerVersionId", "ledgerArtifactId"])
      );
    case "render_ledger_approval":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "ledgerArtifactId",
          "ledgerArtifactId",
          "coverageReportArtifactId",
          "sourceArtifactId",
          "coverageValidatedStateVersion",
          "coverageValidatedPolicyHash",
          "approvalGateId",
          "sourceExclusions",
          "approvedBy",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "ledgerArtifactId",
          "ledgerArtifactId",
          "coverageReportArtifactId",
          "sourceArtifactId",
          "coverageValidatedPolicyHash",
          "approvalGateId",
        ]) &&
        Number.isInteger(payload.coverageValidatedStateVersion) &&
        sourceExclusions(payload.sourceExclusions) &&
        humanActor(payload.approvedBy)
      );
    case "render_plan":
      return (
        hasExactKeys(value, ["planVersionId", "planArtifactId"]) &&
        stringFields(["planVersionId", "planArtifactId"])
      );
    case "export_terminal":
      return (
        hasExactKeys(value, [
          "haltedFrom",
          "reason",
          "failedCommandId",
          "failureClassification",
          "attemptIds",
          "evidenceArtifactIds",
          "unresolvedFindingIds",
          "sourceArtifactId",
          "configurationArtifactId",
          "ledgerArtifactId",
          "planArtifactId",
          "policyHash",
          "plannerAssignment",
          "reviewerAssignment",
          "budgetReportArtifactId",
          "recoveryBounds",
          "independence",
          "lineageArtifactIds",
          "waiverIds",
          "outcome",
        ]) &&
        stringFields([
          "haltedFrom",
          "reason",
          "failedCommandId",
          "failureClassification",
          "sourceArtifactId",
          "configurationArtifactId",
          "policyHash",
          "budgetReportArtifactId",
        ]) &&
        ["planning", "baseline_review", "remediation", "closure"].includes(
          String(payload.haltedFrom),
        ) &&
        [
          "refusal",
          "invalid_output",
          "transport",
          "provider_error",
          "budget",
        ].includes(String(payload.failureClassification)) &&
        (payload.ledgerArtifactId === null ||
          (typeof payload.ledgerArtifactId === "string" &&
            payload.ledgerArtifactId.length > 0)) &&
        (payload.planArtifactId === null ||
          (typeof payload.planArtifactId === "string" &&
            payload.planArtifactId.length > 0)) &&
        stringSet(payload.attemptIds) &&
        stringSet(payload.evidenceArtifactIds) &&
        stringSet(payload.unresolvedFindingIds, false) &&
        stringSet(payload.lineageArtifactIds, false) &&
        stringSet(payload.waiverIds, false) &&
        assignment(payload.plannerAssignment) &&
        assignment(payload.reviewerAssignment) &&
        record(payload.recoveryBounds) &&
        hasExactKeys(payload.recoveryBounds, [
          "retryLimit",
          "repairLimit",
          "retriesUsed",
          "repairsUsed",
        ]) &&
        Object.values(payload.recoveryBounds).every(
          (counter) => Number.isInteger(counter) && Number(counter) >= 0,
        ) &&
        Number(payload.recoveryBounds.retriesUsed) <=
          Number(payload.recoveryBounds.retryLimit) &&
        Number(payload.recoveryBounds.repairsUsed) <=
          Number(payload.recoveryBounds.repairLimit) &&
        (payload.independence === null || independence(payload.independence)) &&
        payload.outcome === "halted"
      );
    case "attempt_provider_cancel":
      return (
        hasExactKeys(value, ["attemptId", "providerRequestId"]) &&
        stringFields(["attemptId", "providerRequestId"])
      );
    case "backup_workspace":
      return hasExactKeys(value, ["backupId"]) && stringFields(["backupId"]);
    case "verify_integrity":
      return hasExactKeys(value, ["scope"]) && payload.scope === "workspace";
    case "render_qualification_report":
      return (
        hasExactKeys(value, [
          "planVersionId",
          "planArtifactId",
          "ledgerVersionId",
          "waiverIds",
        ]) &&
        stringFields(["planVersionId", "planArtifactId", "ledgerVersionId"]) &&
        stringSet(payload.waiverIds, false)
      );
    case "repair_schema":
      return (
        hasExactKeys(value, [
          "originalCommandId",
          "invalidResponseArtifactId",
          "schemaArtifactId",
          "repairAttempt",
        ]) &&
        stringFields([
          "originalCommandId",
          "invalidResponseArtifactId",
          "schemaArtifactId",
        ]) &&
        Number.isInteger(payload.repairAttempt) &&
        Number(payload.repairAttempt) >= 1
      );
    default:
      return false;
  }
}

export function commandIsValid(command: PersistableCommand): boolean {
  const executionClass: Record<string, "local" | "provider" | "cancel"> = {
    render_source_registration_report: "local",
    validate_ledger: "local",
    render_ledger: "local",
    render_ledger_approval: "local",
    generate_plan: "provider",
    render_plan: "local",
    render_qualification_report: "local",
    baseline_review: "provider",
    generate_remediation: "provider",
    verify_remediation: "provider",
    closure_review: "provider",
    repair_schema: "provider",
    export_terminal: "local",
    attempt_provider_cancel: "cancel",
    backup_workspace: "local",
    verify_integrity: "local",
  };
  const commandWithoutIdentity = Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => key !== "commandId" && key !== "commandKey",
    ),
  );
  const commandExecutionClass = executionClass[command.commandType];
  const providerShapeValid =
    commandExecutionClass === "local"
      ? command.provider === "local" &&
        command.modelId === undefined &&
        command.providerRequestPolicy === undefined &&
        Object.values(command.budgetReservation).every((value) => value === 0)
      : commandExecutionClass === "provider"
        ? (command.provider === "openai" || command.provider === "anthropic") &&
          typeof command.modelId === "string" &&
          command.modelId.length > 0 &&
          command.budgetReservation.calls === 1 &&
          providerRequestPolicyIsValid(command)
        : commandExecutionClass === "cancel" &&
          (command.provider === "openai" || command.provider === "anthropic");
  const prerequisiteShapeValid =
    command.commandType === "baseline_review"
      ? command.prerequisiteCommandIds?.length === 1 &&
        command.prerequisiteCommandIds[0] ===
          (command.payload as Record<string, unknown>).renderPlanCommandId
      : true;
  const envelopeRequired = [
    "commandId",
    "commandKey",
    "commandType",
    "schemaVersion",
    "runId",
    "triggeringStateVersion",
    "purposeId",
    "inputArtifactHashes",
    "policyHash",
    "provider",
    "budgetReservation",
    "payload",
  ];
  return (
    hasExactKeys(command, envelopeRequired, [
      "modelId",
      "prerequisiteCommandIds",
      "providerRequestPolicy",
    ]) &&
    hasExactKeys(command.budgetReservation, [
      "calls",
      "inputTokens",
      "outputTokens",
      "costUsdMicros",
    ]) &&
    command.schemaVersion === 1 &&
    command.commandId.length > 0 &&
    commandExecutionClass !== undefined &&
    command.purposeId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(command.policyHash) &&
    command.inputArtifactHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash)) &&
    (command.prerequisiteCommandIds === undefined ||
      (command.prerequisiteCommandIds.length > 0 &&
        new Set(command.prerequisiteCommandIds).size ===
          command.prerequisiteCommandIds.length &&
        command.prerequisiteCommandIds.every((id) => id.length > 0))) &&
    providerShapeValid &&
    prerequisiteShapeValid &&
    payloadIsValid(command.commandType, command.payload) &&
    Object.values(command.budgetReservation).every(
      (value) => Number.isInteger(value) && value >= 0,
    ) &&
    sha256(canonicalJson(commandWithoutIdentity)) === command.commandKey
  );
}

function providerRequestPolicyIsValid(command: PersistableCommand): boolean {
  const policy = command.providerRequestPolicy;
  return (
    policy !== undefined &&
    hasExactKeys(policy, [
      "configurationArtifactId",
      "configurationContentHash",
      "policyHash",
      "role",
      "promptArtifactId",
      "promptContentHash",
      "outputSchemaArtifactId",
      "outputSchemaContentHash",
      "maxOutputTokens",
      "timeoutMs",
      "reasoning",
      "providerStorage",
    ]) &&
    policy.configurationArtifactId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(policy.configurationContentHash) &&
    policy.policyHash === command.policyHash &&
    ["planner", "reviewer"].includes(policy.role) &&
    policy.promptArtifactId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(policy.promptContentHash) &&
    policy.outputSchemaArtifactId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(policy.outputSchemaContentHash) &&
    Number.isInteger(policy.maxOutputTokens) &&
    policy.maxOutputTokens > 0 &&
    policy.maxOutputTokens === command.budgetReservation.outputTokens &&
    Number.isInteger(policy.timeoutMs) &&
    policy.timeoutMs > 0 &&
    (policy.reasoning === null ||
      (typeof policy.reasoning === "string" && policy.reasoning.length > 0)) &&
    policy.providerStorage === "minimize"
  );
}

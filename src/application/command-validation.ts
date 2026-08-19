import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { PersistableCommand } from "./authority-port.js";

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

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0)
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
    value.every(
      (item) =>
        record(item) &&
        hasExactKeys(item, ["exclusionId", "sourceRange", "reason"]) &&
        typeof item.exclusionId === "string" &&
        typeof item.reason === "string" &&
        record(item.sourceRange) &&
        hasExactKeys(item.sourceRange, ["startOffset", "endOffset"]) &&
        Number.isInteger(item.sourceRange.startOffset) &&
        Number.isInteger(item.sourceRange.endOffset),
    )
  );
}

function payloadIsValid(commandType: string, value: object): boolean {
  const payload = value as Record<string, unknown>;
  const stringFields = (keys: string[]): boolean =>
    keys.every(
      (key) =>
        typeof payload[key] === "string" && String(payload[key]).length > 0,
    );
  switch (commandType) {
    case "render_source_registration_report":
      return (
        hasExactKeys(value, ["sourceArtifactId"]) &&
        stringFields(["sourceArtifactId"])
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
          "coverageReportArtifactId",
          "coverageValidatedStateVersion",
          "coverageValidatedPolicyHash",
          "approvalGateId",
          "sourceExclusions",
          "approvedBy",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "ledgerArtifactId",
          "coverageReportArtifactId",
          "coverageValidatedPolicyHash",
          "approvalGateId",
        ]) &&
        Number.isInteger(payload.coverageValidatedStateVersion) &&
        sourceExclusions(payload.sourceExclusions) &&
        humanActor(payload.approvedBy)
      );
    case "generate_plan":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "ledgerArtifactId",
          "promptArtifactId",
          "outputSchemaArtifactId",
          "providerStorage",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "ledgerArtifactId",
          "promptArtifactId",
          "outputSchemaArtifactId",
        ]) &&
        payload.providerStorage === "minimize"
      );
    case "render_plan":
      return (
        hasExactKeys(value, ["planVersionId", "planArtifactId"]) &&
        stringFields(["planVersionId", "planArtifactId"])
      );
    case "baseline_review":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "ledgerArtifactId",
          "planVersionId",
          "planArtifactId",
          "renderPlanCommandId",
          "reviewerPromptArtifactId",
          "reviewSchemaArtifactId",
          "taxonomyArtifactId",
          "componentRegistryArtifactId",
          "reviewPolicyArtifactId",
          "evidenceArtifactIds",
          "independence",
          "providerStorage",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "ledgerArtifactId",
          "planVersionId",
          "planArtifactId",
          "renderPlanCommandId",
          "reviewerPromptArtifactId",
          "reviewSchemaArtifactId",
          "taxonomyArtifactId",
          "componentRegistryArtifactId",
          "reviewPolicyArtifactId",
        ]) &&
        strings(payload.evidenceArtifactIds) &&
        independence(payload.independence) &&
        payload.providerStorage === "minimize"
      );
    case "generate_remediation":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "reviewArtifactId",
          "blockingFindingIds",
          "providerStorage",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "reviewArtifactId",
        ]) &&
        strings(payload.blockingFindingIds) &&
        payload.providerStorage === "minimize"
      );
    case "closure_review":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "baselineReviewArtifactId",
          "renderedPlanArtifactId",
          "reviewerPromptArtifactId",
          "reviewSchemaArtifactId",
          "taxonomyArtifactId",
          "componentRegistryArtifactId",
          "reviewPolicyArtifactId",
          "evidenceArtifactIds",
          "findingIds",
          "independence",
          "providerStorage",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "baselineReviewArtifactId",
          "renderedPlanArtifactId",
          "reviewerPromptArtifactId",
          "reviewSchemaArtifactId",
          "taxonomyArtifactId",
          "componentRegistryArtifactId",
          "reviewPolicyArtifactId",
        ]) &&
        strings(payload.evidenceArtifactIds) &&
        Array.isArray(payload.findingIds) &&
        independence(payload.independence) &&
        payload.providerStorage === "minimize"
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
        strings(payload.attemptIds) &&
        strings(payload.evidenceArtifactIds) &&
        Array.isArray(payload.unresolvedFindingIds) &&
        Array.isArray(payload.lineageArtifactIds) &&
        Array.isArray(payload.waiverIds) &&
        assignment(payload.plannerAssignment) &&
        assignment(payload.reviewerAssignment) &&
        record(payload.recoveryBounds) &&
        hasExactKeys(payload.recoveryBounds, [
          "retryLimit",
          "repairLimit",
          "retriesUsed",
          "repairsUsed",
        ]) &&
        Object.values(payload.recoveryBounds).every(Number.isInteger) &&
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
    case "verify_remediation":
      return (
        hasExactKeys(value, [
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "remediationArtifactId",
          "claimIds",
          "providerStorage",
        ]) &&
        stringFields([
          "ledgerVersionId",
          "planVersionId",
          "planArtifactId",
          "remediationArtifactId",
        ]) &&
        strings(payload.claimIds) &&
        payload.providerStorage === "minimize"
      );
    default:
      return false;
  }
}

export function commandIsValid(command: PersistableCommand): boolean {
  const commandTypes = new Set([
    "render_source_registration_report",
    "validate_ledger",
    "render_ledger",
    "render_ledger_approval",
    "generate_plan",
    "render_plan",
    "baseline_review",
    "generate_remediation",
    "verify_remediation",
    "closure_review",
    "repair_schema",
    "export_terminal",
    "attempt_provider_cancel",
    "backup_workspace",
    "verify_integrity",
  ]);
  const commandWithoutIdentity = Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => key !== "commandId" && key !== "commandKey",
    ),
  );
  const localTypes = new Set([
    "render_source_registration_report",
    "validate_ledger",
    "render_ledger",
    "render_ledger_approval",
    "render_plan",
    "export_terminal",
    "backup_workspace",
    "verify_integrity",
  ]);
  const providerTypes = new Set([
    "generate_plan",
    "baseline_review",
    "generate_remediation",
    "verify_remediation",
    "closure_review",
    "repair_schema",
  ]);
  const providerShapeValid = localTypes.has(command.commandType)
    ? command.provider === "local" &&
      command.modelId === undefined &&
      Object.values(command.budgetReservation).every((value) => value === 0)
    : providerTypes.has(command.commandType)
      ? (command.provider === "openai" || command.provider === "anthropic") &&
        typeof command.modelId === "string" &&
        command.modelId.length > 0 &&
        command.budgetReservation.calls === 1
      : command.commandType === "attempt_provider_cancel" &&
        (command.provider === "openai" || command.provider === "anthropic");
  const prerequisiteShapeValid =
    command.commandType === "baseline_review"
      ? command.prerequisiteCommandIds?.length === 1
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
    ]) &&
    hasExactKeys(command.budgetReservation, [
      "calls",
      "inputTokens",
      "outputTokens",
      "costUsdMicros",
    ]) &&
    command.schemaVersion === 1 &&
    command.commandId.length > 0 &&
    commandTypes.has(command.commandType) &&
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

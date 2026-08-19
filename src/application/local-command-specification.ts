import type { PersistableCommand } from "./authority-port.js";
import type { ArtifactKind } from "./artifact-port.js";

export type LocalCommandSpecification = {
  controlledArtifactFields: readonly string[];
  resultPurpose:
    | "source_registration"
    | "ledger_validation"
    | "ledger_render"
    | "ledger_approval";
  resultKind: ArtifactKind;
  resultMediaType: string;
  stateChanging: boolean;
  executable: boolean;
};

const specifications = {
  render_source_registration_report: {
    controlledArtifactFields: ["sourceArtifactId", "configurationArtifactId"],
    resultPurpose: "source_registration",
    resultKind: "other",
    resultMediaType: "text/markdown; charset=utf-8",
    stateChanging: false,
    executable: true,
  },
  validate_ledger: {
    controlledArtifactFields: ["ledgerArtifactId", "sourceArtifactId"],
    resultPurpose: "ledger_validation",
    resultKind: "coverage_report",
    resultMediaType: "application/json",
    stateChanging: true,
    executable: true,
  },
  render_ledger: {
    controlledArtifactFields: ["ledgerArtifactId"],
    resultPurpose: "ledger_render",
    resultKind: "rendered_ledger",
    resultMediaType: "text/markdown; charset=utf-8",
    stateChanging: true,
    executable: true,
  },
  render_ledger_approval: {
    controlledArtifactFields: [
      "ledgerArtifactId",
      "coverageReportArtifactId",
      "sourceArtifactId",
    ],
    resultPurpose: "ledger_approval",
    resultKind: "other",
    resultMediaType: "text/markdown; charset=utf-8",
    stateChanging: false,
    executable: true,
  },
} as const;

export function localCommandSpecification(
  command: PersistableCommand,
): LocalCommandSpecification | null {
  return (
    specifications[command.commandType as keyof typeof specifications] ?? null
  );
}

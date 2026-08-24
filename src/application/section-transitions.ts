import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { SectionTransitionValidation } from "../domain/index.js";

type DeclaredTransition = {
  kind: "preserved" | "retitled" | "split" | "merged" | "retired" | "new";
  fromSectionIds: string[];
  toSectionIds: string[];
};

function planSectionIds(bytes: Uint8Array): {
  sectionIds: Set<string>;
  declaredTransitions: unknown;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const document = parsed as Record<string, unknown>;
  if (!Array.isArray(document.sections)) return null;
  const sectionIds = new Set<string>();
  for (const section of document.sections) {
    const sectionId =
      section !== null && typeof section === "object"
        ? (section as Record<string, unknown>).section_id
        : undefined;
    if (typeof sectionId !== "string" || sectionId.length === 0) return null;
    if (sectionIds.has(sectionId)) return null;
    sectionIds.add(sectionId);
  }
  return { sectionIds, declaredTransitions: document.section_transitions };
}

function declaredTransitions(value: unknown): DeclaredTransition[] | null {
  if (!Array.isArray(value)) return null;
  const transitions: DeclaredTransition[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return null;
    const transition = entry as Record<string, unknown>;
    const kind = transition.kind;
    const from = transition.from_section_ids;
    const to = transition.to_section_ids;
    if (
      typeof kind !== "string" ||
      !["preserved", "retitled", "split", "merged", "retired", "new"].includes(
        kind,
      ) ||
      !Array.isArray(from) ||
      !Array.isArray(to) ||
      ![...(from as unknown[]), ...(to as unknown[])].every(
        (sectionId) => typeof sectionId === "string" && sectionId.length > 0,
      )
    ) {
      return null;
    }
    transitions.push({
      kind: kind as DeclaredTransition["kind"],
      fromSectionIds: from as string[],
      toSectionIds: to as string[],
    });
  }
  return transitions;
}

function transitionShapeIsValid(transition: DeclaredTransition): boolean {
  const fromCount = transition.fromSectionIds.length;
  const toCount = transition.toSectionIds.length;
  switch (transition.kind) {
    case "preserved":
    case "retitled":
      return fromCount === 1 && toCount === 1;
    case "split":
      return fromCount === 1 && toCount >= 2;
    case "merged":
      return fromCount >= 2 && toCount === 1;
    case "retired":
      return fromCount === 1 && toCount === 0;
    case "new":
      return fromCount === 0 && toCount === 1;
  }
}

export function validateSectionTransitions(input: {
  priorPlanBytes: Uint8Array;
  planBytes: Uint8Array;
  transitionMapBytes: Uint8Array;
}): SectionTransitionValidation {
  const validatedPlanContentHash = createHash("sha256")
    .update(input.planBytes)
    .digest("hex");
  const validatedTransitionMapContentHash = createHash("sha256")
    .update(input.transitionMapBytes)
    .digest("hex");
  const result = (
    classificationsComplete: boolean,
    existingSectionIdsPreserved: boolean,
    onlyDeclaredNewSectionsAssignedIds: boolean,
  ): SectionTransitionValidation => ({
    validator: "deterministic-section-transition-v1",
    validatedPlanContentHash,
    validatedTransitionMapContentHash,
    classificationsComplete,
    existingSectionIdsPreserved,
    onlyDeclaredNewSectionsAssignedIds,
  });

  const prior = planSectionIds(input.priorPlanBytes);
  const revised = planSectionIds(input.planBytes);
  let mapValue: unknown;
  try {
    mapValue = JSON.parse(
      Buffer.from(input.transitionMapBytes).toString("utf8"),
    );
  } catch {
    mapValue = undefined;
  }
  const transitions =
    mapValue === undefined ? null : declaredTransitions(mapValue);
  if (
    prior === null ||
    revised === null ||
    transitions === null ||
    canonicalJson(mapValue) !== canonicalJson(revised.declaredTransitions)
  ) {
    return result(false, false, false);
  }

  const declaredFrom = new Set(
    transitions.flatMap(({ fromSectionIds }) => fromSectionIds),
  );
  const declaredTo = new Set(
    transitions.flatMap(({ toSectionIds }) => toSectionIds),
  );
  const classificationsComplete = transitions.every(
    (transition) =>
      transitionShapeIsValid(transition) &&
      transition.fromSectionIds.every((sectionId) =>
        prior.sectionIds.has(sectionId),
      ) &&
      transition.toSectionIds.every((sectionId) =>
        revised.sectionIds.has(sectionId),
      ),
  );
  const existingSectionIdsPreserved = [...prior.sectionIds].every(
    (sectionId) =>
      revised.sectionIds.has(sectionId) || declaredFrom.has(sectionId),
  );
  const onlyDeclaredNewSectionsAssignedIds = [...revised.sectionIds].every(
    (sectionId) => prior.sectionIds.has(sectionId) || declaredTo.has(sectionId),
  );

  return result(
    classificationsComplete,
    existingSectionIdsPreserved,
    onlyDeclaredNewSectionsAssignedIds,
  );
}

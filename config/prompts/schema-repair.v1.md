# Schema Repair Prompt v1

Repair the supplied response so it conforms exactly to the supplied JSON schema.

Preserve the substantive meaning and all identifiers. Do not add new findings, claims, requirements, sections, evidence, or decisions. Return only the repaired structured value. If the source is a refusal, truncated response, or lacks the information required by the schema, report that it is not repairable instead of inventing content.

# 08 — Terminal export for approved runs

**What to build:** Executing the terminal export for an approved run produces the manifest and eligible plan projections: the manifest validates against the pinned terminal-manifest schema, references every required evidence artifact (source, configuration, ledger, plan, reviews, findings, waivers and acknowledgments, budget report, lineage), and the exported plan projection matches its verified render byte-for-byte. This is the demoable end of the happy path — a run that reaches explicit approval yields a complete, verifiable manifest.

**Blocked by:** 07 — Human approval and rejection of qualified plans.

**Status:** ready-for-agent

- [ ] The approved and approved-with-waivers outcomes both export manifests that pass schema validation plus semantic assertions on required evidence references
- [ ] The waiver variant's manifest carries every acknowledged waiver with its pinned evidence versions
- [ ] Export is deterministic: re-running it over the same terminal state yields identical bytes
- [ ] An integration test walks a run from closure through approval to a verified on-disk export

# Plan Quality Rubric v1

Each dimension is scored blind on a 1–5 scale. The scorer receives two anonymized plans, the approved requirements ledger, and this rubric. The scorer must not have authored either plan.

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| Correctness | Contradicts requirements or relies on invalid mechanics | Mostly sound with localized uncertainty | Mechanically and behaviorally sound throughout |
| Completeness | Omits major required behavior | Covers primary behavior but misses meaningful edges | Covers requirements, failure modes, and operational edges |
| Traceability | Claims cannot be tied to requirements | Most major choices have traceable support | Every material choice and exclusion is traceable |
| Feasibility | Cannot be implemented under constraints | Implementable with unresolved risks | Concrete, bounded, and credible under all stated constraints |
| Risk handling | Ignores security, data, recovery, or dependency risk | Identifies major risks with partial mitigation | Risks have specific mitigations and verification evidence |
| Clarity | Ambiguous boundaries and sequencing | Understandable with some interpretation | Precise boundaries, vocabulary, ownership, and sequence |

The primary comparison is the sum of all six dimensions. Ties are reported as no improvement. Comments must cite the relevant plan section and explain the score.

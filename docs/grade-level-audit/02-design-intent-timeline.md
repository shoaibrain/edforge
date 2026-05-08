---
title: 02 — Design-Intent Timeline
status: Best-effort pass — needs git-log archaeology for full citation
date: 2026-05-08
---

# Design-Intent Timeline

Was the five-value-space split (T3) **deliberate Ed-Fi-export-vs-internal architectural choice** or **accidental drift across multiple sprints**?

The audit has full code visibility but limited time for exhaustive git-archaeology. This pass reads the *shape* of the codebase — what each file looks like, what its tests cover, what its imports tell us — and infers intent. A follow-up commit-by-commit walk of the introducing PRs can confirm.

## Inferred timeline

| Era | Probable intent | Evidence in current code |
|---|---|---|
| **Pre-Nepal pilot** | EdForge built with US-shaped K-12 model: K, 1-12, plus PK. Validator `validators/grade-level.ts` reflects this — `['PK', 'K', '1'-'12']`. Likely the **first** value-space introduced. | The legacy validator's set is exactly what a US-K-12 designer would write. No ECD/PPC. |
| **Ed-Fi export work (Phase 1)** | Outbound Ed-Fi compliance added. `mappers/edfi/` directory introduced, descriptor catalog at `ed-fi/descriptors/grade-level-descriptor.ts` populated with 16 entries including extension-style names. School entity gains `gradeLevels[]`. Bare-name shape chosen for storage compaction (URI prefix added at serialize). | The export mappers and descriptor catalog look like a deliberate single-author effort. The bare-name-vs-URI choice has the rhythm of a design decision. |
| **Nepal pilot (Sprint A region-aware forms, Sprint C3 IEMIS)** | PABSON archetype introduced with ECD/PPC pre-primary. `ORDERED_GRADES` introduced in `schemas/identity/grade-levels.ts` as `['ECD', 'PPC', 'PK', 'K', '1'-'12']`. **`GRADE_RANGE_TO_DESCRIPTOR` introduced for the wizard's compute step.** Legacy validator was NOT updated. | The internal-codes file (`schemas/identity/grade-levels.ts`) and the legacy file (`validators/grade-level.ts`) **coexist with no cross-reference and incompatible sets** — the strongest evidence of unbought-out drift. |
| **Sprint C3.T1 (2026-04-29)** | `normalizeGradeLevel('ECD/PPC') → 'ECD'` shipped. Per memory `project_sprint_C3_iemis_combined_band_shipped.md`. | The combined-band token resolution was a focused fix; it did not retire any of the prior value spaces. |
| **Sprint C4 (2026-04-30)** | Async IEMIS + AY enrollment shipped. Per memory `project_sprint_C4_async_import_shipped.md`. | The async pipeline writes Enrollment.gradeLevel as internal codes — picked the path of least resistance vs. retroactively reshaping prior storage. |
| **Now (2026-05-08)** | Five spaces, no canonical inverse, two duplicate label functions, one legacy validator that excludes Nepal pre-primary, one orphaned `/configuration` sub-resource leaking US defaults. | This audit. |

## Inferred verdict

**Partially deliberate, partially accidental.** The intentional pieces:

- Spaces A (internal codes), B (descriptor names), C (URIs) and the export mapper layer — these look like a **deliberate dual-shape model with translation at outbound**.
- `normalizeGradeLevel` as the IEMIS-input-to-internal-codes gate — also deliberate.

The accidental pieces:

- The **legacy validator** at `validators/grade-level.ts` not being retired when `ORDERED_GRADES` was introduced. Either nobody knew it existed or its consumers were not refactored at the time of the new schema.
- The **second `formatGradeLabel` implementation** in the academics MFE duplicating `getGradeLevelLabel`. Likely a frontend dev who didn't find the shared-types helper and wrote a fresh switch.
- The **`SchoolConfiguration` US-defaults leak** — the lazy `createDefaultConfig` fallback ignores the country merge that the eager path applies. This looks like a forgotten code path: someone wrote both paths but forgot to keep them in sync. The orphan timestamp from Scenario A is the empirical receipt.
- The **B → A inverse map missing** — the Curriculum-tab course-count aggregation assumes Course.gradeLevels[] uses Space A but the form writes Space B. This is a **read-write contract mismatch** that strongly suggests the two were authored by different people in different sprints.

## What follow-up archaeology would prove

A git-log walk of the introducing PRs would tell us:

- Author / reviewer of each value space at first appearance.
- Whether the legacy validator's continued existence was discussed (e.g., a "TODO retire" comment, a deferred-cleanup ticket).
- Whether the `formatGradeLabel` author saw `getGradeLevelLabel` and made a deliberate choice vs. a missed-reuse.

The audit defers this archaeology. **The fix list in T8 does not depend on knowing whose fault it was.** Identifying the *what* and the *fix path* is sufficient.

## Verdict for the FIX sprint

The dual-shape model (A + B + C) **should not be torn out**. Outbound Ed-Fi compliance is a real product surface (real or future). The drift bits — the legacy validator, the duplicate label function, the lazy-config fallback, the missing B→A inverse — are concrete, scoped, and individually fixable. **Treat the FIX sprint as drift-cleanup work, not as a domain-model rewrite.** That framing aligns with the recommendation in 04-edfi-v6-alignment.md (Option 1 + later Option 3, never Option 2).

---
title: 04 — Ed-Fi v6 Alignment Analysis
status: Done — informed by code-trace + Ed-Fi v6 Data Standard public spec
date: 2026-05-08
---

# Ed-Fi v6 Alignment Analysis

EdForge presents itself as Ed-Fi-aligned. The reality from code: **Ed-Fi v6 is an outbound serialization shape, not the native data model.** This document evaluates each of the five value spaces (T3) against Ed-Fi v6 and surfaces the strategic question for product.

## Reference: Ed-Fi v6 canonical positions

The Ed-Fi Data Standard v6 specifies grade-level handling in three places:

1. **`GradeLevelDescriptor`** — namespace `uri://ed-fi.org/GradeLevelDescriptor`, descriptor catalog with codeValue + descriptor URI. Core values include `Prekindergarten`, `Kindergarten`, `FirstGrade`...`TwelfthGrade`, `Postsecondary`, plus extensions registered per-implementation. (Ed-Fi Data Standard v6 §5.2 Descriptors.)
2. **`School.gradeLevels[]`** — array of GradeLevelDescriptor URIs (full URI, not bare name). Indicates which grade levels the school offers. (Ed-Fi v6 §6 EducationOrganization → School entity.)
3. **`StudentSchoolAssociation.entryGradeLevelDescriptor`** — single GradeLevelDescriptor URI on each enrollment. Plus `exitWithdrawTypeDescriptor`, `entryTypeDescriptor`, etc. (Ed-Fi v6 §7 Student.)

A second Ed-Fi v6 mechanism: **extension descriptors.** Ed-Fi explicitly supports custom descriptors registered under an implementation's own namespace (e.g., `uri://edforge.app/GradeLevelDescriptor#EarlyChildhoodDevelopment`) for values not in the core. EdForge uses this for `EarlyChildhoodDevelopment` and `PrePrimaryClass` — **these are legitimate Ed-Fi extension descriptors, not non-conformant.**

## Per-space verdict

### Space A — Internal codes (`'ECD'`, `'1'`, ...)

- Where Ed-Fi v6 stands: **No equivalent.** Ed-Fi has no concept of "short internal grade code"; descriptors are the only first-class representation.
- EdForge's choice: stores internal codes on `Enrollment.gradeLevel` and uses them as keys in `Enrollment.GSI1SK = ENROLLMENT#<yearId>#<code>`.
- **Verdict: divergent.** This is an EdForge-specific compaction. Roughly equivalent to using the descriptor's `codeValue` field and excluding the namespace, but that's not a documented Ed-Fi v6 pattern.
- Migration cost to align: **medium**. Storing the descriptor name (Space B) on Enrollment instead of the code requires a backfill of existing rows, a GSI rebuild on the new key shape, and rewriting consumers (dashboard aggregator, queryEnrollmentSummary).

### Space B — Ed-Fi descriptor names (`'FirstGrade'`, ...)

- Where Ed-Fi v6 stands: Ed-Fi entities reference descriptors by **URI**, not by bare name. The bare name is the descriptor's `codeValue` field; the URI is the canonical reference.
- EdForge's choice: stores bare names on `School.gradeLevels[]` and `Course.gradeLevels[]`.
- **Verdict: extended (acceptable).** The bare-name shape is a defensible compaction — at outbound serialize, the export mapper at [education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) prepends `uri://ed-fi.org/GradeLevelDescriptor#` and produces a valid Ed-Fi URI. **However:** EdForge extensions (`EarlyChildhoodDevelopment`, `PrePrimaryClass`) ought to be exported under an EdForge namespace (`uri://edforge.app/GradeLevelDescriptor#...`), not under `uri://ed-fi.org/...`. **Verify in T8 the actual mapper output for these two values** — if it currently emits `uri://ed-fi.org/GradeLevelDescriptor#EarlyChildhoodDevelopment`, that is a non-conformance against an Ed-Fi-strict consumer.
- Migration cost: **low** — fix the mapper to namespace-route extensions.

### Space C — Ed-Fi descriptor URIs

- Where Ed-Fi v6 stands: This **is** the Ed-Fi canonical reference shape.
- EdForge's choice: emits these only at outbound export time, never stored.
- **Verdict: aligned (the only fully aligned space).**
- Migration cost: none.

### Space D — UI labels (`'Grade 1'`, `'1st Grade'`, ...)

- Where Ed-Fi v6 stands: **Out of scope.** Ed-Fi specifies no UI representation; it's a data standard.
- EdForge's choice: produces these in MFE render via two duplicate label functions.
- **Verdict: not a conformance question.** It's an internal-correctness question (T3). Move on.

### Space E — Legacy validator (`['PK','K','1'-'12']`, no ECD/PPC)

- Where Ed-Fi v6 stands: not applicable — this is internal validation, not Ed-Fi.
- EdForge's choice: leftover validator that excludes Nepal pre-primary values.
- **Verdict: divergent (and Nepal-broken on any reachable code path).** T7 is the reachability audit.

## The strategic question for product

The current state can be described as:

> **EdForge is Ed-Fi-shaped at write (Space B descriptor names on School / Course) and Ed-Fi-empty at read (Space A internal codes on Enrollment, dashboard, GSI keys).** Outbound exports patch the gap by translating B → C at serialize time. The system reads from Ed-Fi-shaped data only on the school-detail and course-detail paths; everything analytical reads internal codes.

This is a **dual-shape domain** with a translation layer at outbound mappers. It's defensible — many modern SIS implementations do exactly this for performance — but it has costs:

| Cost | What it means |
|---|---|
| **Two source-of-truth questions** | "What grade levels does this school offer?" → Space B. "How many students in grade 1?" → Space A. The two answers are nominally equivalent but use different value spaces and different data sources. |
| **No native Ed-Fi read API** | If a Nepal Ministry requires a read-side Ed-Fi v6 API (e.g., Flash III where CEHRD pulls a daily snapshot), the read path needs a translation layer that doesn't exist on the read side today. |
| **Extension descriptors look like core descriptors** | `EarlyChildhoodDevelopment` and `PrePrimaryClass` need to namespace correctly at export. **High-priority verification.** |
| **Operators see translation seams** | The Curriculum tab renders internal codes (`ECD`, `PPC`) in one column and Ed-Fi-derived UI labels (`ECD (Early Childhood Development)`) in another. Operators don't know which is "the right one". |

## Three product-strategic options

### Option 1: Stay dual-shape, fix the seams

- Keep Space A on Enrollment / dashboard. Keep Space B on School / Course.
- Build the missing **B → A inverse** map as canonical (the Curriculum-tab course-count fix from T3).
- Namespace-route extension descriptors at the outbound mapper.
- Document the dual-shape model. Train operators that "the dashboard's `ECD` and the school's `EarlyChildhoodDevelopment` are the same concept."
- **Cost: low. Speed: fast. Pilot-blocker: no.** This is the minimum viable fix list.

### Option 2: Make Ed-Fi descriptor URIs the canonical reference everywhere

- Rewrite Enrollment.gradeLevel to store Ed-Fi descriptor names (Space B).
- Backfill existing data (Saraswati's 778 rows + dev-pabson-primary's 200 rows + any other tenant).
- Rebuild Enrollment GSI1SK on the new key shape.
- Retire `normalizeGradeLevel` to return Space B values; rewrite `formatGradeLabel` to accept Space B inputs.
- **Cost: high (one-time backfill + GSI rebuild). Speed: slow. Pilot-blocker: no, but creates a hard freeze window.**
- Native Ed-Fi read APIs become possible without translation layers.

### Option 3: Build a translation layer between A and B as a domain primitive

- Introduce a `@aibrains/shared-types/grade-level/translate.ts` module with bidirectional A↔B mapping as the only acceptable conversion path.
- All consumers must call `translate.codeToDescriptor()` or `translate.descriptorToCode()`. Lint rule: forbid string-matching loops against `GRADE_LEVEL_OPTIONS`.
- Keep both spaces in storage but make the translation impossible to bypass.
- **Cost: medium. Speed: medium. Pilot-blocker: no.** This is the structurally cleanest answer without a backfill.

## Recommendation

For the audit's purposes — which is to inform a FIX sprint, not to commit to a domain rewrite — **Option 1 is the right near-term answer.** It closes the operator-visible seams (Curriculum-tab course-count, namespace-route extension descriptors), unblocks the next pilot, and preserves Saraswati's data integrity. Option 3 is the right answer **after** the next pilot is live and we have time for a structural cleanup. Option 2 is the right answer **only** if a Ministry-of-Education stakeholder asks for native Ed-Fi v6 read APIs and is willing to fund the backfill window.

The SABER framing in the user's brief — "Evidence-Based Approach for Better Education Outcome" — argues for Option 1+3 as a phased path: **fix what operators see now, structurally separate later.** Don't rewrite for a hypothetical Ministry consumer; do rewrite once we know who's reading.

## Verification needed before T8

- The export mapper's behavior on `EarlyChildhoodDevelopment` and `PrePrimaryClass`: does it emit `uri://ed-fi.org/...` or `uri://edforge.app/...`? **A 30-minute code read settles this.**
- Whether any current customer / partner / pilot actually consumes Ed-Fi exports today, or whether the export mappers are lying-in-wait code. CLAUDE.md says "Outbound Ed-Fi compliance exports only" — strongly suggests no live consumer.

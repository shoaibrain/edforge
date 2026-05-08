---
title: 01 — Pin Verification + Duplicate-Pre-Kindergarten Runtime Check
status: Done — duplicate-PK closed by capture
date: 2026-05-08
---

# Pin Verification + Duplicate-PK Runtime Check

## Background

The audit's original screenshot showed a school-create wizard with **two "Pre-Kindergarten" chips** in the auto-computed list. The fix landed in `@aibrains/shared-types@0.37.0` (PPC → `'PrePrimaryClass'`, PK → `'Prekindergarten'`, distinct mappings). Pin status:

- AdminWeb (`client/AdminWeb/package.json`): `^0.39.0` → resolves ≥0.39.0
- edforge-saas-frontend MFEs: `^0.37.0` → resolves to 0.37.0 on disk

T1 was: **does the deployed Vercel build of edforge-saas-frontend actually carry the 0.37.0 fix, or is there a pin / cache / build drift?**

## Live capture verdict

The captured POST request body to `/api/schools` (Scenario A, captured 2026-05-08T18:53:26Z, on `https://edforge.app/`) shipped:

```json
"gradeLevels": [
  "EarlyChildhoodDevelopment",
  "PrePrimaryClass",
  "Prekindergarten",
  "Kindergarten",
  "FirstGrade", "SecondGrade", "ThirdGrade", "FourthGrade", "FifthGrade",
  "SixthGrade", "SeventhGrade", "EighthGrade", "NinthGrade",
  "TenthGrade", "EleventhGrade", "TwelfthGrade"
]
```

**16 distinct entries. No duplicate `Prekindergarten`. No duplicate `PrePrimaryClass`.** PPC and PK are emitted as their distinct Ed-Fi descriptor names.

The `getGradeLevelLabel` and `GRADE_RANGE_TO_DESCRIPTOR` from shared-types 0.37.0+ are correctly resolved on the deployed Vercel bundle. **The duplicate-PK bug is closed.** 

## Screenshot status

The earlier operator screenshot showing two "Pre-Kindergarten" chips:

- Either pre-dates the shared-types 0.37.0 fix (PR landed before this audit), OR
- Was captured from a stale Vercel deployment / browser cache before the bundle invalidated.

Either way, **it does not reproduce on the current deployed shell.** The fix candidate F-PK-1 from the original plan is closed out.

## What remains traceable

Two related-but-different concerns that the duplicate-PK debugging surfaced:

1. **The wizard's "additional grade levels" chip list** (Infant/Toddler, Prenursery, Nursery, Transitional Kindergarten, Postsecondary, Ungraded, Other) — these are legitimate Ed-Fi v6 descriptors, not duplicates. Operator may select any of them and they will be appended to `gradeLevels[]`. Documented in 03-value-space-catalog.md.

2. **Course form gradeLevels storage shape** — the course-create form writes Ed-Fi descriptor names to `Course.gradeLevels[]`, but the Curriculum tab's per-grade course-count aggregation iterates against internal codes. This is an **independent bug from the duplicate-PK issue** and is the highest-leverage near-term find from the audit. Tracked in 03 and forwarded to 08.

## Verdict

✅ Pin verification: shared-types 0.37.0+ resolves correctly on deployed Vercel build.
✅ Duplicate-PK: closed by code; runtime confirmed.
✅ Original screenshot: stale; close out F-PK-1.

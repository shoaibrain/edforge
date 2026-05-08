---
title: A — School Create (wide range ECD→12) — operator notes
date: 2026-05-08
school_id: 4209e3d8-d2e2-4e0e-9961-790341c264f4
school_code: DPPSW
emis_school_code: 888888888
correlation_id: b199d8a7-c737-472f-ba45-91e3d3b7e3c5
operator: rainshoaib01@gmail.com (TenantAdmin on dev-pabson-primary)
---

# Scenario A — School Create wide range

## Headline findings

1. **No duplicate Pre-Kindergarten in the request body.** The wizard shipped 16 distinct Ed-Fi descriptor names (`EarlyChildhoodDevelopment`, `PrePrimaryClass`, `Prekindergarten`, `Kindergarten`, `FirstGrade`...`TwelfthGrade`). The shared-types 0.37.0 PPC→PrePrimaryClass / PK→Prekindergarten distinction is correctly applied at form-submit time. **The original screenshot showing duplicate "Pre-Kindergarten" must have been pre-fix or a stale Vercel cache** — it does not reproduce on the current deployed shell.

2. **Backend trusts `gradeLevels[]` byte-equal.** The POST response stores exactly what the client sent. No server-side validation, no recompute from `gradeRange.start/end`, no descriptor normalization. The school entity is a pass-through for whatever the wizard ships.

3. **The wizard offers "additional grade levels" as Ed-Fi descriptor chips outside the auto-computed range:** Infant/Toddler, Prenursery, Nursery, Transitional Kindergarten, Postsecondary, Ungraded, Other — these are legitimate Ed-Fi v6 descriptors. None were selected for School A, but the operator can extend `gradeLevels[]` beyond the gradeRange. **Important consequence:** `gradeLevels[]` and `gradeRange` are independent fields and can disagree. Audit T3 should assess whether any consumer assumes they agree.

4. **🚨 `/api/schools/<id>/configuration` returns hardcoded US defaults** that ignore (a) the PABSON tenant Workspace Settings and (b) the school root entity's own Asia/Kathmandu / ne-NP / bikram_sambat values. See `01-network/response-GET-schools-A-configuration.json` for the full violation list. This is a **separate keyspace** (a sub-resource on the school) that is structurally orphaned.

5. **School entity itself violates "regional belongs only on WorkspaceSettings"** rule from CLAUDE.md. The wizard sets `timezone`, `locale`, `calendarSystem` on the school root — and the response stores them. So we have THREE keyspaces for "regional configuration":
   - `WorkspaceSettings.regional.*` (correct PABSON defaults — captured in `00-preflight/tenant-settings.json`)
   - `School.{timezone,locale,calendarSystem,academicCalendarType}` (correct here because operator manually entered Nepal values, but the schema **allows** override)
   - `SchoolConfiguration.{timezone,locale,dateFormat,timeFormat,academicCalendarType,gradingScale,...}` (US defaults; orphaned)

## Two-phase activation captured

After school create, the operator must:

1. **Configure an Academic Year:** `POST /api/schools/<id>/academic-years` with `name='2083-academic-year', startDate='2026-04-15', endDate='2027-04-13', calendarType='semester'`. Response includes auto-computed `startDateBS=2083/01/02` + `endDateBS=2083/12/30` (✅ shared-types BS converter working server-side). AY initial status: `'planning'`.

2. **Activate the AY:** `PUT /api/schools/<id>/academic-years/<yearId>/status` with `{status:'active'}`. AY moves to `'active'`. **`isCurrent` stays `false`** — operator must take a separate action elsewhere to flag the active AY as the school's current AY (or one is implicitly resolved — needs verification).

3. **Activate the School:** `PATCH /api/schools/<id>/status` with `{status:'active'}`. School moves from `'setup'` → `'active'`. **Only after this** does the Academics module unlock.

Operator UX hazard: this gate is implicit and undocumented in the API responses themselves. A non-engineer pilot operator wouldn't know they need three sequential POST/PUT/PATCH calls to enable Academics.

## Cross-keyspace disagreements observed in just one school create

| Concept | Tenant Workspace Settings | School root | School `/configuration` | AY child |
|---|---|---|---|---|
| Calendar type | `defaultCalendarSystem='bikram_sambat'` | `calendarSystem='bikram_sambat'`, `academicCalendarType='annual'` | `academicCalendarType='semester'` | `calendarType='semester'` |
| Timezone | `Asia/Kathmandu` | `Asia/Kathmandu` | `America/New_York` 🚨 | n/a |
| Locale | `ne-NP` | `ne-NP` | `en-US` 🚨 | n/a |
| Date format | `DD/MM/YYYY` | (not stored) | `MM/DD/YYYY` 🚨 | n/a |
| Week starts | `sunday` | (not stored) | `schoolDays=[1,2,3,4,5]` (Mon-Fri) 🚨 | n/a |
| Grading | (not stored) | (not stored) | letter A-F (US) 🚨 | n/a |

The `/configuration` row is the strongest signal of an orphaned legacy code path that hardcodes US-shaped defaults at school-create time and never inherits from the tenant or archetype.

## Status

✅ Captures complete for Scenario A. Detail awaits T5 (school provisioning trace doc) which will tie request body byte-equal to DDB row (read-only AWS pull pending).

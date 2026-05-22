# Saraswati IEMIS Import Review — 2026-05-19

> **Read-only post-mortem of the first real operator-led IEMIS XLSX student import in production.**
> Pilot tenant: `pabson-saraswati-bs-2083` (`34f49822-ae1d-4188-95f0-04e14bc6c662`).
> School: `61a247a4-44d6-4fc0-a414-062fd4d7e694` — *Shree Saraswati Secondary English Boarding School* (SSSEB), Dhanusha / Madhesh, Nepal.
> AY in scope: `2026-2027` / BS 2083 (`aa08592b-5202-4cf2-96f9-dd5e8455f4b6`), `isCurrent=true`.
> Reviewer: backend read-only via prod identity API with TenantAdmin JWT, no DDB direct access.
> Source code reviewed: [`iemis-transform.ts`](../../../server/application/microservices/academics/src/students/iemis-transform.ts), [`students.service.ts`](../../../server/application/microservices/academics/src/students/students.service.ts) (executeIemisImportAsync), [`students.controller.ts`](../../../server/application/microservices/academics/src/students/students.controller.ts).

---

## TL;DR

**The import pipeline did everything it was designed to do.** 206 students across 5 per-grade batches (the principal's intended workflow — one upload per grade) on 2026-05-19, all auto-enrolled in AY 2026-2027. No 5xx; no duplicates; no row rejections in the final-state observable. The C4 async-import pattern (POST→202 → in-process worker → markCompleted), the GSI7 dedup phase, the per-tenant `studentNumber` sequence (`SSSEB-2026-00001` → `00206`, no gaps), and the auto-enrollment path all functioned correctly.

The data going *into* the pipeline has issues — and so does the pipeline's coverage of the IEMIS XLSX columns. Three real findings, each with grounded root cause from the code:

1. **The IEMIS XLSX has columns the transformer doesn't read.** [`iemis-transform.ts`](../../../server/application/microservices/academics/src/students/iemis-transform.ts) declares `Is Transferred`, `Mother Tongue`, `Disability Type` as recognized columns on `IemisRow` ([lines 62-64](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L62-L64)) but the DTO builder ([lines 240-258](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L240-L258)) never maps them to `Student.isTransferred`, `Student.motherTongueDescriptor`, `Student.disabilities`. Result: 204/206 of Saraswati's imported records have these fields null. The 2 outliers (Aatif + Sahid) were almost certainly manually edited via the EditStudent UI post-import. Also: `Student.sexDescriptor` is derivable from `Gender` (1-liner) but isn't computed. These fields are required for the Phase F C10 IEMIS submission. **This is the highest-impact finding.**
2. **Validation warnings fired but are operator-invisible.** The transformer correctly emits warnings for cross-school EMIS-ID prefixes ([lines 131-138](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L131-L138)), combined-band `ECD/PPC` placement ([lines 188-197](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L188-L197)), placeholder phones, single-token names, and other quirks ([§"Quirks handled" header in the transform file](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L14-L25)). All findings land in `IemisImportJob.findings[]` (capped at 500/job, stored in DDB). **There is no LIST endpoint to enumerate import jobs**, so an operator who imports a batch and walks away can never see the warnings unless they save the jobId from the upload response. Today's 5 batches almost certainly produced findings (the 2 cross-school EMIS IDs alone should have triggered the warning), but they are locked behind unreachable jobIds.
3. **4 records have impossible DOBs vs grade** (1–2 year olds in Grades 1–2 — see §6b). Operator-fixable via PATCH; these are XLSX data-entry errors, not a system issue.

What is NOT an issue:
- Only 4 of 14 grades populated — the principal is uploading **per-grade batches**. This is the intended operator workflow, supported by the 1000-row/call API design. The 9 unimported grades simply haven't been uploaded yet.
- `currentGradeLevel` stored as `"1"`/`"2"`/`"8"`/`"10"` — this is the internal canonical code per [`normalizeGradeLevel`](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L296-L315). Ed-Fi descriptor form (`FirstGrade`, etc.) is the *external export* representation reserved for Phase F C10. These coexist by design.
- Per-batch guardian/contactInfo variance — operator-side XLSX completeness varies between files. The transformer correctly handles missing parent names (treats `"Na"`/`"NA"`/`"na"` as null per the file header at [line 18](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L18) and `cleanNullish`).
- Cross-school EMIS IDs on 2 students — almost certainly transferred-in students keeping their previous EMIS ID. The transformer fires a warning ([line 131-138](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L131-L138)); CEHRD policy decision determines whether to re-issue or retain.

---

## Evidence (all read-only, prod, 2026-05-19 ~14:50 UTC)

API base: `https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod`. JWT carried `custom:tenantId=34f49822-…`, `custom:userRole=TenantAdmin`. All raw responses saved at `/tmp/saraswati-iemis-review/` for replay.

### 1. School + AY state

`GET /schools?tenantId=34f49822-…` →

| Field | Value |
|---|---|
| schoolId | `61a247a4-44d6-4fc0-a414-062fd4d7e694` |
| name | Shree Saraswati Secondary English Boarding School |
| emisSchoolCode | `170840012` |
| gradeRange | PK → 10 |
| `gradeLevels` enum | `EarlyChildhoodDevelopment, PrePrimaryClass, Prekindergarten, Kindergarten, FirstGrade, …, TenthGrade` (14 entries, Ed-Fi descriptor form — for export) |
| status | active |
| timezone / locale / calendar | `Asia/Kathmandu` / `ne-NP` / `bikram_sambat` |
| createdAt → updatedAt | 2026-04-23 → 2026-05-18 21:46 UTC |

`GET /schools/.../academic-years` → 1 AY:

| Field | Value |
|---|---|
| yearId | `aa08592b-5202-4cf2-96f9-dd5e8455f4b6` |
| name | 2026-2027 (BS 2083/01/15 → 2083/12/30) |
| status / isCurrent | active / **true** |
| createdAt → updatedAt | 2026-05-18 12:01 → 21:45 UTC |

### 2. Imported student count

`GET /academics/students?schoolId=…&limit=1000` → **206 items, `hasMore: false`**.

### 3. Auto-enrollment

`GET /academics/schools/.../years/.../enrollments/summary` →

```json
{
  "totalEnrolled": 206,
  "byGradeLevel": { "1": 57, "2": 75, "8": 48, "10": 26 },
  "byStatus": { "enrolled": 206, "pending": 0, "withdrawn": 0,
                "graduated": 0, "transferred": 0 }
}
```

1:1 student-to-enrollment ratio. **All 206 students are auto-enrolled** — the operator used the "Enroll all into AY" checkbox successfully (per memory `project_sprint_C4_async_import_shipped`).

### 4. Import batches (per-grade, principal's intended workflow)

Five distinct batches today, **one per grade** — exactly the workflow the principal described:

| Batch | Time (UTC) | Grade | N | NoGuardian | NoContact | NoDescriptors |
|---|---|---|---|---|---|---|
| #1 | 04:45 | 10 | 26 | 0 (0%) | 26 (100%) | 26 (100%) |
| #2 | 05:46 | 1 | 57 | 0 (0%) | 0 (0%) | 56 (98%) |
| #3 | 05:55 | 2 | 50 | 10 (20%) | 26 (52%) | 50 (100%) |
| #4 | 05:56 | 2 | 25 | 2 (8%) | 10 (40%) | 25 (100%) |
| #5 | 12:12 | 8 | 48 | 21 (44%) | 40 (83%) | 47 (98%) |
| | **total** | **5 batches → 4 grades** | **206** | **33 (16%)** | **102 (50%)** | **204 (99%)** |

All 206 share a single `createdBy: 41136dda-a0e1-7083-7cb2-985af50d8280` — the operator's Cognito sub.

Batches #3 + #4 are one grade-2 upload (75 students) where the worker's parallel dedup batches (size 20) + create batches (size 10) caused row insertion to cross the 05:55 → 05:56 minute boundary. Not two separate uploads.

The remaining grades (ECD, PPC, PK, K, 3, 4, 5, 6, 7, 9) **haven't been uploaded yet** — this is expected work in progress.

### 5. Field completeness across all 206 records

| Field | % present | Source in XLSX | Notes |
|---|---|---|---|
| `emisStudentId` | 100.0% | `Student Id` | all 206 unique, no GSI7 dedup hits |
| `firstName` / `lastName` | 100.0% | `FullName` (last-space split) | per [splitFullNameLastSpace](../../../server/application/microservices/academics/src/common/utils/import-normalize.ts) |
| `dateOfBirth` | 100.0% | `DOB` (BS → Gregorian) | per [parseBsDate](../../../packages/shared-types/src/utils/bikram-sambat.ts) |
| `gender` | 100.0% | `Gender` (`M`/`F`/`Male`/`Female` → enum) | per [normalizeGender](../../../server/application/microservices/academics/src/common/utils/import-normalize.ts) |
| `currentGradeLevel` | 100.0% | `CurrentClass` (numeric or `ECD`/`PPC`) | internal canonical code per [normalizeGradeLevel:296](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L296) |
| `studentNumber` | 100.0% | (generated by server) | `SSSEB-2026-00001` → `SSSEB-2026-00206`, sequential, zero gaps |
| `guardians` | 84.0% | `Father Name` + `Mother Name` + `Guardian Name` | 33/206 missing — `Na`/`NA` literal treated as null per [transform header line 18](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L18) |
| `contactInfo.address` | 50.5% | `Permanent Address` + `Temporary Address` | 102/206 missing; `-null,` literal treated as null per [transform header line 17](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L17) |
| `sexDescriptor` | **1.0%** (2/206) | **derivable from `Gender`, not computed** | engineering gap — see Finding 1 |
| `languageDescriptor` | **1.0%** (2/206) | no IEMIS column | manually set via UI; 2 records edited post-import |
| `motherTongueDescriptor` | **1.0%** (2/206) | **`Mother Tongue` column, transformer drops** | engineering gap — see Finding 1 |
| `isTransferred` | **1.0%** (2/206) | **`Is Transferred` column, transformer drops** | engineering gap — see Finding 1 |
| `belowPovertyLine` | **1.0%** (2/206) | no IEMIS column | manually set via UI; 2 records edited post-import |
| `disabilities` | **0.0%** | **`Disability Type` column, transformer drops** | engineering gap — see Finding 1 |

### 6. Specific data anomalies

#### 6a. 2 students carry emisStudentIds with non-Saraswati school prefix

| Student | Grade | emisStudentId | School prefix | Notes |
|---|---|---|---|---|
| Priti Kumari Sah | 10 | `1703300057400030` | `170330005` (≠ Saraswati's `170840012`) | Different Dhanusha school |
| Pushp Kumar Singh | 2 | `1710000118200009` | `171000011` (≠ Saraswati's `170840012`) | Different school entirely |

**The transformer correctly warned on both** ([iemis-transform.ts:131-138](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L131-L138)). The warning is stored in the import job's `findings` array. **It's not surfaced to the operator anywhere** because (a) there's no jobs LIST endpoint, (b) the import UI doesn't display warning findings prominently (TBD — needs frontend audit), and (c) the warnings don't carry to the Student detail page.

These are almost certainly **transferred-in students who retained their original schools' IEMIS IDs**. CEHRD policy decision required: re-issue Saraswati-scope IDs on transfer, OR officially accept retained cross-school IDs.

#### 6b. 4 records have impossible DOBs vs grade

| Student | Grade | DOB | Age at AY start (2026-04-28) |
|---|---|---|---|
| Aatif Ansari | 1 | 2025-05-19 | **~11 months old** |
| Aarav Purbe | 2 | 2024-04-14 | ~2 years |
| Aayush Paswan | 2 | 2024-04-24 | ~2 years |
| Khusi Mahara | 2 | 2024-05-11 | ~2 years |

These are XLSX data-entry errors. Note Aatif's DOB is *exactly* 1 year before his import date — a likely off-by-one-year typo or an XLSX cell auto-filling with today's date in some locales. Operator-fixable via PATCH on the EditStudent UI.

### 7. The unreachable evidence

`GET /academics/students/import/iemis/jobs/{jobId}` requires a jobId, and **no LIST endpoint exists** to enumerate jobs for a school / tenant. Today's 5 jobIds are present in DDB but unreachable via JWT alone. Without them, I can't see:

- The exact `totalRows` submitted vs. `studentsCreated` vs. `failed` vs. `skipped` for each batch
- Per-row `findings` (validation warnings + errors) — this is where the 2 cross-school-EMIS warnings live
- `duplicates` array (GSI7 matches that were skipped)
- `durationMs` and any partial-failure error summaries

This is the **single biggest evidence gap** in this review. Everything in this document is reconstructed from final state; the source-of-truth job rows would have given me ground-truth row counts and validation findings.

### 8. IEMIS audit log — not used by the import path

`GET /iemis/audit?limit=100` → `{ "items": [], "hasMore": false }`. The `IemisAuditLogger` (per memory `project_iemis_sprint_1_uat`) is wired for `verify-school-code` queries and `audit.viewed` events only. The student-import path lives in `academics`, not `identity`, and uses generic `auditedWrite()` plus the academic-domain event bus. Today's 5 imports left zero footprint on the IEMIS audit surface the operator UI shows.

---

## Findings (grounded against code)

### Finding 1 — IEMIS XLSX columns dropped at the transform layer (HIGHEST IMPACT)

[`iemis-transform.ts:47-68`](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L47-L68) declares 20 IEMIS columns including `Is Transferred`, `Mother Tongue`, `Disability Type`. The DTO builder at [`lines 240-258`](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L240-L258) writes only `firstName, lastName, dateOfBirth, gender, schoolId, currentGradeLevel, emisStudentId, guardians, contactInfo`. Three IEMIS columns are silently dropped at transformation time.

Additionally:
- `Student.sexDescriptor` is **derivable** from `gender` (`'male'` → `'uri://ed-fi.org/SexDescriptor#Male'`; `'female'` → `'uri://ed-fi.org/SexDescriptor#Female'`) but the transformer doesn't compute it.
- `Student.languageDescriptor` has no IEMIS source column. For PABSON, a tenant-default of `uri://ed-fi.org/LanguageDescriptor#Maithili` (or whichever is the school's `WorkspaceSettings.regional.locale`) would be sensible; or leave it null until UI edit.
- `Student.belowPovertyLine` has no IEMIS source column. Manual UI edit only.
- `Student.scholarshipCategory` (seen in [students.service.s3-7.spec.ts:169](../../../server/application/microservices/academics/src/students/students.service.s3-7.spec.ts#L169)) — no IEMIS column. Manual UI edit only.

**Impact:** IEMIS submission (Phase F sprint C10) needs `sexDescriptor`, `motherTongueDescriptor`, `isTransferred`, `disabilities` populated for IEMIS-compliant CSV output. Today 99% of records are null on these. Either the transformer is extended (5-line change for each mapped column) or the operator must manually edit 200+ records before submission.

**Fix:**

```typescript
// In transformIemisRow, alongside the existing field extractions:
const motherTongueRaw = cleanNullish(row['Mother Tongue']);
const isTransferredRaw = cleanNullish(row['Is Transferred']);
const disabilityRaw = cleanNullish(row['Disability Type']);

// In the DTO build at line 240+:
const dto: CreateStudentDto = {
  firstName, lastName: lastName || firstName,
  dateOfBirth, gender: gender!, schoolId: opts.schoolId,
  currentGradeLevel,
  emisStudentId: emisStudentId!,
  sexDescriptor: gender === 'male'
    ? 'uri://ed-fi.org/SexDescriptor#Male'
    : 'uri://ed-fi.org/SexDescriptor#Female',
  motherTongueDescriptor: motherTongueRaw
    ? mapMotherTongueToEdFi(motherTongueRaw)
    : undefined,
  isTransferred: isTransferredRaw === 'Yes' || isTransferredRaw === 'true',
  disabilities: disabilityRaw && disabilityRaw !== 'None'
    ? [mapDisabilityToEdFi(disabilityRaw)]
    : undefined,
  // ...guardians, contactInfo as before
};
```

Plus the two mappers (`mapMotherTongueToEdFi`, `mapDisabilityToEdFi`) — small lookup tables grounded in the Ed-Fi `LanguageDescriptor` and `DisabilityDescriptor` namespaces.

**One-shot backfill on Saraswati's 206 records:** re-import the 5 grade XLSX files post-fix; the GSI7 dedup will skip every existing row but emit `existingStudentId` in `duplicates[]`; then a follow-up script updates the existing records with the new mapped fields. Or, more surgically, the transformer-extension PR ships a `scripts/backfill-iemis-derived-fields.ts` that reads Saraswati's existing rows + the original XLSX side-by-side and PATCHes the missing fields.

### Finding 2 — Operator can't see validation warnings

The transformer DOES validate. It warns on:

- Cross-school EMIS ID prefix ([line 131-138](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L131-L138)) — both Priti + Pushp triggered this
- Combined-band `ECD/PPC` placement ([line 188-197](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L188-L197))
- Single-token name → `lastName = firstName` fallback ([line 144-150](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L144-L150))
- Placeholder phone `"123"` ([line 211-213](../../../server/application/microservices/academics/src/students/iemis-transform.ts#L211-L213))

All warnings land in `IemisImportJob.findings[]` in DDB. There is no path to see them after the import UI is closed:

- No LIST endpoint for jobs (engine gap)
- The import UI may show warnings during the polling window — needs frontend audit to confirm — but does NOT show them on revisit / refresh / a new browser tab (warnings live on a job row, not on the Student)
- The Student detail page has no "imported with warnings" indicator
- The IEMIS audit log (`GET /iemis/audit`) doesn't capture import events

For Saraswati specifically: today's 2 cross-school-EMIS warnings (Priti + Pushp) are **almost certainly logged** in their respective batches' job rows, but no operator can reach them without the jobId. Same goes for any single-token-name fallback warnings, placeholder-phone warnings, etc.

**Impact:** Operator silently loses validation findings. The transformer is doing the work; the rest of the stack throws the work away.

**Fix:** ENG-1 below — add the jobs LIST endpoint. Plus a smaller frontend story: surface a per-school "Recent import jobs" widget that links to each job's findings.

### Finding 3 — Operator-side XLSX data errors

| # | Issue | Records | Operator action |
|---|---|---|---|
| 3a | Cross-school EMIS IDs (likely transferred-in students) | 2 (Priti, Pushp) | CEHRD policy: re-issue or retain |
| 3b | Impossible DOBs (1–2 year olds in Grades 1–2) | 4 (Aatif, Aarav, Aayush, Khusi) | PATCH via EditStudent UI |
| 3c | 102/206 missing `contactInfo.address` | depends on XLSX | optional; XLSX shape varies per grade file |
| 3d | 33/206 missing `guardians` | depends on XLSX | optional; some students may have only a single non-parent guardian |

These are not engine issues. The transformer handles each correctly; the data going *in* has gaps the operator can decide to fill.

---

## Action items

Categorized by owner.

### Operator (Saraswati admin)

| # | Item | Effort |
|---|---|---|
| OP-1 | Continue per-grade XLSX uploads for the remaining 10 grades (ECD, PPC, PK, K, 3, 4, 5, 6, 7, 9) | Per-grade XLSX upload via existing UI |
| OP-2 | Fix the 4 impossible DOBs (Aatif, Aarav, Aayush, Khusi — see §6b) via EditStudent UI | 5 minutes |
| OP-3 | With CEHRD: decide policy for transferred-in EMIS IDs (re-issue vs retain). If retain, accept the 2 cross-school IDs (Priti, Pushp) as-is. If re-issue, edit both records | Operator + CEHRD policy check |
| OP-4 | **Once ENG-2 ships:** re-import the 5 existing XLSX files to populate `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor` on the 206 existing students — or wait for the backfill script | 1h re-upload OR 0min wait for script |

### Engineering — prioritized

| # | Item | Size | Priority | Justification |
|---|---|---|---|---|
| **ENG-1** | **Add `GET /academics/students/import/iemis/jobs?schoolId=…&since=…&limit=…` LIST endpoint.** Returns paginated `IemisImportJob` rows; threeway handoff (Nest controller + `tenant-api-prod.json` + nginx if new prefix — no new prefix in this case). | Small (~80 LOC + tests + route registration) | **High** | Without this, every validation finding is invisible to the operator. Saraswati's import today produced findings (at minimum the 2 cross-school warnings) that no one can see. This blocks Finding 2 closure and severely limits post-hoc review. |
| **ENG-2** | **Extend `transformIemisRow` to map the 3 dropped columns + derive `sexDescriptor`.** Map `Mother Tongue` → `motherTongueDescriptor`, `Is Transferred` → `isTransferred`, `Disability Type` → `disabilities`. Derive `sexDescriptor` from `gender`. Two small lookup tables for the descriptor URIs (Ed-Fi `LanguageDescriptor` + `DisabilityDescriptor`). Plus a `scripts/backfill-iemis-derived-fields.ts` one-shot to update Saraswati's 206 existing records. | Small (~150 LOC including spec updates + backfill script) | **High** | Phase F C10 IEMIS submission needs these. Operator-fix path (PATCH on 200+ records) is unreasonable. |
| ENG-3 | **Wire student-import events to operator-facing audit.** Either route academics-side import events through `IemisAuditLogger` so they appear in `GET /iemis/audit`, OR add a `GET /academics/students/imports/recent` per-school history view in AdminWeb / Tenant Operator UI. (Becomes trivial once ENG-1 ships — likely the same endpoint.) | Small | Medium | Operator-facing audit visibility for IEMIS imports. |
| ENG-4 | **Frontend audit: are warnings displayed during the import polling window?** The UI polls the job row every 2s; on terminal state, does it render `findings` and `duplicates`? Audit the import UI in `edforge-saas-frontend/apps/academics/src/.../IemisImport*`. If not displayed prominently, add a "review N findings before closing" affordance. | Small | Medium | Backstop for ENG-1: even if operator forgets to revisit, they should see findings live. |

### Backlog (after Phase D)

| # | Item |
|---|---|
| BL-1 | Janitor Lambda to detect IEMIS import jobs stuck in `running` (in-process worker means an ECS task restart mid-import leaves the job row hung). Mentioned in [`students.controller.ts`](../../../server/application/microservices/academics/src/students/students.controller.ts) as planned post-pilot. |
| BL-2 | XLSX template documented + versioned in `docs/pilots/<archetype>/iemis-xlsx-template-v1.md`. Today the recognized columns are implicit in `IemisRow` interface. A strict template alongside an importer that validates column headers before processing rows would surface XLSX-shape issues at upload time, not 500ms later. |

---

## What worked well

It is easy to dwell on the gaps above. Things that demonstrably worked:

- **The principal's per-grade upload workflow.** 5 separate uploads, each grade-scoped, all completed cleanly. This is exactly how the system is designed to work — 1000-row cap per call, async processing, GSI7 dedup, auto-enrollment optional.
- **C4 async-import path end-to-end.** POST→202+jobId → background worker → all 206 rows committed → final state observable.
- **Auto-enrollment via the "Enroll all into AY" checkbox.** 206 students → 206 enrollments, all `status=enrolled`. Saved the operator 206 manual clicks.
- **The 779-row Saraswati incident retro applied.** [students.service.ts:1420-1436](../../../server/application/microservices/academics/src/students/students.service.ts#L1420-L1436) documents the prior STS-per-call timeout incident and the fix (one shared client). Today's batches all completed in tens of seconds — no 504s, no Vercel-proxy timeouts.
- **Idempotency / dedup via GSI7.** Zero false-positive duplicates across 206 imports. The dedup phase functioned.
- **`studentNumber` generation.** Sequential `SSSEB-2026-00001` → `SSSEB-2026-00206` with zero gaps across five concurrent batches. The per-tenant sequence handled the concurrency.
- **No 5xx surfaced.** Every student created OK; every enrollment created OK. No partial-failure recovery was needed.
- **Transform-layer validation is grounded.** [`iemis-transform.ts`](../../../server/application/microservices/academics/src/students/iemis-transform.ts) carries explicit handling for: BS date variants, whitespace, `-null,` literals, `Na`/`NA` parent names, placeholder phones, mixed-case names, compound Nepali names (last-space split), `ECD/PPC` combined band, and gender variants. Each is documented at the file header with a tie to the specific incident or sprint that surfaced it (P0.2, P0.5, P0.9, BUG-S7). This is exactly the kind of grounded engine work the pilot needs.

The transform is doing real work. The end-to-end pipeline is solid. The visible gaps are (a) one feature-completeness item on column mapping (ENG-2) and (b) one operator-experience item on findings visibility (ENG-1).

---

## Evidence files

Local working dir: `/tmp/saraswati-iemis-review/` (do not commit; tenant-scoped data).

| File | Source |
|---|---|
| `01-schools.json` | `GET /schools?tenantId=…` |
| `02-academic-years.json` | `GET /schools/{schoolId}/academic-years` |
| `03-students-page1.json` | `GET /academics/students?schoolId=…&limit=1000` |
| `04-enrollments.json` | `GET /academics/enrollments?…` (404 — wrong path) |
| `05-enrollments.json` | `GET /academics/schools/{schoolId}/years/{yearId}/enrollments` |
| `06-enrollment-summary.json` | `GET /academics/schools/{schoolId}/years/{yearId}/enrollments/summary` |
| `07-iemis-audit.json` | `GET /iemis/audit?limit=100` (empty) |
| `08-student-{8charprefix}.json` | `GET /academics/students/{id}/profile` × 4 samples |

Source code reviewed: [`iemis-transform.ts`](../../../server/application/microservices/academics/src/students/iemis-transform.ts), [`students.service.ts`](../../../server/application/microservices/academics/src/students/students.service.ts) §`executeIemisImportAsync` (line 1534+) + §`importStudentsIemis` (line 1390+), [`students.controller.ts`](../../../server/application/microservices/academics/src/students/students.controller.ts).

JWT validity: `exp=1779205690` (~2h), Cognito user pool `ap-south-1_spYeNvNJt`, role `TenantAdmin`. JWT not committed.

---

## Revision history

- **2026-05-19 (v2):** Rewritten after reading [`iemis-transform.ts`](../../../server/application/microservices/academics/src/students/iemis-transform.ts) end-to-end. Removed three incorrect findings from v1 ("only 4 grades imported", "currentGradeLevel format mismatch", "validation warnings missing"). Added grounded root causes from code for the remaining two real findings (column-mapping gap + operator-invisible warnings). Reframed grade-level batching as the principal's intended workflow.
- **2026-05-19 (v1):** Initial review based on data-state reconstruction only; subsequently corrected after operator + code review.

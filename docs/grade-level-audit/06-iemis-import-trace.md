---
title: 06 — IEMIS Import Trace
status: Done — captures + code-trace complete
date: 2026-05-08
fixture: /Users/shoaibrain/edforge/iemis-grade-audit-fixture-201-rows.xlsx (201 rows = header + 200 students, Saraswati-shape CEHRD synthetic data)
job: 9abdfc8f-f3a7-4364-b548-69d0953d3... → 200 created, 200 enrolled, 0 skipped, 0 failed, 28 findings, 43.2s
---

# IEMIS Import Trace

The IEMIS Bulk Student Import is the **load-bearing data-onboarding path** for Nepal pilots. This is the audit's first end-to-end run on a clean tenant. The import succeeded; the pipeline has correctness wins (Sprint C3 ECD/PPC fix is live, Sprint C4 async + dedup work) but also several robustness, audit, and Ed-Fi-alignment gaps that matter at pilot scale.

## Captured artifacts

- Job summary — [artifacts/C-iemis-import-A/01-network/import-job-summary.json](artifacts/C-iemis-import-A/01-network/import-job-summary.json)
- Fixture xlsx — `/Users/shoaibrain/edforge/iemis-grade-audit-fixture-201-rows.xlsx` (operator-built; not committed — contains synthetic PII patterns)

## End-to-end pipeline (controller → worker → write)

```
┌──────────────────┐
│  Wizard upload   │  user picks xlsx
│   xlsx parser    │  client-side parse via SheetJS
└────────┬─────────┘
         │ JSON {students:[{S.N,IEMIS Code,...,CurrentClass,DOB,...},...]}
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ POST /api/academics/students/import/iemis                        │
│ students.controller.ts:241-330                                   │
│   • RBAC: @RequirePermission(students:create)                    │
│   • cap: 1000 rows/request (line 292)                            │
│   • dryRun=false → write IEMIS_JOB row (queued)                  │
│   • setImmediate(() => executeIemisImportAsync(...))             │
│   • return 202 + jobId                                           │
└────────┬─────────────────────────────────────────────────────────┘
         │ jobId   (UI polls /jobs/<jobId> every 2s)
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ executeIemisImportAsync()  students.service.ts:1534-1732         │
│   • markRunning()                                                │
│   • per row: transformIemisRow() → CreateStudentDto + findings   │
│   • batch GSI7 lookup for emisStudentId dedup (line 1617)        │
│   • Student write: batches of 10 (line 1645)                    │
│   • Enrollment write: inline if enrollInAcademicYearId set       │
│     (line 1668 → enrollment.service.ts:319-457)                  │
│   • markCompleted() / markFailed()                               │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ DDB writes (edforge-academics-basic, partition TENANT#<tid>)     │
│   • STUDENT#<studentId>           student.entity.ts:6-7          │
│   • ENROLLMENT#<schoolId>#<yr>#<sid>  enrollment.entity.ts:6     │
│     GSI1SK = ENROLLMENT#<yr>#<gradeLevel>  ← internal code       │
│   • IEMIS_JOB#<jobId>             iemis-import-job.entity.ts:42  │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│ EventBridge events                                               │
│   • StudentCreated   (line 267 students.service.ts)              │
│   • EnrollmentCompleted (line 409 enrollment.service.ts)         │
│   • Non-blocking (.catch() logged); no DLQ visible at this layer │
└──────────────────────────────────────────────────────────────────┘
```

## What works

### 1. ECD/PPC combined-band normalization is live (Sprint C3.T1)

The fixture contains rows like row 10 (`"CurrentClass":"ECD/PPC"`, Aaditya Kumar Yadav, age 5) and rows 20, 40, 44, 49, 52 with the same combined-band token. After import, the Academics dashboard chart renders **only an ECD bucket — no PPC bucket**. This is empirical confirmation that `normalizeGradeLevel('ECD/PPC')` returns `'ECD'` and emits a per-row warning at [iemis-transform.ts:188-196](../../server/application/microservices/academics/src/students/iemis-transform.ts#L188).

### 2. Idempotency on `emisStudentId` works

GSI7 dedup at [students.service.ts:1622](../../server/application/microservices/academics/src/students/students.service.ts#L1622) (`findByEmisStudentId`) means re-uploading the same xlsx produces `0 created, 0 enrolled, 200 skipped (duplicates)`. The fixture's deterministic Student Ids (`8888888888000841`, `8888888888001094`, ...) survive idempotency.

### 3. Async + polling pattern (Sprint C4)

The UI does not block. Operator can close the tab; the job runs server-side. Job state is durable (DDB row at `IEMIS_JOB#<jobId>`). 43.2s for 200 rows = ~217ms/row including Student + Enrollment writes — acceptable for current scale.

### 4. Optional enrollment in current AY (Sprint C4)

The "Enroll all into AY" UX (`enrollInAcademicYearId` flag) saves the operator from 200 manual enrollment clicks. Confirmed via the captured `200 enrolled in 2083-academic-year` summary. Each enrollment writes an `Enrollment` row with `GSI1SK = ENROLLMENT#<yearId>#<gradeLevel>` where `<gradeLevel>` is the **internal code** post-normalize (`'1'`, `'2'`, ..., `'ECD'`).

### 5. CSV findings export — RFC 4180 compliant

Findings download CSV escapes `,` / `"` / newline correctly per [iemis-findings-export.ts:49-65](../../server/application/microservices/academics/src/students/iemis-findings-export.ts#L49). A row whose `FullName` is `=cmd|'/c calc.exe'!A0` lands quoted in the CSV — Excel's formula execution still depends on the operator's preview behavior, but the exporter is not the vulnerability.

### 6. The 28 findings (educated decomposition)

Without the actual findings CSV in hand, the agent's pattern analysis on the fixture predicts:

| Category | Source code | Estimated count from fixture |
|---|---|---|
| `ECD/PPC` combined-band normalize warning | iemis-transform.ts:188-196 | ~6 (rows 10, 20, 40, 44, 49, 52) |
| Single-name fallback (no last name) | line 144-150 | ~5 (rows where FullName is one token) |
| Placeholder phone (`123`, `9825...`) cleaned to null | line 211-214 | ~10 (rows with `Guardian Contact Number: 123`) |
| Address sentinel `-null,` cleaned silently | line 232-233 | 0 (no warning emitted) |
| Missing parent / `Father Name: Na` cleaned to null | line 206-207 | 0 (silent) |
| Mismatched IEMIS school code | line 132-138 | 0 (fixture matches school's emisSchoolCode `888888888`) |

**Sum: ~21 findings projected. Captured count: 28.** The 7-row gap is likely accounted for by rows where multiple warnings stacked (e.g. ECD/PPC + single-name + placeholder phone in the same row).

**To fully reconcile,** download the findings CSV via the UI and inventory it. Action item for the operator.

## What concerns me (ranked by pilot risk)

### A. In-process worker is fragile (HIGH)

`executeIemisImportAsync` runs via `setImmediate()` in the same NestJS process as the HTTP handler. If the ECS task is killed mid-import (deploy, OOM, ALB drain, autoscaling event), the job row stays `running` **forever**. There is no janitor cron, no DLQ, no retry. The jobs-service file [iemis-import-jobs.service.ts:15-18](../../server/application/microservices/academics/src/students/iemis-import-jobs.service.ts#L15) explicitly acknowledges this as a post-pilot follow-up.

**At 200 rows / 43s, this risk is small. At 5000 rows / ~18 min, the risk window is much larger** — and Saraswati's first import is in that range (778 students). A redeploy during a Saraswati import would require manual recovery (find the orphan row, delete or mark failed, reimport against dedup). **Saraswati has already been imported; this risk is forward-only.**

**Mitigation paths:**
- (Cheap) Add a sidecar Lambda + EventBridge cron that scans for `running` job rows older than 30 minutes and marks them `failed` with reason `"task-killed"`. Operator re-uploads (dedup catches duplicates).
- (Right answer) Move worker to SQS-triggered Lambda. Job row update is the visibility contract; ECS doesn't need to be alive after returning the 202.

### B. Cross-school-within-tenant write is possible (MEDIUM)

`Current School` field in each row is **not validated against the tenant's school list**. The controller accepts a `schoolId` from the request body; the row's `Current School` string is not cross-checked. An operator with `students:create` on Tenant A could pass `schoolId = X` while the rows say `"Current School": "School-Y-of-Tenant-A"` and 200 rows would land in School X. This is a "shoot the operator's own foot" bug, not a cross-tenant exfiltration (DDB partition guards that), but it is a data-integrity hazard: students whose `IEMIS Code` belongs to one school become enrolled in a different school's roster.

**Mitigation:** Resolve school by `(tenantId, emisSchoolCode)` from the row's `IEMIS Code`, compare to the controller's `schoolId`, reject the row if they disagree. Add a `IEMIS_SCHOOL_MISMATCH` finding category.

### C. Bulk Student creates lack explicit audit-table rows (MEDIUM)

Per the audit-logger code at [iemis-audit-logger.service.ts:42-89](../../server/application/microservices/academics/src/students/iemis-audit-logger.service.ts#L42), audit rows are emitted on **descriptor PATCH** (Sprint S3.7), not on bulk-import Student creates. Reconstructing "operator X imported 200 students at timestamp Y from xlsx Z" requires:

1. Find the IEMIS_JOB row (carries `createdBy` and timestamps).
2. Cross-reference with EventBridge `StudentCreated` events by `correlation-id` (which IS preserved on the event payload — confirmed in [academics-events.service.ts:14-22](../../server/application/microservices/academics/src/dashboard/events/academics-events.service.ts#L14)).
3. The xlsx file itself is not retained anywhere on the server side. Only the parsed JSON request body is in transit; not stored.

**For a CEHRD compliance / safeguarding investigation, this is workable but indirect.** The right answer is an `IEMIS_IMPORT_AUDIT` row per import that captures: who, when, file-name, row-count, school, AY, jobId, optional file-hash. That row makes audit lookup O(1) instead of O(events).

### D. Ed-Fi descriptor URIs not populated on import (MEDIUM)

`Enrollment.gradeLevel` is stored as **internal code** (`'1'`, `'ECD'`). The Ed-Fi v6 `StudentSchoolAssociation` entity carries `entryGradeLevelDescriptor`, `entryTypeDescriptor`, `exitWithdrawTypeDescriptor` URIs. The Enrollment entity at [enrollment.entity.ts](../../server/application/microservices/academics/src/common/entities/enrollment.entity.ts) declares these fields but **does not populate them** on the import path (per `createEnrollmentForImport` at line 359-383).

Operator must manually `PATCH /descriptors` post-import (Sprint S3.7 endpoint) to enable Flash I / Flash II CEHRD reporting via Ed-Fi. **This is the gap that makes EdForge "Ed-Fi-shaped at write but Ed-Fi-empty at read"** — outbound exports work because the export mappers at [education-org.mapper.ts](../../packages/shared-types/src/mappers/edfi/education-org.mapper.ts) translate at serialize-time, but the in-DB representation is internal-codes-only.

**This is a strategic question for product:** is the goal "Ed-Fi as outbound serialization format" (current state) or "Ed-Fi as native data model" (Saraswati onboarding to CEHRD Flash via direct API would benefit). T4 takes this up in detail.

### E. The 1000-row hard cap (LOW for pilot, MEDIUM for second tenant)

A request with > 1000 rows is rejected at the controller. Saraswati's 778 students fit. A second pilot at a 2000-student secondary school would need to chunk the upload. The cap exists because the request body size (200 rows = ~80KB; 5000 rows = ~2MB) eventually trips API Gateway's 10MB limit. Long-term answer is presigned-S3 upload + S3-trigger Lambda — same as B's mitigation.

### F. No backpressure on dedup (LOW)

The dedup loop does N batch lookups against GSI7 in serial (per the agent's reading). At 5000 rows, this is `5000/25 = 200` BatchGetItem calls. DDB on-demand pricing absorbs cost; the latency penalty is bounded. Not a blocker for pilot.

## What this means for the next pilot tenant

**Saraswati already onboarded** during Sprint C3 cleanup — the 778-student import landed before this audit started. The orphan-running-job risk did not materialize for Saraswati (per memory `project_sprint_C4_async_import_shipped.md`).

**For the second non-Saraswati pilot tenant**, the priority gates are:

1. ☑ ECD/PPC normalize (live).
2. ☑ Async + polling (live).
3. ☑ Optional AY enrollment (live).
4. ⏳ Janitor cron / SQS migration for orphan-running-job recovery — **add before next pilot**.
5. ⏳ `IEMIS Code` row-vs-school cross-validation — **add before next pilot if multi-school tenants are in scope**.
6. ⏳ `IEMIS_IMPORT_AUDIT` row per import — **add for any tenant with safeguarding obligations** (PABSON members in CEHRD reporting framework all qualify).

## Verification checks (pending DDB read access)

1. `aws dynamodb query --table-name edforge-academics-basic --key-condition-expression "PK = :p" --expression-attribute-values '{":p":{"S":"TENANT#21aea5da-511f-4dfa-a6f2-6971f63a719f"}}' --filter-expression "begins_with(SK, :s)" --expression-attribute-values-add '{":s":{"S":"STUDENT#"}}'` — count should be 200.
2. Same query with `:s = "ENROLLMENT#4209e3d8-d2e2-4e0e-9961-790341c264f4"` — count should be 200, every row's `gradeLevel` field should be one of `'1'..'12'`, `'ECD'`. **Specifically zero `PPC` if Sprint C3 normalize is correct.**
3. CloudWatch `academics-service` log group, filter `"normalizeGradeLevel"` for the import window. Should show ~6 ECD/PPC warnings.
4. Download the findings CSV from the UI and inventory the 28 entries by category.

## Verdict

The IEMIS pipeline correctly handles Nepal's CEHRD-shaped data **as long as nothing dies mid-flight**. Pre-pilot Saraswati landed without incident. The next pilot tenant should not ship without item 4 (orphan-job recovery) and should consider items 5 and 6 a soft requirement.

The Ed-Fi-descriptor question (item D) is a **product-strategy question, not a fix**. T4 carries it forward.

# IEMIS Integration Platform — Sprint Plan (final)

**Date:** 2026-04-23
**Author:** Claude, pair-programming with Shoaib; reviewed by critical-review sub-agent
**Status:** Final — decisions resolved, ready to implement
**Supersedes:** [iemis-emis-sprint-plan.md](./iemis-emis-sprint-plan.md) (v4 import-only plan — retained for history)
**Companion:** [iemis-import-post-mortem-and-emis-roadmap.md](./iemis-import-post-mortem-and-emis-roadmap.md)

---

## 1. Mission

Build EdForge as **IEMIS Reporting Middleware** for Nepal. Schools operate EdForge as their source of truth; EdForge generates the Flash I / Flash II / monthly xlsx files that CEHRD (Centre for Education and Human Resources Development) mandates via [iemis.cehrd.gov.np](http://iemis.cehrd.gov.np/). An import path exists for one-shot migration from IEMIS for new tenants. Saraswati English Boarding School is the pilot. Every design must scale to any Nepal school — private (PABSON), public (community), religious (Gumba/Madrasa), or higher-secondary (grades 11–12) — without per-tenant code changes.

## 2. Core product vision

> "Position EdForge as a 'Reporting Middleware.' Schools struggle with manual Excel upload. By automating generation of these files, we solve their biggest compliance headache while providing modern daily operations."

**Primary value:** the export pipeline. Import is a one-time bootstrap. Ongoing compliance (Flash I/II, monthly attendance, Staff, Infrastructure reports) is where EdForge earns renewal.

---

## 3. Non-negotiable architectural principles

1. **Ed-Fi-aligned internal model.** Every entity EdForge persists follows Ed-Fi 5.x. IEMIS is an input/output format; Ed-Fi is the internal language.
2. **Validate, don't synthesize.** If an entity referenced by an import row doesn't exist (AcademicYear, School), reject at dry-run with a link to the admin UI.
3. **Export-first mindset.** Every data-model decision is evaluated first against the question: *"Can this field be written out as an IEMIS column?"*
4. **Template-injection, NOT template-rendering.** CEHRD's IEMIS portal publishes official `.xlsm` files with embedded macros. The portal checks if uploaded files came from these official templates — a look-alike `.xlsx` generated from scratch gets rejected. EdForge MUST download the official blank CEHRD template, inject school data into specific cells using a library that preserves macros + formatting (ExcelJS on Node), and hand the pre-filled `.xlsm` back. Template versions shift year-over-year (cells move when CEHRD adds columns), so the engine is data-driven via a `TemplateMapping` document per (templateVersion, reportType).
5. **RBAC and audit are primitives, not retrofits.** `iemis.import`, `iemis.export`, `iemis.verify-code`, `iemis.view-audit` permissions and the `IemisAuditEvent` emit helper land in Sprint 1 so every downstream ticket consumes them at write-time.
6. **Nepal regulatory fit is non-negotiable.** Nepal Individual Privacy Act 2075 + FERPA + CEHRD Privacy Policy govern. Every student identifier (especially the 16-digit `emisStudentId`) is PII. Audit logs, exports, downloads treated as regulated data.
7. **Ambiguous columns defer to manual intervention.** Unmappable descriptor values → warning finding → empty field → operator edits manually post-import. Never guess.
8. **No production data to preserve.** Prod can be redeployed clean; Saraswati will be onboarded properly via the UAT dress rehearsal, then cleanly in prod. No backfill migrations. No redaction fixtures — UAT uses real Saraswati data behind auth.
9. **Feature-flag user-visible changes.** Rollback = DDB write, not redeploy.
10. **Real-Saraswati fixtures in every IEMIS-touching test.** Synthetic data misses Devanagari names, `"-"` for empty fields, extra spaces in caste strings, and BS-calendar edge cases. Real rows catch these.

---

## 4. Ed-Fi ↔ IEMIS entity mapping (glossary)

| EdForge name | Ed-Fi canonical | IEMIS touchpoint |
|---|---|---|
| Student | Student | 16-digit student ID (`emisStudentId`), demographics, attendance |
| StudentSchoolAssociation | StudentSchoolAssociation | Flash I/II enrollment row; entry/exit date; grade; exit-withdraw type |
| Contact | Contact (née Parent) | IEMIS guardian phone/name columns |
| School | School | 8-10 digit school code (`emisSchoolCode`), CEHRD-registered |
| SchoolYearType | SchoolYearType | BS academic year (2080, 2081, 2082, 2083…) |
| Section (backend) / Classroom (frontend) | Section | Roster assignments, schedule-linked |
| GradeLevelDescriptor | GradeLevelDescriptor | `uri://ed-fi.org/GradeLevelDescriptor#...` |
| LanguageDescriptor | LanguageDescriptor | Mother tongue (Nepali, Maithili, Bhojpuri, English…) |
| DisabilityDescriptor | DisabilityDescriptor | CEHRD disability categories |
| SexDescriptor | SexDescriptor | Male/Female/Other |
| **Staff** | Staff | Teacher name, qualifications, IEMIS staff ID |
| **StaffQualification** | StaffEducation (Ed-Fi) | Degree, institution, year, subject |
| **StaffTraining** | StaffProgramAssociation (Ed-Fi extension) | TPD hours, training topic, certificate |
| **SchoolInfrastructure** | (Ed-Fi extension namespace) | Building count, toilets (gendered + accessible), water, electricity, internet, library, lab, playground, earthquake-safety assessment |
| **StudentAssessment** | StudentAssessment | SEE, Class 10, Class 12 results |
| **StudentAssessmentSubject** | StudentAssessmentScoreResult | Per-subject marks / grade / GPA |
| **AcademicCalendarEvent (Holiday)** | CalendarEvent | Needed so monthly attendance denominator = working days |
| **EthnicityDescriptor (Nepal)** | (EdForge extension) | CBS janajati list (125+) |
| **DataSubjectRequest** | (EdForge extension) | Privacy Act 2075 §14 deletion / access requests |
| **IemisTemplate** | (EdForge extension) | Versioned blob of the official CEHRD .xlsm |
| **IemisTemplateMapping** | (EdForge extension) | Cell-level mapping for a (template, reportType) pair |
| **IemisAuditEvent** | (EdForge extension) | Append-only log of every IEMIS-scoped operation |
| **IemisImportJob / IemisExportJob** | (EdForge extension) | Async job state |

---

## 5. Ticket template (required for every downstream ticket)

Every ticket in this plan MUST fill the following block in its PR description:

```
**Scope:** <one-sentence goal>
**Touches:** <file paths>
**Depends on:** <ticket IDs, or "none">
**Feature flag:** <flag key or "N/A">

**Unit test:** <specific assertion, or "N/A — not testable at unit">
**Integration test:** <specific multi-component flow, or "N/A">
**Fixture test:** <real Saraswati xlsx row, or "N/A — no IEMIS data touched">
**Flag-off regression:** <asserts old path works when flag=false, or "N/A — no flag">
**Observability check:** <metric / log line / CloudWatch widget, or "N/A">
**Rollback:** <DDB flag flip | ECS task-def revert | CFN rollback — specify>
```

Every **IEMIS-touching** ticket (transformer, exporter, template mapping, import worker) MUST include a fixture test using real Saraswati data.

---

## 6. Sprint overview

Linear chain by default; parallelization points called out in §9.

| # | Sprint | Demoable outcome |
|---|---|---|
| **0** | Foundations *(implemented; awaiting commit + merge)* | Guardian-ID uuid fix, TanstackDataTable server pagination, atomic counter primitive, per-request identity cache, feature-flag helper, CLAUDE.md publish-gate checklist |
| **1** | IEMIS Identity, RBAC, Audit primitives | `emisSchoolCode` + `emisStudentId` first-class; `iemis.*` permissions and guards; `IemisAuditEvent` entity + emit helper; cross-tenant uniqueness constraints; format Zod validators |
| **2** | Ed-Fi descriptor catalog + resolver | Language, Disability, Sex, GradeLevel, ExitWithdrawType descriptor JSON catalogs; `resolveDescriptor` helper with alias support |
| **3** | Student demographics + StudentSchoolAssociation | `motherTongueDescriptor`, `disabilities[]`, `sexDescriptor`, `languageDescriptor`, `isTransferred` on Student; `StudentSchoolAssociation` Ed-Fi entity + service + GSI |
| **4** | Staff + StaffQualification + StaffTraining | Ed-Fi Staff with IEMIS staff ID; qualifications (degree / institution / subject); trainings (TPD hours / topic / certificate); teacher admin UI |
| **5** | SchoolInfrastructure + AcademicCalendar + Holidays | Infrastructure entity; holidays + calendar events; monthly attendance aggregator with working-day denominator |
| **6** | Nepal ethnicity / caste descriptor taxonomy (full 125+) | CBS janajati list as descriptor catalog; per-grouping URIs; Devanagari↔transliteration aliases |
| **7** | StudentAssessment + StudentAssessmentSubject | SEE / Class 10 / Class 12 results as Ed-Fi `StudentAssessment`; per-subject marks/grade/GPA |
| **8** | Async job primitive + IEMIS import pipeline | ECS Fargate worker + SQS FIFO + DLQ; `IemisImportJob` entity; S3 upload with size caps + AV scan + SSE-KMS; progress UI; history UI; DLQ operator alarm |
| **9** | **Template Mapping Engine (CEHRD template-injection)** | `IemisTemplate` registry in S3; `IemisTemplateMapping` documents; ExcelJS-based cell-injection renderer; transform library; IEMIS-2079 Flash I + Flash II templates + mappings loaded; SaaS-operator CLI to upload new templates |
| **10** | IEMIS Student export (Flash I + Flash II) | `IemisExportJob` entity; export worker that loads official template → injects data → returns macro-preserving `.xlsm`; signed URL download; round-trip test against real Saraswati data |
| **11** | IEMIS Staff + Infrastructure + Monthly Attendance export | Remaining report types via same engine; new templates registered, not new code |
| **12** | Compliance calendar + export reminders | `ComplianceEvent` entity; CEHRD Flash I / II windows managed by SaaS operator playbook (not tenant-editable); dashboard widget "Flash I due in N days → Generate report"; email reminder 7 + 1 day before |
| **13** | Privacy, DSAR, PII access logging, breach procedure | `DataSubjectRequest` entity + processor; PII-access audit log; breach notification runbook; KMS key rotation (per-region CMK); DDB PITR attestation; data residency policy |
| **14** | Onboarding UX + IEMIS Console | Tenant creation wizard with IEMIS School Code capture; School creation wizard with verification; "Migrating from IEMIS?" choice; IEMIS Console page (import history + export history + compliance state); SaaS-operator template management UI |
| **15** | Dress rehearsal with Saraswati (UAT, real data) | New UAT tenant `saraswati-uat` provisioned → real Saraswati xlsx import → two-week operations rehearsal → real Flash I export → manual submission to CEHRD → acceptance evidence → go/no-go sign-off |

**Total: 15 sprints past Sprint 0.**

---

## 7. Out of scope (intentional cuts)

- **Nepali UI localization (ne-NP)** — defer indefinitely. Saraswati admins use English.
- **Onboarding "guided tour"** — product-marketing territory, not pilot-critical.
- **Developer-platform sprint / mock IEMIS API client / webhooks** — speculative until CEHRD publishes an API. Cut.
- **CSV audit-log export** — audit UI is enough.
- **Per-tenant compliance calendar editor** — CEHRD windows are government-set and identical across Nepal; managed by SaaS operator, not per-tenant.
- **`raceDescriptor`** shape-complete-for-future-archetypes — cut until non-PABSON archetype lands.
- **Cognito MFA enforcement** — currently not working in EdForge; deferred post-go-live. Explicitly NOT in Sprint 13 V1 scope.
- **Classroom / Section admin UI** — already built.
- **Bulk attendance marking** — already built.
- **Grades UI** — already built.
- **Parent Portal** — deferred indefinitely.
- **Academic Year admin UI** — already exists.
- **Data redaction for fixtures** — use real Saraswati data in UAT behind auth; prod is redeployed clean and onboarded properly.
- **Data backfill migrations** — no real prod data worth preserving; the current prod tenants (testtenant007, etc.) are test data and can be wiped on redeploy.

---

## 8. Sprint detail

### Sprint 0 — Foundations (IMPLEMENTED, awaiting commit + merge)

Branch `sprint/iemis-s0-foundations` (backend) + uncommitted changes on `sprint/phase-3-iemis-import-ui` (frontend). **Gate: commits approved and merged to main before Sprint 1 ticket work starts.**

- S0.1 — Guardian-ID uuid fix
- S0.2 — TanstackDataTable server pagination
- S0.3 — `DynamoDBClientService.atomicIncrement` primitive
- S0.4 — `StudentIdService` refactor onto S0.3
- S0.5 — `RequestScopedSchoolCache` per-request identity cache
- S0.6 — Per-tenant feature-flag helper
- S0.7 — CLAUDE.md publish-gate checklist

34 tests pass across 5 new suites. Both backend services compile.

---

### Sprint 1 — IEMIS Identity, RBAC, Audit primitives

**Goal:** EdForge treats IEMIS codes as first-class identifiers; `iemis.*` permissions exist and guard every downstream endpoint; `IemisAuditEvent` is a shared primitive ready for every subsequent sprint to emit from.

**Dependencies:** Sprint 0 merged.

- **S1.1 — IEMIS code format Zod validators** — `iemisSchoolCodeSchema` (8–10 digits), `iemisStudentIdSchema` (16 digits) in `@aibrains/shared-types/src/identity/iemis-codes.ts`. Unit: reject non-digit, wrong length, leading-zero. Fixture: real Saraswati IDs from xlsx.
- **S1.2 — School: `emisSchoolCode` required for PABSON, immutable post-first-save** — controller rejects PATCH via `immutableField`. Unit: PABSON school without code → 400. Fixture: Saraswati school code validates.
- **S1.3 — School: cross-tenant uniqueness via sparse GSI** — new `EmisSchoolCodeIndex` in [ecs-dynamodb.ts](../../server/lib/tenant-template/ecs-dynamodb.ts). Violation → 409 `DUPLICATE_IEMIS_CODE`.
- **S1.4 — Student: `emisStudentId` format validation at create** — use S1.1 schema. Reject PABSON student missing `emisStudentId`. Per-tenant uniqueness documented on GSI7.
- **S1.5 — `GET /iemis/verify-school-code/:code` placeholder** — format-only validation, returns `{ valid, reason? }`. Rate-limited. Future hook for CEHRD lookup.
- **S1.6 — IEMIS permission constants** — `iemis.import`, `iemis.export`, `iemis.verify-code`, `iemis.view-audit`, `iemis.manage-templates`. RBAC seed: TenantAdmin gets first four; platform operator role gets `iemis.manage-templates`. Unit: role permission matrix.
- **S1.7 — `@RequirePermission()` guard wired** — Nest guard reading JWT role + checking permission map. Applied to S1.5 endpoint as first consumer.
- **S1.8 — `IemisAuditEvent` entity** — schema in `@aibrains/shared-types/src/events/iemis-audit.ts`. Fields: `eventId, eventType, tenantId, schoolId?, actorUserId, timestamp, metadata, ipAddress?`. Event types include `code.verified`, `import.*`, `export.*`, `dsar.*`, `template.*`. DDB entity: `SK = AUDIT#IEMIS#<timestamp>#<eventId>`.
- **S1.9 — `IemisAuditLogger` service + emit helper** — injected into any consumer via `auditLogger.emit({...})`. Never throws upstream. Unit: null-out DDB client → emit still returns (logged error).
- **S1.10 — `GET /iemis/audit` endpoint** — paginated, `iemis.view-audit`-guarded, last-4-digits mask of `emisStudentId` for non-TenantAdmin.
- **S1.11 — UI: School detail page — IEMIS Code badge** — verified badge, copy button, CEHRD tooltip.
- **S1.12 — CloudWatch metric `iemis.audit.emit_failures`** — alarm on >0 in 5min → operator SNS. Runbook entry.

**Demo:** TenantAdmin creates school with code `12345678`, detail shows badge. Second tenant with same code → 409. TenantUser calls `/iemis/verify-school-code/…` → 403, audit logged. Hand-crafted audit event read back via GET with student-ID masked.

---

### Sprint 2 — Ed-Fi descriptor catalog + resolver

**Goal:** Canonical Ed-Fi descriptor URIs for every demographic category IEMIS reports; alias-aware resolver returning `null` on unknown (never guesses).

**Dependencies:** Sprint 1.

- **S2.1 — Descriptor catalog directory layout** — `packages/shared-types/src/ed-fi/descriptors/`. One JSON per type. Entry: `{ uri, code, codeShort, displayName: {en, ne-NP}, aliases: string[] }`.
- **S2.2 — LanguageDescriptor catalog** — Nepali, Maithili, Bhojpuri, Tharu, Tamang, Newar, Bajjika, Magar, Doteli, Urdu, Awadhi, Limbu, Gurung, English, Sanskrit, Hindi. Lint rule enforces Ed-Fi URI regex.
- **S2.3 — DisabilityDescriptor catalog** — CEHRD categories: Physical, Vision, Hearing, Deaf-blind, Speech, Intellectual, Autism, Multiple.
- **S2.4 — SexDescriptor catalog** — Male / Female / Other, aliases incl. Devanagari.
- **S2.5 — GradeLevelDescriptor catalog** — aligned with existing [grade-levels.ts](../../packages/shared-types/src/schemas/identity/grade-levels.ts). Handles IEMIS combined `ECD/PPC` token.
- **S2.6 — ExitWithdrawTypeDescriptor catalog** — IEMIS dropout/transfer/graduation codes.
- **S2.7 — `resolveDescriptor(type, input, context?)` helper** — exact → alias → null. No fuzzy match. Context: `{ country?, archetype? }`. Unit: 100% catalog alias coverage.
- **S2.8 — `getDisplayName(uri, locale)` helper** — locale fallback chain: requested → `en` → uri.
- **S2.9 — Fixture test: real Saraswati row values all resolve** — every unique value observed in Saraswati xlsx Language/Disability/Sex columns resolves non-null; failure lists unmapped inputs.

**Demo:** `resolveDescriptor('Language', 'Nepali') === resolveDescriptor('Language', 'Nepalese') === 'uri://ed-fi.org/LanguageDescriptor#Nepali'`. `resolveDescriptor('Disability', 'frobnicator') === null`. Devanagari label via `getDisplayName`.

---

### Sprint 3 — Student demographics + StudentSchoolAssociation

**Goal:** Student schema carries every IEMIS demographic column. `StudentSchoolAssociation` (Ed-Fi enrollment) exists as first-class entity so exports can reference it.

**Dependencies:** Sprint 2.

- **S3.1 — Extend Student schema** — add `sexDescriptor`, `languageDescriptor`, `motherTongueDescriptor`, `disabilities: [{descriptor, notes?}]`, `ethnicityDescriptor` (Sprint 6 populates), `isTransferred` (passive bool), `belowPovertyLine?` (bool + optional scholarshipCategory).
- **S3.2 — `StudentSchoolAssociation` Ed-Fi entity** — `studentSchoolAssociationId, tenantId, studentUniqueId, schoolId, schoolYearId, entryDate, entryGradeLevelDescriptor, entryType?, exitWithdrawDate?, exitWithdrawType?, primarySchool (bool)`. DDB `SK = SSA#schoolId#schoolYearId#studentId`.
- **S3.3 — `StudentSchoolAssociationService`** — CRUD + `listByStudent` + `listByYear` + idempotent `findByComposite`. Referential integrity enforced.
- **S3.4 — Sparse GSI `StudentSchoolAssociationByStudent`** — CDK + `cdk diff` + UAT deploy + GSI ACTIVE check.
- **S3.5 — `SchoolYearType` entity** — Ed-Fi BS-year reference type. Links existing AcademicYear records.
- **S3.6 — Student detail UI: Demographics section** — resolver display names via S2.8. Missing-value "Not specified" + pencil-edit.
- **S3.7 — `IemisAuditEvent` emitted on descriptor edits** — event `student.descriptor.edited`, metadata URIs only (no PII).

**Demo:** Import 10 students → detail shows demographics. Edit a disability → audit entry.

---

### Sprint 4 — Staff + StaffQualification + StaffTraining

**Goal:** Ed-Fi `Staff` with IEMIS teacher reporting fields. Qualifications + trainings normalized so Staff xlsx export is a projection.

**Dependencies:** Sprint 1 (audit), Sprint 2 (descriptors).

- **S4.1 — Extend Staff schema** — `emisStaffId?`, `gender`, `dateOfBirth`, `nationality`, `maritalStatus`, `employmentStatus`, `appointmentType`, `appointmentDate`.
- **S4.2 — `StaffQualification` entity** — `qualificationId, staffId, level (SLC/+2/Bachelor/Master/PhD/other), institution, year, subject?, certificateUrl?`. DDB `SK = STAFF#<staffId>#QUAL#<qualId>`.
- **S4.3 — `StaffTraining` entity** — `trainingId, staffId, topic, hours, providerOrg, completedDate, certificateUrl?`. DDB `SK = STAFF#<staffId>#TRAIN#<trainId>`.
- **S4.4 — Staff admin UI: Qualifications tab**
- **S4.5 — Staff admin UI: Trainings tab** — shows TPD hours year-to-date.
- **S4.6 — IEMIS staff-code validator** — format-only placeholder.
- **S4.7 — Audit on staff-credential edits**

**Demo:** Teacher profile with 2 qualifications + 3 trainings. Audit every edit.

---

### Sprint 5 — SchoolInfrastructure + AcademicCalendar + Holidays

**Goal:** Infrastructure data for IEMIS; holidays entity so monthly attendance aggregation has a working-day denominator.

**Dependencies:** Sprint 1 (audit). **Parallel with Sprint 4.**

- **S5.1 — `SchoolInfrastructure` entity** — every field is an IEMIS column: `totalClassrooms, usableClassrooms, toilets: {boys, girls, disabledAccessible}, drinkingWaterSource, hasElectricity, hasInternet, hasLibrary, hasComputerLab, hasPlayground, hasBoundaryWall, buildingMaterial, postDisasterSafetyAssessmentDate, postDisasterSafetyStatus, lastInspectionDate`.
- **S5.2 — `SchoolInfrastructureService` with versioned history** — each edit writes a history row so prior Flash reports remain reconstructable.
- **S5.3 — `AcademicCalendarEvent` entity** — `eventId, schoolId, schoolYearId, date, eventType (holiday/exam/earlyDismissal/other), description, isInstructional (bool), gazetteNotificationRef?`.
- **S5.4 — National-holiday seed** — Dashain, Tihar, Chhath, Lhosar, Buddha Jayanti, Republic Day, Constitution Day, Workers Day, Mother's/Father's Day, etc. as default BS-year events. Per-tenant override-able.
- **S5.5 — `MonthlyAttendanceAggregator` service** — `(schoolId, schoolYearId, month)` → per-grade-per-sex student-days-present ÷ (enrolled × working-days). Output cached under `ATTENDANCE#MONTHLY#<year>#<month>`.
- **S5.6 — Admin UI: Infrastructure tab on School detail** — form + versioned diff view.
- **S5.7 — Admin UI: Academic Calendar editor** — extends existing Academic Year admin with holiday events.
- **S5.8 — Audit on infrastructure edits**

**Demo:** Infrastructure record + 3 holidays → monthly attendance excludes holidays; edit infra field → history shows prior value.

---

### Sprint 6 — Nepal ethnicity / caste descriptor taxonomy (full 125+)

**Goal:** Full CBS janajati taxonomy as descriptors with grouping URIs.

**Dependencies:** Sprint 2. **Gate: product + legal review signoff before S6.4 lands.**

- **S6.1 — Research memo: CBS janajati list** — full 125+ entries documented + classification into Dalit / Janajati / Madhesi / Brahmin-Chhetri / Other groupings IEMIS expects.
- **S6.2 — Legal / product review sign-off** — Shoaib + legal confirm taxonomy. Sensitive-field handling guidance documented.
- **S6.3 — `EthnicityDescriptor` catalog** — full 125+ entries + grouping URIs. Namespace: `uri://edforge.app/EthnicityDescriptor#...`.
- **S6.4 — Integrate `ethnicityDescriptor` into Student + resolver** — resolver covers Devanagari ↔ transliteration aliases.
- **S6.5 — Sensitive-field redaction helper** — in audit log, ethnicity is PII → redacted for non-admin viewers; update `/iemis/audit` response shaping.

**Demo:** Set ethnicity on a student; audit event emitted with ethnicity redacted; `resolveDescriptor('Ethnicity', 'Magar')` returns URI.

---

### Sprint 7 — StudentAssessment + StudentAssessmentSubject

**Goal:** Exam results (SEE, Class 10, Class 12) as Ed-Fi entities.

**Dependencies:** Sprint 3.

- **S7.1 — `StudentAssessment` entity** — `assessmentId, studentId, schoolYearId, assessmentType, administeredDate, overallGPA?, overallGrade?, resultStatus`.
- **S7.2 — `StudentAssessmentSubject` entity** — `subjectResultId, assessmentId, subjectDescriptor, theoryMarks?, practicalMarks?, totalMarks, gradeLetter, gradePoint, resultStatus`. DDB `SK = ASSESSMENT#<assessmentId>#SUBJECT#<subjectId>`.
- **S7.3 — `SubjectDescriptor` catalog** — Nepal curriculum subjects.
- **S7.4 — `StudentAssessmentService` CRUD + bulk CSV upload**
- **S7.5 — Admin UI: Exam results entry** — per-student grid + bulk CSV upload with validation.
- **S7.6 — Student detail: Academic history tab**
- **S7.7 — Audit on results entry**

**Demo:** Upload CSV of 50 SEE results; student detail shows subject-wise grades; audit log records bulk upload.

---

### Sprint 8 — Async job primitive + IEMIS import pipeline

**Goal:** Operator uploads any-size IEMIS xlsx, gets progress page, no 504. Authorized via `iemis.import`. S3 upload is size-capped, virus-scanned, SSE-KMS encrypted.

**Dependencies:** Sprint 1 (RBAC, audit), Sprint 3 (data model), Sprint 2 (descriptors).

- **S8.1 — ADR: ECS Fargate worker** — new `docs/adr/004-iemis-async-execution-model.md`. Decision: ECS worker in `prod-basic` cluster. Trade-off table vs Lambda.
- **S8.2 — CDK: SQS FIFO + DLQ + ECS worker service scaffold** — `iemis-import-queue.fifo` + DLQ. CDK Nag fixes inline.
- **S8.3 — S3 bucket: SSE-KMS + deny-non-TLS + size cap** — new `iemis-imports-{env}` bucket. Policy: TLS-only, SSE-KMS with dedicated CMK. 25MB object limit.
- **S8.4 — Virus scan on S3 upload** — ClamAV Lambda or S3 Object Lambda. Quarantine on match → SNS + runbook.
- **S8.5 — `IemisImportJob` entity** — status/counts/findings/s3Pointer/timestamps/ttl(30d).
- **S8.6 — Worker handler** — SQS claim → stream xlsx → transform + commit → progress writes every 50 rows or 2s. Emit `iemis.import.started|.completed|.failed` via audit helper.
- **S8.7 — `POST /iemis/import` controller** — `iemis.import`-guarded. Pre-signed S3 upload → S3 event → Lambda enqueues SQS. Row-count validation (max 10k, reject with 413).
- **S8.8 — `GET /iemis/jobs/:jobId` controller** — poll endpoint. `iemis.import`-guarded (owner-or-admin).
- **S8.9 — Frontend: IEMIS import wizard** — Upload → Dry-run preview → Commit → Progress → Completion summary with findings CSV.
- **S8.10 — Frontend: Import history page** — last 30 jobs (TTL-capped).
- **S8.11 — Enrich-on-conflict semantics** — GSI7 hit → merge non-null descriptor fields. Flag `iemis.descriptorEnrichment`. Never overwrites non-null with null. Never touches identity fields.
- **S8.12 — DLQ depth CloudWatch alarm**
- **S8.13 — Fixture test: real 779-row Saraswati file in UAT** — end-to-end integration. Asserts 779 created, descriptor resolution correct, dedup idempotent.
- **S8.14 — Runbook: IEMIS import failure scenarios**

**Demo:** TenantUser (no `iemis.import`) → 403. TenantAdmin uploads 779-row Saraswati file → redirect to progress → <60s completion. Re-upload same file → 779 skipped. Malformed xlsx → findings page.

---

### Sprint 9 — Template Mapping Engine (CEHRD template-injection)

**Goal:** EdForge stores official CEHRD `.xlsm` templates and a cell-level mapping per `(reportType, templateVersion)`. Export = load template → iterate rows → inject data into mapped cells → return macro-preserving `.xlsm`. When CEHRD publishes a new template version, the SaaS operator uploads the new file + a new mapping document without any code change. This is the architectural lynchpin of the export pipeline.

**Dependencies:** Sprints 3, 4, 5, 7.

- **S9.1 — `IemisTemplate` registry entity** — `templateId, reportType (flash_i_student | flash_ii_student | staff | infrastructure | monthly_attendance | flash_ii_monthly_attendance), version (e.g. "IEMIS-2079", "IEMIS-2081"), s3Key (points to .xlsm blob), sha256, publishedDate, activeFrom, activeTo?, uploadedBy, createdAt, notes`. DDB `SK = IEMIS_TEMPLATE#<reportType>#<version>`.
- **S9.2 — `IemisTemplateMapping` entity** — `mappingId, templateId, reportType, layoutType ("single-row-per-entity" | "matrix-per-entity"), cellMap, rowRange: {startRow, dataStartRow, maxRow}, sheetName, transforms[]`. `cellMap` is a JSON dict: `{ "B": {source: "student.firstName"}, "C": {source: "student.lastName"}, "D": {source: "student.emisStudentId"}, "E": {source: "student.dateOfBirth", transform: "gregorianToBsDate"}, "F": {source: "enrollment.entryGradeLevelDescriptor", transform: "descriptorToCode:GradeLevel"}, ... }`. For matrix layouts (monthly attendance), mapping includes `rowDimension` and `columnDimension` selectors.
- **S9.3 — `IemisTemplateService`** — CRUD for templates + mappings. `getActiveTemplate(reportType, asOfDate)` returns the template active on a given date. `uploadTemplate({.xlsm blob, metadata})` validates SHA-256, uploads to S3 (SSE-KMS), inserts DDB row. Guarded by `iemis.manage-templates` permission (platform operator role; not TenantAdmin).
- **S9.4 — S3 bucket `iemis-templates-{env}`** — SSE-KMS + TLS-only + versioning enabled (CEHRD template history retained forever). Not tenant-scoped — templates are platform-global artifacts.
- **S9.5 — Transform library** — pure functions: `descriptorToCode(uri, catalogName)` (reverse of Sprint 2 resolver), `gregorianToBsDate(iso)` (uses existing [bikram-sambat.ts](../../packages/shared-types/src/utils/bikram-sambat.ts)), `formatNumber(value, locale)`, `constant(value)`, `booleanToYesNo(b)`, `computed:age(dob, asOfDate)`, `computed:workingDays(month, schoolYearId)`.
- **S9.6 — `TemplateInjectionRenderer` service** — input: `{template blob, mapping, rows}`. Uses ExcelJS (`npm install exceljs` — preserves .xlsm macros, unlike `xlsx` which strips them). Flow: load workbook → locate sheet by `mapping.sheetName` → for each row in input `rows`, compute target row number = `mapping.rowRange.dataStartRow + index` → for each `cellMap` entry, resolve source path on the row, apply transform if present, write value to `sheet.getCell(letter + rowNumber).value`. Returns in-memory buffer. Unit test: inject 3 rows into a minimal test template, read back via ExcelJS, assert cell values.
- **S9.7 — IEMIS-2079 Flash I Student template loaded**
  - Upload the official CEHRD IEMIS-2079 Flash I Student `.xlsm` to S3
  - Create `IemisTemplateMapping` covering every Flash I column
  - Fixture test: render 10 real Saraswati students into this template → open result in ExcelJS → assert cell values match expected
- **S9.8 — IEMIS-2079 Flash II Student template loaded** — same pattern
- **S9.9 — IEMIS-2079 Staff template loaded**
- **S9.10 — IEMIS-2079 Infrastructure template loaded** — single-row layout
- **S9.11 — IEMIS-2079 Monthly Attendance template loaded** — matrix layout (grade × sex × month)
- **S9.12 — SaaS-operator CLI `npm run iemis-template:upload`** — `node scripts/iemis-template-upload.js --file <.xlsm> --reportType flash_i_student --version IEMIS-2081 --activeFrom 2081-01-01 --notes "…"`. Validates file → S3 upload → DDB row.
- **S9.13 — SaaS-operator CLI `npm run iemis-template:mapping`** — `--templateId <id> --mapping <mapping.json>` uploads mapping document. Validates against a JSON schema (S9.2 format).
- **S9.14 — SaaS-operator playbook** — `docs/operations/iemis-template-rollover-playbook.md` covering: (1) monitor CEHRD Notices page, (2) download new .xlsm, (3) diff against previous mapping to find shifted cells, (4) upload template + mapping via CLI, (5) set `activeFrom`, (6) integration-test export, (7) enable flag-gated rollout per tenant.
- **S9.15 — Template versioning integration test** — simulate: tenant exports with template v1, SaaS operator uploads v2 with `activeFrom=tomorrow`, tenant exports today → v1 used; tomorrow → v2 used. No code change.

**Demo:** ExcelJS injects real 779-row Saraswati data into IEMIS-2079 Flash I template → open downloaded file in LibreOffice → macros preserved, cell values correct, formatting preserved. CLI uploads a mock IEMIS-2081 template + mapping → integration test confirms it's used on/after its `activeFrom`.

---

### Sprint 10 — IEMIS Student export (Flash I + Flash II)

**Goal:** Flash I and Flash II Student exports via the Template Mapping Engine. Signed-URL download + audit. Round-trip tested against real Saraswati data.

**Dependencies:** Sprint 9, Sprint 8 (async primitive).

- **S10.1 — `IemisExportJob` entity** — mirror of `IemisImportJob` + `reportType, templateId (resolved at job creation, captured for reproducibility), signedDownloadUrl?, urlExpiresAt, counts, generatedBy, ttl`.
- **S10.2 — Export worker handler** — claim SQS → `IemisTemplateService.getActiveTemplate(reportType, today)` → query Ed-Fi entities per filter → run `TemplateInjectionRenderer` → upload filled `.xlsm` to S3 (SSE-KMS) → generate signed URL (15-min TTL) → emit `iemis.export.requested|.generated`.
- **S10.3 — `POST /iemis/export` controller** — `iemis.export`-guarded. Accepts `{ reportType, schoolYearId, filters? }`. Enqueues job.
- **S10.4 — `GET /iemis/exports/:jobId` controller** — returns job state + signed URL when ready. Owner-or-admin guard. Emit `iemis.export.downloaded` on URL redemption via S3 access log → Lambda → audit.
- **S10.5 — Export wizard UI** — 5 steps: report selector → school year → optional filters (grade range, status) → preview (first 5 injected rows via server-side render) → Generate → progress → download.
- **S10.6 — Round-trip fixture test (CRITICAL)** — real 50-row Saraswati xlsx → import via Sprint 8 → export via S10 → **open both files in ExcelJS**, compare cell values column-by-column, assert canonical equivalence modulo whitespace. Fails CI with actionable diff on mismatch.
- **S10.7 — Manual dress-rehearsal upload to CEHRD portal** — generate Flash I on UAT tenant → download `.xlsm` → submit to CEHRD via the normal IEMIS portal flow → document acceptance/rejection in runbook. This is the real test of the macro-preservation requirement.
- **S10.8 — Export canary daily job** — synthetic-data export against a golden .xlsm → byte-diff → alarm on non-zero. Detects descriptor catalog + template mapping regressions.
- **S10.9 — Runbook: IEMIS export rejected-by-CEHRD recovery** — categories of rejection (macro corruption, column shift, validation), recovery steps, audit `export.failed` with reason.
- **S10.10 — DLQ depth CloudWatch alarm for export queue**

**Demo:** TenantAdmin generates Flash I for 2083 → downloads `.xlsm` → opens in Excel → all 779 Saraswati students present, BS dates correct, IEMIS descriptor codes populated, macros intact. Round-trip CI green for 3 consecutive days. Canary clean.

---

### Sprint 11 — IEMIS Staff + Infrastructure + Monthly Attendance export

**Goal:** Remaining report types via same engine. New templates + mappings, not new code.

**Dependencies:** Sprint 10 (pipeline), Sprints 4, 5 (data).

- **S11.1 — Staff export wiring** — `reportType=staff` routes to Sprint 9 Staff template + mapping. Audit `iemis.export.staff.generated`.
- **S11.2 — Staff export wizard entry**
- **S11.3 — Infrastructure export wiring** — single-row output, `reportType=infrastructure`.
- **S11.4 — Monthly Attendance export wiring** — matrix layout, runs `MonthlyAttendanceAggregator` (Sprint 5), renders matrix into template. Month picker in wizard.
- **S11.5 — Round-trip fixture tests per report type** — real Saraswati data input, manual CEHRD template comparison output.
- **S11.6 — Per-report canary** — extends S10.8 to all report types.

**Demo:** Generate Staff / Infrastructure / Monthly Attendance exports for pilot tenant → each passes manual CEHRD-template inspection → all canaries green 3 days.

---

### Sprint 12 — Compliance calendar + export reminders

**Goal:** Dashboard widget + email reminders drive operators to generate the right export at the right time. Windows managed by SaaS operator playbook, not tenant-editable.

**Dependencies:** Sprint 10.

- **S12.1 — `ComplianceEvent` entity** — `eventId, eventType (FlashI/FlashII/MonthlyAttendance), startDate, endDate, description, authority ("CEHRD"), reportId (maps to Sprint 9 reportType)`. Global, not tenant-scoped.
- **S12.2 — Default CEHRD window seed script** — BS-dated Flash I (typically Shrawan / mid-year start), Flash II (typically Magh), monthly attendance last-day-of-month. Run annually by SaaS operator.
- **S12.3 — SaaS-operator CLI `npm run iemis-compliance:seed-year`** — `--year 2081` seeds all compliance events for a BS year. Idempotent.
- **S12.4 — Dashboard widget "Next compliance deadline"** — countdown in BS + AD; CTA "Generate Flash I now" deep-links to Sprint 10 export wizard with report preselected.
- **S12.5 — Email reminder service** — 7-day + 1-day + day-of notifications to all users with `iemis.export`. SES template. Audit `compliance.reminder.sent`.
- **S12.6 — In-app notification bell**
- **S12.7 — Runbook: muting reminders for a tenant** — escape hatch for mid-migration tenants.
- **S12.8 — SaaS-operator playbook: compliance-window-rollover** — `docs/operations/iemis-compliance-windows-playbook.md` — procedure when CEHRD publishes a new fiscal year's compliance calendar (typically gazetted in early BS year).

**Demo:** Dashboard shows "Flash I due in 12 days"; click → export wizard pre-selected. Email sent 7 days prior to 3 recipients; audit logs each.

---

### Sprint 13 — Privacy, DSAR, PII-access logging, breach procedure

**Goal:** Nepal Privacy Act 2075 + FERPA alignment is concrete, not a checklist.

**Dependencies:** Sprint 1 (audit), Sprint 10 (exports).

- **S13.1 — `DataSubjectRequest` entity** — `requestId, tenantId, subjectType (student/staff/contact), subjectId, requestType (access/correction/deletion/export), status, receivedAt, resolvedAt?, resolvedBy, evidenceS3Key?`.
- **S13.2 — DSAR intake form (admin UI)** — TenantAdmin submits on behalf of a subject. Auto-generates `IemisAuditEvent` `dsar.requested`.
- **S13.3 — DSAR fulfillment processor** — `access` → subject-scoped JSON export; `deletion` → tombstone + scheduled purge (28-day grace); `correction` → diff review queue.
- **S13.4 — PII-access audit log** — every read of `emisStudentId`, `emisStaffId`, `contactPhone`, `contactEmail` emits `pii.viewed` with field list + subject ID. Retention ≥ 2 years (Privacy Act 2075 §7).
- **S13.5 — Audit-log field redaction by role** — non-TenantAdmin sees masked IDs / partial-hash email / last-4 phone. TenantAdmin full view.
- **S13.6 — Breach notification runbook** — trigger criteria, 72h internal notification timeline, escalation to legal / CEHRD, template text for affected parties.
- **S13.7 — KMS key rotation policy** — **per-region CMK** (per user decision: simpler ops; per-tenant deferred). Annual rotation. Transparent to entities. Documented in data-residency policy.
- **S13.8 — DDB PITR attestation per tenant table** — `cdk diff` + CFN assertion that every IEMIS-reading table has PITR enabled. RPO ≤ 5 min documented.
- **S13.9 — Data residency policy document** — `docs/security/data-residency-policy.md`. Justifies ap-south-1 (Mumbai) under Privacy Act 2075 §27. Lists encryption at rest (per-region CMK), in transit (TLS 1.3). Legal review gate before merge.
- **S13.10 — FERPA re-audit checklist** — `docs/security/ferpa-audit.md`. Pass through FERPA §99.3 / §99.31 controls against current state.
- **S13.11 — Pen-test gate for pilot go-live** — external pen-test of IEMIS endpoints before real Saraswati data in prod. Findings triaged.

**Note:** Cognito MFA enforcement is explicitly OUT of scope per user direction (MFA not currently functional; deferred post-go-live).

**Demo:** DSAR submitted → fulfilled in UI with audit trail. Student detail view → `pii.viewed` logged. Non-admin reads audit → IDs masked. Breach runbook tabletop exercise.

---

### Sprint 14 — Onboarding UX + IEMIS Console + SaaS-operator template UI

**Goal:** New tenant signs up → guided IEMIS-aware onboarding → IEMIS Console page serves as the single entry point for IEMIS operations. SaaS operator has an admin UI for template management.

**Dependencies:** Sprints 1, 8, 10.

- **S14.1 — Tenant creation wizard: IEMIS School Code step** — renders for PABSON archetype. S1.1 format validator. Writes to tenant metadata.
- **S14.2 — School creation wizard: emisSchoolCode capture + verification** — mandatory for PABSON. Calls S1.5. Verified badge on success.
- **S14.3 — "Migrating from IEMIS?" choice screen** — post-first-school-creation. "Yes" → Sprint 8 import wizard. "Starting fresh" → Sprint 4 staff + Sprint 5 infra flows.
- **S14.4 — IEMIS Console page** — tabs: Import history, Export history, Compliance calendar, Audit log, Verification status. Permission-gated per tab.
- **S14.5 — Help center: Nepal-specific FAQs** — "What is my IEMIS code?", "What is Flash I vs II?", "What happens if CEHRD rejects my export?"
- **S14.6 — Onboarding telemetry** — funnel: tenant created → code captured → first import OR first manual entry. Drop-off alarms.
- **S14.7 — E2E test: new tenant → IEMIS Console within 3 minutes** — Playwright.
- **S14.8 — SaaS-operator template management UI** — AdminWeb page: list templates (filter by reportType), preview a template's mapping, upload new version, set `activeFrom`. Guarded by `iemis.manage-templates` (platform-operator, not tenant). Audit `template.uploaded`, `template.activated`.
- **S14.9 — Template mapping validator (UI-side)** — when operator uploads a mapping JSON, client-side validates against S9.2 schema + highlights cells that don't exist in the uploaded .xlsm.

**Demo:** Create tenant in AdminWeb → tenant admin logs in → sees IEMIS-aware onboarding → lands on IEMIS Console. Operator (platform role) uploads an IEMIS-2081 template + mapping via AdminWeb UI → preview shows cell values.

---

### Sprint 15 — Dress rehearsal with Saraswati (UAT, real data)

**Goal:** End-to-end cycle on a fresh UAT `saraswati-uat` tenant using **real Saraswati data** (no redaction). Evidence-documented CEHRD acceptance before real Saraswati data lands in prod.

**Dependencies:** Sprints 8, 10, 11, 12, 13, 14.

- **S15.1 — Provision fresh UAT tenant `saraswati-uat`** — PABSON archetype, fresh Cognito admin user, fresh DDB state. Dedicated subdomain e.g. `saraswati-uat.edforge.app`.
- **S15.2 — Import rehearsal with real Saraswati xlsx** — full Sprint 8 pipeline. Evidence: screenshots + runbook log.
- **S15.3 — Two-week in-year operations rehearsal** — add 2 new students manually, transfer 3, withdraw 1, record attendance for 10 school days, edit 2 staff trainings, 1 infra field. Use existing admin flows.
- **S15.4 — Flash I export rehearsal** — Sprint 10 pipeline → download `.xlsm` → manual structural inspection against IEMIS-2079 template.
- **S15.5 — Manual upload to CEHRD portal** — submit the generated file through the real CEHRD IEMIS portal (or staff-manual validation if sandbox unavailable). **This is the critical test.** Evidence: acceptance/rejection notes.
- **S15.6 — Rejection recovery walkthrough** — if rejected, run Sprint 10.9 recovery runbook. Document actual recovery time.
- **S15.7 — Monthly attendance export rehearsal** — one rehearsal month. Manual inspection of working-day denominators.
- **S15.8 — Staff + Infrastructure export rehearsal** — same validation path.
- **S15.9 — DSAR rehearsal** — submit `access` DSAR → verify output. Submit `deletion` DSAR → verify tombstone + purge schedule.
- **S15.10 — Pen-test remediation verification** — re-run pen-test findings → confirm high/critical fixed.
- **S15.11 — Prod preparation: clean redeploy + production Saraswati tenant provisioning** — deploy fresh prod CDK stacks with Sprint 1–14 code; provision real `saraswati` prod tenant with admin account; schedule pilot data-load window.
- **S15.12 — Go / No-Go sign-off** — Shoaib signs go-live memo with dated evidence references.

**Demo:** End-to-end rehearsal evidence package. Go/No-Go memo.

---

## 9. Dependency graph

```
S0 ──── S1 ──┬── S2 ──── S3 ──┬── S4 ──────┐
             │                ├── S5 ──────┤
             │                ├── S6 ──────┤
             │                └── S7 ──────┤
             │                              │
             │    ┌─────────────────────────┴── S8 ── S9 ── S10 ── S11 ── S12 ──┐
             │    │                                                              │
             ├────┴── S14 (onboarding + operator UI) ──────────────────────────┤
             │                                                                    │
             └── S13 (privacy / DSAR) ──────────────────────────────────────────┤
                                                                                  │
                                          S15 (dress rehearsal) ─────────────────┘
```

- Sprints 4 / 5 / 6 / 7 run in parallel after Sprint 3
- Sprint 13 (privacy) depends on Sprint 1; runnable in parallel with data-model sprints
- Sprint 14 (onboarding + operator template UI) depends on S1, S8, S10
- S15 is the final gate

---

## 10. Feature-flag flip order (per tenant)

1. `iemis.asyncImport` (Sprint 8) — safe any time post-deploy
2. `iemis.descriptorEnrichment` (Sprint 8) — after Sprint 2 shared-types publish
3. `iemis.exportPipeline` (Sprint 10) — after round-trip CI green
4. `iemis.complianceCalendar` (Sprint 12) — after reminder tests
5. `iemis.dsarEnabled` (Sprint 13) — after legal review

Rollback = DDB PATCH reversing the flag.

---

## 11. Risk register

| # | Risk | Sprint | Mitigation |
|---|---|---|---|
| R1 | CEHRD publishes new IEMIS-20xx template revision with shifted columns | 9, 10, 11 | Template Mapping Engine (S9) — operator uploads new .xlsm + mapping, no code change. Playbook in S9.14. |
| R2 | CEHRD rejects generated file for macro-integrity reasons | 9, 10, 15 | ExcelJS preserves macros; S10.7 manually validates at CEHRD portal; rejection runbook S10.9 |
| R3 | emisSchoolCode collision across tenants | 1 | Cross-tenant GSI uniqueness (S1.3) |
| R4 | Virus-laden IEMIS xlsx uploaded | 8 | S3 ClamAV scan (S8.4) |
| R5 | Signed URL leaks to external party | 10, 13 | 15-min TTL + access log + KMS encryption |
| R6 | Descriptor catalog ships wrong URI → mis-tagged students | 2 | Fix-forward `reassign-descriptor` admin tool + real Saraswati fixture tests |
| R7 | Nepal Privacy Act 2075 DSAR non-compliance | 13 | `DataSubjectRequest` entity + documented 30-day SLA |
| R8 | Flash I export rejected by CEHRD mid-window | 10, 15 | Dress-rehearsal gate (S15.5) + runbook (S10.9) |
| R9 | Staff forget to generate export in compliance window | 12 | Dashboard widget + 7-day + 1-day + day-of reminders |
| R10 | Audit-log fills DDB beyond cost-effective | 13 | TTL + CSV archival to S3 Glacier (future sprint) |
| R11 | ap-south-1 (Mumbai) cross-border challenged by Privacy Act 2075 | 13 | Legal memo in data-residency policy (S13.9); fallback plan for future Nepal region |
| R12 | Sprint 0 primitives not merged → Sprint 1 has invisible dependency | 0, 1 | **Gate: verify Sprint 0 commits merged to main before Sprint 1 ticket work starts** |
| R13 | MFA deferred → insider-threat risk on `iemis.export` | 13 | Accept-risk-documented in data-residency policy; revisit post-go-live |
| R14 | ExcelJS macro-preservation bug in edge-case .xlsm | 9 | S9.15 template-versioning integration test + manual CEHRD upload (S10.7) |

---

## 12. Decisions (resolved)

| # | Decision | Resolution |
|---|---|---|
| 1 | MFA on `iemis.export` | **Deferred post-go-live.** MFA currently not functional in EdForge. Revisit after Saraswati pilot. |
| 2 | Nepal caste taxonomy scope | **Ship full 125+ CBS janajati categories** in Sprint 6. Grouping URIs for the IEMIS-expected categorizations. |
| 3 | KMS CMK per tenant vs per region | **Per-region CMK** (simpler ops, annual rotation). Per-tenant deferred. |
| 4 | Flash I / II BS-calendar window encoding | **SaaS-operator-managed via annual playbook** (S12.8). Not tenant-editable. |
| 5 | Dress rehearsal tenant location | **UAT with real Saraswati data behind auth.** No redaction. Fresh UAT tenant `saraswati-uat`. |
| 6 | Staff IEMIS-code verification | **Format-only** today. Real CEHRD API hook deferred (no public API exists). |

---

## 13. Platform-operator responsibilities (new role)

Several sprints introduce SaaS-operator responsibilities that are outside tenant admin scope:

| Responsibility | Sprint | Cadence |
|---|---|---|
| Monitor CEHRD Notices for new IEMIS template revisions | 9 | Weekly |
| Upload new template `.xlsm` + mapping JSON | 9 | On-release (typically annual) |
| Set `activeFrom` for new template versions | 9 | On-release |
| Seed annual BS-year compliance calendar | 12 | Annually (early BS year) |
| Review pilot tenant onboarding telemetry | 14 | Weekly during pilot |
| DSAR compliance review | 13 | As requests arrive (30-day SLA) |
| Pen-test coordination | 13 | Before prod pilot go-live; annually thereafter |
| Break-glass IEMIS admin recovery | 13 | Ad-hoc |

A new RBAC role `PlatformOperator` has `iemis.manage-templates` and the admin tools above. TenantAdmins do NOT have this.

---

## 14. Validation before Sprint 1 starts

- [x] Sprint 0 work complete and tested (34 tests pass across 5 new suites)
- [ ] Sprint 0 backend branch `sprint/iemis-s0-foundations` committed + PR opened
- [ ] Sprint 0 frontend changes committed on a clean branch + PR opened
- [ ] Sprint 0 PRs reviewed and merged to main
- [ ] CEHRD IEMIS-2079 template files acquired (Flash I, Flash II, Staff, Infrastructure, Monthly Attendance .xlsm) and parked in `docs/specifications/iemis/`
- [ ] Real Saraswati xlsx (779 rows) in a secure test-fixtures location
- [ ] UAT environment has Fargate capacity for worker services
- [ ] Cost-modeled: SQS + ECS worker + KMS + S3 template storage at pilot scale

---

## 15. Implementation order (what we do next)

Given Sprint 0 is already implemented but awaiting merge, this is the execution sequence:

### Phase A — Land Sprint 0 (user-driven)

1. **Review the S0 backend branch** — I'll open the diff for each of S0.1 through S0.7; you approve.
2. **Commit S0 backend** — single commit per ticket (or one cohesive commit per your preference).
3. **Move S0 frontend changes to a clean branch** — currently they're sitting on `sprint/phase-3-iemis-import-ui`. I'll create `sprint/iemis-s0-foundations-frontend`, cherry-pick the S0.2 + README changes, push.
4. **Open backend + frontend PRs.**
5. **Merge to main.**
6. **Deploy Sprint 0 to UAT** — backend ECR push + ECS roll (academics + identity services), shared-types publish + AdminWeb rebuild, Vercel auto-deploy for frontend.
7. **Smoke test UAT** — verify guardian-ID uniqueness, pagination, commit-phase latency drop, feature-flag PATCH.

### Phase B — Sprint 1 starts

Sprint 1 work begins on a new branch `sprint/iemis-s1-identity-rbac-audit`. First ticket: **S1.1 (IEMIS code format Zod validators)** — small, pure, no dependencies, unlocks everything downstream.

### Phase C — Per-sprint cadence (applies to all subsequent sprints)

For each sprint:

1. Feature-branch per sprint: `sprint/iemis-s<N>-<topic>`.
2. Ticket-sized commits, not sprint-sized monoliths.
3. Sprint demo runs on UAT before promoting to prod.
4. Prod deploy after human review per [CLAUDE.md](../../CLAUDE.md) deploy ladder.
5. Feature flag defaults to OFF until the sprint is UAT-validated; flip to ON per tenant.
6. Sprint-close: deploy logs under `docs/deploys/`, tickets updated in this document with actual SHA references.

### Immediate next step awaiting your approval

**Do I commit the Sprint 0 work now and proceed to step 2 of Phase A?** Nothing is committed yet. Once you say "commit Sprint 0", I'll open the backend PR first, wait for your review, then cherry-pick the frontend changes.

---

## 16. Appendix — What the critical review changed

Applied from earlier critical review + your final feedback:

- Nepali UI localization → cut
- Guided tour → cut
- Developer platform sprint → cut
- CSV audit export → cut
- Per-tenant calendar editor → cut (managed by SaaS operator)
- `raceDescriptor` → cut
- "Optional MFA" drift → MFA **deferred post-go-live** (your direction)
- S2 overloaded → split across Sprints 2, 3, 4, 5, 6, 7
- S3 async worker compressed → expanded to Sprint 8 with 14 tickets
- **S4 export "render from scratch" → replaced with Template Mapping Engine (Sprint 9) using CEHRD-official .xlsm injection via ExcelJS, preserving macros** (your insight on CEHRD template/macro dependency)
- Report-descriptor pipeline split across Sprints 9 (template engine), 10 (Student export), 11 (Staff + Infra + Attendance export)
- S7 security compressed → expanded to Sprint 13 with concrete DSAR, PII-access log, breach runbook, KMS rotation, PITR attestation
- Round-trip against real Saraswati → added as S10.6 (CRITICAL)
- Dress rehearsal → added as Sprint 15 with real Saraswati UAT tenant (your direction: no redaction)
- Export canary → added as S10.8
- File-size cap, AV scan, SSE-KMS on imports → added as S8.3, S8.4, S8.7
- `IemisAuditEvent` emit helper as Sprint 1 primitive → added as S1.8, S1.9
- Cross-tenant `emisSchoolCode` uniqueness → added as S1.3
- **New: Platform-operator role + template management CLI/UI + annual calendar seed playbook** (your direction on SaaS-operator-managed compliance ops)
- Nepal caste taxonomy → ship full 125+ (your direction)
- KMS → per-region CMK (your direction)
- Data redaction for fixtures → removed (your direction: use real Saraswati in UAT, redeploy prod clean)

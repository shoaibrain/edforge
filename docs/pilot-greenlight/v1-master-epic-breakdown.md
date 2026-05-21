# EdForge V1 Master EPIC Breakdown

> **Drafted:** 2026-05-20
> **Status:** 🟡 Draft — atomic-ticket plan, awaiting review and sign-off
> **Companion docs:**
> - Strategic: [`v1-master-framework.md`](./v1-master-framework.md) — the 6-track framework this breakdown executes
> - Tactical predecessor: [`sprint-plan-update-2026-05-19.md`](./sprint-plan-update-2026-05-19.md) — v2 sprint plan; this doc is the v3 reorganization
> - Foundational: [`sprint-plan.md`](./sprint-plan.md) §4 invariants + §10/§11 DoDs remain authoritative
> - Field guide: [`edforge-champion-nepal-discovery-brief.md`](./edforge-champion-nepal-discovery-brief.md)
> - Pilot dossier: [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md)

---

## 0. How to read this document

This breakdown organizes V1 work by **EPIC** (the 6 tracks from the master framework plus 2 wrap-arounds), each EPIC containing **Sprints**, each Sprint containing atomic **Tickets**. No timeline. Sequencing is encoded in the dependency graph (§12) and the per-sprint "depends on" lines.

**Naming convention:**
- EPIC: `EPIC-{ID}` where ID is one of `0, A, B, C, D, E, F, G, H` (matches §1.2 table)
- Sprint: `{EPIC-ID}.{N}` (e.g., `A.2`, `D.4`)
- Ticket: `{EPIC-ID}.{Sprint-N}.{Ticket-N}` (e.g., `A.2.3` — EPIC-A, Sprint 2, Ticket 3); for atomic split tickets, append a/b/c (e.g., `A.3.4a`)

**Status icons:**
- 🟢 Done · 🟡 In flight · ⏳ Next · 🔲 Pending · 🔴 Blocked

This is an executable plan, not a road-map sketch. Every ticket below MUST be reviewable in 30-60 minutes, MUST land in one PR, and MUST close one DoD-checked acceptance criterion.

---

## 1. Conventions

### 1.1 Atomic ticket — every ticket carries

- **Files:** what changes, with absolute paths
- **Validation:** test path or concrete check (jest unit / integration / e2e / smoke / manual-verification-procedure with expected output)
- **AC:** reviewer-checkable acceptance criteria (no "tested locally")
- **Deps:** explicit list of prior tickets/sprints required
- **Risk flags:** if any invariant is at risk, called out

### 1.2 The 8 EPICs

| EPIC | Track | One-line goal |
|---|---|---|
| **EPIC-0** | Foundation hardening | Close operator-feedback + foundational debt before EPIC-A → EPIC-F begins |
| **EPIC-A** | Operate | Exam → Score → Result → ReportCard pipeline + period attendance + dashboard daily-activity |
| **EPIC-B** | Communicate | Messaging microservice + parent inbox + SES + notice/announcement subsystem |
| **EPIC-C** | Distribute | Document Rendering Service + School Branding + 4 V1 templates |
| **EPIC-D** | Plan | Subject + GradingPolicy pluggability + PromotionRule + ExternalAssessment family + BLE/SEE/NEB workflows |
| **EPIC-E** | Comply | Flash I/II MVP + Discipline soft + residency + consent + tenant export |
| **EPIC-F** | Generalize | Two-pilot smoke matrix + synthetic GENERIC archetype + Pilot 2 onboarding |
| **EPIC-G** | Operator validation | Champion field trip + weekly operator sync + adoption telemetry |
| **EPIC-H** | Greenlight + hypercare | Real-operator evidence + sign-off + 30-day hypercare |

### 1.3 Sprint-level DoD (per `sprint-plan.md` §11, extended)

A sprint is "Done" when:
- [ ] Every ticket meets per-ticket DoD (§1.1 above + invariants check)
- [ ] Sprint demo recorded or run live against a pilot dev tenant or Saraswati
- [ ] Deploy log committed to `docs/deploys/` for any prod-touching action
- [ ] No regressions in prior sprints' smokes (regression bundle re-run)
- [ ] Closeout note added to `docs/pilot-greenlight/sprint-closeouts.md`

### 1.4 Per-ticket invariant gate (run BEFORE merge)

Lifted from `sprint-plan.md` §10:

- [ ] Audit + event emission paired (Sprint 0.2.7 ESLint rule enforces post-merge)
- [ ] Three-way route registration verified (Nest + tenant-api-prod.json + nginx.template if new prefix)
- [ ] If shared-types changed: minor bump + npm publish + AdminWeb jsdom sim per CLAUDE.md "Per-sprint shared-types publish checklist"
- [ ] If new NestJS module: `module-wiring.spec.ts` updated in same PR
- [ ] If new GSI: `docs/pilot-greenlight/gsi-inventory.md` updated before CDK deploy
- [ ] Invariant 13 grep (no pilot-specific names in code) returns zero hits

### 1.5 Implicit Files: contract (avoids per-ticket repetition; enforced at PR review)

To keep ticket Files: lines focused on the substantive change, the following files are **implicitly part of the Files: list** for every ticket of the matching category and MUST be present in the PR diff:

- **Any new-route ticket** (any `@Get`/`@Post`/`@Patch`/`@Delete` decorator added at a new path):
  - Implicit: `server/lib/tenant-api-prod.json` (always)
  - Implicit: `server/application/reverseproxy/nginx.template` (only if new top-level prefix; sub-paths under existing `/academics`, `/schools`, `/users`, `/tenants`, `/finance` prefixes do NOT need nginx changes)
- **Any new NestJS module ticket** (any new `*.module.ts`): `microservices/<svc>/src/__tests__/module-wiring.spec.ts`
- **Any new entity ticket**: matching Zod schema in `packages/shared-types/src/schemas/<domain>/<entity>.schema.ts`
- **Any new GSI ticket**: `docs/pilot-greenlight/gsi-inventory.md`
- **Any shared-types schema change**: `packages/shared-types/package.json` (version bump); AC adds "AdminWeb jsdom bundle sim green per CLAUDE.md"
- **Any CDK change** (new Lambda, new bucket, new EventBridge rule, new SQS queue): `server/lib/tenant-template/tenant-template-stack.ts` OR `server/lib/shared-infra/shared-infra-stack.ts` (whichever scope) — explicit in the Files: line

A reviewer who sees a new-route ticket without `tenant-api-prod.json` in the PR diff **rejects without further comment**.

---

## 2. EPIC-0 — Foundation Hardening

**Goal:** Close operator-feedback compounding gaps, ship the `archetypeDefaults` entity + academics `auditedWrite` infrastructure that EPICs A–F all depend on, and resolve the v2 D0a/D0b backlog. This is the prerequisite plumbing for everything else.

### Sprint 0.1 — Operator-Feedback Compounding (Saraswati-blocking the moment uploads resume)
**Source:** v2 plan D0a + c4-ops-sprint-plan.md. Saraswati's principal uploads daily; gaps compound row-by-row. Ship in lock-order BEFORE next upload.

**Demo:** Live curl on Saraswati's `/iemis/jobs` returns ≥5 historical jobs; next principal upload populates `motherTongueDescriptor` + `sexDescriptor`; backfill log shows 206/206 rows updated; injected stuck job → 5 min later janitor marks `failed`, SNS fires.

#### Tickets

- **0.1.1** — IEMIS jobs LIST endpoint (ENG-1). **Lock-ordered FIRST**; 0.1.3 depends.
  - Files: `microservices/academics/src/students/students.controller.ts` (`@Get('students/import/iemis/jobs')`); `students.service.ts` (`listIemisImportJobs(schoolId, opts, ctx)`); `server/lib/tenant-api-prod.json`; spec.
  - Validation: jest integration; live curl on Saraswati: returns ≥5 historical jobs sorted `createdAt desc`; ≥1 has `findings[].length > 0`.
  - AC: `GET /academics/students/import/iemis/jobs?schoolId=&since=&limit=&cursor=` returns paginated list; ABAC-scoped per tenant; route-drift lint green; no PII in finding text.
  - Deps: none.

- **0.1.2a** — IEMIS transformer field extension (ENG-2 part 1).
  - Files: `iemis-transform.ts` (lines 240-258 extended to populate `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor`); spec (+4 derivation tests for `deriveSexDescriptor`).
  - Validation: jest unit; live next IEMIS upload lands with `sexDescriptor` populated.
  - AC: All 4 target fields populated when source XLSX provides them; existing 133 academics tests stay green; entity-vs-schema contract test extended for Student.
  - Deps: none.

- **0.1.2b** — IEMIS descriptor lookup tables (ENG-2 part 2).
  - Files: `iemis-transform.ts` — `mapMotherTongueToEdFi`, `mapDisabilityToEdFi` lookup tables (Ed-Fi `LanguageDescriptor` + `DisabilityDescriptor` namespaces); spec (+12 mapper tests: known/unknown/mixed-case/empty per mapper).
  - Validation: jest unit; unknown values emit warning to `IemisImportJob.findings[]`, not rejection.
  - AC: Lookup tables reviewed against Ed-Fi spec; unknowns warned not rejected; CEHRD-Nepal-specific values resolved (Maithili, Bhojpuri, Tharu, Newari, etc.); audit trail on every lookup hit.
  - Deps: 0.1.2a.

- **0.1.3** — IEMIS backfill script for Saraswati's 206 historical rows.
  - Files: `scripts/backfill-iemis-derived-fields-saraswati.ts` (NEW); reads jobs via 0.1.1; re-reads original XLSX from S3; computes derived fields via 0.1.2; PATCHes each Student; `--dry-run` (default) prints diff; `--apply` writes.
  - Validation: dry-run prints all 206 diffs; user approves; `--apply` writes; post-apply GET asserts populated fields.
  - AC: 206 rows updated where XLSX provided source values; PATCH log archived to `docs/deploys/prod-backfill-saraswati-iemis-<ts>-<sha>.log`; idempotent on re-run.
  - Deps: 0.1.1 + 0.1.2b.

- **0.1.4** — IEMIS Job Janitor Lambda (BL-1; mirrors rollup-janitor pattern).
  - Files: `server/lib/analytics/lambda/iemis-job-janitor/janitor-lambda.ts` (existing dir; verify NEW vs replace existing); `server/lib/tenant-template/tenant-template-stack.ts` (CDK wiring); EventBridge Scheduler `cron(*/5 * * * ? *)`.
  - Validation: unit on marker logic; integration: inject stuck row → next cron run marks `failed` + SNS notify.
  - AC: Cron schedule visible in EventBridge Scheduler console (not Lambda Triggers tab); SNS subscription captures alerts; no false-positives on legitimate <30min jobs.
  - Deps: none.

- **0.1.5** — XLSX strict-header validation (BL-2).
  - Files: `iemis-transform.ts` — `validateIemisHeaders(headers: string[])`; required columns from `IemisRow` enforced; unknown columns warn; missing required columns reject 400 `IEMIS_HEADERS_INVALID`.
  - Validation: jest unit; integration: upload XLSX missing `Gender` → 400 with structured detail listing missing headers.
  - AC: Header-rename detection before row processing; warnings vs rejections differentiated; CEHRD-source files pass cleanly.
  - Deps: 0.1.2a.

### Sprint 0.2 — Operator-Feedback Non-Compounding (parallel with 0.1)
**Source:** v2 plan D0b. Resolve gaps that don't compound with operator activity.

**Demo:** Cross-tenant 403; Bug 2 spike report committed (or "not-repro" verdict); NO_CURRENT_AY UI CTA shows; PATCH session date → paired GP updated; pilot-greenlight harness 7/7 with seed-pilot-terms.ts removed; ESLint rule catches deliberately-mismatched commit.

#### Tickets

- **0.2.1** — `AccessDeniedException` → 403 with `CROSS_TENANT_FORBIDDEN`.
  - Files: `microservices/identity/src/common/services/dynamodb-client.service.ts` (wrap `getItem`/`query`/`putItem`/`updateItem`/`deleteItem`/`batchWrite`); integration test.
  - Validation: jest integration negative: JWT-tenant-A → request tenant-B → expect 403, not 500.
  - AC: 403 + structured `errorCode` per invariant 7; `details` carries requested-vs-session tenant IDs (PII redacted); same-tenant calls unaffected.
  - Deps: none.

- **0.2.2** — Bug 2 spike: `/finance/invoices` cross-tenant settings request.
  - Files: None initially (spike). Outputs `docs/pilot-greenlight/d0b-bug2-spike.md` + follow-up ticket if reproducible.
  - Validation: repro documented; or "not-repro" verdict closes.
  - AC: Either a `0.2.2-fix` ticket lands in next sprint review, or 0.2.2 closes "not-repro" with operator-side localStorage hygiene as workaround.
  - Deps: none.

- **0.2.3** — `NO_CURRENT_AY` UX (frontend CTA).
  - Files: `edforge-saas-frontend/.../useCurrentAcademicYear()`; CTA component.
  - Validation: manual: AY with `status=active, isCurrent=false` → UI shows "Set a current AY" CTA pointing at AY list with "Set current" button.
  - AC: Operator self-recovers without engineer involvement.
  - Deps: none.

- **0.2.4** — `updateSession` syncs dates to paired GradingPeriod.
  - Files: `microservices/identity/src/schools/academic-session.service.ts` (`updateSession` path); spec extension.
  - Validation: jest unit: PATCH session dates → paired GP dates updated. Smoke: PATCH `dev-pabson-primary` session date → GP updated.
  - AC: Session date PATCH propagates; failure non-fatal (consistent with PR #129 auto-pair); audit row per change.
  - Deps: none.

- **0.2.5** — `deleteSession` cascade + DELETE `/grading-periods/:termId`.
  - Files: `academic-session.service.ts` (`deleteSession` cascade); `academic-years.service.ts` (NEW `deleteGradingPeriod`); `academic-years.controller.ts` (NEW `@Delete('grading-periods/:termId')`); routes three-way.
  - Validation: jest integration; live: clean up smoke artifact `PR129-SMOKE-DELETEME` GP in `dev-pabson-primary`.
  - AC: DELETE session cascades to paired GP; new GP DELETE route works standalone; transactional (TransactWriteItems if same table); route-drift lint green.
  - Deps: none.

- **0.2.6** — Retire `seed-pilot-terms.ts`.
  - Files: delete `scripts/pilot-greenlight/seed-pilot-terms.ts`; update `scripts/smoke-tests/pilot-greenlight.ts` to drop SETUP step.
  - Validation: re-run harness against `dev-pabson-primary` → still 7/7 (sessions auto-pair GPs at create-time via PR #129).
  - AC: Script removed; harness still 7/7; no regression.
  - Deps: 0.2.4 + 0.2.5.

- **0.2.7** — ESLint rule: `auditedWrite` ↔ `publishValidatedEvent` pairing.
  - Files: `eslint-rules/audited-write-event-pair.js` (NEW; AST walk); CI integration; tests.
  - Validation: CI fails on a deliberately mismatched commit.
  - AC: Lint catches missing-emit-after-audited-write.
  - Deps: none.

- **0.2.8** — BS date picker hygiene PR.
  - Files: `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` (branded types R1; error handling R3; boundary tests R4; dual AD/BS validation R5).
  - Validation: frontend unit + Playwright on each BS-date entry surface.
  - AC: Per audit follow-up doc; no behavior change observable from outside the picker.
  - Deps: none.

- **0.2.9** — Identity `workspace-settings.entity.ts` `COUNTRY_DEFAULTS` sync-guard test.
  - Files: `server/application/microservices/identity/src/common/entities/__tests__/workspace-settings-country-defaults.sync.spec.ts` (NEW); asserts hardcoded `COUNTRY_DEFAULTS` at `workspace-settings.entity.ts:121` matches canonical export at `packages/shared-types/src/locale/tenant-locale-defaults.ts:74`.
  - Validation: CI test fails if identity-side copy drifts from shared-types.
  - AC: Drift detection at CI time; addresses CLAUDE.md-noted duplication.
  - Deps: none.

- **0.2.10** — Entity-vs-schema contract test pattern extended.
  - Files: Contract test for Staff, Student, AcademicYear, Term, BellSchedule, CalendarBlock entities (mirroring `calendar-date.contract.spec.ts`).
  - Validation: each contract test asserts entity factory output exactly matches Zod schema parsed output.
  - AC: 6 new contract specs; CI gates.
  - Deps: none.

- **0.2.11** — Grading-period markers on calendar grid (frontend).
  - Files: `edforge-saas-frontend/apps/shell/src/components/calendar/MonthGrid.tsx` — visual decorators showing term boundaries.
  - Validation: Playwright e2e against `dev-pabson-primary` 4-term layout.
  - AC: Term boundaries visible; matches PABSON 4-quarter structure; no regression on existing block overlay.
  - Deps: none.

- **0.2.12** — Playwright E2E auth setup → CI integration.
  - Files: `edforge-saas-frontend/e2e/auth-setup/cognito-storage-state.ts` (NEW); GH Actions wiring; `EDFORGE_PROD_JWT` env removed.
  - Validation: existing `calendar-blocks.spec.ts` runs against `dev-pabson-primary` from CI.
  - AC: Playwright suite runs unattended in CI; no manual JWT-paste.
  - Deps: none.

- **0.2.13** — Finance widen to tenant-currency.
  - Files: `credit-note.entity.ts`, `fee-structure.entity.ts`, `refund-request.entity.ts` — replace NPR literal with `string` sourced from `SchoolConfiguration.currency`; shared-types schemas widened.
  - Validation: existing NPR data continues to validate; integration with synthetic GENERIC fixture shows USD passes.
  - AC: Three entities no longer carry NPR literal; existing Saraswati finance rows unaffected.
  - Deps: none.

- **0.2.14** — `dev-pabson-primary` SchoolConfiguration cleanup audit.
  - Files: none — read-only audit.
  - Validation: `GET /schools/:id/configuration` against every school in `dev-pabson-primary`; assert PABSON defaults (NPR, Asia/Kathmandu, bikram_sambat).
  - AC: Tenant clean; or cleanup ticket scoped before EPIC-A starts.
  - Deps: none.

### Sprint 0.3 — Academics Audit + Module-Wiring Infrastructure
**Source:** v2 plan Risk R17 + R19. Academics service is missing `auditedWrite` infrastructure (identity has it) AND `module-wiring.spec.ts`. Block for K.5 multi-school.

**Demo:** Academics module-wiring spec fails on a deliberate "forgot import" mutation; passes on main. Direct DDB writes in academics replaced with `auditedWrite` calls; audit-row count matches write count post-Sprint-0.3.

#### Tickets

- **0.3.1** — Port `AuditedWriteService` from identity to academics.
  - Files: `microservices/academics/src/common/services/audited-write.service.ts` (NEW; mirrors identity); `academics.module.ts` registers.
  - Validation: unit on service; integration on an existing academics write path that uses it.
  - AC: Service exists; module-wired; one example consumer in academics calls it.
  - Deps: none.

- **0.3.2** — Academics `module-wiring.spec.ts`.
  - Files: `microservices/academics/src/__tests__/module-wiring.spec.ts` (NEW; mirrors identity's).
  - Validation: spec fails on deliberate "forgot import" mutation; passes on main.
  - AC: ~150 LOC; CI gates.
  - Deps: none.

- **0.3.3** — Migrate Grades writes to `auditedWrite`.
  - Files: `microservices/academics/src/grades/grades.service.ts` — every `dynamoDb.putItem/updateItem/deleteItem` → `auditedWrite`.
  - Validation: integration — write 10 grades → 10 audit rows visible via audit API.
  - AC: All Grade writes audited; existing tests stay green.
  - Deps: 0.3.1.

- **0.3.4** — Migrate Attendance writes to `auditedWrite`.
  - Files: `microservices/academics/src/attendance/attendance.service.ts` + `section-attendance.service.ts`.
  - Validation: integration — write attendance → audit rows.
  - AC: All attendance writes audited.
  - Deps: 0.3.1.

- **0.3.5** — Migrate Sections + Courses + CourseOffering + Classwork writes to `auditedWrite`.
  - Files: respective service files in academics.
  - Validation: integration per module.
  - AC: All writes audited.
  - Deps: 0.3.1.

- **0.3.6** — CourseOffering event emission gap close (invariant 6).
  - Files: `course-offering.service.ts` adds `publishCourseOfferingCreated/Updated/Deleted` via `eventsService`. Legacy PascalCase OK pre-Sprint-B.2.
  - Validation: 3 emission tests.
  - AC: Every CourseOffering write emits one event.
  - Deps: 0.3.1.

- **0.3.7** — Academics 404 → structured `errorCode` hardening.
  - Files: Classwork/Grades/Sections/Courses — replace `NotFoundException` with structured `errorCode` per `NO_CURRENT_AY` pattern.
  - Validation: integration negative per module (404 returns `{ statusCode, errorCode, message, details }`).
  - AC: 4 modules hardened.
  - Deps: none.

### Sprint 0.4 — `ArchetypeDefaults` Entity
**Foundation for everything in EPIC-D (Plan).** Today archetype defaults are implicit in code; EPIC-D entities need explicit lookup.

**Demo:** `GET /archetype-defaults?archetype=PABSON` returns canonical PABSON profile (gradeLadder, boardExams, gpaScale, examPattern, complianceForms, internalAssessmentWeights, language, currency, calendarSystem, weekStart). Synthetic `GENERIC` profile also resolvable.

#### Tickets

- **0.4.1** — `ArchetypeDefaults` schema + entity.
  - Files: `packages/shared-types/src/schemas/archetype-defaults.schema.ts` (NEW); `microservices/identity/src/common/entities/archetype-defaults.entity.ts` (NEW). Schema covers: `archetype` (enum), `gradeLadder[]`, `boardExams[]` (with `{examType, grade, authority, internalWeight, externalWeight}`), `gpaScale` (4.0 default), `letterGrades[]` (with bands), `examPattern[]` (e.g., `[unit_test, terminal, send_up, pre_board]`), `complianceForms[]`, `language[]`, `currency`, `calendarSystem`, `weekStart`, `defaultMission?`, `defaultExamRulesText?`.
  - Validation: schema unit; entity-vs-schema contract test.
  - AC: Schema covers all known archetype-shaped fields; contract test green; module-wiring updated.
  - Deps: none.

- **0.4.2** — `ArchetypeDefaults` PABSON profile seed.
  - Files: `packages/shared-types/src/archetype-defaults/pabson.ts` (NEW). PABSON profile: gradeLadder=[ECD,PPC,KG,1..10], boardExams=[BLE@8 (municipal, 0.5/0.5), SEE@10 (NEB, 0.25/0.75), NEB-11@11 (NEB, 0.25/0.75), NEB-12@12 (NEB, 0.25/0.75)], gpaScale=4.0, letterGrades=[A+/A/B+/B/C+/C/D+/D/E with CEHRD bands], examPattern=[unit_test, terminal, send_up, pre_board, final], complianceForms=[IEMIS_FLASH_I, IEMIS_FLASH_II, FORM_19_SOFT], language=[en-NP,ne-NP], currency=NPR, calendarSystem=bikram_sambat, weekStart=sunday.
  - Validation: jest schema-validation; PABSON-specific tests.
  - AC: Profile passes schema; importable from `@aibrains/shared-types`.
  - Deps: 0.4.1.

- **0.4.3** — `ArchetypeDefaults` GENERIC profile seed (for EPIC-F generalization).
  - Files: `packages/shared-types/src/archetype-defaults/generic.ts` (NEW). GENERIC: gradeLadder=[K,1..12], boardExams=[], gpaScale=4.0, letterGrades=[A/B/C/D/F], examPattern=[unit_test, terminal, final], complianceForms=[], language=[en-US], currency=USD, calendarSystem=gregorian, weekStart=monday.
  - Validation: jest schema-validation.
  - AC: Profile passes schema; used in EPIC-F synthetic smoke.
  - Deps: 0.4.1.

- **0.4.4** — `ArchetypeDefaults` loader service.
  - Files: `microservices/identity/src/archetype-defaults/archetype-defaults.service.ts` (NEW); module-wired.
  - Validation: unit: `getDefaults('PABSON')` → PABSON profile; `getDefaults('GENERIC')` → GENERIC; `getDefaults('UNKNOWN')` → 404 `ARCHETYPE_NOT_FOUND`.
  - AC: Cached at module init (read once); thread-safe; module-wiring updated.
  - Deps: 0.4.2 + 0.4.3.

- **0.4.5** — `GET /archetype-defaults?archetype=` endpoint.
  - Files: `archetype-defaults.controller.ts` (NEW); routes three-way (`/archetype-defaults` new prefix → new nginx block).
  - Validation: integration; route-drift lint.
  - AC: Endpoint returns archetype defaults; ABAC: TenantAdmin read-only.
  - Deps: 0.4.4.

- **0.4.6** — Invariant 12 amendment + lint regression spec.
  - Files: `scripts/lint/check-invariant-12.sh` (NEW); allowlist for boundary drivers (`iemis-transform.ts`, future SES adapter, etc.); CI gate.
  - Validation: lint runs against `server/application/microservices/*/src/`; allowlisted files excluded; other files with `archetype` literals fail.
  - AC: CI enforces; failures structured.
  - Deps: 0.4.4.

---

## 3. EPIC-A — Operate (Exam → Result → ReportCard pipeline + daily-use)

**Goal:** Saraswati's full term-end workflow runs end-to-end on EdForge: operator defines exam schedule → teachers enter marks → system computes result → report card rendered + distributed.

### Sprint A.1 — Daily-Use Coverage Improvements (audit-driven)
**Source:** v2 plan D1 rescoped per daily-use audit. Per-period attendance moved to A.5 (post-Greenlight).

**Demo:** Principal sees 3 new cards on dashboard above-the-fold (recent classwork, grades yesterday, sections-attendance-taken). Co-teacher UI ships in SectionForm if Saraswati operator confirms. Inter-section transfer endpoint atomic.

#### Tickets

- **A.1.1** — Dashboard daily-activity surfaces.
  - Files: `microservices/academics/src/dashboard/dashboard.service.ts` extends `getOverview` with `recentClassworkCount`, `recentGradeCount`, `sectionsWithAttendanceTaken`; DTO updated; AdminWeb cards.
  - Validation: integration: seeded classwork + grades + attendance → counts match; manual: principal sees cards.
  - AC: 3 new fields on overview DTO; cards visible on dashboard.
  - Deps: 0.3.1 (uses `auditedWrite` audit-row counts for some queries).

- **A.1.2** — Co-teacher UI in SectionForm (conditional on operator confirmation).
  - Files: `edforge-saas-frontend/.../SectionForm.tsx` — multi-select `coTeacherIds`.
  - Validation: Playwright e2e: create section with co-teacher → backend persists `coTeacherIds[]`.
  - AC: UI exposes co-teacher select; backend already supports field; defer if Saraswati confirms single-teacher norm.
  - Deps: champion field visit confirms co-teaching practice (EPIC-G.1).

- **A.1.3** — Within-school inter-section transfer endpoint.
  - Files: `microservices/academics/src/sections/sections.controller.ts` (`@Post(':id/transfer')`); service implements atomic TransactWriteItems drop+add; emits `StudentTransferredBetweenSections`; three-way handoff.
  - Validation: integration: transfer 3 students from 8A to 8B → both sections updated atomically; partial failure rolls back.
  - AC: Single-call atomic transfer; audit + event per transfer.
  - Deps: 0.3.1.

### Sprint A.2 — Subject Entity + Curriculum Foundation
**Source:** Framework Track D-Plan D1; new. Today `Course.subjectArea` is an enum mixing subject + course-type. A canonical `Subject` entity decouples subject-of-study from course-instance.

**Demo:** `GET /subjects?archetype=PABSON&grade=8` returns CDC-aligned subject list (Nepali, English, Mathematics, Science, Social Studies, Health/Physical/Creative Arts, Computer Sci, optionals). Operator can assign a Subject to a Course; mark-entry routes through `(subject, course, exam)`.

#### Tickets

- **A.2.1** — `Subject` entity + schema.
  - Files: `packages/shared-types/src/schemas/identity/subject.schema.ts` (NEW); `microservices/identity/src/common/entities/subject.entity.ts` (NEW). Fields: `subjectId`, `schoolId`, `code` (CDC subject code), `name`, `nameLocalized?`, `gradeLevels[]`, `isCore` (boolean), `isCompulsory` (boolean), `archetypeDefaultId?` (ref to ArchetypeDefaults seed).
  - Validation: entity unit; contract test.
  - AC: Factory + contract green; module-wiring updated; Ed-Fi alignment: maps to `AcademicSubjectDescriptor` + `LearningStandard`.
  - Deps: 0.4.1.

- **A.2.2** — Subject CRUD endpoints.
  - Files: `subjects.controller.ts` (NEW); POST/GET/LIST/PATCH/DELETE; three-way handoff (`/subjects` new prefix).
  - Validation: integration per endpoint.
  - AC: Endpoints work; audit + event per write.
  - Deps: A.2.1 + 0.3.1.

- **A.2.3** — Course-to-Subject reference.
  - Files: `Course.subjectId` added (`microservices/academics/src/common/entities/course.entity.ts`); migration script for existing courses (auto-map by `subjectArea` enum to corresponding default Subject); backward-compat: `subjectArea` enum kept as denormalization.
  - Validation: integration: existing courses retain `subjectArea`; new courses require `subjectId`; migration script idempotent.
  - AC: Existing courses unaffected; new course creation enforces `subjectId`.
  - Deps: A.2.1.

- **A.2.4** — PABSON Subject seed for archetype defaults.
  - Files: `packages/shared-types/src/archetype-defaults/pabson-subjects.ts` (NEW); CDC-aligned subjects per grade band (basic 1-3 integrated; 4-8 subject-based; 9-10 SEE-prep).
  - Validation: jest seed-shape; loaded by tenant-seeder Lambda on provisioning.
  - AC: PABSON tenant on provision has Subject rows seeded; Saraswati can backfill via script.
  - Deps: A.2.1 + 0.4.2.

- **A.2.5** — Saraswati Subject backfill script.
  - Files: `scripts/backfill-pabson-subjects-saraswati.ts` (NEW); reads from PABSON archetype seed; writes to Saraswati school.
  - Validation: dry-run + `--apply`; idempotent.
  - AC: 14 (or per Saraswati actual count) subjects exist post-backfill.
  - Deps: A.2.4.

### Sprint A.3 — Exam Subsystem Backend
**Source:** v2 plan D2. First-class `Exam` + `ExamSubject` + `ExamScore`.

**Demo:** Operator creates Term-1 exam on `dev-pabson-primary`, adds 5 subjects, enters scores for 10 enrollments (single + bulk), closes exam. Audit + events captured. Saraswati Term-1 follows when its exam window opens.

#### Tickets

- **A.3.1** — Curriculum / subjects readiness audit (doc).
  - Files: `docs/pilot-greenlight/a3-curriculum-readiness-audit.md` (NEW).
  - Validation: confirms A.2 shipped + Saraswati subjects backfilled.
  - AC: Audit committed; readiness confirmed OR follow-up scoped.
  - Deps: A.2.1–A.2.5.

- **A.3.2** — `Exam` entity.
  - Files: `microservices/academics/src/common/entities/exam.entity.ts` (NEW). Fields: `examId`, `examName`, `termId`, `examType` (from ArchetypeDefaults.examPattern enum), `startDate`, `endDate`, `status` (draft/scheduled/in_progress/closed/published); GSIs by `termId`, by `status`; lowercase attribute names per S3.2.
  - Validation: entity unit + contract test; `gsi-casing-contract.spec.ts` extended.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: A.2.1 + 0.3.1 + 0.4.4.

- **A.3.3** — `ExamSubject` entity.
  - Files: `exam-subject.entity.ts` (NEW). Fields: `examSubjectId`, `examId`, `subjectId`, `maxMarks`, `passingMarks` (defaults from SchoolConfiguration), `creditHours`.
  - Validation: entity tests; FK validation on create (against Subject from A.2.1).
  - AC: FK validation; module-wiring updated.
  - Deps: A.2.1 + A.3.2.

- **A.3.4** — `ExamScore` entity (keyed by `enrollmentId` per invariant 3).
  - Files: `exam-score.entity.ts` (NEW). Fields: `examScoreId`, `examId`, `examSubjectId`, `enrollmentId`, `rawScore`, `status` (entered/locked), `enteredBy`, `enteredAt`.
  - Validation: entity tests + cross-AY query via GSI2.
  - AC: References `enrollmentId` not `(studentId, examId)`; cross-year aggregation works.
  - Deps: A.3.3.

- **A.3.5** — Exam CRUD endpoints.
  - Files: `exams.controller.ts` (NEW); POST/GET/LIST `/exams`; three-way handoff (new prefix `/exams` → new nginx block).
  - Validation: jest integration; live curl through API GW + nginx + Nest post-deploy.
  - AC: 2xx validated; audit + event emit; route registered all 3 places.
  - Deps: A.3.2.

- **A.3.6** — ExamSubject CRUD endpoints.
  - Files: `exams.controller.ts` extended or `exam-subjects.controller.ts`; POST/GET/LIST `/exams/:examId/subjects`; subject-add validates against curriculum.
  - Validation: integration; FK rejection negative test.
  - AC: Validates against Subject; 4xx on invalid `subjectId`.
  - Deps: A.3.3 + A.3.5.

- **A.3.7** — ExamScore CRUD endpoints.
  - Files: `exam-scores.controller.ts` (NEW); POST `/exams/:examId/scores` (single); GET; LIST with filter.
  - Validation: integration.
  - AC: Validates `0 ≤ rawScore ≤ maxMarks`; 409 if `exam.status === 'closed'`; 404 on missing FKs.
  - Deps: A.3.4 + A.3.5.

- **A.3.8** — Exam state machine.
  - Files: `exams.controller.ts` (PATCH `/exams/:examId/status`); state-machine util.
  - Validation: integration: every valid transition + every invalid transition returns 409 `EXAM_STATE_INVALID_TRANSITION`.
  - AC: Transitions audited + events; idempotent re-call returns 200 not 409.
  - Deps: A.3.5.

- **A.3.9** — Bulk score entry chunked at 100.
  - Files: `exam-scores.service.ts` chunked TransactWriteItems; idempotency via correlation ID. POST `/exams/:examId/scores/bulk`.
  - Validation: integration with 250-score payload; retry idempotent.
  - AC: Atomic per chunk; failure rolls back chunk not whole bulk; ONE `exam.scores_recorded` event per chunk with `count` in payload.
  - Deps: A.3.7.

- **A.3.10** — Score validation Zod schema.
  - Files: `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (NEW).
  - Validation: schema unit + integration negatives.
  - AC: 4xx errors structured per project errorCode schema.
  - Deps: A.3.4.

- **A.3.11** — Pilot exam smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-exam-flow.ts` (NEW); accepts `PILOT_ID`.
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Full exam lifecycle complete; audit + events at every step.
  - Deps: A.3.1–A.3.10.

### Sprint A.4 — Result Subsystem Backend
**Source:** v2 plan D3. After `exam.closed`, generate per-student per-term `ResultCard` rows.

**Demo:** Close Term-1 exam on `dev-pabson-primary`. 10 ResultCards generated by Lambda within 30s. Add conduct + remark on 5 cards. Publish all 10. `result.published` events appear on bus + event-log.

#### Tickets

- **A.4.1** — Term-aggregation rules engine (pure function, archetype-blind).
  - Files: `microservices/academics/src/results/term-aggregation.service.ts` (NEW); reads `gradingScale` from `SchoolConfiguration` (via `archetypeDefaults` lookup); per-term weighted GPA.
  - Validation: unit tests with PABSON 32-pass gradingScale + synthetic; property test (monotonic raw → monotonic GPA); **explicit archetype-grep assertion: `grep -rn 'archetype' microservices/academics/src/results/` returns zero hits**.
  - AC: Engine fully data-driven; zero `tenant.archetype` reads; archetype-grep CI check passes.
  - Deps: 0.4.4 + A.3.2.

- **A.4.2** — `ResultCard` entity.
  - Files: `result-card.entity.ts` (NEW). Fields: `cardId`, `enrollmentId`, `termId`, `examId`, `subjectScores: [{subjectId, score, grade, gpa}]`, `totalScore`, `termGpa`, `classRank`, `sectionRank`, `conduct`, `classTeacherRemark`, `publishedAt`, `publishedBy`, `status` (draft/published).
  - Validation: entity tests; keyed by `enrollmentId`; entity-vs-schema contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: A.3.4.

- **A.4.3** — Batch result generation Lambda.
  - Files: `server/lib/result-generation/result-batch-lambda.ts` (NEW); CDK wiring in `tenant-template-stack-basic`; EventBridge rule on `exam.closed`.
  - Validation: Lambda unit + integration via EventBridge.
  - AC: 200 enrollments → 200 cards in <30s p50 / <90s p95; DLQ catches Lambda failures; CloudWatch alarm on DLQ depth ≥1; cold-start latency budgeted ≤45s.
  - Deps: A.4.1 + A.4.2.

- **A.4.4** — Conduct + class-teacher-remark endpoints.
  - Files: `conduct.controller.ts` (NEW); PATCH `/result-cards/:id/conduct`; three-way (new `/result-cards` prefix → new nginx block).
  - Validation: integration; audit per write.
  - AC: Field updates; audit + event per write.
  - Deps: A.4.2.

- **A.4.5** — Publication state machine.
  - Files: `result-cards.service.ts`; draft→published writes `publishedAt`, `publishedBy`; emits `result.published`.
  - Validation: integration + unit: cannot un-publish; cannot publish twice (409 `RESULT_ALREADY_PUBLISHED`).
  - AC: State transition audited + event.
  - Deps: A.4.2.

- **A.4.6** — Cross-year publication regression test (invariant 3 guard).
  - Files: integration spec.
  - Validation: scenario — prior-AY Term-1 result published after next-AY created. Assert card has `enrollmentId` referencing prior-AY enrollment; cross-year aggregation via GSI2 returns both.
  - AC: Cards stay coupled to correct AY; no enrollment-id mismatches.
  - Deps: A.4.2 + A.4.5.

- **A.4.7** — Pilot result smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Full result lifecycle; events on bus.
  - Deps: A.4.1–A.4.6.

### Sprint A.5 — Period Attendance + Timetable (V1.5 candidate)
**Source:** v2 plan Phase J. Per-period attendance + Timetable + Substitute. Daily-use audit found this as #1 gap, but Saraswati's class-teacher daily-attendance model works for Term-1; defer to post-Greenlight.

**Demo:** Teacher marks per-period attendance for Grade 10 section A for a week including holiday-block + exam-day. Grid shows correct states. Rollup respects holidays. Substitute teacher day-assignment.

#### Tickets

- **A.5.1** — `Timetable` entity (identity service).
  - Files: `microservices/identity/src/common/entities/timetable.entity.ts` (NEW). Key shape `SCHOOL#schoolId#TIMETABLE#{ayId}#{termId}#{dayOfWeek}#{periodId}` → `{sectionId, primaryTeacherId, locationId}`.
  - Validation: entity unit; contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.3.1.

- **A.5.2** — Timetable CRUD endpoints.
  - Files: `timetable.controller.ts` (NEW); three-way handoff (new prefix `/schools/:id/timetable` → new nginx block).
  - Validation: integration.
  - AC: CRUD + audit + event.
  - Deps: A.5.1.

- **A.5.3** — Timetable UI grid (frontend).
  - Files: `edforge-saas-frontend/.../Timetable/Grid.tsx` (NEW). Weekly grid drag-section into period×day.
  - Validation: Playwright e2e on `dev-pabson-primary`.
  - AC: Grid functional; "my day" teacher view derives from grid.
  - Deps: A.5.2.

- **A.5.4** — Period-attendance validation: in-bell-schedule + academic-scope.
  - Files: `attendance.service.ts` `recordPeriodAttendance` validates `classPeriodId` exists in active bell schedule + parent shift has `scope === 'academic'`.
  - Validation: 3 integration negatives — invalid period (400 `PERIOD_NOT_IN_BELL_SCHEDULE`); non-academic shift period (400 `PERIOD_NOT_ACADEMIC`); exam-day variant resolution.
  - AC: Both errorCodes distinct; exam-day variant correct.
  - Deps: A.5.1.

- **A.5.5** — Day-rollup engine (pure function).
  - Files: `attendance-rollup.service.ts` (NEW); unit tests.
  - Validation: table-driven jest; ≥90% line coverage.
  - AC: Deterministic; pure; no DDB reads in rollup fn.
  - Deps: A.5.4.

- **A.5.6** — Holiday-aware day-rollup.
  - Files: `attendance-rollup.service.ts` extended; reads CalendarDate by date.
  - Validation: integration with each of Saraswati's 6 multi-day blocks + weekends + 13 holidays + 9 programs.
  - AC: Rollup correct for all calendar event types.
  - Deps: A.5.5.

- **A.5.7** — Per-period grid UI.
  - Files: `edforge-saas-frontend/apps/academics/src/Attendance/PerPeriodGrid.tsx` (NEW); `e2e/per-period-attendance.spec.ts`.
  - Validation: Playwright e2e + manual smoke when in-person classes start.
  - AC: Per-period state via UI; rollup updates live; handles 8 PABSON Shift-2 periods + exam-day 4-block; Shift-1 non-academic hidden; mobile-responsive.
  - Deps: A.5.4–A.5.6.

- **A.5.8** — Per-period analytics aggregation.
  - Files: `microservices/academics/src/dashboard/per-period-analytics.service.ts` (NEW); `GET /analytics/per-period?schoolId=&termId=`; three-way.
  - Validation: integration with seeded period-attendance.
  - AC: 5-min cache per CLAUDE.md analytics convention; p95 <500ms.
  - Deps: A.5.4.

- **A.5.9** — Substitute-teacher day assignment.
  - Files: `microservices/identity/src/schools/substitute-assignment.controller.ts` (NEW); POST `/schools/:id/timetable/substitutes`; resolver prefers sub over base timetable for the day; three-way.
  - Validation: integration: assign sub → attendance on that period attributed to sub.
  - AC: Sub assignment audited + event.
  - Deps: A.5.1.

- **A.5.10** — Pilot real-data attendance smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-attendance-week.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Per-period writes correct; rollups correct; p95 <500ms; audit clean.
  - Deps: A.5.4–A.5.9.

---

## 4. EPIC-B — Communicate (Messaging Microservice + Parent Inbox + SES)

**Goal:** Saraswati's parents and students receive in-app notifications + optional email for: child absent, invoice due, result published, school notice. SMS deferred to V2.

### Sprint B.1 — Messaging Microservice Foundation
**Demo:** New `messaging` microservice deployed; entity tests pass; `GET /messaging/health` returns 200; module-wiring spec green; placeholder routes registered three-way.

#### Tickets

- **B.1.1** — New `messaging` microservice scaffold.
  - Files: `server/application/microservices/messaging/` (NEW directory); `Dockerfile.messaging`; `messaging.module.ts`; `messaging.controller.ts` (placeholder `@Get('health')`); `tenant-template-stack-basic` adds messaging ECS service; nginx new prefix `/messaging`.
  - Validation: `nest build messaging` green; health endpoint live post-deploy.
  - AC: Service scaffolded; deployed to dev tenant; module-wiring spec exists from day-1 (`microservices/messaging/src/__tests__/module-wiring.spec.ts`).
  - Deps: 0.3.2 (academics pattern for module-wiring).

- **B.1.2** — `Message` entity (inbox).
  - Files: `messaging/src/common/entities/message.entity.ts` (NEW). Fields: `messageId`, `recipientUserId`, `senderUserId?`, `tenantId`, `schoolId?`, `category` (announcement/attendance/grades/messages/billing/security per `user.entity.ts:68-102` taxonomy), `subject`, `body`, `payloadJson?`, `status` (queued/delivered/read), `deliveredAt?`, `readAt?`, `createdAt`. GSI1 by recipient (`USER#userId / MESSAGE#status#createdAt`).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green.
  - Deps: B.1.1.

- **B.1.3** — `Conversation` entity (thread, V1 minimal).
  - Files: `conversation.entity.ts` (NEW). Fields: `conversationId`, `tenantId`, `participantUserIds[]`, `category`, `lastMessageAt`, `lastMessageId`. V1 supports 1:1 only; group threads V2.
  - Validation: entity unit.
  - AC: Factory; messages reference `conversationId`.
  - Deps: B.1.2.

- **B.1.4** — Read receipts.
  - Files: `messages.service.ts` `markAsRead(messageId, userId)`; updates `readAt`; emits `message.read`.
  - Validation: integration: mark read → readAt set + event emitted.
  - AC: Idempotent re-mark returns 200.
  - Deps: B.1.2.

- **B.1.5** — Messaging audit infrastructure.
  - Files: `messaging/src/common/services/audited-write.service.ts` (mirrors academics A.3.1).
  - Validation: integration: write message → audit row.
  - AC: All Message writes audited.
  - Deps: B.1.2 + 0.3.1 (pattern reference).

### Sprint B.2 — Notification Event Taxonomy Extension
**Demo:** Six new event schemas in registry; `EventServiceBase` validates them; lint catches unregistered emission.

#### Tickets

- **B.2.1** — Notification event schemas.
  - Files: `packages/shared-types/src/events/notification/notification.ts` (NEW; 6 schemas: `notification.queued`, `notification.delivered`, `notification.failed`, `message.created`, `message.read`, `notice.published`).
  - Validation: jest schema unit.
  - AC: Schemas added to taxonomy registry; `EVENT_REGISTRY` size grows from 25 → 31.
  - Deps: B.1.1.

- **B.2.2** — Academics PascalCase → snake-dotted migration (deferred from C0.c).
  - Files: `microservices/academics/src/common/services/academics-events.service.ts` — switch `AttendanceRecorded` etc to `attendance.recorded`. Backward-compat alias retained 1 sprint then removed in B.2.3.
  - Validation: integration: event-log sees `attendance.recorded` shape; legacy `AttendanceRecorded` no longer emitted by new code.
  - AC: All ~30 academics emit-sites migrated.
  - Deps: B.2.1.

- **B.2.3** — Delete backward-compat aliases.
  - Files: `academics-events.service.ts` cleanup.
  - Validation: CI scan: zero `AttendanceRecorded` / `GradeRecorded` etc. in emit-call sites.
  - AC: Aliases removed; legacy event names deprecated.
  - Deps: B.2.2 (one sprint later).

### Sprint B.3 — EventBridge Rules + Notification Fan-out
**Demo:** Domain event `attendance.recorded(absent)` fires → EventBridge rule routes to `messaging-fanout` Lambda → Lambda creates Message in inbox + emits `notification.queued`.

#### Tickets

- **B.3.1** — `messaging-fanout` Lambda.
  - Files: `server/lib/messaging-fanout/fanout-lambda.ts` (NEW); CDK wiring; subscribes to `attendance.recorded`, `invoice.issued`, `invoice.due_date_approaching`, `result.published`, `notice.published`.
  - Validation: integration: emit domain event → Lambda triggers → Message row written.
  - AC: Lambda processes within 5s of event; idempotent on retry; DLQ on failure.
  - Deps: B.1.2 + B.2.1.

- **B.3.2** — EventBridge rule: absence → message.
  - Files: rule defined in `tenant-template-stack-basic`; rule pattern matches `attendance.recorded` where `status=absent`.
  - Validation: integration: write absent attendance → Lambda invoked.
  - AC: Rule active in dev tenant; SNS DLQ catches retry failures.
  - Deps: B.3.1.

- **B.3.3** — EventBridge rule: invoice.issued → message.
  - Files: rule definition.
  - Validation: integration.
  - AC: Rule active.
  - Deps: B.3.1.

- **B.3.4** — EventBridge rule: invoice.due_date_approaching → reminder.
  - Files: scheduled rule (EventBridge cron) checks invoices; emits `invoice.due_date_approaching` per matching invoice; B.3.1 Lambda consumes.
  - Validation: integration: invoice T-7 → reminder fires; T-3 → second reminder; T-0 → third; T+3 → escalation.
  - AC: Dunning cadence configurable per archetypeDefaults.
  - Deps: B.3.1 + 0.4.4.

- **B.3.5** — EventBridge rule: result.published → message.
  - Files: rule.
  - Validation: integration.
  - AC: Rule active.
  - Deps: B.3.1.

- **B.3.6** — EventBridge rule: notice.published → fan-out to audience.
  - Files: rule; Lambda resolves audience (school-wide / per-grade / per-section / per-student).
  - Validation: integration: notice published with `audienceScope=school-wide` → all parents + students receive message.
  - AC: Audience resolution correct; bulk-chunked at 100 per TransactWriteItems.
  - Deps: B.3.1.

### Sprint B.4 — In-App Inbox UI (replace mock data)
**Demo:** Parent + student log into respective portals → see real inbox with category filters → mark messages read → backend reflects.

#### Tickets

- **B.4.1** — Inbox API endpoints.
  - Files: `messaging.controller.ts` extends: `GET /messaging/inbox?cursor=&category=`; `GET /messaging/messages/:id`; `PATCH /messaging/messages/:id/read`; three-way handoff.
  - Validation: integration; route-drift lint.
  - AC: Endpoints work; pagination cursor-based; ABAC: user can only see own messages.
  - Deps: B.1.2 + B.1.4.

- **B.4.2** — Replace mock data in Messages MFE.
  - Files: `edforge-saas-frontend/apps/messages/src/InboxPage.tsx` etc — replace `MOCK_CONVERSATIONS` with API calls.
  - Validation: Playwright e2e: send a message via backend test endpoint → appears in inbox UI.
  - AC: All 4 Messages pages (Inbox, Announcements, Meetings, stub for Notifications) consume real API.
  - Deps: B.4.1.

- **B.4.3** — Parent/student portal inbox surface.
  - Files: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/InboxBadge.tsx` + `student-portal/InboxBadge.tsx`; surfaces unread count in nav.
  - Validation: Playwright e2e: new message → badge increments.
  - AC: Badge visible on parent + student portal home.
  - Deps: B.4.1.

- **B.4.4** — Notification preferences (consume schema-only fields).
  - Files: `microservices/identity/src/users/users.controller.ts` `GET/PATCH /me/notification-preferences`; messaging-fanout Lambda respects preferences.
  - Validation: integration: set parent prefs `attendance=off` → no absence msg created.
  - AC: Per-category opt-out works; defaults to all-on for parents.
  - Deps: B.3.1.

### Sprint B.5 — SES Email Adapter
**Demo:** Parent without portal login receives email via SES on absence event; email contains link to invoice PDF (signed S3 URL).

#### Tickets

- **B.5.1** — SES integration in `tenant-template-stack-basic`.
  - Files: CDK; verified sender domain; SES rate limits documented.
  - Validation: test send via SES sandbox.
  - AC: SES enabled; sender domain verified; CloudWatch metrics emit.
  - Deps: none.

- **B.5.2** — `EmailAdapter` service in messaging.
  - Files: `messaging/src/adapters/email-adapter.service.ts` (NEW); `sendEmail(recipient, subject, body, attachments?)`.
  - Validation: unit test mocks SES; integration sends to verified test address.
  - AC: Provider abstraction: `EmailAdapter` interface + SES impl; SMS adapter interface stubbed (`SmsAdapter` returns NotImplementedException — V2 will swap).
  - Deps: B.5.1 + B.1.1.

- **B.5.3** — Messaging fanout uses email adapter as fallback.
  - Files: `fanout-lambda.ts` extended: if recipient `notificationPreferences.email=true`, also call EmailAdapter.
  - Validation: integration: parent with email-on receives both in-app + email; with email-off receives only in-app.
  - AC: Dual-channel works; email failures logged but don't block in-app.
  - Deps: B.3.1 + B.5.2.

- **B.5.4** — Bounce/complaint handling.
  - Files: SES bounce SNS → bounce-handler Lambda updates `User.notificationPreferences.email=false` on hard bounce.
  - Validation: integration: synthetic bounce → user prefs updated.
  - AC: No email retry on hard-bounced address.
  - Deps: B.5.1.

### Sprint B.6 — Notice / Announcement Subsystem
**Demo:** Principal publishes school-wide notice → all parents + students receive (in-app + email fallback) → operator sees delivery stats.

#### Tickets

- **B.6.1** — `Notice` entity.
  - Files: `messaging/src/common/entities/notice.entity.ts` (NEW). Fields: `noticeId`, `schoolId`, `tenantId`, `authorUserId`, `title`, `body`, `audienceScope` (school-wide/per-grade/per-section/per-student), `audienceFilter` (gradeId/sectionId/studentIds[]), `publishedAt`, `status` (draft/published/archived).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green.
  - Deps: B.1.1.

- **B.6.2** — Notice CRUD + publish endpoints.
  - Files: `notices.controller.ts` (NEW); POST/GET/LIST/PATCH/DELETE; POST `/notices/:id/publish` emits `notice.published`; three-way handoff (`/notices` new prefix).
  - Validation: integration; route-drift lint.
  - AC: CRUD + publish works; audit + event per write.
  - Deps: B.6.1.

- **B.6.3** — Notice publication UI (principal-facing).
  - Files: `edforge-saas-frontend/apps/shell/src/pages/notices/NoticeComposer.tsx` (NEW); audience selector.
  - Validation: Playwright e2e: create + publish notice → recipients receive.
  - AC: UI usable on phone + laptop.
  - Deps: B.6.2.

- **B.6.4** — Notice delivery stats endpoint.
  - Files: `GET /notices/:id/stats` returns delivered/read counts.
  - Validation: integration after fan-out.
  - AC: Stats accurate; cached 1min.
  - Deps: B.6.1 + B.3.6.

---

## 5. EPIC-C — Distribute (Document Rendering + School Branding + Templates)

**Goal:** Every printable artifact Saraswati needs (Invoice, Intimation Bill, Admit Card, Report Card) is rendered via ONE service, branded per school, AWS-cost-effective.

### Sprint C.1 — School Branding Entity + Asset Upload
**Demo:** AdminWeb operator uploads logo + signature + sets color palette + writes fee-policy text → `GET /schools/:id/branding` returns asset URLs + colors + policies.

#### Tickets

- **C.1.1** — `SchoolBranding` schema.
  - Files: `packages/shared-types/src/schemas/identity/school-branding.schema.ts` (NEW; per framework §4.3).
  - Validation: schema unit; entity-vs-schema contract test.
  - AC: Schema covers formalName, address, logoUrl, principalSignatureUrl, letterheadBackgroundUrl, colorPalette, feePolicyText, examRulesText, brandingVersionId.
  - Deps: none.

- **C.1.2** — `SchoolBranding` extension on School entity.
  - Files: `microservices/identity/src/common/entities/school.entity.ts` — `branding?: SchoolBrandingDto` field; migration optional (existing schools null until set).
  - Validation: entity unit; existing schools backward-compat.
  - AC: Field present; nullable; module-wiring updated.
  - Deps: C.1.1.

- **C.1.3** — Tenant-assets S3 bucket (per-tenant or shared with prefixed paths).
  - Files: `server/lib/tenant-template/tenant-assets-bucket.ts` (NEW) or extension of `tenant-template-stack-basic`. Bucket per-tenant with lifecycle rules per `invoices/`, `admit-cards/`, `report-cards/` prefixes.
  - Validation: `cdk synth` + diff; deploy to dev.
  - AC: Bucket exists in CDK; per-tenant scoped; CORS allows AdminWeb.
  - Deps: none.

- **C.1.4** — Branding asset upload endpoint.
  - Files: `microservices/identity/src/schools/branding.controller.ts` (NEW); POST `/schools/:schoolId/branding/assets` multipart/form-data; max 2MB logo, 1MB signature, 5MB letterhead; PUTs to S3.
  - Validation: integration: upload 1MB PNG → S3 object exists.
  - AC: Auth: TenantAdmin + Principal write; returns asset URLs; route-drift lint green.
  - Deps: C.1.3.

- **C.1.5** — Branding GET endpoint.
  - Files: `branding.controller.ts` `GET /schools/:schoolId/branding`.
  - Validation: integration.
  - AC: Returns branding object; signed URLs for assets if private bucket.
  - Deps: C.1.2.

- **C.1.6** — Branding versioning.
  - Files: `branding.service.ts` writes `brandingVersionId = uuid()` + `brandingVersionedAt = now()` on update; `School.brandingVersionId` tracks current.
  - Validation: integration: update branding → version changes; old PDFs reference old version.
  - AC: Version on every change; queryable.
  - Deps: C.1.5.

### Sprint C.2 — Document Rendering Lambda Service
**Demo:** Lambda invoked with `{template_id, payload, schoolBranding}` returns signed S3 URL of rendered PDF within 5s. Saraswati branding visible in PDF.

#### Tickets

- **C.2.1** — Document Rendering Lambda scaffold.
  - Files: `server/lib/document-rendering/renderer-lambda.ts` (NEW); Node18 runtime; `@sparticuz/chromium` layer; Handlebars + Puppeteer; CDK wiring in `tenant-template-stack-basic`.
  - Validation: deploy to dev; invoke with hello-world template → returns PDF buffer.
  - AC: Lambda deployed; chromium layer attached; memory 1024MB; timeout 60s.
  - Deps: C.1.3.

- **C.2.2** — Lambda input contract.
  - Files: `packages/shared-types/src/document-rendering/contract.ts` (NEW). Input: `{templateId, payload, brandingS3Bucket, brandingPaths, locale}`. Output: `{pdfS3Key, signedUrl, brandingVersionId, renderDurationMs}`.
  - Validation: schema unit.
  - AC: Contract defined; consumed by services in Sprint C.3+.
  - Deps: C.2.1.

- **C.2.3** — Lambda S3 upload + signed URL.
  - Files: renderer-lambda uploads PDF to `s3://<tenantAssetsBucket>/{tenantId}/{schoolId}/{templateId}/{docId}.pdf`; returns signed URL with 15-min TTL.
  - Validation: integration: invoke → PDF uploaded → URL works.
  - AC: Upload + URL gen reliable; failures retried 3x.
  - Deps: C.2.1 + C.2.2.

- **C.2.4** — Lambda cold-start optimization.
  - Files: chromium layer caching; provisioned concurrency consideration (V1 skip; document trade-off).
  - Validation: cold-start latency measured + documented in `docs/pilot-greenlight/document-rendering-perf.md`.
  - AC: Cold start <3s p95; warm <500ms p95.
  - Deps: C.2.1.

- **C.2.5** — Document Rendering SDK helper for NestJS services.
  - Files: `server/application/libs/document-rendering/src/renderer.client.ts` (NEW); helper that any service can import + call.
  - Validation: unit test mocks Lambda invoke.
  - AC: Helper module published; usable from finance/identity/academics services.
  - Deps: C.2.2.

### Sprint C.3 — Invoice + Intimation Bill Templates
**Demo:** Finance service `POST /invoices/:id/render` returns Saraswati-branded PDF within 5s. Operator downloads + prints. Parent receives via inbox + email.

#### Tickets

- **C.3.0** — Invoice + finance event taxonomy.
  - Files: `packages/shared-types/src/events/invoice/` (NEW; 4 schemas: `invoice.issued`, `invoice.due_date_approaching`, `invoice.rendered`, `invoice.paid`); register in `EVENT_REGISTRY` (alongside the 25 + 6 notification = 31 → 35).
  - Validation: schema unit tests; `EventServiceBase.publishEvent('invoice.issued', payload)` validates correctly.
  - AC: 4 schemas added; `EVENT_REGISTRY` size = 35; lint catches schema-less emission.
  - Deps: B.2.1.

- **C.3.1** — Invoice Handlebars template.
  - Files: `packages/shared-types/src/document-templates/invoice.hbs` (NEW); accepts `InvoiceRenderContext` (school branding + invoice data).
  - Validation: golden-file test (template + sample data → expected HTML); visual review in PR.
  - AC: Template renders cleanly; school branding visible (logo, signature, address, colors).
  - Deps: C.2.5.

- **C.3.2** — Intimation Bill Handlebars template.
  - Files: `packages/shared-types/src/document-templates/intimation-bill.hbs` (NEW).
  - Validation: golden-file + visual review.
  - AC: Template renders.
  - Deps: C.3.1 (shared partials).

- **C.3.3** — Finance service render integration.
  - Files: `microservices/finance/src/invoices/invoices.controller.ts` `POST /invoices/:id/render`; calls renderer.client; persists `invoice.pdfS3Key` + `invoice.brandingVersionId`; emits `invoice.rendered`.
  - Validation: integration.
  - AC: Render endpoint works; idempotent re-render returns same key.
  - Deps: C.3.1 + C.2.5.

- **C.3.4** — Bulk-render orchestrator Lambda.
  - Files: `server/lib/document-rendering/bulk-orchestrator-lambda.ts` (NEW); consumes from SQS FIFO queue (per-school message group); fans out to renderer Lambda.
  - Validation: integration: queue 800 invoices → all PDFs in S3 within 30 min.
  - AC: Lambda concurrency capped at 100; DLQ active; CloudWatch alarm on depth ≥10.
  - Deps: C.3.3.

- **C.3.5** — End-of-month scheduler.
  - Files: EventBridge cron (1st of month, 00:00 Kathmandu); triggers bulk-orchestrator with all active enrolments + monthly fee structure.
  - Validation: integration on dev tenant; live monthly run on Saraswati post-Greenlight.
  - AC: Scheduled rule active; emits per-render messages to SQS.
  - Deps: C.3.4.

### Sprint C.4 — Admit Card + Report Card Templates
**Demo:** Admit Card rendered per student per exam with school branding + exam center + roll number; Report Card rendered per student per term with grades + GPA + class teacher remark.

#### Tickets

- **C.4.1** — Admit Card Handlebars template (data-shape only; instantiation in D.4 / D.5).
  - Files: `packages/shared-types/src/document-templates/admit-card.hbs` (NEW); `packages/shared-types/src/document-templates/admit-card-render-context.schema.ts` (NEW; defines the context shape — branding + admit-card data — without depending on the BLE/SEE entity yet).
  - Validation: golden-file with synthetic data; visual review against sample BLE + SEE admit cards (collected by champion per discovery brief §5).
  - AC: Template matches expected layout; QR code or roll number prominent.
  - Deps: C.2.5. (Note: template ships before BLE/SEE entities; D.4.4 / D.5.3 wire actual entity → template at integration time.)

- **C.4.2** — Report Card Handlebars template.
  - Files: `packages/shared-types/src/document-templates/report-card.hbs` (NEW); accepts `ResultCardRenderContext`; per-subject grades table + GPA + conduct + remarks + signatures.
  - Validation: golden-file + visual review against sample Saraswati report card.
  - AC: Template renders CEHRD-compliant GPA + letter grades; school branding visible.
  - Deps: C.2.5 + A.4.2 (ResultCard entity).

- **C.4.3** — Report-card render endpoint.
  - Files: `microservices/academics/src/result-cards/result-cards.controller.ts` `POST /result-cards/:id/render`. (Admit-card render endpoints live in EPIC-D — D.4.4 for BLE, D.5.3 for SEE — to break the C↔D cycle the original draft introduced.)
  - Validation: integration: render result card → PDF in S3.
  - AC: Endpoint works; route per §1.5 implicit Files.
  - Deps: C.4.2 + A.4.2.

- **C.4.4** — Bulk report-card render (end of Term).
  - Files: orchestrator reused from C.3.4; trigger after `result.published` events accumulate per term.
  - Validation: integration.
  - AC: Bulk render works.
  - Deps: C.4.3.

### Sprint C.5 — Operator Branding UI in AdminWeb
**Demo:** Operator uploads logo + signature, picks colors, writes policy text, previews each of 4 templates inline, saves.

#### Tickets

- **C.5.1** — Branding settings page in AdminWeb.
  - Files: `client/AdminWeb/src/pages/schools/SchoolBrandingPage.tsx` (NEW); upload widgets + color picker + text editors.
  - Validation: manual: principal completes full branding setup in <10 min.
  - AC: All branding fields editable; saves call C.1.4 + C.1.5.
  - Deps: C.1.4 + C.1.5.

- **C.5.2** — Live preview per template.
  - Files: each template has a preview-mode renderer (iframe to renderer Lambda with `?preview=true&watermark=PREVIEW`).
  - Validation: manual: change logo → preview reflects.
  - AC: Preview <5s; all 4 templates previewable.
  - Deps: C.5.1 + C.3.1–C.4.2.

---

## 6. EPIC-D — Plan (Structured Framework)

**Goal:** EdForge ships the structured-framework layer: data-driven curriculum subjects, pluggable grading policy, machine-actionable promotion rules, and full Nepal national exam workflows (BLE, SEE, NEB-11/12).

### Sprint D.1 — GradingPolicy Pluggability (Nepal A+/E)
**Demo:** `GET /schools/:id/grading-policy` returns Nepal CEHRD scale (A+/A/B+/B/C+/C/D+/D/E with documented bands) for PABSON-archetype schools; synthetic GENERIC returns US A-F.

#### Tickets

- **D.1.1** — `GradingPolicy.gpaScale` + `letterGrades[]` fields.
  - Files: `microservices/academics/src/common/entities/grading-policy.entity.ts` + schema `packages/shared-types/src/schemas/academics/grading-policy.schema.ts`. Add `gpaScale: '4.0' | '5.0'`, `letterGrades: [{letter, minPct, maxPct, gpaPoints, isPassing}]`.
  - Validation: entity unit + contract test.
  - AC: Schema + factory updated; existing rows backward-compat (default to US A-F).
  - Deps: 0.4.1.

- **D.1.2** — Remove hardcoded US `GradeLetter` enum from `base.entity.ts:273`.
  - Files: `microservices/academics/src/common/entities/base.entity.ts` — `GradeLetter` becomes string (validated against GradingPolicy.letterGrades).
  - Validation: existing tests stay green; new tests cover Nepal A+/E letters.
  - AC: No hardcoded letter list in base entity; archetype-grep CI catches future regressions.
  - Deps: D.1.1.

- **D.1.3** — PABSON default GradingPolicy seed.
  - Files: `microservices/identity/src/tenant-seeder/tenant-seeder-lambda.ts` — on PABSON tenant provision, seed default GradingPolicy with CEHRD scale.
  - Validation: integration: provision new PABSON tenant → GradingPolicy exists with CEHRD scale.
  - AC: Tenant-seeder updates; existing tenants backfilled via script.
  - Deps: D.1.1 + 0.4.2.

- **D.1.4** — `gpa-calculator.service.ts` data-driven.
  - Files: `microservices/academics/src/grades/gpa-calculator.service.ts` — reads `gpaScale` from GradingPolicy (no hardcoded 4.0).
  - Validation: unit tests with 4.0 scale + 5.0 scale.
  - AC: GPA correct for both scales.
  - Deps: D.1.1.

- **D.1.5** — Saraswati GradingPolicy backfill.
  - Files: `scripts/backfill-pabson-grading-policy-saraswati.ts` (NEW).
  - Validation: dry-run + `--apply`.
  - AC: Saraswati has CEHRD scale post-backfill.
  - Deps: D.1.3.

### Sprint D.2 — PromotionRule Entity + Workflow
**Demo:** PABSON `PromotionRule` evaluated post-term-result-publish for `dev-pabson-primary` Grade 8 cohort → flags students for review → operator decides; cross-year handoff (F1 in v2) uses this.

#### Tickets

- **D.2.1** — `PromotionRule` entity + schema.
  - Files: `packages/shared-types/src/schemas/academics/promotion-rule.schema.ts` (NEW); entity. Fields: `ruleId`, `schoolId`, `archetypeId`, `gradeLevel`, `passingThresholdPct`, `minAttendancePct`, `subjectsRequired[]`, `archetypeDefaulted: boolean`.
  - Validation: entity unit + contract test.
  - AC: Schema + factory; module-wiring updated; Ed-Fi alignment: extension namespace `edforge:PromotionPolicy`.
  - Deps: 0.4.1.

- **D.2.2** — PromotionRule CRUD endpoints.
  - Files: `microservices/academics/src/promotion-rules/promotion-rules.controller.ts` (NEW); three-way handoff (`/promotion-rules` new prefix).
  - Validation: integration; route-drift lint.
  - AC: CRUD + audit + event.
  - Deps: D.2.1.

- **D.2.3** — PABSON default PromotionRule seed.
  - Files: tenant-seeder seeds per-grade defaults (e.g., passingPct=35, minAttendancePct=80 — confirmed by champion field visit).
  - Validation: integration.
  - AC: PABSON tenants have defaults; backfill script for existing.
  - Deps: D.2.1 + 0.4.2.

- **D.2.4** — Promotion evaluation service (pure function).
  - Files: `microservices/academics/src/promotion/promotion-evaluator.service.ts` (NEW); reads ResultCard + Attendance summary + PromotionRule; returns `{eligible, retainedReason?}`.
  - Validation: unit table-driven: passes all subjects + ≥80% attendance → eligible; one fail subject → retainedReason='subject_failure'; <80% attendance → 'attendance_failure'.
  - AC: Pure function; archetype-grep zero hits.
  - Deps: D.2.1.

- **D.2.5** — Batch promotion-evaluation endpoint.
  - Files: `POST /schools/:id/academic-years/:fromAyId/promote-from?targetAyId=&gradeLevel=` — evaluates all enrolments in `fromAyId` + `gradeLevel` → returns list with promotion-decision suggestions.
  - Validation: integration on `dev-pabson-primary`.
  - AC: Suggests but doesn't commit; operator review before commit (D.2.6).
  - Deps: D.2.4 + A.4.2.

- **D.2.6** — Cross-year promotion commit (chunked).
  - Files: `POST /schools/:id/academic-years/:fromAyId/promote-from/:targetAyId/commit` with list of decisions; chunked at 100 per TransactWriteItems; creates provisional Enrolments in target AY.
  - Validation: integration: 200 students promoted in chunks; `enrollment.promoted` event per chunk.
  - AC: Atomic per chunk; idempotent on retry.
  - Deps: D.2.5 + D.2.7 + D.2.8.

- **D.2.7** — `Enrollment.priorEnrollmentId` + `promotionDecision` write-once fields.
  - Files: `microservices/academics/src/common/entities/enrollment.entity.ts`; `packages/shared-types/src/schemas/academics/enrollment.schema.ts`. Add `priorEnrollmentId?: string`, `promotionDecision: enum 'promoted'|'retained'|'conditional'|'graduated'|'withdrawn'|'transferred_out'` (write-once).
  - Validation: schema unit; entity unit; integration: second PUT of `promotionDecision` → 409 `PROMOTION_DECISION_LOCKED`.
  - AC: Fields on prior-AY enrollment; write-once enforced.
  - Deps: 0.4.1.

- **D.2.8** — `provisional` EnrollmentStatus + state-machine.
  - Files: `microservices/academics/src/common/entities/base.entity.ts` adds `provisional` to `EnrollmentStatus`; `microservices/academics/src/enrollment/enrollment-state-machine.ts` (NEW) covers `provisional → enrolled`, `provisional → withdrawn`; rejects `enrolled → provisional`.
  - Validation: unit covering every valid + invalid transition.
  - AC: 100% transition coverage; rejection list documented.
  - Deps: D.2.7.

- **D.2.9** — Result-publish event handler (subscribes to `result.published`).
  - Files: `microservices/academics/src/enrollment/enrollment-transition-handler.service.ts` (NEW); subscribes to `result.published` with terminal-exam flag; queries provisional next-AY rows; calls D.2.10.
  - Validation: integration: publish prior-AY terminal result → handler invoked; idempotent on retry.
  - AC: Handler fires on event; idempotent.
  - Deps: D.2.8 + A.4.5.

- **D.2.10** — Atomic provisional→final flip (chunked).
  - Files: `microservices/academics/src/enrollment/enrollment.service.ts` `promoteProvisionalToEnrolled(provisionalIds[])`; chunked at 100 per TransactWriteItems.
  - Validation: integration: 10 provisional rows + handler invocation → 9 flip to `enrolled`, 1 retained gets `gradeLevel` rewritten; attendance under provisional enrollment survives `gradeLevel` rewrite (invariant 3 guard).
  - AC: Atomic per chunk; failure rolls back chunk; audit + event per chunk.
  - Deps: D.2.9.

- **D.2.11** — Cross-AY `GET /students/:id/timeline` endpoint.
  - Files: `microservices/academics/src/students/student-timeline.controller.ts` (NEW); returns all enrollments across AYs via GSI2.
  - Validation: integration across two AYs; every row carries `enrollmentId` (invariant 3 guard); cursor pagination.
  - AC: Returns full chain with promotion decisions sorted by AY ascending; route registered (§1.5 implicit).
  - Deps: D.2.7.

- **D.2.12** — Cross-year smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-cross-year-handoff.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; simulates full operator-printed window (prior AY active → next AY created → batch-promote → window attendance → publish prior results → 9 flip + 1 retained).
  - AC: Both exit 0; attendance preserved; events at every step.
  - Deps: D.2.6 + D.2.10 + D.2.11.

### Sprint D.3 — ExternalAssessment Family (Foundation)
**Demo:** Backend supports `RubricCategory`, `ExternalExamRegistration`, `ExternalExamAdmitCard`, `InternalAssessment`, `ExternalExamResult`, `ExternalExamRetake` entities; reusable across BLE, SEE, NEB-11, NEB-12 with archetype-defaulted internal-weight.

#### Tickets

- **D.3.0** — `RubricCategory` entity (target for `InternalAssessment.rubricCategoryId` FK).
  - Files: `microservices/academics/src/common/entities/rubric-category.entity.ts` (NEW); `packages/shared-types/src/schemas/academics/rubric-category.schema.ts` (NEW). Fields: `categoryId`, `examType` (BLE/SEE/NEB-11/NEB-12), `subjectArea?`, `categoryName`, `weight` (% of internal-assessment total), `archetypeDefaultId?`, `cdcReference?` (link to CDC rubric publication).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.4.1.

- **D.3.1** — `ExternalExamRegistration` entity.
  - Files: `microservices/academics/src/external-exams/external-exam-registration.entity.ts` (NEW). Fields: `registrationId`, `studentId`, `enrollmentId`, `examType` (BLE/SEE/NEB-11/NEB-12), `examYear`, `examAuthority` (municipality code or `NEB`), `registrationDate`, `status` (draft/submitted/confirmed/cancelled), `externalRollNumber?`.
  - Validation: entity unit + contract test.
  - AC: Factory + contract green.
  - Deps: 0.3.1.

- **D.3.2** — `InternalAssessment` entity (per student × subject × external exam).
  - Files: `internal-assessment.entity.ts` (NEW). Fields: `assessmentId`, `studentId`, `enrollmentId`, `examType`, `subjectId`, `rubricCategoryId`, `score`, `maxScore`, `enteredBy`, `enteredAt`.
  - Validation: entity unit.
  - AC: Factory; archetype-defaulted internal-weight applied at result-aggregation time.
  - Deps: A.2.1.

- **D.3.3** — `ExternalExamAdmitCard` entity.
  - Files: `external-exam-admit-card.entity.ts` (NEW). Fields: `admitCardId`, `registrationId`, `studentId`, `externalRollNumber`, `examCenterName`, `examCenterAddress`, `examDates[]`, `pdfS3Url?`, `issuedAt`.
  - Validation: entity unit.
  - AC: Factory.
  - Deps: D.3.1.

- **D.3.4** — `ExternalExamResult` entity.
  - Files: `external-exam-result.entity.ts` (NEW). Fields: `resultId`, `studentId`, `enrollmentId`, `examType`, `subjectResults[]` (per subject: `{subjectId, letterGrade, gpaPoints, internalScore, externalScore}`), `cumulativeGpa?` (NEB only), `overallStatus` (passed/failed/NG), `importedAt`.
  - Validation: entity unit + contract test.
  - AC: Factory; supports per-subject + cumulative.
  - Deps: D.3.1.

- **D.3.5** — `ExternalExamRetake` entity (Grade Increment).
  - Files: `external-exam-retake.entity.ts` (NEW). Fields: `retakeId`, `originalResultId`, `studentId`, `examType`, `subjects[]` (subjects being retaken), `retakeDate`, `fee`, `status`.
  - Validation: entity unit.
  - AC: NEB-only; BLE/SEE skip.
  - Deps: D.3.4.

- **D.3.6** — Module-wiring update.
  - Files: `microservices/academics/src/__tests__/module-wiring.spec.ts` extended; `microservices/academics/src/external-exams/external-exams.module.ts` (NEW).
  - Validation: spec catches forgotten import.
  - AC: New module wired.
  - Deps: 0.3.2 + D.3.1–D.3.5.

### Sprint D.4 — BLE Workflow (Grade 8) End-to-End
**Demo:** Saraswati operator: registers Grade 8 cohort for BLE → enters CDC 50/50 internal assessment per subject → issues admit cards (PDF rendered with Saraswati branding) → imports results from IEMIS → promotion-rule evaluates Grade 8 → 9.

#### Tickets

- **D.4.1** — BLE registration endpoint.
  - Files: `microservices/academics/src/external-exams/ble-registration.controller.ts` (NEW); `POST /schools/:id/external-exams/ble/registrations` (bulk).
  - Validation: integration with Saraswati Grade 8 cohort.
  - AC: Bulk creation; audit + event.
  - Deps: D.3.1.

- **D.4.2** — BLE CDC internal assessment rubric seed.
  - Files: `packages/shared-types/src/archetype-defaults/ble-cdc-rubric.ts` (NEW); 50% attendance+presentation + 50% subject activities per CDC.
  - Validation: unit.
  - AC: Rubric seeded in archetype defaults; usable by InternalAssessment.
  - Deps: D.3.2 + 0.4.2.

- **D.4.3** — BLE internal-assessment mark entry endpoint.
  - Files: `internal-assessment.controller.ts` `POST /external-exams/:registrationId/internal-assessment` (single + bulk).
  - Validation: integration with CDC rubric.
  - AC: Mark validation; audit + event.
  - Deps: D.3.2 + D.4.2.

- **D.4.4** — BLE admit-card generation + render trigger.
  - Files: `admit-cards.controller.ts` `POST /external-exams/:registrationId/admit-card/render`; calls C.4.3 renderer; populates `ExternalExamAdmitCard.pdfS3Url`.
  - Validation: integration: render admit card → PDF in S3.
  - AC: PDF correct per BLE format (operator-validated against sample collected by champion).
  - Deps: D.3.3 + C.4.3.

- **D.4.5** — BLE result import endpoint.
  - Files: `external-exam-results.controller.ts` `POST /external-exams/ble/results/import` (CSV upload from IEMIS).
  - Validation: integration with synthetic IEMIS CSV; live with Saraswati post-result-day.
  - AC: CSV parsed; result rows written; events emitted.
  - Deps: D.3.4.

- **D.4.6** — BLE Grade 8 → 9 promotion rule.
  - Files: BLE-specific PromotionRule seed (BLE-pass = pass all subjects with ≥D, but NG students still promote with remedial — per Agent 1 research).
  - Validation: integration: promotion-evaluator returns correct decision for NG / pass / fail students.
  - AC: Rule data-driven; Saraswati Grade 8 cohort evaluable.
  - Deps: D.2.1 + D.3.4.

- **D.4.7** — BLE smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-ble-flow.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`.
  - AC: Full BLE lifecycle exits 0.
  - Deps: D.4.1–D.4.6.

### Sprint D.5 — SEE Workflow (Grade 10) End-to-End
**Demo:** Same shape as Sprint D.4 but for SEE (Grade 10, NEB authority, 25/75 weight, results via `exam.neb.gov.np`).

#### Tickets

- **D.5.1** — SEE registration endpoint.
  - Files: `see-registration.controller.ts` (NEW); shape mirrors BLE but `examAuthority='NEB'`.
  - Validation: integration.
  - AC: Bulk creation; audit + event.
  - Deps: D.3.1.

- **D.5.2** — SEE 25% internal assessment per subject.
  - Files: extend internal-assessment endpoint with SEE-specific 25% rubric (subject-level: labs + assignments + class tests).
  - Validation: integration.
  - AC: 25% rubric applied; SEE-distinct from BLE 50/50.
  - Deps: D.3.2.

- **D.5.3** — SEE admit-card render.
  - Files: same as D.4.4 but SEE template variant.
  - Validation: integration.
  - AC: Admit card correct.
  - Deps: D.3.3 + C.4.3.

- **D.5.4** — SEE result import.
  - Files: similar to D.4.5; CSV from NEB portal export.
  - Validation: integration with NEB-format CSV.
  - AC: Results parsed + written.
  - Deps: D.3.4.

- **D.5.5** — SEE Grade 10 → 11 promotion rule.
  - Files: PABSON PromotionRule for Grade 10 (SEE-pass required for Grade 11 NEB enrollment).
  - Validation: integration.
  - AC: Rule data-driven.
  - Deps: D.2.1 + D.3.4.

- **D.5.6** — Pre-board (PABSON) exam integration.
  - Files: `Exam.examType` accepts `pre_board` value (archetypeDefaults.examPattern); pre-board exams stored as Exam + ExamScore rows (NOT ExternalExam since marks school-managed).
  - Validation: integration: create pre-board exam → mark entry → results.
  - AC: PABSON pre-board modeled correctly; opt-in per school.
  - Deps: A.3.2.

- **D.5.7** — SEE smoke.
  - Files: `pilot-see-flow.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`.
  - AC: Full SEE lifecycle exits 0.
  - Deps: D.5.1–D.5.6.

### Sprint D.6 — NEB Grade 11/12 Workflow Architecture
**Demo:** Backend architected to support NEB-11 / NEB-12 registration + result import (not in-person at Saraswati; for pilot 2 readiness).

#### Tickets

- **D.6.1** — NEB-11/NEB-12 registration endpoint.
  - Files: `neb-registration.controller.ts` (NEW); subject selection + SEE-mark-sheet ref.
  - Validation: integration.
  - AC: Endpoint live; ABAC: pilot-2 tenant can use.
  - Deps: D.3.1.

- **D.6.2** — NEB-11/NEB-12 internal-assessment endpoint.
  - Files: 25% internal rubric (theory + practical split for science subjects).
  - Validation: integration.
  - AC: Rubric correct.
  - Deps: D.3.2.

- **D.6.3** — NEB admit-card distribution endpoint.
  - Files: NEB-issued admit cards are imported (not generated); endpoint records distribution.
  - Validation: integration.
  - AC: Admit-card metadata stored.
  - Deps: D.3.3.

- **D.6.4** — NEB-12 cumulative GPA computation.
  - Files: extends D.3.4; cumulative across all subjects (NEB-specific).
  - Validation: unit.
  - AC: Cumulative correct.
  - Deps: D.3.4.

- **D.6.5** — Grade Increment Exam (Retake) endpoint.
  - Files: `external-exam-retakes.controller.ts` (NEW); POST `/external-exams/:resultId/retake`; fee Rs.600 captured; eligible if NG ≤1 subject or D+ in all-except-2.
  - Validation: integration.
  - AC: Eligibility rule enforced.
  - Deps: D.3.5.

- **D.6.6** — NEB smoke (architectural, not real-pilot).
  - Files: `pilot-neb-architecture-smoke.ts` (NEW; runs on synthetic NEB-grade-11/12 fixture).
  - Validation: smoke against synthetic data.
  - AC: Lifecycle works architecturally; pilot 2 ready.
  - Deps: D.6.1–D.6.5.

### Sprint D.7 — StudentAcademicTrack Entity — **V1.5 DEFERRED (not counted in V1 ticket total)**
**Demo (V1.5 only):** Per-student multi-year track shows: current grade + grades remaining + board exam ahead (BLE@G8, SEE@G10, NEB@G11/12) + projected completion. Listed here for sequencing reference; tickets do NOT ship in V1.

#### Tickets

- **D.7.1** — `StudentAcademicTrack` entity.
  - Files: `student-academic-track.entity.ts` (NEW).
  - Validation: entity unit + contract test.
  - AC: Factory + module-wiring updated.
  - Deps: D.3.1.

- **D.7.2** — Track CRUD + auto-update on promotion.
  - Files: controller + service; promotion commit (D.2.6) updates track.
  - Validation: integration.
  - AC: Track stays current.
  - Deps: D.7.1 + D.2.6.

- **D.7.3** — Track UI in student + parent portals.
  - Files: frontend.
  - Validation: Playwright.
  - AC: Visible.
  - Deps: D.7.2.

---

## 7. EPIC-E — Comply (CEHRD + Nepal MoE)

**Goal:** EdForge ships CEHRD compliance MVP — Flash I/II templates, discipline (soft), residency, consent, tenant export. Per CEO 2026-05-20: MVP only; iterate.

### Sprint E.1 — Flash I/II MVP Templates + Generator
**Source:** v2 plan F2. Saraswati can generate CEHRD-template-conformant annual IEMIS submission. Defaults to what pilot schools provide as their existing export.

**Demo:** Generate AY 2083 partial-year IEMIS submission via `IEMIS_NPL_CEHRD` template. CSV downloaded; counts match Saraswati actuals. Submission history visible. `reporting.submitted` event on bus + event-log.

#### Tickets

- **E.1.1** — `ReportingSnapshot` entity.
  - Files: `microservices/identity/src/external-reporting/reporting-snapshot.entity.ts` (NEW).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.3.1.

- **E.1.2** — Report template registry (naming-discipline).
  - Files: `packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD.ts` (NEW); template name uses `NPL` + `CEHRD` only (no pilot name).
  - Validation: roundtrip against pilot-provided CEHRD fixture (collected by champion §5); naming-lint `grep -rni '_SARASWATI\|_PABSON_SARASWATI' packages/shared-types/src/external-reporting/templates/` zero.
  - AC: Template loadable; naming pilot-agnostic.
  - Deps: champion field visit collected sample.

- **E.1.3** — Aggregation Lambda (template-driven, archetype-blind).
  - Files: `server/lib/external-reporting/lambda/report-aggregator.ts` (NEW).
  - Validation: integration with Saraswati actuals; archetype-grep CI check.
  - AC: Aggregations match expected; <60s for 1000-student tenant; zero archetype branches.
  - Deps: E.1.2 + 0.4.4.

- **E.1.4** — Snapshot POST endpoint.
  - Files: `reporting-snapshot.controller.ts` (NEW); three-way handoff (new `/reporting` prefix).
  - Validation: integration.
  - AC: Triggers Lambda; returns snapshot ID + S3 key.
  - Deps: E.1.1 + E.1.3.

- **E.1.5** — `reporting.submission_due` scheduler.
  - Files: CDK scheduled trigger + Lambda; emits event 30 days before assumed deadline.
  - Validation: integration.
  - AC: Event fires on schedule.
  - Deps: E.1.4.

- **E.1.6** — Audit per submission.
  - Files: external-reporting service.
  - Validation: integration.
  - AC: Audit + `reporting.submitted` event per generation.
  - Deps: E.1.4.

- **E.1.7** — Saraswati IEMIS dry-run smoke.
  - Files: `pilot-external-reporting.ts` (NEW).
  - Validation: smoke; manual inspection by operator + EdForge.
  - AC: Smoke exit 0; CSV human-verified.
  - Deps: E.1.4.

### Sprint E.2 — Discipline / Form-19 Soft Requirement
**Source:** Per CEO 2026-05-20: SOFT requirement.

**Demo:** Operator records discipline incident → entity persisted with audit + event; dashboard shows count.

#### Tickets

- **E.2.1** — `DisciplineIncident` entity (Ed-Fi-aligned).
  - Files: `microservices/academics/src/discipline/discipline-incident.entity.ts` (NEW). Ed-Fi resource: `DisciplineIncident`.
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.3.1.

- **E.2.2** — `StudentDisciplineIncidentAssociation` entity.
  - Files: `student-discipline-incident-association.entity.ts` (NEW). Ed-Fi-aligned.
  - Validation: entity unit.
  - AC: Factory.
  - Deps: E.2.1.

- **E.2.3** — Discipline CRUD endpoints.
  - Files: `discipline.controller.ts` (NEW); three-way handoff (`/discipline` new prefix).
  - Validation: integration.
  - AC: CRUD + audit + event.
  - Deps: E.2.1 + E.2.2.

- **E.2.4** — Discipline descriptors under `edforge:` namespace.
  - Files: `packages/shared-types/src/edfi/extensions/discipline-descriptor.ts` (NEW).
  - Validation: schema unit.
  - AC: Custom descriptors live in `edforge:` namespace (invariant 11).
  - Deps: none.

- **E.2.5** — Dashboard count surface.
  - Files: extend dashboard with `disciplineIncidentCount`.
  - Validation: integration.
  - AC: Count visible on dashboard.
  - Deps: A.1.1 + E.2.3.

### Sprint E.3 — Data Residency Commitment + Per-Tenant Assertion
**Source:** v2 plan G.1. Mumbai AWS confirmed acceptable per CEO 2026-05-20.

**Demo:** `tenant.regionalCommitment` field captured at provisioning; integration test asserts provisioned tenant's region matches commitment.

#### Tickets

- **E.3.1** — Data-residency commitment doc.
  - Files: `docs/compliance/data-residency-commitment.md` (NEW, legal-reviewed).
  - Validation: doc reviewed.
  - AC: Doc legal-reviewed; committed.
  - Deps: none.

- **E.3.2** — `tenant.regionalCommitment` field.
  - Files: `tenant.entity.ts` + schema.
  - Validation: entity unit.
  - AC: Field present; populated at provision.
  - Deps: none.

- **E.3.3** — Per-tenant residency assertion.
  - Files: identity service test asserts tenant region matches `tenant.regionalCommitment`.
  - Validation: integration: provision tenant claiming region X → infra region must match.
  - AC: Assertion fails fast on mismatch.
  - Deps: E.3.2.

### Sprint E.4 — Parental Consent at User Invite
**Source:** v2 plan G.2.

**Demo:** Invite parent without consent record → 400 `CONSENT_REQUIRED`; with consent → invite succeeds + audit row.

#### Tickets

- **E.4.1** — `Consent` entity (version-hashed policy URL).
  - Files: `consent.entity.ts` (NEW).
  - Validation: entity unit + contract test.
  - AC: Factory + module-wiring updated.
  - Deps: 0.3.1.

- **E.4.2** — User-invite consent capture.
  - Files: identity user-invite path requires `consent` payload; ConsentService records.
  - Validation: integration: cannot invite without consent.
  - AC: Audit + consent row per invite.
  - Deps: E.4.1.

### Sprint E.5 — Tenant Data Export
**Source:** v2 plan G.3.

**Demo:** Click "Export tenant data" on `dev-pabson-primary` → S3 zip arrives with every entity → signed download URL.

#### Tickets

- **E.5.1** — Tenant export endpoint.
  - Files: `microservices/identity/src/tenant-export/tenant-export.controller.ts` (NEW); export Lambda; three-way (`/tenants/:id/export`).
  - Validation: integration on `dev-pabson-primary`.
  - AC: Zip complete; <30min for 1000-student tenant; signed download URL.
  - Deps: 0.3.1.

- **E.5.2** — Export job tracking.
  - Files: `TenantExportJob` entity (status: queued/running/complete/failed).
  - Validation: entity unit.
  - AC: Operator queryable.
  - Deps: E.5.1.

### Sprint E.6 — Scholarship Quota Compliance (nice-to-have, easy)
**Source:** CEO 2026-05-20: nice-to-have if easy hanging fruit.

**Demo:** Dashboard surfaces "scholarship coverage = X%" vs required threshold per enrollment band (10% / 12% / 15% per CEHRD).

#### Tickets

- **E.6.1** — Scholarship coverage computation.
  - Files: `microservices/finance/src/dashboard/scholarship-coverage.service.ts` (NEW); reads `Enrollment` count + `DiscountRule` scholarship type + total students; computes %.
  - Validation: unit.
  - AC: Computation correct; cached 1h.
  - Deps: 0.4.4 (reads enrollment band thresholds from archetypeDefaults).

- **E.6.2** — Dashboard surface.
  - Files: extend finance dashboard with scholarship card.
  - Validation: manual.
  - AC: Card visible; threshold-status badge (under/at/over).
  - Deps: E.6.1.

---

## 8. EPIC-F — Generalize (Multi-Pilot Proof)

**Goal:** EdForge proves the framework: a second PABSON school onboards via data-only drop; synthetic GENERIC archetype passes smokes; engine code untouched.

### Sprint F.1 — Two-Pilot Parametric Smoke Matrix
**Demo:** Every smoke that previously ran against `dev-pabson-primary` ALSO runs against Saraswati with `PILOT_ID=pabson-saraswati-bs-2083`; both exit 0.

#### Tickets

- **F.1.1** — Parametric `PILOT_ID` env-var support in all smokes.
  - Files: every `scripts/smoke-tests/pilot-*.ts` accepts `PILOT_ID` env.
  - Validation: each smoke runs against both tenants.
  - AC: All smokes parametric.
  - Deps: prior smokes from A/B/C/D/E.

- **F.1.2** — CI two-pilot smoke matrix.
  - Files: GH Actions config; matrix axes `PILOT_ID` × smoke-name.
  - Validation: CI green.
  - AC: Matrix runs on PR merge.
  - Deps: F.1.1.

### Sprint F.2 — Synthetic GENERIC Archetype Fixture
**Demo:** Same smokes run with `PILOT_ID=generic-synthetic-q2-2026` (archetype=GENERIC, country=USA, currency=USD, calendar=gregorian); all exit 0.

#### Tickets

- **F.2.1** — GENERIC pilot fixture.
  - Files: `packages/pilot-fixtures/pilots/generic-synthetic-q2-2026/` (NEW); metadata + calendar + bell + structure + holidays + programs.
  - Validation: fixture passes schema.
  - AC: Fixture loadable.
  - Deps: 0.4.3 (GENERIC archetype defaults).

- **F.2.2** — GENERIC archetype smoke.
  - Files: all parametric smokes + GENERIC fixture.
  - Validation: all exit 0; finance accepts USD (per 0.2.13); calendar Gregorian.
  - AC: Engine accepts non-PABSON archetype with zero code change.
  - Deps: F.2.1 + 0.2.13.

### Sprint F.3 — Pilot 2 Provisioning + Setup Rehearsal
**Source:** v2 plan K.5.

**Demo:** Pilot 2 PABSON school provisioned in prod with `tenantTag='production'`; operator-led activation via UI mirrors Saraswati 2026-05-18 flow.

#### Tickets

- **F.3.1** — Pilot 2 dossier + fixture.
  - Files: `docs/pilots/<pilot-2-id>/dossier.md` + `packages/pilot-fixtures/pilots/<pilot-2-id>/...`.
  - Validation: fixture passes schema.
  - AC: Dossier follows v1 §13 pilot-dossier contract.
  - Deps: G.1.3 (champion-identified pilot 2 from secondary PABSON school visits).

- **F.3.2** — Pre-flight smoke pack on pilot 2 fixture.
  - Files: re-run F.1.1 smokes with `PILOT_ID=<pilot-2-id>` BEFORE provisioning.
  - Validation: all exit 0.
  - AC: Pilot 2 ready for provisioning.
  - Deps: F.3.1 + F.1.1.

- **F.3.3** — Pilot 2 provisioning.
  - Files: ControlPlane tenant create flow; operator-led activation.
  - Validation: live activation.
  - AC: Tenant live; setup mirrors Saraswati.
  - Deps: F.3.2.

### Sprint F.4 — REMOVED (single-ticket sprint violates per-sprint DoD; folded into H.1.8 gap list)

The generalization retrospective doc that lived here was a single doc-commit ticket — too thin to constitute a sprint. **Folded into Sprint H.1 as part of the H.1.8 gap-list publication**, which already captures lessons learned for the V1 → V1.5 backlog. The retro artifact still ships, just under H.1.8 ownership.

---

## 9. EPIC-G — Operator Validation

**Goal:** Champion-led discovery + ongoing operator sync converts engineering hypotheses into evidence; identifies pilot 2.

### Sprint G.1 — Champion Field Trip Execution
**Source:** [`edforge-champion-nepal-discovery-brief.md`](./edforge-champion-nepal-discovery-brief.md).

**Demo:** Champion completes Saraswati + 1-2 secondary PABSON school visits; engineering receives filled interview forms + artifact archive + field journal + pilot 2 scouting log.

#### Tickets

- **G.1.1** — Pre-trip prep call (champion + engineering).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/prep-call-notes.md` (NEW).
  - Validation: notes captured.
  - AC: Brief reviewed; consent norms set; engineering questions clarified.
  - Deps: none.

- **G.1.2** — Saraswati on-site visit (champion).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/saraswati-onsite-<date>/` (NEW directory) — interview forms + artifact photos + field journal.
  - Validation: deliverables per discovery brief §9.
  - AC: 6 persona interviews filled; artifacts collected per §5 of brief.
  - Deps: G.1.1.

- **G.1.3** — Secondary PABSON school visits.
  - Files: per-school folder under `docs/pilots/<school-id>/discovery/`.
  - Validation: deliverables per brief §7.
  - AC: 1-2 schools visited; comparison notes filled.
  - Deps: G.1.1.

- **G.1.4** — Debrief call (champion + engineering).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/debrief-<date>.md` (NEW).
  - Validation: notes captured.
  - AC: Findings mapped to framework §8 open questions; follow-ups identified.
  - Deps: G.1.2 + G.1.3.

- **G.1.5** — Framework update with evidence.
  - Files: `v1-master-framework.md` §8 updated with resolved 🔴 questions; v2 sprint plan Q9/Q10 resolved.
  - Validation: doc updated.
  - AC: At least 5 of 8 open framework questions resolved.
  - Deps: G.1.4.

### Sprint G.2 — Weekly Operator Sync Cadence (until Day-30)
**Demo:** Weekly 30-min call with Saraswati operator; running log of feedback → fast-follow tickets in <1 week.

#### Tickets

- **G.2.1** — Weekly sync calendar invite + agenda template.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/weekly-sync/agenda-template.md` (NEW).
  - Validation: template reviewed.
  - AC: Cadence scheduled.
  - Deps: G.1.5.

- **G.2.2** — Weekly sync log files (one per week, recurring through Sprint H).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/weekly-sync/<YYYY-MM-DD>.md`.
  - Validation: log committed weekly.
  - AC: Issues categorized: fast-follow / sprint-bundle / formal-backlog within 7d.
  - Deps: G.2.1.

### Sprint G.3 — Adoption Telemetry Definition
**Demo:** Daily-active operator count, sessions-with-write count, parent-portal-open rate dashboards visible.

#### Tickets

- **G.3.1** — Adoption-telemetry DDB events.
  - Files: `microservices/identity/src/telemetry/adoption-telemetry.service.ts` (NEW); emits `user.session.started`, `user.session.write`, `parent.portal.opened`.
  - Validation: integration.
  - AC: Events on bus + event-log.
  - Deps: B.4.1 (event-log dependency).

- **G.3.2** — CloudWatch dashboard.
  - Files: `server/lib/observability/adoption-dashboard.ts` (NEW); per-school metrics.
  - Validation: `cdk synth` + deploy; dashboard visible.
  - AC: DAU + WAU + write-count per persona; parent-portal-open rate.
  - Deps: G.3.1.

---

## 10. EPIC-H — Greenlight + Hypercare

**Goal:** Saraswati formally signs off; 30-day hypercare with zero P0/P1 incidents.

### Sprint H.1 — Saraswati Real-Operational Evidence (post-Phase-D)
**Source:** v2 plan H. Capture 1 week period attendance + 1 Term-1 exam-flow + 1 result-publish + cross-year promotion evidence.

#### Tickets

- **H.1.1** — Operator-data verification on Saraswati.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/h-rehearsal-evidence/` (NEW dir).
  - Validation: evidence captured.
  - AC: Operator signs off on data correctness; Term-1 evidence real OR synthetic-with-annotation per v2 plan AC.
  - Deps: A.3.11 + A.4.7 + D.4.7 + D.5.7.

- **H.1.2** — Merge-mode regression audit.
  - Files: `h-rehearsal-evidence/merge-mode-audit.md`.
  - Validation: query Saraswati CalendarDate rows; identify operator-edits; verify they survived post-2026-05-18 regenerations.
  - AC: Operator-edits intact; C3.8 merge-mode contract holds in real prod.
  - Deps: H.1.1.

- **H.1.3** — IEMIS dry-run sign-off.
  - Files: `h-rehearsal-evidence/iemis-dry-run.md`.
  - Validation: operator + EdForge inspect CSV; discrepancies resolved.
  - AC: Sign-off; CSV submission-ready.
  - Deps: E.1.7.

- **H.1.4** — Tenant-export rehearsal on Saraswati.
  - Files: `h-rehearsal-evidence/tenant-export.md`.
  - Validation: G.3 against Saraswati; zip inspected.
  - AC: Zip complete; operator signs off.
  - Deps: E.3.1 + E.5.1.

- **H.1.5** — Prod-shadow rehearsal on fresh `tenantTag=internal-dev`.
  - Files: deploy log in `docs/deploys/`.
  - Validation: provision fresh dev tenant; run setup steps + teardown.
  - AC: Prod-account provisioning + reporting + export validated; teardown clean.
  - Deps: F.3.3.

- **H.1.6** — Audit + event-log completeness review.
  - Files: `h-rehearsal-evidence/audit-completeness.md`; query report.
  - Validation: query event-log for Saraswati tenant; assert every write has audit + event.
  - AC: Zero unaudited writes or unemitted events; resolved before sign-off.
  - Deps: B.4.1.

- **H.1.7** — Demo video.
  - Files: `h-rehearsal-evidence/rehearsal-walkthrough.mp4`.
  - Validation: captures H.1.1–H.1.6.
  - AC: Video archived; dossier index updated.
  - Deps: H.1.1–H.1.6.

- **H.1.8** — Gap list publication.
  - Files: `h-rehearsal-evidence/gap-list.md`.
  - Validation: any unresolved gap → backlog ticket.
  - AC: Gap list reviewed + signed off.
  - Deps: H.1.7.

### Sprint H.2 — Greenlight Gate (V1 GA Decision) — NOT A NORMAL ENGINEERING SPRINT
**Note:** This is the V1 GA decision gate, not a sprint of engineering tickets. The five "stamps" below are documentation + sign-off artifacts whose underlying engineering is already ticketed across EPICs A–G. Treat H.2.1–H.2.5 as **gate evidence checklists**, not implementation tickets. Sprint demo = the V1 GA call itself.

**Gate criteria:** Five Green gates from framework §9 all hold; user authorizes V1 GA.

#### Tickets

- **H.2.1** — Engineering Green checklist.
  - Files: `h-rehearsal-evidence/engineering-green-checklist.md`.
  - Validation: all items checked.
  - AC: Engineering signs off.
  - Deps: H.1.8.

- **H.2.2** — Operator Green stamp.
  - Files: `h-rehearsal-evidence/operator-green-stamp.md`.
  - Validation: Saraswati operator's signed statement.
  - AC: Operator signs off.
  - Deps: G.2.x + H.1.8.

- **H.2.3** — Compliance Green stamp.
  - Files: `h-rehearsal-evidence/compliance-green-stamp.md`.
  - Validation: Flash I/II + residency + consent + discipline checks pass.
  - AC: Compliance signs off.
  - Deps: E.1.7 + E.3.3 + E.4.2 + E.5.1.

- **H.2.4** — Adoption Green stamp.
  - Files: `h-rehearsal-evidence/adoption-green-stamp.md`.
  - Validation: G.3.2 dashboard meets thresholds.
  - AC: Adoption signs off.
  - Deps: G.3.2.

- **H.2.5** — Generalization Green stamp.
  - Files: `h-rehearsal-evidence/generalization-green-stamp.md`.
  - Validation: F.2.2 + F.3.3 pass.
  - AC: Generalization signs off.
  - Deps: F.2.2 + F.3.3.

### Sprint H.3 — 30-Day Hypercare
**Source:** v2 plan I.

**Demo:** Saraswati live for 30 days. Hypercare runbook in place. Day-30 retro committed.

#### Tickets

- **H.3.1** — Operator-led onboarding session (recorded).
  - Files: `c13-launch-artifacts/onboarding-session.mp4`.
  - Validation: recorded.
  - AC: Operator completes daily ops independently.
  - Deps: H.2.x.

- **H.3.2** — Day 0-7 observability daily check.
  - Files: `c13-launch-artifacts/week-1-checks.md`.
  - Validation: daily check artifacts.
  - AC: No P0/P1 in week 1.
  - Deps: H.2.x.

- **H.3.3** — Day 8-30 hypercare triage queue.
  - Files: `c13-launch-artifacts/hypercare-queue.md`.
  - Validation: triage queue empty by day 30 OR each item tracked.
  - AC: Queue managed.
  - Deps: H.3.2.

- **H.3.4** — Day 30 retrospective.
  - Files: `c13-launch-artifacts/day-30-retro.md`.
  - Validation: retro committed.
  - AC: Lessons → backlog.
  - Deps: H.3.3.

- **H.3.5** — Sign-off log update in dossier.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/dossier.md` "Sign-off log".
  - Validation: dossier updated.
  - AC: All gates green in dossier.
  - Deps: H.3.4.

---

## 11. Risk Register — v2 carry-over + new

### 11.1 v2 plan §10 R1–R21 carry-over with explicit mitigation-ticket mapping

| v2 ID | Risk | v3 mitigation ticket(s) |
|---|---|---|
| R1 | School opens <14 days; D1 frontend slips | Sprint A.1 sized small; A.1.x can ship after 0.2.7 lint without blocking other A sprints |
| R2 | Principal continues IEMIS uploads while ENG-2 unshipped → backfill scope compounds | 0.1.1 → 0.1.2 → 0.1.3 lock-ordered (Sprint 0.1) |
| R3 | F2 (IEMIS) deadline mid-2026 before F1 ready | Resolved 2026-05-19 (flexible); document in pilot dossier per G.1.4 |
| R4 | `dev-pabson-primary` SchoolConfiguration regression hides demo bugs | 0.2.14 audit; reframed as DoD checklist item, runs pre-EPIC-A demo |
| R5 | shared-types caret-pin drift breaks Docker build | §1.4 + §1.5 enforce; per-sprint DoD checklist |
| R6 | EventBridge Lambda cold-start on result Lambda causes >30s SLA breach | A.4.3 cold-start budgeted ≤45s; DLQ + alarm |
| R7 | Operator hypercare UTC+5:45 on-call not staffed | G.2 weekly sync + H.3 hypercare scheduling; framework §8 open question for product |
| R8 | K.2 invariant-13 grep finds late-stage drift | NEW F.0.1 — Weekly invariant-13 audit cron starting at EPIC-D kickoff |
| R9 | Module-wiring spec skipped on new modules | §1.4 + §1.5 enforce; 0.3.2 establishes academics pattern |
| R10 | Finance NPR-literal residue breaks F.2.2 GENERIC | 0.2.13 (relocated to Sprint 0.5 — finance widen) lands before F.2.2 |
| R11 | IEMIS job janitor missing → stuck-running invisible | 0.1.4 janitor |
| R12 | Cognito 1h JWT TTL shorter than CDK+ECS roll | DoD: capture JWT just before smoke; documented in §1.4 sprint DoD |
| R13 | Two-repo git hygiene violation | DoD: explicit `cd <repo>` per git command; CLAUDE.md house rule enforced at PR review |
| R14 | Saraswati operator surfaces Phase-D issue mid-sprint | G.2 weekly sync + in-sprint fast-follow PR budget |
| R15 | Pilot 2 candidate not identified before F.3 | G.1.3 scouting; F.3.1 dep on G.1.3 |
| R16 | Saraswati AY 2083 calendar operator edits won't survive future regenerate | H.1.2 merge-mode audit |
| R17 | Academics has no `auditedWrite()` infrastructure | Sprint 0.3 (0.3.1–0.3.5) ports + migrates |
| R18 | All ~30 academics events PascalCase, unvalidated | Sprint B.2 (B.2.1–B.2.3) migration |
| R19 | Academics has no `module-wiring.spec.ts` | 0.3.2 ships |
| R20 | No timetable entity; period attendance over-scoped | A.5 deferred to V1.5; Saraswati runs class-teacher-takes-morning-attendance for Term 1 |
| R21 | Discipline / Behavior module absent | E.2 (soft per CEO 2026-05-20) |

### 11.2 New risks introduced by this v3 breakdown

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R22 | Track D-Plan `ExternalAssessment` family entities slip; BLE workflow blocks | M | H | Sprint D.3 lands BEFORE D.4 (BLE) attempts use |
| R23 | Document Rendering Lambda cold-start breaches latency budget | M | M | C.2.4 measures + documents; provisioned-concurrency reserved as V1.5 escape hatch |
| R24 | `archetypeDefaults` entity (0.4) slips, blocks all of EPIC-D | H if 0.4 deferred | H | Make 0.4 hard-dep before any D sprint starts |
| R25 | School branding asset bucket per-tenant scope mismatch with tenant-template-stack-basic CDK | M | M | C.1.3 reviews CDK pattern; may need pivot to shared bucket with prefix |
| R26 | Champion field trip surfaces requirement that's V1-blocking | M | H | G.1.4 debrief surfaces; framework §8 update; bundled into next sprint |
| R27 | Messaging microservice ECS service consumes capacity in `prod-basic` cluster | L | L | B.1.1 deploys; monitor; scale up if needed |
| R28 | PABSON pre-board marks-feed-term-grade decision unknown until G.1 | M | M | D.5.6 ships configurable per-school; defaults per archetype |
| R29 | Cross-year handoff (D.2.7–D.2.12) attendance preservation across `gradeLevel` rewrite breaks invariant 3 | M | H | D.2.10 explicit guard test; H.1.x evidence sprint validates pre-Greenlight |
| R30 | C.4.1 admit-card template's `RenderContext` shape locks before D.4 entities are finalized; rework risk | M | M | C.4.1 ships data-shape schema; D.4.4 / D.5.3 wire entity → template at integration time (cycle broken) |

---

## 12. Dependency graph

```
EPIC-0 (Foundation)
├── 0.1 + 0.2 — parallel; ENG-1/ENG-2 land first
├── 0.3 — Academics audit infra (parallel with 0.1/0.2)
└── 0.4 — ArchetypeDefaults (hard-dep for all EPIC-D)
                ↓
EPIC-A (Operate)                          EPIC-B (Communicate)             EPIC-C (Distribute)             EPIC-D (Plan)
├── A.1 — Dashboard daily-activity          ├── B.1 — Messaging msvc        ├── C.1 — School Branding       ├── D.1 — GradingPolicy plug
├── A.2 — Subject entity (hard-dep ←0.4)    ├── B.2 — Notif taxonomy        ├── C.2 — Renderer Lambda       ├── D.2 — PromotionRule
├── A.3 — Exam (hard-dep ←A.2)              ├── B.3 — EB rules + fanout     ├── C.3 — Invoice + Bill        ├── D.3 — ExternalAssessment fam
├── A.4 — Result (hard-dep ←A.3)            ├── B.4 — Inbox UI              ├── C.4 — Admit + Report Card   ├── D.4 — BLE (hard-dep ←D.3)
└── A.5 — Period attend (V1.5)              ├── B.5 — SES adapter           └── C.5 — Operator branding UI  ├── D.5 — SEE (hard-dep ←D.3)
                                            └── B.6 — Notice subsystem                                       ├── D.6 — NEB-11/12 (hard-dep ←D.3)
                                                                                                              └── D.7 — Track entity (V1.5)

EPIC-E (Comply)                       EPIC-F (Generalize)                EPIC-G (Operator validation)    EPIC-H (Greenlight)
├── E.1 — Flash I/II MVP              ├── F.1 — 2-pilot smoke matrix     ├── G.1 — Champion field trip   ├── H.1 — Saraswati evidence
├── E.2 — Discipline soft             ├── F.2 — Synthetic GENERIC        ├── G.2 — Weekly operator sync  ├── H.2 — Five Green stamps
├── E.3 — Residency assertion         ├── F.3 — Pilot 2 provisioning     └── G.3 — Adoption telemetry    └── H.3 — 30-day hypercare
├── E.4 — Consent capture             └── F.4 — Retro
├── E.5 — Tenant export
└── E.6 — Scholarship quota
```

**Critical-path summary:** 0 → (A.2 → A.3 → A.4) → (D.2.7–D.2.12 cross-year) + (D.3 → D.4 + D.5) + (C.1 → C.2 → C.3) → (C.4 + D.4.4 + D.5.3 interleave) + (B.1 → B.3 → B.4) + (E.1 → E.3 → E.4 → E.5) → F.1 → F.2 → G.1 → F.3 → H.1 → H.2 → H.3 = Greenlight.

**Parallel-eligible (corrected from v3.0):**
- EPIC-G.1 runs in parallel with EPIC-0 ✓
- EPIC-B and EPIC-A: independent (run in parallel) ✓
- EPIC-C.1 + C.2 + C.3 parallel with EPIC-D.1 + D.2 + D.3 ✓
- **EPIC-C.4 and EPIC-D.4/D.5 interleave, NOT parallel** — C.4.1 ships template data-shape (no entity dep); D.4.4 / D.5.3 wire entity → template at integration time. Sequencing: C.4.1 → D.3.x entities → D.4.4 / D.5.3 → C.4.3 (result-card render).
- EPIC-E.1 cannot start until C.5 evidence + C.1 branding (E.1.2 template depends on G.1.2 sample) — re-stated.
- EPIC-F.2 cannot start until 0.2.13 (relocated finance widen) ships.

---

## 13. Definition of Done — All Levels

### Per ticket
- [ ] Files changed match listed Files
- [ ] Validation passes (test or documented manual procedure)
- [ ] AC reviewer-checkable (no "tested locally")
- [ ] All architecture invariants (§4 of v1 plan) preserved
- [ ] Audit + event paired (Sprint 0.2.7 lint enforces)
- [ ] Three-way route registration (Nest + tenant-api-prod.json + nginx.template) verified if new endpoint
- [ ] If shared-types changed: minor bump + npm publish + AdminWeb jsdom sim
- [ ] If new NestJS module: module-wiring spec updated SAME PR
- [ ] If new GSI: gsi-inventory.md updated BEFORE CDK deploy
- [ ] Invariant 13 grep returns zero hits
- [ ] PR description references ticket ID (e.g., `D.4.1 — BLE registration endpoint`)

### Per sprint
- [ ] Every ticket meets per-ticket DoD
- [ ] Sprint demo recorded (or run live) against pilot dev tenant or Saraswati
- [ ] Deploy log committed to docs/deploys/ for prod-touching actions
- [ ] No regressions in prior sprints' smokes (regression bundle re-run)
- [ ] Closeout note added to docs/pilot-greenlight/sprint-closeouts.md
- [ ] Risk register updated if new risks surfaced
- [ ] Open questions resolved or escalated to framework §8

### Per EPIC
- [ ] Every sprint within EPIC meets per-sprint DoD
- [ ] EPIC-level smoke (the demoable goal) verified
- [ ] Master framework (`v1-master-framework.md`) §2.1 status updated
- [ ] If EPIC-D: invariant 12 + 13 lint passes (no archetype-bleed or pilot-name in code)
- [ ] If EPIC-A or EPIC-D: parametric smoke matrix green on Saraswati + dev-pabson-primary
- [ ] If EPIC-F: synthetic GENERIC archetype smoke green

### Per V1 (the Greenlight gate)
- [ ] All 8 EPICs meet per-EPIC DoD
- [ ] Five Green gates from framework §9 hold (Engineering / Operator / Compliance / Adoption / Generalization)
- [ ] Day-30 hypercare retro committed
- [ ] Pilot 2 onboarded with zero engine code change

---

## 14. What this breakdown deliberately does NOT include

- Tickets that pre-date EPIC-0 (Phase A/B/C — already shipped per v1 plan §0.5)
- Mobile apps (V2 per CEO)
- SMS provider integration (V2; adapter interface stubbed in B.5.2)
- Allen-ISD-specific entities (Endorsements, ARD/IEP, GT, CTE clusters, Performance Acknowledgements, Distinguished Achievement)
- LMS / lesson-plan / content-delivery features
- HR / payroll
- Transport route management
- Public APIs for 3rd-party integrations
- Multi-language UI (deferred V1.5)
- Real-time IEMIS portal API (V1 stays at CSV export)
- Biometric attendance integration (V2)
- Master schedule auto-generator (V1.5)

---

## 15. Ticket count summary (v3.1 post-review)

| EPIC | Sprints | V1 Tickets | V1.5 Tickets (deferred) | Notes |
|---|---|---|---|---|
| EPIC-0 | 4 | 25 | 0 | |
| EPIC-A | 5 | 18 | 10 | A.5 (period attendance + timetable + substitute) deferred V1.5 |
| EPIC-B | 6 | 19 | 0 | |
| EPIC-C | 5 | 18 | 0 | +1 (C.3.0 invoice event taxonomy) |
| EPIC-D | 6 | 41 | 3 | +6 cross-year (D.2.7–D.2.12); +1 RubricCategory (D.3.0); D.7 V1.5 |
| EPIC-E | 6 | 17 | 0 | |
| EPIC-F | 3 | 6 | 0 | F.4 folded into H.1.8 |
| EPIC-G | 3 | 9 | 0 | |
| EPIC-H | 3 | 16 | 0 | H.2 is gate, not engineering sprint |
| **Total V1** | **41** | **169** | **13 V1.5** | |

Each V1 ticket targets 30-60 min PR review. V1 GA effort: ~169 atomic PRs (was 173; -10 A.5 V1.5 deferral + 6 cross-year added + 1 RubricCategory + 1 invoice events − 1 F.4.1 folded − 1 net).

### v3.1 follow-up items still pending (not blocking V1 execution)

The following improvements from the staff-engineer review (2026-05-20) are documented but not yet edited into this file. They are non-blocking — engineers can begin Sprint 0.1 + 0.2 work today and these issues are caught at PR review per the §1.5 implicit-Files contract:

1. **Three-way-handoff Files: explicit listing** on ~30 new-route tickets — §1.5 implicit contract handles at PR-review time; explicit edit deferred to v3.2.
2. **Module-wiring Files: explicit listing** on ~15 new-module tickets — §1.5 implicit contract handles; explicit edit deferred.
3. **Atomicity splits** for 0.1.3 (split a/b/c), 0.3.5 (4 services), C.5.2 (4 templates) — to be done at sprint kickoff by the engineer claiming the ticket.
4. **Sprint re-buckets**: 0.2.13 finance widen recommended to move into new Sprint 0.5; deferred (mitigated by R10 mapping).
5. **AC rewrites** for 0.2.2 spike, 0.2.8 BS picker, A.1.2 co-teacher conditional, B.3.4 dunning cadence, C.2.4 cold-start, H.1.6 audit completeness — to be tightened at sprint kickoff.
6. **NEW F.0.1 weekly invariant-13 audit cron** (R8 mitigation) — to be added as a free-standing ticket inside Sprint F.1.
7. **GSI inventory updates** as explicit Files: line on all entity tickets that introduce a GSI (~10 tickets).
8. **CDK file Files: listing** on all tickets that touch `tenant-template-stack.ts` (B.1.1, B.3.x, C.1.3, C.2.1, E.1.5).

Track these in a v3.2 revision once the cross-year tickets are reviewed and the team has begun Sprint 0.1.

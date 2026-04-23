# IEMIS Import — Sprint Plan (v4)

**Date:** 2026-04-23
**Author:** Claude, pair-programming with Shoaib
**Status:** Draft for Shoaib's review
**Supersedes:** v1, v2, v3 (retained in git history)
**Companion:** [iemis-import-post-mortem-and-emis-roadmap.md](./iemis-import-post-mortem-and-emis-roadmap.md)

---

## Goal

**Help pilot tenants import their IEMIS Student data correctly into EdForge.**

The import's only job: parse the IEMIS xlsx and create correctly-shaped Student records (with existing nested Guardian data). That's it. Assignment to Academic Year, Classroom / Section, and any lifecycle state are separate admin workflows and already built in EdForge.

---

## Architectural principles

1. **EdForge is Ed-Fi-aligned.** Student demographic fields use Ed-Fi descriptor URIs where the mapping is unambiguous.
2. **Import is data ingestion only — no graph construction.** The xlsx `Year` column is a single year number (e.g., `2082`), not a scoped AcademicYear relationship. We do not synthesize AcademicYear links at import time. After Students are imported, the operator manually assigns them to the active AcademicYear and Classroom via the existing admin UI.
3. **Guardian data stays on Student.** The xlsx "Guardian Contact Number" is guardian-owned, not student-owned, and the existing nested-Guardian shape on Student already captures it correctly. No new `Contact` entity needed.
4. **Ambiguous columns defer to manual intervention.** Unknown descriptor values → warning finding → field left empty → operator edits manually. Never guess.
5. **No production data to preserve.** No backfills, no migrations. A cleanup script (written later) wipes IEMIS test data before the real pilot.
6. **Feature-flag user-visible changes.** Rollback = DDB write.

---

## Terminology

**Section / Classroom.** Backend uses `Section` (Ed-Fi standard); frontend reads "Classroom" (user-friendly, familiar from Google Classroom). Same entity, two labels. This distinction is not touched by anything in this plan — it's called out only to prevent accidental renaming.

---

## Scope

| Item | Decision | Reason |
|---|---|---|
| Parse & create Student records from IEMIS xlsx | **In** | Core |
| Fix known bugs (guardian-ID collision, pagination) | **In** | Foundations |
| Async import job primitive (fix 504 / scale) | **In** | Timeout is a real blocker |
| Map Student demographic columns to Ed-Fi descriptors (sex, language, disability, mother tongue) | **In** | Fields belong on Student; currently being dropped |
| `isTransferred` column | **Captured as passive Student flag** | No behavior; admin may act on it later |
| AcademicYear linkage from import | **Out** | `Year` column is a single number, not a relationship. Operator assigns post-import |
| StudentSchoolAssociation creation from import | **Out** | Same reason |
| `Contact` first-class entity + StudentContactAssociation | **Out** | Existing nested Guardian shape is correct |
| Classroom / Section assignment from import | **Out** | Admin UI already does this |
| Parent portal / Cognito for parents | **Out** | Not priority |
| EventBridge live-telemetry to analytics | **Out** | Not priority |
| Reverse IEMIS xlsx export | **Out** | Deferred |
| Status state machine (transferred / withdrawn / graduated) | **Out** | Admin lifecycle workflow |
| Student status / attendance / grades admin workflows | **Out** | Already built |
| Backfills / data migrations / dual-read | **Out** | No prod data to preserve |

---

## Sprint overview

| # | Sprint | Demoable outcome |
|---|---|---|
| 0 | **Foundations** | Guardian-ID collision fixed; TanstackDataTable pagination audited; per-request identity-service cache; atomic counter primitive; feature-flag helper. No user-visible behavior change. |
| 1 | **Async import job primitive** | Imports of any size run async behind a flag; operator watches job progress; no 504. |
| 2 | **Student demographics via Ed-Fi descriptors** | Import captures mother tongue / disability / sex / language / isTransferred as Ed-Fi descriptor URIs on Student. Re-import enriches existing students. Unmappable values become warning findings with empty fields. |

Three sprints. Linear chain. If the project stops after any one of them, the tenant has a better-working import than today.

---

## Conventions

- Ticket IDs: `S<sprint>.<n>`.
- Flags: `WorkspaceSettings.features.<key>`.
- Shared-types bumps trigger the AdminWeb publish-gate checklist per [CLAUDE.md](../../CLAUDE.md#adminweb-publish-gate-gotcha---workspace-only-packages-break-codebuild).
- Every CDK change: UAT-first, logged `cdk diff` + `cdk deploy`.

---

## Sprint 0 — Foundations

**Goal:** bugs fixed, primitives in place, no user-visible regression.

**Dependencies:** none.

#### S0.1 — Guardian-ID uuid fix

- **Touches:** [student.mapper.ts#L233](../../server/application/microservices/academics/src/common/mappers/student.mapper.ts#L233)
- **Summary:** Replace `\`guardian-\${Date.now()}\`` with `uuid()`. Multiple guardians created in the same millisecond currently share a `guardianId`; uuid fixes this.
- **Validation:** unit — 2-guardian Student → distinct IDs; 10 parallel synchronous calls → 10 distinct IDs.
- **Deploy:** academics ECR + ECS roll.

#### S0.2 — TanstackDataTable pagination audit

- **Touches:** [StudentTable.tsx](../../edforge-saas-frontend/apps/academics/src/components/students/StudentTable.tsx); SectionTable, CourseTable, EnrollmentTable, TeacherTable; document the pattern in `edforge-saas-frontend/README.md`
- **Summary:** Tables using `TanstackDataTable` with client-side `pagination={{ pageSize: 20 }}` disable Next even when the server reports `hasMore=true`. For tables expecting >20 server rows, switch to the `useInfiniteQuery` + `hasNextPage` pattern already working in the Enrollment route.
- **Validation:** vitest per table — 40-row mocked response → Next enabled page 1, Previous enabled page 2.
- **Deploy:** Vercel.

#### S0.3 — Atomic counter primitive

- **Touches:** [dynamodb-client.service.ts](../../server/application/microservices/academics/src/common/services/dynamodb-client.service.ts); new `atomicIncrement(tenantId, counterKey, delta): Promise<number>`
- **Summary:** Extract the DDB `UpdateItem` + `ADD counter :delta` pattern from [student-id.service.ts](../../server/application/microservices/academics/src/students/student-id.service.ts) into a reusable method. One ConditionalCheckFailed retry on contention.
- **Validation:** 100 parallel calls → 100 distinct sequential values; 10 tenants × 100 calls load test.
- **Deploy:** code-only (no consumer yet).

#### S0.4 — StudentIdService on the primitive

- **Touches:** [student-id.service.ts](../../server/application/microservices/academics/src/students/student-id.service.ts)
- **Depends on:** S0.3
- **Summary:** Refactor onto `atomicIncrement`. Public API unchanged.
- **Validation:** existing tests green + new parallel-call test.
- **Deploy:** academics ECR + ECS roll.

#### S0.5 — Per-request identity-service cache (school lookup)

- **Touches:** new helper in `server/application/microservices/academics/src/common/services/identity-client.service.ts`; wire into `createStudent` call site
- **Summary:** Request-scoped `Map<schoolId, School>` or DataLoader wrapper. First call in a request fetches; subsequent calls for the same schoolId hit cache. Not cross-request.
- **Validation:** integration — 50 creates for same school in one request → 1 underlying HTTP. Measure commit-phase latency on UAT before/after (expect ≥2× speedup).
- **Deploy:** academics ECR + ECS roll.

#### S0.6 — Per-tenant feature-flag helper

- **Touches:** [workspace-settings.schema.ts](../../packages/shared-types/src/schemas/identity/workspace-settings.schema.ts); new `isFeatureEnabled(tenantId, flagKey)` in identity + academics
- **Summary:** Typed boolean flags, default false: `iemis.asyncImport`, `iemis.descriptorEnrichment`.
- **Validation:** unit (default / flip / read); E2E: PATCH settings → read-after-write returns new value.
- **Deploy:** shared-types publish → identity + academics rebuild → AdminWeb publish-gate.

#### S0.7 — CLAUDE.md publish-gate reminder

- **Touches:** [CLAUDE.md](../../CLAUDE.md)
- **Summary:** One-paragraph checklist for shared-types bumps: version, publish, verify registry, rebuild AdminWeb, run jsdom bundle sim.
- **Validation:** doc-only.

**Demo:** unique guardian IDs on a fresh import; StudentTable paginates through all pages; commit-phase latency measurably lower; feature flags flip per tenant via DDB.

---

## Sprint 1 — Async import job primitive

**Goal:** operator uploads any-size IEMIS file, sees a progress page, import finishes server-side, no 504. Sync path retained behind flag for safe fallback.

**Dependencies:** Sprint 0.

#### S1.1 — ADR: ECS worker

- **Touches:** new `docs/adr/003-iemis-async-execution-model.md`
- **Summary:** Decision: **ECS Fargate worker in `prod-basic` cluster**. Keeps NestJS stack, Service Connect to identity, existing DDB TVM IAM; no cold-start; imports are latency-tolerant. Trade-off table records why Lambda was passed over (loses Service Connect, adds packaging complexity, no meaningful latency benefit for this workload).
- **Validation:** ADR committed, Shoaib sign-off.

#### S1.2 — CDK: SQS FIFO queue + DLQ + worker service scaffold

- **Touches:** [tenant-template-stack-basic.ts](../../server/lib/tenant-template/tenant-template-stack-basic.ts); new `server/lib/tenant-template/iemis-worker.ts`
- **Depends on:** S1.1
- **Summary:** `iemis-import-queue.fifo` with DLQ; ECS service scaffolded with placeholder entrypoint. Tenant-scoped IAM. CDK Nag fixes inline.
- **Validation:** `cdk synth` green; UAT deploy; queue + DLQ + worker visible.
- **Deploy:** tenant-template-stack-basic.

#### S1.3 — Worker handler

- **Touches:** new `server/application/microservices/academics/src/students/iemis-worker.handler.ts`; refactor `importStudentsIemis` to accept job context
- **Depends on:** S1.2, S0.5
- **Summary:** Pulls SQS message `{jobId, tenantId, schoolId, s3FilePointer}`; streams xlsx from S3 once; runs transform + commit loop; writes progress to `IemisImportJob` DDB row (S1.4).
- **Validation:** integration — 10-row SQS message → 10 Students. Kill mid-batch → SQS redelivers → GSI7 dedup → idempotent result.
- **Deploy:** academics ECR + ECS roll (worker entrypoint flag).

#### S1.4 — `IemisImportJob` entity + service

- **Touches:** new `packages/shared-types/src/schemas/academics/iemis-import-job.schema.ts`; `iemis-import-job.service.ts`
- **Depends on:** S0.6
- **Summary:** Fields: `jobId, tenantId, schoolId, status (queued|running|succeeded|failed|partiallySucceeded), succeeded, failed, skipped, enriched, findings[], s3FilePointer, createdAt, startedAt, completedAt, ttl`. Throttled progress writes (every 50 rows or 2s). DDB TTL 30 days post-completion.
- **Validation:** unit CRUD + state transitions; TTL attribute present.
- **Deploy:** academics ECR + ECS roll + tenant-template-stack-basic (TTL enable).

#### S1.5 — API: async import + job status

- **Touches:** [students.controller.ts](../../server/application/microservices/academics/src/students/students.controller.ts); new iemis-jobs controller; API Gateway routes in [tenant-api-prod.json](../../server/lib/tenant-api-prod.json)
- **Depends on:** S1.3, S1.4, S0.6
- **Summary:** `POST /iemis/import` with `iemis.asyncImport=true` uploads xlsx to S3, enqueues job, returns `{jobId, status: "queued"}`. `GET /iemis/jobs/:jobId` polls. Flag off → existing sync path (preserved for one-file-at-a-time safety).
- **Validation:** E2E upload → poll → complete. Flag off → sync behaves as today.
- **Deploy:** academics ECR + ECS roll + shared-infra-stack (API routes).

#### S1.6 — Frontend: job progress page

- **Touches:** new `edforge-saas-frontend/apps/academics/src/routes/iemis/import-job.tsx`
- **Depends on:** S1.5
- **Summary:** Polls every 2s. Progress bar, counts, findings table, retry-failed CTA.
- **Validation:** Playwright — upload → redirect → poll → complete. Manual smoke: 779-row file, upload (S3 put + enqueue) in <5s.
- **Deploy:** Vercel.

#### S1.7 — Frontend: job history

- **Touches:** new `edforge-saas-frontend/apps/academics/src/routes/iemis/history.tsx`
- **Depends on:** S1.5
- **Summary:** Last 30 jobs per school (TTL caps it). Status filter.
- **Validation:** Playwright with seeded jobs.
- **Deploy:** Vercel.

#### S1.8 — Operator alert on DLQ depth

- **Touches:** [tenant-template-stack-basic.ts](../../server/lib/tenant-template/tenant-template-stack-basic.ts)
- **Depends on:** S1.2
- **Summary:** CloudWatch alarm: DLQ ≥ 1 for 5m → existing operator SNS topic. Runbook entry in [saraswati-oncall.md](./saraswati-oncall.md).
- **Validation:** poison-message injection in UAT → SNS delivered.
- **Deploy:** tenant-template-stack-basic.

**Demo:** upload the 779-row file to a flag-enabled tenant; redirect to job progress; completes in <60s, no 504. History page shows the run.

---

## Sprint 2 — Student demographics via Ed-Fi descriptors

**Goal:** import now captures mother tongue, disability, sex, language, and `isTransferred` as Student fields using Ed-Fi descriptor URIs. Re-importing enriches existing Students without duplicating. Unmappable values become warning findings with empty fields — operator edits manually post-import.

**Dependencies:** Sprint 0, Sprint 1.

#### S2.1 — Extend Student schema with Ed-Fi descriptor fields

- **Touches:** [student.schema.ts](../../packages/shared-types/src/schemas/academics/student.schema.ts)
- **Summary:** Optional fields: `sexDescriptor` (URI), `languageDescriptor`, `disabilities: [{ descriptor: URI, notes?: string }]`, `raceDescriptor` (shape-complete for future archetypes; unused in Nepal data). `isTransferred` captured as passive boolean flag — **no side-effect, no state-machine trigger**. `motherTongueDescriptor` optional URI.
- **Validation:** existing Students parse without new fields; URI pattern validates new fields.
- **Deploy:** shared-types publish → rebuilds → AdminWeb publish-gate.

#### S2.2 — Ed-Fi descriptor catalogues

- **Touches:** new `packages/shared-types/src/ed-fi/descriptors/` — flat JSON per descriptor (Language, Disability, Sex, Race; GradeLevel aligned with existing [grade-levels.ts](../../packages/shared-types/src/schemas/identity/grade-levels.ts))
- **Summary:** Canonical Ed-Fi 5.1 URIs + display labels + common aliases. Lint rule enforces `uri://ed-fi.org/*Descriptor#*`.
- **Validation:** per-catalog — URI regex passes, no duplicates. Fixture test: values observed in the real IEMIS xlsx columns all map.
- **Deploy:** shared-types publish.

#### S2.3 — Descriptor resolver

- **Touches:** new `packages/shared-types/src/ed-fi/descriptor-resolver.ts`
- **Depends on:** S2.2
- **Summary:** `resolveDescriptor(type, input, context?): URI | null`. Alias-aware ("Nepalese" → Nepali URI; "M" → Male). **Returns null on unknown input — no fuzzy matching, no guessing.** `getDisplayName(uri, locale)` companion for UI.
- **Validation:** alias coverage test; unknown input returns null + debug log.
- **Deploy:** shared-types publish.

#### S2.4 — IEMIS transformer wired to resolver

- **Touches:** [iemis-transform.ts](../../server/application/microservices/academics/src/students/iemis-transform.ts)
- **Depends on:** S2.3
- **Summary:** Route Mother Tongue, Disability Type, Gender, Is Transferred through the transformer. Demographics resolve via the resolver; unmappable values → row succeeds, field left empty, finding emitted at severity `warning` ("Disability type 'X' not recognized; field left empty. Admin may set it manually."). `isTransferred` parsed as boolean directly (yes/no/true/false/1/0). Existing `GRADE_RANGE_TO_DESCRIPTOR` routes through resolver for consistency.
- **Validation:** existing grade tests green; "Nepali" / "Nepalese" → same URI; unknown "frobnicator" → row success + finding + empty field.
- **Deploy:** academics ECR + ECS roll.

#### S2.5 — Enrich-on-conflict

- **Touches:** `importStudentsIemis` in [students.service.ts](../../server/application/microservices/academics/src/students/students.service.ts)
- **Depends on:** S2.4; flag `iemis.descriptorEnrichment`
- **Summary:** GSI7 finds existing Student → merge non-null enrichment fields onto existing record. Never overwrite non-null DB value with null from import. Never touch identity fields (name, DOB) on conflict. Count as `enriched` in job stats.
- **Validation:** integration — 10 without enrichment → 10 created; re-import with enrichment → 10 enriched. Never-overwrite test (motherTongue set, re-import with null → unchanged). Flag off → existing skip-on-conflict behavior.
- **Deploy:** academics ECR + ECS roll.

#### S2.6 — Student detail shows Ed-Fi descriptor values

- **Touches:** [StudentDetails.tsx](../../edforge-saas-frontend/apps/academics/src/components/students/StudentDetails.tsx)
- **Depends on:** S2.1
- **Summary:** Demographics section renders display names (not URIs) via `getDisplayName(uri, locale)`. Unknown or empty descriptor → "Not specified" with pencil-edit affordance so operator can set it.
- **Validation:** Playwright on seeded Student with a mix of set / empty descriptor fields.
- **Deploy:** Vercel.

**Demo:** re-import a file with flag on. Job result shows `enriched=N`. Spot-check a Student detail page — Mother Tongue / Sex / Disability rendered. A row with unmappable disability type lands with a warning finding + the field shows "Not specified" + pencil-edit.

---

## Dependency graph

```
S0 ── S1 ── S2
```

---

## Flag flip order

1. `iemis.asyncImport` (Sprint 1) — post-deploy, any time
2. `iemis.descriptorEnrichment` (Sprint 2) — after shared-types publish

Rollback = DDB PATCH reversing the flag.

---

## Risk register

| Risk | Sprint | Mitigation |
|---|---|---|
| AdminWeb publish-gate missed on shared-types bump | 0, 2 | S0.7 checklist |
| Descriptor catalog drift from real IEMIS values | 2 | S2.2 fixture tests against observed real columns |
| Flag-off path regresses as worker evolves | 1, 2 | Each sprint has explicit flag-off test |
| Operator doesn't realize unmappable field needs manual edit | 2 | Job findings table highlights them; Student detail pencil-edit makes correction one-click |

---

## Out of scope (intentional)

- Linking Students to AcademicYear / StudentSchoolAssociation from import
- `Contact` first-class entity + StudentContactAssociation (existing nested Guardian shape is correct)
- Classroom / Section assignment
- Parent portal / Cognito provisioning
- Student status state machine
- EventBridge live-telemetry to analytics
- Reverse IEMIS xlsx export
- IEMIS Teacher / Fee / Payment imports
- Data backfills / migrations
- Nepali UI localization
- SIF / OneRoster compatibility

---

## Open questions

None. Decisions recorded:
- Sprint 1 ADR: ECS worker (confirmed).
- Sprint 5 (live analytics): skipped — not priority.
- Guardian shape: existing nested Guardian on Student is the canonical home; no `Contact` entity work.
- AcademicYear linkage: out of import scope; operator assigns manually post-import.

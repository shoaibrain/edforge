# Sprint C4-OPS — Operator-Feedback Finisher (pre-Phase D)

**Status:** 🟡 Plan drafted 2026-05-19 — awaiting sign-off
**Date scoped:** 2026-05-19
**Predecessors:**
- [`c4-fe-sprint-closeout.md`](./c4-fe-sprint-closeout.md) — sprint that activated Saraswati
- [`pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md`](../pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md) — operator review that surfaced ENG-1 + ENG-2

---

## TL;DR

C4-FE put the pilot operator on the system. 24 hours later she had surfaced two engineering gaps that smokes had not caught in two weeks of running against `dev-pabson-primary`:

- **ENG-2** — IEMIS transformer drops `Mother Tongue`, `Is Transferred`, `Disability Type` columns and doesn't derive `sexDescriptor`. 204/206 records uploaded so far null on these fields. Phase F C10 IEMIS submission needs them.
- **ENG-1** — No LIST endpoint for IEMIS import jobs. Operator warnings (cross-school EMIS, combined-band placement, single-token names) land in `IemisImportJob.findings[]` but are unreachable without the per-upload jobId.

The principal is uploading **daily** and will continue across the 9 unimported grades over the next 1-2 weeks. Both gaps compound with every upload — ENG-2 linearly (backfill scope grows row-for-row), ENG-1 by lost visibility.

Sprint C4-OPS closes both, then hands off to Phase D (C5 Exam) — but with **C6 Period Attendance design starting in parallel from day 1**, because Saraswati opens for in-person classes within 2 weeks and C6 is daily-use the moment students walk in.

---

## §0 — Sequence and timing

```
Day 1 (today)   confirm + merge PR #61 + #130 (C4-FE closeout)
                C4-OPS branches cut for ENG-2 + ENG-1
                C6 design doc started in parallel
Day 2-3         ENG-2 ships (transformer + backfill)             ← C10 unblock, compounds daily
Day 3-4         ENG-1 ships (jobs LIST endpoint)                 ← operator visibility
Day 4-5         C5 Exam Subsystem kickoff per §7 critical path
Day 5+          C6 Period Attendance build (off the design doc)  ← ship before school opens
```

Ordering rationale:
1. **ENG-2 first.** Cost is linear in operator uploads. Every additional grade landed today increases the eventual backfill scope. ENG-1 is read-only — it doesn't change operator outcomes, only our visibility.
2. **ENG-1 second.** Still landed before half the remaining grades upload. Acceptable visibility gap.
3. **C6 design in parallel.** No merge cost; gives a head start so C6 build can begin once C5 kickoff is unblocking.

---

## §1 — Architecture decisions (resolved before code)

| # | Decision | Rationale |
|---|---|---|
| 1.1 | ENG-1 route: `GET /academics/students/import/iemis/jobs?schoolId=…&since=…&limit=…&cursor=…` | Tenant-scoped; `schoolId` required (matches the rest of the academics surface). Cursor-based pagination because IEMIS jobs accumulate over the term. `since=` for "show me what's new" polling, not a primary filter. |
| 1.2 | ENG-1 uses no new top-level prefix | Path lives under existing `/academics/students/import/iemis/*` block — nginx rproxy already covers `^/academics`, so **no new nginx route required**. Only API Gateway spec + Nest controller. Three-way handoff is two-way for this one. |
| 1.3 | ENG-2 backfill = idempotent one-shot script, not a migration | 206 rows today; ~700-800 by end of week. `scripts/backfill-iemis-derived-fields-saraswati.ts` runs against prod with explicit `--tenantId` + `--schoolId` flags and prints a diff before writing. No CDK involvement. Discard after one use. |
| 1.4 | ENG-2 transformer changes are additive only | Add 3 new field-mappers + 1 derivation. Don't touch existing column handlers. Existing 206 rows re-upload would be a no-op for already-set fields, but we don't re-upload — the backfill script computes the derived fields from the original XLSX-style data already on the entity. |
| 1.5 | Backfill source of truth | The XLSX columns we missed (`Mother Tongue`, `Is Transferred`, `Disability Type`) are NOT currently stored on `Student`. They're dropped at DTO build. Backfill therefore needs to **re-read the original XLSX files** — these are stored in S3 (`iemis-imports/<jobId>/<filename>`) per the IemisImportJob entity. Script signature: `--from-jobs <jobId,jobId,…>` or `--from-school <schoolId>` to enumerate. |
| 1.6 | sexDescriptor derivation | `Gender` column → `'Female'` / `'Male'` / undefined. Ed-Fi `sexDescriptor`: `uri://ed-fi.org/SexDescriptor#Female` (etc.). Map in transformer; nothing else changes. |
| 1.7 | Lookup tables for Mother Tongue + Disability | Ed-Fi descriptor namespaces. Local lookup table in `iemis-transform.ts` (mirrors `normalizeGradeLevel` style). Unknown values pass through as warnings, not rejections. |

---

## §2 — File-by-file plan

### PR α — ENG-2 (server/application/microservices/academics)

| File | Change | Size |
|---|---|---|
| `microservices/academics/src/students/iemis-transform.ts` | Add `mapMotherTongueToEdFi`, `mapDisabilityToEdFi`, `deriveSexDescriptor` helpers + lookup tables. Extend DTO builder (lines 240-258) to populate `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor`. | ~80 LOC |
| `microservices/academics/src/students/iemis-transform.spec.ts` | +12 tests: 3 per new field-mapper covering known/unknown/empty cases. Plus 4 derivation tests for sexDescriptor. | ~120 LOC |
| `packages/shared-types/src/identity/edfi-descriptors.ts` (or wherever Student.motherTongueDescriptor lives) | Verify the field exists; if missing, add to Student schema + bump shared-types minor | ~10 LOC + version bump |
| `scripts/backfill-iemis-derived-fields-saraswati.ts` | One-shot. Enumerates Saraswati's IemisImportJob rows → re-reads original S3 XLSX → computes derived fields → PATCHes student via existing `PATCH /students/:id`. Dry-run by default; `--apply` to write. | ~180 LOC |
| (no nginx change — academics prefix existed already) | | |
| (no API Gateway change — no new public route) | | |

### PR β — ENG-1 (server/application/microservices/academics)

| File | Change | Size |
|---|---|---|
| `microservices/academics/src/students/students.controller.ts` | Add `@Get('students/import/iemis/jobs')` handler with `@Query` for schoolId, since, limit, cursor | ~25 LOC |
| `microservices/academics/src/students/students.service.ts` (or import sub-service if separated) | Add `listIemisImportJobs(schoolId, opts, ctx)` querying the existing IemisImportJob entity's GSI. Cursor = lastEvaluatedKey. | ~40 LOC |
| `microservices/academics/src/students/students.service.spec.ts` | +6 tests: empty, paginated, since-filter, schoolId scope, unauthorized, ABAC denied | ~80 LOC |
| `server/lib/tenant-api-prod.json` | Add GET route declaration mirroring existing student import POST entry | ~30 LOC |
| (no nginx change — existing `^/academics` block covers it) | | |
| (no DDB GSI change — IemisImportJob already keyed by schoolId for this query pattern; verify before PR open) | | |

### Parallel — C6 design doc

| File | Change | Size |
|---|---|---|
| `docs/pilot-greenlight/c6-period-attendance-design.md` | Design doc only. Entity model, three-way handoff plan, FE component sketch, daily-use rollout strategy. Not a build PR yet. | ~150 LOC |

---

## §3 — Test plan

### Unit (Jest)
- ENG-2: +12 transform tests, +4 derivation tests
- ENG-1: +6 controller/service tests
- Existing IEMIS suite must remain green (133 tests on academics today per closest sprint memory)

### Smoke (live)
- ENG-2: re-run `s1-tier2-seed-exam-window-2083` or the closest IEMIS-shaped smoke against `dev-pabson-primary` post-deploy. Upload a small fixture with the new columns populated → assert derived fields are set on the resulting Student rows.
- ENG-1: curl the new LIST endpoint with the Saraswati TenantAdmin JWT, assert ≥5 jobs returned (one per per-grade upload from 2026-05-19), assert `findings[].length > 0` on at least one of them.

### Backfill validation
- Dry-run first: print before/after diffs for all 206 rows, no writes.
- User reviews diff → approves apply.
- `--apply` run: writes via PATCH, logs each PATCH response.
- Post-apply: re-query students, assert `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor` populated on the rows where XLSX source provided values.

### Operator validation
- Principal continues her next IEMIS grade upload. Assert new students land with the 4 fields populated (not null). This is the pilot-led signal that matters most.

---

## §4 — Deploy plan

```
1. Local: typecheck + lint + jest (academics)
2. shared-types publish (if §2 surfaces a missing schema field) → 0.51.0 → 0.52.0
3. ECR rebuild: academics only (identity untouched)
4. ECS roll: academicsbasic on prod-basic (ap-south-1)
5. ECS PRIMARY=COMPLETED + "Nest application successfully started"
6. Smoke against dev-pabson-primary
7. Operator-side: principal does next IEMIS upload as validation
8. Then: backfill script dry-run → user review → apply
```

ENG-1 deploys with the same ECR push (same service). No need for two ECS rolls.

---

## §5 — Risk register

| Risk | Mitigation |
|---|---|
| Mother Tongue / Disability lookup table is incomplete for Nepali context | Unknown values pass through with warning, not rejection. Operator review surfaces gaps over the next 9 grade uploads. |
| Backfill needs original XLSX files; S3 expired | Verify S3 lifecycle before scripting. If expired, principal re-uploads (operator already has the files). |
| ENG-1 LIST endpoint exposes per-import findings that include PII | Findings are warning text, not raw rows. Already stored in DDB IemisImportJob entity — ABAC-scoped per tenant. Verify before merge. |
| C5 Exam Subsystem slips by 2-3 days due to C4-OPS | Acceptable. C5 lead-time target is mid-June teacher visibility; mid-May+5 days is comfortably ahead. |
| C6 design doc consumes engineering time meant for C4-OPS | Design doc is ~3 hours of writing — fits in PR review wait windows. Not a parallel build effort yet. |

---

## §6 — Definition of done

- [ ] PR α (ENG-2) merged, academics deployed to prod, smoke green, **operator's next grade upload lands with new fields populated**
- [ ] PR β (ENG-1) merged, deployed, LIST endpoint returns ≥5 historical jobs for Saraswati's school
- [ ] Backfill script dry-run reviewed, `--apply` run completes with 0 errors, post-apply verification shows fields populated on the 206 historical rows
- [ ] C6 design doc landed (PR or direct-to-main with user approval)
- [ ] Closeout doc `c4-ops-sprint-closeout.md` written referencing this plan
- [ ] Sprint plan `docs/pilot-greenlight/sprint-plan.md` §0.5 updated with C4-OPS entry between C4-FE and Phase D

---

## §7 — What this unblocks

- **Phase F C10 IEMIS submission** — pre-populated with the 4 fields, no rework needed when C10 lands
- **Operator self-service support** — principal can see "what warnings did my last upload produce" without engineering involvement
- **Phase D C5 Exam Subsystem** — clean handoff with no operator-feedback debt
- **C6 Period Attendance** — design doc in place, build can start day 5

---

## §8 — Out of scope (explicit)

- DELETE route for IemisImportJob (operator hasn't asked; no use case yet)
- IemisImportJob retention policy (separate ops concern, not pilot-blocking)
- Re-uploading XLSX through a "fix and retry" flow (operator workflow is per-grade, no current need to re-upload)
- Cross-school EMIS-ID re-issue policy (CEHRD policy decision, not engineering)
- DOB-vs-grade validation hardening (operator-fixable; 4 records out of 206; OP-2 in review doc)

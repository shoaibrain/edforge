# Attendance Domain — Sprints 1 + 2 closeout

**Status:** ✅ Closed; HOLD at human-approval gate before Sprint 3 / 4 / S2.T6.
**PRs:** #293 (Sprint 1) + #294 (Sprint 2). Plus side-quest merge of #286
(SES Sprint 0+1) to align main with deployed prod state.
**Prod stack:** `prod-basic` cluster, ap-south-1, account `257526644020`.
**Git SHA deployed:** `041a8e8` (merge commit for PR #286 onto main; PR #293
+ #294 both reachable from this SHA via main's history).

---

## Scope for the reviewer

This closeout covers **Sprint 1 (school-attendance provenance + coverage
telemetry) and Sprint 2 (per-school attendancePolicy + archetype-defaulted
counting policy, read-path-only endpoint)**. Both sprints are
**read-path-only**; neither changes how attendance is recorded.

- **In scope:** Sprint 1 academics provenance work, Sprint 2 academics
  resolver + new `GET /academics/attendance/policy?schoolId=` endpoint,
  Sprint 2 identity per-school `attendancePolicy` config field with
  workspace-default inheritance + orphan guard fix.
- **Out of scope (future gates):** Sprint 3 (homeroom Section), Sprint 4
  (daily roll-call recording — the actual behavior change), S2.T6 (frontend
  policy selector — currently un-consumed by any UI).

Blast radius is contained: the new `/policy` endpoint is not consumed by
any frontend yet. Worst case = mis-resolution of returned policy values,
which cannot touch recording.

---

## Side-quest: PR #286 (SES Sprint 0+1) merged

Pre-deploy gate 5a on `shared-infra-stack` detected that **main was missing
the SES Sprint 0+1 code** that was already deployed to prod (deployed via
feature branch `claude/adoring-brown-m7hgN` @ git SHA `e457afd` on
2026-06-11; PR #286 still open at start of this turn). Re-running the
attendance deploy without first merging #286 would have produced a
`cdk diff` showing **destruction of all 8 SES resources** (EmailIdentity,
ConfigurationSet, SNS topic + policy + subscription, 2 CloudWatch alarms,
8 outputs).

Resolved by merging PR #286 to main (merge commit `041a8e8`, 2026-06-17
01:46:40 UTC) with admin override of the failing `secret-scan` CI check.
The `secret-scan` failure was a pre-existing historical AWS account ID
leak in commit `2879d80` (docs only); the cleanup commit `1c6aaa6`
already stripped current file state and explicitly deferred history
rewrite per the `.gitleaks.toml` convention. Operator authorized
proceeding because the repo is private.

After the merge, gate 5a's `cdk diff shared-infra-stack` showed exactly
the expected additive shape for this deploy: API GW Deployment churn +
spec body asset update only; SES resources fully retained.

---

## What deployed

| # | Artifact | Method | Evidence |
|---|---|---|---|
| 1 | `shared-infra-stack` (API GW route `/academics/attendance/policy` GET + OPTIONS) | `scripts/deploy-analytics.sh shared-infra-stack prod` | CFN UPDATE_COMPLETE 2026-06-17 02:57:58 UTC, 41.81s, 6/6 resources |
| 2 | `academics` service image | `scripts/build-application.sh academics` + `ecs update-service --force-new-deployment` on `academicsbasic` | ECR digest `sha256:18e58aefa3b44fcf980b8e36c1dbcdc2dbfa9c4edface9308793a9ea1871c8c9` (tag `041a8e8-20260617015951`); pushed 02:01:24 UTC; new task started 02:03:07 UTC |
| 3 | `identity` service image | `scripts/build-application.sh identity` + `ecs update-service --force-new-deployment` on `identitybasic` | ECR digest `sha256:8abe58741c87b131d483cff335069e3913796674734cee74a8978e66cbd24666` (tag `041a8e8-20260617020613`); pushed 02:07:41 UTC; new task started 02:09:11 UTC |

Both ECS services post-roll: `desired=1, running=1, pending=0, status=ACTIVE`.

**Not deployed (per the brief):** `tenant-template-stack-basic` was diffed
for sanity. The diff was not strictly empty — it showed git-SHA-stamp
drift on the `CreateTenantMapping` custom resource (codeCommitId
`aab4c84` → `041a8e8`) and the `S3SourceVersion` output, plus a CDK
metadata condition removal in a nested ECS cluster stack. **None of
these are functional infra changes** — no new IAM, DDB schema, GSI,
or task-def env vars. The brief's false-clear trap concern (Sprint 2
resolver re-using existing academics→identity TenantMetadataReader
GetItem grant from PR #253) is honored — no missing IAM. Drift will be
absorbed on the next legitimate `tenant-template-stack-basic` deploy.

---

## Verification evidence

### Pre-deploy gates (all PASS on merged main `041a8e8`)

| Gate | Result |
|---|---|
| 1 — `npm run typecheck:cdk` | clean |
| 2 — Jest (academics + identity attendance + module-wiring + schools.service paths) | 237 tests / 9 suites PASS |
| 3 — `cdk-nag synth shared-infra-stack` with `CDK_NAG_ENABLED=true` | clean; 18 pre-existing suppressions, zero un-suppressed errors |
| 4 — cross-stack export pre-flight | 20=20 names; additive only |
| 5a — `cdk diff shared-infra-stack` | additive: API GW Deployment churn + spec body asset (attendance route inside); SES untouched |
| 5b — `cdk diff tenant-template-stack-basic` | non-empty (SHA-stamp drift only, no functional changes); not deployed per brief |

Note: a Jest run before rebuilding `packages/shared-types/dist/` initially
failed with `TS2305 has no exported member 'AttendancePolicy'` —
classic stale-dist artifact (Sprint 2 added the export). Rebuild via
`cd packages/shared-types && npm run build` resolved it. CLAUDE.md
"Shared package rebuild" trap, paid forward.

### Smoke tests (on dev-pabson-primary tenant, school `3c28654f-...`)

| Check | Expected | Actual | Result |
|---|---|---|---|
| 1. `GET /academics/attendance/policy?schoolId=<id>` (TenantAdmin) | 200 with `effectiveMode:'daily'`, `modeSource:'archetype'`, archetype-derived counting policy | `{schoolId, effectiveMode:"daily", modeSource:"archetype", countingPolicy:{attendingCategories:["present","late","tardy","remote"], partialDayWeights:{half_day:0.5}, excusedTreatment:"absent_for_rate", chronicCountsExcused:true, chronicThresholdPct:10, atRiskThresholdPct:90}, countingSource:"archetype", archetype:"PABSON"}` | ✅ Exact match including epic § 2.3 research-based defaults |
| 2. Same endpoint, no `schoolId` | 400 (guard from `2fc4f79`) | `{statusCode:400, errorCode:"BAD_REQUEST", message:"schoolId query parameter is required"}` | ✅ |
| 3. Regression: `/academics/attendance/{summary, overview, trend, alerts}` | 200 | summary, trend, alerts all 200; **overview returned 200 with `date=` param** (see note below) | ✅ |
| 4. `GET /schools/:id/configuration` | 200; carries `attendancePolicy` field; `undefined` on pre-existing schools | 200; `has_attendancePolicy: false` (i.e., field omitted from JSON), correct for pre-existing school | ✅ |

**ECS services-stable ≠ DI wired** — the brief flagged this explicitly.
The Check 1 success (a 200 with the expected resolver-derived shape) is
the actual proof that the new `AttendancePolicyResolverService` +
`TenantMetadataReaderService` providers wired into `AttendanceModule`
booted cleanly inside the new container. Module-wiring spec on the
PR side caught this contractually; the smoke confirms in production.

**Smoke-script note on Check 3 — `/overview`:** First call without
query params returned 500 with `RangeError: Invalid time value`.
CloudWatch logs showed identical-minute live operator dashboard calls
to the same endpoint succeeding (with full `academicYearId` + `date`
params). The 500 was a **smoke-script defect** (missing required
`date`), not a deploy regression. Re-call with `&date=2026-06-17`
returned full overview payload including today's summary, section
completion, 7-day trend, period averages, at-risk students, absence
breakdown, day-of-week pattern. The latent "/overview crashes without
required params" is pre-existing and out of scope; documented here as
a follow-up candidate (low priority — operator UI always sends the
params).

---

## Reviewer-relevant notes

### Read-path-only — no recording behavior change

Sprint 1's provenance work added `derivedFrom` to `school-attendance.entity`
and tightened the section-derivation precedence (don't overwrite a
directly-recorded row, don't re-tag on CAS-failure retry). Sprint 2 added
the resolver + endpoint. **Nothing in either sprint runs at recording
time.** The next sprint (Sprint 4) is when the policy + counting
resolution actually starts affecting computed metrics — that's a
separate gate.

### Sprint 2 followed module-wiring invariant

`AttendanceModule.providers` was extended with the resolver service +
its `TenantMetadataReaderService` dep, AND the matching watchlist row
was added to `module-wiring.spec.ts` in the same PR. CLAUDE.md trap
honored ("Every new identity module MUST declare common-service
providers AND register in module-wiring.spec.ts in the same PR" —
applies symmetrically to academics).

### Cross-service IAM was NOT modified (intentional)

Sprint 2's resolver reads from the identity service over HTTP, not by
directly accessing identity's DDB table. The pre-existing
academics→identity `TenantMetadataReader` `GetItem` grant from PR #253
covers the only direct DDB cross-service read (tenant metadata for
archetype). No new IAM was added in `tenant-template-stack-basic` —
exactly the brief's "empty diff is a TRUE clear" promise.

---

## Outstanding items (do not gate Sprint 1+2 close)

1. **`tenant-template-stack-basic` git-SHA stamp drift** — present
   throughout this deploy window because we intentionally didn't deploy
   that stack. Will absorb on the next legitimate deploy of that stack.
   Functionally invisible.

2. **`/overview` requires `date` query param** to avoid a 500 — operator
   UI always passes one, so production traffic is unaffected. Treat as
   a latent input-validation follow-up; not pilot-blocking.

3. **PR #286 `secret-scan` follow-up** — historical AWS account ID leak
   in commit `2879d80` (docs) merged into main as part of the SES
   side-quest. Repo is private; deferred to the planned S2 baseline
   history rewrite per `.gitleaks.toml` convention. Document trail in
   the strip commit (`1c6aaa6`) message and in this closeout.

---

## What this does NOT close

**Sprint 3, Sprint 4, and S2.T6 stay behind future human-approval gates.**

- **Sprint 3 — homeroom Section.** Designate the homeroom Section for
  each student (reuse existing Section construct, not new entity).
  Required before Sprint 4 can resolve "the student's daily school
  attendance" without ambiguity.
- **Sprint 4 — daily roll-call workflow.** First sprint where attendance
  *behavior* changes — daily roll-call honors the resolved
  `attendancePolicy.effectiveMode` and the resolved `countingPolicy`
  for rate computation. This is the coverage-fix sprint; pre-pilot
  critical path.
- **S2.T6 — frontend policy selector.** Read-only display of the resolved
  policy in the school settings UI. Deferred until Sprint 4 or Sprint 6
  per the epic plan. Until then, the `/policy` endpoint has zero
  consumers; mis-resolution would be invisible to operators.

Each of those is a separate authorization request and brief.

---

## Sign-off

Sprints 1 + 2 are functionally closed. Read-path observability +
configuration in place; recording behavior unchanged; default
PABSON-archetype resolution validated end-to-end against a real prod
school under TenantAdmin auth.

PRs #293 and #294 (both already merged) ready for human review against
this evidence; PR #286 closed as part of the side-quest.

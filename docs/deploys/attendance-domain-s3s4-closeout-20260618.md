# Attendance Domain — Sprints 3 + 4 closeout

**Status:** ✅ Closed; HOLD at human-approval gate before Sprint 5 / 6 + S2.T6.
**PR:** #296 (merged to main, merge commit `debd786`; feature tip
`39e1223` referenced in the deploy brief).
**Prod stack:** `prod-basic` cluster, ap-south-1, account `257526644020`.
**Git SHA deployed:** `debd786`.

---

## Scope for the reviewer

This closeout covers **Sprint 3 (homeroom Section designation) and
Sprint 4 (daily roll-call workflow honoring resolved policy + counting)**.

**This is the first deploy where attendance recording behavior changes
in production.** Previous Sprints 1+2 (deployed yesterday) were
read-path-only.

- **In scope:**
  - Sprint 3: homeroom Section construct (`sectionType:'homeroom'`, no
    `courseId`), homeroom-students roster endpoint (stamps the student's
    annual Enrollment with the homeroom pointer), 3-way co-teacher
    scope reuse on existing GSI1.
  - Sprint 4: `POST /academics/attendance/daily/bulk` — single-shot bulk
    write that records authoritative `SCH_ATTEND` rows
    (`derivedFrom:'direct'`) + a `SectionAttendanceTaken` Ed-Fi marker
    keyed to (date, homeroomSectionId). Idempotent upsert.
  - Shared-types 0.80.0: `sectionType`/homeroom DTOs, daily-attendance
    schema + `toEdfiAttendanceEvent` + `attendanceRateWeight`, summary
    `coveragePct`.
- **Not in scope:** No DDB schema, GSI, or IAM change. Homeroom reuses
  the existing Section + SectionEnrollment entities; daily bulk reuses
  the existing school-attendance table; co-teacher scope reuses GSI1.

Blast radius: real data is written, but only on the homeroom roll-call
path (`POST /daily/bulk`). Period-mode schools' existing
section-attendance write path is byte-unchanged (no edits to
`section-attendance.service.ts`). The new endpoints are not consumed by
any frontend yet — they're available for direct CLI/operator invocation.

---

## What deployed

| # | Artifact | Method | Evidence |
|---|---|---|---|
| 1 | `shared-infra-stack` (3 new API GW routes) | `scripts/deploy-analytics.sh shared-infra-stack prod` | CFN UPDATE_COMPLETE, 46.96s, additive only; SES + attendance/policy outputs preserved |
| 2 | `academics` ECR + ECS roll on `academicsbasic` | `scripts/build-application.sh academics` + `ecs update-service --force-new-deployment` | ECR digest `sha256:665906092233d27c77215c532c7ca29a694259040bc11f8c05f6cc6ed4499c23` (tag `debd786-20260618184129`); pushed 18:42:29 UTC; new task started 18:44:08 UTC |

New API GW routes (in spec asset `921d1d36…`):
- `POST /academics/sections/homeroom`
- `POST /academics/sections/{id}/homeroom-students`
- `POST /academics/attendance/daily/bulk`

Identity service **not rolled** — Sprint 3+4 doesn't touch identity.
`tenant-template-stack-basic` **not deployed** per the brief; gate 5b
showed only the same git-SHA-stamp drift as Sprints 1+2 (`aab4c84` →
`debd786`), no functional infra changes.

`@aibrains/shared-types@0.80.0` published to npm pre-deploy by the
operator; consumer pins (`server/`, `server/application/`) already at
`^0.80.0` from the PR. Docker build resolved cleanly from the registry.

---

## Verification evidence

### Pre-deploy gates (all PASS on main `debd786`)

| Gate | Result |
|---|---|
| 1 — `npm run typecheck:cdk` | clean |
| 2 — Jest (attendance + homeroom + module-wiring + schools.service + Ed-Fi) | 278 tests / 10 suites PASS, including the new "Section-attendance derivation wiring (Sprint 4)" wiring spec |
| 3 — `cdk-nag synth shared-infra-stack` | clean; 18 suppressions; zero un-suppressed errors |
| 4 — cross-stack export pre-flight | 20=20 names; additive only |
| 5a — `cdk diff shared-infra-stack` | additive: API GW Deployment churn + spec body asset update (3 new route paths verified present in asset `921d1d36…`); SES untouched |
| 5b — `cdk diff tenant-template-stack-basic` | non-empty (SHA-stamp drift only, no functional changes); not deployed per brief |

`packages/shared-types/dist/` was rebuilt before Jest ran (paid the
yesterday-trap forward — Sprint 4's new exports were missing from a
stale dist on first run).

### Smoke tests (against dev-pabson-primary tenant, school `3c28654f-…`, 2026-06-18)

**Step 1 — Designate homeroom** ✅
```
POST /academics/sections/homeroom → 201
sectionId: 880b58db-1e1d-4e4d-a7f6-d923a5354856
sectionType: "homeroom", no courseId, sectionNumber: "Smoke-S4-20260618"
primaryTeacher: Sarah Murphy
```

**Step 2 — Assign 3 students to homeroom** ✅
```
POST /academics/sections/880b58db/homeroom-students × 3 → 201 each
Roster verified: totalCount=3 (Safina Khatun, Shristi Mahara, Sushant Laheri)
```

**Step 3 — `POST /attendance/daily/bulk`** ✅
```
1 student (Safina) marked absent; 2 default to present
Response: {success: true, rosterSize: 3, marked: 1, defaultedPresent: 2, recordsWritten: 3}
```

**Step 4 — DDB-level verification** ✅
Direct DynamoDB query on `edforge-academics-basic` table for entityKey
`SCH_ATTEND#2026-06-18#*`:

| studentId (prefix) | status | derivedFrom | attendanceEventCategory |
|---|---|---|---|
| `2060a8b7` | absent | **direct** | Unexcused Absence |
| `8e88a991` | present | **direct** | In Attendance |
| `914a7f76` | present | **direct** | In Attendance |

All three rows carry the Sprint 1 provenance tag (`derivedFrom:'direct'`) +
correct Ed-Fi `attendanceEventCategory` descriptor + `eventDuration` +
`dayOfWeek:4` (Thursday).

`SectionAttendanceTaken` marker confirmed:
```
entityKey: SEC_ATTEND_TAKEN#2026-06-18#880b58db-…
entityType: SECTION_ATTENDANCE_TAKEN
sectionId: 880b58db-…
date: 2026-06-18
takenBy: b1736dfa-… (operator), takenAt: 2026-06-18T18:51:11.438Z
```

The marker is the SIS-side projection of Ed-Fi's
`SectionAttendanceTakenEvent` (per epic § 2.4 — "always produce the
school-day event" invariant).

**Step 5 — `/summary` shows real metrics** ✅
```
{
  date: "2026-06-18",
  totalStudents: 3,
  totalRecorded: 3,
  present: 2, absent: 1,
  attendanceRate: 66.67,
  coveragePct: 100
}
```

The `coveragePct:100` is the Sprint 1 coverage-telemetry field
(introduced in `attendance.service.ts:+35 lines` from PR #293) being
populated end-to-end for the first time in production.

**Step 6 — Regressions** ✅
```
GET /academics/attendance/overview?schoolId=…&date=2026-06-18 → 200
GET /academics/attendance/trend?schoolId=…                    → 200
GET /academics/attendance/alerts?schoolId=…                   → 200
GET /academics/attendance/policy?schoolId=…                   → 200
```

Yesterday's policy endpoint still resolves to PABSON-archetype daily
mode (unchanged by this deploy — confirms read-path stability).

### Period-mode regression (code-level, no live mutation)

The brief's "period-mode school's section-attendance path is
byte-unchanged" check is satisfied at three levels:

1. **Code:** Sprint 4 doesn't edit `section-attendance.service.ts`
   (verified via `git log --stat 29fedca..debd786 -- section-attendance/`).
2. **Tests:** Section-attendance derivation specs pass in the Jest gate
   (9 tests under `section-attendance-derivation.service.spec.ts`).
3. **Infra:** Gate 5b shows no IAM/DDB delta on the period-mode write
   path; no task-def env var, no role change.

No live period-mode mutation was performed because the dev-pabson-primary
tenant resolves to **daily mode via archetype**; we have no period-mode
school readily available in prod-basic.

---

## Reviewer-relevant notes

### Behavior-change boundary crossed (intentional)

This is the **first deploy that writes new SCH_ATTEND rows** under the
new code path. Before today: those rows came only from the existing
period-mode section-attendance derivation. From today: they can also
come from a homeroom roll-call via `POST /daily/bulk`. The
`derivedFrom:'direct'` tag distinguishes the two sources; future
Sprint 5 (honest trend/monthly/chronic) and Sprint 6 (UX coherence)
both depend on this distinction.

### Module-wiring invariant honored

`SectionAttendanceModule.providers` was extended with the new resolver
+ `TenantMetadataReaderService` dep, AND the matching watchlist row
was added to `module-wiring.spec.ts` in the same PR (test name:
*"Section-attendance derivation wiring (Sprint 4)"*). CLAUDE.md
invariant satisfied.

### Smoke artifacts left in place (dev-tenant convention)

The smoke created persistent data on dev-pabson-primary:

- 1 homeroom Section `880b58db-1e1d-4e4d-a7f6-d923a5354856` ("Smoke-S4-20260618")
- 3 section-enrollment rows (Safina, Shristi-1, Sushant)
- 3 SCH_ATTEND rows for 2026-06-18 (1 absent + 2 present)
- 1 SECTION_ATTENDANCE_TAKEN marker for `880b58db / 2026-06-18`

Per the dev-tenant convention (memory: `project_dev_tenant_system_*`),
these are intentionally left as operational evidence. If a clean reset
is desired before Sprint 5/6, the homeroom section + its derived data
can be removed via the existing soft-delete paths.

### No frontend consumers yet

S2.T6 (frontend policy selector) and the homeroom UI are both deferred.
The 3 new POST endpoints are CLI/operator-callable; UI integration is a
Sprint 6 ticket. Until then, this deploy's behavior change is
operator-only — pilot schools won't see homeroom roll-call in their
dashboard yet.

---

## Outstanding items (do not gate Sprint 3+4 close)

1. **`tenant-template-stack-basic` git-SHA stamp drift** — still
   present; will absorb on the next legitimate deploy of that stack.
   Functionally invisible.

2. **Period-mode live regression check** — deferred until a period-mode
   tenant exists in prod-basic (PABSON archetype defaults all current
   tenants to daily). Static + code-level checks are documented above.

3. **Smoke cleanup** — homeroom + 3 enrollments + 3 SCH_ATTEND rows +
   marker for 2026-06-18 left in place on dev-pabson-primary; safe to
   delete if clean-state is desired.

---

## What this does NOT close

**Sprint 5 (honest trend/monthly/chronic), Sprint 6 (UX coherence),
S2.T6 (frontend policy selector) stay behind future human-approval
gates.**

- **Sprint 5** depends on Sprint 4's `derivedFrom` tag to compute honest
  rate vs chronic-absenteeism using the policy-resolved counting rules
  (rate excludes excused per `absent_for_rate`; chronic counts excused
  per `chronicCountsExcused:true`).
- **Sprint 6** wires the dashboard + bounded TanStack alerts table to
  consume the new daily roll-call + summary fields end-to-end.
- **S2.T6** — frontend policy selector for the school settings UI.

Each is a separate authorization request and brief.

---

## Sign-off

Sprints 3 + 4 are functionally closed. Homeroom designation + daily
roll-call workflow proven end-to-end against real Cognito-auth'd prod
traffic with full DDB-level invariant verification. Read-path
regressions all green. Period-mode write path code-level untouched.

PR #296 ready for human review against this evidence.

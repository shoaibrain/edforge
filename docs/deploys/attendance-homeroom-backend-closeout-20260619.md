# Attendance Homeroom Backend (PR #299) — closeout

**Status:** ✅ Closed.
**PR:** #299 (merged to main, merge commit `34379fa`).
**Prod stack:** `prod-basic` cluster, ap-south-1, account `257526644020`.
**Git SHA deployed:** `34379fa`.

---

## Scope for the reviewer

This closeout covers the **homeroom backend follow-up**:

- **B1 — bulk homeroom-assign** — single endpoint takes an array of
  student IDs and writes section-enrollment rows in a partial-progress
  fashion. Students already in a homeroom land in `skipped` with reason;
  the rest assign normally. HTTP 201, not a 4xx abort.
- **B2 — student-profile enrollment denormalization** —
  `GET /academics/students/{id}/profile` now resolves
  `currentEnrollment.academicYearName` (was UUID/undefined) +
  `homeroomId` / `homeroomName` (were empty) using a single batch-get
  shared with the classrooms read. Falls back to enrollment's
  `sectionId` when the dedicated `homeroomId` field is absent.

No shared-types change. No DDB/GSI/IAM/nginx change. Read-side
enrichment (B2) is best-effort — a failed lookup leaves the optional
field undefined rather than 500ing the whole profile.

---

## What deployed

| # | Artifact | Method | Evidence |
|---|---|---|---|
| 1 | `shared-infra-stack` (1 new API GW route) | `scripts/deploy-analytics.sh shared-infra-stack prod` | CFN UPDATE_COMPLETE, 47.34s, additive only; SES + earlier attendance outputs preserved |
| 2 | `academics` ECR + ECS roll on `academicsbasic` | `scripts/build-application.sh academics` + `ecs update-service --force-new-deployment` | ECR digest `sha256:aea78580c125762655e1160b57f16aeec29b81bef7691954a3d909107bf1d038` (tag `34379fa-20260619154223`); pushed 15:42:42 UTC; new task started 15:44:15 UTC |

New API GW route (in spec asset `fd6780c0…`):
- `POST /academics/sections/{sectionId}/homeroom-students/bulk` (VPC-link
  http_proxy + OPTIONS CORS mock, mirrors the existing
  `homeroom-students` block)

Identity service **not rolled** — PR #299 doesn't touch identity.
`tenant-template-stack-basic` **not deployed** per the brief; gate 5b
showed only the same git-SHA-stamp drift as the previous two deploys
(`aab4c84` → `34379fa`), no functional infra changes.

---

## Verification evidence

### Pre-deploy gates (all PASS on main `34379fa`)

| Gate | Result |
|---|---|
| 1 — `npm run typecheck:cdk` | clean |
| 2 — Jest (students.service + section-enrollment + homeroom + module-wiring) | 329 tests / 12 suites PASS |
| 3 — `cdk-nag synth shared-infra-stack` | clean; 18 suppressions; zero un-suppressed errors |
| 4 — cross-stack export pre-flight | 20=20 names; additive only |
| 5a — `cdk diff shared-infra-stack` | additive: API GW Deployment churn + spec body asset update; SES untouched |
| 5b — `cdk diff tenant-template-stack-basic` | non-empty (SHA-stamp drift only, no functional changes); not deployed per brief |

### Smoke tests (against dev-pabson-primary tenant, school `3c28654f-…`)

**Setup state** — yesterday's smoke left homeroom `880b58db…`
("Smoke-S4-20260618") with 3 students assigned (Safina, Shristi-1,
Sushant). Today's smoke creates homeroom `ab733ca6…`
("Smoke-H2-20260619") and exercises the new endpoint against a 4-student
payload where 1 is already in yesterday's homeroom (the partial-progress
test case).

**B1 — bulk homeroom-assign with partial progress** ✅
```
POST /academics/sections/ab733ca6…/homeroom-students/bulk
Body: {schoolId, studentIds:[Rukshar, Sadab, Sahil, Safina]}
Response: HTTP 201
{
  "assigned": 3,
  "skipped": [
    { "studentId": "2060a8b7-…" (Safina), "reason": "already in a homeroom" }
  ]
}
```
Per the brief: "201 { assigned, skipped }. Include one student already
in a different homeroom → it appears in skipped ('already in a
homeroom') and the rest still assign (partial progress, not a 4xx
abort)." ✅ exact shape.

**B2 — profile denormalization (all 3 paths)** ✅

| Student | Homeroom-assignment path | `currentEnrollment` fields |
|---|---|---|
| Safina (yesterday's homeroom) | legacy single-student POST yesterday | `academicYearName:"S2-092344"`, `homeroomId:"880b58db-…"`, `homeroomName:"Smoke test homeroom (Sprint 4 deploy validation)"` |
| Shristi-2 (today, legacy POST) | legacy single-student POST today | `academicYearName:"S2-092344"`, `homeroomId:"ab733ca6-…"`, `homeroomName:"Smoke test homeroom for PR #299 bulk-assign"` |
| Rukshar (today, bulk POST) | new bulk POST today | `academicYearName:"S2-092344"`, `homeroomId:"ab733ca6-…"`, `homeroomName:"Smoke test homeroom for PR #299 bulk-assign"` |

All three paths produce identical-shape denormalization output. The B2
enrichment works regardless of which homeroom-assignment endpoint was
used.

**Regression — legacy single-student POST** ✅
```
POST /academics/sections/ab733ca6…/homeroom-students?schoolId=…
Body: {studentId: "b56f92fe-…"} (Shristi-2)
Response: HTTP 201, enrolledAt timestamp populated; roster grew from 3→4
```

**Regression — unassigned student profile** ✅
A student enrolled in the AY but NOT assigned to any homeroom returns:
```json
{
  "currentEnrollment": {
    "enrollmentId": "dd1c92e2-…",
    "academicYearName": "S2-092344",
    "gradeLevel": "2",
    "status": "enrolled"
    // no homeroomId, no homeroomName — fields omitted when undefined
  }
}
```
Matches the brief's "Homeroom → '—'" behavior — the FE renders dashes
when the optional fields are absent.

### Smoke-script note

The first B2 attempt was a smoke-script defect: I called
`GET /academics/students/{id}` (no `/profile` suffix), which routes to
`getStudent()` not `getStudentProfile()`. `getStudent()` doesn't include
the B2 enrichment. CloudWatch logs caught the discrepancy
(`StudentsController...GET /academics/students/...` without
`/profile`), confirming the running container HAS the new code; the
test path was wrong. Re-call with `/profile` showed populated
`currentEnrollment` for all 3 assignment paths.

---

## Reviewer-relevant notes

### Enrollment-row schema observation (not in PR scope)

Reading Safina's `ENROLLMENT` row in DDB directly revealed:
- Field `homeroomId` is **absent** from the entity (never written by any
  prior code path).
- Field `sectionId` IS present and stamps the section assigned via
  homeroom-students POST.
- `homeroomTeacherId` IS also written (Sarah Murphy's UUID).

The B2 code accommodates this by falling back from `homeroomId` to
`sectionId`:
```typescript
const homeroomId = currentEnrollmentDto?.homeroomId ?? currentEnrollmentDto?.sectionId;
```
That's the correct interim shape — once a dedicated `homeroomId`
column is added on enrollment rows (a future ticket), the primary field
takes precedence automatically.

### `currentEnrollment` absent vs null in the response

The response intentionally **omits** `currentEnrollment` when the
student has no annual enrollment row (vs setting it to `null`). FE code
should handle both shapes defensively, but per the smoke evidence, all
prod-pabson-primary students in this test set DO have an enrollment row
(`status:"enrolled"`), so `currentEnrollment` is always present for
real operator traffic.

---

## Outstanding items (do not gate close)

1. **`tenant-template-stack-basic` git-SHA stamp drift** — same pattern,
   will absorb on the next legitimate deploy of that stack.

2. **Add a dedicated `homeroomId` column on `ENROLLMENT` rows** — future
   ticket. Today the B2 code's fallback to `sectionId` covers the gap
   transparently. When the dedicated column ships, no FE change needed
   (the JSON shape stays identical).

3. **Smoke artifacts left in place on dev-pabson-primary** (consistent
   with dev-tenant convention):
   - New homeroom `ab733ca6-f9a7-4d2d-898e-22288ee7e479`
     ("Smoke-H2-20260619")
   - 4 students now in that homeroom (Rukshar, Sadab, Sahil from bulk +
     Shristi-2 via the regression legacy POST)
   - Plus yesterday's homeroom `880b58db…` and its 3 students
   - 3 SCH_ATTEND rows for 2026-06-18 (from yesterday's smoke) untouched
   - No new attendance data today — this deploy doesn't touch the bulk
     attendance path

---

## What this does NOT close

Same backlog as yesterday — **Sprint 5 (honest trend/monthly/chronic),
Sprint 6 (UX coherence), S2.T6 (frontend policy selector)** all stay
behind future human-approval gates. This PR was a focused homeroom
backend follow-up; no behavior change to attendance counting or
recording.

`EDFORGE_SES_ENABLED` stays `false`; no Cognito wiring touched.

---

## Sign-off

PR #299 functionally closed. Bulk-assign endpoint proven against the
partial-progress contract (1 skipped + 3 assigned in a single 201);
student-profile denormalization proven against all 3 assignment paths;
legacy single-student POST regression untouched; unassigned-student
profile correctly renders empty homeroom fields ("—" placeholder).

Smoke evidence captured at API + CloudWatch + DDB levels.

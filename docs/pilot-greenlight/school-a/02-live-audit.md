# School A — Phase 2 live audit

> **STATUS: WORKSHEET — NO LIVE DATA COLLECTED YET.**
>
> Phase 2 requires a browser session authenticated as School A's admin. The
> session that produced this file runs in a cloud container with no browser tool
> and no credentials, so nothing below has been observed. Every `___` is an
> unanswered question, not a finding. Do not cite this file as evidence until
> the Observed columns are filled in.
>
> Resume from the Claude Desktop app or `claude remote-control`, or fill it in
> by hand. Checks are ordered so a failure stops the walk early.

**Rules carried from the brief:** read-only; no PII (counts and record IDs only,
never names, dates of birth or phone numbers); the in-country partner is "the
Champion".

---

## 0. Deployed version — resolve first

Phase 1 could not establish this (see `01-code-map.md` §1). Until it is known,
a live finding cannot be attributed to a known revision.

| Check | Where | Observed |
|---|---|---|
| Deployed backend SHA | `tenant-template-stack-basic` → `CommitId` output, or newest `$EDFORGE_DEPLOY_LOG_DIR/deploy-*-<sha>.log` | `___` |
| Matches `main` (`fcc2629`)? | compare | `___` |
| Frontend build live | shell bundle filename / build stamp in DevTools → Network | `___` |
| Matches frontend `main` (`7200171`)? | compare | `___` |

No attendance file changed between the last recorded deploy (2026-09-22) and
either `main` — verified by `git log --name-only`. So the Phase 1 map holds
whatever the answer is; this matters for the finance and guardian fixes in that
window, not for attendance.

---

## 1. Academic year / calendar

**Start here — this gates everything.** `/settings/organization/schools/<schoolId>?tab=academic-setup`

The banner on this tab renders the backend's own activation checklist from
`GET /schools/:id/activation-requirements`. One screenshot answers five rows.

| # | Check | Expected (PABSON) | Observed | Blocks? |
|---|---|---|---|---|
| 1.1 | Activation checklist rows met | 5 of 5 | `___` | — |
| 1.2 | AY with `status='active'` | ≥ 1 | `___` | B2 |
| 1.3 | **Exactly one AY with `isCurrent=true`** | exactly 1 | `___` | **B2 — hard gate** |
| 1.4 | Grading periods (terms) | 4 | `___` | — |
| 1.5 | Default bell schedule | 1 | `___` | — |
| 1.6 | Calendar generated for current AY | yes | `___` | **B3** |
| 1.7 | A normal **Sunday** is instructional | yes | `___` | **B3 inverse** |
| 1.8 | **Saturday** is non-instructional | yes | `___` | **B3** |
| 1.9 | Dashain / major holidays present as blocks | yes | `___` | B3 |
| 1.10 | School `status` | `active` or `setup` | `___` | no — not a gate |

**Traps.** 1.3 is independent of 1.2 — an active year with `isCurrent=false`
still kills the attendance screen; the tab offers **Set as Current** when it
detects exactly that. 1.6 fails *open*: a missing calendar means attendance
records cheerfully on Saturdays and Dashain and nothing warns, so confirm it
positively rather than inferring from "attendance works". 1.7/1.8 catch the
inverse — PABSON weeks run **Sun–Fri**, so a calendar generated with a
Sat/Sun weekend disables the grid on real teaching days.

---

## 2. Grades / sections

`?tab=grade-levels` for enabled grades; `/academics/classrooms` for sections.

| Grade | Enabled | Sections | Each has `primaryTeacherId` | Notes |
|---|---|---|---|---|
| Nursery | `___` | `___` | `___` | |
| LKG | `___` | `___` | `___` | |
| UKG | `___` | `___` | `___` | |
| 1 | `___` | `___` | `___` | |
| 2 | `___` | `___` | `___` | |
| 3 | `___` | `___` | `___` | |
| 4 | `___` | `___` | `___` | |
| 5 | `___` | `___` | `___` | |
| 6 | `___` | `___` | `___` | |
| 7 | `___` | `___` | `___` | |
| 8 | `___` | `___` | `___` | |
| 9 | `___` | `___` | `___` | |
| 10 | `___` | `___` | `___` | SEE year — excluded from first rollout |

**Trap.** School A's own grade codes are the design, not a defect. `PG`/`NUR`
resolving to `ECD` and `LKG`/`UKG` to `PPC` happens at the *reporting* boundary
only. Do not flag local labels as wrong because they differ from the CEHRD
canonical taxonomy.

---

## 3. Teachers

`/people/staff` for accounts; section `primaryTeacherId` from §2.

| Check | Observed |
|---|---|
| Total staff | `___` |
| Teachers with a login account | `___` |
| **Never logged in** (invite possibly expired) | `___` ← B1 risk |
| Account status not `active` | `___` (IDs: `___`) |
| Holds a school-scoped role at School A | `___` |
| Assigned as `primaryTeacherId` on ≥1 section | `___` |
| Sections with **no** teacher | `___` (IDs: `___`) |

**Trap — B1.** There is no resend-invite and no admin password reset anywhere in
the product. Cognito's forgot-password also fails for a user still in
`FORCE_CHANGE_PASSWORD`, i.e. one who never completed first login. Any teacher
in the "never logged in" row is potentially unrecoverable without AWS console
access. This number drives whether B1 is theoretical or the pilot's first
blocker — get it before anything else about teachers.

Role assignment lives at `/settings/security-policies` (school + role), **not**
`/academics/teachers`, which is a read-only directory.

---

## 4. Students

`/academics/students`, filtered by grade.

| Grade | Enrolled | In a section | **Unrostered** | Status ≠ enrolled/active | Missing required fields | Likely duplicates |
|---|---|---|---|---|---|---|
| Nursery | `___` | `___` | `___` | `___` | `___` | `___` |
| LKG | `___` | `___` | `___` | `___` | `___` | `___` |
| UKG | `___` | `___` | `___` | `___` | `___` | `___` |
| 1–10 | `___` | `___` | `___` | `___` | `___` | `___` |

Record **record IDs only** for duplicates and problem rows.

**Trap — B4.** Enrolment does not assign a section; the 6-step wizard has no
section field. An enrolled-but-unrostered student appears in **no** attendance
roster — not marked absent, simply absent from the denominator. The Unrostered
column is the single most important number in this table.

**Trap.** Attendance rosters include only enrolments with
`status === 'enrolled' || 'active'`. Any other status silently drops the student.

Fix surfaces: `/academics/rostering` (bulk student×section matrix, detects
period conflicts), `/academics/sections/<sectionId>/roster`, or the student
profile's Add-to-Section modal.

---

## 5. Parent / guardian contacts

Student profile `?tab=family`.

| Grade | % with ≥1 guardian | % with ≥1 phone |
|---|---|---|
| Nursery–UKG | `___` | `___` |
| 1–5 | `___` | `___` |
| 6–10 | `___` | `___` |

Percentages only — no names, no numbers. Not a blocker for taking attendance;
it is a blocker for absence follow-up, so it informs rollout order.

---

## 6. Attendance

`/academics/attendance` → redirects to `/academics/classrooms?tab=attendance`.

| # | Check | Observed |
|---|---|---|
| 6.1 | Dashboard renders (not the no-current-AY empty state) | `___` |
| 6.2 | Any attendance recorded to date? earliest / latest date | `___` |
| 6.3 | Sections listed under "Sections to record" | `___` |
| 6.4 | Attendance mode (`?tab=attendance` on school settings) | `___` |
| 6.5 | Open the drawer on one section — grid **enabled**? | `___` |
| 6.6 | "cannot submit / non-instructional" warning on a normal teaching day? | `___` ← B3 inverse |
| 6.7 | On an already-recorded section, is a per-row correction offered? | `___` |
| 6.8 | IEMiS export button visible? | `___` |
| 6.9 | Role of the login used for 6.8 | `___` |

**Trap — B5.** 6.8 only means something alongside 6.9. A TenantAdmin sees the
export; a Principal or VP does **not**, because the frontend ABAC table omits
`attendance:export` for them while the backend grants it. If the login is
TenantAdmin, 6.8 tells you nothing about whether School A's Principal can file
Flash II.

**Teacher reachability — do not skip.** 6.1–6.7 as admin do not establish that a
*teacher* can take attendance. Backend permissions say yes
(`attendance:view/create/edit` + `scheduling:view` + `students:view`). Confirm
live with a teacher account, or record it as unverified:

| Check | Observed |
|---|---|
| Teacher reaches `?tab=attendance` | `___` |
| Teacher sees their section(s) | `___` |
| Teacher can open the drawer and save | `___` |

Note: permission is **school**-scoped, not section-scoped — expect a teacher to
see every section at School A, not only their own. That is current behaviour,
not a bug to report.

---

## 7. Bugs, errors and confusing screens

| # | Where (URL + tab) | What happened | Expected | Screenshot ref | Severity |
|---|---|---|---|---|---|
| | | | | | |

---

## 8. Carry into Phase 3

Fill as you go — these feed `03-plan.md` directly.

- Grades **Ready** (sections + teacher + rostered students + contacts): `___`
- Grades needing **data fixes**, and which fix: `___`
- Grades **Blocked**, and why: `___`
- Cleanest grade excluding Grade 10 → **first to go live**: `___`
- Which of B1–B5 are live blockers vs theoretical: `___`

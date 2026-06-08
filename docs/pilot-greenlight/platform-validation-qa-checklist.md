# Platform Validation — QA Checklist (fresh-School dry run, internal-dev tenant)

**Purpose:** validate that the core EdForge platform works correctly end-to-end on a
**brand-new School** created in the **internal-dev tenant** — with the
**exam → result → Flash II** chain as the spotlight (the P0 "prove the
freshly-landed pipeline" validation), plus broad coverage of every operator-facing
capability built so far.

**Scope note:** this is *high-level validation*, not exhaustive test-casing. Each row
confirms a capability behaves correctly and is wired against the backend. Tick
PASS/FAIL, capture a one-line evidence note (screenshot / id / CSV cell).

**Guardrails**
- Use the **internal-dev tenant** (`dev-pabson-primary` or equivalent). **NEVER the
  real Saraswati pilot tenant** (`34f49822-…`). Create a *new* School inside dev so
  test data is isolated.
- This is PABSON archetype — expect NPR / Asia-Kathmandu / Bikram Sambat / Sun–Fri.

---

## ⚠️ Pre-flight (do these BEFORE the dry run — they gate everything)

| # | Check | Why it matters | PASS/FAIL |
|---|---|---|---|
| P1 | **The result-batch Lambda + EventBridge rule exist in the dev tenant's deployed `tenant-template-stack-basic`.** Confirm via CloudFormation (the stack has `ReportAggregator`/result-batch Lambda + a rule on `ExamStatusTransitioned`, `toStatus=closed`). If the dev tenant was provisioned *before* the result-batch Lambda landed (handler was modified 2026-06-07), **redeploy `tenant-template-stack-basic` for the dev tenant first** via the wrapper. | The exam→result step is **async**; if the Lambda isn't deployed on this tenant, closing an exam silently generates **no** result cards. This is the single most likely reason the dry run "doesn't work." | ☐ |
| P2 | Analytics-stack report-aggregator is current (it is — #284/#285 deployed). | Flash I/II generation. | ☐ |
| P3 | Confirm you can log into the dev tenant as a TenantAdmin. | Everything downstream needs admin. | ☐ |

---

## §0 — Tenant, auth & workspace

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 0.1 | Log in (OAuth callback → `/home`) | Lands authenticated; role-based dashboard renders | ☐ | |
| 0.2 | Workspace settings (`/settings/workspace`) | NPR currency, Bikram Sambat calendar, Asia/Kathmandu TZ, Sun–Fri week (archetype defaults) | ☐ | |
| 0.3 | RBAC/security (`/settings/security-policies`) loads | Roles + ABAC matrix visible | ☐ | |

## §1 — New School setup (the day-1 operator journey)

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 1.1 | Create a new School (`/settings/organization/schools/new`) | School created; school code generated | ☐ | |
| 1.2 | Set **IEMIS code** (9-digit, e.g. `230500009`) | Accepted; immutable after create | ☐ | |
| 1.3 | Grade levels (`?tab=grade-levels`) — add `PG, NUR, LKG, UKG, 1–10` | School-local labels saved | ☐ | |
| 1.4 | Academic year (`?tab=academic-setup` step 1) — create AY **2083 BS**, mark current | BS-format name; isCurrent set | ☐ | |
| 1.5 | Sessions & terms (step 2) — create the PABSON terms (e.g. Term 1 / Term 2 / Final) | Sessions + paired grading periods | ☐ | |
| 1.6 | Calendar (step 3) — generate with PABSON holiday seed | Holidays + instructional days populated | ☐ | |
| 1.7 | Bell schedule (step 4) — apply Nepal Sun–Fri preset | Bell schedule saved | ☐ | |
| 1.8 | Activation checklist (`?tab=configuration`) | All blockers cleared → school **activatable** (`canActivate: true`) | ☐ | |

## §2 — People & enrollment (feeds IEMIS demographics)

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 2.1 | Add 5–10 students (`/academics/students`), incl. all IEMIS demographics: **DOB (BS), sex, caste/ethnicity, mother tongue, disability, `emisStudentId`** | Students created; demographics persisted | ☐ | |
| 2.2 | Confirm at least one student per outcome you'll test (one to promote, one to retain, one to withdraw) | Mix present for later promotion test | ☐ | |
| 2.3 | Add guardians (Family tab) for ≥1 student | Guardian linked | ☐ | |
| 2.4 | Add 2–3 staff (`/people/staff`) incl. a teacher | Staff + user created | ☐ | |
| 2.5 | Enroll all students into the school + AY 2083 + grade level | Enrollment rows exist (required for exams/results/reports) | ☐ | |

## §3 — Academic structure

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 3.1 | Create courses/subjects (e.g. Math, English, Science) | Courses saved | ☐ | |
| 3.2 | Create a section (`/academics/classrooms`), assign teacher, roster students | Section + roster | ☐ | |

## §4 — Attendance (feeds Flash II `total_attendance_days`)

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 4.1 | Mark daily attendance for several dates (present/absent/late mix) | Saved per student/date | ☐ | |
| 4.2 | Bulk-mark a class | Bulk write succeeds | ☐ | |

---

## §5 — ⭐ SPOTLIGHT: Exam → Result → Flash II chain (the P0)

This is the freshly-landed pipeline. The **risky step is 5.6→5.7** (async Lambda).

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 5.1 | Grading policy (`/academics/grades` or lazy-seed on first read) | PABSON division bands present (Distinction 85 / First 65 / Second 50 / Third 40); GPA scale set | ☐ | |
| 5.2 | Create an exam, **`examType = final`** (so it's the terminal exam Flash II selects), scope grade level(s) + term | Exam in `draft` | ☐ | |
| 5.3 | Add exam-courses (bind subjects; set maxMarks + passing; optionally Theory/Practical components) | Courses bound | ☐ | |
| 5.4 | Transition `draft → scheduled` | Status updates; no error | ☐ | |
| 5.5 | Enter marks — single **and** bulk (with `correlationId`); try a component split | Scores saved; bulk idempotent | ☐ | |
| 5.6 | Transition `scheduled → in_progress → closed` | On **closed**, `ExamStatusTransitioned` fires → result-batch Lambda triggered | ☐ | |
| 5.7 | **Wait, then verify result cards generated** (`/academics/result-cards`). If none appear within ~1–2 min, check `exam.resultGenerationStatus` (`generated`/`failed`) and the **result-batch Lambda CloudWatch logs**. | One ResultCard per enrolled student: correct `totalScore`, `termGpa`, per-subject letter grades, **NG sentinel** for missing scores | ☐ | |
| 5.8 | Edit conduct + class-teacher remark; then **publish** (`draft → published`) | Edits persist; publish succeeds; re-publish → 409 | ☐ | |
| 5.9 | **Generate Flash II snapshot** (`/academics/reports/government` → Flash II, AY 2083) → download CSV → inspect | **`exam_total_marks` + `exam_gpa` now POPULATED** (the whole point), `total_attendance_days` populated, `academic_status` per §6 | ☐ | |

**5.9 is the proof.** If those two columns are non-blank with correct values, the
exam→result→Flash II chain is verified in prod.

## §6 — Promotion / year-end (feeds Flash II `academic_status`)

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 6.1 | Promotion rules (`/academics/promotion-rules`, lazy-seed) | Archetype defaults present (threshold %, min attendance %, required subjects) | ☐ | |
| 6.2 | **Evaluate** (read-only) promotion for the grade/AY | Per-student suggestion + reasoning (promoted/retained/…); no writes | ☐ | |
| 6.3 | **Commit** decisions | `promotionDecision` written write-once; provisional AY2 enrollment for promoted | ☐ | |
| 6.4 | Re-generate Flash II → check `academic_status` | `promoted→Passed`, `retained→Repeated`, `withdrawn→Dropout` (the #285 fix, now with real decisions) | ☐ | |

## §7 — Flash I (column completeness)

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 7.1 | Generate Flash I snapshot (AY 2083) → download CSV | 14 columns present | ☐ | |
| 7.2 | Inspect demographic columns | gender, caste/ethnicity (CEHRD band), mother tongue, disability, ECED — populated from §2 data | ☐ | |
| 7.3 | Inspect grade-level column | School labels projected to **canonical** (PG/NUR→ECD, LKG/UKG→PPC, 1–10→1–10) | ☐ | |

## §8 — Reporting lifecycle & guardrails

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 8.1 | **Preflight** before generating (the #285 validation) | Valid 9-digit code → `canProceed=true`; non-9-digit → WARN; missing AY → ERROR | ☐ | |
| 8.2 | Snapshot list + download (presigned URL, friendly filename) | Lists newest-first; download works | ☐ | |
| 8.3 | Transition snapshot → submitted/verified | State machine advances | ☐ | |

## §9 — Cross-cutting integrity

| # | Step | Expected | PASS/FAIL | Evidence |
|---|---|---|---|---|
| 9.1 | Audit log (school `?tab=audit-log`) | Mutations recorded | ☐ | |
| 9.2 | Permissions — try an action as a non-admin role | ABAC blocks appropriately | ☐ | |
| 9.3 | Tenant isolation — confirm the new School's data never bleeds across tenants | School-scoped queries only | ☐ | |
| 9.4 | Soft-delete — delete a draft entity, confirm it disappears from reads | `isActive` filtering works; not emitted in response DTOs (exam/result-card) | ☐ | |

---

## §10 — KNOWN-DEFERRED (do **not** file these as bugs)

These are intentionally not done yet — flagging them as defects wastes cycles:

- **CSV, not `.xlsm`** — reporting emits CSV; the official-template injection engine
  is the next epic. Expected.
- **Exam columns blank *only if* no exam cycle was run** — §5 is exactly what
  populates them. Blank-before-§5 is correct.
- **Free-text demographics** — caste/ethnicity/mother-tongue are free-text today;
  inconsistent casing is a known data-quality item (dropdowns are a follow-up).
- **No "next steps" checklist on the home dashboard**; grade-levels captured
  post-onboarding (not in the wizard) — known UX-guidance gaps.
- **Per-student preflight validation** (rowCount, required-field, age) is deferred
  (needs identity→academics cross-read + IAM). Preflight validates school + IEMIS
  code + AY only.
- **Photo upload, finance/fee ledger, branding edit, integrations** — placeholders /
  V1-deferred.

---

## Sign-off

| Section | Result | Notes |
|---|---|---|
| Pre-flight | ☐ | |
| §0–§4 setup & people | ☐ | |
| **§5 exam→result→Flash II (P0)** | ☐ | |
| §6 promotion | ☐ | |
| §7 Flash I | ☐ | |
| §8 reporting lifecycle | ☐ | |
| §9 integrity | ☐ | |

**Overall verdict:** ☐ platform validated for pilot-scale operation ·
☐ gaps found (list above) · **Signed:** _____ **Date:** _____

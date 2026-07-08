# Sprint A.4 Phase 4 — Pilot Result Card Publish Smoke: Focused Plan

> **Drafted:** 2026-05-23 (post Phase 3 deploy at 15:25 UTC)
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Parent plan:** [`a4-sprint-plan.md`](./a4-sprint-plan.md) §3 Phase 4 + §4 A.4.7
> **Phase 3 status:** Lambda + EventBridge + DLQ + alarms live on prod ([PR #165](https://github.com/shoaibrain/edforge/pull/165)); 14 resources verified via AWS CLI; CW alarms in OK state; zero spurious invocations
> **Companion precedent:** [`scripts/smoke-tests/pilot-exam-flow.ts`](../../scripts/smoke-tests/pilot-exam-flow.ts) (A.3.11)

---

## 1. Why this phase, why now

**Phase 4 IS the wire-validation gate for the entire A.4 sprint.** Phase 3 deploy completed cleanly, but the planned synthetic `put-events` post-deploy gate was **blocked by prod IAM** — `edforge-prod-deployer` has no `events:PutEvents` on the SBT bus (correct security posture; only the academics ECS task role can publish). The only practical way to fire the EventBridge rule end-to-end is via a **real `ExamStatusTransitioned` event from the academics service**.

Phase 4's pilot smoke is exactly that path:
1. Smoke creates a synthetic Exam, transitions it through the state machine → academics service emits `ExamStatusTransitioned(toStatus=closed)` to the SBT bus
2. EventBridge rule routes to the result-batch Lambda
3. Lambda generates ResultCard rows
4. Smoke polls `GET /academics/result-cards` until rows appear
5. Smoke verifies the rows are correct (totals, R42 studentId, isTerminal)
6. Smoke exercises the operator-facing PATCH endpoints (conduct + remark + publish)

**This single script proves the complete A.4 loop on prod.** If Phase 4 green, A.4 is fully shipped.

---

## 1.5 IAM-block learning from Phase 3 (codify for future Lambda sprints)

**Phase 3 discovery:** The synthetic `put-events` test from a4-phase-3-plan.md §7 is impractical from deployer credentials. `edforge-prod-deployer` IAM correctly lacks both `events:PutEvents` (can't synthesize events) and `lambda:InvokeFunction` (can't bypass EventBridge). For future Lambda-on-EventBridge sprints in this repo:

- **Phase 3 stops at "resources exist + CFN clean"** (verified via `aws lambda get-function`, `aws events list-rules`, `aws sqs get-queue-attributes`, `aws cloudwatch describe-alarms`).
- **The wire-validation IS the next phase's smoke** (here: Phase 4).
- The sprint plan's "synthetic put-events live-smoke gate" terminology was misleading; should be renamed to "real-event end-to-end gate" in future sprints.

Codify this as master plan §17.10 L10 in Phase 4 closeout PR.

---

## 1.6 Architecture invariants Phase 4 enforces

| Invariant | Phase 4 application |
|---|---|
| Invariant 13: no pilot names | Smoke accepts `PILOT_ID` + `TENANT_ID` + `SCHOOL_ID` + `ACADEMIC_YEAR_ID` + `TERM_ID` env vars; script is parametric across pilots. V1 runs target `dev-pabson-primary` only. |
| Invariant 3: cross-AY enrollmentId keying | Smoke checkpoint 11 explicitly queries `GET /result-cards?enrollmentId=X` and asserts the card surfaces (proves GSI2 partitioning works) |
| R42 mitigation | Smoke checkpoint 5 asserts `ResultCard.studentId !== 'unknown'` for every generated row; proves the Lambda's Enrollment-map join works end-to-end |
| L7 (live smoke catches integration issues) | This IS the live smoke for Phase 3's deployment |
| L9 (no new NestJS module) | N/A — smoke is a script, no DI graph |
| `feedback_just_ask_for_a_prod_token` | Smoke requires fresh Cognito JWT to `/tmp/dev-jwt.txt` per memory |

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| A.4.7 | `scripts/smoke-tests/pilot-result-card-publish.ts` — parametric end-to-end smoke covering Lambda generation + operator PATCH flow | M |
| (impl) | Re-run of pilot-exam-flow.ts as a pre-flight to seed the synthetic Exam | XS |

### Out-of-scope

| Item | Why |
|---|---|
| Frontend ResultCard UI | Post-A.4 follow-up (saas-frontend academics MFE) |
| ClassRank/SectionRank assertions | V1 leaves them null; spec rejects non-null in V1.5 |
| Multi-tenant smoke | Single tenant (dev-pabson-primary) for V1 per CEO 2026-05-22 |
| Performance/scale validation (200+ enrollments) | V1 smoke uses ~5 enrollments; production-scale validation is Pilot 2 scope |
| Re-aggregation on score correction post-publish | V1.5 — Phase 4 smoke uses single-pass flow |
| Negative-control: invalid event source | Phase 4 focuses on happy + operator-action paths; negative-control on rule pattern is V1.5 |

### Already-shipped foundation

- A.3.11 pilot-exam-flow.ts smoke (passes 11/11 on dev-pabson-primary) — reusable pattern for client setup, JWT consumption, parametric env vars
- A.4 Phase 1+2 endpoints live (`GET /result-cards`, `PATCH /conduct`, `PATCH /remark`, `PATCH /publish`)
- A.4 Phase 3 Lambda + EventBridge wire deployed (verified via AWS CLI; CW alarms OK)
- D.1 GradingPolicy lazy-seeded for dev-pabson-primary (proven by prior smokes)
- A.2 PABSON_COURSE_CATALOG backfilled on dev-pabson-primary school `4209e3d8-…`

---

## 3. PR cadence — 1 PR + 1 operator-led smoke run

**Single PR ships the script.** Smoke execution is operator-led against prod (requires fresh JWT). Outcome (pass/fail) captured in deploy log + a small follow-up doc-update if needed.

### Files

**NEW:**
- `scripts/smoke-tests/pilot-result-card-publish.ts` — parametric smoke (mirrors `pilot-exam-flow.ts` structure)

**NO source code changes.** Phase 4 is verification only — no Lambda/service/CDK changes.

### NO L9 / R43 trigger

Smoke script is not a NestJS module; no DI graph; no wiring spec needed.

### NO shared-types / R39 / R40 / R41

No code changes to those paths. CFN size unaffected.

---

## 4. Per-ticket detail

### A.4.7 — `pilot-result-card-publish.ts`

**Files:** Phase 4.
- `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW; ~400 LOC, mirrors A.3.11 shape)

**Behavior — 12 checkpoints:**

```
Pre-flight: validate env (TENANT_ID, SCHOOL_ID, ACADEMIC_YEAR_ID, TERM_ID, PROD_ADMIN_TOKEN, optional EXAM_TYPE)

Stage 1 — Set up synthetic exam (or reuse Phase 3 fixture if persistent)
  C1. POST   /academics/exams                                 → 201 (draft)
        examName: "Phase 4 Smoke <runId>"
        examType: 'final'  (forces isTerminalExam=true; tests C.9.5 flag)
        academicYearId, termId from env
  C2. POST   /academics/exams/{id}/courses × 2                → 201 each
        Use real Course rows from dev-pabson-primary (Math + Science from A.2 backfill)
  C3. PATCH  /academics/exams/{id}/status (draft→scheduled)   → 200
  C4. POST   /academics/exams/{id}/scores × 5 single scores   → 201 each
        Spread across 2 ExamCourses; use 5 synthetic enrollmentIds (uuid)
  C5. PATCH  /academics/exams/{id}/status (scheduled→in_progress) → 200

Stage 2 — Trigger Lambda via real exam.closed
  C6. PATCH  /academics/exams/{id}/status (in_progress→closed)  → 200
        emits ExamStatusTransitioned(toStatus=closed) → SBT bus → EventBridge rule → result-batch Lambda

Stage 3 — Poll for ResultCard rows (THE wire-validation)
  C7. GET    /academics/result-cards?examId={id}                → poll until count ≥ 1 or 60s timeout
        Lambda has 5-min Lambda timeout but typical cold-start <10s; warm runs <2s
        On timeout: smoke fails with diagnostic dump (Lambda log filter + DLQ depth + rule metrics)

Stage 4 — Verify generated cards
  C8. For each ResultCard:
        - totalScore matches sum of synthetic ExamScores for that enrollment
        - termGpa ∈ [0.0, 4.0] (PABSON gpaScale)
        - isTerminalExam = true (since examType='final')
        - studentId !== 'unknown' (R42 schema-level guard; backend enforces uuid format too)
        - courseScores[] length matches ExamCourses count
        - status = 'draft'

Stage 5 — Exercise operator endpoints (Phase 2 functionality)
  C9.  PATCH  /academics/result-cards/{cardId}/conduct?enrollmentId={eid} → 200
        body: { conduct: "Phase 4 smoke conduct" }
  C10. PATCH  /academics/result-cards/{cardId}/remark?enrollmentId={eid} → 200
        body: { classTeacherRemark: "Phase 4 smoke remark" }
  C11. PATCH  /academics/result-cards/{cardId}/publish?enrollmentId={eid} → 200
        body: {}
        Asserts response.status === 'published' + publishedAt + publishedBy

Stage 6 — Verify state machine invariants
  C12. PATCH  /academics/result-cards/{cardId}/publish?enrollmentId={eid} (again) → 409 RESULT_ALREADY_PUBLISHED
  C13. PATCH  /academics/result-cards/{cardId}/conduct?enrollmentId={eid} → 409 RESULT_LOCKED

(Note: above is 13 checkpoints due to expansion from the original 12 — fine; tighter coverage.)

Cleanup: soft-delete synthetic Exam via DELETE /academics/exams/{id}
  ResultCard / ExamCourse / ExamScore rows persist (no cascade per V1 design;
  same pattern as A.3.11)
```

**Failure-mode diagnostics on C7 timeout:**
- Pull last 50 events from `/aws/lambda/edforge-result-batch-basic` and dump as error context
- Query DLQ depth via `aws sqs get-queue-attributes`
- Query EventBridge rule metric `MatchedEvents` for the last 5 min
- Print recommended next steps:
  - If 0 matched events → rule pattern mismatch
  - If matched > 0 but Lambda invocations = 0 → Lambda permission issue
  - If Lambda invocations > 0 but errors > 0 → bug in handler

**Validation (per-checkpoint AC):**
- Each checkpoint logs result + assertion outcome
- Final summary: N/M passes; smoke exits 0 on all green, 1 on any fail, 2 on env config error
- Smoke run logged to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-smoke-pilot-result-card-publish-<ts>-<sha>.log`

**Dependencies:** A.4.1–A.4.6 ✅ + A.4.3 (Phase 3) ✅; dev-pabson-primary fixture from A.2 + A.3.11.

---

## 5. Risks (Phase 4 specific)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-A4P4.1 | Lambda doesn't fire from real `exam.closed` event → C7 timeout | M | H | C7 diagnostics dump on timeout (CW logs + DLQ + rule MatchedEvents) tells us EXACTLY which leg of EB→Lambda→DDB broke. The fix is Phase-3-area (rule pattern, IAM, target) — would require a separate hotfix PR. |
| R-A4P4.2 | Synthetic enrollmentIds don't match any real Enrollment → Lambda generates 0 cards | M (smoke-only) | M | The Lambda processes all Enrollment rows for school+AY (not the ExamScore enrollmentIds). So smoke's synthetic enrollmentIds in ExamScores will simply not map to any Enrollment → those scores get treated as missing → all real enrollments get NG rows. Smoke must use REAL enrollmentIds from dev-pabson-primary OR accept that all cards will be NG. **Decision: use real enrollmentIds from dev-pabson-primary** (fetch via GET /academics/schools/{schoolId}/years/{yearId}/enrollments pre-flight). |
| R-A4P4.3 | dev-pabson-primary has no active Enrollments for the target AY+term | L | H | Pre-flight checkpoint queries enrollments. If 0 found, smoke aborts with clear error + recommendation to use a different AY. |
| R-A4P4.4 | Cold-start exceeds C7 polling window (60s) | L | M | C7 polls every 3s for 60s = 20 attempts. First Lambda cold-start ~5-10s; subsequent warm <2s. If we see consistent timeouts on first run + success on second, raise C7 to 120s. |
| R-A4P4.5 | Cleanup leaves ResultCard rows on dev-pabson-primary as data debt | L (accepted V1) | L | Same pattern as A.3.11 (orphan ExamCourses + ExamScores after Exam soft-delete). Document in smoke comment; tenant is dev-only. |
| R-A4P4.6 | Smoke triggers prod incident if Lambda DOES have a bug (e.g., schema mismatch causes 5xx on GET /result-cards downstream) | L | M | Schema mismatch was the EXACT incident risk in Phase 2. Hotfix #163 added module-wiring spec; that catches DI. Schema parse errors on read would surface in C7. If C7 returns HTTP 200 with rows that fail Zod parse later (e.g., AdminWeb crash), that's a future-tense risk, not Phase 4 scope. |
| R-A4P4.7 | A real teacher closes a real exam during the smoke run, causing concurrent Lambda invocations | L (Saraswati is the only real tenant, low activity) | M | The Lambda is per-event-isolated; concurrent invocations don't conflict. Worst case: extra ResultCards generated for the real exam — operator workflow, not a bug. |

---

## 6. Invariant gate

| Invariant | Phase 4 disposition |
|---|---|
| L7 (live smoke gate) | YES — this PR IS the live smoke for Phase 3 |
| L9 (module-wiring spec) | N/A (no module) |
| R43 (wiring spec must ship with new module) | N/A |
| R39 (caret-pin) | N/A (no shared-types changes) |
| R40 (tenant-api-prod.json) | N/A (no route changes) |
| R41 (CFN template size) | N/A (no CDK changes) |
| R42 (studentId resolution) | YES — C8 explicit assertion `studentId !== 'unknown'` |
| Invariant 3 (cross-AY enrollmentId) | YES — Phase 2 cross-year spec covers static; Phase 4 dynamic-flow doesn't re-test (same enrollmentId on all generated cards) |
| Invariant 13 (no pilot names) | YES — PILOT_ID env var + all fixture data via env |

---

## 7. Deploy ladder

```
Phase 4 PR
  ├── (CI green: tsc --noEmit on the script; no runtime tests)
  ├── (Reviewer approval — Shoaib)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT → /tmp/dev-jwt.txt (Write tool, NOT heredoc;
  │    per memory `feedback_just_ask_for_a_prod_token`)
  ├── Pre-flight verify:
  │    - GET /academics/schools/{schoolId}/years/{yearId}/enrollments
  │      returns ≥ 2 active enrollments
  │    - GET /academics/courses?schoolId={schoolId}&academicYearId={ayId}
  │      returns ≥ 2 active Course rows
  ├── DRY-RUN: PILOT_ID=dev-pabson-primary npx ts-node \
  │      scripts/smoke-tests/pilot-result-card-publish.ts --dry-run
  │    (lists what it WILL do without writes; user reviews)
  ├── (User reviews dry-run output)
  ├── FULL RUN: PILOT_ID=dev-pabson-primary npx ts-node \
  │      scripts/smoke-tests/pilot-result-card-publish.ts
  ├── Outcome tee'd to ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-smoke-pilot-result-card-publish-<ts>-<sha>.log
  ├── If all 13 checkpoints PASS:
  │    → A.4 fully shipped 🟢
  │    → Master plan §0.4 status row flips A.4 → 🟢 shipped
  │    → R-A4P3.* risks closed
  └── If any FAIL:
       → Diagnostics dump captured (CW Lambda logs + DLQ + rule metrics)
       → Hotfix PR if scope is small + clear, OR
       → Phase 4 stays open + bug triage in a separate sprint
```

**No infra change in Phase 4.** Just script + execution.

---

## 8. Open decisions (need sign-off before branch cut)

1. **Reuse real Enrollments vs synthetic enrollmentIds.** Recommended: **use real enrollmentIds** from dev-pabson-primary (fetch via existing GET enrollments endpoint pre-flight). Synthetic UUIDs would result in all-NG cards (no Enrollment row to match) which validates the wire but not the aggregation. Real enrollments give richer assertions. *Recommendation: real.*
2. **Use `examType=final` (terminal) or `examType=unit_test` (non-terminal)?** Recommended: **`final`** — forces `isTerminalExam=true`, tests the C.9.5 cross-year handoff flag path. *Recommendation: final.*
3. **Number of ExamCourses + scores.** Recommended: **2 ExamCourses + 5 scores spread across them**, with 2-3 enrollments → 2-3 generated ResultCards. Keeps smoke fast (~30s) + assertions tractable. *Recommendation: 2/5/3.*
4. **C7 polling window.** Recommended: **60s with 3s interval** (20 attempts). Lambda cold-start typically <10s for this small workload; 60s buffer is generous. If first prod run shows consistent cold-start >60s, raise to 120s. *Recommendation: 60s.*
5. **Cleanup mode.** Recommended: **soft-delete the Exam; leave ResultCard/ExamCourse/ExamScore as orphans** (matches A.3.11 pattern; dev-only tenant). *Recommendation: soft-delete Exam only.*
6. **Fresh JWT per run vs reuse last session's JWT.** Recommended: **fresh per run** to avoid 1h Cognito TTL expiry mid-run. Operator generates via the same path as A.3.11. *Recommendation: fresh.*

---

## 9. Definition of Done (Phase 4 → closes A.4 sprint)

- [ ] A.4.7 ticket meets §1.1 atomic DoD
- [ ] PR merged to main
- [ ] Smoke run logged: `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-pabson-smoke-pilot-result-card-publish-<ts>-<sha>.log`
- [ ] **13/13 checkpoints PASS** on dev-pabson-primary
- [ ] No regressions in academics ECS (CW Lambda errors alarm stays OK; DLQ stays empty)
- [ ] Master plan §0.4 row: A.4 flipped 🟡 → 🟢 shipped
- [ ] sprint-closeouts.md A.4 closeout entry (full sprint, Phase 1-4)
- [ ] Memory `project_sprint_a4_shipped_prod` written
- [ ] §17.10 L10 codifies the IAM-block lesson from Phase 3
- [ ] R-A4P3.* risks closed in §11.2
- [ ] Phase 3 deploy artifacts referenced in closeout (Lambda + DLQ + rule + alarm)
- [ ] R41 status check: shared-infra-stack unaffected (87.7%); split-stack sprint queued next

---

## 10. What this plan deliberately does NOT include

- Frontend ResultCard UI — saas-frontend academics MFE follow-up
- Multi-pilot smoke (Saraswati) — prod Saraswati has no Exam/Course data; operator-led when ready
- Re-aggregation on score correction — V1.5
- Un-publish ResultCard — V1.5 (terminal `published` in V1)
- Cleanup of historical orphan ResultCard rows on dev-pabson-primary — accepted dev-tenant debt
- Performance benchmarking at scale — Pilot 2 scope

---

## Sign-off requested

Open decisions in §8 are the gates. Once signed off:
1. Cut feature branch: `sprint/a4-phase-4-pilot-smoke` on the server repo.
2. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
3. Implement script (mirror `pilot-exam-flow.ts` shape).
4. After PR merges: request JWT → pre-flight checks → dry-run → full run.
5. If 13/13 PASS → A.4 fully shipped → master plan + closeouts + memory updates.

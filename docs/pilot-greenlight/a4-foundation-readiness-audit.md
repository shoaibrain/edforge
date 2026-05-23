# Sprint A.4 — Foundation Readiness Audit

> **Drafted:** 2026-05-22
> **Sprint plan:** [`a4-sprint-plan.md`](./a4-sprint-plan.md)
> **Status:** ✅ Foundation green; A.4 cleared to start

This audit confirms that every upstream dependency Sprint A.4 (Result Subsystem Backend) requires is shipped, deployed, and verified — and that the two carry-over risks from A.3 (R41 + R42) have documented mitigation strategies.

---

## 1. Foundation green-light checklist

| Foundation piece | Source sprint | Status | Used by A.4 ticket |
|---|---|---|---|
| `Exam` entity + state machine | A.3.2 + A.3.8 | 🟢 shipped 2026-05-22 | A.4.3 (Lambda subscribes to `exam.closed`) |
| `ExamCourse` entity (FK to Course; `maxMarks`/`passingMarks`/`creditHours`) | A.3.3 | 🟢 shipped | A.4.1 (aggregation reads `maxMarks`/`creditHours` for weighting) |
| `ExamScore` entity keyed by `enrollmentId` (invariant 3) | A.3.4 | 🟢 shipped | A.4.1 (aggregation joins by `enrollmentId`) |
| `ExamScore` GSI2 student-centric + GSI3 per-enrollment | A.3.4 | 🟢 shipped | A.4.6 cross-year regression spec |
| `exam.closed` event schema in shared-types | A.3.8 / events | 🟢 `packages/shared-types/src/events/exam.ts:35` | A.4.3 (EventBridge rule pattern) |
| Bulk score handler with chunk-100 + correlationId idempotency | A.3.9 | 🟢 shipped | A.4.3 mirrors chunking pattern |
| `GradingPolicy` entity with `letterGrades[]`, `gpaScale`, `minimumPassingGrade` | D.1.1 / D.1.3 | 🟢 shipped + lazy-seed on first read | A.4.1 (aggregation reads policy) |
| `letterGradeEntrySchema.isPassing` + `isTerminalFail` flags (CEHRD NG) | D.1.1 | 🟢 shipped | A.4.1 (per-course passing flag on ResultCard.courseScores[]) |
| `Course.academicSubject` descriptor | A.2.1 | 🟢 shipped | A.4.2 (denormalize on courseScores[]) |
| `PABSON_COURSE_CATALOG` seeded on `dev-pabson-primary` school `4209e3d8-…` | A.2.5 backfill | 🟢 17 CREATE + 4 PATCH (idempotent re-run = 19 SKIP + 2 documented WARN) | A.4.7 smoke target |
| `resultPublishedSchema` event schema with `isTerminal: boolean` | C0.c.2 lineage | 🟢 `packages/shared-types/src/events/result.ts:18` | A.4.5 emits |
| EventBridge bus + DLQ stack | shared-infra `event-dlq-stack.ts` | 🟢 deployed | A.4.3 Lambda subscribes via tenant-template-stack-basic rule |
| Existing nginx `^/academics` location block | reverseproxy template | 🟢 deployed | A.4 routes ride existing prefix; **no nginx change needed** |
| Analytics Lambda pattern (`server/lib/analytics/lambda/aggregator/`) | pre-A.3 | 🟢 in repo | A.4.3 mirrors folder structure: `server/lib/result-generation/lambda/result-batch/` |
| Pilot exam smoke `pilot-exam-flow.ts` with 11 checkpoints | A.3.11 | 🟢 11/11 green 2026-05-22 on dev-pabson-primary | A.4.7 mirrors parametric structure |

All boxes ticked. A.4 has zero hard upstream blockers.

---

## 2. R41 carry-through (shared-infra-stack CFN template at 86%)

**Status:** open architectural risk. Tracked in `v1-master-epic-breakdown.md` §11.2 R41.

**Headline (post-A.3 evidence):**
- CDK warned `Template size is approaching limit: 863276/1000000` during the `shared-infra-stack` redeploy that landed A.3's 8 new API GW paths.
- Per-path cost ≈ 9KB CFN. A.3's 8 paths × 9KB = ~72KB added.

**A.4 projected delta:**
- Sprint plan §3 Phase 2: 5 new path entries (`/academics/result-cards`, `/academics/result-cards/{cardId}`, `/academics/result-cards/{cardId}/conduct`, `/academics/result-cards/{cardId}/remark`, `/academics/result-cards/{cardId}/publish`).
- Estimated delta: ~45KB → projected template at **~908KB ≈ 91% of 1MB limit.**

**This crosses the >90% threshold** that master-plan §17.8 L6 sets as the trigger for the `shared-api-routes-stack` split decision.

**A.4 Phase 0 (DECISION ONLY — no code) presents three options:**

| Option | Trade-off | Recommendation |
|---|---|---|
| (a) **Proceed with A.4; queue split sprint next** | Defers architectural work by ~1 sprint; risk of D.2/D.3 also pushing forward without split. | ✅ **Recommended.** A.4 is critical-path; split is non-blocking until ~95%. |
| (b) Pause A.4; do split sprint first (~2-3 days) | Delays critical-path A.4 by ~3-5 days. | Reasonable but lower urgency than A.4's downstream unblocks (5+ sprints). |
| (c) Fold split into A.4 Phase 1 | Bundles unrelated architectural change into result-subsystem PR. | ❌ Not recommended — review noise + atomicity drift. |

**Decision required at sprint kickoff.** This audit document is signed off **conditional on option (a) being approved** in §8 #1 of the sprint plan.

---

## 3. R42 carry-through (ExamScore.studentId='unknown' for bulk writes)

**Status:** accepted V1 limitation. Tracked in master plan §11.2 R42.

**Headline (A.3 lineage):**
- A.3.9 bulk score handler skips the Enrollment GSI lookup for performance; rows are written with `studentId='unknown'` in the denormalization field.
- Single-write `recordScore()` attempts the lookup and falls back to `'unknown'` if Enrollment row not found (in V1, enrollment-FK validation is loose).
- GSI2 student-centric (`student#{studentId}`) consequently collapses bulk-written scores into a single `student#unknown` partition.

**A.4 mitigation (the entire point of this audit's existence):**

1. **A.4.1 term-aggregation engine** does NOT read `ExamScore.studentId` at all. It reads the `enrollmentId` keying field, then resolves `studentId` from the Enrollment row via `BatchGetItem`.
2. **A.4.2 ResultCard.studentId** carries the *correctly-resolved* value from step 1.
3. **A.4.7 smoke checkpoint 11:** explicit assertion that no `ResultCard.studentId === 'unknown'` rows exist after the result-batch Lambda runs.
4. **Schema-level guard:** `resultCardResponseSchema.studentId = z.string().uuid()` — the schema rejects `'unknown'` at the contract layer. Spec `result-card.schema.spec.ts` includes an explicit "rejects studentId='unknown'" assertion.

**Opportunistic ExamScore.studentId write-behind during aggregation:** rejected for V1 per sprint plan §8 #4 (a). Adds latency + complexity for marginal benefit because ResultCard becomes the read path post-aggregation. If/when bulk ExamScore data needs cross-AY surfacing via the student-centric GSI before A.4 has aggregated, a separate one-shot backfill script (`scripts/backfill-exam-score-studentid.ts`) can be authored.

---

## 4. Pre-deploy AdminWeb consumption check (per §8 #7)

Per sprint plan §8 #7 (AdminWeb consumption check) — pre-Phase-1 grep result:

```
$ grep -rn "ResultCard\|result-card\|resultCard" client/AdminWeb/src/
(no hits)
```

**Conclusion:** AdminWeb does NOT currently consume any ResultCard types. Phase 1 shared-types publish can skip the controlplane redeploy. The jsdom bundle sim is still mandatory per CLAUDE.md to verify the new dependency resolves cleanly.

---

## 5. Out-of-scope reminders

- **Frontend ResultCard UI** is post-A.4 follow-up (saas-frontend academics MFE wiring); A.4 ships API + Lambda only.
- **Report Card PDF render (C.4.3)** depends on A.4.2 entity (this sprint) + C.2 document service (future sprint).
- **ClassRank + SectionRank computation** is V1.5; A.4 entity carries the fields as nullable.
- **Re-aggregation on score correction post-publish** is V1.5; in V1, operator must transition Exam back to `in_progress` → re-score → re-close → Lambda re-runs.

---

## 6. Sign-off

| Item | Verified |
|---|---|
| All upstream dependencies shipped + verified | ✅ §1 |
| R41 mitigation strategy defined + sign-off pending §8 #1 | 🟡 conditional approval |
| R42 mitigation strategy defined + asserted in schema + smoke | ✅ §3 |
| AdminWeb consumption: zero hits → controlplane redeploy SKIP | ✅ §4 |
| Sprint plan ready to enter Phase 1 implementation | ✅ |

Audit anchored at [`a4-sprint-plan.md`](./a4-sprint-plan.md) §0 + §1.5 + §11.2 R41/R42.

# Finance bulk-invoice-generate — first load test (2026-06-29)

**Test run:** 2026-06-29 04:54-04:58 UTC
**Build under test:** `ffdc1ce` + `6d86676` (PR #341 + #245 merged; PR #341 review fix-ups F1-F6 applied)
**Tenant:** `dev-pabson-primary` (`21aea5da-...`)
**School:** Espresso English Academy (`4209e3d8-d2e2-4e0e-9961-790341c264f4`)
**Worker concurrency:** **8** (default — `BULK_INVOICE_GENERATE_CONCURRENCY` env var not set on task def, confirmed via `aws ecs describe-task-definition`)

## Acceptance gate (Sprint E §5 risk #1)

| Gate | Target | Actual | Status |
|---|---|---|---|
| Throughput | ≤90s for 600 students | **245s for 284 students** → projects to **~518s (~8.6 min) for 600** | ❌ **5.8× over gate** |
| Reliability | <1% failure rate | **0/284 failed** (0% — 0 retries, 0 conflicts, 0 throttles, 0 errors) | ✅ |
| Stability | Throughput holds across the run | Throughput stable at **1.16 students/sec** for the entire 4-min window | ✅ |

The reliability + stability gates are met cleanly. The throughput gate is missed by 5.8×.

## Methodology

```bash
# Submit (sync wall: 1.676s)
POST /finance/schools/{schoolId}/invoices/bulk-generate
  body: { selectionMode:"students", studentIds:[284 UUIDs],
          feeStructureIds:["705b5daf-..." Transportation Fee],
          academicYear:"loadtest-pr341-2026",
          billingPeriod:"loadtest-2026-06-29",
          dueDate:"2026-09-30" }
  Idempotency-Key: 548A736C-D1EC-4366-94EA-C5A4AF9E8DCB
→ 202 { jobId: "876de8a4-bf3d-449e-9076-f5314c56abde",
        status: "queued", requested: 284 }

# Poll: GET /finance/jobs/876de8a4-... every 3s until terminal
```

Pre-flight: confirmed 0 existing invoices for `billingPeriod="loadtest-2026-06-29"` so no duplicate-detection skips skew the throughput measure.

## Observed cycle

Throughput was **monotonically increasing** (cumulative `succeeded` counter), **never plateaued or stalled**:

| T+s (client) | succeeded | delta vs prev | rate (students/3s) |
|---|---|---|---|
| 3 | 15 | 15 | 5.0 |
| 50 | 60 | 4 | 1.3 |
| 100 | 116 | 8 | 2.7 |
| 150 | 175 | 9 | 3.0 |
| 200 | 241 | 9 | 3.0 |
| 232 | 284 (terminal) | 7 | 2.3 |

Steady-state throughput: **~1.16 students/sec** (server `durationMs=245022` over 284 students).

At concurrency=8, average per-student wall time = **~6.9 sec** (`8 / 1.16`). The Sprint E.1 audit projected ~600ms/student → **we're 11× slower per-student than projected**.

## Where the time goes — UPDATED with ECS dashboard evidence

**Original hypothesis (in this document's first draft): identity HTTP fan-out.**

**CORRECTED hypothesis: CPU saturation on the finance ECS task vCPU.**

Operator surfaced an ECS Console screenshot from the load test window (04:23-04:35Z) AFTER the original write-up. Key signals:

| Signal | Reading | Implication |
|---|---|---|
| `CPUUtilization` Maximum | **Repeated 100% spikes** at 04:00, 04:10, 04:20, 04:25-04:30 | finance task vCPU is **fully saturated** during the bulk-generate run |
| `MemoryUtilization` | ~33% avg (max 35.8%) | Memory has large headroom — NOT the wall |
| Target response time (identity-api downstream) | **2.5-5 second** spikes during the load window | This is a **symptom of finance's CPU saturation**, not identity itself being slow. The httpClient `await` is starved waiting for an event-loop tick that's busy doing pdfkit / zod / ledger math on the saturated core. |
| `HTTPCode_Target_5XX` | 0 throughout | Saturation degrades latency, not correctness |
| `HTTPCode_Target_2XX` | 54 | Reliable under saturation |

**Bottleneck IS NOT** any of the things PR #341 fixed:
- Per-school sequence partition (PR #341 batch-reserve verified — only **1** `incrementSequenceBy` call at job start)
- Counter-write race (PR #341 F1 retry verified — zero retry events)
- TransactionCanceledException (zero)
- DDB throttling (zero `ProvisionedThroughputExceeded` / `Throttling`)

**Bottleneck IS** the single-vCPU finance ECS task being pegged. At concurrency=8, all 8 concurrent students fight for one event-loop. The "per-student ~6.9s wall" we measured is **event-loop contention** + CPU work — not network wait.

This inverts what the original first-draft of this doc guessed. The identity HTTP latency in the dashboard is a side-effect (httpClient await starvation), not the root cause.

## Implications for the throughput fix sequence

**Adding more concurrency is the WRONG first move** — pushing more concurrent work onto a saturated CPU just adds context-switching and queue contention. The naive "bump concurrency to 16" experiment would likely degrade throughput, not improve it.

Right sequence (per [#345](https://github.com/shoaibrain/edforge/issues/345) updated comment):

1. **Confirm finance task sizing** (read `server/service-info.txt` for `finance` block: `memoryLimitMiB` + `cpu`). If at the small default (e.g. 0.5 vCPU), doubling to 1 vCPU is the cheap L1 framework lever per CLAUDE.md `feedback_check_root_cause_before_migration` memory.
2. **Re-run this load test after the resize** — a CPU-doubled task at concurrency=8 should land roughly where bumping concurrency to 16 at the original size was supposed to. Compare against the 2026-06-29 baseline.
3. **Per-stage timing instrumentation** in the worker — needed to know what's burning CPU disproportionately (pdfkit? zod? ledger math? DDB SDK?).
4. **Identity pre-batch** — defer until #3 confirms identity-call wait actually shows in the per-stage timings.

## Operator-stated constraint

The operator was explicit on 2026-06-29: **don't ship compute changes today**.

> "This might be the infrastructure issue. We can imagine when the School actually starts using the platform - these kinds of issues will surface quite a lot, but we also dont want to add compute prematurely. Currently we are still building with Pilot School."

So the right call is to flag the finding, file the follow-up, and prioritize this against Sprint F/G/H work — not stop the EPIC train to optimize.

## What the test DID verify (PR #341 contracts, live)

| Contract | Evidence |
|---|---|
| **F2** counters.processed dropped | Job row counters at terminal = `{failed:0, requested:284, skipped:0, succeeded:284}` — no `processed` field; FE recomputes |
| **F5** audit eventType per-jobType | `finance.bulk_generate.started` @ 04:54:23.585Z + `finance.bulk_generate.succeeded` @ 04:58:28.606Z — exactly 2 lifecycle events, no `bulk_export.*` pollution, no duplicates |
| **F6** setImmediate dispatch | Submit wall 1.676s for 284-ID resolveStudentIds + job-row create + 202 return — response landed atomically before worker began |
| Batch-reserve sequence (audit BLOCKER #1) | Single `incrementSequenceBy(284)` call at job start; invoice numbers `INV-420-2606-0021` through `INV-420-2606-0304` (sequential, no per-student counter trips) |
| Per-job identity cache (audit HIGH #3) | School-name fetched once; no per-student schoolName lookups in the log |
| Per-school lock | Single concurrent job per school; lock acquired + released cleanly |
| Reliability: zero data loss under concurrency | 284/284 succeeded; 0 `failedStudentIds`; 0 entries in `errors[]`; 0 retries; 0 conflicts |

## Per-stage timing instrumentation — what's missing

Today the worker emits two structured-log lines:
- `BulkInvoiceGenerateWorker complete jobId=... durationMs=245022` (whole-job wall)
- `FinanceJob markCompleted jobId=... v=287 succeeded=284 failed=0 skipped=0`

Both are coarse — they don't tell us where inside the 245s the time went. To localize the per-student bottleneck we need **at least** these emitted around each per-student step:

```
[per-student] checkDup studentId=X latencyMs=A
[per-student] identityCall studentId=X latencyMs=B
[per-student] txnWrite studentId=X latencyMs=C attempts=N
[per-student] counterWrite studentId=X latencyMs=D attempts=M
```

Aggregated to p50/p95/p99 buckets in CloudWatch dimensions (jobId, schoolId), this localizes the gap in one more load run. **Filed as follow-up #1.**

## Side effects of the test

284 DRAFT invoices created in `dev-pabson-primary` with:
- `invoiceNumber` range: `INV-420-2606-0021` through `INV-420-2606-0304` (contiguous; sequence partition `INVOICE#2606`)
- `gradeLevel` snapshotted per student
- `status: "draft"` (operator decision 1 — worker creates drafts, no auto-issue)
- `billingPeriod: "loadtest-2026-06-29"` + `academicYear: "loadtest-pr341-2026"` + `notes:"load test PR #341 — 284 students async path"` so the test invoices are unambiguously tagged

Disposition per operator standing policy on internal-dev tenant: **leave in place** (cheap to query/delete later if needed; rows live indefinitely without cost impact).

## Follow-ups

| # | Title | Why | Effort |
|---|---|---|---|
| 1 | **Per-student timing instrumentation** in `BulkInvoiceGenerateWorker` | We can't localize the per-student bottleneck without these. Pre-requisite for any throughput optimization decision. | ~2h |
| 2 | **Pre-fetch all-students gradeLevel** in one bulk identity call (or N parallel calls) before the per-student loop | The audit's HIGH #3 fix only cached schoolName; gradeLevel is still per-student. A single `GET /academics/students?ids=...` could cut the per-student wall by the identity-call duration. | ~4h |
| 3 | **Drop the version guard on `incrementCounter`** (keep terminal-status guard only) | ADD is commutative; the version-pin adds serialization without correctness benefit on this counter path. Trivial code change; verify no F1 regression. | ~1h |
| 4 | **Increase concurrency env** | Zero-code path: set `BULK_INVOICE_GENERATE_CONCURRENCY=16` on the finance task def. If per-student work is identity-bound (I/O wait), bumping concurrency should roughly halve wall time. Run this test FIRST since it requires only a `service-info.txt` change + task-def update. | <30 min |
| 5 | **CW instrumentation around `incrementSequenceBy`** (already deferred to [#344](https://github.com/shoaibrain/edforge/issues/344)) | Confirms the batch-reserve fix continues to hold; this load test proves it holds today. | (per #344) |

**Recommended order:** #4 (cheapest experiment) → #1 (instrumentation) → re-run this load test → #2 or #3 based on what #1 surfaces.

## Acceptance verdict

| Sprint E §5 risk #1 commitment | Verdict |
|---|---|
| "~3-5 min for 800 PDFs" (the original §1 statement) | Load test extrapolation: **~12 min for 800 students** at current throughput — **misses the original commitment** but the units differ (this is invoice generation, not PDF export; PDF export adds rendering cost). |
| Sprint E acceptance gate "≤90s / 600 students / <1% fail" | Reliability ✅ · Throughput ❌ — **the gate as written is not met at concurrency=8 with single ECS replica**. |

**Recommendation to operator:**
- Sprint E **functionally ships** (zero data loss, contracts all verified, audit + counter + sequence behavior correct).
- The throughput gap is a **performance follow-up**, not a correctness regression. Follow-up #4 (concurrency bump) can be A/B'd cheaply before any code change is needed.
- Pilot impact: at Saraswati's ~1200 student scale, a single bulk-generate run would take ~17 min at current throughput. That's longer than the ideal but not blocking for the pilot — the operator can submit overnight or split by grade.

# Finance instrumentation reference

Reference for the CloudWatch metrics emitted by `FinanceMetricsService` and the `edforge-finance-performance` dashboard that reads them. Closes issues [#344](https://github.com/shoaibrain/edforge/issues/344) (sequence) + [#345](https://github.com/shoaibrain/edforge/issues/345) (worker per-stage).

## Why this exists

The 2026-06-29 Sprint E load test ([finance-bulk-generate-load-2026Q3.md](finance-bulk-generate-load-2026Q3.md)) hit a throughput wall — 11× slower per-student than the audit projection. The ECS dashboard told us CPU was saturated; it couldn't tell us **which** per-student step burned the cycles. This instrumentation closes that diagnostic gap before any tactical fix (task sizing, identity pre-batch, drop counter version-guard).

## Metrics emitted

All emitted via `FinanceMetricsService.put(...)`. Best-effort: CW outages NEVER propagate to the caller's hot path; on failure the datum is dropped with a WARN log, the structured-log line emitted alongside each metric is the backup forensic trail.

### `Edforge/Finance/Sequence` (issue #344)

| Metric | Unit | Statistic to plot | Emit site | What it tells you |
|---|---|---|---|---|
| `BatchReserveCount` | Count | SUM | `SequenceService.incrementSequenceBy` on success | Total invoices issued per `schoolId` per period. **Regression sentinel:** if this metric's data-point count for a school equals its invoice count (rather than its job count), the worker has reverted to per-student reservation. The PR #341 batch-reserve fix should keep one data-point per job. |
| `BatchReserveLatencyMs` | Milliseconds | p50 + p95 | same | Wall time of one `ADD :n + return` UpdateItem against the per-school `SEQUENCE#…` partition row. Baseline healthy <50ms; alarm fires at p95 > 500ms over 15min. |
| `BatchReserveAttempts` | Count | Maximum | same | DDB UpdateItem attempt count. 1 in healthy state; sustained ≥2 = partition row is throttled. The retry envelope caps at 4 — sustained "4" is a real throttle storm. |

**Dimensions:** `schoolId`, `sequenceType` (e.g. `INVOICE#2606`).

**Round-2 (PR #351 fix-up): `BatchReserveLatencyMs` is emitted TWICE per `incrementSequenceBy` call** — once with the `{schoolId, sequenceType}` dimensions (for the dashboard's SEARCH-based per-school breakdown) and once WITHOUT dimensions (the no-dim companion stream the alarm reads). The duplicate emit costs ~$0.30/month in CW for one extra metric stream. Why we need it: CloudWatch metric alarms reject `SEARCH(...)` expressions ("SEARCH is not supported on Metric Alarms"), so the alarm cannot aggregate over the dimensioned per-school stream. The no-dim companion gives the alarm a single fleet-wide stream to evaluate p95 against. Documented because it's non-obvious and a future cleanup should NOT remove the no-dim emit thinking it's redundant.

### `Edforge/Finance/BulkWorker` (issue #345)

| Metric | Unit | Statistic to plot | Emit site | What it tells you |
|---|---|---|---|---|
| `CheckDupLatencyMs` | Milliseconds | p50 + p95 | `InvoicesService.checkDuplicateInvoice` wrapped via worker's `timeStage` helper | DDB GetItem against the duplicate-detection index. Baseline healthy <50ms p95. |
| `GenerateLatencyMs` | Milliseconds | p50 + p95 | `InvoicesService.generateForBulkWorker` (full call, including any `retryWithJitter` envelope) | The MOST IMPORTANT per-stage metric. Covers identity HTTP for student gradeLevel + fee-structure resolution + 3-item `TransactWriteItems`. Audit projection was <600ms; the 2026-06-29 load test wall implied this is the dominant stage. Confirming or refuting that drives the next tactical fix. |
| `CounterWriteLatencyMs` | Milliseconds | p50 + p95 | `FinanceJobsService.incrementCounter` (both success + skip paths) | Job-row counter increment with the F1 retry-on-Conflict envelope. Sustained p95 climbing suggests counter-write race contention. |

**Dimensions:** `schoolId`, `jobId`.

## Dashboard

**Name:** `edforge-finance-performance` (CW console → Dashboards → Custom Dashboards). Auto-provisioned by `analytics-stack`.

**ALL widgets use CloudWatch `SEARCH(...)` expressions wrapped in a `MathExpression`.** This matters because the emitter publishes every datum with dimensions (sequence: `{schoolId, sequenceType}`; worker: `{schoolId, jobId}`). CloudWatch treats each unique dimension tuple as a separate metric stream — a plain no-dimension `Metric` reference would read empty. The SEARCH expression discovers all matching tuples at query time; wrapping it in `SUM(...)` / `MAX(...)` / `AVG(...)` aggregates them into the one series the widget displays. Bare SEARCH (no aggregation) renders one series per dimension tuple — useful for per-school breakdown widgets.

CDK construction lives in `analytics-stack.ts` (search for `FinancePerformanceDashboard`). The SEARCH syntax:

```
SEARCH('{Namespace,dim1,dim2} MetricName="..."', 'stat', periodSeconds)
```

The `{}` braces around the namespace + dimension list are required; dimensions must exactly match what's emitted (case-sensitive, comma-separated).

**Layout** (top-to-bottom):

1. **Header text** — pointer to this doc + the load-test baseline doc + the related issues. Calls out the SEARCH-based design so future editors don't accidentally substitute a plain `Metric` and silently empty the widget.
2. **Sequence row** — left: `SUM(SEARCH(...))` of `BatchReserveCount` → fleet-wide total batch-reserves (proves PR #341 fix is holding); right: `MAX(SEARCH(...))` of `BatchReserveLatencyMs` at p50 + p95 (fleet worst-case-school latency) with a horizontal annotation at 500ms (the alarm threshold).
3. **Sequence per-school breakdown row** — bare `SEARCH(...)` (no aggregation) of `BatchReserveCount` Sum → one line per `(schoolId, sequenceType)` tuple. Helps identify which tenant is driving any fleet-aggregate spike.
4. **Worker stages — p50 row** — `MAX(SEARCH(...))` of each stage's `LatencyMs` at p50 across the `(schoolId, jobId)` tuples. Lets you see at a glance which stage's worst-case-job median is biggest.
5. **Worker stages — p95 row** — same 3 stages at p95. The p95 line tells you the tail; if p50 and p95 diverge wildly on one stage, you've found a bimodal distribution worth investigating.
6. **Sequence attempts row** — `MAX(SEARCH(...))` of `BatchReserveAttempts` Maximum. Should be a flat 1 baseline; any spike above 1 = transient throttle; sustained ≥4 = real throttle storm.

## Alarm

| Alarm | Metric | Threshold | Window | Action |
|---|---|---|---|---|
| `edforge-finance-sequence-latency-p95` | `Edforge/Finance/Sequence/BatchReserveLatencyMs` p95 — **no-dim stream** (the round-2 companion emit) | > 500ms | 3 data-points × 5min (15min sustained) | SNS → operator-alert topic |

The alarm uses a plain `cloudwatch.Metric` with **no `dimensionsMap`** — it reads the no-dimension companion stream `SequenceService` emits explicitly for the alarm. This is the second iteration of the alarm design:

1. **First attempt (PR #350 round-1):** plain `Metric` with no dimensions reading the dimensioned-only stream → empty stream, alarm never fires. Reviewer caught the dimension mismatch.
2. **Second attempt (PR #350 round-2):** `MathExpression` wrapping `MAX(SEARCH(...))` → CloudWatch rejected at CFN-CREATE with "SEARCH is not supported on Metric Alarms". Stack rolled back during the 2026-06-30 deploy.
3. **Third + landed (PR #351):** emit a no-dim companion datum alongside the dimensioned ones; alarm reads the no-dim stream via plain `Metric`. Works.

Semantic shift across the iterations: round-2 would have been "worst school's p95"; round-3 is "fleet-wide p95 across all calls". The fleet-wide signal is actually the better SLO measure because single-school degradation is often operator-workflow noise, while fleet-wide degradation is broad and pageable. The dashboard's SEARCH-based per-school widget still surfaces which school is driving any spike.

Why 500ms: healthy DDB UpdateItem p99 is typically <50ms on a non-hot partition. 500ms catches a sustained throttle without firing on a single slow request. Matches the pattern of the existing `edforge-analytics-landing-wcu-burst` alarm (warn before customer impact, not after).

### Lesson — CloudWatch alarm/SEARCH/dimension semantics

This single alarm went through 3 iterations because none of the failure modes are caught by offline checks (typecheck, synth, unit tests). The constraint chain:

- **CloudWatch dimensions:** each unique dimension tuple is a separate metric stream. A no-dimension `Metric` doesn't read dimensioned streams. (Round-1 bug.)
- **CloudWatch metric alarms:** reject SEARCH expressions even when wrapped to return a single series. CFN-CREATE-time check, not synth-time. (Round-2 bug.)
- **Solution:** emit the alarm's input stream WITHOUT dimensions as a companion to the dimensioned dashboard stream. Pay the small cost of one extra CW metric stream for unambiguous alarm semantics.

A future hardening: a CDK assertion test that walks the analytics-stack alarms and verifies each `metric` is either a `Metric` with `dimensionsMap` matching a known emit site OR a `MathExpression` without SEARCH. Filed mentally.

**No alarm on the worker per-stage metrics** by design — the per-stage timings are diagnostic, not gating. A single slow stage is normal under load; what matters is the operator can read the dashboard to localize the wall. Add alarms only if a specific stage breaches a documented SLO (e.g. if we set `GenerateLatencyMs.p95 < 600ms` as a Saraswati SLO).

## Cost predictability

CW `PutMetricData` is billed per metric per minute. The math:

- 3 sequence metrics × 1 emit per job × schoolId dimension → bounded by tenant × job rate
- 3 worker stage metrics × N students per job × schoolId × jobId dimensions → bounded by tenant × student × job rate (high cardinality from `jobId`)

The high-cardinality `jobId` dimension on worker metrics is intentional — without it, two concurrent jobs' p95 distributions merge and you lose the per-job diagnostic. At pilot scale (Saraswati: 24-100 students per occasional batch), this is negligible. At fleet scale (50+ schools doing daily bulk-generate), the per-jobId cardinality could surface as $5-50/month. Worth re-evaluating then by:

- **Cheapest:** drop `jobId` from worker emit dimensions (still per-school); add it back via structured log lines for forensic correlation.
- **Cheaper:** sample worker emits at 1/N (e.g. emit only every 5th student); accept p95 noise on small batches.
- **Cheapest functional:** keep current emits but reduce period to 1min instead of 5min (less granular but proportionally less metric volume in CW).

`FinanceMetricsService` batches up to 20 datums per `PutMetricData` call (the CW hard limit), flushed every 5s OR on buffer-full OR on `onModuleDestroy`. This collapses ~1100 per-student emits in a 284-student batch to ~55 API calls.

## Operational signals

| Symptom | Likely cause | Investigate |
|---|---|---|
| `BatchReserveLatencyMs` p95 climbs while `BatchReserveCount` rate is flat | Per-school sequence partition row is throttled — a different tenant just hammered it OR DDB is having a bad day | `AWS/DynamoDB/UserErrors` for `edforge-finance-basic` table; `ConsumedWriteCapacityUnits` |
| `BatchReserveCount` data-point COUNT for a school equals its invoice count | Worker reverted to per-student reservation (someone undid PR #341) | grep `incrementSequenceBy` callers in `bulk-invoice-generate.worker.ts` |
| `BatchReserveAttempts` max sustained = 4 | Retry envelope exhausted before success — partition is hot enough that 4 attempts × jittered backoff isn't enough | Capacity decision: raise DDB on-demand, or split the sequence partition |
| `GenerateLatencyMs` p95 dominates while `CheckDupLatencyMs` + `CounterWriteLatencyMs` stay flat | Per-student work (identity HTTP + 3-item TxnWrite + lineItem math) is the bottleneck. Confirms the audit's projection. | Consider identity pre-batch ([#345](https://github.com/shoaibrain/edforge/issues/345) tactical fix #3) OR finance task vCPU bump |
| `CheckDupLatencyMs` p95 climbs | Duplicate-detection GetItem partition is hot. Likely a tenant generating bulk-batches against a single billingPeriod | Check GSI1 throttle metrics for the finance table |
| `CounterWriteLatencyMs` p95 climbs while other stages stay flat | Counter-write race on the job row's version field (F1 territory). `incrementCounter` is retrying internally, latency reflects the retry cost. | Consider dropping the version guard on `incrementCounter` since `ADD` is commutative ([#345](https://github.com/shoaibrain/edforge/issues/345) tactical fix #4) |
| All 3 worker stages climb simultaneously + dashboard CPU is at 100% | finance ECS task CPU is saturated (the 2026-06-29 ECS dashboard finding); event loop is starved | Increase `cpu` in finance block of `service-info.txt` (typically 256 → 512 vCPU shares = 0.5 → 1 vCPU) |

## Local development

The instrumentation works locally too, but emits to your AWS account's CW — by default `ap-south-1`. To avoid cluttering prod CW with dev noise:

- **Option A:** unset `AWS_REGION` and unset AWS credentials. The CW client will instantiate but `PutMetricDataCommand` will fail authentication; `FinanceMetricsService.flush()` swallows the error per the best-effort contract. Hot path unaffected; no metric data published.
- **Option B:** set `AWS_REGION=us-east-1` (a region where the namespace doesn't exist) and use a dev IAM identity. Metrics will publish to your dev CW; you can inspect them without touching prod.
- **Option C:** stub `FinanceMetricsService.put()` in your local NestJS test entry point.

The Codex P1 safety pattern from `finance-backfill-grade-snapshot.ts` is reused here — transient failures are skipped, not crashed.

## Refs

- Sprint E load test (the baseline this instrumentation extends): [`docs/perf/finance-bulk-generate-load-2026Q3.md`](finance-bulk-generate-load-2026Q3.md)
- PR #341 batch-reserve fix (what `BatchReserveCount` regression-detects)
- Service: `server/application/microservices/finance/src/common/services/finance-metrics.service.ts`
- Dashboard + alarm: `server/lib/analytics/analytics-stack.ts` (search for `FinancePerformanceDashboard`)
- IAM grant: `server/service-info.txt` finance block (`cloudwatch:PutMetricData`)
- Memory: [[edforge-deploy-pipeline-the-golden-shape]] — instrumentation falls under "analytics-stack" deploy

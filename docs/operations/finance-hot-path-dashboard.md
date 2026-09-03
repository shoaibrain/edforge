# Finance hot-path metrics — ad-hoc dashboard recipe

The `edforge-finance-performance` CloudWatch dashboard was removed in the
cost-redesign (ticket C0.3): it was the account's fourth dashboard, and the fourth
crosses CloudWatch's three-free-dashboards line at $3.00/month for a view that is
read a handful of times per term. The **metrics are still emitted** by the finance
service (`Edforge/Finance/Sequence` and `Edforge/Finance/BulkWorker`, see
`docs/perf/finance-instrumentation.md`); this page is how to look at them without
a standing dashboard.

## Why every expression is a `SEARCH`

The emitter publishes per-school and per-job dimensioned series
(`{schoolId, sequenceType}` and `{schoolId, jobId}`). CloudWatch treats each
dimension tuple as a separate metric stream, so a plain metric with no dimensions
reads empty. `SEARCH(...)` discovers the tuples at query time; wrapping it in
`SUM`/`MAX` collapses them to one line.

Period is in seconds. `300` matches the 5-minute period the alarms used.

## Metrics Insights / console "Source" JSON

Paste any of these as a **Math expression** in the CloudWatch console (Metrics →
All metrics → Graphed metrics → Add math → Start with empty expression), or use
them in a `GetMetricData` call.

| Signal | Expression |
|---|---|
| Sequence batch-reserve count, fleet total | `SUM(SEARCH('{Edforge/Finance/Sequence,schoolId,sequenceType} MetricName="BatchReserveCount"', 'Sum', 300))` |
| Sequence batch-reserve latency p50, worst school | `MAX(SEARCH('{Edforge/Finance/Sequence,schoolId,sequenceType} MetricName="BatchReserveLatencyMs"', 'p50', 300))` |
| Sequence batch-reserve latency p95, worst school | `MAX(SEARCH('{Edforge/Finance/Sequence,schoolId,sequenceType} MetricName="BatchReserveLatencyMs"', 'p95', 300))` |
| Sequence batch-reserve count, one line per school | `SEARCH('{Edforge/Finance/Sequence,schoolId,sequenceType} MetricName="BatchReserveCount"', 'Sum', 300)` |
| Sequence max attempts per call (1 = healthy; 4 = retry budget exhausted) | `MAX(SEARCH('{Edforge/Finance/Sequence,schoolId,sequenceType} MetricName="BatchReserveAttempts"', 'Maximum', 300))` |
| Bulk worker `CheckDup` stage p95, worst job | `MAX(SEARCH('{Edforge/Finance/BulkWorker,schoolId,jobId} MetricName="CheckDupLatencyMs"', 'p95', 300))` |
| Bulk worker `Generate` stage p95, worst job | `MAX(SEARCH('{Edforge/Finance/BulkWorker,schoolId,jobId} MetricName="GenerateLatencyMs"', 'p95', 300))` |
| Bulk worker `CounterWrite` stage p95, worst job | `MAX(SEARCH('{Edforge/Finance/BulkWorker,schoolId,jobId} MetricName="CounterWriteLatencyMs"', 'p95', 300))` |

Swap `'p95'` for `'p50'` on any latency row for the median.

## What replaced the alarm

`edforge-finance-sequence-latency-p95` (fleet-wide p95 > 500 ms for 15 minutes)
was retired in the same change: the account is held to ten alarms and this one
guarded a PR #341 regression that has not recurred. If the batch-reserve path
regresses, the symptom is the bulk job's wall time, which the finance jobs DLQ
and worker-duration signals in the cost-redesign observability sprint (C8.1)
cover. To re-arm the old alarm temporarily:

```bash
aws cloudwatch put-metric-alarm --alarm-name edforge-finance-sequence-latency-p95 \
  --namespace Edforge/Finance/Sequence --metric-name BatchReserveLatencyMs \
  --extended-statistic p95 --period 300 --evaluation-periods 3 --datapoints-to-alarm 3 \
  --threshold 500 --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching
```

(The alarm reads the no-dimension companion datum the `SequenceService` emits
specifically for alarms; `SEARCH` is not allowed in alarms.)

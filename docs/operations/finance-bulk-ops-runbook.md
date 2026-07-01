# Finance — Bulk PDF Export Runbook

> **Audience:** EdForge operators (school accounts, ops on-call) handling Saraswati pilot bulk-invoice / bulk-receipt PDF workflows.
> **Status:** Locked at Sprint I.6 / Sprint F closing.
> **Pilot:** PABSON / Saraswati (NPR currency, BS dates, ~800 students).

---

## 1. What this feature does

The **Bulk PDF Export** lets an operator select N invoices (later: N receipts, Sprint G) from a list, hit **Download PDF (ZIP)**, and receive one ZIP file containing all the rendered PDFs — instead of downloading one PDF at a time.

Two operator-facing surfaces:

| Surface | Where it lives | What it does |
|---|---|---|
| **"Download PDF (ZIP)" bulk action** | Invoice list page (`/finance/billing/invoices`) → row-select + bulk-action bar | Kicks off a background export job for the selected invoices |
| **Progress drawer** | Right-side drawer that opens on kickoff | Shows a live "Generating PDFs..." progress bar, then a Download link when done |

Under the hood, EACH bulk export is an **async job** tracked in the `FinanceJob` table:
- `queued` → `running` → `succeeded` OR `failed`
- The row exposes `counters.{requested, succeeded, failed}`, `errors[]` (capped), and `output.zipUrl` on success (15-minute presigned URL)

**Only ONE bulk-PDF-export can run per school at a time**. Submitting a second while the first is in-flight returns HTTP **409** with the `runningJobId` of the in-flight job — the drawer pivots to poll that job instead of erroring out.

---

## 2. Operator how-to

### Downloading a batch of invoice PDFs

1. Navigate to `/finance/billing/invoices`.
2. Filter as needed (status, grade, academic year, student search).
3. **Select rows** via checkboxes at the row level. To select all filtered rows, use the header checkbox.
4. In the bulk-action bar that appears at the bottom, click **Download PDF (ZIP)**.
5. The right-side **Bulk PDF export drawer** opens with a summary: *"Ready to export N invoices as ZIP."*
6. Click **Start export**.
7. Watch the progress: `Queued → Generating PDFs (X/N) → Done`.
8. When the drawer shows **Done** + a **Download invoices.zip** button, click to download.
9. The ZIP contains one PDF per invoice, named by invoice number (e.g., `INV-420-2605-0192.pdf`).

### Closing the drawer while the job runs

You can close the drawer any time after the job dispatches (jobId is set). The worker keeps running on the backend. You can reopen the drawer's polling later — but the URL/entry point for "resume viewing an in-flight bulk export" isn't in V1 UI yet. Recommended: keep the tab open until you see the Download button.

### If the drawer shows "Bulk export already running" (409)

Another operator (or you in another tab) has an export in-flight for this school. The drawer pivots and polls THAT job — you see its progress. When it completes, submit yours.

### Understanding the presigned URL TTL

The download link is a 15-minute presigned S3 URL. If you leave the drawer open past 15 minutes without clicking Download, the URL expires and downloading returns 403. **Re-polling** `GET /finance/jobs/:jobId` re-mints the URL if it's within 60s of expiry; the drawer handles this automatically as long as it's still open.

If the download tab returns 403, close and reopen the invoice list, re-run the export (a new jobId gets a fresh URL).

---

## 3. What the operator sees when things go wrong

### Symptom: "Bulk export complete: X succeeded, Y failed."

The job completed but not every invoice made it into the ZIP. The failed invoiceIds are stored in `failedInvoiceIds[]` on the FinanceJob row. Common causes:

| Failure message pattern | What it means | Recommended action |
|---|---|---|
| `BS year 2091 is out of supported range (2000-2090)` | Invoice has an `issuedDate` / `dueDate` beyond BS 2090 (~Gregorian 2034). Very likely a data-quality issue from a mis-input during invoice generation. | Fix the source invoice's dates via **Edit Invoice**, or contact engineering to backfill. Sprint F has a small backlog of these on Sunshine Private (35 invoices dated 2095). |
| `Invoice XXX not found` | The invoiceId in the operator's selection no longer exists (deleted or wrong school scope). | Re-run the export excluding those IDs. |
| `TenantSettings…` or `Branding fetch failed` | Transient identity-service failure. Worker degrades to a null-branding fallback and the job usually still succeeds. | Wait 30s and re-run; if it persists, escalate to eng-on-call. |

### Symptom: Job stuck at `running` for > 10 minutes

The worker likely died mid-job (task replacement, OOM, or an unrecoverable render error not caught by the outer try/catch). Recovery mechanisms:

1. **MVP.3 StaleFinanceJobSweeper** runs on the next finance service boot (every deploy) and marks `running` rows older than 120 minutes as `failed`. You'll see the job flip to `failed` after the next deploy cycle.
2. **The 4h active-export sentinel TTL** clears the school's per-school lock after 4 hours, unblocking new submissions.

**In the meantime**, the operator can:
- Submit a NEW export with a smaller invoiceId list; if it succeeds within 4h, the sentinel is refreshed for the new job.
- OR wait for the sentinel TTL.

**Engineering escalation**: if the stuck job is blocking an urgent operator flow, on-call can manually mark the job `failed` + delete the sentinel via a DDB one-off:

```bash
# Mark the stuck job failed (requires ECS task role or deploy IAM)
aws dynamodb update-item \
  --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_JOB#<jobId>"}}' \
  --update-expression "SET #s = :failed, completedAt = :now" \
  --condition-expression "#s = :running" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":failed":{"S":"failed"},":running":{"S":"running"},":now":{"S":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}}'

# Delete the active-export sentinel so a new submission is accepted
aws dynamodb delete-item \
  --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_ACTIVE_EXPORT#<schoolId>"}}'
```

### Symptom: Job stuck at `queued` for > 5 minutes

The worker never picked up the row after the controller dispatched via `setImmediate`. Cause is usually a process kill immediately after the 202 response but before the worker's `markRunning` DDB update.

Recovery: PR #358 P2's queued-orphan sweep in `StaleFinanceJobSweeper` catches `queued` jobs older than 10 minutes and marks them `failed` at the next service boot. Same 4h sentinel-TTL fallback applies.

### Symptom: Every bulk export for a specific school fails with the same error

Likely a data-quality issue affecting the whole school (e.g., every invoice has bad dates, or the school's `enabledGradeLevels` is unresolvable).

1. Check `errors[]` on 2-3 recent FinanceJob rows for the school — if the same error appears across jobs, it's data-quality, not runtime.
2. Escalate to engineering with the failing invoiceIds + error string.

### Symptom: HTTP 504 Gateway Timeout on second submission during a running job

Should not happen post-PR #366. If it does, the finance ECS task's event loop is saturated (concurrent CPU-bound renders exceeding what the yield can compensate for). Escalate immediately — this indicates either:
- `BULK_PDF_CONCURRENCY` env is set too high (should be 8)
- OR the workload has grown beyond current architecture capacity (issue #365 Phase P3 needed)

### Symptom: Downloaded PDFs have black backgrounds where the logo should be

Fixed in PR #366 review commit `373eabb`. If observed post that deploy, escalate — the `.flatten({background:'#ffffff'})` step in the worker's `optimizeLogoForPdf` should be preventing this.

---

## 4. Rate limits + caps

| Limit | Value | Where set |
|---|---|---|
| Max invoiceIds per bulk-pdf-export | 2000 | `BULK_EXPORT_CAPS.zip` in `bulk-export-caps.ts`; enforced at controller (413) |
| Max concurrent bulk-PDF-export per school | 1 | MVP.5 sentinel row |
| Presigned URL TTL | 15 min | `PRESIGN_TTL_SEC` in worker |
| Active-export sentinel TTL (backstop) | 4 h | `SENTINEL_TTL_HOURS` in `finance-jobs.service.ts` |
| Stuck-`running`-job auto-recovery | 120 min | `StaleFinanceJobSweeper.STALE_AGE_MS` |
| Stuck-`queued`-job auto-recovery | 10 min | `StaleFinanceJobSweeper.QUEUED_STALE_AGE_MS` |
| Worker concurrency (renders in flight per task) | 8 | `BULK_PDF_CONCURRENCY` env |
| S3 lifecycle expiry on PDF-jobs bucket | 7 days | Tag-based rule on `edforge-pdfs-{account}-{region}` |

---

## 5. Observability — what to look at when investigating an incident

### CloudWatch metrics (Edforge/Finance/BulkPdfExport namespace)

| Metric | What it tells you |
|---|---|
| `JobTotalLatencyMs` (by `schoolId`, `jobId`) | End-to-end wall time. Watch for jobs > 30 min (indicates a hang or huge batch) |
| `PerInvoiceLatencyMs` | Per-invoice render time. Baseline ~250 ms; if > 1s consistently, either the logo is huge (image size not optimized) or renderer perf regressed |
| `TemplateFetchLatencyMs`, `BrandingFetchLatencyMs` | Identity service dep latency. Baseline ~150 ms |
| `LogoOptimizeLatencyMs` | Sharp image resize time. Baseline ~50-100 ms per job |
| `S3UploadLatencyMs` | ZIP upload to S3. Baseline ~1-5 s for 800-invoice ZIP |
| `YogaPrewarmLatencyMs` | `@react-pdf/layout` singleton init. Baseline ~50 ms per task per job (~5 ms on subsequent jobs due to memo) |

### CloudWatch logs

Structured `INFO`-level logs by component:
- `[BulkInvoicePdfExportWorker]` — one line per job start/complete + per-error
- `[FinanceJobsService]` — every `markRunning` / `markCompleted` / `markFailed` transition
- `[FinanceAuditService]` — every `finance.bulk_export.*` audit event
- `[S3Service]` — every `putZip` + `presignGet` call

Search pattern for a specific job:
```
fields @timestamp, @message
| filter @message like /<jobId>/
| sort @timestamp desc
```

### DDB inspection (read-only)

```bash
# The FinanceJob row
aws dynamodb get-item --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_JOB#<jobId>"}}'

# The active-export sentinel (if any)
aws dynamodb get-item --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_ACTIVE_EXPORT#<schoolId>"}}'
```

### S3 inspection

```bash
# The generated ZIP (path pattern):
# tenants/<tenantId>/schools/<schoolId>/pdf-jobs/<jobId>/invoices.zip
aws s3 ls --profile prod --region ap-south-1 \
  s3://edforge-pdfs-<account>-<region>/tenants/<tenantId>/schools/<schoolId>/pdf-jobs/<jobId>/
```

7-day tag-based lifecycle will expire this automatically. Do NOT touch — the export job's markCompleted DDB row is the source of truth.

---

## 6. Manual recovery flows

### Recover from a stuck sentinel (school blocked, no in-flight job)

Symptom: operator submits an export → returns 409 "already running for job X", but jobId X shows `succeeded` or `failed` already.

Cause: sentinel wasn't deleted after markCompleted / markFailed. Rare, but possible if the worker process died between markCompleted and the DELETE.

Fix:
```bash
aws dynamodb delete-item --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_ACTIVE_EXPORT#<schoolId>"}}'
```

The sentinel TTL (4h) would clear this too — but operators generally don't want to wait 4h.

### Manually mark a specific job failed

If the sweeper hasn't triggered yet and an operator wants the school unblocked immediately:

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
aws dynamodb update-item --profile prod --region ap-south-1 \
  --table-name edforge-finance-basic \
  --key '{"tenantId":{"S":"<tenantId>"},"entityKey":{"S":"FINANCE_JOB#<jobId>"}}' \
  --update-expression "SET #s = :failed, completedAt = :now, errors = list_append(if_not_exists(errors, :empty), :err)" \
  --condition-expression "#s = :running OR #s = :queued" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values "{
    \":failed\":{\"S\":\"failed\"},
    \":running\":{\"S\":\"running\"},
    \":queued\":{\"S\":\"queued\"},
    \":now\":{\"S\":\"$NOW\"},
    \":empty\":{\"L\":[]},
    \":err\":{\"L\":[{\"M\":{\"at\":{\"S\":\"$NOW\"},\"message\":{\"S\":\"manual_recovery_by_operator (runbook §6)\"}}}]}
  }"
```

Follow up by ALSO deleting the sentinel (previous section).

### Force presigned-URL regeneration

If the operator's Download URL 403s (expired past 15 min):

The simplest recovery: **submit a new bulk-pdf-export with the same invoiceIds** — a new job creates a new ZIP + new 15-minute URL. The old ZIP will be expired by the 7-day S3 lifecycle.

If the operator MUST have the same ZIP (rare): call `GET /finance/jobs/:jobId` — the endpoint re-mints the presigned URL if it's within 60s of expiry. Otherwise, escalate; there's no operator-facing "re-mint URL" endpoint in V1.

---

## 7. Known limitations

| Limitation | When it matters | Workaround |
|---|---|---|
| Only ZIP format supported (merged PDF returns 501) | Operator wants a single merged file | Use ZIP; will merge externally OR wait for Sprint H |
| Progress drawer must stay open to keep polling | Long-running jobs (> 5 min) if operator navigates away | Just close and check `/finance/billing/invoices` after ~5 min for new invoices; the ZIP is downloadable via a fresh export if needed |
| No "retry failed only" UI in V1 | Partial-fail jobs | Manually re-select the failed invoiceIds and re-run |
| Concurrent bulk-generate and bulk-pdf-export both use PerSchoolLock | If both are triggered same school, second queues | Documented; operator waits ~10s |
| CPU pegged during bulk-PDF renders | Other finance API calls (list invoices, view a payment) may show higher latency during a running export | Cosmetic; not functional break. Pilot scale is single-task-per-tenant |

---

## 8. Escalation matrix

| Symptom | Severity | Escalate to |
|---|---|---|
| All bulk exports for one school failing with data-quality error | P2 | Data-quality team (or eng if new failure mode) |
| Bulk export stuck > 30 min | P2 | Eng-on-call (via `saraswati-oncall.md`) |
| HTTP 504 on second submission during in-flight | P1 | Eng-on-call immediately (regression from PR #366) |
| Bulk export returns 5xx on kickoff | P1 | Eng-on-call — likely backend-service outage |
| Wrong PDFs in output (crossed tenants / crossed schools) | P0 | Eng-on-call + security team; halt bulk-export feature |

For every P1+ escalation, include:
- Tenant ID + school ID
- FinanceJob jobId (from URL or drawer)
- Timestamp of first observation
- Screenshot of drawer + browser network tab (F12 → Network → export as HAR)
- Operator's exact selection criteria (which filters + how many rows)

---

## 9. Post-incident review checklist

After any P0-P1 incident involving bulk PDF export:

1. Attach the FinanceJob row (from DDB) + full errors[] array to the incident report
2. Extract CloudWatch metric window ±30 min (screenshot from `EdForge-Finance-BulkPdfExport` dashboard when it lands — Sprint I.3)
3. Identify: was it a data-quality issue, a code regression, a capacity issue, or infra?
4. If capacity: was `BULK_PDF_CONCURRENCY` correctly set to 8? What was the concurrent submission rate?
5. If code regression: which PR? Add a regression spec to prevent recurrence.
6. Update this runbook with the new failure signature + recovery pattern.

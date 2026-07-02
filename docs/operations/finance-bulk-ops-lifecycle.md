# Finance Bulk-Ops S3 — Lifecycle + Access Log Runbook

**Sprint I.5.** Covers the `edforge-pdfs-<account>-<region>` bucket that holds finance bulk-export ZIPs and merged-PDFs, plus the sibling `edforge-pdfs-access-logs-<account>-<region>` bucket that captures every request against it.

Answers three operator questions:
- **What gets auto-deleted, when?** — the lifecycle rule below.
- **Who downloaded my child's invoice at 3:14 am?** — Athena over the access logs.
- **How do I keep an artifact past the auto-delete?** — copy or re-tag before day 7.

## Bucket layout

```
edforge-pdfs-<account>-<region>
└── tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/
    ├── individual/{invoiceNumber}.pdf   (Sprint F worker per-PDF intermediate)
    ├── invoices.zip                     (Sprint F.3 ZIP variant)
    ├── invoices-merged.pdf              (Sprint H.3 merged variant, future)
    └── receipts.zip                     (Sprint G.2 receipt variant)

edforge-pdfs-access-logs-<account>-<region>
└── pdfs-access-logs/YYYY-MM-DD-HH-MM-SS-<uuid>
```

Every writer that places an object under `.../pdf-jobs/...` MUST tag it `{ lifecycle: 'pdf-jobs' }` at `PutObject` time. Enforced by the worker code paths (`bulk-invoice-pdf-export.worker.ts`, `bulk-receipt-pdf-export.worker.ts`). Untagged objects survive — intentional so V1.5 can add audit-copy or long-retention objects without special-casing.

## Lifecycle rules

### `edforge-pdfs-*` — `expire-pdf-jobs-7d`

- **Filter:** tag `lifecycle=pdf-jobs`
- **Action:** expire (delete) 7 days after creation.
- **Rationale:** bulk export outputs are operator-triggered, short-lived deliverables. Presigned URLs mint at 15-min TTL; once the operator has downloaded the ZIP, the S3 copy is no longer needed. 7 days accommodates re-download attempts + operator vacation windows.
- **Prod-verified state** (`aws s3api get-bucket-lifecycle-configuration`):
  ```
  RULES    expire-pdf-jobs-7d    Enabled
  EXPIRATION 7
  FILTER   AND / TAGS lifecycle=pdf-jobs
  ```

### `edforge-pdfs-access-logs-*` — `expire-access-logs-90d`

- **Filter:** none (whole bucket)
- **Action:** expire 90 days after creation.
- **Rationale:** long enough for a full incident-response / audit cycle; short enough to bound storage. Standard access-log retention across the industry.

## Access-log query patterns (Athena)

S3 server access logs land in the sibling bucket as space-delimited text (one log per request). Point Athena at them with:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS pdfs_access_logs (
    bucketowner STRING,
    bucket_name STRING,
    requestdatetime STRING,
    remoteip STRING,
    requester STRING,
    requestid STRING,
    operation STRING,
    key STRING,
    request_uri STRING,
    httpstatus STRING,
    errorcode STRING,
    bytessent BIGINT,
    objectsize BIGINT,
    totaltime STRING,
    turnaroundtime STRING,
    referrer STRING,
    useragent STRING,
    versionid STRING,
    hostid STRING,
    sigv STRING,
    ciphersuite STRING,
    authtype STRING,
    endpoint STRING,
    tlsversion STRING,
    accesspointarn STRING,
    aclrequired STRING
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.RegexSerDe'
WITH SERDEPROPERTIES (
    'input.regex' = '([^ ]*) ([^ ]*) \\[(.*?)\\] ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) \\"([^\\"]*)\\" (-|[0-9]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) \\"([^\\"]*)\\" \\"([^\\"]*)\\" ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*)'
)
LOCATION 's3://edforge-pdfs-access-logs-<account>-<region>/pdfs-access-logs/'
```

### IR query — "who downloaded invoice X and when"

```sql
SELECT requestdatetime, remoteip, useragent, httpstatus, bytessent
FROM   pdfs_access_logs
WHERE  operation = 'REST.GET.OBJECT'
  AND  key LIKE '%INV-BLR-2083-T1-01234.pdf'
ORDER BY requestdatetime DESC;
```

### IR query — "every download by a specific requester in the last 24 h"

```sql
SELECT requestdatetime, key, httpstatus, useragent
FROM   pdfs_access_logs
WHERE  operation = 'REST.GET.OBJECT'
  AND  requester = 'arn:aws:iam::<account>:user/<op-user>'
  AND  parse_datetime(requestdatetime, 'dd/MMM/yyyy:HH:mm:ss Z')
       > current_timestamp - interval '24' hour
ORDER BY requestdatetime DESC;
```

### IR query — "unique source-IPs downloading a tenant's PDFs today"

```sql
SELECT DISTINCT remoteip
FROM   pdfs_access_logs
WHERE  operation = 'REST.GET.OBJECT'
  AND  key LIKE 'tenants/21aea5da-511f-4dfa-a6f2-6971f63a719f/%'
  AND  substr(requestdatetime, 1, 11) = date_format(current_date, '%d/%b/%Y');
```

## What the operator changes (rare — mostly hands-off)

- **Extend an artifact past 7 d** — copy the object to another key or re-tag it to remove `lifecycle=pdf-jobs`:
  ```bash
  aws s3api put-object-tagging \
    --bucket edforge-pdfs-<account>-<region> \
    --key <full-key> \
    --tagging 'TagSet=[{Key=lifecycle,Value=retain}]'
  ```
- **Force early expire of a specific artifact** — direct `aws s3 rm` on the key. The bucket has versioning OFF so this is a hard delete.
- **Change the retention window** — edit `expire-pdf-jobs-7d` in `server/lib/analytics/analytics-stack.ts`, re-deploy `analytics-stack`. Coordinate with the operator runbook before shortening.

## Change history

- 2026-07-02 — Sprint I.5: added `PdfsAccessLogsBucket` + wired `serverAccessLogsBucket` on `PdfsBucket`, opened this doc. Existing `expire-pdf-jobs-7d` rule confirmed unchanged.

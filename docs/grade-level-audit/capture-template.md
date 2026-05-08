---
title: Per-Scenario Capture Template
status: Operator checklist
date: 2026-05-08
---

# Per-Scenario Capture Template

For every scenario (A through H per [test-strategy.md](test-strategy.md)), produce a complete evidence bundle in the corresponding `artifacts/<scenario-id>/` directory. The pattern below is uniform — copy it for each scenario.

## What "complete" means

Four layers of evidence per scenario. **All four must be present** before the scenario is considered captured. If a layer is genuinely unavailable (e.g., no relevant CloudWatch logs because the call was a pure DDB read), record an explicit `<layer>-NOT-APPLICABLE.txt` with the reason rather than silently omitting it.

```
artifacts/<scenario-id>/
  ├── 01-network/                # browser network tab captures
  │     ├── request-<method>-<path>.json
  │     └── response-<method>-<path>.json
  ├── 02-ddb/                    # DDB row dumps (full Items, not COUNT)
  │     ├── school-<schoolId>.json
  │     ├── students.json        # query result
  │     └── enrollments.json     # query result
  ├── 03-cloudwatch/             # CloudWatch log excerpts
  │     ├── identity-service-<timestamp>.log
  │     └── academics-service-<timestamp>.log
  ├── 04-screenshots/            # UI proof
  │     └── <scenario-id>-<frame>.png
  └── notes.md                   # operator notes — anything weird, surprising, off-script
```

## Per-scenario checklist

For scenarios A and B (school create) — operator does this:

```text
[ ] Open https://edforge.app, logged in as the dev-pabson-primary admin
[ ] Open browser DevTools → Network tab → preserve log → filter "schools"
[ ] Click "Create New School", fill the wizard:
    - For A: Tenant Name = dev-pabson-primary-school-A-wide,
             gradeRange = ECD → 12
    - For B: Tenant Name = dev-pabson-primary-school-B-narrow,
             gradeRange = 6 → 10
    Other fields: any plausible values; School Type = "Private" or operator's choice
[ ] On the wizard's grade-levels step, screenshot the auto-computed chip list
    (must include both "From grade range" and "Additional grade levels" rows)
    → save as 04-screenshots/<id>-wizard-chips.png
[ ] Click through to Submit
[ ] In Network tab, find the POST to /api/schools (or /api/schools/<id>/configuration)
    Right-click → "Copy as cURL" or save request+response payloads as JSON
    → save as 01-network/request-POST-schools.json + response-POST-schools.json
[ ] Capture the new schoolId from the response
[ ] Save: notes.md with the schoolId, the timestamp of the create, anything weird
```

For Claude (read-only AWS) immediately after each school create:

```text
[ ] aws dynamodb get-item on the school's METADATA / SCHOOL row
    → save as 02-ddb/school-<schoolId>.json
[ ] aws logs filter-log-events on identity-service log group, time range
    [submit-time - 30s, submit-time + 30s]
    → save as 03-cloudwatch/identity-service-<timestamp>.log
```

For scenarios C and D (IEMIS import) — operator does this:

```text
[ ] Have the 14-row IEMIS fixture xlsx ready (built per test-strategy.md spec)
[ ] In the academics MFE, navigate to the school (A for C, B for D)
[ ] Open Network tab → preserve log → filter "iemis"
[ ] Click "Import IEMIS" → upload the xlsx → submit
[ ] Wait for the job to complete (per Sprint C4, the import is async — watch the job status)
[ ] Screenshot any UI feedback: success counts, warning counts, error counts
    → save as 04-screenshots/<id>-import-result.png
[ ] Capture the entire request-response chain in Network tab — especially:
    - The initial POST that uploads the xlsx
    - The job-status poll responses
    - Any final summary response
    → save as 01-network/*.json (one file per request)
```

For Claude immediately after each IEMIS import:

```text
[ ] aws dynamodb query on edforge-academics-basic for tenantId
    → save as 02-ddb/students.json (filter to entityType = STUDENT)
    → save as 02-ddb/enrollments.json (filter to entityType = ENROLLMENT)
[ ] aws logs filter-log-events on academics-service log group, time range
    [import-start - 30s, import-end + 30s]
    Filter to include WARN and ERROR lines
    → save as 03-cloudwatch/academics-service-<timestamp>.log
```

For scenarios E, F (dashboard reads) — operator does this:

```text
[ ] Acquire a valid JWT for the dev-pabson-primary admin (browser localStorage token, or auth flow)
[ ] curl GET /api/academics/dashboard/overview with:
    - schoolId = School A (E) or B (F)
    - academicYearId = whichever AY the school has (capture from G's school-detail)
    - date = today
    - Authorization: Bearer <jwt>
[ ] Save the full response body
    → save as 01-network/response-GET-dashboard-overview.json
[ ] (No DDB / CloudWatch needed — pure read. Mark 02-ddb-NOT-APPLICABLE.txt + 03-cloudwatch-NOT-APPLICABLE.txt)
```

For scenarios G, H (school detail + curriculum tab) — operator does this:

```text
G: GET /api/schools/<schoolIdA>
   GET /api/schools/<schoolIdB>
   → save both responses

H: Navigate to the Curriculum / Grade Levels tab in the academics MFE
   Capture every API call it makes (there may be more than one — list endpoints found in test-strategy.md prediction table)
   → save each request+response pair
```

## Filename conventions

- Use ISO-8601 UTC timestamps in filenames where you'd otherwise need ordering: `2026-05-08T14-30-00Z`
- Use kebab-case
- One file per logical unit (one request, one DDB query, one log excerpt) — easier for Claude to diff than concatenated jumbles

## What to skip

- Don't capture other tenants' data — only `21aea5da-511f-4dfa-a6f2-6971f63a719f`
- Don't capture node_modules / vendor bundle assets in network tab
- Don't include real PII in the IEMIS fixture (synthetic data only)
- Don't run any DDB writes outside of the captured scenarios

## When all 8 scenario directories have evidence

Drop a one-line note in this file's `## Capture sign-off` section below (operator-edited), then ping me. I'll proceed to T1 + T2 + T3 + T4 + T7 informed by the evidence, then synthesize T8.

## Capture sign-off

(Operator: edit when done. Format: `<scenario-id>: ✅ <YYYY-MM-DD> <operator-initials> — <one-line note>`.)

- A:
- B:
- C:
- D:
- E:
- F:
- G:
- H:

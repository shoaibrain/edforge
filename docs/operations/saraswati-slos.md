# Saraswati Pilot — Service Level Objectives (V1)

**Scope:** Pilot go-live → first 90 days of live Saraswati usage.
**Signed baseline:** Shoaib, Sprint I-2 completion date (to be filled in when Phase 4 ships).
**Review cadence:** Monthly during pilot; quarterly once steady-state.

---

## 1. User-visible SLOs

| Flow | Target (p95) | Target (p99) | Measurement |
|---|---|---|---|
| Tenant-admin login → dashboard render | <2 s | <4 s | Synthetic canary (post-pilot); manual measurement during drill |
| School list page load | <3 s | <5 s | ALB `TargetResponseTime` for `/api/identity/schools` |
| Student create (single) | <2 s | <4 s | ALB `TargetResponseTime` for `/api/academics/students` POST |
| Attendance mark (class) | <3 s | <6 s | ALB `TargetResponseTime` for `/api/academics/attendance` POST |
| IEMIS bulk import (1000 rows) | <60 s end-to-end | <90 s | Application logs / dry-run timing |
| Dashboard widgets load | <3 s | <5 s | ALB `TargetResponseTime` for `/api/analytics/...` |

**Enforcement for V1:** targets are aspirational, not SLO-breach-paging. Breach triggers a tracking ticket, not a page.

---

## 2. Availability SLOs

| Service | Target uptime | Error budget (monthly) | Paging behavior |
|---|---|---|---|
| Tenant-facing ALB + ECS services (identity/academics/finance/rproxy) | 99.5% | 3h 39min/month | Page on sustained 5xx (>10 in 5 min) |
| Tenant provisioning pipeline | 98% of attempted provisions succeed | 1 failure per ~50 attempts tolerated | Page on any CodeBuild failure (low volume) |
| Analytics pipeline (events → aggregator → analytics table) | 99% event delivery | 1% acceptable loss via DLQ | Page on DLQ depth >0 for 15 min |

**V1 scope:** 99.9% is not realistic during pilot. 99.5% accounts for the facts that (a) we have no multi-region redundancy in V1, (b) deploys currently blip ALB 5xx briefly, (c) the operator is a single human in one timezone.

---

## 3. Data correctness SLOs

| Concern | Target | Measurement |
|---|---|---|
| IEMIS student import dedup (GSI7) | 100% of re-imports skip existing rows, 0 duplicates | Compare row counts before/after re-import |
| Tenant cross-isolation (tenant A cannot read tenant B data) | 100% enforcement | Ad-hoc cross-tenant smoke tests quarterly + after any IAM change |
| Workspace lock enforcement (data-integrity fields locked during active year) | 100% rejection | Covered by Sprint B spec suite + prod smoke |
| PABSON emisSchoolCode required at create | 100% enforcement | Covered by Sprint C Gap 1 spec suite + prod smoke |

---

## 4. Observability SLOs

| Signal | Target | Consequence of miss |
|---|---|---|
| CRITICAL alarm → email delivery | <5 min | Treat as P0 incident (paging infra broken) |
| Dashboard load | <10 s | Annoying but non-blocking |
| CloudWatch Logs retention | 30 days (paid tier) / 7 days (Lambda default) | Longer audit needs require S3 export |
| Deploy log retention in repo | 90 days in git, older to S3 archive | Per CLAUDE.md rotation plan |

---

## 5. Operational SLOs

| Event | Target | Measurement |
|---|---|---|
| Operator ack of CRITICAL alarm | <15 min | Reply time in email thread |
| Time to triage (alarm → known root cause) | <30 min | Incident log |
| Time to mitigate (not necessarily fix) | <60 min | Incident log |
| Paging drill pass rate | 100% (1-for-1) | Every drill logged |
| Runbook coverage | Every firing alarm has a runbook section | Update runbook when gap appears |

---

## 6. What's NOT in V1 SLOs (honest)

- **Multi-region failover** — single-region V1. A full AWS region outage is an accepted pilot risk.
- **Zero-downtime deploys** — ALB 5xx blip during ECS rolling deploys (~30 s) is accepted. Add blue-green in Sprint J+.
- **Data retention beyond DDB PITR + S3 backups** — no cold-storage DR plan yet.
- **Vendor-lock compliance audits** — SOC2 / FERPA / PII handling documentation is Sprint M+ scope.
- **Cost SLOs** — no automated spend alerts. Monthly manual review of AWS billing console.

---

## 7. SLO → alarm mapping (traceability)

| SLO line | Alarm that enforces it |
|---|---|
| ALB uptime 99.5% | `edforge-alb-5xx-surge` |
| Provisioning 98% | `edforge-provisioning-codebuild-failures` + `edforge-deprovisioning-codebuild-failures` |
| Analytics 99% delivery | `edforge-analytics-aggregator-dlq-depth` + `edforge-analytics-aggregator-errors` + `edforge-analytics-aggregator-throttles` |
| Tenant-seeder 100% success | `edforge-tenant-seeder-errors` |
| Landing table capacity | `edforge-analytics-landing-wcu-burst` |
| Paging → email <5 min | Quarterly drill (this doc: `paging-drill.md`) |

Any SLO line without an alarm row is observational only — update this table when an alarm is added.

---

## 8. Change log

| Date | What | Signed |
|---|---|---|
| 2026-04-21 | Baseline drafted with Phase 4 (Sprint I-2) CDK changes | Shoaib (pending) |

# EdForge Saraswati Pilot — On-Call Runbook

**Status:** Active for Saraswati go-live window (post-Phase 4, pre-Phase 5).
**Primary responder:** Shoaib (<shoaib.rain1@gmail.com>).
**Backup:** TBD — Sprint I-2 still names one human; add at least one more before go-live day.
**Response time expectation:** 15 minutes to ack, 30 minutes to triage, 60 minutes to mitigate or escalate.

---

## 1. How alerts reach you

| Source | Topic | Inbox | Typical latency |
|---|---|---|---|
| Provisioning/deprovisioning CodeBuild failures | `edforge-provisioning-alerts` | Operator email | <5 min from failure |
| Live-tenant runtime alarms (ALB 5xx, aggregator errors, tenant-seeder errors, DLQ depth, WCU burst) | `edforge-alerts-operator` | Operator email | <5 min from breach |
| Manual observation via dashboard | `edforge-pilot` CloudWatch dashboard | Browser (AWS console) | N/A (polling) |

**Both topics deliver to the same email.** Subject line differentiates: `ALARM: edforge-provisioning-*` vs `ALARM: edforge-analytics-*`, `edforge-tenant-seeder-*`, `edforge-alb-*`.

**If you are NOT receiving alarm emails in UAT or prod after a real breach, treat it as P0** — the paging infrastructure itself is broken. Check SNS topic subscription status in the AWS console, confirm the email was confirmed.

---

## 2. Dashboard quick-links

- **Pilot health (start here):** CloudWatch → Dashboards → `edforge-pilot`
- **Analytics internals:** CloudWatch → Dashboards → `edforge-analytics-health`
- **Event DLQ:** CloudWatch → Dashboards → `edforge-event-dlq-<env>`

ECS services: Console → ECS → Clusters → `prod-basic` → Services (identitybasic, academicsbasic, financebasic, rproxybasic).

---

## 3. Alarm → action matrix

### 3.1 `edforge-alb-5xx-surge` (CRITICAL)

**Meaning:** Tenant-facing ALB returned >10 backend 5xx responses in a 5-minute window. Every such response is a failed request a user saw.

**Triage:**
1. Open CloudWatch Logs for each ECS service (`prod-basic/identitybasic`, etc). Search for `ERROR` or unhandled exceptions in the last 10 min.
2. Check ECS Events tab on each service for task restart loops.
3. Check the aggregator Lambda — if it's crashing, academics/finance writes might be retrying and piling up.
4. Check DDB throttle widget on the pilot dashboard — a sudden throttle surge points to a missing GSI or an unexpected scan.

**Common root causes (in order of likelihood):**
- A recent deploy introduced a crash in a code path that tests didn't cover → roll back via ECR tag revert (see [Rollback](#5-rollback-reference)).
- DDB on-demand burst exceeded; happens under load spikes like bulk import → capacity resets within 15 min, monitor.
- An upstream API (Cognito, SBT) timing out → check AWS health dashboard.

**Mitigation:**
- If a bad deploy: `aws ecs update-service --force-new-deployment` after tagging the prior-good ECR digest as `:latest`.
- If sustained capacity issue: temporarily increase the service desiredCount (add 1 task) to dilute load.

---

### 3.2 `edforge-tenant-seeder-errors` (CRITICAL)

**Meaning:** A tenant just finished provisioning (or tried to) but the Lambda that writes the identity METADATA + SETTINGS#WORKSPACE rows failed. The new tenant's TenantAdmin cannot log in or create schools.

**Triage:**
1. CloudWatch Logs → `/aws/lambda/controlplane-stack-*TenantSeederFn*` — read the error.
2. Common messages:
   - `IDENTITY_TABLE_BASIC does not exist` → tenant-template stack deploy failed; check CloudFormation events.
   - `User: arn:... is not authorized to perform dynamodb:PutItem` → IAM drift; re-deploy controlplane-stack.
   - `Zod validation failed` → schema drift between shared-types and the seeder's inlined code.

**Mitigation:**
- If a single tenant is stuck: manually write the METADATA + SETTINGS#WORKSPACE rows via CloudShell (see Phase 0 patch commands in `MIDNIGHT_LOCKIN_POST_SHIP_PLAN.md`).
- If every tenant seeder invocation is failing: re-deploy controlplane-stack after fixing root cause; do NOT let new tenants provision until fixed.

---

### 3.3 `edforge-analytics-aggregator-errors` (CRITICAL)

**Meaning:** The EventBridge → aggregator Lambda path is returning errors. Events will retry twice before landing on the aggregator DLQ.

**Triage:**
1. CloudWatch Logs → `/aws/lambda/*AggregatorFn*` — look for error patterns.
2. Confirm the DLQ depth widget — at 15 min the dedicated DLQ alarm will fire separately.
3. Check the aggregator Lambda's throttle metric — if throttles coincide with errors, it's concurrency starvation, not a code bug.

**Mitigation:**
- Code bug: deploy a fix via analytics-stack redeploy.
- Throttle: increase `reservedConcurrentExecutions` (currently 20) via a targeted analytics-stack patch.

---

### 3.4 `edforge-analytics-aggregator-dlq-depth` (CRITICAL after 15 min)

**Meaning:** Events that the aggregator couldn't process have been sitting on the DLQ for 15+ minutes. These events are analytics data loss if not replayed.

**Triage:**
1. Check the aggregator-errors alarm (3.3) — is it firing concurrently? If yes, fix that first.
2. Inspect the DLQ messages in SQS console to identify the event pattern.

**Mitigation:**
- Fix the code issue.
- After deploy, replay DLQ messages back to the bus via a one-off script (template in `scripts/smoke-tests/` — build one if the pattern isn't there yet).

---

### 3.5 `edforge-analytics-aggregator-throttles` (WARNING)

**Meaning:** The aggregator Lambda is hitting its reserved concurrency ceiling (20).

**Triage:** Usually temporary during event bursts. If sustained, pilot traffic has grown past the ceiling — revisit the ReservedConcurrency setting.

---

### 3.6 `edforge-analytics-landing-wcu-burst` (WARNING)

**Meaning:** Landing table consumed >80% of on-demand burst capacity in a 5-min window.

**Triage:** Usually coincident with a traffic surge. On-demand resets within 15 min. If it sustains, review writer fan-out.

---

### 3.7 `edforge-provisioning-codebuild-failures` / `edforge-deprovisioning-codebuild-failures` (CRITICAL)

**Meaning:** SBT's CodeBuild job failed while running `provision-tenant.sh` / `deprovision-tenant.sh`. Because of ISSUE-008, the SBT Step Function masks these as success — this CloudWatch alarm is the authoritative signal.

**Triage:**
1. AWS Console → CodeBuild → build history → click the failed run.
2. Read `BUILD` phase output for the actual error (usually CDK synth/deploy failure, ECR push, or DDB conflict).

**Mitigation:**
- If it's a CDK-level issue (schema, IAM), fix locally, re-run through the SBT onboarding UI.
- If it's a partial deploy (some resources up, some not), follow the manual clean-up procedure in `docs/AWS_CLI_OPERATIONS_GUIDE.md` before retry.

---

## 4. Escalation path

| Severity | Trigger | Who | How |
|---|---|---|---|
| P0 | ≥25% of tenant requests failing OR provisioning blocked for >30 min | Shoaib + AWS support | AWS support ticket + phone if available |
| P1 | Sustained alarm on CRITICAL for >60 min | Shoaib direct | Email reply to alarm + investigation thread |
| P2 | WARNING alarms, aggregate visible in dashboard | Shoaib periodic review | End-of-day scan, not paged |

No second-tier human today. Before Saraswati go-live: add at least one more subscriber to `edforge-alerts-operator` (redundancy). This is a Phase 4 gap flagged to Shoaib.

---

## 5. Rollback reference

### ECS image rollback (identity example)

```bash
# Find prior good gitsha tag
AWS_PROFILE=prod aws ecr describe-images --repository-name identity \
  --query 'sort_by(imageDetails,& imagePushedAt)[*].{tags:imageTags,pushed:imagePushedAt}' \
  --output table --region ap-south-1

# Re-tag prior digest as :latest (documented in CLAUDE.md)
# Then force new deployment
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --force-new-deployment --region ap-south-1
```

### CDK stack rollback

CloudFormation auto-rolls back a failed `cdk deploy`. If stuck in `UPDATE_ROLLBACK_FAILED`, follow recovery steps in `docs/AWS_CLI_OPERATIONS_GUIDE.md`.

### Full service restart

```bash
# Force all tasks to recycle (no deploy — useful for memory-leak scenarios)
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --force-new-deployment --region ap-south-1
```

---

## 6. Post-incident checklist

- [ ] Log the incident in `docs/deploys/incidents/<date>-<short-name>.md` with timeline, alarm that fired, root cause, resolution, prevention steps.
- [ ] If a new alarm would have caught this sooner, propose adding it (quarterly review minimum).
- [ ] If the runbook step that fixed this wasn't documented, update this file.
- [ ] If the alert message wasn't useful, update the `alarmDescription` in the CDK code.

---

## 7. Out-of-scope for pilot V1 (known gaps)

- No Slack integration (email only).
- No structured JSON logging — CloudWatch Logs Insights works on plain text but is slower.
- No per-tenant alarm routing (everything goes to the global operator topic).
- No ECS CPU/memory alarms (task-level) — deferred; PAY_PER_REQUEST DDB + Fargate auto-scaling cover the common cases.
- No synthetic canary tests — deferred to post-pilot.

File these as Sprint J tickets if pilot surfaces a need.

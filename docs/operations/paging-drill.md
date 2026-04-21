# Paging Drill — Standard Operating Procedure

**Purpose:** Prove end-to-end that a breach of a pilot-critical alarm reaches the on-call human within the SLO window (<5 minutes). Without a successful drill, "paging works" is untested theory.

**Frequency:**
- **Before Saraswati go-live:** one successful drill in UAT. Mandatory.
- **Quarterly in prod** after go-live: schedule + notify operator 10 min ahead.

**Scope:** Only run drills against UAT for V1. Prod drills after go-live only once pilot is stable for ≥14 days.

---

## Pre-drill checklist

- [ ] Operator (Shoaib) available and notified 10 minutes ahead of start.
- [ ] Confirm email inbox is monitored during the drill window.
- [ ] Confirm `edforge-alerts-operator` SNS topic has the operator email subscribed + confirmed (check AWS console).
- [ ] Pick a drill scenario (section below). Stop if anyone is mid-feature or mid-deploy on UAT.

---

## Drill scenarios

### Scenario A — "ALB 5xx surge" (recommended first drill)

**Trigger:** Force the identity service into a 5xx loop by stopping all tasks, forcing the ALB to have no healthy backends briefly.

```bash
# Pick a running task
AWS_PROFILE=uat aws ecs list-tasks \
  --cluster prod-basic --service-name identitybasic \
  --region us-east-2 --query 'taskArns[0]' --output text

# Stop it — ECS will replace, 5xx blip expected during ~30s replacement
AWS_PROFILE=uat aws ecs stop-task \
  --cluster prod-basic --task <arn> \
  --region us-east-2 \
  --reason "paging drill <date> — expected transient 5xx"
```

**Blast radius:** Under 60 seconds of intermittent 5xx on UAT tenant-facing traffic for one service while ECS replaces the task. Acceptable on UAT; unacceptable in prod.

**Expected alarm:** `edforge-alb-5xx-surge` fires when the transient 5xx from ALB health-check failures or the brief outage exceeds threshold. **May not fire on UAT** if traffic is too low to generate 10 5xx in 5 min — this is the scenario's weakness on quiet environments. Fall back to Scenario B if so.

---

### Scenario B — "Lambda error" (reliable on quiet environments)

**Trigger:** Invoke the aggregator Lambda with a malformed payload designed to throw inside the handler.

```bash
# Template payload designed to fail Zod validation inside the handler
cat > /tmp/drill-payload.json <<'EOF'
{
  "source": "edforge.academics",
  "detail-type": "AttendanceMarked",
  "detail": { "completelyInvalid": true, "noRequiredFields": "at all" }
}
EOF

# Invoke the aggregator Lambda directly (name varies by env; look it up first)
LAMBDA_NAME=$(AWS_PROFILE=uat aws lambda list-functions \
  --region us-east-2 --query 'Functions[?contains(FunctionName,`Aggregator`)].FunctionName' \
  --output text)

AWS_PROFILE=uat aws lambda invoke \
  --function-name "$LAMBDA_NAME" \
  --region us-east-2 \
  --payload file:///tmp/drill-payload.json \
  /tmp/drill-response.json

cat /tmp/drill-response.json
```

**Blast radius:** One failed Lambda invocation. No user impact.

**Expected alarm:** `edforge-analytics-aggregator-errors` fires within 5 min.

---

### Scenario C — "Tenant-seeder error" (structured, infrastructure-touching)

**Trigger:** Send a malformed `sbt_aws_provisionSuccess` event that the tenant-seeder Lambda will fail to process.

```bash
AWS_PROFILE=uat aws events put-events --region us-east-2 --entries '[
  {
    "EventBusName": "<SBT event bus name — from CFN output>",
    "Source": "sbt_aws",
    "DetailType": "provisionSuccess",
    "Detail": "{\"invalidShape\": true}"
  }
]'
```

**Blast radius:** None — malformed event is rejected, no real tenant affected.

**Expected alarm:** `edforge-tenant-seeder-errors` fires within 5 min.

---

## Drill execution — timing record

For every drill, operator records to `docs/deploys/uat-paging-drill-<YYYYMMDD>.log`:

```
t=T+0     trigger fired: <scenario>
t=T+?m?s  CloudWatch alarm state → ALARM
t=T+?m?s  SNS delivery attempted (from SNS topic delivery status, if available)
t=T+?m?s  email received in operator inbox (check inbox timestamp)
t=T+?m?s  operator acknowledged (logged in thread)
t=T+?m?s  drill cleanup complete
```

**Pass criteria:**
- alarm → email: <5 minutes
- email content includes enough info to act (alarm name, metric, description, link to dashboard)

**Fail criteria:**
- alarm → email: >5 minutes
- email not received within 10 minutes (paging infra broken — this is a P0)
- email received but alarm description is unhelpful (fixable in CDK `alarmDescription`)

---

## Post-drill cleanup

- Scenario A: ECS replaces the task automatically; confirm `desiredCount == runningCount` via describe-services.
- Scenario B: no cleanup needed.
- Scenario C: no cleanup needed (malformed event is dropped, not persisted).

Document any unexpected behavior in the drill log.

---

## Failure modes we've already seen (document here as we hit them)

_(empty for now — updated after first real drill)_

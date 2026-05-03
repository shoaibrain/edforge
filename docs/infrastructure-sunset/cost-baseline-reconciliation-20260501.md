---
title: Sprint 2 — Cost-Baseline Reconciliation (T2.3)
date: 2026-05-01
account: 257526644020 (ap-south-1, prod)
window: 2026-04-01 → 2026-05-01 (30 days)
purpose: Anchor Sprint 5/6 savings projections against realized Cost Explorer numbers BEFORE any optimization deploy lands.
---

# Headline

| Metric | Value |
|---:|---|
| **Total monthly cost** | **$203.69** |
| Audit estimate (`01-audit-report.md` §2.3) | ~$201 |
| Variance | +$2.69 (+1.3%) |
| Verdict | **Reconciles.** Audit projections are anchored correctly. |

# Per-service breakdown (last 30 days, ap-south-1 only)

| Rank | Service | Monthly cost | % of total |
|---|---|---:|---:|
| 1 | EC2 - Other (NAT GW + EIP + data transfer) | **$103.22** | 50.7% |
| 2 | Amazon Elastic Container Service (Fargate) | **$54.08** | 26.5% |
| 3 | Amazon Elastic Load Balancing (ALB + NLB) | **$28.70** | 14.1% |
| 4 | Amazon Virtual Private Cloud | $8.97 | 4.4% |
| 5 | Amazon Elastic Compute Cloud - Compute (EC2 instance) | $6.64 | 3.3% |
| 6 | AWS Key Management Service | $1.65 | 0.8% |
| 7 | Amazon CloudWatch | $0.27 | 0.1% |
| 8 | Amazon DynamoDB | $0.05 | 0.0% |
| 9 | Amazon ECR | $0.03 | 0.0% |
| 10 | Amazon Cognito | $0.03 | 0.0% |
| 11 | Amazon S3 | $0.02 | 0.0% |
| 12 | Amazon API Gateway | $0.02 | 0.0% |
| 13 | CloudWatch Events / CloudFormation / Secrets Manager | $0.00 | 0.0% |

# Daily distribution

- Mean: ~$6.79/day
- Range: $0 (incomplete boundary day) to $8.22/day
- No spike days — pilot traffic is steady.

# Reconciliation against audit estimates

| Audit estimate (§2.3) | Audit | Realized | Delta | Verdict |
|---|---:|---:|---:|---|
| NAT Gateways (3 × $32) | $96 | $103.22 (EC2-Other = NAT + EIP + data transfer) | +$7 | Audit slightly under; the extra is data-transfer + EIP charges, not pure NAT |
| Load balancers + VPC Link | $44 | $28.70 + ~$2 (VPC Link in VPC line) | -$13 | Audit slightly over |
| ECS Fargate | $72 | $54.08 | **-$18** | Reviewer was correct: audit overstated Fargate per-task pricing by ~25% |
| VPC Flow Logs (CW Logs) | $15–30 | $0.27 | **-$15** | VPC Flow Logs ingestion appears billed under EC2-Other in this account, not CloudWatch Logs |
| All else (DDB, S3, CF, API GW, Cognito) | $10–15 | $0.15 + $0.05 + $1.65 KMS = ~$2 | -$10 | Lower than audit |

# Implications for Sprint 5/6 savings projections

Re-anchored projections, using realized line items:

| Optimization | Realized savings estimate |
|---|---:|
| **Sprint 5** | |
| - VPC Flow Logs disable | <$0.30/month (already small in this account) |
| - Service Connect log retention | negligible |
| - ECR lifecycle | negligible |
| - DDB + S3 Gateway Endpoints | <$1/month direct, but cuts NAT data-transfer load |
| - AdminWeb access logs | $0.02/month |
| **Sprint 5 total** | **~$1–2/month** (mostly latency / ops hygiene, not cost) |
| **Sprint 6** | |
| - NAT 3→1 | **$66–68/month** (realized: 1 NAT GW ≈ $34/month at ap-south-1 list, so 2 fewer = ~$68) |
| - ECS desiredCount 2→1 (identity + rproxy) | **~$18/month** (realized Fargate pricing, not the audit's overstated $21) |
| **Sprint 6 total** | **~$84–86/month** |
| **Optional T7.5 — overnight scale-to-zero** | **~$10–13/month** (33% of $54 Fargate × 5h-out-of-15h-active window — realized math is lower than audit's $14–18) |

# Projected monthly cost ladder (revised against realized baseline)

| State | Estimated $/month |
|---|---:|
| Current realized | **$203.69** |
| + Sprint 5 (safe) | ~$202 |
| + Sprint 6.6 (NAT 3→1) | **~$135** |
| + Sprint 6.8 (ECS 2→1) | **~$117** |
| + Sprint 5 log + ECR + endpoint cleanup observed in Cost Explorer | ~$115 |
| + (Optional) Sprint 7.5 overnight scale-to-zero | **~$103** ← stretch ≤$100 close, may need additional trim |

**Verdict:** $100/month target is **on the edge**. The audit's projection of "≤$100 with margin" relied partly on the inflated Fargate baseline; with the realized number the headline savings ($84–86 from Sprint 6) take us from $203 to $117. To reach $100, either Sprint 7.5 (overnight scale-to-zero) needs to land, or one of the Phase 4 deferred items (rproxy elimination, NLB elimination) becomes necessary.

# Recommendation

Proceed with Sprint 5 + Sprint 6 as planned. **After** Sprint 6 lands and the realized cost stabilizes for 14 days, decide whether to:
- Land Sprint 7.5 (overnight scale-to-zero) for an additional $10–13/month if pilot operators tolerate the cold-start window, OR
- Accept ~$117/month as "good enough at pilot stage" and defer Phase 4 entirely until post-PMF.

The original $100 target was the right north star. With the realized baseline, $115–120/month is the realistic outcome of Sprint 5/6 alone, and $100–105 is achievable only with the optional overnight scale-to-zero.

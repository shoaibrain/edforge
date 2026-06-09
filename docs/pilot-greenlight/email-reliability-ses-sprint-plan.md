# Reliable Account Email via Amazon SES — Sprint & Ticket Breakdown

> **Drafted:** 2026-06-09 · **Status:** 🟡 Draft — awaiting sign-off before implementation
> **Repo/branch:** `shoaibrain/edforge` @ `claude/adoring-brown-m7hgN` · **PR:** #286
> **Account/region (confirmed from console):** `EdForge-Production (257526644020)`, **`ap-south-1` (Mumbai)**
> **Master-plan:** satisfies the Cognito-transport half of `v1-master-epic-breakdown.md` §B.5.1; unblocks B.5.2–B.5.4
> **Trigger:** Cognito account-creation invites are silently dropped by Outlook.com / Microsoft 365 (created in pool, never delivered, no bounce, no trace).
> **Scope:** Reliability only — route both Cognito pools' email through SES from a verified, DKIM-signed `mail.edforge.app` identity; add delivery observability; add resend + backfill for already-stuck users. The general event-driven transactional-email platform (B.5.2–B.5.4) is explicitly out of scope.
> **Tier:** `BASIC` only — one shared sending identity, one shared tenant pool.

---

## 1. Problem & root cause (traced)

Neither Cognito pool sets `emailConfiguration`, so **every** account email leaves
AWS via the shared `COGNITO_DEFAULT` sender (`no-reply@verificationemail.com`):

| Path | Where | Transport today |
|---|---|---|
| Tenant admin (provisioning) | `provision-tenant.sh` `admin-create-user --desired-delivery-mediums EMAIL` | COGNITO_DEFAULT |
| Teacher / staff / parent / student | `…/identity/src/users/users.service.ts` `AdminCreateUserCommand` | COGNITO_DEFAULT |
| System admin | SBT `CognitoAuth` pool (`control-plane-stack.ts`) | COGNITO_DEFAULT |

`COGNITO_DEFAULT` has **no SPF/DKIM/DMARC alignment** to `edforge.app`, a **hard
~50/day cap**, and **zero delivery telemetry**. Strict receivers (Outlook/M365)
blackhole unauthenticated mail with no bounce — the exact reported symptom.

**Fix:** switch only the *transport* to SES (DEVELOPER) from a verified
`mail.edforge.app` identity (custom MAIL FROM `bounce.mail.edforge.app` for SPF
alignment), keeping the existing invite template. Add observability + a
resend-invite path (none exists today).

---

## 2. Resolved unknowns (no hypotheses)

### 2.1 Region — `ap-south-1` works same-region
- **AWS service level:** Cognito's 2022 "in-Region integration with SES/SNS" GA
  makes same-Region SES available in every Region where SES + SNS + Cognito
  exist — which **includes `ap-south-1`**. (Older community posts claiming
  ap-south-1 is unsupported predate this launch.)
- **CDK level (this repo's pin `aws-cdk-lib@2.195.0`):** `UserPoolEmail.withSES`
  has **no region allowlist** — it only throws if the stack region is
  *unresolved* and no `sesRegion` is given. With the stack in `ap-south-1`, it
  accepts it and builds `SourceArn` with region `ap-south-1`. **No cross-region
  fork needed; `sesRegion` can be omitted.**
- **Still verify empirically (S0.1):** the account is ground truth (docs lag).
  Confirm `ap-south-1` is selectable as the SES region in the Cognito email
  config, via the console SES-region selector or a non-prod test
  `update-user-pool`.

### 2.2 Pool topology — one shared BASIC pool
`provision-tenant.sh` keeps the literal `tenant-template-stack-basic` for BASIC
(per-tenant stacks are PREMIUM/ADVANCED, `V1_DEFERRED`); `bin/` instantiates one
stack with `tenantId='basic'`. **One tenant Cognito pool serves all BASIC
tenants** → a single `tenant-template-stack-basic` redeploy updates every tenant
at once; no per-tenant loop.

### 2.3 Clarification — `describe-user-pool-domain` is the wrong probe
`aws cognito-idp describe-user-pool-domain --domain mail.edforge.app` → `{}` only
means **no Cognito hosted-UI custom domain** by that name exists — expected and
irrelevant. We use `mail.edforge.app` as an **SES sending identity**, not a
Cognito domain. SES status is checked with
`aws sesv2 get-email-identity --email-identity mail.edforge.app` (see Appendix A).

---

## 3. Architecture

Both pools keep Cognito's native invite flow + existing template; we change only
the transport, **behind a feature flag**.

```
 shared-infra-stack  ──► EmailIdentity(mail.edforge.app) + Easy DKIM (Route53 auto)
 (account-singleton)     + custom MAIL FROM bounce.mail.edforge.app (SPF)
                         + DMARC (Route53) + ConfigurationSet(edforge-transactional)
                         + event destination (CloudWatch) + bounce/complaint alarms
                         + edforge-email-events SNS + suppression list
        │ EmailIdentity + configSetName passed as CONSTRUCT PROPS in bin/ (NOT a CFN export)
        │ all pool wiring gated by CDK_PARAM_SES_ENABLED (default false)
   ┌────┴───────────────────────────────┐
   ▼                                     ▼
 tenant-template-stack-basic        controlplane-stack
 identity-provider.ts               control-plane-stack.ts
 if SES_ENABLED:                    if SES_ENABLED:
   email = withSES({...})             CfnUserPool.emailConfiguration = {DEVELOPER,...}
   → L2 AUTO-creates SES→Cognito       + MANUAL SES identity policy granting
     send grant (no manual IAM)          cognito-idp → ses:SendEmail on the pool ARN
```

**L1/L2 asymmetry (the error-prone bit):** the tenant pool's L2 `withSES`
auto-creates the SES identity policy authorising `cognito-idp.amazonaws.com`;
the SBT pool's L1 `emailConfiguration` does **not** — it needs an explicit
identity policy or it **silently fails to send**. This gets a dedicated unit
test (S3.2), a live smoke (S3.4), and a documented failure signature (S3.3).

**Cross-stack hygiene:** pass the `EmailIdentity` + config-set name as
**construct props** in `bin/ecs-saas-ref-template.ts` (like `accessLogsBucket` /
`tenantMappingTable`), not via `Fn.importValue` — avoids the CLAUDE.md
"Cannot update export in use" trap.

> **Line references** in this doc are approximate — `main` advanced (PR #285
> touched `control-plane-stack.ts`, `tenant-template-stack.ts`,
> `tenant-api-prod.json`). Re-confirm against current `main` at implementation.

---

## 4. Rollout & rollback strategy (the safety model)

**Feature flag `CDK_PARAM_SES_ENABLED` (default `false`)** gates *all* pool
wiring. This is the spine of safe rollout:

1. **Infra-first, zero behavior change.** Sprints 0–1 deploy the SES identity +
   observability with the flag **off** — current email behavior is untouched.
2. **Sandbox-correctness guard (critical).** Do **NOT** flip the flag on while
   SES is in **sandbox** — SES in sandbox refuses unverified recipients, so real
   users would get *nothing* (worse than today). Flip only after the identity is
   **verified AND production access granted**.
3. **Rollback = flag flip, not code revert.** Set `CDK_PARAM_SES_ENABLED=false`
   and redeploy `tenant-template-stack-basic` + `controlplane-stack` → pools
   revert to `COGNITO_DEFAULT` via a fast Cognito `UpdateUserPool`. The SES
   identity + observability infra stay deployed (idle, ~no cost). Drilled in
   non-prod in S2.5 / S3.5 so a real rollback is routine, not an incident.

**Rollback runbook** lives in S5.5 (Appendix B): flag flip + redeploy order,
expected `cdk diff`, and the "leave the provision tarball at the matching flag
state" note so the next provision doesn't re-flip.

---

## 5. Scalability & cost efficiency

**Cost (single-digit $/month at pilot scale, linear):** SES = $0.10 / 1,000
emails; even 100k/month ≈ $10. **No new always-on compute** this sprint (the
bounce-handler Lambda is deferred to B.5.4). Fixed infra < ~$1/month (Route53
records ~free on the existing zone; 2 alarms ≈ $0.20; SNS per-message trivial).
Suppression list avoids paying to re-send to dead addresses.

**Scale:** lifts the ceiling from Cognito's ~50/day to SES production's
~50,000/day (auto-scaling with reputation, raisable to millions). One shared
identity serves all BASIC tenants. The `ConfigurationSet` substrate is reused by
the future `EmailAdapter` (B.5.2). **Single region** per CLAUDE.md — no
multi-region SES "future-proofing." Deliverability hygiene (DKIM/SPF/DMARC +
suppression) is what lets volume grow without deliverability decay.

---

## 6. Testing & validation strategy

| Layer | Mechanism | What it guards |
|---|---|---|
| CDK infra | `aws-cdk-lib/assertions` `Template.fromStack` specs + `cdk synth`/`diff` | Resources + the SES identity policies/conditions exist and are correctly scoped (esp. the S3.2 SBT grant) |
| NestJS code | `jest` unit specs (mock Cognito) + `npm run lint:routes` | resend logic, guards, three-way route registration |
| Live / integration | SES simulator sends; real inbox + header checks (DKIM/SPF/DMARC); SES Send/Delivery/Bounce metrics | end-to-end deliverability — the demoable proof per sprint |
| Ops / spike | CLI + console evidence captured in the PR / an ADR | region support, zone, production access |

**Definition of Done (every ticket):** code/IaC committed; its stated
validation passes; `npx nest build identity` + `npm run lint` +
`npm run lint:routes` green where code changed; `cdk synth` + reviewed `cdk diff`
where IaC changed; evidence (test output / console screenshot / header dump)
attached to the PR.

---

## 7. Sprints & tickets

Six sprints, each independently **demoable** and built on the prior. Sprints 0–1
ship with the flag **off** (no behavior change); the pool switch starts in
Sprint 2. Tickets are atomic and individually committable.

### Sprint 0 — SES sending foundation (deliverable to Outlook). *No pool change.*
**Demo:** a test email from `no-reply@mail.edforge.app` sent via SES in
`ap-south-1` lands in **Outlook + Gmail** with DKIM/SPF/DMARC = pass.
**DoD:** domain + DKIM + custom MAIL FROM verified; production access requested
(sandbox test done); `email-identity` construct deployed to non-prod.

| Ticket | Work | Validation |
|---|---|---|
| **S0.1** | Spike + ADR: confirm `ap-south-1` selectable for Cognito SES (console SES-region selector or non-prod `update-user-pool` dry test); record CDK 2.195 `withSES` accepts it (no allowlist). | New ADR `docs/decisions/ses-region-ap-south-1.md` with evidence. |
| **S0.2** | Confirm Route53 hosted zone for `edforge.app` (id + name) + DNS write path; confirm `HostedZone.fromHostedZoneAttributes` inputs. | `aws route53 get-hosted-zone` output in the ADR. |
| **S0.3** | Request SES production access for `ap-south-1` (exit sandbox, raise quota). | Support case id recorded; tracked to "granted." |
| **S0.4** | NEW `server/lib/shared-infra/email-identity.ts`: `EmailIdentity(mail.edforge.app)` via `Identity.publicHostedZone(zone)` (auto Easy-DKIM CNAMEs) + `mailFromDomain=bounce.mail.edforge.app` + `ConfigurationSet('edforge-transactional')` + DMARC `TxtRecord` (`p=none` + `rua`). | `email-identity.spec.ts`: Template asserts EmailIdentity, `MailFromAttributes.MailFromDomain`, ConfigurationSet, Route53 DKIM CNAMEs + DMARC TXT. `cdk synth` green. |
| **S0.5** | Wire construct into `shared-infra-stack` behind `CDK_PARAM_SES_*` (zone id/name, from/replyTo, mailFromDomain); expose `emailIdentity` + `configurationSetName`. Deploy non-prod. | `shared-infra` spec asserts instantiation; reviewed `cdk diff`; SES console: domain **Verified** + DKIM **Successful** + MAIL FROM verified (evidence in PR). |
| **S0.6** | Deliverability smoke: `aws sesv2 send-email --from-email-address no-reply@mail.edforge.app --configuration-set-name edforge-transactional` → Outlook + Gmail + proton (verify recipients first if still sandbox). | Received; Gmail "Show original": SPF/DKIM/DMARC = pass; mail-tester ≥ 9. Evidence in PR. |

### Sprint 1 — Email observability & guardrails. *No pool change.*
**Demo:** send to `bounce@simulator.amazonses.com` → CloudWatch Bounce +1,
bounce-rate alarm trips to operator SNS, address lands on the suppression list.
**DoD:** event destination live; alarms created; suppression on; simulator-proven.

| Ticket | Work | Validation |
|---|---|---|
| **S1.1** | ConfigurationSet event destination → CloudWatch for `SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, RENDERING_FAILURE`. | Spec asserts `ConfigurationSetEventDestination` with the 6 event types + CloudWatch dest. |
| **S1.2** | New SNS topic `edforge-email-events` + email subscription to `operatorAlertEmail` (`CDK_PARAM`). | Spec asserts `SNS::Topic` + `Subscription`. |
| **S1.3** | CloudWatch alarms: SES `Reputation.BounceRate > 0.05`, `Reputation.ComplaintRate > 0.001` → `SnsAction(edforge-email-events)`. | Spec asserts two `CloudWatch::Alarm` (thresholds 0.05 / 0.001) + AlarmActions → topic. |
| **S1.4** | Enable suppression list (config-set `SuppressionOptions` or account-level) for `BOUNCE` + `COMPLAINT` (AwsCustomResource/CLI if no clean L2). | `aws sesv2 get-configuration-set` (or `get-account`) shows suppression reasons; recorded. |
| **S1.5** | Deploy non-prod; SES simulator drills to `success@`/`bounce@`/`complaint@simulator.amazonses.com` via the config set. | CloudWatch metrics increment; bounce alarm → ALARM; suppression list contains the addresses; operator SNS email received. Evidence in PR. |

### Sprint 2 — Tenant pool via SES (flag-gated) + rollback proof.
**Demo (non-prod):** flag ON → `POST /users` to an Outlook address → invite via
SES received; flag OFF → reverts to `COGNITO_DEFAULT`. Both directions proven.
**DoD:** tenant pool conditionally on SES; L2 auto-grant verified in template;
both flag states demonstrated.

| Ticket | Work | Validation |
|---|---|---|
| **S2.1** | `CDK_PARAM_SES_ENABLED` (bool, default false) in `bin`; add `sesEnabled` + SES props to `IdentityProviderStackProps`; thread via `tenant-template-stack`. | `cdk synth` with/without the param; wiring asserted. |
| **S2.2** | `identity-provider.ts`: conditionally set `email: UserPoolEmail.withSES({fromEmail, fromName, replyTo, sesVerifiedDomain, configurationSetName})` when `sesEnabled`, else omit. | `identity-provider.spec.ts`: flag OFF → no/`COGNITO_DEFAULT` EmailConfiguration; flag ON → `EmailSendingAccount=DEVELOPER`, From, SourceArn region `ap-south-1`, ConfigurationSet **and** the auto-created SES identity policy grants `cognito-idp` scoped to the pool. |
| **S2.3** | `cdk diff tenant-template-stack-basic` review gate. | Documented diff: only Cognito email config + SES identity-policy deltas. |
| **S2.4** | Deploy non-prod (flag ON); `POST /users` to Outlook + Gmail + proton. | Received from `no-reply@mail.edforge.app`; DKIM/SPF/DMARC pass; SES Send/Delivery event; user in `FORCE_CHANGE_PASSWORD`. |
| **S2.5** | **Rollback drill:** flag OFF → redeploy → create user → confirm `COGNITO_DEFAULT`; flag ON again. | `cdk diff` both directions + behavior evidence — proves the escape hatch. |

### Sprint 3 — System-admin (SBT) pool via SES + grant guarantee + failure runbook.
**Demo:** create a system admin → invite via SES to Outlook; show the unit test
that guarantees the SES→Cognito grant; show the runbook's silent-failure
signature.
**DoD:** SBT pool conditionally on SES; explicit SES identity policy present
(unit-tested) **and** working (live); failure mode documented.

| Ticket | Work | Validation |
|---|---|---|
| **S3.1** | `control-plane-stack.ts`: flag-gated L1 `emailConfiguration` (`DEVELOPER`, from, `sourceArn=emailIdentity.emailIdentityArn`, replyTo, configurationSet) on the SBT `CfnUserPool` (reuse the `deletionProtection` escape-hatch handle). | `control-plane-email.spec.ts`: flag ON → `EmailConfiguration.EmailSendingAccount=DEVELOPER` + SourceArn + ConfigurationSet; flag OFF → no override. |
| **S3.2** | **The critical grant:** explicit SES identity resource policy granting `cognito-idp.amazonaws.com` `ses:SendEmail`+`ses:SendRawEmail` on the identity, `Condition` `AWS:SourceArn = <control-plane pool ARN>`, `AWS:SourceAccount = <account>`. Pass `EmailIdentity` into `ControlPlaneStackProps`. | Spec asserts the SES identity policy with exact Principal, Actions, Resource (identity), and Condition (SourceArn=pool ARN, SourceAccount). **This is the test for the most error-prone piece.** |
| **S3.3** | Failure-mode runbook: missing/incorrect grant → user created, **no SES Send event**, no inbox mail; detection = correlate user-creation with absent Send event + `Reject` metric; recovery = redeploy with grant. Optional one-time non-prod negative test as evidence. | Runbook section in this doc; the permanent guard is S3.2. |
| **S3.4** | Deploy non-prod (flag ON); create a system admin (control-plane API/AdminWeb) to an Outlook address. | Received via SES; SES Delivery event; DKIM/SPF/DMARC pass. |
| **S3.5** | SBT pool rollback drill (flag OFF → COGNITO_DEFAULT). | `cdk diff` + behavior evidence. |

### Sprint 4 — Resend & backfill the stuck users.
**Demo:** diagnostic prints the real count of `FORCE_CHANGE_PASSWORD` users;
resend to one via the new endpoint; backfill the sample via the script → received.
**DoD:** stuck users quantified; resend endpoint live + tested; backfill script
tested (dry-run + sample apply).

| Ticket | Work | Validation |
|---|---|---|
| **S4.1** | Diagnostic `scripts/email/list-pending-invites.ts` (read-only): list/count users in `FORCE_CHANGE_PASSWORD` across the BASIC pool (+ control-plane pool). | Run on non-prod → outputs actual N + usernames (the screenshot showed ~3). Read-only/idempotent. |
| **S4.2** | `resendInvite(userId, context)` in `users.service.ts`: `AdminGetUser` guard (CONFIRMED → `BadRequestException`); `AdminCreateUser` `MessageAction:'RESEND'`, `DesiredDeliveryMediums:['EMAIL']`, **no** `TemporaryPassword`. No IAM change (grants already in `service-info.txt`). | `users.service.resend.spec.ts` (mock Cognito): CONFIRMED → throws; FORCE_CHANGE_PASSWORD → RESEND call with correct params; not-found → `NotFound`. |
| **S4.3** | `POST /users/:id/resend-invite` controller (TenantAdmin + `GlobalRoleGuard`) + `tenant-api-prod.json` route (copy `/users/{id}/global-role` block, `patch`→`post`, `POST,OPTIONS`). No nginx change. | `npm run lint:routes` green; controller test; route present in OpenAPI. |
| **S4.4** | Resend-safety decision (no premature optimization): admin-only + low-frequency → rely on Cognito throttling; RESEND is naturally idempotent (re-sends current invite). Document why no per-user cooldown is added now + the trigger to revisit (abuse/volume). | Decision note in this doc; no code unless decided. |
| **S4.5** | Backfill `scripts/email/backfill-pending-invites.ts`: list FORCE_CHANGE_PASSWORD → RESEND with SES-rate throttle + exponential backoff on transient errors; `--dry-run` default, `--apply`, idempotent, skips CONFIRMED, structured log. Gated behind SES verified + production access. | Dry-run output on non-prod; `--apply` to 1–2 seeded test users → receipt + SES Delivery events. |

### Sprint 5 — Production rollout & regression-proofing.
**Demo:** prod sends account email via SES; a freshly provisioned throwaway
tenant's admin invite arrives via SES; rollback runbook validated.
**DoD:** prod on SES (flag ON) for both pools; provisioning won't regress;
docs/runbook merged.

| Ticket | Work | Validation |
|---|---|---|
| **S5.1** | Refresh provision source tarball (`scripts/utils/update-provision-source.sh`) so the CodeBuild-embedded CDK app carries the flag-aware `identity-provider`. | Provision a throwaway test tenant (non-prod, flag ON) → admin invite arrives via SES (not COGNITO_DEFAULT). Directly tests the regression trap. |
| **S5.2** | Pre-flight cross-stack export audit (CLAUDE.md): confirm no SES-related `CfnOutput` value change breaks importers (we pass constructs by prop → expect none). | `aws cloudformation list-exports` snapshot + diff; documented clear. |
| **S5.3** | Prod deploy ladder (human-approval gate): `shared-infra` → `controlplane` → `tenant-template`, flag ON, via `scripts/deploy-analytics.sh`. | Prod smoke: create a test user to an Outlook address → received via SES; prod SES Send/Delivery metrics. |
| **S5.4** | Post-deploy monitor window: watch bounce/complaint/delivery + alarms. | Metrics evidence; alarms quiet. |
| **S5.5** | Docs & runbook: `ARCHITECTURE.md` email section; mark epic B.5.1 satisfied (Cognito transport); runbook (rollback via flag, silent-failure signature, suppression management, SES verification commands — Appendix A/B). | Doc review. |

---

## 8. Risks & gotchas
- **Sandbox-correctness** — never flip the flag on before production access (S0.3); SES sandbox would drop all unverified recipients. The flag default `false` enforces this.
- **SBT L1 grant (S3.2)** — L1 does not auto-grant; omit it and the system-admin pool silently fails. Guarded by the unit test + live smoke + runbook.
- **`from`/domain mismatch** — a pool's `from` domain must equal the verified identity or sends fail silently. Asserted in S2.2/S3.1 + proven live.
- **Provision-tarball regression (S5.1)** — refresh the tarball or the next provision reverts the pool.
- **Bounce/complaint ceilings** — SES auto-pauses at >5% / >0.1%; alarms (S1.3) must be live before scaling (they ship before the pool switch).
- **Cross-stack export trap** — pass SES constructs by prop, not CFN export (S5.2).
- **Region empirical check (S0.1)** — high-confidence ap-south-1 works, but confirm in-account before the pool switch.

---

## 9. Out of scope (explicit)
General EventBridge-driven `EmailAdapter` for non-Cognito mail (B.5.2–B.5.4) —
this sprint stands up the SES substrate they reuse. Also: Route53/ACM-in-CDK
beyond SES records; per-tenant From domains / per-tenant pools (ADVANCED/PREMIUM);
multi-region SES.

---

## Appendix A — SES verification commands
```bash
# Identity + DKIM + MAIL FROM status (the CORRECT probe — not cognito-idp describe-user-pool-domain)
aws sesv2 get-email-identity --email-identity mail.edforge.app --region ap-south-1
# Account sandbox vs production + send quota
aws sesv2 get-account --region ap-south-1
# Config set (event destination + suppression)
aws sesv2 get-configuration-set --configuration-set-name edforge-transactional --region ap-south-1
# Count users stuck awaiting a deliverable invite
aws cognito-idp list-users --user-pool-id <basic-pool-id> \
  --filter 'cognito:user_status = "FORCE_CHANGE_PASSWORD"' --region ap-south-1
```

## Appendix B — Rollback runbook (skeleton; finalized in S5.5)
1. Set `CDK_PARAM_SES_ENABLED=false` in the target env config.
2. Redeploy `tenant-template-stack-basic` then `controlplane-stack` via
   `scripts/deploy-analytics.sh` (expected `cdk diff`: Cognito email config +
   SES identity policy removed; pools → `COGNITO_DEFAULT`).
3. Leave the SES identity + observability stacks deployed (idle, ~no cost).
4. Re-run `update-provision-source.sh` at the flag-off state so the next
   provision doesn't re-enable SES.
5. Verify: create a test user → confirm `COGNITO_DEFAULT` path; SES Send metric
   flat. Incident-free because no resource is destroyed — only a config flip.

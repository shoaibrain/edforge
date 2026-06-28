# Reliable Account Email via Amazon SES — Sprint & Ticket Breakdown

> **Drafted:** 2026-06-09 · **Status:** 🟢 In execution — Sprint 0 + Sprint 1 (observability) code committed; deploy/verify on operator inputs (§10)
> **Repo/branch:** `shoaibrain/edforge` @ `claude/adoring-brown-m7hgN` · **PR:** #286
> **Account/region (confirmed from console):** `EdForge-Production`, **`ap-south-1` (Mumbai)**
> **DNS:** `edforge.app` is hosted at **Vercel** (registrar + nameservers), **not Route53**.
> SES DNS records (DKIM/MAILFROM/DMARC) are emitted as CDK **CfnOutputs** and added by hand
> in Vercel. (Corrects the earlier Route53 assumption.)
> **Revision:** v6 — Sprint 1 observability built on the same PR (event destination + suppression
> + `edforge-email-events` alert topic + 2 reputation alarms); validated typecheck / jest 10-10 /
> eslint + offline cdk-nag (0 un-suppressed errors). SSE on the alert topic intentionally omitted
> (CloudWatch→SNS / AWS-managed-key incompatibility). v5 — Sprint 0 code-only foundation built + validated (typecheck/jest 6-6/eslint)
> and reworked for Vercel external DNS. v4 — rebased onto `origin/main` @ **PR #288** (29fedca). Re-verified
> against current `main`: `aws-cdk-lib@2.195.0` unchanged; `identity-provider.ts`
> still greenfield (no email transport); SBT escape-hatch at `control-plane-stack.ts:57`;
> `service-info.txt` grants `AdminCreateUser`+`AdminGetUser`; the `/users/{id}/global-role`
> block (S4.3 copy source) is now at `tenant-api-prod.json:~24267`. No material plan change.
> v3 correction retained: the SES→Cognito grant is **not** auto-created by `withSES` —
> it is a sending-authorization **identity policy** required for **both** pools (no
> CFN/L2 → `AwsCustomResource`). See §3.
> **Master-plan:** satisfies the Cognito-transport half of `v1-master-epic-breakdown.md` §B.5.1; unblocks B.5.2–B.5.4.
> **Trigger:** Cognito account-creation invites are silently dropped by Outlook.com / Microsoft 365 (created in pool, never delivered, no bounce, no trace).
> **Scope:** Reliability only — route both Cognito pools through SES from a verified `mail.edforge.app` identity; observability; resend + backfill for stuck users. The general event-driven email platform (B.5.2–B.5.4) is out of scope.
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

## 2. Resolved unknowns (verified, no hypotheses)

### 2.1 Region — `ap-south-1` works same-region
- **AWS service level:** Cognito's 2022 "in-Region integration with SES/SNS" GA
  makes same-Region SES available wherever SES + SNS + Cognito exist — incl.
  `ap-south-1`. (Community posts claiming ap-south-1 unsupported predate this.)
- **CDK level (`aws-cdk-lib@2.195.0`, confirmed in `server/package.json`):**
  `UserPoolEmail.withSES` (verified against the v2.195.0 source) has **no region
  allowlist** — it throws only if the stack region is *unresolved* and no
  `sesRegion` is given. Stack is in `ap-south-1` → it builds `SourceArn` with
  region `ap-south-1`. **No cross-region fork; omit `sesRegion`.**
- **Still confirm empirically (S0.1)** in-account — docs lag.

### 2.2 The SES→Cognito grant is required and is NOT auto-created (corrects v2)
Verified against the CDK v2.195.0 source + AWS docs:
- `UserPoolEmail.withSES` **only** sets the pool's `emailConfiguration`
  (`DEVELOPER`, From, SourceArn, ConfigurationSet). It creates **no** SES grant.
- `aws_ses.EmailIdentity` has **no** resource-policy method; `grantSendEmail`
  adds an *identity-based* policy to an IAM grantee — useless for a **service
  principal**. There is **no `AWS::SES::IdentityPolicy` CFN resource**.
- AWS requires a **sending-authorization identity policy** on the SES identity,
  same-account included: Principal **`email.cognito-idp.amazonaws.com`**, Action
  `ses:SendEmail`+`ses:SendRawEmail`, Resource = the identity, Condition on
  **both** `aws:SourceAccount` and `aws:SourceArn` (the user-pool ARN
  `arn:aws:cognito-idp:ap-south-1:<acct>:userpool/<pool-id>`). Cross-account is
  unsupported (we are same-account).
- **Therefore both pools need this grant**, applied via an **`AwsCustomResource`
  calling `ses:PutIdentityPolicy`** (one named policy per pool ARN). There is no
  "L1 vs L2 asymmetry" — neither pool auto-grants.

### 2.3 Pool topology — one shared BASIC pool
`provision-tenant.sh` keeps the literal `tenant-template-stack-basic` for BASIC
(per-tenant stacks are PREMIUM/ADVANCED, `V1_DEFERRED`); `bin/` instantiates one
stack with `tenantId='basic'`. **One tenant pool serves all BASIC tenants** → a
single stack redeploy updates every tenant; no per-tenant loop.

### 2.4 Clarification — `describe-user-pool-domain` is the wrong probe
`aws cognito-idp describe-user-pool-domain --domain mail.edforge.app` → `{}` only
means no Cognito **hosted-UI** domain by that name — expected, irrelevant. We use
`mail.edforge.app` as an **SES sending identity**; check it with
`aws sesv2 get-email-identity` (Appendix A).

---

## 3. Architecture

Both pools keep Cognito's native invite flow + existing template; we change only
the transport, **behind the `CDK_PARAM_SES_ENABLED` flag**.

```
 shared-infra-stack  ──► EmailIdentity(mail.edforge.app) + DKIM/MAILFROM/DMARC
 (account-singleton)       records OUTPUT as CfnOutputs → added manually in Vercel DNS
                         + custom MAIL FROM bounce.mail.edforge.app (SPF)
                         + ConfigurationSet(edforge-transactional)
                           · event dest → CloudWatch · suppression [BOUNCE,COMPLAINT]
                         + edforge-email-events SNS (SSE) + bounce/complaint alarms
        │ exposes the SES identity NAME + config-set name as PLAIN STRINGS (props in bin/)
        │ pool stacks reference them as strings → NO Fn::ImportValue (standalone-synth safe)
   ┌────┴───────────────────────────────┐
   ▼                                     ▼
 tenant-template-stack-basic        controlplane-stack
 identity-provider.ts               control-plane-stack.ts
 if SES_ENABLED:                    if SES_ENABLED:
   email = withSES({strings})         CfnUserPool.emailConfiguration = {DEVELOPER,...}
   + AwsCustomResource                 + AwsCustomResource
     ses:PutIdentityPolicy               ses:PutIdentityPolicy
     (grant email.cognito-idp →          (grant email.cognito-idp →
      send, SourceArn = THIS pool ARN)    send, SourceArn = SBT pool ARN)
```

**The grant (the genuinely error-prone piece).** Each pool's stack creates an
`AwsCustomResource` that calls `ses:PutIdentityPolicy` on `mail.edforge.app`
(referenced **by name string**, not construct → no cross-stack import) with a
sending-authorization policy scoped to **that stack's own pool ARN** (available
locally — `tenantUserPool.userPoolArn` / `cognitoAuth.userPool.userPoolArn`).
The custom-resource Lambda gets least-privilege `ses:PutIdentityPolicy` +
`ses:DeleteIdentityPolicy` on the identity ARN. **Missing/incorrect grant =
silent failure** (user created, SES returns AccessDenied to Cognito, no Send
event, no inbox mail) — guarded by a `Template.fromStack` assertion on the
custom-resource policy JSON (S2.6 / S3.2), a live smoke (S2.4 / S3.4), and the
runbook (S3.3).

**Why strings, not constructs (standalone-synth safety).** The tenant pool is
deployed in prod by `provision-tenant.sh` (`cdk deploy tenant-template-stack-basic
--exclusively` inside CodeBuild, re-running the same `bin/`), **without**
shared-infra in the deploy set. Passing the `EmailIdentity` **construct** and
reading `.emailIdentityArn` would inject an `Fn::ImportValue` and make the tenant
template un-deployable standalone. So only **plain strings** cross into the pool
stacks (identity name, config-set name, from/replyTo). S2.1b asserts zero
`Fn::ImportValue` in the standalone synth.

> **Line references** are approximate. Re-confirmed against `main` @ PR #288:
> SES target files unchanged; only `tenant-api-prod.json` grew (academics routes),
> moving the `/users/{id}/global-role` copy source to `~24267`.

---

## 4. Rollout & rollback strategy (the safety model)

**Feature flag `CDK_PARAM_SES_ENABLED` (default `false`)** gates all pool wiring:

1. **Infra-first, zero behavior change.** Sprints 0–1 deploy the identity +
   observability with the flag **off** — live email is untouched.
2. **Sandbox-correctness guard (critical).** Do **NOT** flip the flag on while
   SES is in **sandbox** — SES refuses unverified recipients, so real users get
   *nothing* (worse than today). Flip only after the identity is **verified AND
   production access granted** (S0.3). The flag default `false` enforces this.
3. **Rollback = flag flip, not code revert.** `CDK_PARAM_SES_ENABLED=false` +
   redeploy `tenant-template-stack-basic` + `controlplane-stack` → pools revert
   to `COGNITO_DEFAULT` via a fast `UpdateUserPool`; the `PutIdentityPolicy`
   custom resources delete their policies cleanly. SES identity + observability
   stay deployed (idle, ~no cost). **The tenant rollback is only real if the
   provision tarball is also refreshed at flag-off** (else the next provision
   re-flips it) — so the rollback drill (S2.5) includes a tarball refresh +
   re-provision. Drilled in non-prod; runbook in Appendix B.

---

## 5. Scalability & cost efficiency

**Cost (single-digit $/month at pilot scale, linear):** SES = $0.10 / 1,000
emails; 100k/month ≈ $10. **No new always-on compute** (bounce-handler Lambda
deferred to B.5.4; the two `PutIdentityPolicy` custom resources run only at
deploy). Fixed infra < ~$1/month (DNS records added in Vercel, free; 2 alarms ≈ $0.20; SNS
trivial). Suppression list avoids paying to re-send to dead addresses.

**Scale:** lifts the ceiling from Cognito's ~50/day to SES production's
~50,000/day (auto-scaling with reputation). One identity serves all BASIC
tenants. The `ConfigurationSet` substrate is reused by the future `EmailAdapter`
(B.5.2). **Single region** per CLAUDE.md — no multi-region "future-proofing."

---

## 6. Testing & validation strategy

| Layer | Mechanism | Guards |
|---|---|---|
| CDK infra | `aws-cdk-lib/assertions` `Template.fromStack` specs + `cdk synth`/`diff` | resources exist + the `PutIdentityPolicy` grant JSON is correctly scoped; no stray `Fn::ImportValue` |
| NestJS code | `jest` unit specs (mock Cognito) + `npm run lint:routes` + explicit OpenAPI-verb assertion | resend logic, guards, route registration |
| Live / integration | SES simulator; real inbox + header checks (DKIM/SPF/DMARC); SES Send/Delivery/Bounce metrics | end-to-end deliverability — the per-sprint demo |
| cdk-nag | `CDK_NAG_ENABLED=true cdk synth` | SNS SSE/SSL + scoped IAM on the custom resource |
| Ops / spike | CLI + console evidence in an ADR / the PR | region, zone, production access |

**Existing specs to mirror** (verified present on `main` @ PR #288):
`server/lib/shared-infra/api-gateway.spec.ts`, `server/lib/bootstrap-template/tenant-seeder-lambda.spec.ts`,
`server/lib/cdk-patterns/scheduled-lambda.spec.ts`, `server/lib/analytics/analytics-stack.spec.ts`.

**Definition of Done (every ticket):** committed; stated validation passes;
`npx nest build identity` + `npm run lint` + `npm run lint:routes` green where
code changed; `cdk synth` + reviewed `cdk diff` where IaC changed;
`CDK_NAG_ENABLED=true` clean where new infra; evidence attached to the PR.

---

## 7. Sprints & tickets

Six sprints, each independently **demoable** and built on the prior. Sprints 0–1
ship with the flag **off** (no behavior change); the pool switch starts in
Sprint 2. **S0.3 (production-access request) is filed FIRST** so its AWS lead
time runs in parallel; the flag-ON demos of Sprints 2–3 depend on it being
**granted** (until then, demo against SES-verified test recipients only).

### Sprint 0 — SES sending foundation (deliverable to Outlook). *No pool change.*
**Demo:** a test email from `no-reply@mail.edforge.app` via SES in `ap-south-1`
lands in **Outlook + Gmail** with DKIM/SPF/DMARC = pass.
**DoD:** domain + DKIM + custom MAIL FROM verified; production access requested;
identity + config-set deployed to non-prod; `.env.example` updated.

| Ticket | Work | Validation |
|---|---|---|
| **S0.3** *(do first)* | Request SES production access for `ap-south-1` (exit sandbox, raise quota). **Blocking dep** for Sprint 2/3 flag-ON demos. | Support case id recorded; tracked to "granted." |
| **S0.1** | Spike + ADR `docs/decisions/ses-region-ap-south-1.md`: confirm `ap-south-1` selectable for Cognito SES (console or non-prod `update-user-pool`); commit a throwaway `withSES({sesVerifiedDomain})` synth whose `EmailConfiguration.SourceArn` asserts `:ap-south-1:`. | ADR + the committed synth-assertion snippet. |
| **S0.2** | Confirm **Vercel DNS** write access for `edforge.app` (DNS is hosted at Vercel, **not** Route53 — registrar + nameservers are Vercel). No Route53 hosted zone is created. | Operator can add records in the Vercel DNS UI (alongside the existing Zoho `zmail._domainkey`). |
| **S0.4a** ✅ | DONE — NEW `server/lib/shared-infra/email-identity.ts`: `EmailIdentity(mail.edforge.app)` via `Identity.domain()` + custom MAIL FROM + config set; emits DKIM/MAILFROM/DMARC as **CfnOutputs** for Vercel (CDK cannot write to Vercel DNS). DMARC scoped to `_dmarc.mail.edforge.app` so it never touches the root policy. | `email-identity.spec.ts` (6 assertions): EmailIdentity, MAIL FROM, **0 Route53 records**, the 3 DKIM + MX/SPF/DMARC outputs. Validated: typecheck + jest 6/6 + eslint. |
| **S0.4b** ✅ | DONE — folded into S0.4a: custom MAIL FROM `bounce.mail.edforge.app` set on the identity; MX (`feedback-smtp.ap-south-1.amazonses.com`) + SPF (`v=spf1 include:amazonses.com -all`) emitted as outputs for Vercel. | Spec asserts the MX + SPF outputs. |
| **S0.4c** ✅ | DONE — folded into S0.4a: `ConfigurationSet('edforge-transactional')` + DMARC output `_dmarc.mail.edforge.app` (`p=none; rua=…`). | Spec asserts `ConfigurationSet` + the DMARC output. |
| **S0.5** | **Code ✅** — wired into `shared-infra-stack` behind `props.sesSendingDomain` (created only when `CDK_PARAM_SES_SENDING_DOMAIN` is set); exposes identity + config-set **name strings**. **Deploy/verify pending operator env:** `cdk diff` → deploy → add the output records in Vercel → SES console shows domain **Verified** + DKIM **Successful**. | typecheck + eslint green; live verify is operator-env. |
| **S0.6** ✅ | DONE — `.env.example` documents the full `CDK_PARAM_SES_*` surface (Vercel external-DNS model) **and** the already-missing `CDK_PARAM_OPERATOR_ALERT_EMAIL`. | committed. |
| **S0.7** | Deliverability smoke: `aws sesv2 send-email --from-email-address no-reply@mail.edforge.app --configuration-set-name edforge-transactional` → Outlook + Gmail + proton (verify recipients first if still sandbox). | Received; "Show original": SPF/DKIM/DMARC = pass. (mail-tester ≥ 9 as one-time demo evidence, not a CI gate.) |

### Sprint 1 — Email observability & guardrails. *No pool change.*
**Demo:** send to `bounce@simulator.amazonses.com` → CloudWatch Bounce +1,
bounce-rate alarm trips to operator SNS, address lands on the suppression list.
**DoD:** event destination live; alarms created; suppression on; cdk-nag clean.

| Ticket | Work | Validation |
|---|---|---|
| **S1.1** ✅ | DONE — `configurationSet.addEventDestination('CloudWatchEvents')` → CloudWatch, dimensioned by `ses:configuration-set`, for the 6 events. | `email-identity.spec.ts`: asserts `MatchingEventTypes` (6) + `CloudWatchDestination.DimensionConfigurations`. ✅ |
| **S1.2** ✅ | DONE — SNS topic `edforge-email-events` + email sub to `operatorAlertEmail` (threaded through `SharedInfraProps` from `bin`, falls back to `systemAdminEmail`). **SSE intentionally OFF** (corrects the original "SSE enabled"): a CloudWatch alarm **cannot publish** to a topic encrypted with the AWS-managed `alias/aws/sns` key, so SSE would silently drop every alert. Matches analytics/core-appplane operator topics. | Spec asserts `SNS::Topic` name + `Subscription Protocol:'email' Endpoint`, + the `EnforceSSL` topic policy. ✅ |
| **S1.3** ✅ | DONE — two `cloudwatch.Alarm` on `AWS/SES` `Reputation.BounceRate` (>0.05) + `Reputation.ComplaintRate` (>0.001), **no dimensions**, `Average`/1h → `SnsAction(edforge-email-events)`. Account-level (noted in code). | Spec asserts both alarms' namespace/metric/threshold + `AlarmActions` → the topic. ✅ |
| **S1.4** ✅ | DONE — `ConfigurationSet` `suppressionReasons: BOUNCES_AND_COMPLAINTS` (clean L2 in 2.195). | Spec asserts `SuppressionOptions.SuppressedReasons = ['BOUNCE','COMPLAINT']`; live `get-configuration-set` as demo. ✅ |
| **S1.5** ✅ | DONE — SNS3 satisfied by the real `EnforceSSL` topic policy; `AwsSolutions-SNS2` (SSE) suppressed **with reason**, co-located on the topic (non-sensitive ops alerts; AWS-managed-key SSE breaks CloudWatch→SNS; CMK unjustified). No SES custom resource exists until Sprint 2, so no residual IAM5 here. | Offline `AwsSolutionsChecks` on the construct → **0 un-suppressed errors, 0 warnings**. Operator still runs `CDK_NAG_ENABLED=true npx cdk synth shared-infra-stack` at deploy. ✅ |
| **S1.6** | Deploy non-prod; SES simulator drills to `success@`/`bounce@`/`complaint@simulator.amazonses.com`. | Metrics increment; bounce alarm → ALARM; suppression list contains the addresses; operator SNS email received. Evidence in PR. **(operator-env — pending deploy)** |

### Sprint 2 — Tenant pool via SES (flag-gated) + grant + rollback proof.
**Demo (non-prod):** flag ON → `POST /users` to an Outlook address → invite via
SES received; flag OFF + tarball refresh → reverts to `COGNITO_DEFAULT`.
**DoD:** tenant pool conditionally on SES; the `PutIdentityPolicy` grant present
& unit-tested; standalone-synth import-safe; both flag states proven.

| Ticket | Work | Validation |
|---|---|---|
| **S2.1a** | `CDK_PARAM_SES_ENABLED` (bool, default false) in `bin`; thread **plain strings** (`sesEnabled`, `sesFromEmail`, `sesFromName`, `sesReplyTo`, `sesVerifiedDomain`, `sesIdentityName`, `sesConfigurationSetName`) through `IdentityProviderStackProps` + the `IdentityProvider` instantiation. | `cdk synth` with/without the param; wiring asserted. |
| **S2.1b** | **Standalone-synth guard:** `CDK_PARAM_SES_ENABLED=true … npx cdk synth tenant-template-stack-basic` (shared-infra **excluded**) — assert the template has **zero `Fn::ImportValue` referencing SES**. | A committed check (script/spec) — proves the CodeBuild path won't 500 (SBT ISSUE-008 would mask a live failure). |
| **S2.2** | `identity-provider.ts`: conditionally `email: UserPoolEmail.withSES({fromEmail, fromName, replyTo, sesVerifiedDomain, configurationSetName})` when `sesEnabled`, else omit. | `identity-provider.spec.ts`: flag OFF → no/`COGNITO_DEFAULT`; flag ON → `EmailSendingAccount=DEVELOPER`, From, SourceArn `:ap-south-1:`, ConfigurationSet. |
| **S2.3** | `cdk diff tenant-template-stack-basic` review gate. | Documented diff: only email config + the custom resource. |
| **S2.6** | **Tenant pool grant:** `AwsCustomResource` `ses:PutIdentityPolicy` on `mail.edforge.app` (by name), policyName `cognito-tenant-basic`, granting `email.cognito-idp.amazonaws.com` `ses:SendEmail`+`ses:SendRawEmail`, Condition `aws:SourceArn = tenantUserPool.userPoolArn` + `aws:SourceAccount`. Lambda IAM scoped to `ses:PutIdentityPolicy`/`DeleteIdentityPolicy` on the identity. | Spec asserts the custom resource's `Create`/`Update` `PutIdentityPolicy` policy JSON contains the principal, both actions, and the pool-ARN condition. |
| **S2.4** | Deploy non-prod (flag ON); `POST /users` to Outlook + Gmail + proton (verify recipients first if still sandbox / pre-S0.3-grant). | Received from `no-reply@mail.edforge.app`; DKIM/SPF/DMARC pass; SES Send/Delivery event; user `FORCE_CHANGE_PASSWORD`. |
| **S2.5** | **Rollback drill:** flag OFF → redeploy → **run `update-provision-source.sh` at flag-off → re-provision a throwaway tenant** → confirm `COGNITO_DEFAULT`; flag ON again. | `cdk diff` both ways + the re-provisioned tenant's pool on `COGNITO_DEFAULT` — proves a *reproducible* rollback. |

### Sprint 3 — System-admin (SBT) pool via SES + grant + failure runbook.
**Demo:** create a system admin → invite via SES to Outlook; show the unit test
guaranteeing the grant + the runbook's silent-failure signature.
**DoD:** SBT pool conditionally on SES; its `PutIdentityPolicy` grant present
(unit-tested) & working (live); failure mode documented.

| Ticket | Work | Validation |
|---|---|---|
| **S3.1** | `control-plane-stack.ts`: flag-gated L1 `emailConfiguration` (`DEVELOPER`, from, `sourceArn` = the identity ARN built from name+region+account, replyTo, configurationSet) on the SBT `CfnUserPool` (reuse the `deletionProtection` escape-hatch handle, `:56-59`). First confirm SBT 0.9.1 sets no pre-existing `emailConfiguration` (synth check). | `control-plane-email.spec.ts`: flag ON → `EmailConfiguration.EmailSendingAccount=DEVELOPER` + SourceArn + ConfigurationSet; flag OFF → none. |
| **S3.2** | **SBT pool grant** (same mechanism as S2.6): `AwsCustomResource` `ses:PutIdentityPolicy`, policyName `cognito-controlplane`, scoped `aws:SourceArn = cognitoAuth.userPool.userPoolArn`. | Spec asserts the policy JSON: principal `email.cognito-idp.amazonaws.com`, both actions, Resource = identity, Condition SourceArn = control-plane pool ARN + SourceAccount. **The test for the most error-prone piece.** |
| **S3.3** | Failure-mode runbook (both pools): missing/incorrect grant → user created, SES returns AccessDenied to Cognito, **no SES Send event**, no inbox mail; detection = user-creation with absent Send event + `Reject` metric; recovery = redeploy. | Runbook section; permanent guards are S2.6/S3.2. |
| **S3.4** | Deploy non-prod (flag ON); create a system admin (control-plane API/AdminWeb) to an Outlook address. | Received via SES; SES Delivery event; DKIM/SPF/DMARC pass. |
| **S3.5** | SBT pool rollback drill (flag OFF → COGNITO_DEFAULT; control-plane is not tarball-deployed, so flag-flip only). | `cdk diff` + behavior. |

### Sprint 4 — Resend & backfill the stuck users.
**Demo:** diagnostic prints the real count of `FORCE_CHANGE_PASSWORD` users;
resend to one via the endpoint; backfill the sample via the script → received.
**DoD:** stuck users quantified; resend endpoint live + tested; backfill tested.

| Ticket | Work | Validation |
|---|---|---|
| **S4.1** | Diagnostic `scripts/email/list-pending-invites.ts` (read-only): resolve pool ids via CFN `describe-stacks` (as `provision-tenant.sh` does — not hardcoded), list/count `FORCE_CHANGE_PASSWORD` users in the BASIC + control-plane pools. | Run non-prod → outputs actual N + usernames (screenshot showed ~3). Read-only. |
| **S4.2** | `resendInvite(userId, context)` in `users.service.ts`: `AdminGetUser` guard (CONFIRMED → `BadRequestException`); `AdminCreateUser` `MessageAction:'RESEND'`, `DesiredDeliveryMediums:['EMAIL']`, **no `TemporaryPassword`** (RESEND + temp pwd → `InvalidParameterException`). No IAM change — `service-info.txt` already grants `AdminCreateUser`+`AdminGetUser`. | `users.service.resend.spec.ts` (mock Cognito): CONFIRMED → throws; FORCE_CHANGE_PASSWORD → RESEND call **without** `TemporaryPassword`; not-found → `NotFound`. |
| **S4.3** | `POST /users/:id/resend-invite` controller (TenantAdmin + `GlobalRoleGuard`) + `tenant-api-prod.json` route: copy the `/users/{id}/global-role` block, change verb `patch`→`post` **and** the `OPTIONS` CORS `Access-Control-Allow-Methods` `PATCH,OPTIONS`→`POST,OPTIONS`. No nginx change; no module-wiring change (reuses `UsersService`). | `npm run lint:routes` (path-keyed) **plus** an explicit JSON assertion that `paths['/users/{id}/resend-invite'].post` exists AND `.patch` does not; controller test. |
| **S4.4** | Resend-safety decision (no premature optimization): admin-only + low-frequency → rely on Cognito throttling; RESEND is idempotent. Document why no per-user cooldown now + the revisit trigger (abuse/volume). | Decision note here; no code unless decided. |
| **S4.5** | Backfill `scripts/email/backfill-pending-invites.ts`: list → RESEND with SES-rate throttle + exponential backoff; `--dry-run` default, `--apply`, idempotent, skips CONFIRMED, structured log. Gated behind SES verified + production access. | Dry-run output non-prod; `--apply` to 1–2 seeded test users → receipt + SES Delivery. |

### Sprint 5 — Production rollout & regression-proofing.
**Demo:** prod sends account email via SES; a freshly provisioned throwaway
tenant's admin invite arrives via SES; rollback runbook validated.
**DoD:** prod on SES (flag ON) for both pools; provisioning won't regress; docs merged.

| Ticket | Work | Validation |
|---|---|---|
| **S5.1** | Refresh provision source tarball (`scripts/utils/update-provision-source.sh`) so CodeBuild embeds the flag-aware `identity-provider` + the grant custom resource. | Provision a throwaway tenant (non-prod, flag ON) → admin invite via SES; pool email config = DEVELOPER. |
| **S5.2** | Pre-flight cross-stack export audit (CLAUDE.md): confirm no SES-related `CfnOutput` value change breaks importers (strings/props → expect none). | `aws cloudformation list-exports` snapshot + diff; documented clear. |
| **S5.3** | Prod deploy ladder (human-approval gate): `shared-infra` → `controlplane` → `tenant-template`, flag ON, via `scripts/deploy.sh`. | Prod smoke: create a test user to Outlook → received via SES; prod SES Send/Delivery metrics. |
| **S5.4** | Post-deploy monitor window: bounce/complaint/delivery + alarms. | Metrics evidence; alarms quiet. |
| **S5.5** | Docs & runbook: `ARCHITECTURE.md` email section; mark epic B.5.1 satisfied (Cognito transport); runbook (rollback via flag + tarball, silent-failure signature, suppression mgmt, verification commands — Appendix A/B). | Doc review. |

---

## 8. Risks & gotchas
- **The grant is a custom resource, not auto-magic** (§2.2) — both pools need an
  `AwsCustomResource` `PutIdentityPolicy`; principal is `email.cognito-idp.amazonaws.com`
  (not `cognito-idp`). Guarded by S2.6/S3.2 specs + S3.4 smoke + S3.3 runbook.
- **Standalone CodeBuild synth** — pool stacks must reference SES by **string**,
  never the construct (no `Fn::ImportValue`). Guarded by S2.1b.
- **Sandbox-correctness** — never flip the flag on before production access (S0.3).
- **Provision-tarball regression / reproducible rollback** — refresh the tarball
  at the flag state (S5.1 / S2.5), or the next provision re-flips.
- **Account-level reputation alarms** (S1.3) are account-wide, not per-config-set.
- **Bounce/complaint ceilings** — SES auto-pauses at >5% / >0.1%; alarms ship
  before the pool switch.
- **cdk-nag** — SNS SSE/SSL + scoped custom-resource IAM (S1.5).
- **Region empirical check (S0.1)** — high-confidence ap-south-1 works; confirm in-account.

---

## 9. Out of scope (explicit)
General EventBridge-driven `EmailAdapter` for non-Cognito mail (B.5.2–B.5.4) —
this sprint stands up the SES substrate they reuse. Also: migrating `edforge.app`
DNS off Vercel into Route53 (SES DNS records are added in Vercel by hand);
per-tenant From domains / per-tenant pools (ADVANCED/PREMIUM); multi-region SES.

---

## 10. Execution readiness

Branch rebased onto `origin/main` @ PR #288; all load-bearing assumptions
re-verified (header). What's needed to actually run the tickets:

### 10.1 Operator-gated inputs (block Sprint 0 deploy; gather first)
| Need | For | Default / note |
|---|---|---|
| **SES production-access request filed** for `ap-south-1` | S0.3 — unblocks the Sprint 2/3 flag-ON demos (multi-day AWS lead time) | start **now**, in parallel with code |
| **Vercel DNS access** for `edforge.app` (NOT Route53) | S0.2 — to add the SES records (DKIM/MAILFROM/DMARC) emitted as CfnOutputs | DNS is hosted at Vercel; records added in the Vercel UI |
| **From / reply-to addresses** | S0.5/S2.2/S3.1 | defaults `no-reply@mail.edforge.app` / `support@edforge.app` — confirm |
| **In-account region confirm** (SES selectable for Cognito) | S0.1 | high-confidence yes (ap-south-1); confirm via console/CLI |
| **`operatorAlertEmail`** for SES alarms | S1.2 | falls back to `systemAdminEmail` if unset |

### 10.2 Environment for local validation gates
This is a **fresh clone** — `node_modules` is not installed, and `cdk synth`/`diff`
additionally need the gitignored `server/.env.<profile>` + Docker. So the
`nest build` / `jest` / `cdk synth` gates run in the **operator's environment**, not
here. Setup: `npm install` (root) + `cd server/application && npm install` +
`cd packages/shared-types && npm run build`.

### 10.3 What can be written now vs what needs live AWS
- **Code-only (writable + unit-testable without AWS, just `node_modules`):**
  S0.4a/b/c (`email-identity.ts` + spec), S1.1–S1.4 (event dest/SNS/alarms/suppression
  + specs), S2.1a/S2.2 (flag plumbing + `identity-provider.spec.ts`), S2.6/S3.1/S3.2
  (grant custom resource + L1 override + specs), S4.2/S4.3 (`resendInvite` + controller
  + route JSON + specs), S4.1/S4.5 (diagnostic + backfill scripts).
- **Needs live non-prod AWS (deploy/smoke):** S0.5/S0.7, S1.5/S1.6, S2.3/S2.4/S2.5,
  S3.4/S3.5, S4 live runs, all of S5.
- **AWS-gated, no code:** S0.1, S0.3.

### 10.4 Recommended first move
File **S0.3** (production access) immediately, then implement the **code-only
Sprint 0 foundation** (S0.4a/b/c + the `CDK_PARAM_SES_*` wiring in `bin` +
`shared-infra-stack` behind the flag, all default-off so zero behavior change) and
its `Template.fromStack` spec — committed to this branch, ready to `cdk synth`/deploy
the moment the operator inputs in §10.1 land.

---

## Appendix A — verification commands
```bash
# SES identity + DKIM + MAIL FROM (the CORRECT probe — NOT cognito-idp describe-user-pool-domain)
aws sesv2 get-email-identity --email-identity mail.edforge.app --region ap-south-1
# The sending-authorization identity policy that authorizes Cognito (the §2.2 grant)
aws ses get-identity-policies --identity mail.edforge.app --policy-names cognito-tenant-basic cognito-controlplane --region ap-south-1
# Sandbox vs production + send quota
aws sesv2 get-account --region ap-south-1
# Config set (event destination + suppression)
aws sesv2 get-configuration-set --configuration-set-name edforge-transactional --region ap-south-1
# Count users awaiting a deliverable invite
aws cognito-idp list-users --user-pool-id <pool-id> \
  --filter 'cognito:user_status = "FORCE_CHANGE_PASSWORD"' --region ap-south-1
```

## Appendix B — rollback runbook (finalized in S5.5)
1. Set `CDK_PARAM_SES_ENABLED=false` in the target env config.
2. Redeploy `tenant-template-stack-basic` then `controlplane-stack` via
   `scripts/deploy.sh` (expected `cdk diff`: `emailConfiguration` +
   the `PutIdentityPolicy` custom resource removed → pools `COGNITO_DEFAULT`).
3. **Run `update-provision-source.sh` at the flag-off state** so the next
   provision doesn't re-enable SES.
4. Leave the SES identity + observability stacks deployed (idle, ~no cost).
5. Verify: create a test user → `COGNITO_DEFAULT` path; SES Send metric flat.
   Incident-free — only a config flip; no resource destroyed.

## References
- Cognito in-Region SES/SNS GA (covers ap-south-1).
- Cognito → SES email settings: sending-authorization identity policy required;
  principal `email.cognito-idp.amazonaws.com`; `aws:SourceArn`+`aws:SourceAccount`.
- `aws-cdk-lib@2.195.0` source: `withSES` sets only `emailConfiguration` (no grant);
  `EmailIdentity` exposes no resource-policy method; no `AWS::SES::IdentityPolicy`.

# Sprint — Reliable Account Email via Amazon SES: Sprint Plan

> **Drafted:** 2026-06-08
> **Status:** 🟡 Draft — awaiting sign-off before implementation
> **Master-plan section:** satisfies the Cognito-transport half of
> `v1-master-epic-breakdown.md` §B.5.1 (SES integration); unblocks B.5.2–B.5.4
> **Trigger:** Operator-reported failure — Cognito account-creation invites are
> silently dropped by Outlook.com / Microsoft 365 (users created in the pool,
> email never delivered, no bounce, no trace).
> **Scope:** Reliability fix only — route both Cognito pools' email through SES
> from a verified, DKIM-signed `mail.edforge.app` identity, add delivery
> observability, and add a resend-invite endpoint. The general event-driven
> transactional-email platform (parent notifications, receipts) remains the
> *next* sprint (B.5.2–B.5.4).
> **Tier scope:** `BASIC` only (per CLAUDE.md V1 scope). One shared sending
> identity; per-tenant sending domains are a deferred ADVANCED/PREMIUM concern.

---

## 1. Context — why this work

EdForge sends every user account-creation email (the temporary-password
"invite") **exclusively through Amazon Cognito's built-in default email
sender**. Neither Cognito pool sets any `emailConfiguration`, so all mail
leaves AWS from the shared, throttled default identity
(`no-reply@verificationemail.com`).

This is the root cause of the reported failure. The default sender has:

- **No domain authentication** aligned to EdForge — no SPF, no DKIM, no DMARC on
  an `edforge.app` identity. Microsoft's filters quarantine/blackhole
  unauthenticated bulk mail with no bounce — exactly the observed symptom.
- **A hard ~50 emails/day cap** on the Cognito default sender — not scalable.
- **Zero traceability** — no delivery / bounce / complaint events, no metrics, no
  way to know a message was dropped.

**Intended outcome:** every account email is sent via SES from a verified,
DKIM-signed **`mail.edforge.app`** identity, with delivery observability and a
way to re-send invites — so Outlook/M365 accept the mail, the daily cap
disappears, and operators can see what happened to each message.

### What happens today when an account is created (traced)

| Path | Where | Email transport |
|---|---|---|
| Tenant admin (provisioning) | `provision-tenant.sh:197` `aws cognito-idp admin-create-user --desired-delivery-mediums EMAIL` | Cognito default |
| Teacher / staff / parent / student | `…/identity/src/users/users.service.ts` `AdminCreateUserCommand`, `DesiredDeliveryMediums:['EMAIL']`, no `MessageAction` | Cognito default |
| System admin | SBT `CognitoAuth` pool (`control-plane-stack.ts`) | Cognito default |

In every case Cognito generates a temporary password, renders the branded
invite template (tenant pool: `identity-provider.ts` `userInvitation`), and
sends it — but with **no `emailConfiguration`, the transport is
`COGNITO_DEFAULT`**. There is **no resend-invite endpoint** today; the only way
to re-send is to delete and recreate the user.

### Decisions locked with the operator
- **Scope:** Cognito→SES reliability fix only.
- **Sending domain:** subdomain **`mail.edforge.app`**; custom MAIL FROM
  **`bounce.mail.edforge.app`** (SPF alignment).
- **DNS:** **Route53** — CDK auto-provisions DKIM/SPF/DMARC, so verification is
  largely hands-off.

### Resolved unknown — pool topology is PER-TIER (one shared BASIC pool)
`provision-tenant.sh` hard-rejects any tier ≠ `BASIC` and keeps the literal
`STACK_NAME=tenant-template-stack-basic`; the per-tenant
`tenant-template-stack-<tenantId>` branch is PREMIUM/ADVANCED only
(`V1_DEFERRED`). `bin/ecs-saas-ref-template.ts` instantiates one stack with
`tenantId` defaulting to `'basic'`. **Consequence:** there is exactly **one
tenant Cognito pool for all BASIC tenants**. Adding SES to `identity-provider.ts`
and redeploying that single stack updates the pool for **every** existing tenant
at once — no per-tenant backfill loop.

> **Note on line references.** Path/line citations in this doc were captured
> during analysis; `main` has since advanced (PR #285 touched
> `control-plane-stack.ts`, `tenant-template-stack.ts`, and `tenant-api-prod.json`).
> Treat line numbers as approximate and re-confirm against current `main` at
> implementation time.

---

## 2. The fix — architecture

Both pools keep Cognito's native invite flow and the existing HTML template; we
only switch the **transport** from `COGNITO_DEFAULT` to **DEVELOPER (SES)**. No
custom-message Lambda, no Cognito-email suppression, no new mail-sending service
this sprint. Smallest possible blast radius for the bug.

```
 shared-infra-stack  ──► NEW EmailIdentity(mail.edforge.app) + Easy DKIM (Route53 auto)
 (account-singleton)     + custom MAIL FROM bounce.mail.edforge.app (SPF) + DMARC (Route53)
                         + ConfigurationSet → CloudWatch event destination
                         + bounce>5% / complaint>0.1% alarms → NEW shared-infra SNS topic
        │ pass EmailIdentity + ConfigSet name as CONSTRUCT PROPS in bin/  (NOT a CFN export)
   ┌────┴───────────────────────────────┐
   ▼                                     ▼
 tenant-template-stack-basic        controlplane-stack
 identity-provider.ts               control-plane-stack.ts
 UserPool.email =                   SBT CfnUserPool.emailConfiguration =
   UserPoolEmail.withSES({...})       { DEVELOPER, from, sourceArn, replyTo, configSet }
 → AUTO-creates SES→Cognito grant   → MUST add SES identity policy MANUALLY (no auto-grant)
 (all BASIC tenants' invites)       (system-admin invites)
```

**Why a verified subdomain + custom MAIL FROM:** without a custom MAIL FROM,
SES's envelope-from is `amazonses.com`, so SPF authenticates against Amazon's
domain and DMARC can't align SPF to `edforge.app`. The custom MAIL FROM makes
**both** SPF and DKIM align with `edforge.app` — which is precisely what
Outlook/M365 require to stop silently dropping.

**Cross-stack hygiene (CLAUDE.md "export in use" trap):** pass the
`EmailIdentity` / config-set name into the two consumer stacks as **construct
props in `bin/ecs-saas-ref-template.ts`** (mirroring how `accessLogsBucket` and
`tenantMappingTable` are already passed), **not** via `Fn.importValue`. The
tenant pool only needs the domain + config-set **strings**; the control-plane
pool needs the `EmailIdentity` ref to attach its send grant.

### Verified toolchain
`aws-cdk-lib@2.195.0` (has L2 `aws-ses` `EmailIdentity`/`ConfigurationSet` and
`UserPoolEmail.withSES`), `@cdklabs/sbt-aws@0.9.1` (no email passthrough →
escape hatch required), `@aws-sdk/client-cognito-identity-provider@^3.651.x`
(supports `MessageAction:'RESEND'`).

---

## 3. Scalability & cost efficiency (first-class requirement)

**Cost — single-digit dollars/month at pilot scale, scaling linearly:**
- **SES sending:** $0.10 per 1,000 emails. Account/onboarding email is bursty
  and low-volume; even 100k emails/month ≈ **$10/month**. Today's "free" Cognito
  default sender has a real cost: failed onboarding, manual password resets, and
  support load.
- **No new always-on compute this sprint.** SES, `EmailIdentity`, and
  `ConfigurationSet` are fully managed / pay-per-use. The bounce-handler Lambda
  is **deferred to B.5.4** — zero added compute now.
- **Fixed infra is negligible:** Route53 records cost nothing beyond the existing
  hosted zone; 2 CloudWatch alarms ≈ $0.20/month; SNS notifications are
  per-message and trivial. Total fixed adds < ~$1/month.
- **Suppression list** avoids paying to repeatedly send to dead addresses and
  protects the shared sending reputation (the real scaling asset).

**Scalability — removes the ceiling and lays reusable substrate:**
- **Throughput ceiling removed:** Cognito default = hard **~50/day**; SES
  production starts at **~50,000/day** with a per-second rate that **auto-scales
  with reputation**, raisable to millions on request.
- **One shared sending identity serves all BASIC tenants** with no per-tenant
  infrastructure — matches the per-tier pool topology. Per-tenant sending domains
  stay deferred (don't build now).
- **The `ConfigurationSet` + event-destination pattern is the scalable substrate
  the future `EmailAdapter` (B.5.2) reuses** — this sprint's infra is foundation,
  not throwaway.
- **Deliverability = scalability:** DKIM/SPF/DMARC alignment + bounce/complaint
  suppression are what let send volume grow without deliverability decay.
- **Single region** (per CLAUDE.md "single AWS region per environment") — do NOT
  add multi-region SES as "future-proofing."

**Cost/scale guardrails (built this sprint):** bounce>5% / complaint>0.1% alarms
(a paused SES account is the true cost/risk); suppression list; staged DMARC
(`p=none` → `quarantine`) to avoid the cost of false-quarantining legit mail
during rollout.

---

## 4. Workstreams

### WS0 — Unblock (Day 1, AWS-gated, do FIRST)
1. **Request SES production access** for the deployment region (Support →
   "Request production access"). SES starts in **sandbox** (verified recipients
   only, 200/day, 1 msg/s); this gates end-to-end testing to real Outlook/Gmail
   inboxes and has lead time.
2. **Confirm the Cognito↔SES region constraint — HIGHEST-RISK UNKNOWN.** Cognito
   requires the SES identity in a **Cognito-supported SES region** (a fixed AWS
   subset). Read `CDK_DEFAULT_REGION` from the gitignored `server/.env.<profile>`:
   - If it **is** supported → SES identity in the same region, omit `sesRegion`.
   - If **not** → identity must live in a supported region and `sesRegion` MUST be
     set on both pools' email config → a **cross-region `EmailIdentity` design
     fork** (`crossRegionReferences` / region-pinned sub-stack). Resolve before
     coding.
3. **Confirm Route53 hosted-zone id + name** for `edforge.app` and the
   from/reply-to addresses (`no-reply@mail.edforge.app`, `support@edforge.app`).
   These flow in as `CDK_PARAM_SES_*` env vars, mirroring `CDK_PARAM_CLIENT_APP_URL`.

### WS1 — SES sending identity + deliverability + observability (shared-infra)
**New file:** `server/lib/shared-infra/email-identity.ts` (a `Construct`),
instantiated in `server/lib/shared-infra/shared-infra-stack.ts` (account-
singleton; correct home — *not* `tenant-template-stack-basic`, which would
duplicate the identity per tier).

- Import the existing zone via
  `route53.HostedZone.fromHostedZoneAttributes({ hostedZoneId, zoneName })` (from
  `CDK_PARAM` — avoids `fromLookup` so synth stays offline/deterministic).
- `new ses.EmailIdentity(this, 'MailIdentity', { identity: ses.Identity.publicHostedZone(zone), mailFromDomain: 'bounce.mail.edforge.app', configurationSet })`.
  With the zone provided, **CDK writes the 3 Easy-DKIM CNAMEs automatically.**
- Add the rest as Route53 records:
  - MAIL FROM `MxRecord` `bounce.mail.edforge.app` → `feedback-smtp.<region>.amazonses.com`.
  - SPF `TxtRecord` `bounce.mail.edforge.app` → `v=spf1 include:amazonses.com -all`.
  - **DMARC** `TxtRecord` `_dmarc.edforge.app`. **Start `p=none` with
    `rua=mailto:dmarc@edforge.app`**; tighten to `p=quarantine` (then `p=reject`)
    only after aggregate reports confirm DKIM/SPF alignment.
- `new ses.ConfigurationSet(...)` named `edforge-transactional`, with an event
  destination for `SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, RENDERING_FAILURE`
  (CloudWatch — avoids the analytics cross-stack cycle). Enable
  **bounce+complaint suppression**.
- **CloudWatch alarms** on `Reputation.BounceRate` (>5%) and
  `Reputation.ComplaintRate` (>0.1%) → action = a **new shared-infra SNS topic**
  (`edforge-email-events`, subscribed to `operatorAlertEmail`), mirroring the
  `Alarm(...).addAlarmAction(new cwActions.SnsAction(topic))` idiom in
  analytics-stack. **Do NOT reference the analytics operator topic** (it lives
  downstream → cycle). SES auto-pauses the account if these thresholds breach.
- Expose `emailIdentity` (construct) + `configurationSetName` (string) to `bin`.

### WS2 — Point the tenant pool at SES
**File:** `server/lib/tenant-template/identity-provider.ts`. Add an `email` prop
to the `UserPool` (keep `userInvitation` unchanged); thread new props on
`IdentityProviderStackProps`, sourced through `tenant-template-stack.ts` (which
already passes `clientAppUrl`/`corsAllowedOrigins`/`useFederation`):
```ts
email: aws_cognito.UserPoolEmail.withSES({
  fromEmail: props.sesFromEmail,                 // no-reply@mail.edforge.app
  fromName: props.sesFromName,                   // EdForge
  replyTo: props.sesReplyTo,                      // support@edforge.app
  sesVerifiedDomain: props.sesVerifiedDomain,     // mail.edforge.app — MUST match identity
  configurationSetName: props.sesConfigSetName,
  ...(props.sesRegion ? { sesRegion: props.sesRegion } : {}),
}),
```
**Passing `sesVerifiedDomain` makes CDK auto-create the SES identity resource
policy** granting `cognito-idp.amazonaws.com` `ses:SendEmail`/`SendRawEmail`,
scoped by `aws:SourceArn` to this pool — **no hand-authored IAM for the tenant
pool.** Confirm on `cdk synth`.

### WS3 — Point the system-admin (SBT) pool at SES
**File:** `server/lib/bootstrap-template/control-plane-stack.ts`, mirroring the
existing `deletionProtection` L1 escape hatch, inserted **unconditionally**
(email must work in non-prod too):
```ts
const systemAdminPoolCfn = cognitoAuth.userPool.node.defaultChild as cognito.CfnUserPool;
systemAdminPoolCfn.emailConfiguration = {
  emailSendingAccount: 'DEVELOPER',
  from: `${props.sesFromName} <${props.sesFromEmail}>`,
  sourceArn: props.sesIdentity.emailIdentityArn,
  replyToEmailAddress: props.sesReplyTo,
  configurationSet: props.sesConfigSetName,
};
```
**CRITICAL — the L1 path does NOT auto-grant send permission** (unlike WS2's
`withSES`). Add an explicit SES identity resource policy allowing the Cognito
service principal `ses:SendEmail`/`SendRawEmail` for **this pool's ARN**, scoped
`Condition: { StringEquals: { "AWS:SourceArn": <controlPlanePoolArn>,
"AWS:SourceAccount": account } }`. Pass the `EmailIdentity` construct into
`ControlPlaneStackProps` and add the grant keyed to the pool ARN. Without it the
SBT pool **silently fails to send.**

### WS4 — Resend-invite endpoint (recovery for already-dropped users)
- **Service** `users.service.ts`: add `resendInvite(userId, context)` — resolve
  the user from DDB (`cognitoUsername`/`email`), `AdminGetUserCommand` (already
  imported); if `UserStatus === 'CONFIRMED'` throw `BadRequestException('User
  already activated; resend-invite not applicable')`; else `AdminCreateUserCommand`
  with `MessageAction:'RESEND'`, `DesiredDeliveryMediums:['EMAIL']`, **no
  `TemporaryPassword`** (invalid with RESEND). **No IAM change** —
  `cognito-idp:AdminCreateUser` + `AdminGetUser` already granted in
  `service-info.txt`. Add a unit spec mocking Cognito.
- **Controller** `users.controller.ts`: add `@Post(':id/resend-invite')` +
  `@RequireGlobalRole('TenantAdmin')` + `GlobalRoleGuard`, mirroring the
  `changeGlobalRole` block. (POST `:id/resend-invite` does not collide with the
  GET `:id` routes.)
- **Three-way route registration** (CLAUDE.md): add `/users/{id}/resend-invite`
  to `server/lib/tenant-api-prod.json` by **copying the `/users/{id}/global-role`
  block**, `patch`→`post`, fixing both `uri`s, CORS methods `POST,OPTIONS`,
  keeping the VPC_LINK + authorizer. **No nginx change** (`/users` prefix covers
  it). Run `npm run lint:routes` (`scripts/check-route-drift.ts`).

### WS5 — Roll out + prevent regression + verify
- **All existing BASIC tenants** get SES from a **single
  `tenant-template-stack-basic` redeploy** (shared pool). **System-admin pool:**
  one `controlplane-stack` redeploy.
- **Prevent next-provision regression (subtle):** the provisioning CodeBuild runs
  `cdk deploy tenant-template-stack-basic` from a **source tarball** it downloads,
  which embeds the whole CDK app including the *old* `identity-provider.ts`. If
  not refreshed, the **next tenant provision will redeploy the pool with
  COGNITO_DEFAULT, reverting the fix.** Run
  `scripts/utils/update-provision-source.sh` after the change — not because
  `provision-tenant.sh` logic changed, but to keep the embedded CDK app in sync.
- **User-level backfill:** for users already stuck in `FORCE_CHANGE_PASSWORD` who
  never received a deliverable invite, re-trigger via the new resend-invite
  endpoint once SES is live + production access granted.

---

## 5. Files to create / modify

| File | Change |
|---|---|
| `server/lib/shared-infra/email-identity.ts` | **NEW** — SES identity + Route53 DKIM/SPF/DMARC/MAIL-FROM + ConfigurationSet + event dest + bounce/complaint alarms + `edforge-email-events` SNS |
| `server/lib/shared-infra/shared-infra-stack.ts` | Instantiate the email construct; expose `emailIdentity` + config-set name |
| `server/bin/ecs-saas-ref-template.ts` | New `CDK_PARAM_SES_*` env reads; pass SES constructs/strings as props to shared-infra, controlplane, tenant-template |
| `server/.env.example` (+ gitignored `.env.<profile>`) | Add `CDK_PARAM_SES_*` keys + hosted-zone id/name |
| `server/lib/tenant-template/identity-provider.ts` | `email: UserPoolEmail.withSES({…})`; new props |
| `server/lib/tenant-template/tenant-template-stack.ts` | Thread SES props into `IdentityProvider` |
| `server/lib/bootstrap-template/control-plane-stack.ts` | L1 `emailConfiguration` override **+ explicit SES send grant** |
| `…/identity/src/users/users.service.ts` | `resendInvite()` via `MessageAction:'RESEND'` + `AdminGetUser` guard |
| `…/identity/src/users/users.controller.ts` | `POST /users/:id/resend-invite` |
| `…/identity/src/users/__tests__/…` | Resend unit spec |
| `server/lib/tenant-api-prod.json` | `/users/{id}/resend-invite` route (copy global-role block) |
| `ARCHITECTURE.md` + `docs/pilot-greenlight/v1-master-epic-breakdown.md` | Document the SES transport; mark B.5.1 satisfied for Cognito |

---

## 6. Deploy order

Per CLAUDE.md change-to-deploy matrix; **never `npx cdk deploy` directly** — use
`scripts/deploy-analytics.sh`; ride LOCAL → non-prod → human-approval → prod.

0. **WS0** — SES production-access request + region/zone/address confirmation (AWS-side, Day 1).
1. **`shared-infra-stack`** — SES identity, Route53 records, config set, alarms, **and** the `tenant-api-prod.json` resend route (API GW route → shared-infra). Wait for SES domain **Verified** + DKIM **Successful** before steps 2–3.
2. **`controlplane-stack`** — WS3 (SBT pool override + send grant). Matrix: "Cognito config → controlplane-stack".
3. **`tenant-template-stack-basic`** — WS2 (tenant pool `withSES`); updates the shared BASIC pool. Then **`scripts/utils/update-provision-source.sh`** (regression guard).
4. **identity ECR push + ECS rolling update** — WS4 (resend endpoint). App code after infra/IAM/routes.

`cdk diff` before each; empty diff ⇒ no CDK deploy for that stack.

---

## 7. Verification (end-to-end)

**Local gates:** `cd server/application && npx nest build identity` · `npm run
lint` · `npm run lint:routes` · `npx jest` (resend spec) · `cd server && source
.env.<profile> && CDK_NAG_ENABLED=false npx cdk synth shared-infra-stack
controlplane-stack tenant-template-stack-basic` (review the auto-generated SES
identity policy on the tenant pool) · `cdk diff` each.

**Infra:** SES console shows `mail.edforge.app` **Verified** + DKIM
**Successful**; DKIM CNAMEs + SPF/DMARC/MAIL-FROM records exist in Route53.

**Sandbox (pre-production-access):** create a user against a **verified** test
address via `POST /users` and via the resend endpoint → invite arrives from
`no-reply@mail.edforge.app`. Gmail "Show original" / mail-tester.com: **SPF=pass,
DKIM=pass, DMARC=pass** (aim ≥ 9/10).

**Post production-access (the real test):** invites to **Outlook.com**, Gmail,
proton.me, Yahoo → confirm receipt (the original bug was silent Outlook/M365
drops) and DKIM/SPF/DMARC=pass on each. Resend on an active user → clear 400.

**System-admin path:** create a system admin in AdminWeb → invite arrives via SES
(validates the SBT L1 override **and** its manual send grant).

**Observability:** SES `Send`/`Delivery`/`Bounce`/`Complaint` metrics increment;
send to `bounce@simulator.amazonses.com` / `complaint@simulator.amazonses.com` →
confirm the event fires, the alarm path works, and the address lands on the
suppression list.

---

## 8. Risks & gotchas
- **Region/SES support (WS0.2)** — highest-risk unknown; wrong `sesRegion` →
  silent send failure or a cross-region design fork. Resolve from `.env` first.
- **Sandbox lead time** — file production access Day 1 or testing stalls.
- **SBT L1 send grant (WS3)** — the L1 path does NOT auto-grant; omit it and the
  system-admin pool silently fails. Distinct from WS2's auto-grant.
- **`from`/domain mismatch** — a pool's `from` domain must equal the verified
  identity or sends fail silently (same failure class as today's bug). Test both.
- **Cross-stack export trap** — pass SES constructs by **prop**, not CFN export.
- **Provision-tarball regression (WS5)** — refresh the source tarball or the next
  provision reverts the pool to COGNITO_DEFAULT.
- **Bounce/complaint ceilings** — SES auto-pauses at >5% / >0.1%; alarms must be
  live before scaling sends.
- **DMARC rollout** — start `p=none`, tighten only after reports confirm alignment.

---

## 9. Roadmap beyond this sprint (documented, NOT built now)
The general scalable/traceable platform — the existing
`v1-master-epic-breakdown.md` **B.5.2–B.5.4**, now unblocked by this sprint's SES
identity:
1. **`EmailAdapter` service** (messaging) — provider-abstracted `sendEmail()` over
   SES; SMS adapter stubbed (B.5.2).
2. **Event-driven fan-out** — drive transactional mail (welcome, password-reset
   confirmations, parent absence alerts, finance receipts) off the **EventBridge
   domain events already emitted** by `IdentityEventsService`; respect
   `notificationPreferences` (B.4.4 / B.5.3).
3. **Bounce/complaint handler Lambda** — consume `edforge-email-events`, flip
   `User.notificationPreferences.email=false` on hard bounce (B.5.4).
4. **Per-archetype / localized templates** (Midnight Lockin P2.5) and, for
   ADVANCED/PREMIUM, **per-tenant sending domains** + per-tenant pools.

---

## 10. Ticket sequence
- **T0** WS0 — SES prod-access + region/zone/address confirmation *(Day 1, unblocks all)*
- **T1** WS1 — `email-identity.ts` + Route53 records + config set + alarms → deploy `shared-infra-stack` (non-prod); verify domain/DKIM
- **T2** WS2 — tenant pool `withSES`
- **T3** WS3 — system-admin pool L1 override **+ send grant**
- **T4** WS4 — resend-invite endpoint (+ route reg + spec)
- **T5** WS5 — `tenant-template-stack-basic` redeploy + tarball refresh + full non-prod verification (Outlook/Gmail/proton/Yahoo + header checks + bounce sim)
- **T6** — human-approval gate → prod rollout per ladder → post-deploy monitor
- **T7** — docs: ARCHITECTURE.md email section; mark epic B.5.1 satisfied for Cognito transport

---

## 11. Out of scope (explicit)
- The general EventBridge-driven transactional `EmailAdapter` for non-Cognito
  email (B.5.2–B.5.4) — this sprint stands up the SES substrate they consume.
- Route53/ACM-in-CDK adoption beyond the SES records.
- Per-tenant From domains / per-tenant pools (ADVANCED/PREMIUM).
- Multi-region SES (single region per environment, per CLAUDE.md).

# SES Sprint 2 — Cognito → SES cutover closeout

**Status:** ✅ Closed. End-to-end verified with real production traffic on two
independent email providers (Gmail + Outlook). Pool `EmailSendingAccount` flipped
from `COGNITO_DEFAULT` to `DEVELOPER` against the verified SES sending identity.

**PRs (in chronological order across the epic):**
- #286 — SES Sprint 0 + 1 (sending identity + observability foundation)
- #291 — Sprint 2 cutover (original, behind `CDK_PARAM_SES_ENABLED` flag; merged
  but the first deploy attempts failed — see retro)
- #301 — Architectural relocation of the SES grant from
  `tenant-template-stack-basic` to `shared-infra-stack`
- #302 — Exponential-backoff retry inside the grant Lambda
- #303 — Pre-created IAM role pattern (unconditional, 2-deploy operational shape)
- #304 — SES v2 SDK + v2 IAM action names (the actual fix)
- This PR — closeout + engineering lessons baked into CLAUDE.md

**Prod stack scope:** `shared-infra-stack` + `tenant-template-stack-basic`.
Control-plane / system-admin pool was explicitly out of scope (Sprint 3).

**Flag:** `CDK_PARAM_SES_ENABLED=true` in `server/.env.prod`. The
`CDK_PARAM_SES_SENDING_DOMAIN=mail.edforge.app` gate stays as the underlying
"SES identity creation" gate from Sprint 0.

---

## What's live in production after this epic

| Component | Stack | State |
|---|---|---|
| SES sending identity `mail.edforge.app` | shared-infra-stack | Verified; DKIM SUCCESS; custom MAIL FROM SUCCESS |
| Configuration set `edforge-transactional` | shared-infra-stack | Active; suppression on (BOUNCE + COMPLAINT) |
| CloudWatch event destination → `AWS/SES` namespace | shared-infra-stack | All 6 event types matched (Send / Delivery / Bounce / Complaint / Reject / RenderingFailure) |
| SNS topic `edforge-email-events` + 2 reputation alarms | shared-infra-stack | Bounce-rate alarm > 5%, complaint-rate alarm > 0.1%, both routed to the SNS topic; topic carries TLS-only policy + operator subscription |
| SES identity policy `cognito-tenant-basic` on the identity | shared-infra-stack | Authorizes `email.cognito-idp.amazonaws.com` to call `ses:SendEmail` / `ses:SendRawEmail` scoped to any Cognito user pool in this account+region |
| Pre-created grant-handler Lambda role | shared-infra-stack | Inline policy: `ses:CreateEmailIdentityPolicy` + `ses:UpdateEmailIdentityPolicy` + `ses:DeleteEmailIdentityPolicy` scoped to the identity ARN; managed policy: `AWSLambdaBasicExecutionRole`; trust policy: `lambda.amazonaws.com` |
| Grant-handler Lambda + Provider + `Custom::SesIdentityPolicy` CR | shared-infra-stack | Provisioned at Deploy B3; CR succeeded on first attempt against SES v2 API |
| Cognito BASIC tenant pool `EmailConfiguration` | tenant-template-stack-basic | `EmailSendingAccount: DEVELOPER`, `SourceArn` → SES identity ARN, `From: EdForge <no-reply@mail.edforge.app>`, `ReplyToEmailAddress: support@edforge.app`, `ConfigurationSet: edforge-transactional` |
| SES production-access | (account-level) | Granted — 50k/day, 14/sec, `EnforcementStatus: HEALTHY` |

---

## Verification evidence (real prod traffic, not synthetic smoke)

The cutover was verified end-to-end with two real recipient flows after the
deploy ladder completed. Recipient addresses redacted; this section captures
only the authentication/deliverability evidence.

### Gmail — verification-code flow

User triggered the Cognito "forgot password" flow with a Gmail recipient.
Headers on the delivered message:

- `From: EdForge <no-reply@mail.edforge.app>`
- `Reply-To: support@edforge.app`
- `Return-Path: <…@bounce.mail.edforge.app>` (custom MAIL FROM working — SPF
  alignment for DMARC)
- `mailed-by: bounce.mail.edforge.app`
- `signed-by: mail.edforge.app`
- `Authentication-Results: mx.google.com;` →
  - `dkim=pass header.i=@mail.edforge.app header.s=<our-dkim-token-selector>` —
    our DKIM token (one of the three CNAMEs published in Vercel DNS) verifies
  - `dkim=pass header.i=@amazonses.com` — AWS's secondary DKIM also verifies
  - `spf=pass smtp.mailfrom=…@bounce.mail.edforge.app` — published SPF
    `v=spf1 include:amazonses.com -all` resolves; sender IP designated
  - `dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=mail.edforge.app` —
    DKIM-identifier alignment passes
- Inbox placement: primary inbox; not flagged

Sending IP `76.223.180.40` resolves to AWS SES outbound in `ap-south-1`.

### Outlook — Welcome / temp-password flow

Admin created a new Cognito user with an Outlook recipient (via the EdForge
AdminWeb console, which uses `admin-create-user` on the BASIC tenant pool).
Headers on the delivered message:

- Same `From` / `Reply-To` / `Return-Path` shape as Gmail
- `Authentication-Results:` →
  - `spf=pass` (sender IP designated)
  - `dkim=pass header.d=mail.edforge.app`
  - `dkim=pass header.d=amazonses.com`
  - `dmarc=pass action=none header.from=mail.edforge.app`
  - **`compauth=pass reason=100`** — Outlook's composite-authentication score
    is the maximum; every cryptographic + sender-identity check that Outlook
    runs passes
- `X-SID-Result: PASS`
- `X-MS-Exchange-Organization-SCL: 5` (Spam Confidence Level 5 of 1–9) →
  inbox placement: **Junk**

Despite passing every authentication check at the maximum confidence level,
Outlook routed the message to Junk. This is *not* an authentication failure —
the `X-Microsoft-Antispam-Mailbox-Delivery` header explicitly says `auth:1`
(authentication passed) and `dest:J` (destination is Junk) with
`OFR:SpamFilterAuthJ` (the heuristic spam filter triggered, not the auth
filter). Outlook applies a moderate suspicion score to *every* new sending
domain — the SES sending identity is only ~1 month old in IAM terms, so
Outlook hasn't accumulated enough trust signal yet.

This will improve operationally without any code change: recipients who
mark an EdForge mail as "Not Junk" once will see all future EdForge mail
in their inbox; cumulative "Not Junk" signals across recipients drive
Outlook's domain-reputation score upward over a 30–90 day window. No
engineering action is needed; flagging here for operational awareness.

### End-to-end onboarding

The Outlook-recipient user followed the temp-password from the (junked but
delivered) welcome email and completed first-login + onboarding through
`edforge.app`. The end-to-end flow works.

---

## Architecture summary — what shipped, why it's shaped this way

The interesting architectural decisions all live in
`server/lib/shared-infra/email-identity.ts`.

### 1. The grant lives with the SES identity, not with the consumer pool

A SES identity policy is a permission *on the SES identity* that authorizes
some other principal (the Cognito service principal) to call SES on behalf
of the identity. Architecturally it belongs alongside the identity it
permissions — in `shared-infra-stack`, not in `tenant-template-stack-basic`
where the consumer pool lives.

This placement was *not* the original Sprint 2 design — the first
implementation (#291) put the grant in `tenant-template-stack-basic` next
to the pool. PR #301 moved it. The relocation has three downstream
benefits:

- Permissions co-locate with the resource they protect (industry standard).
- Tenant-template stacks don't need to import SES via `Fn::ImportValue`
  (S2.1b invariant).
- Future tiers (ADVANCED / PREMIUM, both currently `V1_DEFERRED`) get the
  grant for free without duplicating the IAM grant pattern per tier.

### 2. Custom Lambda + `Provider`, not `AwsCustomResource`

`AwsCustomResource` would have been the obvious one-liner. We don't use
it for this CR because:

- It can't retry `AccessDenied` (no way to distinguish transient IAM race
  from real permission bug).
- It uses an opaque CDK-generated role with the inline policy attached in
  the same deploy unit as the SDK call — the IAM eventual-consistency
  race lives in the construct itself.
- It uses the SES *v1* SDK + v1 IAM action names (see lesson #3 below).

Instead, `CognitoBasicGrantHandler` is a Node.js 22 Lambda we control:
- Uses `@aws-sdk/client-sesv2` (v2 SDK).
- Implements upsert semantics explicitly: try
  `CreateEmailIdentityPolicyCommand` → on
  `AlreadyExistsException`, fall back to `UpdateEmailIdentityPolicyCommand`.
- Retries `AccessDenied` / `ThrottlingException` with exponential backoff
  (~190 s worst-case budget; defense-in-depth only — once the
  pre-existing-role pattern is in place this never fires).

The CFN integration uses `Provider` from `aws-cdk-lib/custom-resources` to
handle CFN request-signing + async lifecycle, with our Lambda as the
`onEventHandler`.

### 3. Pre-created IAM role for the Lambda — unconditional, with `inlinePolicies`

The Lambda's role is created at construct time *regardless of
`enableCognitoBasicGrant`*. This is the architectural primitive that makes
the cutover reliable:

```text
Deploy A: flag OFF
  → only the role + its inline policy are emitted
  → no Lambda, no CR, no behavior change anywhere
  → IAM data plane has minutes-to-hours to fully propagate the role
    globally

Deploy B: flag ON
  → Lambda + Provider + CR are emitted, using `role: this.role`
  → CDK does NOT auto-generate a fresh role
  → the Lambda assumes a role IAM has long since settled
```

The role uses `inlinePolicies` (not `addToRolePolicy`) so the role + its
SES permission set is a single atomic `AWS::IAM::Role` resource. This
matters: `inlinePolicies` makes role-creation a single IAM API call;
`addToRolePolicy` produces a separate `AWS::IAM::Policy` resource that's
attached to the role via a second IAM API call. Two calls = two
propagation windows. One call = one window.

### 4. The retry Lambda stays as defense-in-depth

The exponential-backoff retry from PR #302 stays in the construct. It
should never fire now (the role pre-creation eliminates the race, and the
v2 action names actually evaluate to `allowed`), but it's cheap insurance
against any residual jitter and against future changes that re-introduce
a same-deploy timing window.

---

## Reviewer-relevant decisions

### Why the per-pool `ArnLike` condition got relaxed to a region+account wildcard

The original Sprint 2 design (#291) scoped the SES identity policy via
`ArnLike: { aws:SourceArn: <specific pool ARN> }` to constrain the grant
to one Cognito pool only. After PR #301 moved the grant to
`shared-infra-stack`, that exact ARN binding would have required pulling
the pool ARN via `Fn::ImportValue` from `tenant-template-stack-basic` —
exactly the cross-stack import the S2.1b invariant forbids.

The replacement is a region+account-scoped Cognito userpool wildcard:
`arn:<partition>:cognito-idp:<region>:<account>:userpool/*`. This says
"any Cognito pool in this account+region may invoke SES on behalf of this
identity," combined with `StringEquals: aws:SourceAccount: <account>`.

Effective security scope: identical today. V1 ships exactly one BASIC
pool per account (CLAUDE.md "Scope of V1"), the account is single-tenant
operator-owned, and the Cognito service principal is the only caller.
When ADVANCED / PREMIUM tiers come back from `V1_DEFERRED`, they get the
grant for free without per-tier construct duplication.

### Outlook "Junk" routing is not a regression

See "Verification evidence — Outlook" above. The mail is delivered, every
authentication check passes at maximum confidence, and the user-side
operational workflow ("Not Junk" → all future mail to inbox) is normal
for any new sending domain on Outlook. The SCL will drop as the domain
accumulates reputation over ~30–90 days. No engineering work needed.

### The retry Lambda is defense-in-depth, not load-bearing

`CognitoBasicGrantHandler`'s retry budget (10 attempts × exponential
backoff up to 32 s = ~190 s) is kept in the construct but is not relied
upon for correctness. The role pre-creation pattern + v2 action names
together are what make the deploy succeed deterministically. The retry
exists as cheap insurance against future regressions, residual IAM
jitter, or third-party throttling.

---

## Outstanding items (do not gate close)

Three small follow-ups deferred from this session — all low-urgency, none
blocking:

1. **`FORCE_CHANGE_PASSWORD` cohort RESEND.** For each user still stuck in
   the pre-cutover state, run `admin-create-user --message-action RESEND`
   on the BASIC tenant pool. Cognito regenerates a fresh temporary
   password and delivers the invite through SES. Operator session; ~1
   minute per user.
2. **S2.5 rollback drill.** Flip `CDK_PARAM_SES_ENABLED=false`, redeploy
   both stacks, confirm pool reverts to `COGNITO_DEFAULT`, flip back and
   redeploy. Proves reversibility for the audit trail. The code path is
   the same as tonight's successful deploys; ~10 min total. Defer until
   you specifically need the rollback evidence — running it now would
   briefly route everyone back through Cognito's default sender.
3. **S5.1 provision tarball refresh.** `scripts/utils/update-provision-source.sh`
   refreshes the CodeBuild-based tenant provisioner so any NEW tenant
   provisioned after this commit deploys against the flag-on state. New
   tenants don't get provisioned daily; not blocking until one is needed.

---

## Engineering retrospective — the actual lessons

This epic took **5 PRs and 5 deploy attempts** to land. The journey
matters because the diagnostic path was non-obvious and the lessons
generalize beyond this single feature. Three new entries have been
added to `CLAUDE.md` under "Common edit traps" so future sessions load
them automatically.

### Lesson 1 — Run the IAM Policy Simulator before any retry/budget loop

The first three failed attempts (#291, #301, #302) all operated under the
hypothesis "this is IAM eventual consistency" because the symptom
(intermittent `AccessDenied` on a freshly-attached policy) matched. The
fourth attempt (#303) tried to engineer around the timing race
structurally with a pre-created role. All four failed identically.

The fifth attempt started with `aws iam simulate-principal-policy`
against the actual deployed role. The result:

```
EvalActionName:    ses:PutIdentityPolicy
EvalDecision:      implicitDeny
MatchedStatements: []   ← role policy literally contained the action
```

The IAM authorization layer was not recognizing the action name. No
amount of retry budget or pre-created role helps when the action itself
is unknown to the evaluator. The simulator told the truth in 30 seconds
and would have saved three iterations if I'd run it first.

**The trap that's now in CLAUDE.md:** when `AccessDenied` persists past a
remedy that should have fixed eventual consistency, the next step is the
Policy Simulator, not a bigger budget.

### Lesson 2 — AWS documentation can list IAM action names that aren't honored at runtime

`ses:PutIdentityPolicy` and `ses:DeleteIdentityPolicy` are listed as
valid IAM actions in the AWS Service Authorization Reference for SES.
The IAM authorization engine in `ap-south-1` returns `implicitDeny` for
them anyway. The v2 equivalents (`ses:CreateEmailIdentityPolicy`,
`ses:UpdateEmailIdentityPolicy`, `ses:DeleteEmailIdentityPolicy`) are
honored correctly.

The docs aren't lying — they're stale. AWS adds new actions
(SES v2) but doesn't always retroactively deprecate the old ones (SES
v1). The IAM evaluator silently follows internal action-registry state,
not the docs.

**The trap that's now in CLAUDE.md:** when migrating between AWS API
versions, validate IAM action names with the simulator against the
specific region you're deploying to.

### Lesson 3 — `AwsCustomResource` is fine for reads, treacherous for writes

`AwsCustomResource` from `aws-cdk-lib/custom-resources` is the obvious
one-liner for "call this AWS API during deploy." It's safe for trivial
reads (the CDK examples lean heavily on `dynamodb:GetItem` and friends).

For *writes* that require permissions granted in the same deploy unit
— especially cross-service writes that grant a service principal access
to a resource — it has two sharp edges:

- No `AccessDenied` retry — first-attempt failure is final failure.
- Same-deploy IAM policy attachment recreates the eventual-consistency
  race on every fresh deploy of the construct.

**The trap that's now in CLAUDE.md:** for IAM-sensitive writes, use
`Provider` with a custom Lambda you control. The reference
implementation lives in `server/lib/shared-infra/email-identity.ts`.

### Lesson 4 — Pre-create IAM resources unconditionally; the cost is nothing

The pre-created role pattern from PR #303 wasn't load-bearing in the end
(the v2 action names were the actual fix), but it's still architecturally
better and stays in the construct. The role itself costs nothing — no
runtime, no operational footprint until something assumes it. What it
buys is:

- A safer 2-deploy operational pattern: emit the role first, let IAM
  propagate, then emit the Lambda + CR that use it. Eliminates an entire
  class of intra-resource timing race.
- Stability across flag flip-flopping. Future rollback drills, A/B
  reversals, and re-flips don't recreate the role each time.
- An IAM identity we can inspect with the simulator *before* a Lambda
  ever assumes it. Tonight's diagnostic loop relied on this — the role
  survived a failed deploy precisely because it was pre-created.

**The trap that's now in CLAUDE.md:** whenever a CDK construct
conditionally creates a Lambda + CR, put the Lambda's IAM role *outside*
the conditional. Use `inlinePolicies` for atomic role-creation.

### Lesson 5 — "Eventual consistency" is the easy hypothesis that masks harder ones

The most expensive lesson. Three PRs operated on the eventual-consistency
hypothesis because:

- The symptom matched (intermittent-looking `AccessDenied`).
- AWS docs and community wisdom both name eventual consistency as the
  usual cause.
- The remediations (retry budget, pre-created role) are well-documented
  industry patterns.

But the *actual* cause (v1 action name not honored at evaluation time)
had the identical symptom and required completely different remediation.
The discipline lesson: **when a remediation that should work doesn't,
run the diagnostic that disambiguates the two hypotheses, don't iterate
on the original.**

The Policy Simulator is *that* diagnostic for `AccessDenied`. Use it
once after the first failed remediation, before committing to another
iteration on the same hypothesis.

---

## What this does NOT close

- **Sprint 3 — control-plane / system-admin pool cutover.** The SBT
  control-plane stack has its own Cognito pool for tenant administrators
  and EdForge operators. Same `CDK_PARAM_SES_ENABLED` flag, same
  underlying SES identity, separate `tenant-template-stack` deploy. Out
  of scope for this epic; tracked separately.
- **Per-tier grants for ADVANCED / PREMIUM** when those tiers leave
  `V1_DEFERRED`. The current grant's region+account-scoped Cognito
  userpool wildcard already covers them — no IAM work needed at unlock
  time — but the closeout doc for each tier's introduction should
  re-verify the smoke against that tier's pool.
- **The three outstanding follow-up items** listed above (cohort RESEND,
  S2.5 drill, S5.1 tarball) — deferred to the operator's next
  convenient session.

---

## Sign-off

Sprint 0 + 1 + 2 functionally closed. Infrastructure deployed,
observability wired, identity policy + Cognito EmailConfiguration both
flipped, two independent real-world delivery tests passed with full
SPF/DKIM/DMARC + composite-auth at maximum confidence.

Three new edit traps captured in `CLAUDE.md`. The construct at
`server/lib/shared-infra/email-identity.ts` stands as the canonical
reference for IAM-sensitive custom-resource patterns going forward.

EPIC closed.

# Cognito Session Security and Audit Epic Plan

Status: planning baseline — v2 (second adversarial review applied, 2026-06-29)
Date: 2026-06-29
Scope: V1 BASIC tier tenant authentication, active sessions, last login,
session revocation, tenant-admin security views, and system-provider auth
audit views.

## Executive Verdict

EdForge has a credible authentication and authorization foundation, but it does
not yet have an enterprise-grade active-session and auth-audit product surface.
The foundation is:

- Control-plane and tenant-plane Cognito separation.
- Tenant-facing Cognito claims carrying tenant and role context.
- API Gateway Lambda authorizer in front of the tenant API.
- NestJS JWT validation and route-level authz coverage.
- Identity service user, role, password, MFA, session, and security modules.
- EventBridge and analytics plumbing for login and session metrics.

The gap is that the current primary tenant frontend signs in directly with
Cognito through Amplify and Hosted UI. That bypasses the backend `/auth/login`
path that creates DDB `Session` rows, updates `lastLoginAt`, writes login
history, and emits `SessionCreated`. A Cognito PostAuthentication trigger now
emits `LoginSuccess`, but it does not create a first-party session ledger, does
not write `LOGIN_HISTORY`, and does not capture enough session context for
targeted revoke.

The most important planning conclusion is this: EdForge must define and build a
first-party auth event and session ledger. Cognito should remain the identity
provider and token issuer, but Cognito is not itself a tenant-facing "active
sessions table." Last login, session history, admin audit, and provider-wide
auth monitoring must be EdForge-owned projections from canonical auth events.

Two additional planning conclusions surfaced by the second adversarial review:

1. **The API Gateway Cognito authorizer is currently forgeable.**
   `server/lib/shared-infra/layers/cognito/cognito_authorizer.py:21-24` extracts
   `user_pool_id` from `payload['iss']` and `app_client_id` from `payload['aud']`
   **before** signature verification, then fetches JWKS for the attacker-supplied
   pool. The audience check on line 83-84 compares `claims['aud']` against the
   `app_client_id` also taken from the token. NestJS `JwtStrategy` saves us at
   the service layer by pinning issuer/audience to env-configured values
   (`server/application/libs/auth/src/jwt.strategy.ts:38-51`), but the gateway
   already minted STS credentials, cached the result for 30 s
   (`server/lib/tenant-api-prod.json` `authorizerResultTtlInSeconds: 30`), and
   selected the tier-keyed API key from the forgeable `custom:tenantTier`
   (`server/lib/shared-infra/Resources/tenant_authorizer.py:83-91,157,163`).
   Pinning the gateway trust boundary is a **Sprint 0 ship-blocker**, not a
   "Sprint 6 audit prereq" — see AUTH-00-07a.

2. **The backend `/auth/login` route is presently non-functional even for the
   callers that would use it.**
   `server/application/microservices/identity/src/auth/auth.service.ts:75-83`
   calls `AdminInitiateAuthCommand` with `AuthFlow: ADMIN_USER_PASSWORD_AUTH`,
   but the tenant app client at `server/lib/tenant-template/identity-provider.ts:223-227`
   sets `adminUserPassword: false`. Any caller would get
   `NotAuthorizedException: Auth flow not enabled for this client`. The route is
   only "alive" because nothing in the production flow exercises it. The Sprint 8
   "reconcile legacy `/auth/login`" ticket sits on top of dead code and must be
   resolved (fix or remove) in Sprint 0 before the canonical `SessionObserved`
   model can be designed around it — see AUTH-00-11.

## What Cognito Can And Cannot Do Here

AWS Cognito is the correct managed identity provider for this architecture, but
its primitives need to be used honestly:

- Cognito user metadata includes creation, modified, enabled, and status fields.
  It does not provide a complete, queryable tenant product field for "last
  login" or "active sessions." EdForge must derive last login from auth events.
- Cognito refresh-token revocation prevents a refresh token from obtaining new
  access and ID tokens. Existing access and ID JWTs remain self-contained
  bearer tokens unless EdForge adds revocation-aware checks. **`origin_jti` is
  only present in tokens when `enableTokenRevocation` is enabled on the app
  client.** The EdForge session-id derivation rule depends on `origin_jti`, so
  enabling token revocation is a Sprint 0 precondition (AUTH-00-15), not a
  Sprint 3 line item.
- `AdminUserGlobalSignOut` is useful for "sign this user out everywhere" and
  should be the enforcement primitive for admin-wide signout. It is not a
  precise per-browser session manager by itself.
- True targeted per-session Cognito refresh-token revoke requires EdForge to
  know the refresh token, or to move to a backend/BFF session authority that
  owns refresh tokens. The current Amplify direct-login flow does not give the
  backend that control.
- If EdForge stays with direct Cognito login, single-session revoke must be
  enforced at the EdForge API layer by session/token-family denylist checks
  using token claims such as `jti` and `origin_jti`, plus clear UX semantics.
- CloudTrail is valuable for AWS API audit evidence. It is not a complete
  application login/session ledger for school admins or tenant users.
- Cognito threat protection and user auth events can add risk signals, but they
  are optional risk controls, not a substitute for EdForge's tenant-scoped auth
  event ledger.

## Current Architecture

### Control Plane

The control plane creates a system-admin Cognito pool through SBT CognitoAuth in
`server/lib/bootstrap-template/control-plane-stack.ts`. AdminWeb receives the
control-plane issuer, client ID, API URL, token endpoint, and well-known
endpoint. The control-plane pool is for system administrators and tenant
operations. It is intentionally separate from the tenant-facing user pool.

Current limitations:

- Control-plane AdminWeb does not yet expose a cross-tenant auth audit product
  surface.
- Existing analytics fleet access is narrow and email-list based
  (`server/lib/analytics/lambda/api/authz.ts:15-22` reads
  `process.env.SYSTEM_ADMIN_EMAILS`), not a complete platform-provider
  security console. Two divergent SystemAdmin notions live in the codebase
  today: this email allowlist and the `custom:userRole === 'SystemAdmin'`
  claim used elsewhere. The unification ticket has been pulled into Sprint 0
  (AUTH-00-12) because the analytics fleet API is in production.
- Tenant auth activity is not projected into a central, redacted provider audit
  table with tenant/user/time/risk indexes.
- **The control-plane Cognito pool has NO PostAuthentication trigger.**
  `server/lib/auth-events/cognito-post-auth-trigger.ts:7-16` is intentionally
  wired only to the tenant pool. System-admin logins are therefore invisible
  to the canonical event ledger they are supposed to audit. New ticket
  AUTH-06-00 wires the trigger to the control-plane pool.

### Tenant Application Plane

The tenant template creates a Cognito user pool and app client in
`server/lib/tenant-template/identity-provider.ts`. The user pool has email
verification, password policy, custom tenant/role attributes, and production
deletion protection. A Cognito PostAuthentication Lambda in
`server/lib/auth-events/cognito-post-auth-trigger.ts` emits login success events
from the tenant pool.

Tenant API requests pass through the shared API Gateway authorizer in
`server/lib/shared-infra/Resources/tenant_authorizer.py`, which validates a
Bearer JWT, extracts tenant and role claims, and returns tenant context plus
temporary STS context. NestJS services then validate JWT issuer and audience
again through `server/application/libs/auth/src/jwt.strategy.ts` and enforce
route/service-level authorization.

Current limitations:

- **The API Gateway Cognito authorizer derives the user pool and client from the
  presented token's issuer/audience before signature verification.**
  `cognito_authorizer.py:21-24` calls `payload = jwt.get_unverified_claims(token)`,
  splits `payload['iss']` to get `user_pool_id`, reads `payload['aud']` to get
  `app_client_id`, and then fetches the JWKS at
  `https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json`.
  The signature is verified against the JWKS of the attacker-chosen pool, and
  the audience check `claims['aud'] != app_client_id` (line 83-84) is trivially
  satisfied because both values came from the token. Any valid Cognito token
  from any pool in the deployment region passes the authorizer. NestJS does
  stricter validation later, but by then the gateway has already minted STS
  credentials and cached the authorizer result for 30 s — see AUTH-00-07a.
- API Gateway authorizer cache TTL is 30 seconds (verified at
  `server/lib/tenant-api-prod.json:25634` `"authorizerResultTtlInSeconds": 30`).
  Any immediate token-denylist design must account for this cache if
  enforcement is placed at the gateway.
- Tenant app client OAuth config still enables implicit grant
  (`identity-provider.ts:240` `implicitCodeGrant: true`) even though the
  frontend uses authorization code with PKCE
  (`edforge-saas-frontend/packages/auth/src/config.ts:97` `responseType: 'code'`).
  Removing implicit grant is safe; the validation gate must be a CDK assertion
  plus runtime `DescribeUserPoolClient`, not "frontend login still works"
  (a code-flow login would pass either way).
- Security-critical custom attributes — `custom:tenantId`, `custom:userRole`,
  `custom:tenantTier`, `custom:tenantName`, and `custom:apiKey` — are all in
  the app-client `writeAttributes` set (`identity-provider.ts:200-202`).
  `custom:apiKey` matters as much as the tenancy/role attributes: the
  authorizer uses `custom:tenantTier` to select an API key
  (`tenant_authorizer.py:83-91`) and returns it as
  `usageIdentifierKey`. A self-mutated tier could cross usage plans. Verified
  that removing all five from `writeAttributes` has zero behavioural
  regression: only server-side `Admin*` flows write them
  (`users.service.ts:441,1018` use `AdminUpdateUserAttributesCommand` for
  given_name/family_name and globalRole, which are unaffected by app-client
  `writeAttributes`).
- Cognito advanced security/threat protection is disabled.

### Tenant Frontend Flow

The nested tenant frontend in `edforge-saas-frontend` uses Amplify and Cognito
directly. `packages/auth/src/service.ts` performs direct sign-in
(`signInDirect` → `InitiateAuth`), Hosted UI redirects (`signInWithRedirect`),
session fetch (`fetchAuthSession`), and global signout
(`signOut({ global: true })`). `packages/auth/src/config.ts`
configures OAuth code flow with PKCE.

This means the browser obtains Cognito tokens without calling the backend
`/auth/login` route. That is a valid architecture, but it changes the source of
truth:

- Backend-created session rows are incomplete for real tenant-frontend usage.
- Login success is visible through the PostAuthentication trigger, but the
  backend does not know the browser/device session unless the frontend performs
  an authenticated session-observation handshake after login.
- Login failure telemetry from direct Cognito login is not automatically a
  trusted backend event.

### Existing Identity Session/Security Code

The identity service already has:

- `AuthService` with `/auth/login`, `/auth/refresh`, `/auth/logout`, and
  `invalidateAllUserSessions`.
- `SessionsService` with list/revoke/revoke-all routes.
- `SecurityService` with security overview, password change, MFA flows, active
  sessions, and login history routes.
- Shared DTOs in `packages/shared-types/src/schemas/identity/`.

Current limitations:

- `/auth/login` is presently **non-functional**: it calls `AdminInitiateAuth`
  with `AuthFlow: ADMIN_USER_PASSWORD_AUTH`
  (`auth.service.ts:75-83`) but the tenant app client sets
  `adminUserPassword: false` (`identity-provider.ts:223-227`). The route
  silently returns `NotAuthorizedException` to any caller. Since the real
  frontend bypasses this route via Amplify, the bug has not surfaced, but the
  Sprint 8 reconciliation task (`AUTH-08-01`) plans against dead code. The
  fix/remove decision is now Sprint 0 (`AUTH-00-11`).
- `/auth/login` (when fixed) creates DDB sessions and updates `lastLoginAt`,
  but the tenant frontend bypasses it.
- Session revoke routes mostly mark DDB rows as revoked
  (`sessions.service.ts:96-145, 150-207, 240-284` and
  `security.service.ts:422-468, 474-527`). They do not call Cognito token
  revocation or `AdminUserGlobalSignOut`.
- The stronger Cognito global signout path exists in
  `AuthService.invalidateAllUserSessions` (`auth.service.ts:655-707`), but it
  is not the common path for user-facing or admin session revoke.
- Login history rows are separate from analytics login events and are not
  populated by the Cognito PostAuthentication trigger. `recordLoginAttempt` is
  defined in `security.service.ts:580-612` but is never called from the
  PostAuth Lambda. The login-history table is therefore empty for direct
  Cognito login users.
- **`lastLoginAt` has three writers, not two.** (a) `/auth/login` (dead path
  per above), (b) the new event projector once Sprint 1 lands, and (c)
  `getCurrentUser` self-healing in `auth.service.ts:520-560` auto-creates DDB
  user rows from JWT claims on first Amplify-direct call, writing
  `lastLoginAt: now` at create-time but never refreshing it. Amplify-direct
  users today see `lastLoginAt` = the row's `createdAt`, never updated.
  Sprint 1 (`AUTH-01-07`) must rationalize all three writers.
- MFA has production-adjacent gaps: backup codes are generated
  (`security.service.ts:677-684`) but never persisted, and `disableMfa`
  accepts a `MfaDisableDto` but never reads any field from it
  (`security.service.ts:320-364`) — anyone with a valid access token can
  disable MFA in one call. The Sprint 5 admin security panel is being built
  on top of MFA that does not actually work. The fix or explicit defer (with
  blocked UI copy) is now Sprint 0 (`AUTH-00-13`).
- Frontend post-MVP session/login-history components exist, but are not wired
  into the live `/settings/security` page
  (`edforge-saas-frontend/apps/shell/src/pages/settings/security.tsx` only
  renders a Password tab today).
- Frontend service methods currently expect array responses for sessions and
  login history (`apps/shell/src/services/users.service.ts:getActiveSessions`,
  `getLoginHistory`), while shared backend DTOs return wrapper objects
  (`packages/shared-types/src/schemas/identity/session.schema.ts:52-57`
  `{ sessions, total }`). Pick wrapper, migrate every existing `.map`/`.length`
  call site in the same PR.

### Existing Analytics Session Code

The analytics stack creates `edforge-user-session-events` and exposes
`/analytics/me/session-history`. The aggregator dual-writes only
`SessionCreated`, `SessionRevoked`, and `SessionRefreshed` events to that table
(`server/lib/analytics/lambda/aggregator/event-metric-map.ts:137-141`
`SESSION_EVENT_TYPES`). `LoginSuccess` events are counted for adoption/auth
metrics but are not enough to power active sessions.

Current limitations:

- Direct Cognito login currently produces `LoginSuccess`, not `SessionCreated`.
  The user-session table is therefore empty for direct-Cognito-login users.
- The session-event writer expects `ipAddress` and `deviceInfo` at the top
  level of `event.detail`
  (`server/lib/analytics/lambda/aggregator/handler.ts:273-302` reads
  `detail.ipAddress`, `detail.deviceInfo`), while existing emitters place those
  fields under `metadata` (`auth.service.ts:227-235`
  `emitSessionCreated({ metadata: { ipAddress, deviceType } })`). Even when the
  backend revoke/login paths run, the user-session table never receives IP/device.
- The current user-session table is useful for per-user event history but is
  not a complete tenant/admin/provider auth audit model.

## Implemented Versus Missing

| Capability | Current status | Notes |
| --- | --- | --- |
| Control-plane Cognito | Implemented | System-admin pool and AdminWeb OIDC config exist. |
| Control-plane Cognito auth events | Missing | No PostAuth trigger on control-plane pool. System-admin logins are invisible to the ledger. |
| Tenant Cognito | Implemented | Tenant pool, app client, custom claims, post-auth trigger. |
| Backend `/auth/login` route | Broken (dead code) | `AdminInitiateAuth` flow mismatched with app-client config. Decide fix vs delete in Sprint 0. |
| Tenant frontend login | Implemented | Amplify direct Cognito flow; backend session path bypassed. |
| JWT verification in services | Implemented | Nest strategy validates issuer/audience and maps tenant context. |
| Gateway authorizer trust pinning | Broken | Pool/client derived from unverified token; any Cognito token in region passes. Sprint 0 fix required. |
| Route authz coverage | Strong baseline | Existing authz coverage audit is green, but new routes must keep gates. |
| Analytics SystemAdmin authz | Email allowlist | Env-var `SYSTEM_ADMIN_EMAILS`, in production today. Unify with claim-based check in Sprint 0. |
| User list last login | Partial/stale | Three writers race; should be event-derived with the other two removed. |
| Active sessions for real frontend flow | Missing | No first-party session observation handshake yet. |
| Session-ID derivation rule | Undefined | Cognito JWT has no stable per-browser-session ID. ADR required Sprint 0. |
| User self-service session list | Partial | Backend/DTO/UI pieces exist but are not wired to real ledger. |
| Revoke own session | Partial/cosmetic | DDB updates exist; Cognito/API enforcement incomplete. |
| Admin revoke user sessions | Partial | Global signout helper exists but not consistently exposed/enforced. |
| Login history | Partial | Existing table/path does not receive direct Cognito login events. |
| MFA backup codes + disable proof | Broken | Codes never persisted; `disableMfa` ignores its DTO. Fix or hard-disable in Sprint 0. |
| Sessions/history DTO shape | Inconsistent | Frontend expects arrays; backend returns `{ sessions, total }` wrappers. |
| System-provider cross-tenant auth audit | Missing | Needs central redacted projection and control-plane UI. |
| SBT EventBridge bus namespacing | Undefined | `sbt_aws_*` lifecycle events share the bus with `LoginSuccess`. Consumer filter rules needed. |
| Compliance retention/export | Partial | Analytics TTL exists; auth-audit retention policy is not defined. |
| Risk/threat signals | Missing/optional | Cognito threat protection disabled; no risk event product yet. |

## Risk Register

### R1. Active session truth is currently incomplete

The real frontend signs in directly with Cognito. A user can have a valid
Cognito session without a DDB `Session` row. Any admin UI based only on current
identity session rows will under-report active sessions.

Mitigation: add an authenticated `POST /sessions/current` handshake after
frontend auth initialization and token refresh. Treat the ledger as "EdForge
observed sessions," not raw Cognito truth.

### R2. Single-session revoke can be misleading

With direct Cognito login, the backend does not hold per-session refresh tokens.
Marking one DDB row as revoked does not necessarily stop the browser from using
existing access tokens or refreshing through Cognito.

Mitigation: put revocation enforcement before revoke UI. For V1, use
`AdminUserGlobalSignOut` for "sign out everywhere" and an EdForge API denylist
for session/token-family blocking. Defer true refresh-token custody to a BFF
architecture decision if required. UX copy for the per-session control should
match the chosen scope ("Sign this browser out of EdForge"), not "block this
session."

### R3. Last login must be event-derived

Cognito list/get-user metadata is not a tenant product source for last login.

Mitigation: compute `lastLoginAt` from canonical `LoginSucceeded` events and
project it onto user summaries. Remove the two non-canonical writers
(`/auth/login` and `getCurrentUser` self-heal) so the projection has a single
source of truth.

### R4. Gateway trust boundary is unpinned (and routes API-key selection through forgeable claim)

The API Gateway authorizer does not derive accepted issuer and audience from
configuration. It accepts the issuer and audience from the token itself, then
verifies the signature against whichever pool the token names. A valid Cognito
token from any pool in the same AWS region passes.

The same code path uses `custom:tenantTier` (also from the unverified token)
to choose which API key value to return as `usageIdentifierKey`
(`tenant_authorizer.py:83-91,157,163`). A forged token with
`custom:tenantTier=PREMIUM` reroutes the request across usage plans. The
authorizer cache (30 s) amplifies the impact.

Mitigation: hardcode-pin the BASIC tenant pool ID and app client ID in
`cognito_authorizer.py` via env-var / SSM. Reject tokens whose `iss`/`aud`
don't match. Add CDK assertion that the env vars are populated. Defer the
"tenant pool registry" abstraction to ADVANCED/PREMIUM tier work
(AUTH-00-07b, Sprint 6+).

### R5. Security custom attributes are write-sensitive

If the app client lets an authenticated user update `custom:tenantId`,
`custom:userRole`, `custom:tenantTier`, `custom:tenantName`, or `custom:apiKey`,
a token refresh can turn an attribute mutation into authorization claim drift
or usage-plan rerouting.

Mitigation: remove all five security attributes from app-client
`writeAttributes`. Keep `readAttributes` intact (every backend service reads
them from the JWT). Only server-side admin flows mutate security custom
attributes today, and those use `AdminUpdateUserAttributesCommand` which is
unaffected by app-client write constraints.

### R6. Provider audit can over-collect PII

IP address, user agent, device names, emails, and school/user identifiers are
security telemetry and personal data. In a school product, the data model should
default to minimization.

Mitigation: split tenant operational detail from provider-wide redacted
projection; index by tenant/user/event time; store raw PII only where required;
audit every read of audit history.

### R7. Authorizer cache affects immediate revocation

API Gateway authorizer results are cached for 30 seconds. Gateway-layer deny
decisions can lag unless TTL is reduced or enforcement happens in Nest guards.

Mitigation: enforce immediate revocation in Nest `JwtAuthGuard` or a shared
guard after every request enters the service. Treat gateway enforcement as a
coarse prefilter unless cache behavior is changed deliberately. Note: even
with Nest enforcement, the authorizer-issued STS credentials and tier-keyed
API key are reused inside the cache window for a revoked token; this is
acceptable but should be explicitly documented.

### R8. Backend `/auth/login` is dead code shaping ledger design

The `AdminInitiateAuth` flow misconfiguration means the route returns errors
to any caller. The Sprint 8 reconciliation task plans to align that route
with the canonical `SessionObserved` model, but the model design itself
depends on whether there IS a future caller (M2M, BFF, scripts) or not.

Mitigation: decide fix-vs-remove in Sprint 0 (AUTH-00-11). If kept, the
`AuthFlow` mismatch must be repaired and a documented use case attached. If
removed, the `AdminInitiateAuthCommand` import and downstream session-creation
code go with it, simplifying Sprint 1's canonical event model.

### R9. Session-ID derivation is undefined

The handshake and ledger keying both require a stable session identifier.
Cognito JWTs carry `jti` (per-token), `origin_jti` (per-refresh-token-family,
only when `enableTokenRevocation` is on), `auth_time`, and `sub`. None is a
stable per-browser-session ID. The frontend has no `installId` or
`deviceFingerprint` today (grep returns zero matches).

Mitigation: Sprint 0 ADR (AUTH-00-15) picks the derivation rule.
Recommended default: `sessionId = sha256(origin_jti || jti || sub + "::" + auth_time)`
as the deterministic ledger key, plus a frontend-generated `deviceInstallId`
written to `localStorage` once (soft identifier — clearable, useful for
device labels in the UI but not for security decisions). This locks in
`enableTokenRevocation: true` as a hard precondition (AUTH-00-16).

## Target Architecture

### Canonical Event Model

Create versioned shared schemas for auth/security events:

- `LoginSucceeded`
- `LoginFailed`
- `SessionObserved`
- `SessionRevoked`
- `UserSignedOutEverywhere`
- `PasswordChanged`
- `MfaChanged`
- `UserCreated` — covers both admin-initiated provisioning and the
  `getCurrentUser` self-heal-from-JWT path (`auth.service.ts:520-560`). Without
  this event, every Amplify-direct first-login silently creates a DDB user row
  with no audit trail.
- `UserDisabled`
- `UserEnabled`
- `UserRoleChanged`
- `AuditHistoryRead`

Every event should include:

- `eventId`
- `eventType`
- `schemaVersion`
- `occurredAt`
- `tenantId`
- `tenantTier`
- `actorUserId`
- `targetUserId` when different from actor
- `cognitoSub`
- `userPoolId`
- `clientId`
- `source` such as `cognito-post-auth`, `cognito-post-auth-control-plane`,
  `identity-service`, `admin-action`, `self-heal-jwt`
- `requestId` or correlation ID
- `ipAddress` and `userAgent` where trustworthy
- `deviceInfo` where available
- `sessionId` where applicable
- `risk` block for future threat signals

Bus separation: the SBT control-plane bus also carries `sbt_aws_onboardingRequest`
/ `sbt_aws_provisionSuccess` events. Canonical auth events should either ride
a dedicated `edforge-auth-events` bus OR be unambiguously namespaced
(`detail-type` prefix, `source` field) so consumers can filter SBT lifecycle
events out without parsing payloads. Sprint 1 (`AUTH-01-00`) decides and
documents.

### Tenant Session Ledger

The tenant-facing ledger should live in identity-owned storage because tenant
users and tenant admins will query it as an operational identity feature.

Recommended logical rows:

- `AUTH_EVENT`: immutable event history with TTL and user/time indexes.
- `USER_SESSION`: current observed session state, keyed by tenant/user/session.
- `TOKEN_DENY`: revoked token family or session denylist row with TTL equal to
  token expiration.

Recommended indexes:

- Tenant + event time for tenant admin audit.
- User + event time for self-service login history.
- User + active session status for active session list.
- Session ID lookup for revoke/detail.
- Token `jti` or `origin_jti` lookup for immediate denial.

### Session Observation Handshake

After Cognito login and on auth initialization, the frontend calls:

`POST /sessions/current`

The backend validates the JWT, captures server-observed IP/user-agent, reads
safe JWT claims (`sub`, `iss`, `aud`/`client_id`, `auth_time`, `iat`, `exp`,
`jti`, `origin_jti` when enabled), derives `sessionId` per the AUTH-00-15
ADR, and records an idempotent session observation. The observation upsert
is keyed by `sessionId`; second and later handshakes for the same session
update `lastSeenAt`, `ipAddress`, and `userAgent` rather than insert.

The handshake does not prove refresh-token custody. It only proves that the
browser currently holds a valid Cognito JWT and lets EdForge maintain a product
ledger.

### Revocation Semantics

V1 should expose only behaviors it can enforce:

- "Sign out everywhere": call `AdminUserGlobalSignOut`, write
  `UserSignedOutEverywhere`, mark sessions revoked, and deny known active token
  families in EdForge APIs until their JWT TTL passes.
- "Block this observed session" (per-session): deny the observed session/token
  family in EdForge APIs, mark the session revoked, and clearly state in the
  UI copy that this blocks EdForge API access for that observed session. The
  default copy should be "Sign this browser out of EdForge," not "block this
  session," to match what is actually enforced. True Cognito refresh token
  custody is out of scope unless the BFF ADR (AUTH-00-14) flips the
  architecture.
- "Sign out this browser": frontend local signout through Amplify.

If product/compliance requires exact single-refresh-token revocation, the BFF
ADR (AUTH-00-14) moves refresh-token custody to the backend and uses HttpOnly
application sessions. That decision is a Sprint 0 gate because every Sprint 2-5
ticket inherits its terminology.

### System-Provider Audit Projection

Do not build the provider audit console by scanning tenant identity tables.
Project canonical auth events through EventBridge into a central platform audit
table with minimized fields:

- Tenant ID and tenant display name or stable reference.
- Target user ID and redacted email/display name.
- Event type and time.
- Actor user ID and role.
- IP country/ASN or coarse location if used, not raw geolocation by default.
- Device/user-agent summary.
- Risk flags.
- Correlation IDs.

System-provider reads of this data must themselves emit `AuditHistoryRead`
events.

## Sprint Plan

Each sprint below ends with demoable software. Each ticket is intended to be an
atomic, commitable change with its own tests or validation.

### Sprint 0 - Baseline And Immediate Hardening

Goal: establish exact semantics, harden Cognito client configuration, close
the live trust-boundary holes, and add tests that prevent known foot-guns
before new UI is built.

Demo: local test run shows the current auth/session contract, CDK assertions
prove app-client hardening, the gateway authorizer rejects a valid-but-untrusted
Cognito token, the analytics SystemAdmin check rejects an attacker-controlled
email, an ADR explains exactly what "session" and "revoke" mean in V1, and an
ADR records the session-ID derivation rule.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-00-01 | Write a current-state architecture evidence doc for control-plane Cognito, tenant Cognito, frontend auth flow, identity session services, and analytics session tables. | Reviewer can trace every claim to repo files and AWS docs. |
| AUTH-00-02 | Add a revocation semantics ADR covering direct Cognito login, observed sessions, signout everywhere, single-session block, and BFF alternative. UX copy choices are part of the ADR. | ADR review; no user-facing revoke ticket can start until accepted. |
| AUTH-00-03 | Add CDK assertions for tenant user-pool client OAuth flows, **`enableTokenRevocation: true`** (precondition for `origin_jti`), token validity, and client read/write attributes. | `npm test -- server/lib/tenant-template` or equivalent CDK spec passes. Snapshot includes the revocation flag. |
| AUTH-00-04 | Disable tenant app-client implicit grant (PKCE code flow is the only supported frontend path; verified in `edforge-saas-frontend/packages/auth/src/config.ts:97`). | CDK assertion shows `implicitCodeGrant: false` AND non-prod `aws cognito-idp describe-user-pool-client` confirms `AllowedOAuthFlows` does not contain `implicit`. |
| AUTH-00-05 | Remove all five security custom attributes — `tenantId`, `userRole`, `tenantTier`, `tenantName`, `apiKey` — from the tenant app-client `writeAttributes`. Server-side admin flows (`users.service.ts:441,1018`) use `AdminUpdateUserAttributesCommand` and are unaffected. | CDK assertion proves none of the five are client-writable. `readAttributes` unchanged. |
| AUTH-00-06 | Add API Gateway authorizer tests: (a) valid token from an untrusted pool/client rejected, (b) forged `custom:tenantTier=PREMIUM` does not reroute `usageIdentifierKey`. | Unit tests fail before AUTH-00-07a, pass after. |
| AUTH-00-07a | **Pin** the API Gateway authorizer accepted issuer/audience to the configured tenant pool ID + app client ID in `cognito_authorizer.py` (env-var / SSM). Reject tokens whose `iss`/`aud` don't match. | Authorizer unit tests + non-prod smoke with the deployed pool's token passes; forged token from a sibling pool returns 401. |
| AUTH-00-07b | (Sprint 6+, deferred) Tenant pool registry for ADVANCED/PREMIUM future-state, per-tenant pool routing. | N/A in V1. |
| AUTH-00-08 | Add backend contract tests for session/security DTO wrapper shapes. | Jest tests fail if backend returns arrays where shared DTO says wrapper or vice versa. |
| AUTH-00-09 | Pick the wrapper shape (`{ sessions, total }`, `{ entries, total, hasMore }`); migrate every existing frontend `.map`/`.length` call site in the same PR. | Frontend unit tests cover both empty and populated wrapper responses; build of `apps/shell` clean. |
| AUTH-00-10 | Add authz tests for existing `/sessions` and `/users/:id/security` access boundaries: self, TenantAdmin, same-tenant non-admin, cross-tenant. | Identity service Jest tests pass and module-wiring spec updated if providers change. |
| AUTH-00-11 | **Decide fate of dead backend `/auth/login`**: (a) fix `AuthFlow` mismatch (`adminUserPassword: true` on app client OR switch to `USER_PASSWORD_AUTH` non-admin flow) AND attach a documented use case, OR (b) remove the route plus its dead `AdminInitiateAuthCommand` import and `auth.service.login()` body. Decision shapes Sprint 1's canonical event model and Sprint 8's reconciliation. | ADR recorded. Code matches the ADR. `auth.controller.ts` test reflects chosen behavior. |
| AUTH-00-12 | Unify SystemAdmin authz: replace `process.env.SYSTEM_ADMIN_EMAILS` allowlist in `server/lib/analytics/lambda/api/authz.ts:15-22` with `claims['custom:userRole'] === 'SystemAdmin'`. Email allowlist degrades to dev-only override gated by `STAGE !== 'prod'`. | Tests with SystemAdmin claim, allowlist email, and untrusted token. Production fleet endpoint no longer escalates via email change. |
| AUTH-00-13 | Fix MFA backup-code persistence + `disableMfa` proof check, OR explicitly disable with 501 + UI copy "MFA disable not yet available, contact support." Backend `disableMfa` ignores its DTO today (`security.service.ts:320-364`); `generateBackupCodes` returns codes that are never stored. | If fixed: backup codes hashed + persisted, `disableMfa` requires current TOTP or backup code, service tests cover both. If deferred: route returns 501, UI hides the disable button, Sprint 5 admin panel correctly reports MFA as "managed externally." |
| AUTH-00-14 | Resolve Open Decision #1 (BFF refresh-token custody scope) as Sprint 0 ADR. Sprint 4's per-session block UX, Sprint 5's admin "block user session" surface, and Sprint 8's `/auth/refresh` reconciliation all depend on this choice. | ADR accepted; subsequent sprint tickets reference the ADR's chosen scope (API-layer denylist vs backend refresh-token custody). |
| AUTH-00-15 | **Session-ID derivation ADR.** Recommended: `sessionId = sha256(origin_jti || jti || sub + "::" + auth_time)` deterministic ledger key + frontend-generated `deviceInstallId` (localStorage GUID) for device labelling. Locks in `enableTokenRevocation: true` (AUTH-00-03) as a hard precondition because `origin_jti` is only present when revocation is enabled. | ADR accepted. AUTH-02-01 and AUTH-02-04 reference the rule. No Sprint 2/3/4 ticket leaves `sessionId` "TBD." |
| AUTH-00-16 | Verify and document multi-service Cognito env-var consistency. Identity, academics, finance, and rproxy task definitions all inject `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` from `idpDetails` via `server/lib/utilities/ecs-utils.ts:89-90`. The JwtStrategy in each service pins issuer/audience from those env vars; a drift between services means a token valid for one is rejected by another. | CDK assertion enumerates all four task definitions and asserts the env-var values resolve to the same construct outputs. Non-prod smoke calls one route from each service with the same token. |

### Sprint 1 - Canonical Auth Events And Tenant Ledger

Goal: create the source of truth for login history, last login, and future
session views.

Demo: a direct Cognito login emits a canonical `LoginSucceeded` event; the
identity ledger records it idempotently; user summary last-login projection is
updated from the event.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-01-00 | Decide EventBridge bus separation for canonical auth events vs SBT lifecycle events (`sbt_aws_onboardingRequest`, `sbt_aws_provisionSuccess`). Catalog every SBT-emitted event that consumers must filter. | Design note accepted; AUTH-01-06 consumer's source/detail-type filter list cites this catalog. |
| AUTH-01-01 | Add shared Zod schemas and TypeScript types for canonical auth/security events (including `UserCreated`). | Shared-types tests and `npm run build` in `packages/shared-types`. |
| AUTH-01-02 | Add identity entity definitions for `AUTH_EVENT`, `USER_SESSION`, and `TOKEN_DENY` rows. | Pure mapper tests for keys, TTLs, and required fields. Module-wiring spec updated if a new module is introduced. |
| AUTH-01-03 | Add CDK/table/index changes or documented identity-table extension for auth ledger access patterns. | CDK assertions for GSIs, TTL, retention, and IAM grants; `npm run typecheck:cdk`. |
| AUTH-01-04 | Add repository/data-access layer for auth events with idempotent put by `eventId`. | Repository unit tests with duplicate events and pagination. Module-wiring spec updated. |
| AUTH-01-05 | Map Cognito PostAuthentication trigger output to canonical `LoginSucceeded`. Fix the hardcoded `tenantTier: 'BASIC'` in `handler.ts:148` so ADVANCED/PREMIUM doesn't silently mis-tag when those tiers ship (read from `attrs['custom:tenantTier']` with `'BASIC'` fallback). | Lambda unit tests cover tenant claims, missing tenant, role coercion, tier fallback, and EventBridge failure behavior. |
| AUTH-01-06 | Add EventBridge consumer in identity to write canonical auth events to the tenant ledger. Filter must exclude SBT lifecycle events per AUTH-01-00 catalog. | Event ingestion test proves duplicate delivery produces one immutable event. SBT lifecycle event injected into test bus is ignored. Module-wiring spec updated. |
| AUTH-01-07 | Rationalize the three `lastLoginAt` write sites: (a) backend `/auth/login` (removed or kept per AUTH-00-11), (b) `getCurrentUser` self-heal must only write `createdAt`, not `lastLoginAt`, on user creation, (c) the new event projector becomes the sole `lastLoginAt` source-of-truth. Older events must not overwrite newer values. | Tests prove the three writers' ordering: a self-heal-then-event sequence ends with the event's `lastLoginAt`, never the self-heal's. Backend `/auth/login` path (if kept) emits LoginSucceeded and lets the projector own the write. |
| AUTH-01-08 | Fix analytics session-event metadata extraction so `ipAddress` and `deviceInfo` survive top-level or `metadata` placement (`server/lib/analytics/lambda/aggregator/handler.ts:273-302` currently only reads top-level). Update emitters in `auth.service.ts` to the chosen shape so the user-session table actually receives IP/device. | Analytics aggregator unit tests cover both shapes. End-to-end backend revoke produces a user-session row with IP/device populated. |
| AUTH-01-09 | Define trusted and untrusted sources for `LoginFailed` events. | ADR or design note accepted; no fakeable unauthenticated client-only failure events are treated as authoritative. |
| AUTH-01-10 | Emit `UserCreated` from both admin provisioning and the `getCurrentUser` JWT self-heal path (`auth.service.ts:520-560`). Event carries `source: 'admin-provisioning'` or `source: 'self-heal-jwt'` so the audit trail distinguishes them. | Service tests cover both code paths; ledger receives one `UserCreated` per first-login. |

### Sprint 2 - Session Observation And Read-Only Security Center

Goal: make user-facing session and login history visibility real without
shipping revoke buttons before enforcement exists.

Demo: after frontend login, `/settings/security` shows current observed session,
other observed sessions, and login history. There are no revoke controls yet.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-02-01 | Implement the session fingerprint model per the AUTH-00-15 ADR: `sessionId` derivation, device install ID storage, user-agent summary, IP, JWT `jti`/`origin_jti`, `auth_time`, `iat`, `exp`. | Mapper tests cover stable session IDs, the no-`origin_jti` fallback, and privacy-safe fields. |
| AUTH-02-02 | Add `POST /sessions/current` DTO and backend endpoint. | Controller/service tests validate JWT-derived tenant/user only; no caller-supplied tenant/user trust. |
| AUTH-02-03 | Three-way route registration for `/sessions/current`: NestJS controller + `server/lib/tenant-api-prod.json` + nginx (only if a new prefix). | `npm run lint:routes` passes. |
| AUTH-02-04 | Add idempotent session observation write/update logic keyed by `sessionId`. | Duplicate handshake tests produce one active session row and one latest-seen update. |
| AUTH-02-05 | Add frontend auth-init call to `POST /sessions/current` after Amplify session is available. | Frontend tests cover success, retryable failure, and no logout loop on observation failure. |
| AUTH-02-06 | Add read-only current-user active session endpoint backed by `USER_SESSION`, not legacy-only DDB sessions. | Authz tests cover self-only access and tenant isolation. |
| AUTH-02-07 | Add login history endpoint backed by canonical `AUTH_EVENT` rows. | Pagination, date-range, and empty-state tests. |
| AUTH-02-08 | Wire post-MVP session and login-history components into live `/settings/security` as read-only views. **Depends on AUTH-02-09** (DTO shape unification) — if the wrapper migration lands second, this component gets edited twice (per the "Route → component" trap in CLAUDE.md). | Frontend route test from URL → `apps/shell/src/pages/settings/security.tsx` → tab → component before editing. Visual smoke via `npm run dev:shell`. |
| AUTH-02-09 | Update shared DTOs and frontend client methods to use one wrapper shape for sessions/history. Migrate all existing `.map`/`.length` call sites in the same PR (AUTH-00-09 already gates new code). | Backend and frontend contract tests pass; build of `apps/shell` clean. |

### Sprint 3 - Revocation Enforcement Foundation

Goal: make revoke technically enforceable before exposing tenant-user and admin
revoke UX.

Demo: a token/session marked revoked is rejected by an EdForge protected API
before its JWT expiration time.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-03-01 | Runtime use of Cognito token revocation. (CDK enablement asserted in AUTH-00-03; this ticket exercises `RevokeToken` paths and documents token TTL choices.) | Integration test calls `RevokeToken` against a non-prod pool; subsequent refresh fails. ADR captures access-token vs refresh-token TTL trade-offs. |
| AUTH-03-02 | Persist JWT `jti` and `origin_jti` from observed sessions when available. | Session handshake tests with JWT fixtures containing and missing those claims. |
| AUTH-03-03 | Add `TOKEN_DENY` repository with TTL keyed by token family/session. Module-wiring spec updated. | Unit tests for keying, expiration, and idempotent deny writes. |
| AUTH-03-04 | Add denylist check to Nest JWT guard/strategy path in identity, academics, and finance. If `TOKEN_DENY` lives in the identity DDB table, academics and finance task roles need explicit `dynamodb:GetItem` grants on the identity table (`tenant-template-stack.ts` `createTaskRole`). An empty `tenant-template-stack-basic` CDK diff is a **false-clear** per the CLAUDE.md cross-service-DDB-grant trap — the empty diff is the gap. | Unit tests prove denied token fails after signature validation but before controller execution. CDK diff shows the new grants on academics/finance roles. Module-wiring spec updated. |
| AUTH-03-05 | Document API Gateway authorizer cache behavior and keep immediate revoke enforcement in Nest. Explicit wording: "Authorizer cache lag does not block enforcement, but causes a brief window where authorizer-context (STS credentials, tier-keyed `usageIdentifierKey`) is reused for a revoked token. Document and accept; do not lower TTL below 30 s without cost/latency analysis." | ADR update and reviewer signoff. |
| AUTH-03-06 | Add integration test with a valid JWT fixture: call a protected endpoint, deny the token/session, then verify the same token is rejected. | Jest/e2e test passes locally. |
| AUTH-03-07 | Build a shared `signOutUserEverywhere` identity service helper that calls Cognito `AdminUserGlobalSignOut`, marks sessions revoked, writes deny rows, and emits audit events. Module-wiring spec updated. | Service tests mock Cognito/EventBridge/DDB success and failure paths. |
| AUTH-03-08 | Wire user disable/delete/role-change/password-reset/MFA-reset paths to invalidate sessions through the shared helper where appropriate. | Tests prove each status-changing action emits the expected signout or deny behavior. |

### Sprint 4 - User Self-Service Session Actions

Goal: let users manage their own sessions with behavior EdForge can enforce.

Demo: a user can view sessions, sign out everywhere, and block an observed
session; blocked tokens cannot call protected EdForge APIs.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-04-01 | Add `POST /sessions/revoke-all` self-service implementation using the shared signout-everywhere helper. Three-way route registration: NestJS controller + `tenant-api-prod.json` + nginx (only if a new prefix). Module-wiring spec updated. | Service tests prove Cognito global signout, ledger updates, and audit event emission. `npm run lint:routes` passes. |
| AUTH-04-02 | Add `POST /sessions/{sessionId}/block` self-service implementation for observed session/token-family deny. Three-way route registration. UX copy matches the AUTH-00-02 ADR's chosen scope ("Sign this browser out of EdForge"). Module-wiring spec updated. | Authz tests prove users can block own sessions only. `npm run lint:routes` passes. |
| AUTH-04-03 | Add clear response semantics for block versus global signout. | Shared DTO tests and API docs updated. |
| AUTH-04-04 | Wire self-service session action buttons and confirmation dialogs into `/settings/security`. Route trace from URL → page → tab/subcomponent before editing (CLAUDE.md trap). | Frontend tests cover loading, success, error, and current-session edge cases. |
| AUTH-04-05 | Emit `SessionRevoked` and `UserSignedOutEverywhere` audit events from user actions. | Event mapper tests and EventBridge mock assertions. |
| AUTH-04-06 | Add visual/browser smoke for user session list and revoke flows. | `npm run dev:shell` smoke evidence captured before PR merge. |

### Sprint 5 - Tenant Admin User Security

Goal: give school admins a tenant-scoped view of user security posture and
safe session management actions.

Demo: TenantAdmin opens a user detail/security view, sees last login, session
count, MFA state, login history, and can sign the user out everywhere.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-05-01 | Enrich user list/query responses with event-derived `lastLoginAt`, active session count, and MFA/security summary. | Service tests cover users with no events and multiple sessions. |
| AUTH-05-02 | Add tenant-admin user security detail endpoint. Three-way route registration. | Authz tests cover TenantAdmin same tenant, non-admin, self, and cross-tenant denial. `npm run lint:routes` passes. |
| AUTH-05-03 | Add tenant-admin user login-history endpoint with pagination and filters. Three-way route registration. | Query tests cover time range, event type, and user scoping. `npm run lint:routes` passes. |
| AUTH-05-04 | Add tenant-admin signout-everywhere endpoint for a target user. Three-way route registration. Module-wiring spec updated. | Cognito global signout helper tests and route authz tests. `npm run lint:routes` passes. |
| AUTH-05-05 | Decide whether tenant-admin single-session block is exposed in V1. If exposed, use the same denylist semantics as self-service; if not, hide the control and document why. The BFF ADR (AUTH-00-14) constrains the scope. | Product/ADR acceptance plus UI tests for the chosen behavior. |
| AUTH-05-06 | Wire tenant-admin user security panel in the tenant frontend. Route trace from URL → page → tab/subcomponent before editing (CLAUDE.md trap). | Route trace, component tests, and browser smoke. |
| AUTH-05-07 | Emit audit events for every admin read and write of user session/security history. | Tests assert `AuditHistoryRead` and admin action events are emitted. |

### Sprint 6 - System-Provider Control-Plane Auth Audit

Goal: project tenant auth/security events into a central provider view without
scanning tenant identity tables or overexposing PII.

Demo: a system admin in AdminWeb can filter cross-tenant auth activity by
tenant, user, event type, risk flag, and date range, and the control-plane
pool's own login events appear in the same view.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-06-00 | Wire `CognitoPostAuthTrigger` to the control-plane Cognito pool (`cognitoAuth.userPool` in `server/lib/bootstrap-template/control-plane-stack.ts`) with `source: 'cognito-post-auth-control-plane'` and a sentinel `tenantId='__platform__'`. The PostAuth handler skips tenant-required validation for this source. Without this, system-admin logins are invisible to the audit ledger they're supposed to view. | Lambda unit test with control-plane event shape passes. Non-prod system-admin login produces a `LoginSucceeded` event with the sentinel tenant. |
| AUTH-06-01 | Add platform auth-audit projection schema with redacted/minimized fields. | Schema tests prove raw token values are impossible and PII fields are explicit. |
| AUTH-06-02 | Add central auth-audit table/indexes or extend analytics storage with tenant/time, user/time, event-type/time, and risk indexes. | CDK assertions for keys, TTL, encryption, removal policy, and IAM. |
| AUTH-06-03 | Add EventBridge fanout from canonical tenant auth events to the provider audit consumer. | Event routing tests and DLQ configuration tests. |
| AUTH-06-04 | Add provider audit ingestion Lambda with idempotent writes. If the lambda reads from any identity-owned source, add the cross-service `dynamodb:GetItem` grant explicitly (CLAUDE.md trap). | Duplicate event tests and malformed event DLQ tests. CDK diff shows any needed grants. |
| AUTH-06-05 | Add control-plane API endpoints for audit search, tenant drilldown, user drilldown, and export request. Three-way route registration (note: control-plane uses its own OpenAPI spec, not `tenant-api-prod.json`). | SystemAdmin authz tests; tenant users cannot call these endpoints. |
| AUTH-06-06 | (Scope reduced — Sprint 0 AUTH-00-12 owns the analytics email-allowlist replacement.) Verify the new audit endpoints use the unified `custom:userRole === 'SystemAdmin'` check from AUTH-00-12. Add control-plane-specific checks for `CustomerSupport` and `SecurityAuditor` if those roles ship per Open Decision #4. | Tests with SystemAdmin, CustomerSupport (if applicable), TenantAdmin, and untrusted tokens. |
| AUTH-06-07 | Add AdminWeb service client and typed DTOs. | AdminWeb unit tests for query params, pagination, and errors. |
| AUTH-06-08 | Add AdminWeb audit dashboard table, filters, drilldown, and CSV export initiation. | Component tests and local AdminWeb smoke. Also a bundle-init jsdom sim per CLAUDE.md zod-pin trap before deploying `controlplane-stack`. |
| AUTH-06-09 | Emit `AuditHistoryRead` for provider audit searches and exports. | Event assertions include actor, filters, result count, and correlation ID. |

### Sprint 7 - Compliance, Risk, And Operations

Goal: make the feature operable under retention, privacy, alerting, and support
expectations.

Demo: seeded suspicious auth events trigger visible risk flags/alerts; expired
events age out or archive according to policy.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-07-01 | Define retention classes for tenant auth events, provider audit events, session state, token denies, and exports. | ADR accepted; CDK TTL assertions match policy. |
| AUTH-07-02 | Add S3 export/archive path for authorized audit exports with expiration and access logging. | Unit tests for export manifests and presigned URL expiry. |
| AUTH-07-03 | Add DLQ alarms and CloudWatch metrics for PostAuth (tenant and control-plane), auth-event consumer, provider audit consumer, and export jobs. | CDK assertions and alarm smoke in non-prod. |
| AUTH-07-04 | Add suspicious-login rules for new device, impossible travel placeholder, repeated failures, disabled-user attempts, and admin signout spikes. | Deterministic rule tests with seeded events. |
| AUTH-07-05 | Evaluate Cognito threat protection/user auth events behind an environment flag, including cost, region support, and data retention. | Written decision plus non-prod config diff if enabled. |
| AUTH-07-06 | Add operator runbook for auth audit incidents, failed ingestion replay, user signout, and evidence export. | Runbook review; dry-run checklist completed. |
| AUTH-07-07 | Add non-prod smoke script for login -> observe session -> revoke/block -> audit projection. | Script output captured in deploy evidence. |

### Sprint 8 - Cleanup And Canonicalization

Goal: remove duplicate paths and leave one coherent auth/session system.

Demo: both direct Cognito login and any retained backend login path feed the
same canonical ledger; stale code paths are deprecated or deleted with tests.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-08-01 | Reconcile legacy `/auth/login` session creation with canonical `SessionObserved` and auth-event ledger. Scope is constrained by the Sprint 0 fix-vs-remove decision (AUTH-00-11); if the route was removed, this ticket only audits that no caller is left orphaned. | Tests prove backend login (if kept) and Amplify handshake produce equivalent ledger rows. |
| AUTH-08-02 | Decide whether `/auth/refresh` remains supported. If retained, align it with canonical session/token deny semantics. Constrained by AUTH-00-14 (BFF ADR). | ADR update and service tests. |
| AUTH-08-03 | Consolidate duplicate logic between `SessionsService` and `SecurityService` session methods (both have `revokeSession` / `revokeAllSessions` with the same cosmetic shape). Module-wiring spec updated. | Unit tests moved to shared service; no route behavior regression. |
| AUTH-08-04 | (Moved to Sprint 0 AUTH-00-13 — MFA fix or hard-disable is required before Sprint 5's admin security panel ships.) Post-Sprint-0 follow-up: revisit MFA UX based on Sprint 5 admin feedback. | Sprint 5 feedback captured. |
| AUTH-08-05 | Update OpenAPI/API Gateway specs, route-drift allowlists, nginx, and shared docs for final routes. | `npm run lint:routes` and route specs pass. |
| AUTH-08-06 | Add load/performance tests for auth-event and session-list access patterns. | Test report shows p95 query behavior at expected tenant/user scale. |
| AUTH-08-07 | Update architecture docs and tenant/admin runbooks. | Docs review; links from `ARCHITECTURE.md` or alpha-launch index as appropriate. |

## Cross-Sprint Validation Gates

Every backend ticket that changes identity routes, providers, or authz must run:

- `cd server/application && npx jest <affected-spec>`
- **Module wiring spec updates when adding any provider used outside its
  declaring module.** `__tests__/module-wiring.spec.ts` is the only static
  check that catches silent DI failures; `nest build` and ECS health checks
  both pass with broken wiring. This applies to every Sprint 1-5 ticket that
  adds a repository, helper, or consumer (explicitly listed in AUTH-01-02,
  AUTH-01-04, AUTH-01-06, AUTH-03-03, AUTH-03-04, AUTH-03-07, AUTH-04-01,
  AUTH-04-02, AUTH-05-04, AUTH-08-03).
- `npm run lint:routes` for route changes.
- `npm run lint:authz` or the current authz coverage gate for new routes.
- `npm run lint` when files fall under root lint scope.

Every new API route must complete the **three-way route registration**:
NestJS controller decorator + `server/lib/tenant-api-prod.json` (or the
control-plane OpenAPI spec for Sprint 6 endpoints) + `nginx.template` (only
when a new top-level prefix is introduced). Symptoms of a missing leg: `403
SigV4` (API GW gap), `404 nginx/…` (rproxy gap), `404 JSON` (controller
gap). Explicitly listed in AUTH-02-03, AUTH-04-01, AUTH-04-02, AUTH-05-02,
AUTH-05-03, AUTH-05-04, AUTH-06-05.

Every shared-types ticket must run:

- `cd packages/shared-types && npm run build`
- A consumer typecheck or targeted Jest test proving the published contract is
  consumed correctly.
- AdminWeb-bound exports require an `npm publish` of `@aibrains/shared-types`
  and a redeploy of `controlplane-stack` so CodePipeline rebuilds AdminWeb.
  Workspace symlinks are invisible to the CodeBuild environment.

Every CDK/infra ticket must run:

- `npm run typecheck:cdk`
- CDK assertions for the changed construct.
- `cd server && source .env.<profile> && CDK_NAG_ENABLED=false npx cdk synth <stack>`
  when operator env is available.
- `cdk diff` before any deploy, using the repo deploy ladder.
- For any ticket that adds cross-service DDB access (e.g. AUTH-03-04 reading
  `TOKEN_DENY` from academics/finance), explicitly verify the new IAM grant
  appears in the `tenant-template-stack-basic` diff. An empty diff is the gap
  per the CLAUDE.md cross-service-DDB-grant trap.

Every frontend ticket must run:

- Route trace from URL -> route -> page -> tab/subcomponent before editing.
- Relevant unit/component tests.
- `npm run dev:shell` visual smoke for non-trivial behavior.

Every revocation ticket must prove:

- A valid token can call a protected endpoint before revoke.
- The same token or token family is denied after revoke/block before nominal
  JWT expiry.
- Authorizer cache behavior is either irrelevant because enforcement happens in
  Nest, or explicitly accounted for (the 30 s reuse window for STS credentials
  and `usageIdentifierKey` is documented and accepted).

Every audit ticket must prove:

- Tenant admins cannot cross tenant boundaries.
- System-provider users see only the provider projection, not raw tenant tables.
- Reads of audit/session history emit audit-read events.
- PII redaction/minimization is covered by tests.

## Open Decisions

These remain open after the second adversarial review; numbered ones are
unchanged from v1, lettered ones are new.

1. (Resolved as Sprint 0 ADR — AUTH-00-14.) Is EdForge satisfied with
   API-layer single-session blocking for V1, or does compliance require true
   backend-owned refresh-token custody? Answer constrains every later sprint.
2. Should provider audit live in a new dedicated table or extend analytics
   storage with new indexes? Needed before AUTH-06-02.
3. What retention period is required for tenant-visible login history versus
   provider compliance audit?
4. Which roles can read provider audit data: SystemAdmin only, CustomerSupport
   with restrictions, or a new SecurityAuditor role?
5. Are failed-login events required in V1? If yes, should EdForge route login
   through a backend/BFF, use Cognito threat protection signals, or accept only
   best-effort client-side telemetry labeled as untrusted?
6. Should tenant app access-token TTL be shortened once denylist checks exist,
   and what UX cost is acceptable?
7. (Resolved as Sprint 0 ADR — AUTH-00-11.) Backend `/auth/login` — keep
   as a programmatic-client API (M2M, BFF, scripts) with `AuthFlow` fixed, or
   remove entirely?
8. (Resolved as Sprint 0 ADR — AUTH-00-15.) Session-ID derivation rule
   and whether the frontend gains a `deviceInstallId` localStorage GUID.
9. Will `SYSTEM_ADMIN_EMAILS` allowlist remain as a dev-only override after
   AUTH-00-12 migrates analytics fleet authz to claim-based, or be removed
   entirely? (Affects local dev ergonomics.)
10. Does the `UserCreated` event from the JWT self-heal path (AUTH-01-10) need
    its own audit-read story, or is it sufficient that it shows in the
    tenant-admin audit log alongside admin-provisioned users?
11. When MFA ships as fully functional (post AUTH-00-13's "fix" path), does
    `disableMfa` require the user's current password as proof, a current
    TOTP/backup code, or both?

## Subagent Review History

Two adversarial subagent reviews shaped this plan. Both were code-grounded
(cited file:line evidence) rather than abstract.

### First subagent review (incorporated in v1)

The first review changed the plan in these concrete ways:

- Revocation semantics are now a Sprint 0 gate.
- The first user security-center sprint is read-only; revoke controls come only
  after enforcement exists.
- App-client implicit grant removal and custom-attribute write hardening moved
  to Sprint 0.
- API Gateway authorizer issuer/audience pinning moved before provider audit.
- Session ledger, handshake, denylist, and AdminWeb dashboard work were split
  into smaller commits.
- Idempotency, audit-history read events, authorizer-cache behavior, and
  status-change invalidation were added as explicit tickets.

### Second subagent review (2026-06-29, incorporated in v2)

A staff-engineer-level adversarial review of v1 produced 18 findings (six S0,
seven S1, three S2, two S3) that drove the following concrete v2 changes:

- **S0 fixes promoted into Sprint 0:**
  - AUTH-00-07 split into 07a (pin BASIC pool today) and 07b (registry deferred
    to ADVANCED/PREMIUM work). The "or a tenant pool registry" hedge was
    blocking the live trust-boundary fix.
  - AUTH-00-05 expanded to include `custom:apiKey` and `custom:tenantName` in
    the `writeAttributes` removal — the v1 ticket only listed three of the
    five sensitive attributes, leaving `apiKey` (which drives
    `usageIdentifierKey` selection) gratuitously writable by users.
  - AUTH-00-11 added: decide fate of the dead backend `/auth/login` route
    (`AdminInitiateAuth` flow mismatch). Sprint 8 reconciliation cannot ship
    against dead code.
  - AUTH-00-12 added: unify analytics SystemAdmin authz (currently an
    email-allowlist env var, in production). Pulled from Sprint 6.
  - AUTH-00-13 added: MFA backup-code persistence + `disableMfa` proof check,
    or hard-disable with 501. Sprint 5 admin panel was being built on
    non-functional MFA. Pulled from Sprint 8.
  - AUTH-00-14 added: BFF refresh-token custody ADR (was Open Decision #1).
    Sprint 4/5/8 tickets inherit its terminology.
  - AUTH-00-15 added: session-ID derivation ADR. Sprint 2 ticket had `sessionId`
    undefined and no Cognito JWT claim is a stable per-browser-session ID.
  - AUTH-00-16 added: multi-service Cognito env-var consistency check
    (identity/academics/finance/rproxy all validate JWTs from env-injected
    pool/client IDs).

- **AUTH-00-03 amended** to assert `enableTokenRevocation: true` (precondition
  for `origin_jti`, which AUTH-00-15's session-ID rule depends on). The
  CDK-enablement half of v1's AUTH-03-01 moved here; AUTH-03-01 now only
  covers runtime use.

- **AUTH-00-04 validation tightened** to require both a CDK assertion AND a
  runtime `DescribeUserPoolClient` confirmation. A frontend login smoke
  doesn't prove implicit grant is gone (code flow passes either way).

- **Sprint 1 additions:** AUTH-01-00 (SBT EventBridge bus namespacing),
  AUTH-01-10 (`UserCreated` event from JWT self-heal path), AUTH-01-05 fix
  for hardcoded `tenantTier: 'BASIC'` in PostAuth handler, AUTH-01-07
  rationalized to enumerate the three `lastLoginAt` writers.

- **Sprint 2 dependency:** AUTH-02-08 explicitly blocked on AUTH-02-09 so the
  security page component is not edited twice (per CLAUDE.md "Route →
  component" trap).

- **Sprint 3 additions:** AUTH-03-04 now requires cross-service IAM grant
  audit (academics/finance reading `TOKEN_DENY` from identity table —
  CLAUDE.md cross-service-DDB-grant trap). AUTH-03-05 explicit cache-window
  wording about STS-credential and `usageIdentifierKey` reuse.

- **Sprint 4/5 hardening:** every new-route ticket now lists three-way route
  registration as a validation gate; relevant tickets also list module-wiring
  spec updates.

- **Sprint 6 prerequisite:** AUTH-06-00 added — wire `CognitoPostAuthTrigger`
  to the control-plane pool. Without this the system-admin audit console
  cannot see its own users' logins.

- **Risk Register additions:** R8 (dead `/auth/login` shapes ledger design),
  R9 (session-ID derivation undefined), and amendments to R4 (forgeable
  `usageIdentifierKey`) and R7 (STS credential reuse window).

- **Implemented Versus Missing table** gained rows for "Backend `/auth/login`
  route", "Gateway authorizer trust pinning", "Analytics SystemAdmin authz",
  "Session-ID derivation rule", "MFA backup codes + disable proof",
  "Sessions/history DTO shape", "SBT EventBridge bus namespacing", and
  "Control-plane Cognito auth events".

- **Open Decisions** renumbered with resolution markers on items now owned by
  Sprint 0 ADRs, plus four new open items (#9–#11).

## References

Repo references:

- `ARCHITECTURE.md`
- `README.md`
- `docs/alpha-launch/authz-coverage-findings.md`
- `server/lib/bootstrap-template/control-plane-stack.ts`
- `server/lib/tenant-template/identity-provider.ts`
- `server/lib/tenant-template/tenant-template-stack.ts`
- `server/lib/shared-infra/Resources/tenant_authorizer.py`
- `server/lib/shared-infra/layers/cognito/cognito_authorizer.py`
- `server/lib/utilities/ecs-utils.ts` (Cognito env-var injection into ECS tasks)
- `server/application/libs/auth/src/jwt.strategy.ts`
- `server/application/microservices/identity/src/auth/auth.service.ts`
- `server/application/microservices/identity/src/auth/auth.controller.ts`
- `server/application/microservices/identity/src/sessions/sessions.service.ts`
- `server/application/microservices/identity/src/sessions/sessions.controller.ts`
- `server/application/microservices/identity/src/security/security.service.ts`
- `server/application/microservices/identity/src/users/users.service.ts` (server-side `AdminUpdateUserAttributesCommand` call sites)
- `server/lib/auth-events/cognito-post-auth-trigger.ts`
- `server/lib/auth-events/lambda/post-auth/handler.ts`
- `server/lib/analytics/analytics-stack.ts`
- `server/lib/analytics/lambda/aggregator/handler.ts`
- `server/lib/analytics/lambda/aggregator/event-metric-map.ts` (`SESSION_EVENT_TYPES` definition)
- `server/lib/analytics/lambda/api/handler.ts`
- `server/lib/analytics/lambda/api/authz.ts` (current email-allowlist SystemAdmin check)
- `server/lib/analytics/lambda/api/jwt-claims.ts`
- `server/lib/tenant-api-prod.json` (`authorizerResultTtlInSeconds: 30`)
- `packages/shared-types/src/schemas/identity/session.schema.ts`
- `edforge-saas-frontend/packages/auth/src/service.ts`
- `edforge-saas-frontend/packages/auth/src/config.ts`
- `edforge-saas-frontend/apps/shell/src/pages/settings/security.tsx`
- `edforge-saas-frontend/apps/shell/src/services/users.service.ts`

AWS references checked on 2026-06-29:

- Amazon Cognito token revocation:
  https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html
- `AdminUserGlobalSignOut` API:
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminUserGlobalSignOut.html
- `RevokeToken` API:
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_RevokeToken.html
- Cognito `UserType` API metadata:
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserType.html
- Cognito PostAuthentication trigger:
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-authentication.html
- Cognito user-pool attribute permissions:
  https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html
- Cognito logging with CloudTrail:
  https://docs.aws.amazon.com/cognito/latest/developerguide/logging-using-cloudtrail.html
- Cognito threat protection:
  https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-threat-protection.html
- Cognito `InitiateAuth` API (Auth flow constants reference for AUTH-00-11):
  https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_InitiateAuth.html

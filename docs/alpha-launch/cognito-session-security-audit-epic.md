# Cognito Session Security and Audit Epic Plan

Status: planning baseline
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

## What Cognito Can And Cannot Do Here

AWS Cognito is the correct managed identity provider for this architecture, but
its primitives need to be used honestly:

- Cognito user metadata includes creation, modified, enabled, and status fields.
  It does not provide a complete, queryable tenant product field for "last
  login" or "active sessions." EdForge must derive last login from auth events.
- Cognito refresh-token revocation prevents a refresh token from obtaining new
  access and ID tokens. Existing access and ID JWTs remain self-contained
  bearer tokens unless EdForge adds revocation-aware checks.
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
- Existing analytics fleet access is narrow and email-list based in the
  analytics Lambda, not a complete platform-provider security console.
- Tenant auth activity is not projected into a central, redacted provider audit
  table with tenant/user/time/risk indexes.

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

- The API Gateway Cognito authorizer derives the user pool and client from the
  presented token's issuer/audience instead of pinning trust to configured
  tenant pools or tenant mappings. NestJS does stricter validation later, but
  the gateway trust boundary should be hardened.
- API Gateway authorizer cache TTL is 30 seconds. Any immediate token-denylist
  design must account for this cache if enforcement is placed at the gateway.
- Tenant app client OAuth config still enables implicit grant even though the
  frontend uses authorization code with PKCE.
- Security-critical custom attributes such as `custom:tenantId`,
  `custom:userRole`, and `custom:tenantTier` are included in app-client write
  attributes. Unless there is a proven runtime need, users should not be able
  to mutate security claims through Cognito user-attribute APIs.
- Cognito advanced security/threat protection is disabled.

### Tenant Frontend Flow

The nested tenant frontend in `edforge-saas-frontend` uses Amplify and Cognito
directly. `packages/auth/src/service.ts` performs direct sign-in, Hosted UI
redirects, session fetch, and global signout. `packages/auth/src/config.ts`
configures OAuth code flow.

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

- `/auth/login` creates DDB sessions and updates `lastLoginAt`, but the tenant
  frontend generally bypasses it.
- Session revoke routes mostly mark DDB rows as revoked. They do not reliably
  call Cognito token revocation or `AdminUserGlobalSignOut`.
- The stronger Cognito global signout path exists in
  `AuthService.invalidateAllUserSessions`, but it is not the common path for
  user-facing or admin session revoke.
- Login history rows are separate from analytics login events and are not
  populated by the Cognito PostAuthentication trigger.
- MFA has production-adjacent gaps: backup codes are generated but not clearly
  persisted/validated, and disable flows should verify the requested proof.
- Frontend post-MVP session/login-history components exist, but are not wired
  into the live `/settings/security` page.
- Frontend service methods currently expect array responses for sessions and
  login history, while shared backend DTOs return wrapper objects.

### Existing Analytics Session Code

The analytics stack creates `edforge-user-session-events` and exposes
`/analytics/me/session-history`. The aggregator dual-writes only
`SessionCreated`, `SessionRevoked`, and `SessionRefreshed` events to that table.
`LoginSuccess` events are counted for adoption/auth metrics but are not enough
to power active sessions.

Current limitations:

- Direct Cognito login currently produces `LoginSuccess`, not `SessionCreated`.
- The session-event writer expects `ipAddress` and `deviceInfo` at the top
  level, while existing emitters often place those fields under `metadata`.
- The current user-session table is useful for per-user event history but is
  not a complete tenant/admin/provider auth audit model.

## Implemented Versus Missing

| Capability | Current status | Notes |
| --- | --- | --- |
| Control-plane Cognito | Implemented | System-admin pool and AdminWeb OIDC config exist. |
| Tenant Cognito | Implemented | Tenant pool, app client, custom claims, post-auth trigger. |
| Tenant frontend login | Implemented | Amplify direct Cognito flow; backend session path bypassed. |
| JWT verification in services | Implemented | Nest strategy validates issuer/audience and maps tenant context. |
| Gateway authorizer | Partial | Validates token but should pin trusted issuers/audiences. |
| Route authz coverage | Strong baseline | Existing authz coverage audit is green, but new routes must keep gates. |
| User list last login | Partial/stale | Updated by backend login path only; should be event-derived. |
| Active sessions for real frontend flow | Missing | No first-party session observation handshake yet. |
| User self-service session list | Partial | Backend/DTO/UI pieces exist but are not wired to real ledger. |
| Revoke own session | Partial/cosmetic | DDB updates exist; Cognito/API enforcement incomplete. |
| Admin revoke user sessions | Partial | Global signout helper exists but not consistently exposed/enforced. |
| Login history | Partial | Existing table/path does not receive direct Cognito login events. |
| System-provider cross-tenant auth audit | Missing | Needs central redacted projection and control-plane UI. |
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
architecture decision if required.

### R3. Last login must be event-derived

Cognito list/get-user metadata is not a tenant product source for last login.

Mitigation: compute `lastLoginAt` from canonical `LoginSucceeded` events and
project it onto user summaries.

### R4. Gateway trust boundary should be pinned

The API Gateway authorizer should not derive accepted issuer and audience solely
from the token being validated.

Mitigation: pin trusted user pools/app clients through configuration or a tenant
pool registry and add tests with a valid but untrusted Cognito token.

### R5. Security custom attributes are write-sensitive

If the app client lets an authenticated user update `custom:tenantId`,
`custom:userRole`, or `custom:tenantTier`, a token refresh can turn an attribute
mutation into authorization claim drift.

Mitigation: remove security attributes from app-client write attributes. Only
server-side admin flows should mutate security custom attributes.

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
coarse prefilter unless cache behavior is changed deliberately.

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
- `source` such as `cognito-post-auth`, `identity-service`, `admin-action`
- `requestId` or correlation ID
- `ipAddress` and `userAgent` where trustworthy
- `deviceInfo` where available
- `sessionId` where applicable
- `risk` block for future threat signals

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
`jti`, `origin_jti` when enabled), and records an idempotent session observation.

The handshake does not prove refresh-token custody. It only proves that the
browser currently holds a valid Cognito JWT and lets EdForge maintain a product
ledger.

### Revocation Semantics

V1 should expose only behaviors it can enforce:

- "Sign out everywhere": call `AdminUserGlobalSignOut`, write
  `UserSignedOutEverywhere`, mark sessions revoked, and deny known active token
  families in EdForge APIs until their JWT TTL passes.
- "Block this observed session": deny the observed session/token family in
  EdForge APIs, mark the session revoked, and clearly state that this blocks
  EdForge API access for that observed session. It is not true Cognito refresh
  token custody unless the architecture changes.
- "Sign out this browser": frontend local signout through Amplify.

If product/compliance requires exact single-refresh-token revocation, create a
separate BFF/session-authority ADR. That design would move refresh-token
custody to the backend and use HttpOnly application sessions.

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

Goal: establish exact semantics, harden Cognito client configuration, and add
tests that prevent known foot-guns before new UI is built.

Demo: local test run shows the current auth/session contract, CDK assertions
prove app-client hardening, and an ADR explains exactly what "session" and
"revoke" mean in V1.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-00-01 | Write a current-state architecture evidence doc for control-plane Cognito, tenant Cognito, frontend auth flow, identity session services, and analytics session tables. | Reviewer can trace every claim to repo files and AWS docs. |
| AUTH-00-02 | Add a revocation semantics ADR covering direct Cognito login, observed sessions, signout everywhere, single-session block, and BFF alternative. | ADR review; no user-facing revoke ticket can start until accepted. |
| AUTH-00-03 | Add CDK assertions for tenant user-pool client OAuth flows, token revocation setting, token validity, and client read/write attributes. | `npm test -- server/lib/tenant-template` or equivalent CDK spec passes. |
| AUTH-00-04 | Disable tenant app-client implicit grant if PKCE code flow is the only supported frontend path. | CDK snapshot/assertion shows `implicitCodeGrant` false; frontend login smoke still succeeds in non-prod before deploy. |
| AUTH-00-05 | Remove security custom attributes from tenant app-client write attributes unless a documented server-side requirement exists. | CDK assertion proves `custom:tenantId`, `custom:userRole`, and `custom:tenantTier` are not client-writable. |
| AUTH-00-06 | Add API Gateway authorizer tests proving valid tokens from untrusted issuers/app clients are rejected. | Unit tests fail before authorizer hardening and pass after pinning trust config. |
| AUTH-00-07 | Pin API Gateway authorizer accepted issuer/audience to configured tenant pool/app client data or a tenant pool registry. | Authorizer unit tests and local Lambda test fixture pass. |
| AUTH-00-08 | Add backend contract tests for session/security DTO wrapper shapes. | Jest tests fail if backend returns arrays where shared DTO says wrapper or vice versa. |
| AUTH-00-09 | Add frontend service normalization tests for active sessions and login history wrapper DTOs. | Frontend unit tests cover both empty and populated wrapper responses. |
| AUTH-00-10 | Add authz tests for existing `/sessions` and `/users/:id/security` access boundaries: self, TenantAdmin, same-tenant non-admin, cross-tenant. | Identity service Jest tests pass and watchlist/module wiring is updated if providers change. |

### Sprint 1 - Canonical Auth Events And Tenant Ledger

Goal: create the source of truth for login history, last login, and future
session views.

Demo: a direct Cognito login emits a canonical `LoginSucceeded` event; the
identity ledger records it idempotently; user summary last-login projection is
updated from the event.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-01-01 | Add shared Zod schemas and TypeScript types for canonical auth/security events. | Shared-types tests and `npm run build` in `packages/shared-types`. |
| AUTH-01-02 | Add identity entity definitions for `AUTH_EVENT`, `USER_SESSION`, and `TOKEN_DENY` rows. | Pure mapper tests for keys, TTLs, and required fields. |
| AUTH-01-03 | Add CDK/table/index changes or documented identity-table extension for auth ledger access patterns. | CDK assertions for GSIs, TTL, retention, and IAM grants; `npm run typecheck:cdk`. |
| AUTH-01-04 | Add repository/data-access layer for auth events with idempotent put by `eventId`. | Repository unit tests with duplicate events and pagination. |
| AUTH-01-05 | Map Cognito PostAuthentication trigger output to canonical `LoginSucceeded`. | Lambda unit tests cover tenant claims, missing tenant, role coercion, and EventBridge failure behavior. |
| AUTH-01-06 | Add EventBridge consumer in identity to write canonical auth events to the tenant ledger. | Event ingestion test proves duplicate delivery produces one immutable event. |
| AUTH-01-07 | Add `lastLoginAt` projection updater from `LoginSucceeded`, not Cognito user metadata. | Tests prove older events do not overwrite newer last-login values. |
| AUTH-01-08 | Fix analytics session-event metadata extraction so `ipAddress` and `deviceInfo` survive top-level or `metadata` placement. | Analytics aggregator unit tests cover both shapes. |
| AUTH-01-09 | Define trusted and untrusted sources for `LoginFailed` events. | ADR or design note accepted; no fakeable unauthenticated client-only failure events are treated as authoritative. |

### Sprint 2 - Session Observation And Read-Only Security Center

Goal: make user-facing session and login history visibility real without
shipping revoke buttons before enforcement exists.

Demo: after frontend login, `/settings/security` shows current observed session,
other observed sessions, and login history. There are no revoke controls yet.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-02-01 | Define session fingerprint model: `sessionId`, device install ID, user-agent summary, IP, JWT `jti`/`origin_jti`, `auth_time`, `iat`, `exp`. | Mapper tests cover stable session IDs and privacy-safe fields. |
| AUTH-02-02 | Add `POST /sessions/current` DTO and backend endpoint. | Controller/service tests validate JWT-derived tenant/user only; no caller-supplied tenant/user trust. |
| AUTH-02-03 | Add route registration for the session handshake in controller, `tenant-api-prod.json`, and nginx only if a new prefix is introduced. | `npm run lint:routes` passes. |
| AUTH-02-04 | Add idempotent session observation write/update logic. | Duplicate handshake tests produce one active session row and one latest-seen update. |
| AUTH-02-05 | Add frontend auth-init call to `POST /sessions/current` after Amplify session is available. | Frontend tests cover success, retryable failure, and no logout loop on observation failure. |
| AUTH-02-06 | Add read-only current-user active session endpoint backed by `USER_SESSION`, not legacy-only DDB sessions. | Authz tests cover self-only access and tenant isolation. |
| AUTH-02-07 | Add login history endpoint backed by canonical `AUTH_EVENT` rows. | Pagination, date-range, and empty-state tests. |
| AUTH-02-08 | Wire post-MVP session and login-history components into live `/settings/security` as read-only views. | Frontend route test and visual smoke via `npm run dev:shell`. |
| AUTH-02-09 | Update shared DTOs and frontend client methods to use one wrapper shape for sessions/history. | Backend and frontend contract tests pass. |

### Sprint 3 - Revocation Enforcement Foundation

Goal: make revoke technically enforceable before exposing tenant-user and admin
revoke UX.

Demo: a token/session marked revoked is rejected by an EdForge protected API
before its JWT expiration time.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-03-01 | Ensure Cognito token revocation is enabled on the tenant app client and document token TTL choices. | CDK assertion and synthesized template check. |
| AUTH-03-02 | Persist JWT `jti` and `origin_jti` from observed sessions when available. | Session handshake tests with JWT fixtures containing and missing those claims. |
| AUTH-03-03 | Add `TOKEN_DENY` repository with TTL keyed by token family/session. | Unit tests for keying, expiration, and idempotent deny writes. |
| AUTH-03-04 | Add denylist check to Nest JWT guard/strategy path. | Unit tests prove denied token fails after signature validation but before controller execution. |
| AUTH-03-05 | Document API Gateway authorizer cache behavior and keep immediate revoke enforcement in Nest unless TTL/cost tradeoff is explicitly changed. | ADR update and reviewer signoff. |
| AUTH-03-06 | Add integration test with a valid JWT fixture: call a protected endpoint, deny the token/session, then verify the same token is rejected. | Jest/e2e test passes locally. |
| AUTH-03-07 | Build a shared `signOutUserEverywhere` identity service helper that calls Cognito `AdminUserGlobalSignOut`, marks sessions revoked, writes deny rows, and emits audit events. | Service tests mock Cognito/EventBridge/DDB success and failure paths. |
| AUTH-03-08 | Wire user disable/delete/role-change/password-reset/MFA-reset paths to invalidate sessions through the shared helper where appropriate. | Tests prove each status-changing action emits the expected signout or deny behavior. |

### Sprint 4 - User Self-Service Session Actions

Goal: let users manage their own sessions with behavior EdForge can enforce.

Demo: a user can view sessions, sign out everywhere, and block an observed
session; blocked tokens cannot call protected EdForge APIs.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-04-01 | Add `POST /sessions/revoke-all` self-service implementation using the shared signout-everywhere helper. | Service tests prove Cognito global signout, ledger updates, and audit event emission. |
| AUTH-04-02 | Add `POST /sessions/{sessionId}/block` self-service implementation for observed session/token-family deny. | Authz tests prove users can block own sessions only. |
| AUTH-04-03 | Add clear response semantics for block versus global signout. | Shared DTO tests and API docs updated. |
| AUTH-04-04 | Wire self-service session action buttons and confirmation dialogs into `/settings/security`. | Frontend tests cover loading, success, error, and current-session edge cases. |
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
| AUTH-05-02 | Add tenant-admin user security detail endpoint. | Authz tests cover TenantAdmin same tenant, non-admin, self, and cross-tenant denial. |
| AUTH-05-03 | Add tenant-admin user login-history endpoint with pagination and filters. | Query tests cover time range, event type, and user scoping. |
| AUTH-05-04 | Add tenant-admin signout-everywhere endpoint for a target user. | Cognito global signout helper tests and route authz tests. |
| AUTH-05-05 | Decide whether tenant-admin single-session block is exposed in V1. If exposed, use the same denylist semantics as self-service; if not, hide the control and document why. | Product/ADR acceptance plus UI tests for the chosen behavior. |
| AUTH-05-06 | Wire tenant-admin user security panel in the tenant frontend. | Route trace, component tests, and browser smoke. |
| AUTH-05-07 | Emit audit events for every admin read and write of user session/security history. | Tests assert `AuditHistoryRead` and admin action events are emitted. |

### Sprint 6 - System-Provider Control-Plane Auth Audit

Goal: project tenant auth/security events into a central provider view without
scanning tenant identity tables or overexposing PII.

Demo: a system admin in AdminWeb can filter cross-tenant auth activity by
tenant, user, event type, risk flag, and date range.

| Ticket | Work | Validation |
| --- | --- | --- |
| AUTH-06-01 | Add platform auth-audit projection schema with redacted/minimized fields. | Schema tests prove raw token values are impossible and PII fields are explicit. |
| AUTH-06-02 | Add central auth-audit table/indexes or extend analytics storage with tenant/time, user/time, event-type/time, and risk indexes. | CDK assertions for keys, TTL, encryption, removal policy, and IAM. |
| AUTH-06-03 | Add EventBridge fanout from canonical tenant auth events to the provider audit consumer. | Event routing tests and DLQ configuration tests. |
| AUTH-06-04 | Add provider audit ingestion Lambda with idempotent writes. | Duplicate event tests and malformed event DLQ tests. |
| AUTH-06-05 | Add control-plane API endpoints for audit search, tenant drilldown, user drilldown, and export request. | SystemAdmin authz tests; tenant users cannot call these endpoints. |
| AUTH-06-06 | Replace email-list-only system admin checks for this surface with control-plane role/claim checks. | Tests with SystemAdmin, CustomerSupport, TenantAdmin, and untrusted tokens. |
| AUTH-06-07 | Add AdminWeb service client and typed DTOs. | AdminWeb unit tests for query params, pagination, and errors. |
| AUTH-06-08 | Add AdminWeb audit dashboard table, filters, drilldown, and CSV export initiation. | Component tests and local AdminWeb smoke. |
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
| AUTH-07-03 | Add DLQ alarms and CloudWatch metrics for PostAuth, auth-event consumer, provider audit consumer, and export jobs. | CDK assertions and alarm smoke in non-prod. |
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
| AUTH-08-01 | Reconcile legacy `/auth/login` session creation with canonical `SessionObserved` and auth-event ledger. | Tests prove backend login and Amplify handshake produce equivalent ledger rows. |
| AUTH-08-02 | Decide whether `/auth/refresh` remains supported. If retained, align it with canonical session/token deny semantics. | ADR update and service tests. |
| AUTH-08-03 | Consolidate duplicate logic between `SessionsService` and `SecurityService` session methods. | Unit tests moved to shared service; no route behavior regression. |
| AUTH-08-04 | Fix MFA backup-code persistence/validation and disable-MFA proof checks, or explicitly defer with blocked UI copy. | MFA service tests for setup, backup code use, and disable proof. |
| AUTH-08-05 | Update OpenAPI/API Gateway specs, route-drift allowlists, nginx, and shared docs for final routes. | `npm run lint:routes` and route specs pass. |
| AUTH-08-06 | Add load/performance tests for auth-event and session-list access patterns. | Test report shows p95 query behavior at expected tenant/user scale. |
| AUTH-08-07 | Update architecture docs and tenant/admin runbooks. | Docs review; links from `ARCHITECTURE.md` or alpha-launch index as appropriate. |

## Cross-Sprint Validation Gates

Every backend ticket that changes identity routes, providers, or authz must run:

- `cd server/application && npx jest <affected-spec>`
- Module wiring spec updates when adding shared providers.
- `npm run lint:routes` for route changes.
- `npm run lint:authz` or the current authz coverage gate for new routes.
- `npm run lint` when files fall under root lint scope.

Every shared-types ticket must run:

- `cd packages/shared-types && npm run build`
- A consumer typecheck or targeted Jest test proving the published contract is
  consumed correctly.

Every CDK/infra ticket must run:

- `npm run typecheck:cdk`
- CDK assertions for the changed construct.
- `cd server && source .env.<profile> && CDK_NAG_ENABLED=false npx cdk synth <stack>`
  when operator env is available.
- `cdk diff` before any deploy, using the repo deploy ladder.

Every frontend ticket must run:

- Route trace from URL -> route -> page -> tab/subcomponent before editing.
- Relevant unit/component tests.
- `npm run dev:shell` visual smoke for non-trivial behavior.

Every revocation ticket must prove:

- A valid token can call a protected endpoint before revoke.
- The same token or token family is denied after revoke/block before nominal
  JWT expiry.
- Authorizer cache behavior is either irrelevant because enforcement happens in
  Nest, or explicitly accounted for.

Every audit ticket must prove:

- Tenant admins cannot cross tenant boundaries.
- System-provider users see only the provider projection, not raw tenant tables.
- Reads of audit/session history emit audit-read events.
- PII redaction/minimization is covered by tests.

## Open Decisions

1. Is EdForge satisfied with API-layer single-session blocking for V1, or does
   compliance require true backend-owned refresh-token custody?
2. Should provider audit live in a new dedicated table or extend analytics
   storage with new indexes?
3. What retention period is required for tenant-visible login history versus
   provider compliance audit?
4. Which roles can read provider audit data: SystemAdmin only, CustomerSupport
   with restrictions, or a new SecurityAuditor role?
5. Are failed-login events required in V1? If yes, should EdForge route login
   through a backend/BFF, use Cognito threat protection signals, or accept only
   best-effort client-side telemetry labeled as untrusted?
6. Should tenant app access-token TTL be shortened once denylist checks exist,
   and what UX cost is acceptable?

## Subagent Review Incorporated

A subagent review was requested and completed before this plan was written. The
review changed the plan in these concrete ways:

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
- `server/application/libs/auth/src/jwt.strategy.ts`
- `server/application/microservices/identity/src/auth/auth.service.ts`
- `server/application/microservices/identity/src/sessions/sessions.service.ts`
- `server/application/microservices/identity/src/security/security.service.ts`
- `server/lib/auth-events/lambda/post-auth/handler.ts`
- `server/lib/analytics/analytics-stack.ts`
- `server/lib/analytics/lambda/aggregator/handler.ts`
- `server/lib/analytics/lambda/api/handler.ts`
- `edforge-saas-frontend/packages/auth/src/service.ts`
- `edforge-saas-frontend/packages/auth/src/config.ts`
- `edforge-saas-frontend/apps/shell/src/pages/settings/security.tsx`
- `edforge-saas-frontend/apps/shell/src/pages/settings/security-post-mvp.tsx`

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

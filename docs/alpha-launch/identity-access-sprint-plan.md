# EdForge — Identity & Access Epic — Sprint & Task Plan

> **Status:** DRAFT for finalization (2026-07-03). Source-verified against `main @ 38c2aa7` via two
> skeptical verification passes + one adversarial plan review. GitHub issues will be cut from this
> file once the epic set is finalized.
>
> **Scope:** the remaining **Identity & Access** work only — session monitoring/control, account-
> lifecycle correctness, MFA surfacing, and the RBAC R2–R6 remainder. Product-completeness and
> platform-hardening are **separate epics** (referenced, not covered).
>
> **Priority framing (operator, 2026-07-03):** RBAC correctness → session monitoring & control →
> account lifecycle. Parent/Student portals are **deprioritized**.

---

## Conventions (apply to every task)

- **Atomic** = one commit / one PR / one reviewable concern. If a task reads like 2–3 concerns, it is split below.
- **Validation** (required on every task): an automated test where sensible, else a concrete manual/smoke/`cdk diff` proof.
- **Test tooling that actually exists here** (verified): backend **Jest + `aws-sdk-client-mock`**; frontend **Vitest + MSW**; `npm run test:abac` (jest pattern), `npm run lint:routes` (route-drift). **No `dynamodb-local`** — concurrency/DB tests use `aws-sdk-client-mock`, not a live DDB.
- **Repo-wide invariants that MUST be honored in the same PR** (CLAUDE.md):
  - **3-way route registration** for any new endpoint: Nest controller + `server/lib/tenant-api-prod.json` (API Gateway) + nginx (`nginx.template`). A missing gateway entry → `403 SigV4` in prod.
  - **Module-wiring spec:** update `identity/src/__tests__/module-wiring.spec.ts` when DI providers change.
  - **"Layer 4.5" event convention:** every state mutation emits an analytics/audit event (pattern at `users.service.ts:263` `UserCreated`, `:478` `UserUpdated`/`UserDisabled`). New mutations here MUST emit their event.
  - **shared-types caret-pin bump** for any `@aibrains/shared-types` change consumed by Docker-built services.
  - **2-repo git hygiene:** backend = `edforge/`; frontend = `edforge/edforge-saas-frontend/` (separate git). `cd` before every git call; branch off `origin/main` in an isolated worktree.
  - **Frontend route→component trace** pasted into the PR body before any UI edit.
  - **New FE surfaces** must include empty/loading/error states + **i18n keys** (there is an active i18n-hardening workstream).
- **Deploy** follows the change-to-deploy matrix; nothing ships straight to prod.

---

## Verified baseline — already shipped, do NOT rebuild

| Capability | State | Evidence |
|---|---|---|
| **Change-password** | ✅ end-to-end | `POST /users/:id/security/change-password` → Cognito `ChangePassword`; `settings/security.tsx` |
| **Forgot/reset password** | ✅ end-to-end (client-side) | Amplify v6 `forgotPassword`/`confirmForgotPassword` → Cognito (`packages/auth`); login-page wired; `FORCE_CHANGE_PASSWORD` → `NEW_PASSWORD_REQUIRED`. **No backend endpoint needed.** |
| **Admin create-user** | ✅ | `POST /users`, `/users/parent-accounts`, `/users/student-accounts`, `POST /staff/with-user` — wired, route-registered, TenantAdmin-guarded (`users.service.ts:98`, `staff.controller.ts:88`) |
| **Revoke (soft-delete)** | ✅ | `DELETE /users/:id` = `AdminDisableUser` + cascade-deactivate roles + keep staff entity + keep row (`users.service.ts:506`, cascade `:528`) |
| **Security module (9 endpoints)** | ✅ wired + registered | self + admin, JWT + tenant-scoped guards (`security.controller.ts:43-213`; gateway `tenant-api-prod.json:6585-6796`) |
| **FE session/history service methods** | ✅ already exist | `users.service.ts:610-646` (`getActiveSessions/getLoginHistory/revokeSession/revokeAllSessions`) — only guard-tests missing |
| **Cognito global sign-out** | ✅ exists, partial wiring | `invalidateAllUserSessions()` (`AdminUserGlobalSignOut`, `auth.service.ts:655`) fires on **global-role change** (`users.service.ts:1048`) — NOT logout/revoke |
| **Login-success analytics** | ✅ deployed | `CognitoPostAuthTrigger`/`CognitoLoginEmitter` emits `LoginSuccess` to the analytics bus on every auth (`tenant-template-stack.ts:98`) — **success only** |
| **MFA backend** | ✅ built + IAM-granted, **no FE** | setup/verify/disable (`security.controller.ts:86-117`); IAM `AssociateSoftwareToken`/`VerifySoftwareToken`/`SetUserMFAPreference` (`service-info.txt:66-69`) |
| **RBAC R0–R2** | ✅ deployed | authz-coverage gate, route-closure + StaffReadGuard, cross-tenant 403, GSI isolation audit, `test:abac` harness |

### ⚠️ Architectural note — two session surfaces exist (pick one per use)
- **Security surface** — `GET/DELETE /users/:id/security/sessions`, `POST .../revoke-all`, `GET .../login-history`. FE already targets this; login-history lives here. **Use for self-service (Sprint 1).**
- **Sessions module** — top-level `GET /sessions`, `/sessions/:id`, `POST /sessions/revoke-all`, and **admin** `GET /sessions/user/:userId`, `POST /sessions/user/:userId/revoke-all` (`sessions.controller.ts:96,110`). **Use for admin oversight (Sprint 4).**
- **Decision (record in Sprint 4):** long-term, consolidate to ONE surface to avoid two parallel session APIs. Tracked as **S-DEBT-1** (Sprint 12).

---

# PHASE A — Trust surfaces (backend mostly built; wiring + FE)

## Sprint 1 — Session self-service visibility
**Goal:** a signed-in user sees & controls their own sessions and login history.
**Demo:** log in → Settings → Security shows active sessions (device/IP/last-seen) + login history; "revoke this session" works; a fresh login (success **and** failed) appears in history.
**Surface:** security module (`/users/:id/security/...`). Distinct from the deployed analytics `LoginSuccess` trigger (that feeds analytics; this feeds the user-facing DDB history and also captures **failures**, which the trigger does not).

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S1.1** | Wire login-history capture into `auth.service.login()` — **success + failure in one PR**, threading `req.ip` + `user-agent` from the controller into `recordLoginAttempt()` (method + UA parsing already exist at `security.service.ts:580`; it is simply never called and never passed context). | `auth.controller.ts`, `auth.service.ts` (~L220 success, ~L244 catch), `security.service.ts:580` | Unit (aws-sdk-client-mock): success writes `USER#{id}#LOGIN#{ts}` status=success w/ parsed device/ip; bad-credential login writes status=failed + reason. |
| **S1.2** | Add cursor pagination to `getLoginHistory` (today `limit` only, no cursor — `security.service.ts:536`) + expose `nextCursor` in the response DTO. | `security.service.ts`, `security.controller.ts`, shared-types security schema | Unit: 25 rows + limit 20 returns `nextCursor`; second page returns remainder. |
| **S1.3** | Add the missing **route-shape guard tests** pinning the 4 existing FE service URLs (methods already exist at `users.service.ts:610-646`). | `edforge-saas-frontend/apps/shell/src/services/__tests__/` | Vitest: asserts exact URLs `/users/{id}/security/sessions`, `/login-history`, `DELETE .../sessions/{sid}`, `revoke-all`. |
| **S1.4** | FE: wire active-sessions list from `security-post-mvp.tsx` into `settings/security.tsx` (device icon, current-session badge, revoke button) — incl. empty/loading/error states + i18n keys. | `apps/shell/src/pages/settings/security.tsx`, `security-post-mvp.tsx` | Vitest+MSW: renders N sessions; revoke fires DELETE + refetch; empty state renders "no active sessions". |
| **S1.5** | FE: wire login-history table (success/failed styling, "load more" using S1.2 cursor) + i18n. | same | Vitest+MSW: renders rows; load-more fetches page 2. |
| **S1.6** | Render-path smoke. | — | Manual `pnpm dev:shell`: log in, screenshot Security tab w/ real data (into PR). |

**Deploy:** identity ECR + ECS (S1.1–S1.2); frontend pipeline (S1.3–S1.5). No CDK/IAM/route change.

## Sprint 2 — Account reactivation correctness (data-integrity hotfix)
**Goal:** re-enabling a deactivated user restores their access **and their roles**. (Pulled early — this is a live correctness bug: reactivate today re-enables Cognito + `user.status` but leaves role rows `isActive:false`, so the user comes back with **no roles**.)
**Demo:** deactivate a user (roles cascade off) → reactivate → the exact roles that this deactivation removed are restored; an admin-revoked individual role is NOT resurrected.

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S2.1** | On `PATCH /users/:id` status→active, cascade-**reactivate** role assignments, restoring **only** rows whose `deactivationReason==='User deactivated'` (not individually admin-revoked rows), clearing `deactivatedAt/By/Reason`. | `identity/src/users/users.service.ts` (updateUser ~L401; mirror deactivate cascade ~L528) | Unit: deactivate→reactivate restores `isActive:true` on user-deactivated rows only; a separately admin-revoked role stays inactive; `AdminEnableUser` called. |
| **S2.2** | Emit `UserReactivated` analytics/audit event (Layer 4.5) with restored-role count. | same, events service | Unit: event emitted with count. |
| **S2.3** | Update `module-wiring.spec.ts` if providers changed; regression-run existing user specs. | `__tests__/module-wiring.spec.ts` | `nest build` + user specs green. |

**Deploy:** identity ECR + ECS. No CDK.

## Sprint 3 — Token validity hardening
**Goal:** Cognito token lifetimes are explicit & sane (not silent 1h/1h/30d defaults); implicit grant closed. Precondition for an honest Sprint-4 revocation demo and Sprint-7 freshness.
**Demo:** `cdk diff` shows explicit access/id/refresh validity + implicit-grant disabled; login→refresh works; expired refresh rejected.

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S3.1** | Set explicit `accessTokenValidity` / `idTokenValidity` / `refreshTokenValidity` on the `UserPoolClient` (currently unset → 1h/1h/30d). Decision recorded in commit: access 60m (→15m in S7), refresh aligned to the 24h DDB-session window. | `server/lib/tenant-template/identity-provider.ts:219` | `cdk synth`+`diff` shows the three validities; CDK unit asserts props if practical. |
| **S3.2** | Disable `implicitCodeGrant` on the app client (OAuth anti-pattern; SRP/auth-code retained). | same | `cdk diff` shows implicit grant removed; login smoke unaffected. |
| **S3.3** | Validate refresh flow against new TTLs. | — | Smoke on dev tenant: login→refresh succeeds; expired refresh rejected (evidence in PR). |

**Deploy:** Cognito app-client change → relevant stack (`cdk diff` first).

## Sprint 4 — Admin session oversight + revocation teeth
**Goal:** an admin views/terminates any user's sessions, and revocation actually kills Cognito refresh tokens.
**Demo:** admin opens a user's sessions → "terminate all" → that user's refresh fails, re-auth forced within the (now-short, S3) access TTL; user self-logout-all also triggers Cognito global sign-out.
**Depends on:** S3 (honest demo timing).

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S4.1** | Add the 2 admin routes to API Gateway: `GET /sessions/user/{userId}`, `POST /sessions/user/{userId}/revoke-all` (controller + nginx already present; **only `tenant-api-prod.json` missing → 403 today**). Assert the new methods carry the **Cognito authorizer** matching sibling `/sessions` methods (not the IAM default). | `server/lib/tenant-api-prod.json` | `npm run lint:routes` green; authorizer on new methods == sibling; deploy `shared-infra-stack`; smoke admin GET → 200 not 403. |
| **S4.1a** | **Cross-tenant ownership test** on the admin session routes: a TenantAdmin of tenant A must get **403** requesting tenant B's user sessions (defense-in-depth beyond the tenant-scoped DDB partition; reuse the R1 cross-tenant harness). | `identity/src/sessions/*`, `test/e2e/security.e2e.spec.ts` | Test: admin-A → `GET /sessions/user/{B-user}` and `POST .../revoke-all` both **403 `CROSS_TENANT_FORBIDDEN`**. |
| **S4.2** | Wire `AdminUserGlobalSignOut` into `SessionsService.revokeUserSessions()` + `revokeAllSessions()`. | `identity/src/sessions/sessions.service.ts` | Unit (aws-sdk-client-mock): revoke invokes Cognito command; DDB rows still marked revoked. |
| **S4.3** | Wire `AdminUserGlobalSignOut` into `AuthService.logout()` when `allSessions` set. | `identity/src/auth/auth.service.ts:363` | Unit: logout-all triggers global sign-out; single-session logout does not. |
| **S4.4** | Emit `SessionsRevoked` / `GlobalSignOut` Layer-4.5 event on the revoke paths. | sessions/auth services, events | Unit: event emitted with scope (single/all/admin). |
| **S4.5** | Confirm/extend IAM `cognito-idp:AdminUserGlobalSignOut` on the identity task role for the new call sites (already used by `invalidateAllUserSessions`). | `server/service-info.txt` | `cdk diff tenant-template-stack-basic`: grant present (empty diff = already granted; document which). |
| **S4.6** | FE (admin): "User sessions" panel in the People/Users admin surface — list + "terminate all" — empty/loading/error + i18n. Route-trace first. | `edforge-saas-frontend/apps/people/...` | Vitest+MSW: lists sessions; terminate-all fires `POST /sessions/user/{id}/revoke-all`; render smoke. |
| **S4.7** | Document the stateless-JWT constraint (access token lives to TTL; global sign-out kills refresh) in admin UI copy + a short `docs/` note. | `docs/`, UI copy | Reviewer confirms wording; links S3. |

**Deploy (ordered):** (1) route → `shared-infra-stack`; (2) IAM if any → `tenant-template-stack-basic`; (3) app → identity ECR + ECS; (4) frontend pipeline.

## Sprint 5 — MFA surface (activate the built backend)
**Goal:** users can enroll TOTP MFA; admins can reset it. Backend + IAM already exist; only the FE + login-challenge handling are missing (`security-post-mvp.tsx` already imports `MfaSetupResponse`, `QrCode`, `mfaVerificationSchema`).
**Demo:** user enables MFA (QR/TOTP enroll → verify) in Settings → Security; next login prompts for the TOTP code; admin can reset a user's MFA.

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S5.1** | FE service methods: `setupMfa`, `verifyMfa`, `disableMfa` → the existing `/users/:id/security/mfa/*` endpoints. | `apps/shell/src/services/users.service.ts` | Route-shape guard test pins the 3 URLs. |
| **S5.2** | FE: TOTP enrollment UI (QR + secret + verify) wired into `settings/security.tsx` — empty/loading/error + i18n. | `security.tsx`, `security-post-mvp.tsx` | Vitest+MSW: enroll→verify happy path; wrong-code error. |
| **S5.3** | Handle the MFA challenge in the Amplify login flow (`SOFTWARE_TOKEN_MFA` / `confirmSignIn`). | `edforge-saas-frontend/apps/shell/src/components/layout/LoginPage.tsx`, `packages/auth` | Vitest: MFA-required login prompts for code; correct code completes sign-in. |
| **S5.4** | Admin "reset MFA" action (`AdminSetUserMFAPreference` off) + endpoint if missing (verify against existing MFA controller). | `security.controller.ts`/`service.ts`, service-info IAM (already granted) | Unit: reset clears preference; guarded TenantAdmin. Route reg if new. |
| **S5.5** | Emit `MfaEnabled` / `MfaDisabled` Layer-4.5 events. | services, events | Unit: events emitted. |

**Deploy:** app (if S5.4 adds a route → gateway) + frontend pipeline.

## Sprint 6 — Account provisioning & access grant/revoke
**Goal:** admins fully grant/revoke a person's platform access from the UI, and the People wizard creates real people.
**Demo:** admin grants an imported (login-less) teacher a Cognito login (invite email arrives); the New-Person wizard creates a real user/staff; admin resends an invite; access-grant/revoke are notified + audited.

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S6.1a** | **Backend:** `POST /staff/:staffId/grant-access` — create/link a Cognito user for an EXISTING staff row, set `staff.userId` + `user.staffId`, assign role, send invite; **must not create a duplicate staff row**. Emit `AccessGranted` event. Update `module-wiring.spec.ts`. 3-way route registration. | `identity/src/staff/*`, `users.service.ts`, `tenant-api-prod.json`, `service-info.txt` | Unit: links both back-refs, invite sent, **no new staff created**; last-admin/self guards; `lint:routes`. |
| **S6.1b** | **FE:** grant-access action + form in People admin surface — empty/loading/error + i18n. | `edforge-saas-frontend/apps/people/...` | Vitest+MSW: fires `POST /staff/{id}/grant-access`; success/error toasts. |
| **S6.2** | **Resend-invite** `POST /users/:id/resend-invitation` — `FORCE_CHANGE_PASSWORD`→`AdminCreateUser RESEND`; `CONFIRMED`→`AdminResetUserPassword`. IAM `AdminResetUserPassword` (absent today). **Overlaps #315 — land there.** | `users.controller.ts`/`service.ts`, `service-info.txt`, `tenant-api-prod.json` | Unit: both branches; IAM diff shows `AdminResetUserPassword`; `lint:routes`. |
| **S6.3** | **Wire the People "New Person" wizard** — replace the `console.log` stub (`new.tsx:84`) with a real `POST /users` / `POST /staff/with-user` by person type; success/error toasts + navigate + i18n. | `edforge-saas-frontend/apps/people/src/routes/new.tsx` | Vitest+MSW: each type fires correct POST w/ mapped payload; error path toast; render smoke. |
| **S6.4** | FE: surface deactivate / **reactivate** (S2) / resend-invite actions in People/Users admin. | `edforge-saas-frontend/apps/people/...` | Vitest+MSW per action + render smoke. |
| **S6.5** | Notification email on **access revoke** ("your access was revoked / you were signed out") — mirror the invite path. | identity events / notification | Unit: revoke triggers notification; smoke. |
| **S6.6** | **Hard-delete option** (release the email + Cognito account): today `DELETE /users/:id` is **soft-only**, so a "deleted" email can never be reused (the `gsi1pk=EMAIL#{email}` lookup row persists → `UsernameExistsException` on re-invite). Add a hard-delete path: `AdminDeleteUser` + hard-remove the `USER#{id}` row (carries `gsi1pk=EMAIL#{email}`), preferences row, and all `USER#{id}#ROLE#…` rows. Guard last-TenantAdmin + self-delete. Keep audit + `UserDeleted` event. **Lands in #315** (clean hard-delete) — reference, don't duplicate. | `users.service.ts:506`; **#315** | Unit: invite → hard-delete → re-invite **same email** succeeds (email freed); last-admin/self guards; all rows + Cognito account gone. |

**Deploy:** app → identity ECR + ECS; new routes → `shared-infra-stack`; IAM → `tenant-template-stack-basic`; frontend pipeline. **Reference #315** (clean hard-delete, temp-password validity, recovery runbook) — do not duplicate; S6.2 may land inside #315.

---

# PHASE B — RBAC correctness & hardening

## Sprint 7 — RBAC R3: epoch-based revocation freshness (design-gated)
**Goal:** a role change / deactivation takes effect on the user's **next request**, not at token TTL.
**Demo:** demote/deactivate mid-session → next request 401 within seconds; conformance "demote-mid-session" cell green.
**Depends on:** S3 (a known short TTL to tune) + the two design gates below.

| Task | Atomic work | Files | Validation |
|---|---|---|---|
| **S7.0a** | **R5.4 gate:** audit every consumer of the per-tenant Cognito group (created/joined `users.service.ts:152`, unused in authz path); ADR keep-vs-retire. | `docs/decisions/` | ADR + grep evidence. |
| **S7.0b** | **R2.5 gate:** decide `custom:tenantId` write-once + token-time validation (depends S7.0a). | `docs/decisions/` | ADR/design note. |
| **S7.1** | `user.authzEpoch` (int) on the User entity; bump on role change / deactivation / global-role change. | `common/entities/user.entity.ts`, `users.service.ts`, `roles.service.ts` | Unit: each mutation increments epoch. |
| **S7.2** | PreTokenGeneration Lambda: inject `authzEpoch` claim + validate `custom:tenantId`==record; wire the Cognito trigger. Update `module-wiring.spec.ts` if DI touched. | `identity-provider.ts` (+ new lambda), CDK | Unit on handler (aws-sdk-client-mock); `cdk synth`; smoke: minted token carries `authzEpoch`. |
| **S7.3** | Guard/PDP compares token `authzEpoch` vs current row → mismatch 401; add conformance demote-mid-session cell. | `common/guards/permission.guard.ts`, conformance | Unit + `test:abac` cell green. |
| **S7.4** | Shorten access-token TTL to ~15m (adjust S3.1) + re-validate refresh. | `identity-provider.ts` | Smoke: ~15m expiry; refresh works. |
| **S7.5** | Retire ad-hoc `verifyDynamoRole` where epoch now covers it; keep sensitive-op coverage. | `permission.guard.ts` + call sites | Regression: `test:abac` + guard specs green; no endpoint loses protection. |

**Deploy:** CDK (Lambda + trigger + TTL) → then identity app roll. cdk diff first.

## Sprint 8 — Data-scope scale (RBAC R4)
**Goal:** guardian/student/teacher scope resolution is O(1) and correct past 1000 rows.
**Demo:** a guardian with children, and a tenant with >1000 students, resolve scope correctly and fast (no full scan).

| Task | Atomic work | Validation |
|---|---|---|
| **S8.1 (R4.1)** | GSI on `student.guardians[].userId` (guardian→students). | Schema deploy diff; unit on lookup. |
| **S8.2 (R4.2)** | GSI on `student.portalUserId` (student→self). | Same. |
| **S8.3 (R4.3)** | Refactor parent/student scope off the 1000-row scan (fix >1000 correctness bug) onto S8.1/S8.2. | Correctness test w/ >1000 synthetic students; perf measured. |
| **S8.4 (R4.4)** | Single-flight dedup for scope + permission resolution. | Unit: concurrent calls → one upstream fetch. |
| **S8.5 (R4.5)** | Teacher-scope N+1 reduction (batch per-section enrollment). | Query-count test shows reduction. |

## Sprint 9 — Authz architecture: PEP seam + ADRs (RBAC R5)
**Goal:** a single `authorize()` seam all guards route through, with the PDP-strategy decision documented.
**Demo:** all PEPs call the seam; `test:abac` unchanged (pure refactor, no behavior change).

| Task | Atomic work | Validation |
|---|---|---|
| **S9.1 (R5.1)** | Extract `authorize(principal, action, resource, context)`; route guards through it. | Unit: PEPs call the seam; `test:abac` unchanged. |
| **S9.2 (R5.2)** | ADR: bespoke PDP vs Amazon Verified Permissions/Cedar + migration trigger. | ADR committed. |
| **S9.3 (R5.3)** | Design (not build) DB-defined custom-role evaluation → hand to **#334**. | Design doc; cross-link #334. |

## Sprint 10 — Service-identity secret hygiene (RBAC R6)
**Goal:** the internal service key is rotatable without downtime.
**Demo:** rotate the internal key with both old+new accepted during the window; no request fails.

| Task | Atomic work | Validation |
|---|---|---|
| **S10.1 (R6.1)** | Internal API key → Secrets Manager + dual-key rotation window (accept `INTERNAL_API_KEY` + `_PREVIOUS`). | Unit: both keys accepted during window; rotation smoke. |
| **S10.2 (R6.2)** | ADR: signed service-identity tokens (SigV4/OIDC) to replace shared secret. | ADR committed. |

## Sprint 11 — GSI casing normalization migration (F3, risk-managed)
**Goal:** eliminate the GSI1/GSI2 partition-key casing split (academics `tenant#` vs identity/finance `TENANT#`) that causes silent empty cross-service reads. **Isolated as its own sprint because it is a live cross-service data migration.**
**Demo:** a cross-service GSI read that previously returned empty now returns rows; migration dry-run report + rollback plan reviewed.

| Task | Atomic work | Validation |
|---|---|---|
| **S11.1** | Pick canonical casing; add a normalization read-shim so both casings resolve during migration. | Unit: shim resolves both casings. |
| **S11.2** | Backfill/migration script (dry-run + live) to rewrite the minority casing. | Dry-run row-count report; live on dev tenant first; pre/post scan. |
| **S11.3** | Remove the shim + assert single casing; regression test for cross-service reads. | Regression: cross-service GSI read returns rows. |

## Sprint 12 — Identity hardening & closeout (misc)
**Goal:** remaining smaller hardening items + observability, each independently shippable.

| Task | Atomic work | Validation |
|---|---|---|
| **S12.1 (R2.4)** | Cache STS assumed-role creds per tenantId (~5m). | Unit: cache hit reuses; expiry refreshes; measured STS drop. |
| **S12.2** | Auth observability: CloudWatch metric + alarm on failed-login spike (consumes S1.1 failure data). | Alarm in CDK output; fires on synthetic metric. |
| **S12.3** | Failed-login lockout: after N failures in window, produce `status:'blocked'` (unused today) + optional 429. | Unit: N failures → blocked/429; decision recorded if deferred. |
| **S12.4 (FE.1)** | Finance MFE `/finance/invoices` settings uses JWT-driven current-tenant hook. | FE route-shape/component test; render smoke. |
| **S12.5 (FE.2)** | People MFE Security-Policies matrix reflects backend deny/allow → relates **#334**. | Component test vs backend fixture. |
| **S12.6 (CONF.2/R0.x)** | Formalize live-persona conformance smoke + persona-seed/matrix-runner scripts. | Script green in CI/artifact. |
| **S-DEBT-1** | Consolidate the two session surfaces (security vs sessions module) to one canonical API. | ADR + deprecation of the redundant surface; specs green. |

---

## Cross-references (do not duplicate)
- **#315** — user-lifecycle backend (clean hard-delete, disable/enable, resend-invite, temp-password validity, recovery runbook). S6.2 overlaps → land there.
- **#334** — enterprise RBAC (editable matrix, custom roles, per-user role lifecycle). S9.3 / S12.5 feed it.

## Open decisions for operator
1. Admin UI home (S4.6/S6.x): tenant-facing People/Users MFE vs AdminWeb (control-plane)?
2. Refresh-token target (S3.1): 24h (match DDB session) vs keep longer with short access + R3 epoch?
3. Is hard mid-session revocation (Sprint 7 / R3) alpha-gating, or post-greenlight?
4. Sequencing sanity: **S1 → S2 → S3 → S4 → S5 → S6** (Phase A), then **S7 → S8/S9/S10/S11/S12** (Phase B). S2 (reactivate bugfix) is an early standalone; S3 precedes S4 so the revocation demo is honest.

# RBAC/ABAC — Verified Execution Plan (Alpha)

> **Date:** 2026-06-29. **Companion to** [`rbac-abac-epic.md`](./rbac-abac-epic.md)
> (the architecture + full ticket bodies) and the RBAC-first re-prioritization in
> [`rbac-first-launch-readiness-plan.md`](./rbac-first-launch-readiness-plan.md).
> This doc is the **execution layer**: it records the *verified current state* of
> every epic ticket against `main` (a fresh five-area code audit, post the SH.1/
> SH.2/D.3 finance merges), reconciles the epic with the in-flight
> [`cognito-session-security-audit-epic.md`](./cognito-session-security-audit-epic.md)
> (PR #342), folds in new findings, and re-sequences the remaining work for alpha.
>
> It does **not** restate the 5-layer architecture or re-derive ticket rationale —
> read the epic for that. Where a ticket is unchanged, this doc cites its epic ID
> (R1.1, R2.2, …) rather than copying it.

## 0. Two decisions this plan assumes (override if wrong)

| # | Decision | Default taken | Consequence |
|---|---|---|---|
| D1 | Token/session overlap with PR #342 | **Delegate to #342.** The RBAC/ABAC epic **drops R3**; #342 owns all token/session/revocation (it is the broader superset — session ledger, audit events, app-client + gateway hardening, control-plane audit). RBAC keeps only the **role-change → `AdminUserGlobalSignOut` floor** (live today, see §3 N1) and *consumes* #342's immediate-revocation primitive. | One revocation mechanism, not two. The `authzEpoch`-vs-`TOKEN_DENY` conflict is a single ADR owned by #342 (§3). The RBAC floor ships on this branch with no #342 dependency. |
| D2 | Alpha gate | **Prove + close criticals:** conformance harness → finish R1 → R2 isolation → role-change sign-out floor (RBAC; immediate access-token revocation via #342 fast-follow) → the live gateway-authorizer fix. R4–R6 fast-follow. | R2 (cross-tenant-via-GSI) is treated as a launch blocker, not fast-follow. |

---

## 1. Verified status ledger (audited against `main`, 2026-06-29)

Legend: ✅ done · 🟡 partial · ⬜ open. Evidence is file-level; see the audit notes
in this PR's description for line cites.

### R0 — Ground truth & conformance harness
| Ticket | Status | Note |
|---|---|---|
| R0.1 seed-personas | ⬜ | `scripts/rbac-conformance/` does **not** exist. |
| R0.2 run-matrix | ⬜ | Same — the epic's "measurement instrument" is unbuilt. |
| R0.3 static authz-coverage audit | ✅ | `scripts/audit/authz-coverage.ts` + `npm run lint:authz` + **blocking CI** (`.github/workflows/authz-coverage.yml`); 303/374 routes guard-level (was 214); `StaffReadGuard` added; baseline empty. |
| R0.4 baseline doc | 🟡 | `authz-coverage-findings.md` ✅; the **persona-matrix** baseline depends on R0.2 (open). |

### R1 — Correctness foundation
| Ticket | Status | Note |
|---|---|---|
| R1.1 cross-tenant `500→403` | ⬜ | No `AccessDeniedException`→`ForbiddenException` in any of the **3** `dynamodb-client.service.ts` copies. |
| R1.2 finance `permission.guard.spec` | ✅ | Landed with SH.1 (school-existence, fail-closed) + D.3 (`billing:view` in `bulk-ops.controller.spec`). |
| R1.3 finance `permission-matrix.spec` | ⬜ | Academics **and identity** have one; finance does not. |
| R1.4 finance data-scope tests | ⬜ | No Parent/Student invoice-scope deny tests. |
| R1.5 `/finance/payments/verify/:sessionId` ownership | ⬜ | No dedicated ownership-denial spec. |
| R1.6 deny-wins / multi-role union / escalation | 🟡 | deny-wins ✅, escalation ✅ (indirect); **multi-role-union untested**. |
| R1.7 `JwtAuthGuard` spec | ⬜ | Guard exists; no spec. |
| R1.8 audit-log on deny | 🟡 | Present in finance/identity guards; not a universal asserted convention. |
| R1.9 `InternalApiKeyGuard` spec | ⬜ | Guard exists; no spec. |
| R1.10 identity read-endpoint audit | ✅ | Closed by the R0.3 drain (baseline empty + allowlist justified). |

PDP (`RolesService.checkPermission`) verified **sound**: TenantAdmin bypass → role
load → expiry → deny-wins overrides → multi-role union over `DEFAULT_ROLE_PERMISSIONS`.

### R2 — Tenant isolation *(critical — alpha blocker)*
| Ticket | Status | Note |
|---|---|---|
| R2.1 GSI tenant-prefix audit | ⬜ | **GSI9 (`BLOCK#…`), GSI10 (`prior-enrollment#…`), GSI13 (`symbol#…`) are NOT tenant-prefixed.** GSI1/7/14 ✅ (GSI14 = `TENANT#…#SCHOOL#…#GRADE#…`, finance); GSI8 intentionally cross-tenant (sparse `emisSchoolCode`). Live set = GSI1–10, 13, 14 (GSI11/12 reserved). GSI2–6 are **documented** in [`gsi-inventory.md`](../pilot-greenlight/gsi-inventory.md) but **not classified for tenant-isolation** (school/AY/date-scoped → likely prefixed); C.1 adds the isolation column. |
| R2.2 enforce tenant-scoped GSI access | ⬜ | IAM `LeadingKeys` covers base tables only; GSI policy allows `index/*` with an app-level-filter comment + **no enforcement guard**. |
| R2.3 ADR: LeadingKeys on indexes | ⬜ | — |
| R2.4 STS credential caching | ⬜ | New `AssumeRole` on **every** DB call (no per-tenant cred cache). |
| R2.5 `custom:tenantId` write-once | ⬜ | Attribute is `mutable:true`; no write-once validation against the user record. |

### R3 — Token & session → **DELEGATED to #342** (D1)
Verified open in RBAC terms (no PreTokenGeneration, no `authzEpoch`, 1h TTL,
revocation = refresh-only `AdminUserGlobalSignOut` + opt-in/admin-only
`verifyDynamoRole`), but **owned by #342 going forward.** RBAC retains only
**N1 (role-change invalidation trigger)** in §3.

### R4 — Data-scope scalability *(fast-follow)*
| Ticket | Status | Note |
|---|---|---|
| R4.1/R4.2 guardian→student & portalUser→student GSIs | ⬜ | Not present. |
| R4.3 kill the scan + >1000 fix | ⬜ | Parent/Student scope is a **full-table scan capped at 1000** — silently drops the >1000th child (correctness bug). |
| R4.4 single-flight dedup | ⬜ | — |
| R4.5 teacher-scope N+1 | ⬜ | — |

### R5 / R6 — PDP seam & service identity *(fast-follow)*
| Ticket | Status | Note |
|---|---|---|
| R5.1 `authorize()` seam | ⬜ | PEPs call the PDP directly. |
| R5.4 Cognito-group decision | ⬜ | **Audit confirms the per-tenant group is unused by the authz path** (`jwt.strategy` declares `cognito:groups` but never reads it) → clean retire-or-keep-as-label ADR. |
| R6.1 internal API key rotation | ⬜ | Still deterministic `sha256("edforge-internal-api-key:"+tenantName)`, unrotatable. |

### Frontend (`edforge-saas-frontend`)
| Ticket | Status | Note |
|---|---|---|
| FE.1 finance cross-tenant settings | ✅ | **Fixed** — `FinanceLayout` uses `/tenants/my/settings` (JWT-driven). Bug 2 closed. |
| FE.2 finance MFE gating | ⬜ | Finance MFE has **zero** `usePermission` gating (operators see actions the backend will 403). People/Shell RBAC pages are backend-authoritative ✅. |

> FE.1/FE.2 status is from the **frontend-repo audit** (`edforge-saas-frontend`, the sibling checkout) — not verifiable from this backend branch.

---

## 2. New findings folded in (not in the original epic)

| ID | Finding | Severity | Home |
|---|---|---|---|
| **N-GW** | **Live API-Gateway authorizer trust gap** (#342): the authorizer derives pool/client from the *unverified* token, so any in-region Cognito token passes and a forged `custom:tenantTier=PREMIUM` can reroute `usageIdentifierKey` across usage plans. | **P0 / critical** | #342 AUTH-00-07a, but pulled into the **alpha gate** here (it's a tenant-isolation breach, adjacent to R2). |
| **N-WA** | App-client `writeAttributes` exposes 5 security custom attrs (`tenantId`,`userRole`,`tenantTier`,`tenantName`,`apiKey`) as user-writable. | High | #342 AUTH-00-05; pairs with R2.5 (write-once tenantId). |
| **N-TVG** | An undocumented `TenantValidationGuard` exists in identity + academics. | Info | Document in R0.3 inventory; confirm it isn't a false sense of GSI isolation. |
| **N-FEP** | FE↔BE permission parity is **manual** (`ROLE_PERMISSIONS` hardcoded, hand-synced with `DEFAULT_ROLE_PERMISSIONS`). | Med | New ticket **FE.3** (parity automation). |
| **N-FET** | No Finance/People **MFE** ABAC tests. | Med | New ticket **FE.4**. |

---

## 3. Reconciliation with #342 (token/session)

Both epics converge on the problem (Cognito can't revoke *access* tokens;
role-change/deactivation must invalidate; `AdminUserGlobalSignOut` is the global
primitive) and diverge only on the **per-token invalidation mechanism**:

- **R3:** `authzEpoch` claim minted by a **PreTokenGeneration** Lambda, compared at validation.
- **#342:** a **`TOKEN_DENY` denylist** (keyed `jti`/`origin_jti`) checked in the Nest guard.

**Resolution (D1):** #342 owns this. The single mechanism decision is an **ADR in
#342** (recommendation: *layered* — short access-token TTL + `TOKEN_DENY` denylist
as the immediate-revoke escape hatch, with a PreTokenGeneration `authzEpoch` only
if a claim-versioned path is later wanted). The RBAC epic contributes exactly one
seam:

- **N1 (RBAC-owned *floor* — no #342 dependency):** every role-change /
  deactivation path in `RolesService` / user admin calls the **already-live**
  `AdminUserGlobalSignOut` (`auth.service.ts:695`). Refresh-token revocation works
  **today**, so the user is fully signed out on next token refresh. The residual
  **~1h access-token window** is the documented alpha limitation; closing it
  (immediate access-token revocation via denylist or short TTL) is **#342's** job.
  *Validation:* role demotion → refresh fails immediately (RBAC floor, lands on
  this branch). The "live access token rejected within seconds" harness cell is
  **#342-owned** and shared. This keeps the RBAC alpha gate from hard-blocking on
  #342: the floor ships here; #342 upgrades it from revoked-on-refresh to
  revoked-immediately.

Cross-service note: #342's denylist check in academics/finance guards needs a
`dynamodb:GetItem` grant on the identity table — the **cross-service-DDB-grant
trap** (an empty `tenant-template-stack-basic` diff is the gap). Flagged so
whichever epic lands it includes the grant in the diff.

---

## 4. The alpha gate — sequenced execution

Ordered; each phase is independently demoable and moves conformance-matrix cells
green. House conventions carry over (local gates; three-way route registration;
cross-service IAM-grant diff check; `npm run lint:authz` stays green; deploy
wrapper `scripts/deploy.sh`; every ticket has a `Validation`). **Implement in an
isolated `git worktree` off `origin/main`** per the new CLAUDE.md concurrency rule.

### Phase A — R0 conformance harness *(START HERE; the measurement instrument)*
The single highest-leverage gap: there is no live red/green proof. Builds the
honest baseline every later phase moves.

> B.1/B.2/B.5/B.6 are mocked unit tests and can proceed **in parallel** with A —
> only B.3 (finance data-scope) and D.1 (demote-mid-session) consume the A.1 personas.

| # | Scope | Validation |
|---|---|---|
| A.1 (=R0.1) | `scripts/rbac-conformance/seed-personas.ts`: idempotently mint ST1(+portal)/G1/T1/T2/P1/AC1 in tenant A + B1 in tenant B (Cognito user + `custom:tenantId` + DDB `RoleAssignment` + parent→student + section/co-teacher). | Re-run → no duplication; each persona has the expected role rows + linkage. |
| A.2 (=R0.2) | `scripts/rbac-conformance/run-matrix.ts`: the declarative allow/deny matrix (epic §5) across identity/academics/finance; machine-readable red/green report. | Runs against the seeded non-prod tenant; emits an artifact. |
| A.3 (=R0.4) | Commit `docs/alpha-launch/rbac-baseline-2026-06-29.md` = A.2 run against current `main`. | Baseline doc with real results. |
| A.4 | Add a **cross-tenant-via-GSI probe**: B1 hits a *named, operator-reachable, GSI-backed list endpoint* for tenant A (one whose query rides a GSI — e.g. a school/AY-scoped list; **NOT** the sparse exact-ID GSI9/10/13, which aren't enumerable list routes, so a green probe against GSI1 wouldn't prove anything about them). | Probe names its target endpoint; expected RED until C.2a. |

### Phase B — finish R1 (correctness cells green + CI-enforced)
| # | Scope | Validation |
|---|---|---|
| B.1 (=R1.1) | Cross-tenant `500→403` in all 3 `DynamoDBClientService` copies (only `AccessDeniedException` remapped → `ForbiddenException`+`CROSS_TENANT_FORBIDDEN`). | Per-op unit (AccessDenied→403; others unchanged); harness cross-tenant cell green. |
| B.2 (=R1.3) | Finance `permission-matrix.spec` — full `SchoolRole` enum × finance resources × actions vs `DEFAULT_ROLE_PERMISSIONS`. | Iterates the whole enum; green. |
| B.3 (=R1.4) | Finance data-scope tests (Parent/Student see only own invoices; blocked from manual payment); deny paths assert audit log. | Green using A.1 personas. |
| B.4 (=R1.5) | Harden + spec `/finance/payments/verify/:sessionId` ownership denial. | Spec green; `lint:authz` allowlist entry. |
| B.5 (=R1.6) | **Multi-role-union** test (user with `roles[]` ≥2) + explicit escalation-prevention spec. | Specs green. |
| B.6 (=R1.7/R1.9) | `JwtAuthGuard` + `InternalApiKeyGuard` specs. | Specs green. |
| B.7 (=R1.8) | Audit-log-on-deny convention + assertions across deny paths. | Deny specs assert `logPermissionDenied`. |

### Phase C — R2 tenant isolation + the gateway trust fix *(the alpha blocker)*
| # | Scope | Validation |
|---|---|---|
| C.1 (=R2.1) | Add a **tenant-isolation column** to the existing [`gsi-inventory.md`](../pilot-greenlight/gsi-inventory.md) for every live GSI (GSI1–10, 13, 14); confirm the three offenders (GSI9/10/13) and classify GSI2–6 (expected prefixed). Not a from-scratch audit — extend the inventory. | Inventory has an isolation column for all GSIs; offenders confirmed. |
| C.2a (=R2.2, **alpha**) | **Data-layer GSI-query guard:** every GSI query must carry a tenant-scoped key condition, OR be on a tenant-prefixed PK, OR be explicitly allowlisted sparse-internal (GSI9/10/13 are exact-ID, non-enumerable → a cross-tenant read needs guessing another tenant's UUID). **Intra-table only → no cross-service IAM grant**; a legitimately-empty `tenant-template-stack-basic` diff here is *not* the grant trap. | Unit on the query guard; A.4 probe green for operator-reachable GSIs. |
| C.3a (=R2.5, **alpha**) | **Application-level** write-once for `custom:tenantId`: reject any update in `users.service` + validate it matches the user record. (Cognito `mutable:false` is **not** flippable on the existing shared pool without pool replacement — deferred, see fast-follow.) | Update to `custom:tenantId` rejected (test); mismatch rejected. |
| C.3b (=N-WA, **alpha**) | Remove the 5 security custom attrs (`tenantId`/`userRole`/`tenantTier`/`tenantName`/`apiKey`) from app-client `writeAttributes` (`identity-provider.ts:202`) — a `controlplane`/pool-client deploy. | App-client diff shows attrs removed; a user can't self-write `userRole`/`tenantTier`. |
| **C.4 (=N-GW)** | **Pin the authorizer to the expected `user_pool_id` + `app_client_id`** (env/config) and verify against *those* — today both pool and client are read from the **unverified** token and the `aud` check is circular (`cognito_authorizer.py:22-23,83`), so **any in-region Cognito token passes**; this also blocks the forged-`custom:tenantTier` usage-plan reroute. **Cross-stack export pre-flight required** (authorizer ARN is exported as `TenantApiAuthorizerArn` with downstream importers). | Token from a different pool/client denied; forged-tier reroute blocked; `list-exports`/`list-imports` snapshot captured pre-deploy. |
| C.5 (=R2.4) | TVM per-tenant credential caching (cache assumed-role creds per `tenantId` to ~5 min before expiry). | Unit (hit reuses; expiry refreshes); measured STS call-count drop. |
| C.6 (=R2.3) | ADR: can IAM `LeadingKeys` extend to index queries? | ADR committed. |

### Phase D — role-change invalidation (the RBAC slice of token/session)
| # | Scope | Validation |
|---|---|---|
| D.1 (=N1) | Wire every `RolesService` role-change/deactivation path to #342's `signOutUserEverywhere` (or its event). Coordinate the single revocation mechanism via #342's ADR. | Harness "demote P1 mid-session → live token rejected in seconds" cell green (shared with #342). |

> **Everything below is fast-follow (post-alpha).**

### Fast-follow — R4 data-scope, R5 PDP seam, R6 service identity, FE
| # | Scope | Validation |
|---|---|---|
| R2.2b (carry-over from C.2) | Per-offender remediation of GSI9/10/13: guard-or-migrate each PK to tenant-prefixed — a separate PR each + (if the PK shape changes) a backfill under the one-GSI-per-deploy DDB constraint. | Per-index cross-tenant exact-ID read denied; migration backfilled. |
| R2.5b (carry-over from C.3a) | Cognito `custom:tenantId` schema `mutable:false` — requires a **pool replacement** of the shared BASIC pool; coordinated/ADVANCED-tier migration, **not** an alpha line. | ADR; executed only under a planned pool migration. |
| R4.1–R4.3 | guardian→student + portalUser→student GSIs; refactor parent/student scope to O(1); fix the >1000 correctness bug. | Harness correctness with >1000 students; scan removed. |
| R4.4/R4.5 | single-flight dedup; teacher-scope N+1 batch. | Concurrency + query-count tests. |
| R5.1 | extract `authorize(principal, action, resource, context)`; route all PEPs through it. | No behavior change; harness still green. |
| R5.4 | Cognito-group **retire** ADR (audit confirms unused by authz) — keep-as-label or remove with evidence. | ADR + (if retire) removal PR. |
| R6.1 | internal API key → Secrets Manager + dual-key rotation window. | Rotate with no downtime (both keys accepted during window). |
| FE.2 | Finance MFE `usePermission` gating (mirror academics/people). | RTL + `dev:finance` smoke; render-path trace. |
| FE.3 (=N-FEP) | FE↔BE permission **parity check** — a test/codegen that fails when `ROLE_PERMISSIONS` drifts from backend `DEFAULT_ROLE_PERMISSIONS`. | Parity test fails on hand-introduced drift. |
| FE.4 (=N-FET) | Finance + People MFE ABAC test suites. | RTL per-role gating tests. |

---

## 5. Cross-cutting risks & open decisions

| Risk / decision | Note |
|---|---|
| Two revocation mechanisms ship in parallel | D1 delegates to #342; N1 is the only RBAC seam; ADR in #342 picks the one mechanism. |
| GSI isolation fix misses an index | C.1 classifies all live GSIs (GSI1–10, 13, 14); C.2a is the enforcement guard; A.4 harness probe is the independent backstop. GSI9/10/13 are sparse exact-ID (cross-tenant read needs a UUID guess) → guard now, PK migration fast-follow. |
| Gateway-authorizer fix changes a cross-stack export | apply the cross-stack export pre-flight before deploy. |
| `custom:tenantId` write-once breaks a legitimate re-tenant flow | none exists today (single-tenant-per-user in BASIC); confirm in C.3a. The Cognito schema `mutable:false` is a deferred pool-replacement (R2.5b), not an alpha flip. |
| Open: should N-GW (gateway trust) gate alpha, or ship as a #342 hotfix first? | Recommended: **hotfix now** (it's a live isolation breach), independent of the epic sequencing. |
| Open: D2 alpha-gate aggressiveness | defaulted to "prove + close criticals"; tighten/loosen per owner. |

---

*Generated 2026-06-29 from a five-area code audit (backend authz+tests,
tenant-isolation, token/session, frontend MFE) against `origin/main`, reconciled
with the existing RBAC/ABAC epic and the in-flight Cognito session-security epic
(PR #342). Status reflects post-SH.1/SH.2/D.3 reality, not the epic's original
baseline.*

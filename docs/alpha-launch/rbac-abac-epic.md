# EdForge RBAC/ABAC — Enterprise-Grade Epic

> **Supersedes and expands** the RBAC spine (Sprints 0–3) of
> [`rbac-first-launch-readiness-plan.md`](./rbac-first-launch-readiness-plan.md).
> The offboarding / monitoring / demo-seeding sprints in that plan still stand;
> the RBAC/ABAC work is pulled out here as its own dedicated epic.
>
> **Scope:** `BASIC` tier only (the only tier deployed). ADVANCED/PREMIUM
> (dedicated per-tenant pools, siloed data) remain `V1_DEFERRED`; this epic does
> **not** build them. Where a future requirement is naturally an ADVANCED-tier
> feature (per-tenant federation/SSO, pool-per-tenant isolation), it is named and
> deferred, not designed here.
>
> **Status:** Partially executed. **R0.3** (authz-coverage audit + blocking CI
> gate) and **R1.10** (identity route-closure — `authz-baseline.txt` drained to 0)
> are **shipped & merged** via PRs #309–#313 (Jun 2026) — see the ✅ rows in §6.
> The remainder (R0.1–R0.2, R0.4, R1.1–R1.9, R2–R6) is **Proposed**. Merged ≠
> deployed: the identity guards enforce only after an identity ECR rebuild + ECS
> rolling update. Two architecture forks resolved by recommended default
> (see [§7](#7-decisions--assumptions)); redirect there if you disagree.

---

## 0. The one-paragraph thesis

EdForge's access control is **architecturally sound and follows the AWS SaaS
(sbt-aws / SaaS Builder Toolkit ECS) reference pattern**. The engine is real:
shared-pool-per-tier Cognito with a tenant claim, IAM session-tag ABAC for
tenant isolation, a registry-driven RBAC Policy Decision Point with deny-wins
evaluation, row-level data scoping, and a genuine PEP/PDP split with caching,
circuit-breaking, and fail-closed behavior. **This is a "prove it, harden it,
close the known holes" effort — not a redesign.** The work divides cleanly into
(a) *proving* correctness with a real-persona conformance harness + test
coverage (worst gap: Finance has zero authz tests), and (b) closing a small set
of **specific, high-severity gaps** — GSI queries bypass tenant isolation,
access tokens aren't revoked on role change, parent/student scope does a
full-table scan, and an STS `AssumeRole` fires on every DB call. None require
ripping anything out.

---

## 1. How it actually works today (corrected against production)

### 1.1 The Cognito topology — **shared pool per tier**, not per-tenant

Production (`ap-south-1`) has exactly **three** user pools:

| Pool | Purpose | State |
|---|---|---|
| `basicUserPoolbasic-…` | **All BASIC tenants + all their users** | Active (the live pool) |
| `CognitoAuthUserPool…` | **Platform / SaaS-provider control plane** (system admins) | Active, separate |
| `advancedUserPooladvanced-…` | ADVANCED-tier scaffolding | Empty (bootstrapped, deferred) |

There is **no per-tenant pool**. `tenant-template-stack-basic` is the **shared**
BASIC stack, deployed once; its `identity-provider.ts:58` `new UserPool()`
yields the single `basic` pool for the whole tier. Tenants are partitioned
**inside** the shared pool by two parallel mechanisms written at user creation:

1. **`custom:tenantId`** attribute (`users.service.ts:139`) — **the authoritative
   tenant claim.** It is what the JWT carries, what the Token Vending Machine
   maps to the STS session tag (`REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES =
   {"tenant":"custom:tenantId"}`), and what every app code path reads.
2. **A Cognito group named after the tenant UUID** (`provision-tenant.sh:204-212`,
   `users.service.ts:152-166`) — created and joined for every user, but **read by
   nothing in the authorization path.** `cognito:groups` is declared in the JWT
   type (`jwt.strategy.ts:19`) and otherwise unused for tenant resolution. The
   group's IAM Role ARN and Precedence are empty.

**Consequence #1 (architecture smell):** tenant membership has **two writers**
(`custom:tenantId` + group) and **one reader** (`custom:tenantId`). The group is
a redundant artifact of the sbt-aws reference. It is drift-prone and earns its
own decision in this epic ([R5.4](#sprint-r5--pdp-interface--future-proofing)).

**Consequence #2 (the load-bearing fact):** in BASIC there is **no Cognito-pool
tenant boundary**. Tenant isolation rests entirely on **three** layers — the
`custom:tenantId` claim, the IAM session-tag ABAC, and app-level filtering. This
*raises* the severity of any hole in those three (notably the GSI bypass below),
because there is no pool boundary as a backstop.

**Consequence #3 (constraints to document, not solve now):** a shared pool means
**email is unique pool-wide** (the same human can't hold accounts in two
different tenants under one email) and **per-tenant SSO/federation is hard** (one
pool, one IdP config set). Both are naturally **ADVANCED-tier** concerns
(dedicated pool per tenant) and are out of scope here — but must be written down
so we don't trip over them in alpha.

### 1.2 The five layers (the real spine)

| Layer | Mechanism | Where |
|---|---|---|
| **L1 AuthN** | Shared per-tier Cognito pool; JWT carries `custom:tenantId`, `custom:userRole` (global role only), tier, name. **No PreTokenGeneration Lambda** (only a PostAuth analytics hook). 1h access-token TTL (Cognito default). | `identity-provider.ts`, `jwt.strategy.ts:16-31` |
| **L2 Tenant isolation (IAM ABAC)** | Per request: TVM `STS AssumeRole` tagging `tenant=custom:tenantId`; role policy enforces `dynamodb:LeadingKeys = ${aws:PrincipalTag/tenant}`. | `token-vending-machine.ts:73-112`, `ecs-dynamodb.ts:288-298`, `dynamodb-client.service.ts:47-69` |
| **L3 App-level tenant filtering** | Required because **GSI queries bypass L2** (LeadingKeys only constrains base-table PKs). | data-access layer |
| **L4 RBAC (PDP)** | `RolesService.checkPermission`: TenantAdmin bypass → load `RoleAssignment` for school → expiry → deny-wins `permissionOverrides` → union `DEFAULT_ROLE_PERMISSIONS` over `roles[]`. PEPs (guards) in academics/finance call it over HTTP (5-min per-instance cache, circuit breaker, **fail-closed**). | `roles.service.ts:539-606`, `roles.controller.ts:150-158`, `permission.guard.ts` |
| **L5 ABAC data scope** | `DataScopeService`: school / section (primary + co-teacher) / student. | `data-scope.service.ts` |

**Roles:** 2 global (`TenantAdmin`/`TenantUser`) × 9 school (`Principal`,
`VicePrincipal`, `Teacher`, `Accountant`, `Staff`, `Counselor`, `Nurse`,
`Student`, `Parent`), code-defined, validated at startup against
`PERMISSION_REGISTRY` (~24 resources). **The Security Policies matrix is
read-only** (`GET …/permissions/catalog`); **Assign User Role** posts
`{schoolId, role}` (`POST /users/:id/roles`), gated by seniority-based
escalation prevention. **No custom roles** in V1.

**Persistence:** one `RoleAssignment` row per (user, school) —
`PK=TENANT#{tid}`, `SK=USER#{uid}#ROLE#{schoolId}`, `GSI3PK=SCHOOL#{tid}#{schoolId}`
(note: tenant-prefixed — good). `roles[]` (multi-role), `permissionOverrides[]`
(deny-wins), `expiresAt` (read-side only), `isActive` soft-delete, role-change
history.

### 1.3 In PEP/PDP/PAP/PIP terms

- **PDP** (decide): `RolesService.checkPermission` — bespoke, in identity.
- **PEP** (enforce): the guards; academics/finance call the PDP over HTTP.
- **PAP** (administer): the Security Policies UI + `PERMISSION_REGISTRY` (code) +
  role-assignment APIs.
- **PIP** (attributes): DDB role rows, school memberships, parent→student links,
  section/co-teacher assignments.

All four exist. The epic hardens each; it does not introduce new infrastructure.

---

## 2. What's strong — do **not** rebuild

- The L1→L2 chain (`custom:tenantId` → STS session tag → `LeadingKeys`) is the
  correct AWS SaaS pooled-isolation pattern. Keep it.
- Deny-wins evaluation, multi-role union, seniority escalation prevention,
  per-user `permissionOverrides`, role expiry, soft-delete + history — all
  present and reasonable.
- The PEP/PDP split with **fail-closed** HTTP checks, 5-min cache, and a circuit
  breaker is a sound topology for the current scale.
- `DataScopeService` row-level scoping (incl. co-teacher homeroom) is real.
- Academics already has authz tests (`permission.guard.spec.ts`,
  `permission-matrix.spec.ts`); identity has `iemis-permission.guard.spec.ts`,
  `roles.service.spec.ts`, `roles.cross-tenant.spec.ts`, and
  `server/application/test/e2e/security.e2e.spec.ts`. We extend, not rewrite.

---

## 3. The gaps, triaged

### 3.1 Correctness / security

| Sev | Gap | Evidence |
|---|---|---|
| **Critical** | **GSI queries bypass IAM tenant isolation** (L2 only covers base-table PKs). With no pool boundary in BASIC, cross-tenant safety on indexes depends entirely on app-level filtering being correct on *every* GSI query. | `ecs-dynamodb.ts:288-298` |
| **High** | **Access-token revocation gap** — role change signs out refresh tokens (`AdminUserGlobalSignOut`) but live access tokens stay valid ~1h; `verifyDynamoRole` re-check is opt-in per handler. | `permission.guard.ts:49-64` |
| **High** | **Finance authz: zero tests.** People/identity missing multi-role-union, deny-wins-override, cross-tenant-denial proofs. | (no finance guard spec) |
| **Med** | **Cross-tenant `AccessDenied` → 500 not 403.** | `dynamodb-client.service.ts`; deferred-work Bug 1 |
| **Med** | **Tenant-membership dual source of truth** (`custom:tenantId` + redundant Cognito group); drift risk; a wrong `custom:tenantId` would be an isolation breach (it drives L2). | `users.service.ts:139,152-166` |
| **Med** | **Deterministic, unrotatable internal API key** `sha256("edforge-internal-api-key:"+tenantName)`. | `tenant-template-stack.ts:182` |

### 3.2 Scalability / availability

| Sev | Gap | Evidence |
|---|---|---|
| **High** | **Parent/Student data-scope = full student-table scan (limit 1000)** per request; the 1000 cap is also a correctness bug (>1000-student school silently drops a child). No GSI on guardian→student or portalUser→student. | `data-scope.service.ts:269-363` |
| **Med-High** | **STS `AssumeRole` on every DB call**, no credential caching — latency + STS-throttle exposure. | `dynamodb-client.service.ts:47-69` |
| **Med-High** | **No single-flight dedup** → scope-resolution stampede on cache expiry. | `data-scope.service.ts:94-164` |
| **Med** | **Per-instance caches** (not distributed) → cross-task inconsistency up to TTL. | guards' in-memory LRU |

---

## 4. Target architecture (what "enterprise-grade" means here)

Organized by component, with explicit **do-now / design-for-later / don't-build-yet**
calls so we don't prematurely optimize.

- **Pool topology — KEEP shared-per-tier (do nothing).** The pooled BASIC model
  is correct and cost-appropriate; pool-per-tenant is the *deferred ADVANCED-tier*
  design. Moving BASIC to per-tenant pools now would be premature and contradict
  the tier roadmap. Document the shared-pool constraints (pool-wide email
  uniqueness; per-tenant SSO is ADVANCED-tier).
- **PDP — harden bespoke behind a clean `authorize()` seam; defer Amazon Verified
  Permissions / Cedar.** For 9 fixed code-defined roles on a `resource:action`
  model, AVP is over-build (extra service, schema migration, policy authoring).
  Wrap the PDP in one stable `authorize(principal, action, resource, context)`
  interface so AVP/Cedar can slot in later without touching every PEP. **Trigger
  to revisit AVP:** tenant/governance-body **custom roles**, attribute-condition
  policies beyond data-scope, or delegated policy authoring.
- **Token & session — add the PreTokenGeneration Lambda for an `authzEpoch`
  claim (NOT fine-grained permissions).** Bump `user.authzEpoch` in DDB on any
  role change; stamp it into the token; the guard compares token vs current and
  forces re-auth on mismatch. Pair with a shorter access-token TTL (~15 min). This
  is the correct fix for the access-token revocation gap (Cognito can't revoke
  access tokens). The Lambda also *validates* `custom:tenantId` against the user
  record at token time — closing the dual-source-of-truth drift risk.
- **Tenant isolation — close the GSI hole + cache STS creds.** Audit every GSI
  for a tenant-prefixed PK; enforce tenant-scoped GSI access at the data layer
  with a conformance test; investigate extending the IAM condition to indexes.
  Cache assumed-role creds per `tenantId` for their TTL (cuts STS calls from
  per-query to per-tenant-per-hour). Make `custom:tenantId` write-once.
- **Data-scope (PIP) — add guardian/portal GSIs; kill the scan.** O(1) lookups
  for parent/student scope; single-flight dedup. **Don't** add Redis/ElastiCache
  yet — trigger-gate distributed caching on observed per-instance-cache pain.
- **PAP — keep code-defined roles + read-only matrix.** Design (not build) a
  DB-defined custom-role path evaluated by the same engine, for the deferred
  `GovernanceProfile.roles`.
- **Group-per-tenant — decide.** Audit all consumers; recommend treating
  `custom:tenantId` as the single source of truth and either retiring the group
  (if nothing reads it) or keeping it strictly derived/no-drift. Investigate
  before removing (sbt-aws machinery).
- **Service identity — Secrets Manager + rotation now; signed service tokens
  later.** Replace the deterministic internal key with a per-tenant rotated
  secret + dual-key window; the full service-identity-token replacement stays
  deferred.

---

## 5. Test instrumentation — the real-persona conformance harness

The highest-fidelity proof, and **where this epic starts.** Mint real Cognito
users (exactly the personas you described) and run a declarative allow/deny
matrix against the deployed API. This harness is the **measurement instrument for
the entire epic** — every sprint moves red cells green.

**Personas (in a non-prod BASIC tenant A, + a tenant B for cross-tenant):**
`ST1` (student + portal account), `G1` (guardian linked to ST1), `T1` (teacher of
ST1's section), `T2` (teacher of a *different* section, not ST1's), `P1`
(principal), `AC1` (accountant); `B1` (any user in tenant B).

**The matrix (the executable definition of "RBAC works"):**

| Actor | Call | Expect |
|---|---|---|
| `T1` | view ST1's grades/attendance | ✅ (section scope) |
| `T2` | view ST1's grades/attendance | ❌ (not their section) |
| `G1` | view ST1's grades + invoices | ✅; ❌ any other student |
| `ST1` | view own / others | ✅ own; ❌ others |
| `AC1` | view billing / edit grades | ✅ billing; ❌ grades |
| `P1` | school-wide / delete grades | ✅ wide; ❌ delete grades (matches the matrix UI) |
| `B1` | any tenant-A resource (direct **and** via a list/GSI endpoint) | ❌ 403/404, **no leak** |
| admin | demote `P1` mid-session | `P1`'s live token rejected within seconds |

Implemented as `scripts/rbac-conformance/` (seed + runner + report), runnable
against non-prod with real logins. It complements the unit/CI matrix (which runs
mocked, in-CI) — the harness is the live, end-to-end truth.

---

## 6. The Epic — sprints and atomic tasks

Conventions carry over from the launch-readiness plan (local gates,
three-way route registration, cross-service IAM-grant diff check, deploy
wrapper, every ticket has an explicit validation). **Repos:** backend =
`edforge`; frontend (People/Finance MFEs) = `edforge-saas-frontend` (present as a
sibling checkout). Each sprint is independently demoable and builds on R0's
harness.

**Alpha gate = R0–R3** (prove correctness + close the isolation/revocation
holes). **R4–R6 = fast-follow.**

### Sprint R0 — Ground truth & conformance harness  *(START HERE)*

**Demo:** a red/green conformance matrix from real personas = the honest baseline
of where authz actually holds today.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R0.1** | edforge | `scripts/rbac-conformance/seed-personas.ts`: idempotently create ST1(+portal)/G1/T1/T2/P1/AC1 in tenant A and B1 in tenant B — `AdminCreateUser` + `custom:tenantId` + group + DDB `RoleAssignment` rows + parent→student link + section/co-teacher assignment. | Run → assert each persona has expected role row + linkage; re-run → no duplication. |
| **R0.2** | edforge | `scripts/rbac-conformance/run-matrix.ts`: declarative allow/deny matrix (§5) executed with each persona's token across identity/academics/finance; machine-readable pass/fail + red/green report. | Runs against the seeded tenant; emits a report artifact. |
| **R0.3** ✅ **SHIPPED** | edforge | Static authz-coverage audit: parse `*.controller.ts` → per-route guard/decorator map → `docs/alpha-launch/authz-coverage.generated.md`; `npm run lint:authz` fails on un-allowlisted `UNGUARDED-REVIEW`. | Gate fails on a deliberately unguarded test route; passes on current tree. **DONE:** `scripts/audit/authz-coverage.ts` (covers identity/academics/finance) + blocking CI `.github/workflows/authz-coverage.yml`; commits `9ebbca0`, `433cb39`; PRs #309–#313. Green on `main`: **305/377** routes guard-enforced. Finance now consumes the gate (PR #366). |
| **R0.4** | edforge | Commit `docs/alpha-launch/rbac-baseline-<date>.md` = R0.2 + R0.3 run against current `main`, documenting exactly which cells are red today. | Baseline doc exists with real results (the "where we stand" deliverable). |

### Sprint R1 — Correctness foundation

**Demo:** RBAC-logic cells go green; CI gates enforce them. (Absorbs the prior
plan's Sprint 0–2 test work.)

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R1.1** | edforge | Cross-tenant `500→403`: `DynamoDBClientService` catches AWS `AccessDeniedException` on all ops → `ForbiddenException` + `CROSS_TENANT_FORBIDDEN`; only that error is remapped. | Unit per op (AccessDenied→403; other→unchanged); harness cross-tenant cell green. |
| **R1.2** | edforge | `finance/.../permission.guard.spec.ts` (mirror academics guard spec). | New spec green. |
| **R1.3** | edforge | `finance/.../permission-matrix.spec.ts`: **full** `SchoolRole` enum × finance resources × actions vs `DEFAULT_ROLE_PERMISSIONS`. | Spec iterates the whole enum; green. |
| **R1.4** | edforge | Finance data-scope tests (dep **R0.1**): Parent/Student see only their own invoices; Parent/Student blocked from manual payment. Deny paths assert the audit log. | Spec green using seeded personas. |
| **R1.5** | edforge | Harden + document `GET /finance/payments/verify/:sessionId` (gateway callback); assert ownership denial; AUD allowlist entry. | Spec green; gate passes. |
| **R1.6** | edforge | People: deny-wins override + multi-role union + escalation-prevention tests. | Specs green. |
| **R1.7** | edforge | `JwtAuthGuard` front-door spec: expired/malformed/absent → 401; `isPublic` allowed; valid → context populated. | Spec green. |
| **R1.8** | edforge | Audit-log emission assertions on every deny path (convention + tests). | Deny specs assert `logPermissionDenied` payload. |
| **R1.9** | edforge | `InternalApiKeyGuard` spec (missing/wrong/unconfigured → 401; correct → pass). Rotation lands in R6. | Spec green. |
| **R1.10** ✅ **SHIPPED** | edforge | Close identity read-endpoint audit from R0.3 (guard or justify+allowlist every `UNGUARDED-REVIEW`). | `lint:authz` passes with zero un-allowlisted. **DONE:** write-gating batches 1–8 (`101a53d`→`557174f`), allowlist triage (`80f4967`), `StaffReadGuard` (`dcc548a`, `b6365f3`); `authz-baseline.txt` drained to **0**. PRs #310–#313. |

### Sprint R2 — Tenant-isolation hardening  *(the critical layer)*

**Demo:** cross-tenant-via-GSI test green in the harness; measured STS call-count
drop.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R2.1** | edforge | GSI tenant-isolation **audit**: enumerate every GSI across identity/academics/finance; confirm each GSI PK is tenant-prefixed; report. | Report lists every GSI + tenant-prefix status. |
| **R2.2** | edforge | Enforce tenant-scoped GSI access: data-layer invariant/guard that every GSI query carries a tenant-scoped PK; cross-tenant GSI read → denied/empty. | Unit on the query guard; harness cross-tenant-via-GSI cell green. |
| **R2.3** | edforge | Spike + ADR: can the IAM `LeadingKeys` ABAC condition extend to index queries? Document finding. | ADR doc committed. |
| **R2.4** | edforge | TVM **credential caching**: cache assumed-role creds per `tenantId` until ~5 min before expiry; lazy refresh. | Unit (hit reuses; expiry refreshes); measured STS call-count drop. |
| **R2.5** | edforge | Make `custom:tenantId` **write-once** + validated against the user record at creation. | Test: attribute immutable post-create; mismatch rejected. |

### Sprint R3 — Token & session lifecycle  *(revocation correctness)*

**Demo:** demote a user mid-session → their live token is rejected within
seconds, not an hour.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R3.1** | edforge | Add the **PreTokenGeneration Lambda** trigger; inject `authzEpoch`; validate `custom:tenantId` matches the user record. | Token contains `authzEpoch`; mismatch handled (test). |
| **R3.2** | edforge | `user.authzEpoch` in DDB, bumped on any role change / deactivation. | Unit: epoch bumps on role change. |
| **R3.3** | edforge | Guard/PDP compares token `authzEpoch` vs current → mismatch = 401 re-auth. | Harness "demote mid-session → token rejected" cell green. |
| **R3.4** | edforge | Shorten access-token TTL (~15 min); validate refresh flow. | TTL config + e2e refresh works. |
| **R3.5** | edforge | Systematize the stale-role check via epoch; retire ad-hoc `verifyDynamoRole` where epoch covers it. | Sensitive-op tests green; no regression. |

### Sprint R4 — Data-scope scalability

**Demo:** parent/student scope is O(1); correctness holds past 1000 students.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R4.1** | edforge | Add GSI on `student.guardians[].userId` (guardian→students). | `cdk diff` shows GSI; query returns child set O(1). |
| **R4.2** | edforge | Add GSI on `student.portalUserId` (student→self). | `cdk diff` shows GSI; O(1) lookup. |
| **R4.3** | edforge | Refactor parent/student scope to GSI lookup; remove the 1000-row scan + fix the >1000 correctness bug. | Harness correctness with >1000 students; perf measured. |
| **R4.4** | edforge | Single-flight dedup for scope + permission resolution. | Unit: concurrent calls → one upstream fetch. |
| **R4.5** | edforge | Teacher-scope N+1 reduction (batch per-section enrollment queries). | Query-count test shows reduction. |

### Sprint R5 — PDP interface & future-proofing

**Demo:** all PEPs call one `authorize()` interface (no behavior change); the
forward-looking ADRs are merged.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R5.1** | edforge | Extract `authorize(principal, action, resource, context)`; route all PEPs through it. | PEPs depend on the interface; harness still green (no behavior change). |
| **R5.2** | edforge | **ADR: bespoke PDP vs Amazon Verified Permissions / Cedar** — decision + trigger. | ADR merged. |
| **R5.3** | edforge | **Design** (not build) the DB-defined custom-role path evaluated by the same engine. | Design doc / ADR. |
| **R5.4** | edforge | **Cognito-group decision**: audit every consumer of the tenant group; ADR keep-as-label-vs-retire; if retired, remove with consumer-audit evidence; if kept, guarantee no-drift with `custom:tenantId`. | ADR + (if retire) removal PR with evidence. |

### Sprint R6 — Service identity & secret hygiene

**Demo:** rotate the internal key with zero downtime.

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **R6.1** | edforge | Internal API key → Secrets Manager + dual-key rotation window (`INTERNAL_API_KEY` + `_PREVIOUS`). | Rotate with no downtime (test: both keys accepted during window). |
| **R6.2** | edforge | ADR: signed service-identity tokens (SigV4 / OIDC) to replace the shared secret (design, deferred impl). | ADR merged. |

### Frontend (People / Finance MFEs) — `edforge-saas-frontend`

The authz *enforcement* is backend; the MFEs must reflect it. These ride
alongside R1 (Finance) and R1/R5 (People), tracked in the frontend repo:

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **FE.1** | edforge-saas-frontend | Finance MFE: fix the cross-tenant `/finance/invoices` settings request (deferred-work Bug 2) to use the JWT-driven current-tenant hook. | Network panel: settings request tenant == JWT tenant; render smoke. |
| **FE.2** | edforge-saas-frontend | People MFE: ensure the Security Policies matrix + Assign-User-Role reflect server-side deny/allow (no client-only gating). | Render smoke per the route→component trace; backend conformance is source of truth. |

---

## 7. Decisions & assumptions

| # | Decision | Chosen default | Redirect if… |
|---|---|---|---|
| 1 | PDP engine | **Harden bespoke + `authorize()` seam; defer AVP/Cedar** | you want AVP evaluated as a first-class option now |
| 2 | Epic packaging | **Supersede + expand the RBAC spine in PR #306** (confirmed by owner) | — |
| 3 | Alpha aggressiveness | **Alpha-gate at R3**; R4–R6 fast-follow | you want full R0–R6 before alpha, or a tighter R0–R1-only alpha gate |
| 4 | Pool topology | **Keep shared-per-tier (BASIC)**; per-tenant pools stay ADVANCED-tier deferred | a customer needs per-tenant SSO/isolation in alpha (→ pulls ADVANCED forward) |
| 5 | Cognito group-per-tenant | **Investigate consumers, then keep-as-label-or-retire (R5.4)** | you want it retired immediately (riskier; needs the consumer audit first) |

**Explicitly out of scope (deferred):** per-tenant Cognito pools, per-tenant
federation/SSO, custom-role authoring (build), Amazon Verified Permissions
adoption, distributed (Redis) caching, cross-tenant same-identity — each named
with a trigger above or in §4.

---

## 8. Cross-cutting risks

| Risk | Mitigation |
|---|---|
| GSI isolation fix misses a table/index | R2.1 audit is exhaustive across all three services; R0.2 harness probes a list/GSI endpoint cross-tenant as an independent check. |
| `authzEpoch` adds latency to every request | Epoch is a single claim compare; the current value is cached like permissions; only a mismatch hits DDB. |
| Retiring the Cognito group breaks sbt control-plane machinery | R5.4 requires a consumer audit *before* removal; default is keep-as-label until proven unused. |
| STS credential caching serves stale tenant creds | Creds are tenant-scoped and short-TTL; cache keyed by `tenantId`, refreshed before expiry — a tenant only ever gets its own creds. |
| Harness needs real logins / non-prod env | R0 seeds real Cognito users you create; runs against non-prod only (no prod access). |

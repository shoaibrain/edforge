# EdForge Alpha-Launch Readiness — RBAC-First Sprint Plan

> **Status:** Reviewed — incorporates an independent subagent review pass
> (see [§11 Review changelog](#11-review-changelog)).
> **Re-prioritization owner decision (2026-06-20):** RBAC/ABAC correctness and
> end-to-end role coverage is the **top priority** for alpha. Self-serve
> public sign-up, OAuth (GitHub/Google) federation, a public sandbox, and
> Stripe SaaS billing are **explicitly deprioritized** out of the alpha
> critical path (see [§9 Deferred](#9-explicitly-deferred-out-of-alpha-scope)).
> Offboarding, monitoring/engagement, and demo-data depth stay in scope but
> sequence **after** the RBAC hardening spine.

This plan is grounded in a code-level audit of the backend
(`server/application/microservices/{identity,academics,finance}` and
`server/lib`). It does **not** invent new product surface — every ticket is
hardening, test coverage, correctness, or operational completion of code that
already exists.

**Repo scope note.** This branch is checked out against the **backend**
(`shoaibrain/edforge`) only; the tenant-facing frontend
(`shoaibrain/edforge-saas-frontend`, which contains the **Finance** and
**People** MFEs) is a separate repo not present in this environment. Tickets
tagged `repo: edforge-saas-frontend` are specified here for completeness and
sequencing but must be implemented from that repo. The authorization
*enforcement* that those MFEs depend on is **backend**, and that is what this
branch can land and test.

---

## 1. Why this shape — the re-prioritization in one paragraph

The authorization **engine** is already built and reasonably sophisticated:
a JWT guard, a `@RequirePermission` / `PermissionGuard` resource layer, a
`@RequireGlobalRole` / `GlobalRoleGuard` global layer, an IEMIS-specific
guard, a canonical `PERMISSION_REGISTRY`, deny-wins permission evaluation
with per-user overrides and multi-role union, row-level `DataScopeService`
(school / section / student), and IAM tenant-tag isolation at the task-role
layer. What is **missing** is *proof it works* — the Finance service has no
permission-guard tests at all, the People/identity domain is missing the
multi-role / deny-wins / cross-tenant cases, and a known cross-tenant call
returns `500` instead of `403`. For an alpha where strangers get accounts,
**an untested authorization matrix is the single highest-severity risk** —
higher than not having self-serve signup (which an operator can do manually
for a handful of alpha tenants) or Stripe (alpha can be free/invoiced). So we
harden and prove RBAC first, then complete offboarding/monitoring/seeding,
and defer the growth-funnel features.

---

## 2. Priority order (the re-prioritization)

| # | Sprint | Theme | Critical-path item | Rationale |
|---|---|---|---|---|
| **0** | Authorization Audit & Correctness Foundation | RBAC | #6 (enabling) | Can't harden what isn't enumerated; fixes the cross-tenant `500→403` bug; seeds multi-role test users that every later RBAC sprint needs. |
| **1** | Finance ABAC Hardening & Tests | RBAC | #6 (Finance MFE) | The explicitly-flagged, highest-severity gap: **zero** finance authz tests today. |
| **2** | People / Identity ABAC Hardening & Tests | RBAC | #6 (People MFE) | Second flagged gap: user/role assignment, escalation prevention, multi-role union, deny-wins overrides untested. |
| **3** | Academics Data-Scope + Cross-Service ABAC Conformance E2E | RBAC | #6 (end-to-end) | Row-level scope + a single role×resource×tenant conformance suite that becomes the regression net. |
| **4** | Tenant Offboarding Completion | Offboarding | #3 | `deprovision-tenant.sh` exists but leaks Cognito pools / SNS topics and has no data export; alpha users will ask to leave + take their data. |
| **5** | Usage Monitoring & Engagement | Monitoring | #4 | Operational alerting exists; product-usage / churn / engagement layer does not. Needed to babysit an alpha cohort. |
| **6** | Demo-Data Depth | Seeding | #5 | One structure-only pilot fixture exists; needs students/grades/attendance/finance so an alpha user (and our own RBAC E2E) can experience a populated tenant. |
| **—** | Deferred | Growth funnel | #1, #2 | Self-serve OAuth signup, public sandbox, Stripe SaaS billing — out of alpha scope; see §9. |

**Sequencing logic:** 0 → 1 → 2 → 3 form the RBAC spine and must land in
order (0 produces the audit + fixtures the rest assert against). 4, 5, and 6
are independent of each other and each is self-contained and demoable; all
three can start once 3 is green. There is **no** circular dependency between 3
and 6: the role-user fixture Sprint 3 needs is delivered *early* in Sprint 0 as
`AUD.4a` (one user per role); Sprint 6's `SEED.2` later *extends* that same
helper into a full roster. So Sprint 3 consumes AUD.4a, never Sprint 6.

---

## 3. Per-area readiness assessment

For each alpha-critical area: **what's built**, **what's missing**, the
**minimal viable implementation (MVP)** for alpha, and **what could go wrong**.

### 3.1 ABAC role testing & audit  — *PRIORITY 1*

**Built.**
- Guards: `JwtAuthGuard` (`server/application/libs/auth/src/jwt-auth.guard.ts`),
  `PermissionGuard` (identity: `…/identity/src/common/guards/permission.guard.ts`,
  direct DDB; academics/finance: `…/<svc>/src/common/guards/permission.guard.ts`,
  HTTP to identity via `identityClient.checkPermission()`),
  `GlobalRoleGuard`, `IemisPermissionGuard`, `InternalApiKeyGuard`
  (service-to-service).
- Role model: `GlobalRole = 'TenantAdmin' | 'TenantUser'`;
  `SchoolRole = 'Principal' | 'VicePrincipal' | 'Teacher' | 'Accountant' | 'Staff' | 'Counselor' | 'Nurse' | 'Student' | 'Parent'`
  (`…/identity/src/common/entities/base.entity.ts:108,113`).
- Canonical `PERMISSION_REGISTRY`
  (`…/identity/src/common/constants/permission-registry.ts`) +
  `validatePermissionsAgainstRegistry()`; `DEFAULT_ROLE_PERMISSIONS`
  (`…/role-assignment.entity.ts:145-240`).
- Evaluation: `RolesService.checkPermission()`
  (`…/identity/src/roles/roles.service.ts:539-606`) — TenantAdmin bypass,
  deny-wins `permissionOverrides`, multi-role union, seniority-based
  escalation prevention (`roles.service.ts:40-50`).
- Row-level: `DataScopeService`
  (`…/academics/src/common/services/data-scope.service.ts`) — school / section
  (primary + `coTeacherIds`) / student scope, fail-closed.
- IAM: tenant-tag ABAC role conditions
  (`server/lib/tenant-template/tenant-template-stack.ts:561-595`).

**Missing.**
- **Finance authz tests: none** (no finance permission-matrix or guard spec).
- People/identity: no multi-role-union test, no deny-wins-override test, no
  data-scope cache-invalidation test; cross-tenant denial tested only at
  identity, not academics/finance.
- No machine-generated **authz coverage map** (which endpoints have a guard /
  decorator); audit was sampled, not exhaustive.
- Cross-tenant `AccessDeniedException` surfaces as `500` not `403`
  (`…/identity/src/common/services/dynamodb-client.service.ts`, per
  `docs/pilot-greenlight/deferred-work.md` Bug 1).
- **`JwtAuthGuard` front door untested** — no spec for expired / malformed /
  absent JWT → `401` (`server/application/libs/auth/src/jwt-auth.guard.ts`).
- **`InternalApiKeyGuard` untested + no rotation path** — a single static
  `process.env.INTERNAL_API_KEY` `timingSafeEqual` compare, no spec, no
  dual-key rotation window
  (`…/finance/src/common/guards/internal-api-key.guard.ts`).
- **No audit-log emission assertions** — the academics guard already calls
  `auditLogger.logPermissionDenied()` on every deny
  (`…/academics/src/common/guards/permission.guard.ts:156-162`) but no test
  pins that the breach-investigation trail fires.

**MVP for alpha.** A generated per-endpoint authz inventory enforced as a CI
gate; a role×resource conformance test per service (Finance + People first);
the `500→403` fix; multi-role + deny-wins + cross-tenant denial covered.

**What could go wrong.** Silent over-permission (a role can hit an endpoint it
shouldn't) ships invisibly — `nest build` passes, the smoke passes, and the
breach only shows when an alpha user reads another school's grades or another
tenant's invoices. HTTP-mediated checks (academics/finance → identity) add a
failure mode: if the identity call errors and a guard fails *open*, everything
is exposed; the conformance E2E must assert fail-*closed*.

### 3.2 Tenant offboarding  — *PRIORITY 4*

**Built.** `deprovision-tenant.sh` (BASIC-tier hard delete of identity/academics/
finance rows by tenantId), wired as SBT `DeprovisioningScriptJob`
(`core-appplane-stack.ts:106-114`) with a CodeBuild `FailedBuilds` alarm
(`:164-175`). Soft-delete (`isActive`) for entity-level deletes. Operator
helper scripts under `scripts/cleanup-orphans/` (`sweep-tenant-rows.ts`,
`sweep-tenant-sns.ts`, `verify-sbt-state.ts`).

**Missing.** No data export (GDPR portability); per-tenant **Cognito user pool
not destroyed**; per-tenant **SNS alert topic not cleaned**; no cross-service
cleanup validation (analytics tables, S3 PDFs/assets, CloudWatch log groups);
no deprovision status/audit trail.

**MVP for alpha.** (a) Make `deprovision-tenant.sh` *complete* — destroy the
Cognito pool + SNS topic, emit an audit event, and run a post-deprovision
orphan-scan that fails loudly. (b) A one-shot tenant **data export** to S3
(JSON, per-table) the operator can hand to a departing tenant.

**What could go wrong.** Orphaned Cognito pools accrue cost and are a data-
retention liability (PII lingering after "deletion"); a half-deleted tenant
whose rows are gone but whose pool survives looks "deleted" in AdminWeb while
still holding accounts — exactly the kind of state the SBT ISSUE-008
green-checkmark trap hides.

### 3.3 Usage monitoring & alerts  — *PRIORITY 5*

**Built.** Operational alerting: SES bounce/complaint reputation alarms
(`server/lib/shared-infra/email-identity.ts:76-104`), CodeBuild
provision/deprovision failure alarms, analytics aggregator + DLQ + operator
SNS (`analytics-stack.ts`), per-tenant alert topic. Event→metric aggregation
pipeline (rollup/report Lambdas) into `EdforgeAnalyticsTable`
(`TENANT#…` / `FLEET#ALL` keys).

**Missing.** No active-tenant / inactivity classification, no churn-risk flag,
no engagement emails, no operator "fleet health" view of who's actually using
the product.

**MVP for alpha.** A scheduled job that reads existing analytics aggregates,
classifies each tenant `active | idle | dormant` by last-activity, and (a)
emits a daily operator digest, (b) optionally sends a templated re-engagement
email to dormant tenants via the **already-built** SES infra.

**What could go wrong.** Sending engagement email reuses production SES
reputation — a buggy loop that emails the same address repeatedly trips the
bounce/complaint alarms and can get the sending identity throttled, harming
transactional (invite/receipt) mail. Engagement sends must honor SES
suppression and be rate-limited + dry-run-able.

### 3.4 Demo-data seeding  — *PRIORITY 6*

**Built.** `@edforge/pilot-fixtures` with **one** fixture
(`pilots/pabson-saraswati-bs-2083/`): academic structure, bell schedule,
12-month BS calendar, holidays, programs. Seed scripts
(`scripts/pilot-greenlight/seed-pilot-calendar.ts`, `seed-pilot-terms.ts`).
Archetype defaults (PABSON/GENERIC).

**Missing.** No student roster, no teacher/parent/student **user accounts**,
no sample grades/attendance/finance. Structure-only — you cannot currently
"experience" a populated tenant. (Confirmed: there is no live
`s1-demo-data-engine` implementation on `main`; only a branch name.)

**MVP for alpha.** Extend the fixture with a deterministic roster (≈N students
across grades, a handful of teachers, parents linked to students) + a
one-command seeder that, given a fresh tenant, populates users-in-every-role,
enrollments, a term of attendance, one exam with results, and a fee
structure + invoices. This **doubles as the RBAC conformance fixture**
(Sprint 3 needs a user in every role to assert against).

**What could go wrong.** Seeders that aren't idempotent corrupt a tenant on
re-run (the existing calendar seeder already deletes-then-recreates — note the
in-flight-consistency caveat); demo PII that looks real but isn't must be
unmistakably synthetic to avoid contaminating analytics/IEMIS exports.

### 3.5 Self-serve onboarding + OAuth  — *DEFERRED (was #1)*

**Built.** Admin-only tenant creation via AdminWeb → `POST /tenants` (SBT
ControlPlane) → CodeBuild `provision-tenant.sh` → `tenant-seeder-lambda`
(METADATA + SETTINGS#WORKSPACE). Cognito invite email. The form's
`useFederation` flag is **per-tenant user IdP linking**, *not* self-signup.

**Missing.** Any public signup endpoint; GitHub/Google OAuth; trial logic;
provisioning status polling; auto-rollback on partial failure.

**Why deferred.** For an alpha with a small, hand-picked cohort, the operator
can provision tenants manually (the path works today). Self-serve is a
growth-funnel feature, not a correctness/safety requirement, and it *expands*
the attack surface RBAC must defend — better to prove RBAC on a known cohort
first. See §9 for the re-pickup trigger.

### 3.6 Stripe / SaaS billing  — *DEFERRED (was #2)*

**Built.** Nothing for **SaaS** billing. The finance microservice
(eSewa/Khalti adapters, invoices, payments, fee structures, recurring billing,
ledger) is **school-internal** finance (a school billing its own students),
not the platform billing tenants.

**Missing.** All of: Stripe integration, subscription/trial lifecycle, a
tenant billing portal, usage metering→invoice, SaaS payment webhooks.

**Why deferred.** Alpha can be free or hand-invoiced. Building SaaS billing
now is net-new product surface (explicitly out of "no new features") and gated
on pricing decisions that don't exist yet. See §9.

---

## 4. Already done — do **not** rebuild

To keep the sprints honest (hardening, not reinvention):

- The guard/decorator stack, `PERMISSION_REGISTRY`, `DEFAULT_ROLE_PERMISSIONS`,
  `checkPermission()` deny-wins evaluation, seniority escalation prevention,
  `DataScopeService`, IAM tenant-tag isolation — **exist and largely work**.
- Academics already has real authz tests (`permission.guard.spec.ts`,
  `permission-matrix.spec.ts`) — Sprint 3 *extends* these, not rewrites.
- Identity has `iemis-permission.guard.spec.ts`, `roles.service.spec.ts`,
  `roles.cross-tenant.spec.ts`, and
  `server/application/test/e2e/security.e2e.spec.ts` doing tenant-isolation —
  Sprint 2 fills the *gaps* in these, not duplicates them.
- The SES reliable-email infra (just landed, PRs #291–#305) is the transport
  for Sprint 5 engagement email — **reuse it**, don't add a second sender.
- The BS↔AD converter, archetype defaults, pilot-fixtures loader — reuse.

---

## 5. Cross-sprint conventions

- **Branch:** `claude/eloquent-galileo-t2drc4` (backend). Frontend tickets land
  in `edforge-saas-frontend` on its own branch.
- **Every ticket is atomic + independently committable** and carries an
  explicit **validation** column (a test, or — where a unit test is the wrong
  tool — a named script / CI gate / manual smoke with a recorded artifact).
- **Local gates before any push** (per CLAUDE.md): `nest build <svc>`,
  `npm run typecheck:cdk` (infra), `npm run lint`, `npx jest <spec>`,
  `npm run lint:routes` for any new route.
- **Three-way route registration** (controller + `tenant-api-prod.json` +
  nginx for new prefixes) applies to every new endpoint (Sprints 4 & 6).
- **Cross-service DDB reads need an IAM grant** in the caller's task role and
  must show in the `tenant-template-stack-basic` diff (an *empty* diff is the
  red flag — the GB2-degraded-deploy failure mode). Live wherever a script or
  service reads a table it doesn't own: the seeding helper (`AUD.4b`/`SEED.2`)
  and the offboarding cleanup/export (`OFF.3`/`OFF.4`), not only Sprints 4–6.
- **Every deny-path test also asserts the audit trail.** Any test exercising a
  `403`/deny must additionally assert the structured `logPermissionDenied` (or
  role-change) audit event fires with `{tenantId, userId, resource, action,
  schoolId}` — the trail is only useful if it's pinned by tests.
- **No `isActive` in operator-facing response DTOs** (P1d).
- **Deploy via `scripts/deploy-analytics.sh`**, never `npx cdk deploy`.
- **Definition of done per sprint:** all tickets merged, the sprint's
  validation suite green in CI, and a **demo script** (a runnable
  `scripts/smoke-tests/…` or `jest` invocation) checked in that a reviewer can
  execute to see the sprint's outcome.

---

## 6. The RBAC spine — Sprints 0–3

### Sprint 0 — Authorization Audit & Correctness Foundation

**Goal / demo.** A machine-generated authz coverage report for every HTTP
endpoint across all three services, committed and enforced as a CI gate; the
cross-tenant `500→403` bug fixed with a regression test; a reusable
multi-role test-user fixture the rest of the spine asserts against.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **AUD.1a** | edforge | `scripts/audit/authz-route-parser.ts`: statically walk all `*.controller.ts` and emit structured records of every route (method + path) with detected guards (`JwtAuthGuard`/`PermissionGuard`/`GlobalRoleGuard`/`IemisPermissionGuard`/`InternalApiKeyGuard`) + `@RequirePermission`/`@RequireGlobalRole` metadata. | Unit test: parser run against a fixture controller returns the expected route+guard records. |
| **AUD.1b** | edforge | Report emitter on top of AUD.1a → commit `docs/alpha-launch/authz-coverage.generated.md` for the current tree. | Generated file committed; emitter has a snapshot test. |
| **AUD.2** | edforge | Classify each route as `protected` / `public-intentional` (allowlist: `auth/login`, `auth/health`, gateway callbacks, internal-API-key routes) / **`UNGUARDED-REVIEW`**. Add `npm run lint:authz` that **fails** if any route is `UNGUARDED-REVIEW` and not in `scripts/audit/authz-allowlist.txt`. | CI gate fails on a deliberately-unguarded test route; passes on current tree once allowlist is seeded. |
| **AUD.3** | edforge | Fix cross-tenant `500→403`: in `DynamoDBClientService` (identity) catch AWS `AccessDeniedException` on `getItem`/`query`/`putItem`/`updateItem`/`deleteItem`/`batchWrite` and rethrow `ForbiddenException` with `errorCode: 'CROSS_TENANT_FORBIDDEN'` + requested-vs-session tenantId. **Only `AccessDeniedException` is remapped; all other errors pass through unchanged.** | Unit test per wrapped method (mock SDK throws AccessDenied → 403 + errorCode; mock throws a different error → unchanged 500). |
| **AUD.4a** | edforge | `scripts/test-fixtures/role-users.ts`: idempotent helper that, given tenant + school, writes one `RoleAssignment` per `SchoolRole` (+ a multi-role Principal+Teacher user, + a second-tenant user). | Jest integration test: seed → one user per role with expected `roles[]`; re-run → no duplication. |
| **AUD.4b** | edforge | Extend the fixture with parent→student linkage + minimal student rows so `getLinkedStudentIds` / `enforceStudentOwnership` resolve (**gates `FIN.3`'s Parent-sees-own-child path**). | Jest test: a parent resolves to exactly their child's studentIds; an unrelated student is not linked. |
| **AUD.5** | edforge | E2E regression for AUD.3 in `server/application/test/e2e/security.e2e.spec.ts`: tenant A JWT requests tenant B settings → assert `403` + `CROSS_TENANT_FORBIDDEN` (today it 500s). | The new e2e case is red before AUD.3, green after. |
| **AUD.6** | edforge | `JwtAuthGuard` front-door spec (`server/application/libs/auth/src/jwt-auth.guard.ts`): expired token → 401, malformed → 401, absent → 401, `isPublic` route → allowed, valid token → request context populated. | New jest spec green. |

### Sprint 1 — Finance ABAC Hardening & Tests

**Goal / demo.** A finance authz conformance suite proving every finance
endpoint enforces the right `billing` permission and the right data scope for
Parent/Student, plus the payment-callback endpoint's post-hoc ownership check.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **FIN.1** | edforge | Add `finance/src/common/guards/permission.guard.spec.ts` mirroring the academics guard spec (no-decorator allow, no-user 403, TenantAdmin bypass, schoolId extraction order, allow/deny passthrough from `identityClient`). | New jest spec green; covers the finance guard. |
| **FIN.2** | edforge | Add `finance/src/common/guards/permission-matrix.spec.ts`: enumerate the **full** `SchoolRole` union (all 9, read from `base.entity.ts`) × {invoices, payments, fee-structures, refunds, student-accounts} × {view, create, edit}, asserting against `DEFAULT_ROLE_PERMISSIONS` — **every** role gets an explicit allow **or deny**, not a hand-picked subset. | New jest spec green; matrix iterates the whole enum. |
| **FIN.3** | edforge | Data-scope tests (**depends on `AUD.4b`**): Parent sees only their child's invoices, Student only their own (`invoices.controller.ts:54-74`), Parent/Student **blocked** from manual payment recording (`payments.controller.ts:43-49`). Each deny also asserts the audit log fires (§5). | Jest spec with seeded parent/student/teacher (AUD.4b fixture). |
| **FIN.4** | edforge | Harden + document `GET /finance/payments/verify/:sessionId` (no JWT; gateway callback): assert the in-handler `enforceStudentOwnership` denies a mismatched session; header comment marking it an intentional public callback + add to the AUD.2 allowlist. | Jest spec: mismatched owner → denied; AUD.2 gate passes with documented allowlist entry. |
| **FIN.5** | edforge | Cross-tenant finance denial e2e in `server/application/test/e2e/security.e2e.spec.ts`: tenant A user requests tenant B `…/schools/:id/invoices` → `403`/`404` (no info leak). | New e2e case green. |
| **FIN.6** | edforge | `InternalApiKeyGuard` spec + **rotation**: (a) missing header → 401, (b) wrong key → 401, (c) unconfigured env → 401, (d) correct key → pass; add a **dual-key rotation window** — accept `INTERNAL_API_KEY` and `INTERNAL_API_KEY_PREVIOUS` (`…/finance/src/common/guards/internal-api-key.guard.ts`). Confirm internal routes are allowlisted as *internal* (not public) in AUD.2. | New jest spec green incl. both keys accepted, neither-matches → 401. |

### Sprint 2 — People / Identity ABAC Hardening & Tests

**Goal / demo.** The user/role administration surface proven: escalation
prevention, multi-role permission union, deny-wins overrides, and the
previously-unsampled identity read endpoints either guarded or
allowlisted.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **PPL.1** | edforge | Extend `roles.service.spec.ts` with `checkPermission()` cases: deny-wins override (override `deny` beats default `allow`), and a non-overridden allow passes. | Jest cases green. |
| **PPL.2** | edforge | Multi-role union test: user with `roles: ['Teacher','Accountant']` gets union (can both edit grades and view billing); primary-role = highest seniority resolves correctly (`role-assignment.entity.ts:119-122,593-597`). | Jest spec green using the AUD.4a multi-role user. |
| **PPL.3** | edforge | Escalation-prevention tests: a Principal (sen. 100) cannot assign TenantAdmin; a Teacher cannot assign Principal; equal-seniority assignment blocked (`roles.service.ts:84-92`). | Jest spec green. |
| **PPL.4** | edforge | Branding + PDF-template authz tests: `PATCH /branding` and template mutations require `branding:configure`; confirm `GET /branding` is intentionally open + allowlist it (AUD.2). | Jest spec green; allowlist entry. |
| **PPL.5** | edforge | Close the identity read-endpoint audit from AUD.1: for every identity route still `UNGUARDED-REVIEW`, either add the correct guard or justify+allowlist with a one-line reason. | `npm run lint:authz` passes with zero un-allowlisted `UNGUARDED-REVIEW`. |
| **PPL.6** | edforge | `verifyDynamoRole` (recently-demoted-admin) path test: a user demoted in DDB but holding a stale JWT claim is denied when the guard re-verifies (`permission.guard.ts:53-63`). | Jest spec green. |

### Sprint 3 — Academics Data-Scope + Cross-Service ABAC Conformance E2E

**Goal / demo.** A conformance suite in two forms: a **CI merge gate**
(`CONF.1`, mocked identity, iterates the full role enum) and a **live smoke**
(`CONF.2`, against a seeded tenant from `AUD.4a/4b`) — together the regression
net that guards the alpha.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **SCOPE.1** | edforge | Data-scope cache-invalidation test: resolve a teacher's section scope (cached; TTL const ~`data-scope.service.ts:61`), change their assignment, assert the invalidation method (~`data-scope.service.ts:425`) clears it and stale scope is not served. | Jest spec green. |
| **SCOPE.2** | edforge | Co-teacher negative test: a co-teacher of homeroom X cannot read/write homeroom Y's roster; primary + co-teacher of X both *can* read X (`contains(coTeacherIds, …)` predicate ~`data-scope.service.ts:209`). | Jest spec green. |
| **SCOPE.3** | edforge | Cross-school denial within a tenant: a Teacher at school A is denied grades/attendance at school B. Deny also asserts the audit log (§5). | Jest spec green. |
| **SCOPE.4** | edforge | **Fail-closed pin**: today the academics/finance `PermissionGuard` does *not* wrap `identityClient.checkPermission()` in try/catch (`permission.guard.ts:135`), so a throw denies via propagated error (fail-closed *by accident*). Assert (a) identity throws → request denied (not 200), and (b) a regression guard that any future `catch` must re-throw/deny, never return `allow`. | Jest spec: mock client throws → expect denied; review note on the guard. |
| **CONF.1** | edforge | Wire `abac-conformance` (unit-mode, **mocked identity**) into CI as `npm run test:abac`: programmatically iterate the full `SchoolRole` + `GlobalRole` union against a representative endpoint per service, asserting expected allow/deny for **every** role. This is the merge gate. | CI job green; a deliberately-broken permission flips it red. |
| **CONF.2** | edforge | `scripts/smoke-tests/abac-conformance.ts`: the same matrix run **live** against a seeded non-prod tenant (AUD.4a/4b + SEED.* data), emitting a machine-readable pass/fail summary. | Manual smoke against a seeded tenant; recorded artifact attached to the sprint demo. |

---

## 7. The launch-support sprints — 4–6 (post-RBAC)

### Sprint 4 — Tenant Offboarding Completion

**Goal / demo.** Deprovision a non-prod tenant and show **zero** orphans
(rows, Cognito pool, SNS topic) plus a downloadable data export.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **OFF.1** | edforge | Extend `deprovision-tenant.sh` to delete the per-tenant Cognito user pool (look up pool id from METADATA) before row deletion; guard BASIC-only. | `scripts/cleanup-orphans/verify-sbt-state.ts` extended to assert pool gone; manual non-prod run artifact. |
| **OFF.2** | edforge | Delete the per-tenant SNS alert topic in deprovision (reuse `sweep-tenant-sns.ts` logic inline). | Post-run scan: no topic for tenantId. |
| **OFF.3** | edforge | Post-deprovision orphan-scan that **fails loudly** (non-zero exit + operator SNS) if any identity/academics/finance/analytics row, pool, topic, or S3 prefix for the tenantId remains. The scan reads every service table, so the scanner role needs cross-table grants. | Intentionally skip OFF.1 → scan fails; with OFF.1 → passes. **`cdk diff tenant-template-stack-basic` must show the scanner role's cross-table grant — an empty diff means the grant is missing.** |
| **OFF.4** | edforge | Tenant **data export** as an **operator-run script** (not an HTTP endpoint — avoids new route surface): dump all tenant rows per table to JSON in an S3 export prefix (BASIC). Runs **before** the OFF.1 delete as a safety snapshot. | Run against a seeded tenant; assert export object count == live row count. **`cdk diff` shows the export role's cross-table read grant (empty diff = missing grant).** |
| **OFF.5** | edforge | Emit a structured `tenant.deprovisioned` audit event (mirror tenant-update audit) with counts deleted. | Unit test asserts the emitter is **called with** the expected `{tenantId, counts}` payload (spy), not merely that a log line appears. |

### Sprint 5 — Usage Monitoring & Engagement

**Goal / demo.** A daily operator digest classifying every tenant
active/idle/dormant from existing analytics, and a dry-runnable dormant
re-engagement email.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **MON.1** | edforge | Add a `tenant-activity` rollup in the analytics aggregator: per-tenant `lastActivityAt` + 7/30-day active-user counts from existing events. | Unit test on the aggregator transform against sample events. |
| **MON.2** | edforge | Classifier `active | idle (no activity 7d) | dormant (30d)` exposed via the analytics API (read-only, operator-scoped). New route ⇒ register all three: controller + `tenant-api-prod.json` + nginx (if a new prefix). | Unit test on thresholds; `npm run lint:routes` green; API returns classification for seeded data. |
| **MON.3** | edforge | Scheduled operator **digest email** (via existing SES infra) listing dormant/at-risk tenants. | Snapshot test asserts the rendered digest body contains a seeded dormant tenant (not merely "renders to stdout"). |
| **MON.4** | edforge | Templated **dormant re-engagement** email, **honoring SES suppression**, rate-limited, `--dry-run` default. | Test: dry-run sends nothing; suppression list respected; rate cap enforced. |
| **MON.5** | edforge | CloudWatch alarm on "0 active tenants in 24h" (fleet-health canary) → operator SNS. | `cdk diff analytics-stack` shows the alarm; synth green. |

### Sprint 6 — Demo-Data Depth

**Goal / demo.** One command turns a fresh tenant into a populated school —
users in every role, enrollments, a term of attendance, an exam with results,
fees + invoices. The role-user *fixture* is delivered early as `AUD.4a` (so
Sprint 3 isn't blocked on Sprint 6); `SEED.2` here extends it into a full
demo-grade population.

#### Tickets

| Ticket | Repo | Scope | Validation |
|---|---|---|---|
| **SEED.1** | edforge | Extend `pabson-saraswati-bs-2083` fixture with a deterministic **student roster** (synthetic, clearly-fake names) across grades + a `roster.schema.json`. | Loader schema-validates the fixture; count assertions. |
| **SEED.2** | edforge | Fixture **users**: extends the early-delivered `AUD.4a` `role-users` helper into a full population — teachers, parents (linked to students per `AUD.4b`), a principal, an accountant — across the roster. Cross-service writes ⇒ confirm the seeder role's grants appear in `cdk diff`. | Idempotent seed test: one user per role created + linked; re-run → no duplication. |
| **SEED.3** | edforge | Seeder for **enrollments + one term of attendance** for the roster (idempotent; no delete-then-recreate footgun). | Re-run twice → identical state (assert no duplication). |
| **SEED.4** | edforge | Seeder for **one exam with results** + a **fee structure with invoices** so grades and finance screens are non-empty. | Seed → `GET grades/overview` and `GET invoices` return populated sets. |
| **SEED.5** | edforge | `scripts/demo/seed-demo-tenant.sh <tenantId>` orchestrating SEED.1–4 end-to-end with a final verification summary. | One-command run against a fresh non-prod tenant; summary asserts all populated. |

---

## 8. Cross-sprint risks & mitigations

| Risk | Sprint | Mitigation |
|---|---|---|
| Guard fails *open* on identity outage (academics/finance HTTP-mediated) | 1,3 | `SCOPE.4` explicitly asserts fail-closed; make it a merge gate (`CONF.2`). |
| Authz audit misses dynamically-registered routes | 0 | `AUD.1` parses controllers statically *and* `CONF.1` exercises live routes — two independent views; discrepancies are bugs. |
| `500→403` change masks a *real* 500 elsewhere | 0 | Only `AccessDeniedException` is remapped; all other errors pass through unchanged; unit test pins the discriminator. |
| Engagement email harms transactional SES reputation | 5 | Honor suppression, rate-limit, `--dry-run` default, reuse the existing config-set + bounce/complaint alarms. |
| Deprovision deletes the wrong tenant's data | 4 | BASIC-tier guard + tenantId echo confirmation + orphan-scan that also detects *over*-deletion isn't possible, so `OFF.4` export runs **before** delete as a safety snapshot. |
| Seeders corrupt a tenant on re-run | 6 | Idempotency is a per-ticket validation requirement (`SEED.3` re-run assertion). |
| Frontend (Finance/People MFE) work can't be verified from this repo | 1,2 | Backend tickets are the enforceable contract; FE tickets are specified but tracked in `edforge-saas-frontend`; the backend conformance E2E is the source of truth for "does authz work." |
| Shared internal API key can't be rotated without downtime | 1 | `FIN.6` adds a dual-key rotation window (`INTERNAL_API_KEY` + `_PREVIOUS`) so the secret can roll without a request flap. |

---

## 9. Explicitly deferred (out of alpha scope)

These are removed from the alpha critical path by the 2026-06-20
re-prioritization. Documented here so the decision is auditable and the
re-pickup trigger is explicit.

| Deferred item | Was | Why deferred | Re-pickup trigger |
|---|---|---|---|
| Self-serve public sign-up + GitHub/Google OAuth | #1 | Operator can hand-provision an alpha cohort; expands the attack surface RBAC must first prove; net-new surface vs "no new features." | When RBAC conformance (Sprint 3) is green **and** the alpha cohort outgrows manual provisioning. |
| Public sandbox / demo-on-signup | #1 | Depends on self-serve + demo-data depth (Sprint 6); not needed for a hand-picked alpha. | After Sprint 6 + self-serve. |
| Stripe SaaS billing / subscriptions / trials | #2 | Alpha is free/hand-invoiced; gated on pricing decisions that don't exist; net-new surface. | When pricing is decided and alpha converts to paid. |

**Note on terminology:** the existing finance microservice (eSewa/Khalti,
invoices, fee structures) is **school-internal** billing and stays in scope as
normal product — it is *not* the deferred SaaS-billing item.

---

## 10. Open questions for the operator

1. **Alpha cohort size** — confirms manual provisioning is acceptable (drives
   the §9 self-serve trigger).
2. **Data-export format** for OFF.4 — raw per-table JSON (engineering-cheap) vs
   Ed-Fi-shaped (portable, more work)? Default assumed: raw JSON for alpha.
3. **Engagement-email policy** — is *any* automated marketing-style email
   acceptable during alpha, or operator-digest-only (MON.3) with no
   tenant-facing sends (MON.4 stays dry-run)? Default assumed: digest-only.
4. **Dormancy thresholds** (MON.2) — 7d idle / 30d dormant assumed; confirm.
5. **Frontend sequencing** — should the Finance/People MFE authz UI tickets run
   in lockstep with their backend sprints, or land after the backend
   conformance suite is green? Default assumed: backend-first, FE follows.

---

## 11. Review changelog

This plan was revised after an independent subagent review against the original
brief + the RBAC-first constraint. Changes incorporated:

- **Closed four RBAC-spine coverage gaps on the owner's checklist:**
  `InternalApiKeyGuard` tests + dual-key rotation (`FIN.6`); audit-log emission
  assertions on every deny path (§5 convention + `FIN.3`/`SCOPE.3`); JWT-expiry
  / malformed / absent-token tests (`AUD.6`); full-`SchoolRole`-enum negative
  coverage rather than a hand-picked subset (`FIN.2`, `CONF.1`).
- **Split oversized tickets:** `AUD.1` → `AUD.1a` (parser) + `AUD.1b` (report
  emitter); `AUD.4` → `AUD.4a` (role users) + `AUD.4b` (parent/student linkage
  that `FIN.3` depends on).
- **Wired the cross-service IAM-grant diff check** into the tickets where it
  bites (`OFF.3`, `OFF.4`, `SEED.2`) — an empty `tenant-template-stack-basic`
  diff is the failure signal.
- **Three-way route registration** added to validation for any ticket adding
  HTTP surface (`MON.2`); `OFF.4` deliberately made an operator script, not an
  endpoint, to avoid the route surface entirely.
- **Tightened soft validations:** `CONF.1` (CI-gateable, mocked) reordered
  ahead of `CONF.2` (live smoke); `OFF.5` and `MON.3` now assert via spy /
  snapshot rather than log inspection; `SCOPE.4` reworded to *pin* the
  accidental-fail-closed behavior (the guard has no explicit try/catch today).
- **Fixed stale references:** `security.e2e.spec.ts` path
  (`server/application/test/e2e/`), the `data-scope.service.ts` line numbers
  (cache invalidation ~425, co-teacher predicate ~209), dropped an inaccurate
  spec line-count.
- **Resolved the apparent Sprint 3 ↔ 6 circular dependency** by making `AUD.4a`
  the early-delivered fixture Sprint 3 consumes.

The review confirmed the plan's central factual claims (Finance has zero authz
tests; cross-tenant returns 500 not 403; the authz engine exists and works; one
structure-only pilot fixture) against the code.

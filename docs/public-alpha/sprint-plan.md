# EdForge — Public Alpha Launch: Sprint Plan

> **Status:** v2 (generated 2026-06-12 from a six-area codebase audit of both
> repos, then revised after an adversarial review pass that spot-checked every
> "already built" claim against source). Scope is the public-alpha critical path
> only — onboarding, demo, offboarding, monitoring, ABAC. **No new product
> features.**
>
> **Trigger.** Public alpha launch prep. The goal: take EdForge from
> "admin-provisioned, pilot-validated (Saraswati/PABSON)" to "a stranger can
> sign in with OAuth, experience the full product in a seeded sandbox, spin up
> their own free workspace, use it, and cleanly leave."
>
> **Companion docs.** Architecture: [ARCHITECTURE.md](../../ARCHITECTURE.md).
> Conventions + edit traps: [CLAUDE.md](../../CLAUDE.md). Dev-tenant lifecycle
> groundwork this plan productizes:
> [docs/dev-tenant-system/SPRINT-PLAN.md](../dev-tenant-system/SPRINT-PLAN.md).
> Hardening-plan format this mirrors:
> [docs/platform-hardening/sprint-plan.md](../platform-hardening/sprint-plan.md).

---

## Locked launch decisions

Operator-confirmed 2026-06-12. Everything below assumes them; changing one
re-opens the sprints it touches.

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| D1 | Onboarding model | **Instant shared demo sandbox + "Start free" → real tenant** | Demo seeding (S1) is a hard dependency of onboarding (S5). Sandbox decouples instant gratification from minutes-long CodeBuild provisioning. |
| D2 | Payments | **No billing for alpha** | Stripe / `IBilling` / pricing / checkout / recurring billing **out of scope** (parked epic). Tenant `trial*`/`subscription*` fields stay dormant. The **entitlement/suspend seam** (S6) is still built — offboarding needs it, and it is the future billing seam. |
| D3 | Offboarding | **Self-serve cancel → suspend + async full export + operator hard-delete** | No self-serve GDPR hard-delete and no C0.e residency/consent gate (both need legal). |
| D4 | Demo richness | **Two fully-populated K-12 schools — one PABSON (Nepal), one GENERIC (US) — 200 students each** | "As much seeding effort as needed; most complete hands-on demo." Drives the size of S1. |
| D5 | Sandbox persona model | **Land as `Principal`; persona switcher (Teacher/Accountant/Parent/Student/TenantAdmin) backed by real scoped JWTs; NO visitor login; demo tenant is hard read-only; nightly reset** | Faithful full-product experience that also validates ABAC (area #6). See below. |

### D5 detail (revised after review)

- **No visitor login for the sandbox.** The public lands in the demo with **no
  authentication step**. Persona tokens are **minted server-side** by a public,
  WAF-rate-limited, demo-tenant-only endpoint (S3.4). This removes the hard
  dependency on OAuth (S4) for the sandbox to work, and means the federated
  claim-injection work (S4.3a) is only needed for the *real-tenant* path (S5).
- **Land as `Principal`, not TenantAdmin.** `permission.guard.ts:50` confirms
  `TenantAdmin` bypasses *all* permission checks — landing as TenantAdmin would
  hide the permission model the demo is meant to showcase.
- **The shared demo tenant is hard read-only** (decided here, not deferred into
  a ticket — it's a public-data-poisoning / abuse surface). Persona tokens carry
  real role scope but writes are blocked at the entitlement guard
  (`TENANT_DEMO_READONLY`). Per-session ephemeral write overlays are out of
  scope for alpha.
- **Fallback** (only if the real-JWT switch over-runs): front-end-only "view as"
  that swaps ABAC context without a real token. Less faithful; does not validate
  backend enforcement. Documented, not preferred.

---

## Already built — DO NOT re-build (verified against source)

Read this before writing any ticket. Several areas are "wire the last mile";
two were materially mis-scoped in v1 of this plan and are corrected here.

| Surface | Status | Cite |
|---|---|---|
| Tenant provisioning pipeline (SBT onboarding → CodeBuild → seeder) | **Shipped** | [control-plane-stack.ts](../../server/lib/bootstrap-template/control-plane-stack.ts), [provision-tenant.sh](../../server/lib/provision-scripts/provision-tenant.sh), [tenant-seeder-lambda.ts](../../server/lib/bootstrap-template/tenant-seeder-lambda.ts) |
| Cognito: one shared BASIC pool + per-tenant groups | **Shipped** | [identity-provider.ts](../../server/lib/tenant-template/identity-provider.ts) |
| JWT custom claims (`tenantId`,`userRole`,…) — **delivered via `UserPoolClient.readAttributes`, set at user-creation in `provision-tenant.sh`** | **Shipped** | [identity-provider.ts](../../server/lib/tenant-template/identity-provider.ts). ⚠️ The post-auth trigger ([cognito-post-auth-trigger.ts](../../server/lib/auth-events/cognito-post-auth-trigger.ts)) only emits a `LoginSuccess` analytics event — **it does NOT inject claims.** There is **no pre-sign-up / pre-token-generation trigger** today → federated users (S4) would arrive with **no `tenantId`/`userRole`**. |
| Frontend OAuth client (Amplify `signInWithRedirect`, code+PKCE) | **Shipped (unwired)** | `edforge-saas-frontend/packages/auth/src/service.ts`, `config.ts` — only the Cognito-side IdP is missing |
| `tenantTag` taxonomy (immutable, propagated) | **Shipped** | dev-tenant-system Sprints 0–3; seeder + field-governance |
| Post-login 7-step `OnboardingFlow` (school → AY → invite team) | **Shipped** | `apps/shell/src/components/onboarding/OnboardingFlow.tsx` — assumes tenant+admin already exist |
| `pilot-fixtures` engine: parametric per-archetype **calendar/AY/terms/exam-windows/bell/holidays** | **Shipped (calendar only)** | [packages/pilot-fixtures](../../packages/pilot-fixtures) — **no entity data** (schools/students/staff/courses/exams/fees) |
| Seed-on-empty archetype defaults (board exams, grading policy, promotion rules) | **Shipped** | [docs/archetype-framework/gb2-seeding-design.md](../archetype-framework/gb2-seeding-design.md) — defaults, not demo content |
| Analytics infra: write-event activity buckets, daily rollup emitting `TenantDormant`, `GET /analytics/fleet`, `scheduled-lambda` pattern, operator SNS | **Shipped** | [analytics-stack.ts](../../server/lib/analytics/analytics-stack.ts), `lambda/rollup/handler.ts`, `lambda/api/router.ts` (`/analytics/fleet` is on the **analytics-stack Lambda API**, not the tenant API GW), [scheduled-lambda.ts](../../server/lib/cdk-patterns/scheduled-lambda.ts) |
| **No email send path exists** (no SES / `nodemailer` / `sendEmail` anywhere). Only Cognito's built-in invite/verification emails. | **Greenfield** | grep-confirmed repo-wide |
| ABAC backend: 9 school roles + 2 global, `DEFAULT_ROLE_PERMISSIONS`, `PermissionGuard`, `@RequirePermission`. **Finance BE = 51 guards, academics = 119, identity = 9** (identity mixes `JwtAuthGuard`/`GlobalRoleGuard`/`IemisPermissionGuard`). `roles[]` + `permissionOverrides` are **LIVE** in the check path. | **Shipped (identity is the weak surface)** | [role-assignment.entity.ts](../../server/application/microservices/identity/src/common/entities/role-assignment.entity.ts), [permission.guard.ts](../../server/application/microservices/identity/src/common/guards/permission.guard.ts), `roles.service.ts:596` |
| ABAC frontend: abac engine/hooks shipped. **Finance MFE has ZERO `usePermission` gating; People MFE has no tests at all.** | **Shipped engine, FE gaps** | `edforge-saas-frontend/packages/abac`, `apps/finance` (no gating), `apps/people` (no tests) |
| Audit log: storage + emission **+ a school-scoped query endpoint `GET /schools/:schoolId/audit-log` + a frontend `AuditLogTab.tsx`** that queries it (with CSV export) | **Shipped (school-scoped); tenant-wide query missing** | [audit.entity.ts](../../server/application/microservices/identity/src/common/entities/audit.entity.ts), [audit-logger.service.ts](../../server/application/libs/logger/src/audit-logger.service.ts), `schools.controller.ts:118`, `apps/shell/.../tabs/AuditLogTab.tsx` |
| Deprovision flow + `DELETE` via SBT ControlPlane + `cleanup-orphans/` scripts | **Shipped (buggy + partial)** | [deprovision-tenant.sh](../../server/lib/provision-scripts/deprovision-tenant.sh), [scripts/cleanup-orphans](../../scripts/cleanup-orphans) |
| Per-entity CSV exports (invoices, payments, enrolments) + IEMIS snapshots | **Shipped** | finance/academics controllers |
| Dormant tenant fields (`tier`,`status`∈{…,`trial`,`suspended`}, `trial*`,`subscription*`) | **Shipped (dormant)** | [tenant.entity.ts](../../server/application/microservices/identity/src/common/entities/tenant.entity.ts) |

### Known-buggy / orphaned (fix in-place)

- `deprovision-tenant.sh` — bash word-split on JSON; "argument list too long"
  past ~400 items; skips analytics tables, per-tenant SNS, all S3 buckets
  (`RemovalPolicy.RETAIN`). → **S6.6 / S6.7**.
- `TenantDormant` EventBridge event is emitted by the rollup but **has no
  consumer**. → **S7.3**.
- `settings/danger.tsx` "Deactivate"/"Delete Account" buttons have **no
  handlers**. → **S6.3**.
- Cross-tenant denial surfaces as **500** (should be 403 `CROSS_TENANT_FORBIDDEN`).
  **Three duplicated, non-shared `dynamodb-client.service.ts` copies** (identity
  376 LOC / finance 317 / academics 788). → **S2.8a–c**.

---

## Out of scope for alpha (parked epics)

| Item | Why parked | Seam left in place |
|---|---|---|
| Full Stripe subscription billing | D2 | Dormant tenant `trial*/subscription*` fields + the S6 entitlement/suspend guard. |
| Self-serve GDPR hard-delete + C0.e data-residency/consent | D3; needs legal | S6 ships operator-executed delete + self-serve export + a minimal signup ToS/privacy gate (S5.5). |
| Dedicated audit **page** UI | not alpha-blocking | S2.9 generalizes the existing school-scoped query + repoints the existing `AuditLogTab`. |
| ADVANCED/PREMIUM tiers, per-tenant clusters/pools, multi-region | `V1_DEFERRED` | Scaffolding stays dormant. |

---

## Cross-sprint conventions

Mirrors [platform-hardening/sprint-plan.md](../platform-hardening/sprint-plan.md);
**no timeline estimates** (per request).

- **Every ticket = one commit + one PR.** If it reads like more than a day, split it.
- **Every ticket has a real, checkable `Validation`** — unit test, dynamodb-local
  integration, route-shape test, RTL/component test, or a named manual smoke
  with evidence in `docs/deploys/`. "Doc reviewed" is only acceptable for a
  design gate that *blocks* the sprint, and even then prefer a machine-checkable
  artifact (e.g., a spec JSON a test asserts against).
- **CLAUDE.md traps apply to every ticket:** three-way route registration
  (controller + [tenant-api-prod.json](../../server/lib/tenant-api-prod.json) +
  [nginx.template](../../server/application/reverseproxy/nginx.template)) — and a
  **NEW top-level URL prefix requires a new `location ~ ^/<prefix>` nginx
  block** (missing = silent `404 nginx/…`); cross-service DDB access needs an IAM
  grant (empty `tenant-template-stack-basic` diff is a false-clear);
  module-wiring invariant + `module-wiring.spec.ts`; shared-types `^0.x`
  caret-pin bump in the same PR; cross-stack export pre-flight; bare-UUID
  partition keys; workspace-only packages can't ship in Docker services.
- **Public keyless endpoints (`/signup`, `/demo/session`) are NOT covered by the
  API-GW UsagePlan** (that throttle is API-key-based). They need **AWS WAF
  per-IP rate rules** — call this out in their tickets.
- **Frontend tickets begin with a URL→router→page→tab→component trace** in the
  commit body + a `npm run dev:<app>` visual smoke (screenshot). File-name ≠
  rendered component.
- **Two-repo git hygiene:** `cd /home/user/edforge` (backend) or
  `cd /home/user/edforge-saas-frontend` (frontend) in *every* git invocation;
  confirm branch with `git branch --show-current` before each commit.
- **Archetype invariant (CI-enforced):** branch on `archetype === 'PABSON'`,
  never `country === 'NPL'`. Country-keyed *data* is fine.
- **Deploy ladder:** local gates → non-prod → human approval → prod. Never
  `npx cdk deploy` directly. AdminWeb changes require the jsdom bundle-sim before
  a `controlplane-stack` redeploy.
- **Destructive paths carry Saraswati + all demo tenant UUIDs as refuse-list
  constants, enforced at the lib layer (not just API/CLI)** — defense in depth
  per dev-tenant T5.11.

---

## Sprint sequence

```
S1  Demo data engine (fixtures + idempotent loader)            [enables S3, S5, S6 demo]
S2  ABAC verification & hardening + audit query API            [enables faithful S3 personas]
    └─ S2.8a–c (cross-tenant 403) is independent — can land first
S3  Shared demo sandbox + persona role-switcher (no login)     [builds on S1, S2]
S4  OAuth identity providers (Google, GitHub-shim) + email     [enables S5; NOT a dep of S3]
    └─ S4.3a federated→tenant-context trigger; S4.7 account-linking before S5.9
S5  Self-serve signup → sandbox → "Start free" real tenant     [builds on S1, S3, S4]
    └─ S5.0 plane/auth ADR gates all S5 backend tickets
S6  Offboarding: cancel + suspend + export + clean delete      [uses S2 guards; soft dep S1]
S7  Usage monitoring & engagement (SES greenfield)             [S7.0 SES approval is external-blocking]
```

S4 parallelizes with S1–S3 (the sandbox needs no login per D5). S6/S7 may run in
parallel once S2 lands. Each sprint is independently demoable and builds on prior.

---

## Sprint S1 — Demo data engine (fixtures + loader)

**Goal.** Extend `@edforge/pilot-fixtures` with full operational entity data for
both archetypes (PABSON-Nepal + GENERIC-US, K-12, 200 students each) and build an
idempotent loader that writes it into a provisioned tenant through the real
service APIs (respecting validation, ABAC, events).

**Demo.** `./scripts/demo-seed/seed-demo-tenant.sh <tenantId>` populates a fresh
tenant end-to-end; logging in shows a full school across all four MFEs — 200
students, ~15 staff, courses, sections, a graded exam cycle with result cards,
fees/invoices/payments.

**Dependencies.** None (existing service APIs + existing `pilot-fixtures` engine).

| # | Title | Validation |
|---|---|---|
| S1.1 | Author a **machine-checkable** `docs/public-alpha/demo-seed-spec.json` (+ prose `demo-seed-spec.md`): exact per-archetype counts/shape — 1 K-12 school each, school-local grade codes, sections/grade, ~15 staff covering **every** role in `DEFAULT_ROLE_PERMISSIONS`, 200 students w/ age↔grade distribution + enrolments, courses/grade, one full exam cycle (weighted components) + result cards, fee structures + invoices + payments (paid/partial/unpaid mix). | A schema test parses the JSON; later loader/fixture tests assert output **against** this spec (not free-form snapshots). Every ABAC role present. |
| S1.2 | Deterministic synthetic-identity generator in `pilot-fixtures` — locale name pools (Nepali/US), seeded RNG, plausible DOB↔grade. **Banned-content guard:** output diffed against a banned-substrings list (no real student names, real emails/phones). | Unit test: same seed → identical roster; correct locale pool; no intra-school dup; banned-list scan passes. |
| S1.3 | Fixture schema + JSON for **schools** (PABSON Nepali K-12; GENERIC US K-12). Demo `emisSchoolCode` drawn from a **reserved synthetic range** that can never collide with a real IEMIS school. | Zod parse; `loadPilotFixture` returns school bundle; test asserts emisSchoolCode ∈ reserved range; conforms to S1.1 spec. |
| S1.4 | Fixtures: **grade levels + sections** (K-12 → school-local codes; sections/grade per spec). | Conformance test vs spec; grade codes resolve via existing descriptor aliases. |
| S1.5 | Fixtures: **staff/users + role assignments** (~15/school across the role set). | Union of staff roles across both schools == full role set (asserted). |
| S1.6 | Fixtures: **students + enrolments** (200/school across K-12). | Count == 200; each in exactly one section; age↔grade consistent. |
| S1.7 | Fixtures: **courses** + section→course + teacher→course assignments. | Every section has full course set; every course has a teacher. |
| S1.8 | Fixtures: **one full exam cycle** (weighted components) + **marks** + **result cards**. | Result-card GPA computes via existing `gpa-calculator`; mark distribution non-degenerate. |
| S1.9 | Fixtures: **finance** — fee structures/grade + invoices + sample payments. | Invoice currency == tenant workspace currency (NPR/USD); ledger reconciles. |
| S1.10 | Loader lib `scripts/demo-seed/lib/seeder.ts`: ordered, idempotent (skip-by-key), tenant-JWT POSTs in dependency order; every row tagged `demoSeed:true`. | Integration vs throwaway tenant: full seed succeeds; second run no-ops; per-entity failures surfaced (not swallowed). |
| S1.11 | Loader CLI `seed-demo-tenant.sh <tenantId> [--archetype]`: creds → JWT → seed → tee log. | Manual run on `dev-pabson-primary` + `dev-generic-01`; post-scan == spec counts; log captured. |
| S1.12 | Loader `--reset`: delete only `demoSeed:true` rows (batched). | seed→reset→re-seed yields identical counts; a hand-planted non-demo row **survives** (asserted). |
| S1.13 | Confirm + document the workspace-only constraint: loader runs as CLI/Lambda (esbuild bundles `pilot-fixtures`), never imported by a Docker ECS service. | Commit note; grep proves no service imports `@edforge/pilot-fixtures`. |

**Closeout.** Seed one PABSON + one GENERIC throwaway tenant; screenshots of
populated MFEs → `docs/deploys/S1-demo-seed-<sha>.md`.

---

## Sprint S2 — ABAC verification & hardening + audit query API

**Goal.** Prove ABAC end-to-end for all 9 roles across all four MFEs — closing
the real gaps (**finance FE** has no gating; **People MFE** has no tests;
**identity BE** is the least-guarded service) — guard FE↔BE parity, fix the
cross-tenant 500, and make the audit trail queryable tenant-wide.

**Demo.** A per-role permission matrix suite passes (backend integration + FE
component); a seeded user's role-switch flips visible UI *and* backend authz;
`GET /audit` returns a tenant-wide trail with correct field diffs.

**Dependencies.** S1 (seeded per-role users; mocks acceptable where seeding lags).
S2.8a–c are independent and may land first.

| # | Title | Validation |
|---|---|---|
| S2.1 | Finance **backend** integration tests with the real `PermissionGuard` (verifying the existing 51 guards, not adding them): Accountant ✓ billing CRUD; Teacher/Parent → 403; Principal per matrix. | Jest integration: 200 vs 403 per role per route. |
| S2.2 | Academics **backend** integration tests per-role (attendance/grades/exams; verifying existing 119 guards). | Jest integration per role. |
| S2.2a | **Identity/People backend** integration tests (users/roles/schools/credentials) — the least-guarded service: TenantAdmin vs Principal vs Teacher; cover `GlobalRoleGuard` + `IemisPermissionGuard` routes too. | Jest integration; each guard type exercised. |
| S2.3 | Route-protection drift test: assert every controller route is covered by **one of** `@RequirePermission` ∨ `GlobalRoleGuard` ∨ `IemisPermissionGuard` ∨ an explicit public allowlist. | Test red on a deliberately-unguarded new route; green on current tree (no false-positive on `GlobalRoleGuard` routes). |
| S2.4 | Canonical permission matrix as single-source shared data; backend `DEFAULT_ROLE_PERMISSIONS` + frontend `ROLE_PERMISSIONS` verify against it. | Parity test fails on hand-introduced drift; both reconcile to canonical. |
| S2.5 | **People MFE**: create `apps/people/src/__tests__/` (none today) + ABAC gating tests — staff create/edit/delete gated; Principal sees actions, Teacher does not. | RTL tests; URL→component render-path trace in commit. |
| S2.6 | **Finance MFE**: add the missing `usePermission` gating (the MFE has zero today) + tests — invoice/fee actions gated by role; permission-denied UX renders. (Backend is already gated — do **not** touch BE guards here.) | RTL tests + `dev:finance` visual smoke; render-path trace. |
| S2.7 | **Characterize + test** existing multi-role (`roles[]`) + `permissionOverrides` semantics (LIVE in `roles.service.ts:596`); document behavior; close any gaps found. **Do NOT delete this scaffolding — it is in the live check path.** | Unit tests: multi-role union resolves; an allow/deny override is honored; documented in commit. |
| S2.8a | Wrap `AccessDeniedException`→`ForbiddenException` (`CROSS_TENANT_FORBIDDEN`) in **identity** `dynamodb-client.service.ts` (+ sibling callsites). | Integration: JWT(tenant A) → tenant B read = **403** + errorCode (was 500). |
| S2.8b | Same fix in **finance** `dynamodb-client.service.ts` (separate 317-LOC copy). | Integration per service. |
| S2.8c | Same fix in **academics** `dynamodb-client.service.ts` (separate 788-LOC copy). | Integration per service. |
| S2.9 | **Generalize** the existing school-scoped `GET /schools/:schoolId/audit-log` into a tenant-wide filtered audit query (`GET /audit?entity=&actor=&from=&to=`), TenantAdmin-gated; repoint the existing `AuditLogTab.tsx` at it. NEW top-level `/audit` prefix → **new nginx block** + OpenAPI overlay + route-drift linter. | Route-shape test; returns rows for a seeded change; `lint:routes` clean; AuditLogTab renders tenant-wide. |
| S2.10 | Audit lifecycle integration test: role assignment → audit row written → retrievable via S2.9 with correct before/after diffs. | E2E jest. |

**Closeout.** Per-role matrix green; FE↔BE parity guard active; cross-tenant 403
across all 3 services; audit API smoke → `docs/deploys/S2-abac-audit-<sha>.md`.

---

## Sprint S3 — Shared demo sandbox + persona role-switcher (no login)

**Goal.** A persistent, fully-seeded, **hard-read-only** shared demo tenant per
archetype that any visitor explores with **no login**, switching personas via
server-minted real scoped JWTs (D5); self-healing via nightly reset.

**Demo.** Open the demo URL → land as **Principal** in a populated PABSON school
(no sign-in) → switch personas → each MFE reflects the persona's real
permissions. A "Start free — create your own workspace" CTA is always visible.

**Dependencies.** S1 (seed), S2 (verified ABAC). **Not** S4 (sandbox needs no auth).

| # | Title | Validation |
|---|---|---|
| S3.1 | Add a `demo` tenant classification (extend `tenantTag` or add immutable `isDemo` METADATA flag) through field-governance + seeder. | Unit test: demo marker present + immutable; PATCH rejected. |
| S3.2 | Provision persistent `demo-pabson` + `demo-generic`; seed via S1 loader. | Provision + seed logs; both populated. |
| S3.3 | Seed per-persona demo users (Principal/Teacher/Accountant/Parent/Student/TenantAdmin) in each demo group; creds in Secrets Manager. | Each persona resolvable; correct `userRole` + assignments. |
| S3.4 | Backend **demo-session endpoint** `POST /demo/session { persona }` — **public, no visitor login**, **AWS WAF per-IP rate-limited**, **demo-tenant-only**: mints a short-lived scoped token for the persona's seeded user. NEW `/demo` prefix → **new nginx block** + OpenAPI overlay. | E2E: valid persona → scoped token; invalid/non-demo → 4xx; **a minted token replayed against a non-demo tenant is rejected** (token-oracle guard). |
| S3.5 | Implement the **hard read-only** entitlement for demo tenants (`TENANT_DEMO_READONLY` on writes), per D5. | Integration: every write in a demo tenant blocked; reads succeed across all MFEs. |
| S3.6 | Nightly demo reset via `scheduled-lambda`: S1 `--reset` + re-seed. | Reset restores baseline counts; idempotent; **safe under a live in-flight visitor session** (no 5xx storm); alarm on failure. |
| S3.7 | Frontend persona switcher in shell (`Viewing as <persona> — switch`): calls S3.4, swaps token + ABAC context, refreshes MFEs. | RTL + `dev:shell` visual smoke; nav/actions change per persona; render-path trace. |
| S3.8 | Frontend demo banner + persistent "Start free" CTA. | Component test; CTA routes to signup/provision (S5). |
| S3.9 | Demo-content safety review: synthetic-only, no real PII, no live email subscriptions on demo personas, demo `emisSchoolCode` in reserved range. | Automated scan asserts banned-list + reserved-range + zero real SNS email subs for demo tenants. |

**Closeout.** Demo-URL walkthrough screenshots for every persona × MFE →
`docs/deploys/S3-sandbox-<sha>.md`. STOP: any persona can mutate demo data, or a
demo token works against a non-demo tenant → halt + fix S3.4/S3.5.

---

## Sprint S4 — OAuth identity providers + public sign-in

**Goal.** Wire Google + GitHub (via OIDC shim) + email/password into the shared
Cognito pool, and — the hard part — give **federated users a tenant context**,
since they arrive with no `tenantId`/`userRole`.

**Demo.** "Continue with Google"/"Continue with GitHub" complete a redirect
round-trip in non-prod and return an authenticated session whose JWT carries a
valid (sandbox) tenant context; email/password still works.

**Dependencies.** None hard. Enables S5. **S4.7 must precede S5.9** (stable
identity for the per-identity cap).

| # | Title | Validation |
|---|---|---|
| S4.1 | CDK: Cognito **hosted-UI domain** + **Google** IdP (`UserPoolIdentityProviderGoogle`); secrets via Secrets Manager (`secret-scan` gate). **Note the ACM cert dependency** if a branded custom hosted-UI domain is wanted. | `cdk synth`; scoped `cdk diff`; manual Google redirect round-trip in non-prod. |
| S4.2 | **GitHub OIDC shim** (first-class infra, not a footnote): GitHub is OAuth2-only (no `/.well-known/openid-configuration`, no `id_token`), so build a thin shim (Lambda/endpoint) presenting GitHub userinfo as OIDC claims, then register it as `UserPoolIdentityProviderOidc`. | Synth/diff; GitHub redirect round-trip yields a Cognito user in non-prod. |
| S4.3 | Attribute mapping: IdP `email`/`name` → Cognito standard attrs. | Federated login populates email/name; unit test on mapping. |
| S4.3a | **Pre-token-generation (or pre-sign-up) Lambda**: assign **sandbox** tenant context to a federated user who has no tenant; do NOT inject a real `tenantId` until Start-free (S5). This is the missing claim-injection path — net-new infra. | Federated login with no prior tenant → JWT scoped to sandbox; after Start-free, the same identity gets its real `tenantId`. Unit + integration test. |
| S4.4 | Cross-stack export pre-flight for any `controlplane`/Cognito output change (snapshot exports, list importers, confirm no value-change-with-importer). | `list-exports`/`list-imports` audit in commit; staged deploy if needed. |
| S4.5 | Frontend: wire existing `signInWithRedirect()` to Google/GitHub buttons + keep email/password. | RTL; `dev:shell` smoke vs non-prod hosted UI; render-path trace. |
| S4.6 | Callback/CORS allowlist (app + sandbox + localhost) in Cognito + `shared-infra` CORS; document the exact callback URLs (mismatch = silent `redirect_mismatch`). | Redirect round-trip succeeds; no CORS/redirect errors. |
| S4.7 | Account-linking policy: same email via Google vs GitHub vs password → link to one Cognito `sub`. (Stabilizes the identity key S5.9 caps on.) | Test: two IdPs, one email → one linked user; cap key = post-link `sub`. |

**Closeout.** All three sign-in methods round-trip in non-prod; federated user
lands with sandbox context → `docs/deploys/S4-oauth-<sha>.md`.

---

## Sprint S5 — Self-serve signup → sandbox → "Start free" real tenant

**Goal.** A stranger signs up (OAuth/email), lands in the demo sandbox, and can
**"Start free"** to provision their own real tenant (no payment), then run the
existing onboarding flow — **with the provisioning plane/auth boundary resolved**
and **cost/abuse guardrails** in place.

**Demo.** Fresh sign-up → sandbox → "Start free" → "setting up your workspace…"
(polls lifecycle-status) → lands in own tenant → `OnboardingFlow` completes with
a real school created.

**Dependencies.** S3 (sandbox), S4 (OAuth + S4.3a + S4.7), S1 (optional starter
seed). **S5.0 gates all S5 backend tickets.**

| # | Title | Validation |
|---|---|---|
| S5.0 | **Spike + ADR** `docs/public-alpha/adr-self-serve-provisioning.md`: resolve *which plane hosts the self-serve provision endpoint and how it is authorized to emit `sbt_aws_onboardingRequest`* — a tenant-pool visitor token cannot call the control-plane API or the SBT bus today. (Options: new public control-plane endpoint w/ M2M creds; or a tenant-API Lambda granted `events:PutEvents` on the SBT bus.) | ADR merged; a throwaway visitor-token call results in **exactly one** `sbt_aws_onboardingRequest` on the bus (spike harness). |
| S5.1 | Self-serve onboarding design doc: signup → sandbox → "Start free" provisions real tenant + promotes the user to its TenantAdmin; capture country/intended-use at signup. | Doc + sequence diagram reviewed; consistent with S5.0 ADR. |
| S5.2 | Backend `POST /signup` (**public, no auth, WAF per-IP rate-limited**): create/return a sandbox session; capture country/archetype intent. NEW `/signup` prefix → **new nginx block**. | E2E: unauthenticated call returns sandbox redirect; WAF rate-limit enforced. |
| S5.3 | Backend self-serve provisioning per the S5.0 ADR: emit onboarding with captured country/archetype; create requester as TenantAdmin; idempotent per linked Cognito `sub`. | E2E: emits event once; second call no-ops; tenant appears `active`. |
| S5.4 | `GET /tenants/:tenantId/lifecycle-status` (productize dev-tenant T5.10 — exact `{status, progress, errors[]}` shape): reflect SBT/CodeBuild phase incl. the SBT ISSUE-008 (CodeBuild-fail-vs-SF-success) guard. | E2E: status transitions PENDING→SUCCESS/FAILED; a forced CodeBuild failure surfaces as FAILED, not SUCCESS. |
| S5.5 | Frontend signup page: OAuth + email + country + intended-use + **a minimal ToS/privacy-consent checkbox** (links to a privacy stance doc) → sandbox landing. | RTL + visual smoke; submit blocked without consent; render-path trace. |
| S5.6 | Frontend "Start free" → provisioning wait screen (polls S5.4) → redirect to own-tenant onboarding. | RTL with simulated polling; visual smoke. |
| S5.7 | Wire existing `OnboardingFlow` to the freshly-provisioned tenant; optional toggle to pre-seed a starter dataset via the S1 loader. | Onboarding completes; school created; (toggle on) starter rows present. |
| S5.8 | New tenants are fully usable with no billing: status `active`; no trial-expiry enforcement active for alpha. | New tenant fully usable; no suspension fires on a new tenant. |
| S5.9 | Abuse guardrails: email-verify before provision; **per-identity tenant cap keyed on the post-link Cognito `sub`** (depends on S4.7); WAF on public routes. | Cap rejects the N+1 provision per identity; switching IdP for the same linked identity does not bypass the cap. |
| S5.9a | **Provisioning cost/concurrency guardrail**: global concurrent-provision cap + per-day new-tenant ceiling + CloudWatch alarm on CodeBuild minutes (each Start-free = a `cdk deploy` CodeBuild run). | Ceiling rejects the N+1 provision in the window; alarm fires on a synthetic burst. |

**Closeout.** End-to-end fresh signup → real tenant, logged + screenshotted →
`docs/deploys/S5-self-serve-<sha>.md`. STOP: any unauthenticated path provisions
without verification, or the cap is IdP-bypassable → halt + fix S5.9/S4.7.

---

## Sprint S6 — Offboarding: cancel + suspend + export + clean delete

**Goal.** A tenant admin can cancel (→ suspend/read-only), download a full
tenant data export, and request deletion an operator executes with **zero
orphans** across every resource type.

**Demo.** Cancel → tenant read-only; download a complete, tenant-scoped export
bundle; operator hard-deletes → `verify-cleanup` reports 0 rows across DDB,
analytics, SNS, and S3.

**Dependencies.** S2 (guard patterns); **soft dep S1** (something to export/delete).

| # | Title | Validation |
|---|---|---|
| S6.1 | `PATCH /tenants/:id/status` (suspend/reactivate) — TenantAdmin (self) or operator; respects field-governance immutables. | E2E: transitions persist; invalid transitions rejected. |
| S6.2 | **Entitlement guard**: suspended tenant → reads OK, writes → 403 `TENANT_SUSPENDED` (reuses the D5 read-only mechanism). Enforce at authorizer or shared Nest guard. | Integration: suspended writes blocked, reads allowed; active unaffected. |
| S6.3 | Frontend: wire `settings/danger.tsx` — "Deactivate" → S6.1 suspend (typed confirm); "Delete Account" → deletion-request flow. | RTL + `dev:shell` visual smoke; buttons functional; render-path trace. |
| S6.4a | **Export orchestration**: async `POST /tenants/:id/export` → job record + `GET /tenants/:id/export/:jobId` status. (If `/export` is a new top-level prefix → new nginx block; prefer nesting under `/tenants`.) | E2E: job created, status transitions to COMPLETE. |
| S6.4b | **Per-service row gatherers** (identity/academics/finance) — **tenant-scoped at the query layer** (not a table scan filtered in memory); reuse existing CSV streamers; **omit secrets/`apiKey`**. Write JSON+CSV bundle to S3. | Unit/integration per service; bundle contains each entity type; no secret fields present. |
| S6.4c | **Presigned retrieval** of the completed bundle. | Presigned URL downloads the bundle; expires correctly. |
| S6.5 | Export completeness + isolation test: seeded demo tenant → export → per-entity counts reconcile against a DDB scan **and** the export of tenant A contains **zero** tenant-B partition keys. | Integration: counts match; cross-tenant scan == 0. |
| S6.6 | Fix `deprovision-tenant.sh`: JSON-safe item handling (no word-split), `BatchWriteItem` 25-row chunks w/ retry (no arg-overflow); re-upload source tarball ([update-provision-source.sh](../../scripts/utils/update-provision-source.sh)). | Deprovision a 400+-row throwaway tenant: no `ValidationException`; all rows gone. |
| S6.7a | Extend deprovision to **analytics tables** (analytics, analytics-landing, user-session-events); productize the relevant `cleanup-orphans/` script into a tested lib; tag-gated (refuse demo/production). | Post-run scan: 0 analytics rows for the tenant. |
| S6.7b | Extend deprovision to **per-tenant SNS topic** + subscriptions. | Topic + subs gone; idempotent. |
| S6.7c | Extend deprovision to **tenant S3 objects** (export/pdf/reporting prefixes). | Prefix listing == empty post-run. |
| S6.8 | `DELETE /tenants/:id` in the OpenAPI overlay — three-way route reg, tag-gate (refuse demo/production w/o confirm), emits `TENANT_DEPROVISION_REQUESTED` audit event, returns 202+jobId. | Route-shape test; `lint:routes` clean; demo/production refusal asserted. |
| S6.9 | `verify-cleanup` productized (umbrella gate over S6.7a–c) + full-lifecycle audit events (requested → SBT-complete → orphans-swept → verified). | E2E: events present; **exit nonzero on any orphan** across all resources. |
| S6.10 | RETAIN/deletion-protection runbook + operator restore script (PITR), per [infrastructure-sunset/02-execution-plan.md](../infrastructure-sunset/02-execution-plan.md). | Restore-script dry-run reverses a synthetic strip on `dev-pabson-primary`; runbook reviewed. |
| S6.11 | **Refuse-list defense-in-depth test**: Saraswati + all demo tenant UUIDs are refused at the **lib layer** even when API/CLI guards are bypassed. | Unit test calls the lib deleter directly with a protected UUID → throws. |

**Closeout.** Full cancel → export → delete cycle on a throwaway tenant; zero
orphans verified → `docs/deploys/S6-offboarding-<sha>.md`.

---

## Sprint S7 — Usage monitoring & engagement (SES is greenfield)

**Goal.** Turn existing analytics signals into real outreach + an operator health
view. **There is no email send path today** — S7.0/S7.1/S7.2 are net-new and
gated on an external SES approval.

**Demo.** A tenant crosses the dormancy threshold → re-engagement email sent
(captured in SES sandbox); AdminWeb shows active/inactive/dormant/at-risk counts
+ an at-risk list with churn flags.

**Dependencies.** Existing analytics infra. S4/S5 events for welcome emails.
**S7.0 is an external launch-blocking dependency — start it first.**

| # | Title | Validation |
|---|---|---|
| S7.0 | **Request SES production access (out-of-sandbox)** + DKIM/SPF/DMARC domain verification. Track as a launch-blocking external dependency (sandbox only emails verified addresses; approval has lead time and can be rejected). | Approval ticket filed; domain verified; status tracked in `docs/deploys/`. |
| S7.1 | CDK: SES configuration set + suppression list + IAM for the email Lambda. | Synth/diff; test email sends in SES sandbox (non-prod). |
| S7.2 | Email Lambda (the "Layer 10.1 AnalyticsEmailLambda" placeholder → real): one cohesive templated sender (welcome, onboarding-nudge, dormancy, usage digest as data templates). | Unit tests render each template deterministically; integration sends via SES sandbox. |
| S7.3 | `TenantDormant` **consumer**: EventBridge rule → email Lambda → re-engagement email to tenant contact (closes the orphaned-event gap). | Synthetic `TenantDormant` → email queued; one per dormancy episode (idempotent sentinel). |
| S7.4 | Welcome email on signup/`provisionSuccess` (hook S5). | Provision → welcome email; e2e. |
| S7.5 | Churn-risk classifier in the rollup: a simple flag (declining write-trend / N-days-silent tiers) on the fleet row, **with thresholds pinned in the seed-spec** for deterministic tests. | Unit test on the classifier with a fixed activity series → expected flag. |
| S7.6 | Enrich the **existing** `GET /analytics/fleet` handler (analytics-stack Lambda router — **not** the NestJS three-way) with per-tenant health (status + risk + last-activity). | Handler test; enriched payload. |
| S7.7 | AdminWeb tenant-health dashboard widget (consumes the analytics API): counts + at-risk list. **AdminWeb publish gate: jsdom bundle-sim before `controlplane-stack` redeploy.** | Snapshot/RTL; **bundle-sim passes**; visual smoke. |
| S7.8 | Operator business-level alert (distinct from infra alarms): SNS/email on tenant dormant/at-risk transition. | Synthetic transition → operator alert fires. |
| S7.9 | Email preferences + unsubscribe + suppression honoring (CAN-SPAM basics). | Unsubscribe link suppresses subsequent sends; test. |

**Closeout.** Dormancy → email + AdminWeb dashboard demo; screenshots →
`docs/deploys/S7-monitoring-<sha>.md`.

---

## Cross-sprint risks & mitigations

| Risk | Mitigation |
|---|---|
| **SES production-access lead time** (external blocker; sandbox only emails verified addrs; can be rejected without DKIM/DMARC + low-complaint story) | S7.0 filed first, tracked as launch-blocking. |
| **Cost blowup from self-serve provisioning** (each Start-free = a CodeBuild `cdk deploy`; burst = money + CFN/CodeBuild concurrency) | S5.9a global/per-day caps + CodeBuild-minutes alarm. |
| **Demo-tenant poisoning / token-minting oracle** | D5 hard read-only; S3.4 WAF rate-limit + demo-only + replay-rejection test. |
| **Federated users with no tenant context** (post-auth trigger doesn't inject claims) | S4.3a pre-token-generation Lambda; sandbox needs no login (D5). |
| **Self-serve plane/auth boundary** (tenant token can't reach control-plane/SBT) | S5.0 ADR gates S5 backend. |
| **GitHub is not OIDC** (`UserPoolIdentityProviderOidc` won't work raw) | S4.2 OIDC shim as first-class infra. |
| **Public keyless endpoints unprotected** (API-GW UsagePlan is API-key-based) | AWS WAF per-IP on `/signup`, `/demo/session`. |
| **Cognito hosted-UI / callback / ACM sprawl** (silent `redirect_mismatch`) | S4.6 exact callback allowlist; S4.1 notes ACM dep. |
| **Identity-bypassable tenant cap** | S4.7 account-linking before S5.9; cap keyed on post-link `sub`. |
| **Export leaks cross-tenant data or secrets** | S6.4b tenant-scoped queries + secret omission; S6.5 cross-tenant-scan == 0. |
| **Destructive offboarding hits a real tenant** | Refuse-list constants at lib layer (S6.11); tag-gate at API+lib+CLI; PITR rollback; dry-run default. |
| **`deprovision-tenant.sh` still orphans a resource** | S6.9 `verify-cleanup` == 0 across all resources is the gate. |
| **AdminWeb white-screen on dependency drift** | jsdom bundle-sim hard gate; zod pin held `~3.24.4`. |
| **Shared-types churn breaks Docker builds** | Caret-pin bump in same PR across `server/`, `server/application/`, root lockfile. |
| **ABAC FE↔BE drift re-appears** | S2.4 parity test in CI. |

---

## Open questions (confirm during/after review)

| # | Question | Blocks |
|---|---|---|
| Q1 | D5 confirmed: real-JWT persona switch + **no sandbox login** + **hard read-only** demo — agreed? | S3.4, S3.5, S3.7 |
| Q2 | Default sandbox landing persona = **Principal**? | S3.7 |
| Q3 | Demo reset cadence = **nightly**? | S3.6 |
| Q4 | GitHub OIDC **shim** acceptable as first-class infra (vs dropping GitHub for alpha, Google-only)? | S4.2 |
| Q5 | Suspended-tenant entitlement = **read-only** (same mechanism as demo) — agreed? | S6.2 |
| Q6 | Self-serve tenant cap per identity for alpha (e.g., 1–3) + global per-day ceiling value? | S5.9, S5.9a |
| Q7 | "Start free" wording given no billing — keep "free trial" or "free workspace"? | S3.8, S5.6 |
| Q8 | Branded custom hosted-UI domain (needs ACM cert) or default Cognito domain for alpha? | S4.1 |

---

*Generated 2026-06-12 from a six-area public-alpha readiness audit (onboarding/
OAuth, Stripe, offboarding, monitoring, demo seeding, ABAC) against both repos,
then revised after an adversarial review pass that corrected four material
mis-scopes (finance-BE already gated; `roles[]`/`permissionOverrides` are live;
audit query API partially exists; federated claim-injection + self-serve
provisioning-plane boundaries) and added the SES-approval, provisioning-cost,
and WAF risks. Sprint format mirrors `docs/platform-hardening/sprint-plan.md`.
Timeline estimates intentionally omitted per request.*

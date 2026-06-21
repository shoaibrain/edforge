# Authorization Coverage — Assessment & Remediation

> Produced by the static authz-coverage audit (`scripts/audit/authz-coverage.ts`).
> Raw map: [`authz-coverage.generated.md`](./authz-coverage.generated.md).
> Part of the RBAC/ABAC epic ([`rbac-abac-epic.md`](./rbac-abac-epic.md)), R0.3.

## TL;DR — verdict for pilot

**Every write is now authorized; one read-side gap (staff HR records) remains.**
Of **374** controller routes, **289 (77%)** now enforce authorization at the
guard layer (up from 214 at the start of this epic). The remaining **80
`authn-only`** + **3 `public`** routes have been read end-to-end and triaged:

- **63 are verified-safe and allowlisted** with per-route justification in
  `scripts/audit/authz-allowlist.txt` — pre-login routes, routes that act only
  on the caller, routes whose authorization is enforced **in the service layer**
  (verified by inspection), and authenticated **tenant-scoped reference reads**.
- **14 remain in `authz-baseline.txt`** — the staff **HR-record reads** (`GET
  /staff*`, `GET /schools/:schoolId/staff`, `GET /credentials/expiring`). These
  are authenticated but carry no role check at any layer, so a logged-in Parent
  or Student can currently read a teacher's leave, credentials, employment
  history, and trainings. This is the one remaining gap — see *Remaining gap*
  below.

**What changed since the first cut.** The original audit found **155** authn-only
identity routes. The write-side remediation (batches 3–8 on this PR) added
guard-level authz to the genuinely-open writes: calendar / calendar-date /
calendar-block, academic-session / shift-resolver / academic-years (school
`scheduling` permission, school-scoped), and staff / credentials / leave /
trainings / reporting-snapshot writes (`@RequireGlobalRole('TenantAdmin')`). The
remaining authn-only routes were then triaged: the self/admin/delegation-enforced
ones and benign reference reads moved to the allowlist; the staff HR reads stayed
in the baseline.

**Pilot implication:** the privilege-escalation and data-mutation surface is
closed — no Parent/Student/Teacher can create staff, assign roles above their
seniority, or mutate school config without the right role. The residual risk is
**read confidentiality of staff HR data**, which is lower-severity and needs a
permission-model decision (below) rather than a mechanical guard.

## What the audit checks

Static AST pass over every `*.controller.ts` in identity/academics/finance.
For each route it records the effective guards (class + method) and authz
decorators, then classifies:

| Class | Meaning |
|---|---|
| `authz` | has `@RequirePermission` / `@RequireGlobalRole` (or a self-enforcing authz guard) |
| `internal` | `InternalApiKeyGuard` (service-to-service) |
| `authn-only` | `JwtAuthGuard` only — any logged-in tenant user can hit it |
| `public` | no `JwtAuthGuard` at all |

Enforcement nuance the tool encodes: **`PermissionGuard` is a no-op without
`@RequirePermission`** (`if (!permission) return true`), so coverage keys on the
**decorator**, not the guard.

## The 3 public routes — reviewed, intentional

`POST /auth/login`, `GET /auth/health`, `GET /tenants/lookup` — all pre-login by
necessity. Allowlisted in `scripts/audit/authz-allowlist.txt`.

## Original characterization (first cut — 155 authn-only)

> Historical: this is how the 155 authn-only identity routes broke down at the
> start of the epic, before the write-side remediation and triage above. Kept for
> context on how the two sub-populations were resolved.

`authn-only` does **not** automatically mean "wide open" — identity had two
sub-populations:

1. **Service-enforced** (authz exists, but in the handler/service, not the guard).
   Controllers with in-handler `globalRole` / `ForbiddenException` /
   `@RequireGlobalRole` checks: `roles`, `tenants`, `users`, `schools`,
   `school-users`, `security`, `sessions`, `admin`, `branding`,
   `education-organizations`. Example: `POST /users/:id/roles` (`assignRole`)
   rejects non-admin/non-principal callers via a seniority check in
   `RolesService`. **Lower risk**, but weaker than guard-level: no audit-log on
   deny, no consistency, easy to forget on a new method.

2. **No detectable authorization at all** — neither a guard decorator nor an
   in-handler role/Forbidden check. Clusters: `staff`, `credentials`, `leave`,
   `staff-trainings`, `calendar` / `calendar-date` / `calendar-block`,
   `bell-schedule`, `class-period`, `location`, `academic-years` /
   `school-years` / `academic-session`, `reporting/snapshots`. Verified sample:
   **`POST /staff`** has no `@RequirePermission` and no caller-role check — any
   authenticated tenant user can create staff. **Higher risk.**

**Audit limitation (stated honestly):** the tool sees *guard-level* authz only.
A flagged route may still enforce in-handler (population 1). The remediation is
the same either way — see below — so the limitation doesn't change the plan.

## What was done (P0 writes — complete)

Every genuinely-open write now has guard-level authorization:

- **School scheduling config** (`calendar`, `calendar-date`, `calendar-block`,
  `academic-session`, `shift-resolver`, `academic-years`) →
  `@RequirePermission({ resource: 'scheduling', action, schoolIdParam })` +
  `PermissionGuard`. Resolves to: all roles view; Principal/VicePrincipal edit;
  Principal create/delete; TenantAdmin bypass. The `academic-years` module gained
  `PermissionGuard`/`RolesService`/`IdentityEventsService` providers and a
  `module-wiring.spec.ts` watchlist entry (per the module-wiring invariant).
- **Tenant-admin operations** (`staff` writes, `credentials`, `leave`,
  `staff-trainings`, `reporting/snapshots` create+transition, `calendar-block`
  writes) → `@RequireGlobalRole('TenantAdmin')` + `GlobalRoleGuard`.
- **Service-layer-enforced writes left in place, allowlisted with justification:**
  role assignment (`roles.service` does TenantAdmin-or-Principal + seniority
  escalation prevention — richer than any guard), user self-edit
  (`users.controller` self/field checks), security (`security.service` strictly
  self), sessions (ownership/admin checks). Forcing a blanket guard here would
  **break** legitimate self-service and Principal→Teacher delegation, so these
  stay service-enforced and are documented in the allowlist.

## Remaining gap — staff HR-record reads (the 14 baseline routes)

`GET /staff`, `GET /staff/:staffId`, `GET /staff/search/:term`,
`GET /staff/:staffId/{assignments,credentials,employment-history,leave,trainings}`,
`GET /schools/:schoolId/staff`, `GET /credentials/expiring`. These enforce **no**
role at any layer (verified: the credentials/leave/trainings/staff read services
have no in-handler `globalRole`/`Forbidden` check). A Parent or Student can read a
teacher's HR data.

Not fixed in this slice **on purpose** — it needs a permission-model decision, not
a mechanical guard:

- `PermissionGuard` hard-requires a `schoolId` (from params/query/body) or it
  denies everyone but TenantAdmin. The `/staff/:staffId/*` routes carry **no
  school context in the path**, so the guard can't scope them; gating them to
  TenantAdmin-only would block legitimate Principal/Teacher/self reads.
- Correct fix (proposed): add a `staff:view` mapping (the `staff`,
  `staff-assignments`, `employment-history` resources already exist in the
  registry) and resolve the owning school from `staffId` before the permission
  check — so Principal/VicePrincipal/HR of the staff member's school and the staff
  member themselves can read, but Parent/Student cannot. `GET
  /schools/:schoolId/staff` can be gated directly (it has `schoolId`); the
  `/staff/:staffId/*` family needs the staffId→school resolution step.

Tracked as **P1** in the RBAC/ABAC epic; the 14 routes are the literal worklist in
`authz-baseline.txt`.

## Tooling

- `npm run lint:authz` — runs the audit. **Green** (every authn-only/public route
  is in the allowlist or the baseline); **fails on any NEW authn-only/public
  route** not in either file, so no new unguarded endpoint can land unnoticed.
- `scripts/audit/authz-allowlist.txt` — verified-safe public/authn-only routes
  (69), each with a justification stating where authorization is enforced.
- `scripts/audit/authz-baseline.txt` — the **14** remaining staff-HR-read routes
  pending guard-level read authz. **This file is the P1 worklist** — delete
  entries as they gain authz; regenerate with
  `--seed-baseline`; the gate confirms each removal.
- `npx ts-node scripts/audit/authz-coverage.ts --self-test` — parser unit checks.
- **Flip to a required CI check:** once the baseline is empty, wire `lint:authz`
  into a `.github/workflows` gate as a required status.

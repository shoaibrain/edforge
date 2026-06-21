# Authorization Coverage — Assessment & Remediation

> Produced by the static authz-coverage audit (`scripts/audit/authz-coverage.ts`).
> Raw map: [`authz-coverage.generated.md`](./authz-coverage.generated.md).
> Part of the RBAC/ABAC epic ([`rbac-abac-epic.md`](./rbac-abac-epic.md)), R0.3.

## TL;DR — verdict for pilot

**The student-facing surface is safe; the school-administration surface is not yet.**
Of **374** controller routes, **214 (57%)** enforce authorization at the guard
layer, but **155 (41%)** are **`authn-only`** — authenticated, but with **no
guard-level authorization**. The split is almost entirely by service:

- **academics + finance** (students, grades, attendance, invoices, payments — what
  Teachers / Parents / Students touch most) are **guard-enforced**. Only 2 read
  routes there are authn-only, both benign (a dashboard overview; the
  payment-gateway callback that enforces ownership in-handler).
- **identity** (schools, staff, users, roles, calendars, academic config) holds
  **~all 155** of the gap (schools 59, staff 32, users 25, …).

**Pilot implication:** a logged-in **Parent or Student** could reach 150+
authenticated identity endpoints — including school-config and staff writes —
that do not check their role at the guard layer. Some are caught in-handler (see
below), but the surface must be closed/verified before we greenlight accounts
for non-admin staff.

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

## The 155 authn-only routes — characterization

`authn-only` does **not** automatically mean "wide open" — identity has two
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

## Recommended remediation (uniform: move authz to the guard layer)

The fix for every authn-only write route is to add guard-level authorization
(`@RequirePermission({ resource, action })` + `@UseGuards(PermissionGuard)`, or
`@RequireGlobalRole(...)` for tenant-admin-only operations). This gives, in one
move: consistency, defense-in-depth, and **audit-logged denials** (the guard
logs every deny; in-handler checks do not).

Phased, pilot-first:

- **P0 — before pilot greenlight (population 2, the genuinely-open writes):**
  `staff*`, `credentials`, `leave`, `staff-trainings`, calendar/schedule
  (`calendar*`, `bell-schedule`, `class-period`, `location`), academic config
  (`academic-years`, `school-years`, `academic-session`), `reporting/snapshots`.
  Add `@RequirePermission` (resources already exist in the registry:
  `teachers`/`staff`, `staff-assignments`, `scheduling`, `settings:school`,
  `reports`, …). Each endpoint = one decorator + a guard-spec assertion.
- **P1 — consistency sweep (population 1):** migrate the in-handler-enforced
  identity controllers (`roles`, `users`, `schools`, `tenants`, `security`,
  `sessions`, …) to guard-level authz, keeping the in-handler check as
  belt-and-suspenders until the guard spec proves parity.
- **P2 — flip the gate to blocking:** once `authz-baseline.txt` is drained, wire
  `npm run lint:authz` into CI as a required check so no new unguarded route can
  ship.

## Tooling (this slice)

- `npm run lint:authz` — runs the audit. **Green today** (baselined); **fails on
  any new authn-only/public route** not in the allowlist/baseline. Advisory until
  P2.
- `scripts/audit/authz-allowlist.txt` — intentional public/authn-only routes (6).
- `scripts/audit/authz-baseline.txt` — the 152 known authn-only routes pending
  authz. **This file is the P0/P1 worklist** — delete entries as endpoints gain
  guard-level authz; the gate confirms each removal.
- `npx ts-node scripts/audit/authz-coverage.ts --self-test` — parser unit checks.

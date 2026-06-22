# Authorization Coverage — Assessment & Remediation

> Produced by the static authz-coverage audit (`scripts/audit/authz-coverage.ts`).
> Raw map: [`authz-coverage.generated.md`](./authz-coverage.generated.md).
> Part of the RBAC/ABAC epic ([`rbac-abac-epic.md`](./rbac-abac-epic.md)), R0.3.

## TL;DR — verdict for pilot

**All identified authorization gaps are closed. The baseline is empty.**
Of **374** controller routes, **303 (81%)** now enforce authorization at the
guard layer (up from 214 at the start of this epic). The remaining **66
`authn-only`** + **3 `public`** routes have all been read end-to-end, are
verified-safe, and are allowlisted with per-route justification in
`scripts/audit/authz-allowlist.txt` — pre-login routes, routes that act only on
the caller, routes whose authorization is enforced **in the service layer**
(verified by inspection), and authenticated **tenant-scoped reference reads**.
`authz-baseline.txt` (the "pending authz" drain worklist) is **now empty**.

**What changed.** The original audit found **155** authn-only identity routes.
This was closed in three moves:

1. **Write-side guards (batches 3–8).** Guard-level authz on the genuinely-open
   writes: calendar / calendar-date / calendar-block, academic-session /
   shift-resolver / academic-years (school `scheduling` permission, school-scoped),
   and staff / credentials / leave / trainings / reporting-snapshot writes
   (`@RequireGlobalRole('TenantAdmin')`).
2. **Triage of the rest.** Self/admin/delegation-enforced routes and benign
   reference reads moved to the allowlist with justifications.
3. **Staff HR-read guard (`StaffReadGuard`).** The staff directory + HR
   sub-resource reads (`GET /staff*`, `GET /schools/:schoolId/staff`, `GET
   /credentials/expiring`) — previously readable by any authenticated tenant
   user — now deny portal accounts. See *Staff HR reads* below.

**Pilot implication:** both the privilege-escalation / data-mutation surface
(writes) and the staff-HR read-confidentiality surface are closed. A logged-in
Parent or Student can no longer create staff, assign roles above their seniority,
mutate school config, or read a teacher's leave / credentials / employment
history. The audit gate is now a **blocking CI check**
(`.github/workflows/authz-coverage.yml`), so no new unguarded route can ship.

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

## Staff HR reads — closed with `StaffReadGuard`

The 14 staff HR-record reads (`GET /staff`, `GET /staff/:staffId`, `GET
/staff/search/:term`, `GET
/staff/:staffId/{assignments,credentials,employment-history,leave,trainings}`,
`GET /schools/:schoolId/staff`, `GET /credentials/expiring`) previously enforced
**no** role at any layer, so a Parent or Student could read a teacher's HR data.

`PermissionGuard` couldn't be dropped onto them: it hard-requires a `schoolId`
(params/query/body) or denies everyone but TenantAdmin, and the `/staff/:staffId/*`
and tenant-wide `/staff` / `/staff/search` routes carry no per-record school in the
path. The fix is a dedicated guard rather than a school-scoped permission:

- **`StaffReadGuard`** (`common/guards/staff-read.guard.ts`) — allows TenantAdmin
  and any caller holding **at least one staff-type school role**
  (Principal/VicePrincipal/Teacher/Accountant/Staff/Counselor/Nurse) at any
  school; denies callers whose only active roles are Parent and/or Student. It
  queries the caller's active `RoleAssignment` rows (expiry-filtered) and is
  applied via `@UseGuards(StaffReadGuard)` on each of the 14 GET routes. Injects
  only `DynamoDBClientService`; wired into the `staff`, `credentials`, `leave`,
  and `staff-trainings` modules with `module-wiring.spec.ts` watchlist entries.
- The audit recognizes it as a self-enforcing authz guard
  (`SELF_ENFORCING_AUTHZ_GUARDS`), so the 14 routes now classify as `authz`.
- `GET /staff/by-email` is **not** gated — it is a service-to-service resolver
  (allowlisted), not an operator UI route.

**Deliberately coarse (tenant-wide, not per-school).** Any staff member can read
any staff record within the tenant. This fully closes the stated pilot risk
(portal accounts cannot read staff HR data) without breaking legitimate
Principal/Teacher/self reads. Tightening sub-resource reads (e.g. only a staff
member's own-school supervisor + self may see *leave* / *employment-history*)
needs a `staffId→school` resolution step and is a follow-up refinement, not a
pilot blocker.

## Tooling

- `npm run lint:authz` — runs the audit. **Green** (every authn-only/public route
  is allowlisted; baseline empty); **fails on any NEW authn-only/public route**,
  so no new unguarded endpoint can land. Now a **blocking CI check**:
  `.github/workflows/authz-coverage.yml`.
- `scripts/audit/authz-allowlist.txt` — verified-safe public/authn-only routes
  (69), each with a justification stating where authorization is enforced.
- `scripts/audit/authz-baseline.txt` — the "pending authz" drain worklist, **now
  empty**. If a future route legitimately needs to ship authn-only ahead of its
  guard, re-seed it here with `--seed-baseline` rather than weakening the gate.
- `npx ts-node scripts/audit/authz-coverage.ts --self-test` — parser unit checks
  (includes a `StaffReadGuard` classification case).

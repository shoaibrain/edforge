# RBAC/ABAC Baseline — 2026-07-02

> Epic **R0.4** — the honest "where authorization holds today" snapshot, run against
> `main`. Pairs the static coverage audit (R0.3) with the conformance gate (CONF.1).
> Regenerate: `npm run lint:authz` and `npm run test:abac`.

## Coverage (static — R0.3 / AUD.1–2)

`npm run lint:authz` on `main`:

```
authz-coverage: 377 routes — authz 305, internal 2, authn-only 67, public 3
✓ Every authn-only/public route is allowlisted (70 entries). baseline = 0
```

**305/377 routes (81%)** enforce authorization at the guard layer; the remaining
authn-only/public routes are each justified in `scripts/audit/authz-allowlist.txt`
(pre-login, caller-only, service-layer-enforced, or tenant-scoped reference reads).
The drain worklist (`authz-baseline.txt`) is **empty** — no un-triaged unguarded route.

## Conformance (dynamic, unit-mode — CONF.1)

`npm run test:abac` — the role × resource decision matrices + guards + data-scope +
ownership + JWT front door, run as one gate:

```
Test Suites: 13 passed, 13 total
Tests:       344 passed
```

Suites in the gate: identity `permission-matrix`, `roles.service`, `roles.cross-tenant`,
`staff-read.guard`, `iemis-permission.guard`, `role-users.fixture`; academics
`permission-matrix`, `permission.guard`, `data-scope.service`; finance `permission.guard`,
`identity-client.ownership`; `libs/auth` `jwt-auth.guard`, `jwt.strategy`.

The full backend-enforced `SchoolRole × resource × action` matrix is snapshotted in
`identity/src/roles/permission-matrix.spec.ts` (compare vs the Security Policies UI).

## What holds today (green cells)

- **TenantAdmin** bypasses the school-role engine (allow) — verified.
- **Teacher** write scope limited to `grades` + `attendance`; **no finance access at all**.
- **Parent/Student** cannot write academic records; Parent's only write is `billing:create`.
- **Only Principal** may delete a student; **no** school role manages system settings.
- **Nurse** confined to `health-records` + student view; **Counselor** to `special-programs` + view.
- **Cross-tenant**: a tenant-A JWT hitting tenant-B DDB now surfaces `403 CROSS_TENANT_FORBIDDEN` (R1.1, merged) — asserted end-to-end by `security.e2e.spec.ts`.
- **Data-scope** (academics): co-teacher roster access, cross-school denial, fail-closed-on-error (`DATA_SCOPE_FAIL_CLOSED`).
- **Finance**: Parent/Student see only their own invoices; blocked from manual payment; payment-callback ownership enforced.

## Known findings / red or amber cells

1. **UI ↔ backend matrix mismatch (amber).** The Security Policies UI shows Principal
   `grades:delete` / `attendance:delete` as ✗, but the backend grants Principal
   `grades:*` / `attendance:*` (engine allows). Pinned in `permission-matrix.spec.ts`
   as a FINDING to reconcile (frontend `packages/abac` vs backend `DEFAULT_ROLE_PERMISSIONS`).
2. **GSI tenant isolation is application-level only (amber).** Per
   [`gsi-tenant-isolation-audit.md`](./gsi-tenant-isolation-audit.md) (R2.1): GSI queries
   carry no IAM `LeadingKeys` condition. `EMAIL#` (shared identity table) and
   `{emisSchoolCode}` (GSI8) must be verified to post-filter by `tenantId` (R2.2, Chunk 3).
3. **Token revocation lag (amber, accepted for alpha).** A demoted admin's JWT stays
   valid ~1h; `verifyDynamoRole` re-checks sensitive ops in the interim. Systematic
   epoch-based revocation is R3 (Tier B / post-greenlight).

## Remaining conformance gaps (tracked)

`FIN.2` finance permission-matrix · `PPL.2/3/6` multi-role-union / escalation /
`verifyDynamoRole` tests · `SCOPE.1` cache-invalidation · `R1.9` InternalApiKeyGuard
spec · `CONF.2` live smoke formalization (`scripts/smoke/rbac-personas.sh` exists).
See the delivery plan (Chunk 2) and `rbac-abac-epic.md`.

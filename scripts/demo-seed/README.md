# Demo tenant seeder (Sprint S1)

Populates a provisioned tenant with a complete, realistic demo school using the
deterministic demo data engine in
[`@edforge/pilot-fixtures`](../../packages/pilot-fixtures/src/demo). See
[`docs/public-alpha/demo-seed-spec.md`](../../docs/public-alpha/demo-seed-spec.md)
for the spec.

## What it seeds

One fully-populated K-12 school per archetype (`PABSON` / Nepal, `GENERIC` / US):
academic year + terms, ~16 staff covering every ABAC role, 200 students with
guardians, courses + course-sections, one published exam cycle with marks +
result cards, and fee structures + invoices + payments.

## Usage

```bash
export ARCHETYPE=PABSON          # or GENERIC
export API_BASE=https://<api-id>.execute-api.<region>.amazonaws.com/prod
export JWT_FILE=/tmp/demo-tenant-admin-jwt.txt   # fresh TenantAdmin JWT for the demo tenant

# 1. Inspect the plan — no JWT or network required:
./scripts/demo-seed/seed-demo-tenant.sh --dry-run

# 2. Seed (idempotent — a re-run creates nothing already present):
./scripts/demo-seed/seed-demo-tenant.sh

# Skip the heavy per-student course-section enrolment / exam scoring:
./scripts/demo-seed/seed-demo-tenant.sh --no-membership --no-scores

# 3. Re-baseline a demo tenant (deletes ONLY demo-marked rows):
./scripts/demo-seed/seed-demo-tenant.sh --reset --confirm-demo
```

| Var / flag | Purpose |
|---|---|
| `ARCHETYPE` | `PABSON` or `GENERIC` (required) |
| `API_BASE` | Tenant API Gateway base URL (live runs) |
| `JWT_FILE` | Path to a TenantAdmin JWT for the **demo** tenant |
| `SEED` | RNG seed (default `demo`); same seed → identical roster |
| `--dry-run` | Print the plan; make no HTTP calls |
| `--reset` `--confirm-demo` | Delete demo-marked rows (both required together) |
| `--no-membership` / `--no-scores` | Skip the heavy enrolment / scoring phases |

## Safety

- All emails use the reserved non-deliverable `@demo.edforge.test` domain;
  `emisSchoolCode`/`emisStudentId` use the implausible `9999…` band — demo data
  can never collide with, or be reported to IEMIS as, a real school/student.
- `--reset` refuses to run without `--confirm-demo` and only deletes rows that
  match the reserved demo markers, so a hand-planted real row survives and a
  mis-pointed reset against a real tenant deletes nothing.

## Live-run note

The dry-run is fully exercised in CI-style tests; a live end-to-end seed against
`dev-pabson-primary` / `dev-generic-01` is the deploy-time validation (requires
a provisioned demo tenant + a TenantAdmin JWT) per the S1 closeout.

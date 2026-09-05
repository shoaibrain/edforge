# Sprint 4 pre-implementation audit and the compressed plan (2026-09-05)

Sprints 0–3 are merged and live (PR #443, #447, #448, #449). The operator has
asked for the rest of the epic in one day, has informed the customer, and
accepts production interruption for the day. This note records what was read,
what changes because of that instruction, and the ladder for the day.

## What was read

- `MIGRATION_PLAN.md` Sprints 4–8, §9 (cost trajectory) and the review log.
- `server/service-info.txt`: every container still addresses its siblings over
  Service Connect (`*-api.<namespace>.sc:3010`); only the Lambda functions use
  the API-B URLs (`withApiBServiceUrls`). That is the Sprint 2 decision D2.5:
  repointing the containers was deferred to a C4.4 prerequisite.
- `server/lib/tenant-template/services.ts`: `desiredCount` is the literal `1`
  for every service (the pilot-era comment at line 135); `service-info.json`
  carries no per-container count.
- `server/lib/route-map.json`: 17 prefixes on `identityFn`, one on
  `academicsFn`, `finance` on the VPC link. Spec generator
  `npm run openapi:generate`; drift check `npm run openapi:check`.
- The generated API-B spec: 127 `/finance/*` routes proxy to the container;
  API-B and API-A share 85 read-only `GET` routes with at most a `schoolId`
  parameter; the parity script exercises 30 of them across identity,
  academics and finance.
- API-A has an access log group and 465 requests in the last 24 h; API-B has
  its own access log and 434 (preview plus the Sprint 3 acceptance).
- Smoke suites take `API_BASE_URL` and `ID_TOKEN`; they run with `tsx`.

## Decisions taken

| # | Decision | Why |
|---|---|---|
| D4.1 | **Do not repoint the containers to API-B and do not scale identity/academics to zero in Sprint 4.** Sprint 4 moves the frontend to API-B and soaks; Sprint 5 flips finance to its function; then all four services go to zero together (C4.4 folded into C5.3). | Repointing finance-on-ECS to API-B (D2.5's C4.4 prerequisite) is a rolling update of a container that is scaled to zero a few hours later on the same day. Between the two flips nothing on ECS changes, so the container-to-container path is never in a half state. The ≈ $29/month of C4.4 arrives with C5.3 instead of a few hours earlier. |
| D4.2 | **Soaks are compressed** from 48 h to the time it takes to prepare the next step, with the same signals watched (functions-errors alarm, API-B 5xx, `Init Duration`, login latency) plus an explicit pilot login by the operator. | Operator instruction; the customer is informed. Rollback of every step stays a redeploy or an environment-variable flip, exactly as planned. |
| D4.3 | **Sprint 7 (provisioning without CodeBuild) is not attempted today.** Sprint 8's docs and scaffolding removal follow the teardown as their own PR. | Sprint 7 is new code against SBT's event contracts with its own round-trip test; it removes $2/month (the ScriptJob KMS keys) and CodeBuild bills per use. Doing it in the same day as the teardown adds risk for no cost effect. |
| D4.4 | `desiredCount` becomes a per-container field in `service-info.txt` (default 1) rather than a stack-wide flag. | The plan's primitive; it also keeps the original Sprint 4/5 split available if the day does not go as intended. |

## The day's ladder

Each phase is its own PR, reviewed, diffed, deployed on an explicit go, and
validated before the next phase starts.

**Phase A — Sprint 4.**
1. C4.1 `scripts/smoke-tests/api-ab-parity.ts`: the same read-only requests
   against API-A and API-B with one token, status and body compared byte for
   byte (a small allow-list of volatile keys), latency recorded. Run for the
   dev tenant and, read-only, for the pilot tenant.
2. C4.2 the operator points Vercel *Production* (`API_BASE_URL`, `VITE_API_URL`)
   at API-B and redeploys; pilot login by the operator; API-A access log goes
   quiet; the write-path suites run against API-B on the dev tenant.
3. C4.3 compressed soak while Phase B is prepared.
4. C4.4 code (this PR): per-container `desiredCount`; values stay 1.

**Phase B — Sprint 5.** C5.1 route map `finance → financeFn`, spec regenerated,
shared-infra deployed; finance suites and the PDF paths on API-B against the
dev tenant (the fonts fix from Sprint 3 is what makes this possible); C5.2
compressed soak; C5.3 all four services to `desiredCount 0`.

**Phase C — Sprint 6.** C6.1 → C6.2 → C6.3 → C6.4 → C6.5 → C6.6 with the
export pre-flight (`list-imports`) before every stack deploy.

**Afterwards, not today.** Sprint 7; Sprint 8 (docs, scaffolding removal,
month-end reconciliation).

## Findings

| # | Finding | Effect |
|---|---|---|
| F4.1 | The Sprint 4 plan's C4.4 precondition (containers repointed to API-B) was never implemented; `service-info.txt` still carries Service Connect URLs for all three containers. | Scaling identity or academics to zero with finance still on the container would break finance's permission guard. Handled by D4.1. |
| F4.2 | API-A does not serve `/analytics/*` (F2.2) and API-B does, so analytics routes are excluded from parity and gain coverage only after the cutover. | Parity list is identity, academics and finance routes. |

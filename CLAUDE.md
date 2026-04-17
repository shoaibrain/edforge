# EdForge — Claude Code project rules

Durable rules for working in this repo. Loaded automatically by Claude Code.

## Deploy log convention (analytics — A0.2.T3)

Every analytics-related CDK deploy, ECR image push, and ECS rolling update **MUST** be tee'd to `docs/deploys/` so we have a durable audit trail.

### How

Use the wrapper, never raw `cdk deploy` for analytics work:

```bash
./scripts/deploy-analytics.sh <stack> <profile> [extra cdk args...]
```

The wrapper:
- Creates `docs/deploys/analytics-<env>-<stack>-<YYYYMMDD-HHMMSS>-<gitsha>.log`
- Sets `CDK_NAG_ENABLED=false` (override per call) and `CDK_PARAM_COMMIT_ID=<gitsha>` (override per call)
- Passes through extra CDK args

### Why

Without consistent deploy logs:
- Replaying an incident months later requires reading CloudWatch StackEvents (slow, lossy).
- The Sprint 2 final deploy log was lost because we didn't enforce this — recovered only by best-effort backfill.
- Audit trail for partner-facing incidents is incomplete.

### Coverage

The convention applies to **every** analytics-impacting deploy:
- `analytics-stack` — write path + read path
- `tenant-template-stack-basic` — when identity/academics/finance task defs change
- `core-appplane-stack` — when provisioning script changes
- `shared-infra-stack` — when authorizer ARN exports change
- ECR image pushes for identity/academics/finance/rproxy when they touch analytics emit code (capture build script output via the same wrapper pattern)

If you find yourself running `npx cdk deploy` directly for an analytics stack, stop — use the wrapper.

### Index

`docs/deploys/INDEX.md` is the historical map of every analytics deploy by sprint. Update it when a sprint ships.

## Shared types (A0.1)

Cross-codebase analytics contract types live in `packages/shared-analytics-types/`:
- Lambda handler imports from there (no duplicate interface declarations in `analytics-service.ts`).
- AdminWeb imports via `client/AdminWeb/src/analytics/types.ts` re-export.
- One package per shared domain (analytics-types, future school-types, auth-types) — never one giant `shared-types` blob.
- npm workspaces, **not** npm publish — adding `prepare: tsc` ensures consumers get built `dist/` on cold install.

If you change a response shape in the Lambda, change it in the shared package — `tsc` will fail in AdminWeb if you forget.

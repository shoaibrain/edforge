# EdForge — Engineering conventions

This file documents the engineering conventions, edit traps, and house rules for
the EdForge codebase. It is loaded automatically by every Claude Code session in
this repo, and it ships in the public source-available release for any
contributor reading the code.

For the **architectural shape** (CDK stacks, services, data model, event flow),
see [ARCHITECTURE.md](ARCHITECTURE.md). For project framing, see [README.md](README.md).
For the contribution workflow + DCO, see [CONTRIBUTING.md](CONTRIBUTING.md). For
responsible disclosure, see [SECURITY.md](SECURITY.md).

**Operator-specific configuration** — your AWS account IDs, regions, domains,
tenant URLs, Cognito pool IDs, CloudFront distribution IDs — lives in
`server/.env.<profile>` files which are gitignored. If you want those readily
available to Claude Code sessions, add a `.claude/local-context.md` (gitignored)
with the specifics. This file intentionally carries no operator-specific values.

---

## Scope of V1

- **`BASIC` tier only.** The codebase contains forward-looking scaffolding for
  `ADVANCED` and `PREMIUM` tiers — dedicated ECS clusters per tenant,
  per-tenant Cognito pools, `tenant-template-stack-advanced` — and that
  scaffolding is intentional `V1_DEFERRED`. Don't mistake the dormant code for
  dead code; don't delete it as "cleanup."
- **One archetype** is shipped today (`PABSON` — the Private and Boarding
  Schools Organization Nepal governance body) with a `GENERIC` fallback.
  Future Nepal archetypes are anticipated for distinct governance bodies
  (e.g., CBS for public schools, NGO-run for NGO-operated schools). Other
  archetype enum values (`CBSE_IN`, `NAIS_US`, `GEMS_UAE`) are legacy
  speculative reservations carried in the type union and not
  runtime-valid yet.
- **Single AWS region per environment.** The data model is multi-region-ready;
  the deployment is not. Don't add multi-region branching to runtime code as
  "future-proofing."
- **Two live environment profiles** are supported by the deploy tooling
  (a non-production environment + production). Specific account IDs / regions
  / domains are loaded from `server/.env.<profile>`.

---

## Dependency pins that must not drift

A small number of package versions are pinned tighter than `^semver` would
suggest because a newer "compatible" release breaks a downstream bundler or
runtime. Don't widen these pins.

### `zod` → `~3.24.4` (repo-wide)

**Why:** zod `3.25+` ships a "v4 preview" at the main export via circular ESM
re-exports through `./v4/classic/external.js`. The re-export chain can't be
statically analyzed by webpack (as used by AdminWeb's CRA build / its
CodePipeline). The runtime symptom is silent and severe: a
`TypeError: Cannot read properties of undefined (reading 'string')` fires
synchronously at module init on the AdminWeb bundle, before React can call
`createRoot` — browser tab stays white, nothing in the HTML shows.

We confirmed the bug end-to-end during an earlier deploy. The monorepo uses
**zero** v4-only APIs (`z.iso.*`, `z.looseObject`, `z.treeifyError`, etc. —
grep the tree before you consider upgrading).

**Rule:**

- Root [package.json](package.json): `"zod": "~3.24.4"`.
- [server/package.json](server/package.json): `"zod": "~3.24.4"`.
- [packages/shared-types/package.json](packages/shared-types/package.json):
  `"zod": "~3.24.4"` (dep) + `">=3.22.0 <3.25.0"` (peer) — the `<3.25.0`
  upper bound is the bug-fence.
- New workspace packages that use zod: use the same `~3.24.4` pin.
- **Never** pin `"zod": "^3.23.x"` or `"^3.24.x"` — `^` with minor 3.25.0
  available on the registry will resolve to the broken version.
- **Never** pin `"zod": "^4.x"` in this repo. The entire monorepo is
  v3-compatible; keep it that way until a coordinated v4 migration happens.

When upgrading to zod v4 eventually (coordinated, not drift), the migration
needs:

1. Update shared-types + every consumer's v4-specific API usage explicitly.
2. Verify AdminWeb's webpack/CRA build produces a working bundle.
3. End-to-end jsdom simulation of the AdminWeb bundle before deploy (see the
   "Bundle init validation" pattern below) to catch silent init-time crashes.

### General rule — silent browser-bundle failures

When a frontend package changes (`@aibrains/shared-types`, anything AdminWeb
imports) or its transitive dep graph shifts (lockfile churn,
`npm audit fix`), run this **before** deploying the controlplane:

```bash
# 1. Clean rebuild of AdminWeb locally
cd client/AdminWeb && rm -rf node_modules/.cache build && npm run build

# 2. Simulate the bundle execution in jsdom — catches init-time TypeErrors
#    that webpack's build step cannot detect. The script reads the built
#    bundle, executes it inside a JSDOM window, and reports any thrown
#    Error at module init.
```

A passing sim means the bundle at least mounts React. A failing sim means
the AdminWeb deploy will produce a white screen — **do not** redeploy
`controlplane-stack` until the sim passes.

---

## Deploy pipeline — the golden shape

Every change to AWS runtime state follows a ladder:

```
┌────────────────────────────────────────────────────────────────────┐
│  1. LOCAL                                                           │
│     typecheck → lint → unit tests → cdk synth                      │
│                                                                     │
│  2. NON-PRODUCTION ENVIRONMENT                                      │
│     cdk diff → review → cdk deploy →                               │
│     build-application → ecs rolling update →                       │
│     smoke tests → runtime validation                               │
│                                                                     │
│  3. HUMAN APPROVAL GATE — review non-prod evidence                  │
│                                                                     │
│  4. PROD                                                            │
│     cdk diff (must match non-prod modulo env vars) →               │
│     cdk deploy → build-application → ecs rolling update →          │
│     smoke tests → post-deploy monitor window                       │
└────────────────────────────────────────────────────────────────────┘
```

**Never deploy straight to prod.** Every change rides this ladder, including
one-line fixes, unless a prod-only hotfix is explicitly authorized with a
documented reason.

The wrapper script for CDK deploys is
[`scripts/deploy.sh`](scripts/deploy.sh) — repo-wide and works for any stack
in the CDK app. It applies the standard guardrails: `service-info.json`
**regeneration** from `service-info.txt` (the artifact is gitignored and used
to go stale across deploys — issue #431), git SHA stamping,
`CDK_NAG_ENABLED=false` toggle, output logging.

**Deploy evidence hygiene:** raw deploy logs, smoke transcripts, JWT-derived
claims, tenant UUIDs, account IDs, ARNs, presigned URLs, operator emails, and
environment-specific hostnames must not be committed. `scripts/deploy.sh`
writes raw logs to `$EDFORGE_DEPLOY_LOG_DIR` or `/tmp/edforge-deploys` by
default. Add only sanitized summaries to `docs/deploys/INDEX.md`, and run
`npm run lint:deploy-evidence` before opening any PR that touches deploy
evidence.

**REPO_ROOT semantics:** the wrapper synthesizes from the worktree you're
**sitting in** (walks `pwd` upward to the closest `.git`), **not** the
script's filesystem location. So `/path/to/main-repo/scripts/deploy.sh`
invoked while `cd`'d into `/path/to/worktree-A` synthesizes from worktree A.
The startup log header prints `repo: <REPO_ROOT>` so the resolved path is
visible in every deploy log. This closes a 2026-06-28 silent no-op-deploy
trap where the previous `dirname "$0"` resolution synthesized from the
parent repo's stale HEAD instead of the operator's worktree.

**Never run `npx cdk deploy` directly.** The wrapper exists for a reason; the
only exceptions are `cdk synth` (read-only) and `cdk diff` (also read-only).
When running those manually for `tenant-template-stack-basic`, regenerate the
artifact first (`sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g"
service-info.txt > lib/service-info.json` from `server/`) — the diff/synth is
otherwise computed from whatever artifact is on disk, which may be stale.

---

## Change-to-deploy matrix

What to deploy when, based on what you changed. If your change hits multiple
rows, deploy in the order listed (infra before app code; CDK owns IAM, so
IAM must be in place before new code that uses it runs).

| You changed… | Deploy… | Order |
|---|---|---|
| DDB schema / GSI ([ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)) | `tenant-template-stack-basic` | 1 (infra) |
| ABAC DDB action (same file) | `tenant-template-stack-basic` | 1 |
| IAM policy (non-DDB) in [service-info.txt](server/service-info.txt) | `tenant-template-stack-basic` | 1 |
| Task def env var in `service-info.txt` | `tenant-template-stack-basic` | 1 |
| API Gateway route ([tenant-api-prod.json](server/lib/tenant-api-prod.json)) | `shared-infra-stack` | 1 |
| NestJS controller / service code (identity/academics/finance) | ECR push + ECS rolling update | 2 (app) |
| Reverse proxy route ([nginx.template](server/application/reverseproxy/nginx.template)) | ECR push + ECS rolling update for rproxy | 2 |
| Analytics Lambda code ([server/lib/analytics/lambda/](server/lib/analytics/lambda/)) | `analytics-stack` | 1 (CDK bundles Lambdas) |
| tenant-seeder Lambda ([tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts)) | **`controlplane-stack`** (lambda is instantiated inside ControlPlane, not core-appplane) | 1 |
| Provisioning script ([provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh)) | `core-appplane-stack` (script is read from disk at synth via `fs.readFileSync` and embedded in SBT ScriptJob) **PLUS** upload source tarball via [scripts/utils/update-provision-source.sh](scripts/utils/update-provision-source.sh) (CodeBuild downloads it at runtime) | 0 (source tarball first) then 1 |
| CORS config | `shared-infra-stack` | 1 |
| Cognito config | `controlplane-stack` | 1 |
| AdminWeb React code | CodePipeline rebuild via `controlplane-stack` (no direct S3 sync) | 1 |
| Shared types (`@aibrains/shared-types`) — adding exports consumed by **AdminWeb** | `npm publish` the new version, then redeploy `controlplane-stack` so CodePipeline rebuilds AdminWeb. Workspace symlinks are invisible to CodeBuild. | 0 (publish) then 1 |
| Shared types — ECS-services-only consumers | None (workspace symlink resolves at local `nest build`; no publish needed) | 0 |
| Tenant locale defaults ([packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts)) | Bump + `npm publish` `@aibrains/shared-types`, then **`controlplane-stack`** redeploy (synth-time JSON inlined into tenant-seeder Lambda) + identity ECR push (entity has hand-duplicated copy). | 0 (publish) then 1 then 2 (ECS) |

**Rule of thumb:** when in doubt, run `npx cdk diff <stack>` first. If the
diff is empty, no CDK deploy needed — just the ECR push + ECS rolling update.

---

## Local validation gates — required before any deploy

Do all of these locally before touching a deployed environment. Each gate
takes seconds to minutes; skipping them means you'll discover the problem
in the multi-hour CFN rollback window instead.

### Typecheck

```bash
# Backend NestJS service (identity example — substitute academics/finance/rproxy)
cd server/application && npx nest build identity

# CDK app (server/bin + server/lib). `nest build` does NOT compile this, and
# `cdk synth` needs operator .env + Docker, so this is the cheap pre-synth gate
# for CDK type errors (e.g. a task-def env var assigned without the matching
# ContainerInfo field — the #281 TS2339 that #282 fixed). Enforced in CI by the
# `cdk-typecheck` workflow.
npm run typecheck:cdk        # = cd server && tsc -p tsconfig.cdk.json
```

### Lint

ESLint runs from the repo root via a flat config (`eslint.config.mjs`,
typescript-eslint non-type-checked). Backend-first scope (`server` + `packages`;
AdminWeb + generated Ed-Fi models excluded). **The gate fails on errors only** —
`no-explicit-any` (~650) and `no-unused-vars` (~160) are intentional ratchet
**warnings** (surfaced for gradual cleanup, held on new code via review), not
build breakers. Enforced in CI by the `lint` workflow.

```bash
npm run lint        # check (errors fail; warnings are the ratchet backlog)
npm run lint:fix    # auto-fix the fixable subset
# Per-service: cd server/application && npm run lint   (lints microservices + libs)
```

Separate from ESLint, the repo also runs `npm run lint:routes`
(`check-route-drift.ts`) and the `archetype-invariants` (country-branch) +
`secret-scan` CI gates — those are the route/archetype/secret invariants, not style.

### Unit tests

```bash
cd server/application && npx jest <path-to-affected-spec>
# Or full suite:
cd server/application && npx jest
```

**Gotcha:** Jest's `moduleFileExtensions: ['js', 'json', 'ts']` resolves
`.js` files first. If you see stale test results, check for `.js` / `.d.ts`
artifacts next to `.ts` source under `microservices/` and delete them:

```bash
find server/application/microservices -name "*.js" -not -name "jest.config.js" -delete
find server/application/microservices -name "*.d.ts" -delete
find server/application/microservices -name "*.js.map" -delete
```

### Shared package rebuild

If you changed [packages/shared-types/](packages/shared-types/), rebuild
or consumers see stale `dist/`:

```bash
cd packages/shared-types && npm run build
```

### CDK synth (infra changes only)

```bash
cd server && source .env.<profile> && CDK_NAG_ENABLED=false npx cdk synth <stack>
```

Catches stack-definition errors offline. Zero AWS calls.

### CDK diff (required for every infra deploy)

Always diff before deploy. The diff between non-prod and prod must match
modulo env vars; any unexpected resource delta is a red flag.

---

## Tenant provisioning (operational shape)

1. Admin submits AdminWeb Create Tenant form → POST `/tenants` on the
   control-plane API with `{ tenantId, tenantName, tier, email, country,
   archetype, useFederation }`.
2. SBT ControlPlane writes registration DDB row → emits
   `sbt_aws_onboardingRequest` to the SBT EventBridge bus.
3. Core-app-plane SBT `ProvisioningScriptJob` runs a CodeBuild job with env
   vars from the event.
4. CodeBuild downloads the source tarball from the provisioning S3 bucket
   (`saas-reference-architecture-ecs-<account>-<region>/source.tar.gz`) —
   this is why [scripts/utils/update-provision-source.sh](scripts/utils/update-provision-source.sh)
   must run before any provision-script change takes effect.
5. CodeBuild runs [provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh)
   → substitutes `service-info.json` → `cdk deploy tenant-template-stack-basic`
   → creates Cognito admin user → creates per-tenant SNS alert topic →
   exports `tenantId / tier / country / archetype`.
6. SBT emits `sbt_aws_provisionSuccess` →
   [tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts)
   writes METADATA + SETTINGS#WORKSPACE rows to the identity DDB with
   archetype-first regional defaults.
7. Admin receives Cognito invite email (template configured in
   [identity-provider.ts](server/lib/tenant-template/identity-provider.ts)).

### Known gotcha — SBT ISSUE-008

SBT's Step Function `Catch` block converts CodeBuild failures to success
events. Provisioning can "succeed" at the Step Function level while the
CodeBuild job actually failed. Mitigation: a CloudWatch alarm on CodeBuild
`FailedBuilds`
([core-appplane-stack.ts:133-144](server/lib/bootstrap-template/core-appplane-stack.ts#L133))
fires SNS to the operator alert topic. Watch the SNS subscription for
provisioning attempts; do not trust the Step Function's green checkmark
alone.

---

## Two orthogonal axes: `status` vs `isActive`

Entities carry **two independent** state axes; don't conflate them:

- **`status`** — the entity *lifecycle* / workflow state (Exam:
  `draft → scheduled → in_progress → closed → published`; ResultCard:
  `draft → published`). Operator-facing, in the response DTO.
- **`isActive`** — a uniform *soft-delete / existence* flag (single-table DDB
  has no hard deletes). `true` = live; `false` = tombstoned. Reads filter
  `isActive !== false`; deletes set it `false`.

A `draft` exam with `isActive:true` is correct — it exists and is not deleted.
Ed-Fi has no `isActive`; it expresses "ended" via association end-dates
(`StudentSchoolAssociation.exitWithdrawDate`), not a boolean.

**Rule (P1d):** `isActive` is an internal concern — **do not emit it in
operator-facing response DTOs.** It stays on the entity and on *filter* schemas
(operators/internal can query by it), but the response Zod schema + mapper omit
it. Soft-deleted rows are already filtered server-side, so the flag carries no
information the client needs. Done for `exam` + `result-card` response DTOs;
the remaining academics response DTOs (course, grading-policy, promotion-rule,
…) are a follow-up sweep.

---

## Shared types convention

Cross-codebase contract types live in `packages/`. One package per shared
domain; never one giant `shared-types` blob.

Active packages:

- [packages/shared-types/](packages/shared-types/) (`@aibrains/shared-types`)
  — **published to npm** (public). Cross-service Zod schemas, Ed-Fi mappers,
  utilities (BS↔AD converter, currency formatter, date formatting),
  archetype-aware tenant locale defaults.
- `@aibrains/pdf-renderer` — also published; JSX-based document templates.
- `@edforge/edfi-ts-models` — TypeScript projections of Ed-Fi v6 JSON
  schemas; license **stays Apache-2.0** because it's a derivative of the
  Ed-Fi Data Standard.
- `@edforge/pilot-fixtures`, `@edforge/tenant-settings-resolver` —
  workspace-only (private).

Rules:

- **AdminWeb may only import from npm-published packages.** The AdminWeb
  CodePipeline rebuild runs `npm install` in an isolated CodeBuild
  environment that cannot see monorepo workspace symlinks; any
  `@edforge/*` workspace-only dependency will fail with a 404 from the
  registry. Backend services + Lambdas are fine because they resolve
  symlinks at local `nest build` / `cdk synth` time.
- If you change a response shape in a service, change it in the shared
  package too — `tsc` fails in consumers if you forget.
- The identity workspace-settings entity duplicates `COUNTRY_DEFAULTS` +
  `ARCHETYPE_DEFAULTS` inline. Canonical source is
  [packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts).
  If you change one, change both.

---

## Archetype model (first-class concept)

EdForge builds for **archetypes** — umbrella operational patterns — not
individual schools.

- `Tenant.archetype` is a first-class field, write-once at provisioning,
  immutable afterward (classified in
  [field-governance.ts](packages/shared-types/src/identity/field-governance.ts)).
- V1 archetype enum: `'PABSON' | 'GENERIC'`. Reserved (type only, not
  runtime-valid): `'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE'`.
- Archetype defaults override country defaults when both are set. For
  example, `PABSON + NPL` resolves to PABSON defaults (NPR currency,
  Asia/Kathmandu timezone, Bikram Sambat calendar, Sun–Fri week,
  south-asian numbers, `ne-NP` locale).
- Regional settings (currency, timezone, calendar, locale, number format,
  week start) live **only** on `WorkspaceSettings` at the tenant level.
  School entities **must not** override them.
- **Don't branch on `country === 'NPL'`** for PABSON-specific logic — branch
  on `archetype === 'PABSON'` so the codebase scales to future archetypes
  without rewrites. **Enforced in CI** (GB1.4) by
  [`scripts/lint/check-no-country-branch.sh`](scripts/lint/check-no-country-branch.sh)
  (workflow `archetype-invariants`): a `country === 'NPL'`-style comparison or
  `case 'NPL':` in `server/application/microservices/**/src/**` (non-spec) fails
  the build. Country-keyed *data* is fine (`NPL:` object keys,
  `COUNTRY_CONFIG_OVERRIDES.NPL`, `getDefaultConfigForCountry('NPL')`) — only the
  equality/switch *branch* is flagged. Escape hatches: a per-line
  `// allow-country-branch: <reason>` marker, or a path suffix in
  `scripts/lint/no-country-branch-allowlist.txt`. Run locally:
  `bash scripts/lint/check-no-country-branch.sh` (and `--self-test`).

---

## School-first architecture

EdForge is built **school-first**: each school carries its own operator-chosen
local grade-level codes (e.g., Saraswati uses `PG`, `NUR`, `LKG`, `UKG`,
`1`–`10`; another PABSON school might use a slightly different local naming
like `Nursery`, `KG-1`, `KG-2`, `Class 1`–`Class 10`). The archetype's
canonical taxonomy (CEHRD `ECD` / `PPC` / `1`–`10` for PABSON) is a
**report-time projection** — applied when generating IEMIS Flash I/II uploads
or any external-reporting payload — *not* a constraint on what an operator
can label their grade levels in the school configuration.

- The school's `enabledGradeLevels` is the source of truth for what operators
  see in the UI and what student records reference internally.
- Alias normalization to canonical descriptors lives in
  [grade-level-descriptor.ts:51,64](packages/shared-types/src/ed-fi/descriptors/grade-level-descriptor.ts#L51).
  `PG`/`NUR` resolve to `ECD`; `LKG`/`UKG` resolve to `PPC`.
- IEMIS Flash I/II generators apply the canonical projection via the
  `schoolGradeToCanonical` transform on grade-level columns
  ([Sprint A.3](docs/platform-hardening/sprint-plan.md)).

**Anti-trap:** don't flag a school's grade-level codes as a regression because
they don't match the archetype's canonical taxonomy. The school's labels are
the design — the canonical projection happens at the reporting boundary, not
in the operator's school configuration. This trap surfaced during the
2026-06-02 first-pilot validation against the PABSON archetype (Saraswati as
catalyst) and is one of the drivers of the V1 platform-hardening plan at
[docs/platform-hardening/sprint-plan.md](docs/platform-hardening/sprint-plan.md).

---

## Bikram Sambat (BS) calendar

A BS↔AD converter already exists:
[packages/shared-types/src/utils/bikram-sambat.ts](packages/shared-types/src/utils/bikram-sambat.ts)
(BS 2000–2090, exported from `@aibrains/shared-types`). Used by the analytics
Lambda and the BsDatePicker UI component.

**Do NOT build a second BS converter.** Import `gregorianToBs` /
`bsToGregorian` from `@aibrains/shared-types`.

---

## Common edit traps

The following are the failure modes that have bitten the team most often.
Every one is captured here because each was discovered the hard way.

### Three-way route registration

Every new API route touches **three** files in lockstep, not one:

1. The NestJS controller method (`@Get / @Post / @Patch / @Delete`
   decorator) — what most engineers think of first.
2. **[server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json)** —
   the API Gateway OpenAPI spec is **hand-maintained**, NOT auto-derived
   from the NestJS controllers. A missing route here gives `403 SigV4` on
   the smoke (because API GW falls through to its IAM auth default rather
   than reaching the Cognito-authed service).
3. **[server/application/reverseproxy/nginx.template](server/application/reverseproxy/nginx.template)**
   — only if the path prefix is **new** (e.g., a new top-level resource
   like `/parents`). Existing prefixes (`/schools`, `/users`, `/tenants`,
   …) auto-cover sub-paths via their `location ~ ^/<prefix>` block. A
   missing route here gives `404` from nginx.

**Symptom diagnosis post-deploy:**

- `403 SigV4` → API GW route missing.
- `404` with `nginx/…` server header → rproxy route missing.
- `404` JSON body from the NestJS service → controller missing or path
  typo'd.

The follow-up route-drift linter in
[scripts/check-route-drift.ts](scripts/check-route-drift.ts) enforces this
at build time; run it before any PR that adds an endpoint.

### Cross-service DDB access needs an IAM grant (sibling of route-drift)

When service code starts reading **another service's table**, the calling
service's ECS task role needs an explicit IAM grant on that table — and the
deploy gate "`cdk diff tenant-template-stack-basic` is EMPTY" becomes a
**false-clear**: the empty diff is *exactly* the gap (it says "no IAM was added"
while the new code path demands one).

Each service's task role in
[tenant-template-stack.ts](server/lib/tenant-template/tenant-template-stack.ts)
(`createTaskRole`) is scoped to its **own** table only (`storage.table.tableArn`).
`TenantMetadataReaderService` (academics) reads the tenant `METADATA` row from
the **identity** table (`edforge-identity-<tier>`) for archetype resolution, so
the academics role carries a minimal extra `dynamodb:GetItem` grant on that
table (`info.name === 'academics'` block). The failure mode is **silent**: the
service's graceful-degradation catch logs WARN and falls back to a no-archetype
shape — no 5xx, just wrong/empty archetype-derived data
(the 2026-06-04 GB2 degraded deploy).

**Rule:** if a PR adds a code path that touches a cross-service DDB resource,
the matching IAM grant on the caller's task role must appear in the
`tenant-template-stack-basic` diff. If the diff is empty, the grant is missing.
Unit tests won't catch it (they mock the reader); only an integration test under
the real task role, or the live smoke, will.

### Workspace-only packages can't ship in Docker-built services

`@edforge/*` packages that are NOT published to npm cannot be consumed by
any Docker-built ECS service. The Dockerfile copies the service's
`package.json` and runs `npm install` in an isolated build environment
that can't see monorepo workspace symlinks. The build will fail with
`TS2305 / TS2741` or `Cannot find module '@edforge/...'`.

**Rules:**

- If a helper needs to be shared with a Docker-built service, either
  inline it or publish the package.
- Lambda functions are unaffected (esbuild bundles them at synth time
  with workspace resolution).
- AdminWeb is also Docker-built (via CodeBuild) and has the same
  constraint — see "Shared types convention" above.

### Bumping `@aibrains/shared-types` minor requires consumer pin bumps in the same PR

npm's `^0.X.0` for 0.x semver means `>=0.X.0 <0.(X+1).0` — so `^0.40.0`
does **not** auto-pick up `0.41.0`. Workspace symlinks make this look like
it works locally, but Docker builds (which copy only
`server/application/package.json` and resolve from the registry) break
with TS2305 / TS2741 errors.

Always update at minimum:

- `server/application/package.json` (gates Dockerfile.identity and
  Dockerfile.academics).
- `server/package.json` (CDK deploy scripts).
- Root `package-lock.json` (refresh via `npm install` at repo root).

AdminWeb / tenant-settings-resolver pins can stay stale unless that
specific consumer needs the new export — bumping them forces a
`controlplane-stack` redeploy that's usually unnecessary.

### Cross-stack export change pre-flight

Renaming or replacing a CDK construct whose `CfnOutput` is `exportName`'d
and imported by another stack triggers
`Cannot update export ... as it is in use by <stack>` at deploy time —
because CFN refuses to mutate an active export.

The `cdk diff` does surface Output deltas, but it does **not** tell you
which Outputs are imported by other stacks. Before any `cdk deploy` of a
stack whose Outputs are exported, audit explicitly:

1. List the stack's exports and snapshot the current resolved values:
   ```bash
   aws cloudformation list-exports \
     --query "Exports[?contains(ExportingStackId, '<stack-name>')].{Name:Name,Value:Value}" \
     > /tmp/exports-before.json
   ```
2. Synth the new template + diff Output values vs the snapshot. For each
   export whose VALUE changes, list its importers via
   `aws cloudformation list-imports --export-name <name>` (capture stdout +
   exit code separately; AWS CLI returns 255 + `ValidationError` when the
   export has no importers — that's the "safe" case).
3. If any export's VALUE will change AND it has importers, the deploy
   **will fail**. Resolve by one of:
   - **(a) Don't trigger the change** — keep the upstream resource's
     property value byte-identical so CFN sees "no change." Safe when the
     property is explicitly set in the template and you can keep the same
     literal. **NOT safe for `AWS::Lambda::Function.FunctionName`** or any
     other "Update requires: Replacement" property where the resource
     previously relied on CFN-generated names.
   - **(b) Decouple via SSM** — move the cross-stack handoff from CFN
     export to SSM Parameter; consumer reads via
     `StringParameter.fromStringParameterName`. 2-PR coordinated migration:
     consumer first switches to SSM, then producer can mutate the export
     safely.
   - **(c) Coordinated multi-stack deploy** — temporarily hardcode the
     value in the importer, deploy producer, then re-link. Use sparingly;
     leaves a hardcoded-value period.

**What CFN's check actually does:** it compares the NEW resolved value to
the deployed value. Same-value updates (e.g., `Fn::Join` template form
change → identical string output) pass. Different-value updates with
active importers are rejected. Same-NAME exports added or removed are not
the trigger — VALUE changes are.

### DDB partition-key convention — bare UUID, not `TENANT#<tid>`

Entity-file comments use logical `TENANT#<tid>` notation; the stored
value is the **bare UUID**. Trust factory functions over file headers
when you need to know the actual stored shape.

### Module wiring invariant

Every NestJS module that consumes shared services must (a) declare those
providers in its own `providers` array and (b) be registered in the
service's `__tests__/module-wiring.spec.ts` watchlist in the **same PR**.
The root `IdentityModule` (and equivalents) does not propagate provider
exports to child modules — relying on root exports is a frequent
silent-DI-failure source. `nest build` passes even when DI is broken;
ECS `services-stable` returns HEALTHY even when the container is
crash-looping on Nest bootstrap. The wiring spec is the only static check
that catches this.

### Route → component, never file-name → component (frontend)

The `edforge-saas-frontend` shell is dense (shell + 4 MFEs + ~10 settings
tabs + deep wizard sub-steps). A file whose name *looks* like the page
you want is **not** evidence that the file is rendered at that URL. The
wrong-file edit is a silent failure: tests pass against direct imports,
PR review can't tell the route binding from a grep result, the bundle
deploys clean, and the operator-facing UI just doesn't change.

This trap has bitten the team at least once (academic-year `isCurrent`
Sprint 2, PR #100 — `school-academic-years.tsx` was edited; the rendered
component at `?tab=academic-setup` was `tabs/AcademicSetupTab.tsx`).

**Required pre-edit trace for any frontend UI change:**

1. **Start at the URL.** `/some/path?tab=X` is the operator's address.
2. **Router → page.** Grep the routing entry. For TanStack Router /
   React Router, search for the path literal or its segment in `routes/`
   or wherever route components are declared.
3. **Page → tab/sub-step.** If the page renders tabs, find the
   conditional that maps `activeTab === 'X'` to a child component. Some
   tabs render different components than their name suggests
   (`?tab=academic-setup` renders `AcademicSetupTab.tsx`, not
   `school-academic-years.tsx`).
4. **Tab → step → sub-component.** Wizard-style tabs nest further. Map
   the `activeStep` switch to the actual JSX you intend to change.
5. **Confirm by reading the parent's render block.** The file you're
   about to edit must appear as a JSX tag in the parent's return.

**Verification gate (do not skip):** for any non-trivial frontend
behavior change, run `npm run dev:shell` (or the relevant `dev:<app>`)
and visually confirm in the browser before declaring done. Type-check
plus tests catch contracts; they do not catch "wrong component
edited." Only a render-path smoke does.

The orphan-file follow-up is also worth noting: if a file looks
abandoned (named for a concept but imported only by its own test),
add a deprecation header pointing to the live component, then delete
on a clean cycle. Don't leave name-collision booby-traps for future
edits.

### Two-repo git hygiene — `cd` before every git invocation

The tenant-facing frontend at `edforge-saas-frontend/` is a **separate
git repository** nested inside the backend repo (not a submodule). Bash
invocations retain `cwd` across calls, so a `cd` from one tool call leaks
into the next.

Three rules:

1. **Every `git` command starts with an explicit `cd <repo-root>` in the
   same invocation.** Even within a chained `&&` line. Backend =
   `cd /Users/<you>/edforge`. Frontend =
   `cd /Users/<you>/edforge/edforge-saas-frontend`. Never rely on
   inherited cwd. A history of wrong-repo commits has resulted from
   ignoring this.
2. **Don't use `git stash` to inspect state.** Stash mutates the worktree
   (and silently picks up untracked files in some flag combos), then you
   have to remember to pop. Use `git diff main`, `git diff main --stat`,
   or `git log main..HEAD --oneline` — all read-only.
3. **Verify branch with `git branch --show-current` immediately before
   every commit.** If the commit lands on the wrong branch, recover with
   `git branch -f <intended-branch> HEAD && git reset --keep HEAD~1 &&
   git checkout <intended-branch>` — non-destructive when there are no
   uncommitted changes.

### Concurrent agents share ONE checkout — branch off remote `main`, isolate in a worktree

**Multiple agents work this project at the same time, against the *same*
on-disk checkout** (`/Users/<you>/edforge` and the nested
`edforge-saas-frontend/`). A sibling agent can `git checkout`, `git pull`,
or `git rebase` the shared working tree **between two of your tool calls** —
moving `HEAD`, clobbering your *uncommitted* edits, or surfacing merge
conflicts that aren't yours. This actually happened (2026-06-27): a parallel
finance rebase switched the frontend repo across three branches mid-task and
transiently wiped an uncommitted feature off disk.

Hard rules — every task, both repos:

1. **Start every task by branching off *remote* `main`, never off the
   current branch.** `HEAD` is not "yours" — it's wherever the last agent
   left it. Do:
   ```bash
   cd <repo-root> && git fetch origin main \
     && git worktree add ../ef-wt-<slug> -b claude/<task-slug> origin/main
   ```
   Never reuse a pre-existing feature branch you didn't create *this* task,
   and never base off local `main` (it may be stale).
2. **Use an isolated `git worktree` for any multi-step change.** A worktree
   has its **own** working directory and `HEAD`, so a sibling agent's branch
   switches/rebases in the shared checkout cannot touch your files. `git
   worktree add` only adds metadata + a ref; it does **not** disturb the
   shared checkout's `HEAD` or working tree, so it's safe to run mid-flight.
   Clean up with `git worktree remove` when the PR is open. (The Agent tool's
   `isolation: "worktree"` does this for spawned agents; do it manually for
   your own work.)
3. **If you must work in the shared checkout, commit early and often** so a
   sibling's checkout can't clobber uncommitted work — and verify
   `git branch --show-current` immediately before **every** git mutation, not
   just before commit.
4. **Collision symptoms → stop:** `HEAD` moves between your commands, files
   you just edited revert to old content, or `UU` (unmerged) paths you didn't
   create appear. If you see these, **do not commit, push, or switch
   branches** (you'll land on the wrong branch or corrupt the sibling's
   rebase). Preserve your work outside the repo (scratchpad), then redo it in
   a fresh worktree off `origin/main`.

### Stacked PRs don't auto-retarget when the parent merges

GitHub leaves `base = sprint/<parent>` on the child PR; if the operator
just clicks "Merge" on the child after the parent merges, it merges into
the (now-stale) parent feature branch instead of `main`. Two ways to
avoid:

1. After each parent merges to `main`, manually retarget every downstream
   child PR: `gh pr edit <child-pr-num> --base main`. Then GitHub
   recomputes the diff against `main` and the child merges cleanly.
2. Or open stacked PRs with `--base main` from the start. The diff will
   include the parent's commits until the parent merges — review noisier,
   but no retargeting needed.

### IAM `AccessDenied` — run the Policy Simulator before any retry/budget loop

When a CDK-deployed Lambda hits `AccessDenied` against an AWS API despite the
inline policy you wrote being syntactically correct, **do not** immediately
reach for a bigger retry budget, a pre-existing role, or an exponential
backoff. Those remedies address exactly one class of `AccessDenied` — IAM
eventual consistency for a *freshly attached* policy — and waste hours if the
real cause is something else.

**The right first diagnostic is `aws iam simulate-principal-policy`** against
the actual deployed role (or `simulate-custom-policy` with a test policy
document). Two definitive outcomes:

- `EvalDecision: implicitDeny` + `MatchedStatements: []` despite your policy
  literally containing the action and the resource ARN → the IAM
  authorization layer does not recognize the action name. Either it's
  documented but not honored at evaluation time (see SES v1 vs v2 below),
  or you have a typo. Switch the action; do not increase any timeout.
- `EvalDecision: allowed` → the role *is* authorized. The failure is
  elsewhere: the resource-based policy on the target resource, the service
  principal scope, an SCP / permissions boundary, or the call site itself.

The simulator does not consume any retry budget and tells the truth in 30
seconds. Use it before any structural change.

**Specific known case — SES IAM action names in `ap-south-1`:** the v1 names
`ses:PutIdentityPolicy` and `ses:DeleteIdentityPolicy` are listed in the AWS
IAM Service Authorization Reference as valid, but the IAM authorization
engine returns `implicitDeny` on them in this region. The v2 names
`ses:CreateEmailIdentityPolicy`, `ses:UpdateEmailIdentityPolicy`, and
`ses:DeleteEmailIdentityPolicy` are honored. Match the SDK accordingly
(`@aws-sdk/client-sesv2`, `CreateEmailIdentityPolicyCommand`, etc.).

### `AwsCustomResource` is a blunt instrument for IAM-sensitive cross-service writes

CDK's `AwsCustomResource` from `aws-cdk-lib/custom-resources` is convenient
for one-off SDK calls during deploy. It has two sharp edges that bite for
anything beyond trivial reads:

1. **No retry on `AccessDenied`.** It can't distinguish a transient IAM
   propagation race from a real permission bug, so it doesn't retry. A
   first-attempt failure is a final failure.
2. **Opaque CDK-generated role with same-deploy inline policy.** The
   construct creates a Lambda role and attaches the SDK-call permissions as
   a separate `AWS::IAM::Policy` resource in the same deploy unit. CFN
   orders them correctly, but IAM data-plane propagation can lag the
   CFN `CREATE_COMPLETE` of the policy — the Lambda's first invocation
   sees stale credentials and hits `AccessDenied`.

When the SDK call needs a write permission you've granted in the same
deploy (e.g., `ses:CreateEmailIdentityPolicy`, `kms:Encrypt`, anything
involving a resource-based policy on a target resource), use the
`Provider` framework from `aws-cdk-lib/custom-resources` with a custom
Lambda you control:

- You choose the SDK package + version (so you can use the v2 SDK + v2
  action names where the v1 ones are unrecognized).
- You implement upsert semantics explicitly (try Create →
  `AlreadyExistsException` → fall back to Update).
- You can retry `AccessDenied` / `ThrottlingException` with exponential
  backoff as defense-in-depth.
- You pass `role: someExistingRole` so CDK doesn't auto-generate a fresh
  one — pair this with the next trap (pre-create the role).

Canonical reference: `server/lib/shared-infra/email-identity.ts`
(`CognitoBasicGrantHandler` + `CognitoBasicGrantProvider` +
`Custom::SesIdentityPolicy` CR).

### Pre-create IAM roles for custom-resource Lambdas — unconditional, with inline policies

When a CDK construct conditionally creates a Lambda + custom resource (e.g.,
behind a feature flag like `CDK_PARAM_SES_ENABLED`), put the Lambda's IAM
role *outside* the conditional. The role is cheap (no runtime cost, no
operational footprint until something assumes it) and enables a safer
deploy pattern:

1. **Flag-OFF deploy:** the construct emits only the IAM role + its inline
   policies. No behavior change anywhere. IAM has time (minutes to hours,
   not seconds) to fully propagate the role globally before any Lambda
   invokes it.
2. **Flag-ON deploy:** the construct emits the Lambda + Provider + CR using
   `role: this.handlerRole` (a stable construct field). CDK does not
   auto-generate a role; the Lambda assumes a role IAM has already settled.

Use `iam.Role` with the `inlinePolicies` parameter, not `addToRolePolicy`.
`inlinePolicies` makes the role + permissions a single atomic
`AWS::IAM::Role` resource — one IAM API call creates both — instead of
two sequential calls (`CreateRole` + `PutRolePolicy`) that each need their
own propagation window. The atomic creation eliminates an entire class of
intra-resource timing race.

This pattern survives flag flip-flopping (rollback drills, A/B reversals)
without recreating the role each time, and makes the same-deploy timing
window predictable instead of unbounded.

Reference: same construct as above. The `cognitoBasicGrantHandlerRole`
public field is created unconditionally; the conditional only gates the
Lambda + Provider + CR that use it.

---

## House rules

- **Don't skip hooks.** `git commit --no-verify` is forbidden unless the
  project owner explicitly asks.
- **Don't amend published commits.** Prefer new commits.
- **Don't run `aws --profile prod ...`** without explicit authorization in
  the current conversation. Prod work goes through the non-prod →
  human-review → prod ladder.
- **Don't modify `.gitignore`** to hide generated artifacts — fix the
  generator instead.
- **Don't widen pins in [Dependency pins](#dependency-pins-that-must-not-drift)**
  above. Any pin upgrade needs an explicit coordinated migration and a
  passing jsdom bundle-sim — never a drive-by bump.
- **Don't `npm audit fix --force`** without reviewing every version change
  it proposes. It has a history (in this repo) of widening pins past the
  bug-fences documented above.
- **Don't delete unfamiliar files / branches / config without
  investigating.** Unexpected state may be the operator's in-progress
  work; investigate before deleting or overwriting.
- **Don't add backwards-compatibility hacks** like renaming unused
  variables to `_var`, re-exporting types unnecessarily, leaving
  `// removed` placeholder comments. If something is unused, delete it
  completely.
- **Default to writing no code comments.** Add a comment only when the
  *why* is non-obvious — a hidden constraint, a subtle invariant, a
  workaround for a specific bug. Don't explain what well-named code
  already says.
- **Match scope to ask.** Don't refactor adjacent code while fixing a bug;
  don't add a helper for one caller; don't design for hypothetical future
  requirements. Three similar lines is better than a premature abstraction.

---

## Documentation map

| When you want… | Read |
|---|---|
| Project framing for evaluators / contributors | [README.md](README.md) |
| Runtime architecture, stack topology, data model, event flow | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Contribution workflow + DCO sign-off requirement | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Responsible disclosure for security issues | [SECURITY.md](SECURITY.md) |
| Licensing terms | [LICENSE](LICENSE) and [NOTICE](NOTICE) |
| Third-party dependency licenses | [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) |
| Trap-by-trap engineering conventions (this file) | here |

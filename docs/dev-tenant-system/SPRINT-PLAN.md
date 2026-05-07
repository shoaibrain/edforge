---
title: EdForge Dev Tenant System — Sprint Plan
status: Approved for execution (post-review)
date: 2026-05-07
owner: shoaib.rain1@gmail.com
---

# EdForge Dev Tenant System — Sprint Plan

## Project goal

Establish a multi-tenant dev tenant system on prod infrastructure. Replaces the just-decommissioned us-east-2 UAT environment with multiple `tenantTag`-isolated tenants on the surviving ap-south-1 prod stack.

Capabilities delivered:
- Multiple persistent dev tenants (PABSON + GENERIC archetypes) for daily R&D
- Ephemeral rehearsal tenants for pre-pilot smoke testing (the user-stated MVP)
- Safe, scripted lifecycle (provision / seed / deprovision) with tag-gated safety
- AdminWeb integration for system-admin tenant management
- Operator dashboard hygiene to keep dev/prod data visually separated

## Architecture decisions (locked — do not relitigate)

| Decision | Choice |
|---|---|
| Tag taxonomy | `'production' \| 'internal-dev' \| 'internal-dev-rehearsal'` |
| Tag mutability | Write-once at provisioning, immutable thereafter |
| Auth model for tenant scoping | Existing JWT + ABAC + tenantId PK (unchanged) |
| Deprovision scope | Full destructive (Cognito group + users, per-tenant SNS, all DDB rows). The shared BASIC tenant pool is preserved. |
| Persistent dev tenant count | 3 (`dev-pabson-primary`, `dev-pabson-spare`, `dev-generic-01`) |
| Email convention | Plus-addressed: `shoaib.dev+<tenant-shortname>-<rotation>@gmail.com` |
| Email rotation | Each cycle uses a fresh `<rotation>` suffix to dodge Cognito tombstones |
| Quarterly reset | Scripted, one-command, target <30 min unattended |
| Pre-pilot gate | Ephemeral rehearsal tenant playbook before any production tenant provisioning |
| Provisioning UI | AdminWeb for both `production` and `internal-dev*` |
| Deprovisioning UI | AdminWeb for `internal-dev*` only; CLI/playbook for `production` |
| Dev/prod isolation | Logical only (same AWS account, region, ECS, DDB) |

## Cross-cutting ground rules

These apply to every task in every sprint:

1. **Pre-merge gates**: typecheck + lint + relevant tests must pass.
2. **Deploy logging**: every state-mutating script tees output to `docs/deploys/` per the repo convention (`<env>-<target>-<timestamp>-<sha>.log`).
3. **Shared-types changes**: bump version, `npm publish`, refresh root lockfile, run jsdom AdminWeb bundle sim **before** any deploy that depends on the new types. CHANGELOG.md entry per release.
4. **CDK changes**: `cdk diff` logged before deploy; the wrapper at `scripts/deploy-analytics.sh` is mandatory.
5. **Destructive scripts**: `--help`, `--dry-run` default, tag-gating, typed-confirmation for `--apply`. Refuse to run against `tenantTag === 'production'` at multiple layers.
6. **Layered defenses**: every destructive code path checks the tag — at the API layer, at the library helper layer, at the CLI orchestrator layer. A bug at any single layer must not be sufficient to touch production data.
7. **Production smoke after every sprint deploy**: existing Saraswati smoke tests (`scripts/smoke-tests/`) must pass.
8. **House rules from CLAUDE.md** still apply (no `--no-verify`, no force-push to main, no widening pinned deps, etc.).

## Sprint roadmap

| # | Sprint | Demoable outcome | Builds on |
|---|---|---|---|
| 0 | Baseline & SBT audit | Resource inventory + PITR confirmation + SBT deprovision flow audit, all in `docs/dev-tenant-system/` | — |
| 1 | Tag schema + backend | Tenant METADATA carries `tenantTag`; Saraswati backfilled to `'production'`; ControlPlane API accepts the field; provisioning flow propagates it end-to-end | 0 |
| 2 | Tag UI in AdminWeb | Operator picks tenantTag in the create-tenant form; tenant list shows colored badges and filter dropdown | 1 |
| 3 | First persistent dev tenants | Three dev tenants (`dev-pabson-primary`, `dev-pabson-spare`, `dev-generic-01`) provisioned via AdminWeb, logged-into, scoping verified | 2 |
| 4 | CLI provision + JWT | `provision.sh` and `jwt.sh` work unattended against the prod ControlPlane API | 3 |
| 5 | CLI deprovision (verifier + gap-filler model) | `deprovision.sh` triggers SBT's existing flow + gap-fills + verifies; refuses production at three layers | 4 |
| 6 | Cycle + seeding | `cycle-all.sh` resets the 3-tenant fleet in <30 min unattended; dev tenants come back fully seeded | 5 |
| 7 | Operator hygiene | Default operator dashboards exclude internal tenants; cost-explorer can isolate dev spend | 1 (tag), 6 |
| 8 | AdminWeb deprovision UI | System-admin can deprovision `internal-dev*` from AdminWeb with typed confirmation | 5 |
| 9 | Pilot onboarding playbook (MVP) | `onboard-pilot.sh` runs full smoke against ephemeral rehearsal tenant; gates real pilot creation | 5, 6 |

**MVP path**: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 9. Sprints 7 and 8 are quality-of-life polish that can ship after MVP.

---

# Sprint 0 — Baseline & SBT Audit

**Goal**: Establish a documented baseline of the existing tenant lifecycle infrastructure before any code change. The plan's biggest risk is misunderstanding what SBT's `DeprovisioningScriptJob` already does; Sprint 0 closes that gap.

**Demoable**: Three reference documents committed to `docs/dev-tenant-system/`. A working manual provisioning + deprovisioning round-trip on a synthetic tenant, with logs.

**Success metric**: Every subsequent sprint references a fact captured in Sprint 0.

## Tasks

### T0.1 — Provision a synthetic baseline tenant manually
- Create throwaway tenant via current AdminWeb (no tenantTag yet — that ships in Sprint 1)
- Capture: tenantId, tenant Cognito group name (within shared pool), per-tenant SNS topic ARN, all DDB rows written (per table)
- Output: `docs/dev-tenant-system/baseline-provision-snapshot.md`
- **Validation**: post-provision DDB query shows METADATA + SETTINGS#WORKSPACE rows; all resource ARNs documented

### T0.2 — Confirm PITR + deletionProtection on every in-scope DDB table
- Tables: identity, academics, finance, analytics, analytics-landing, user-session-events, tenant-mapping
- Run `cdk synth` on `tenant-template-stack-basic`, `analytics-stack`, `shared-infra-stack`; grep for `PointInTimeRecoverySpecification`, `DeletionProtectionEnabled`
- Output: `docs/dev-tenant-system/ddb-recovery-posture.md` with table-by-table evidence
- If any table lacks PITR, add a follow-up task to enable it before Sprint 5 ships
- **Validation**: synth grep output committed; doc reviewed

### T0.3 — Audit existing SBT deprovision flow
- Read `server/lib/provision-scripts/deprovision-tenant.sh` line by line
- Read `server/lib/bootstrap-template/core-appplane-stack.ts:74-174` (DeprovisioningScriptJob wiring)
- Document what SBT's flow already does: Cognito group + users teardown (within shared BASIC pool), identity/academics/finance DDB row deletion
- Status: ✅ COMPLETED — see [sbt-deprovision-coverage.md](sbt-deprovision-coverage.md). Confirmed gaps: analytics tables, per-tenant SNS topic, tenant-mapping registration row (still TBD pending T0.4 dynamic evidence), audit retention.
- Document what SBT's flow does NOT cover: analytics tables, per-tenant SNS topic, audit log retention, tenant-mapping table, anything else
- Output: `docs/dev-tenant-system/sbt-deprovision-coverage.md`
- **Validation**: doc reviewed; gap list informs Sprint 5 design

### T0.4 — Trigger SBT deprovision on the T0.1 tenant; capture full evidence
- Run the existing deprovision flow against the synthetic tenant
- Capture CodeBuild logs, post-deprovision DDB scan (per table), Cognito group state (deleted vs lingering), per-tenant SNS topic state
- Output: `docs/dev-tenant-system/baseline-deprovision-snapshot.md`
- **Validation**: post-state captured; gaps cross-referenced against T0.3

### T0.5 — Confirm Cognito tenant pool model (per-tenant vs shared)
- Read `server/lib/tenant-template/identity-provider.ts:20`
- **Audit result (COMPLETED 2026-05-07)**: BASIC tier uses **one shared Cognito UserPool** with **per-tenant groups** (not per-tenant pools). The `IdentityProvider` construct is instantiated once per tier-stack, and `tenant-template-stack-basic` is shared across all BASIC tenants. Deprovision = delete users in the tenant's group + delete the group; pool is preserved.
- Output: documented in [sbt-deprovision-coverage.md](sbt-deprovision-coverage.md)
- **Validation**: doc references the source line ✅

### T0.6 — Inventory CodeBuild concurrency limits
- **Audit result (COMPLETED 2026-05-07)**: SBT projects use `BUILD_GENERAL1_SMALL` (Linux/Small) with `concurrentBuildLimit` unset; account-level quota is **60 concurrent Linux/Small builds**. Parallel cycle of 3 dev tenants is unconstrained.
- Output: documented in [baseline-provision-snapshot.md](baseline-provision-snapshot.md)
- **Validation**: ✅ — Sprint 6 `cycle-all.sh` parallel risk is closed

## Risks
- T0.1 / T0.4 require a real provisioning round-trip on prod infra; budget ~30 min total of CodeBuild time. Cost ~$0.10.

## Rollback
- T0.4 deprovisioning is the rollback (cleans up the T0.1 baseline tenant). If T0.4 reveals SBT job bugs, document and proceed (Sprint 5 will fix gaps).

## Sprint 0 — REVISION 2026-05-07

**T0.1 + T0.4 superseded by Sprint 0.5 below.** Instead of synthesizing a baseline tenant, the 3 existing test tenants in prod (`usbasicfoundationtenant`, `rainshoaiborg`, `prodtestadmin`) become the live fixture. Cleaning them up yields:
- 3 reps of "what does SBT cover vs miss" → live evidence × 3 for Sprint 5 design
- A clean prod state (Saraswati only) → Sprint 1 backfill becomes a single-row UpdateItem
- A working prototype of the gap-fill scripts → Sprint 5 productizes them

---

# Sprint 0.5 — Test Tenant Cleanup (Sprint 5 Dress Rehearsal)

**Goal**: Clean state for Sprint 1 by deprovisioning the 3 test tenants currently in prod. Use existing SBT flow + a one-shot ops gap-fill script (4-piece split, productized into Sprint 5 later). End state: prod has only Saraswati.

**Saraswati's tenantId is hardcoded as a refuse-list constant in every destructive script.** The pilot is mechanically protected from any of this work.

**Demoable**: Final scan of all 7 in-scope DDB tables shows zero rows where tenantId is one of the 3 test tenant UUIDs. SNS topics for the 3 are gone. Cognito groups for the 3 are gone. Saraswati's data is unchanged.

## Tasks

### T0.7 — Read-only snapshot of all 3 test tenants
- For each test tenantId, query/scan all 7 in-scope DDB tables; count rows per table
- List Cognito users in each tenant's group (shared pool: `ap-south-1_spYeNvNJt`)
- List per-tenant SNS topics (pattern: `edforge-tenant-<tenantId>-alerts`)
- Output: `docs/dev-tenant-system/cleanup-snapshots/<tenantName>-pre-cleanup.md` × 3
- **Validation**: 3 inventory docs committed; row counts captured

### T0.8 — SBT deprovision on `usbasicfoundationtenant` first (lowest risk)
- Tenant: `34392ed6-2e51-4fc8-ae2c-242eb5710e40` (GENERIC, USA — different archetype than Saraswati)
- Trigger via existing ControlPlane API (or AdminWeb if accessible)
- Capture: CodeBuild build ID, log URL, wall-clock duration, post-state DDB scan
- Output: appended to `usbasicfoundationtenant-cleanup.md`
- **Validation**: SBT job reports success; orphan rows identified for gap-fill

### T0.9a — DDB row sweep across 5 tenant-data tables (REVISED post-T0.8)
- `scripts/cleanup-orphans/sweep-tenant-rows.ts`
- **Tables in scope** (defensive: do NOT trust SBT covered identity/academics/finance — T0.8 confirmed bug):
  - `edforge-identity-basic` (PK=tenantId)
  - `edforge-academics-basic` (PK=tenantId)
  - `edforge-finance-basic` (PK=tenantId)
  - `edforge-analytics` (PK=`TENANT#<tenantId>`)
  - `edforge-analytics-landing` (Scan with `contains(rawEvent, :tid)`)
- For each: Query/Scan → list of (PK, SK) → BatchWriteItem delete in chunks of 25 with retry
- Saraswati refuse-list constant: `34f49822-ae1d-4188-95f0-04e14bc6c662`
- Whitelist of allowed argv tenantIds: 3 test tenants only
- Dry-run default; `--apply` to mutate
- **Validation**: integration test on `usbasic…` survivors after T0.8 → all 5 tables zero rows

### T0.9b — Per-tenant SNS topic deletion script
- `scripts/cleanup-orphans/sweep-sns-topic.ts`
- Looks up topic ARN from METADATA (`alertTopicArn`) or by name pattern
- Deletes topic + subscriptions
- Idempotent (silently passes if topic doesn't exist)
- Saraswati refuse-list constant
- **Validation**: integration test — topic deleted; idempotent on re-run

### T0.9c — SBT control plane row state verifier (REVISED post-T0.8)
- T0.8 confirmed: SBT marks both control plane rows with `sbtaws_active: false` + `registrationStatus: "Deleted"` and PRESERVES them as audit history. **Do not delete these rows.**
- Script: `scripts/cleanup-orphans/verify-sbt-state.ts` — read-only verifier
- Confirms: tenantManagementTable row exists with `sbtaws_active=false`; tenantRegistrationTable row exists with `sbtaws_active=false` AND `registrationStatus="Deleted"`
- If either flag is missing/wrong: error (operator must investigate; SBT job didn't complete cleanly)
- **Validation**: passes against `usbasic…` post-T0.8

### T0.9d — Orchestrator composing 0.9a-c
- `scripts/cleanup-orphans/cleanup-test-tenant.sh`
- Args: `<tenantId> [--apply]`
- Hard-fails if tenantId === Saraswati's UUID (CLI-layer defense matching the script-layer refuse-list)
- Hard-fails if tenantId is not in the known test-tenant list (whitelist not blacklist)
- Default dry-run; typed-confirmation on `--apply`
- Calls T0.9a, T0.9b, T0.9c in sequence
- Tee output to `docs/deploys/`
- **Validation**: end-to-end test on `usbasic...` after T0.8

### T0.10 — Apply gap-fill to `usbasicfoundationtenant`
- Run `cleanup-test-tenant.sh 34392ed6-2e51-4fc8-ae2c-242eb5710e40 --apply`
- Verify: scan all in-scope tables → zero rows for that tenantId
- Verify: SNS topic gone; Cognito group gone; tenant-mapping row gone
- **Validation**: cleanup log + verification scan in `docs/deploys/`

### T0.11 — Cleanup `rainshoaiborg`
- Tenant: `fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7` (PABSON, NPL)
- Same flow: SBT deprovision → cleanup-test-tenant.sh
- **Validation**: cleanup log

### T0.12 — Cleanup `prodtestadmin`
- Tenant: `04ce4a00-c39a-4185-afd4-6e764ef44647` (PABSON, NPL)
- Same flow
- **Validation**: cleanup log

### T0.13 — Final state verification
- Scan all 7 in-scope DDB tables for distinct tenantId values
- Should find only Saraswati's UUID
- List all Cognito groups in shared pool — only Saraswati's group should remain
- List all SNS topics matching `edforge-tenant-*-alerts` — only Saraswati's should remain
- Output: `docs/dev-tenant-system/post-cleanup-state.md`
- **Validation**: clean state confirmed; Sprint 1 unblocked

## Sprint 0.5 Risks
- **SBT deprovision unknown surface area**: T0.8 is the first time this flow runs against real tenant data in prod. Possible surprises (Cognito tombstones, SBT registration cleanup behavior, edge cases in `delete_items_if_exists` for large tables). Lowest-risk tenant first (`usbasic` GENERIC) limits blast.
- **Orphans not deleted by gap-fill**: if T0.7 inventory misses a resource type, that resource could orphan permanently. Mitigation: T0.13 final scan includes all resource types we've identified.
- **Saraswati protection**: refuse-list constant + whitelist (not blacklist) of allowed tenantIds. Two layers; both code-enforced.

## Sprint 0.5 Rollback
- DDB rows: PITR (35-day window) — confirmed in T0.2
- Cognito users: cannot be undeleted; would need re-invitation. Test tenants are throwaway, so acceptable.
- SNS topic: re-create if needed; subscription history lost. Acceptable for test tenants.
- Tenant-mapping row: can be re-created via SBT registration if needed.

---

# Sprint 1 — Tag Schema + Backend

**Goal**: Every tenant in the system carries a `tenantTag`. Saraswati is backfilled to `'production'`. ControlPlane API accepts and persists the field. Provisioning flow propagates it end-to-end. **No AdminWeb UI changes yet** — those are Sprint 2.

**Demoable**: 
- `curl -X POST .../tenants` with tenantTag in body creates a tenant with the tag stored in METADATA
- `aws dynamodb get-item` on Saraswati METADATA shows tenantTag=`'production'`
- Field-governance unit test rejects PATCH that includes tenantTag

**Success metric**: All tenants in METADATA have tenantTag; immutability enforced.

## Tasks

### T1.1 — Add `tenantTag` enum to shared-types Tenant schema
- Edit `packages/shared-types/src/schemas/identity/tenant.ts` (or canonical location)
- Zod: `z.enum(['production', 'internal-dev', 'internal-dev-rehearsal']).default('production')`
- Update Tenant TS type
- **Validation**: unit tests parse each value, reject invalid values, default applies

### T1.2 — Mark `tenantTag` immutable in field-governance
- Edit `packages/shared-types/src/identity/field-governance.ts`
- Add to immutable fields registry
- **Validation**: unit test — governance rejects PATCH containing tenantTag with `IMMUTABLE_FIELD` error code

### T1.3 — Add CHANGELOG entry + bump shared-types version
- Bump to next minor (e.g., `0.39.0`)
- Add `CHANGELOG.md` entry describing the new export
- **Validation**: package.json version bumped; CHANGELOG includes the entry

### T1.4 — Publish shared-types to npm + refresh lockfile
- `cd packages/shared-types && npm publish`
- Verify `npm view @aibrains/shared-types version`
- `npm install` at repo root to refresh package-lock.json
- **Validation**: registry confirms new version; lockfile committed

### T1.5 — Update tenant-seeder Lambda to write tenantTag to METADATA
- Edit `server/lib/bootstrap-template/tenant-seeder-lambda.ts`
- Read tenantTag from event payload, default `'production'` if missing
- Write to METADATA row alongside existing fields
- **Validation**: Lambda unit test — for each input tenantTag value, METADATA write contains the right tag

### T1.6 — Update ControlPlane API POST /tenants to accept tenantTag
- DTO update + controller update + service update
- Pass through to SBT EventBridge event payload
- Default `'production'` server-side if request omits it
- **Validation**: e2e test — POST with each tenantTag value; default applied when omitted; invalid values rejected with 400

### T1.7 — Update `provision-tenant.sh` to read TENANT_TAG env var
- Edit `server/lib/provision-scripts/provision-tenant.sh`
- Read `TENANT_TAG` env var (set by SBT from event), log it
- Pass through to subsequent stages via env or output if needed
- **Validation**: provision a tenant; grep CodeBuild logs for `TENANT_TAG=`

### T1.8 — Upload updated provision-tenant.sh source via update-provision-source
- Run `scripts/utils/update-provision-source.sh`
- Verify `source.tar.gz` in S3 contains the new script
- **Validation**: `aws s3 cp` then `tar tzf` shows the updated content

### T1.9 — Backfill script for existing tenants
- New: `scripts/backfill/tenant-tag.ts`
- Scans METADATA rows; sets `tenantTag='production'` where missing
- Idempotent (skip rows that already have it)
- Dry-run default; `--apply` to mutate
- Tee to `docs/deploys/`
- **Validation**: integration test — runs against synthetic tenants, asserts only missing-tag rows updated

### T1.10 — Run backfill on prod (Saraswati)
- Dry-run, log to `docs/deploys/`
- Operator review
- `--apply`, log
- **Validation**: `aws dynamodb get-item` shows `tenantTag='production'` on Saraswati METADATA; deploy log captured

### T1.11 — Deploy controlplane-stack (re-bundles tenant-seeder Lambda)
- jsdom AdminWeb bundle sim (CLAUDE.md ground rule — even though no AdminWeb code changed, controlplane redeploy re-bundles AdminWeb)
- `./scripts/deploy-analytics.sh controlplane-stack prod`
- Verify CodePipeline succeeded
- **Validation**: deploy log; CodePipeline `Succeeded`

### T1.12 — Deploy core-appplane-stack (picks up provision-tenant.sh changes)
- `./scripts/deploy-analytics.sh core-appplane-stack prod`
- **Validation**: deploy log; cdk diff before deploy

### T1.13 — Identity service ECR push + ECS roll
- `./scripts/build-application.sh identity` (publishes new shared-types consumer)
- ECS update-service for `identitybasic` (ap-south-1)
- Wait for stable
- **Validation**: smoke — POST `/tenants` via curl with `tenantTag='internal-dev'`, verify METADATA row

### T1.14 — End-to-end backend validation
- Provision throwaway test tenant via curl with each tag value (`'production'`, `'internal-dev'`, `'internal-dev-rehearsal'`)
- Verify METADATA in each
- Manual cleanup via existing SBT deprovision (Sprint 5 will automate)
- Saraswati smoke regression check
- **Validation**: validation log in `docs/deploys/`

## Risks
- Backfill on prod runs against the only real tenant (Saraswati). Dry-run first; review before apply.
- AdminWeb publish gate must complete before T1.11 — even though the AdminWeb form hasn't changed yet, the controlplane redeploy bundles AdminWeb source.

## Rollback
- Code: revert PR, redeploy controlplane-stack + core-appplane-stack
- Backfill correction: tenantTag is immutable per field-governance; correction requires a one-shot ops script that emits a `TENANT_TAG_OPS_OVERRIDE` audit event. Requires explicit operator approval per house rules.

---

# Sprint 2 — Tag UI in AdminWeb

**Goal**: System-admin operator can choose tenantTag from the AdminWeb create-tenant form. Tenant list shows colored badges with a filter dropdown.

**Demoable**: 
- Open AdminWeb create-tenant form, see tenantTag dropdown defaulting to `'internal-dev'`
- Picking `'production'` shows an inline confirmation gate
- Submit form, see new tenant in list with colored badge
- Filter dropdown switches between All / Production only / Internal only

**Success metric**: AdminWeb tenant lifecycle UX matches the new mental model; no operator can accidentally tag a dev tenant production.

## Tasks

### T2.1 — AdminWeb create-tenant form: tenantTag dropdown
- Update `TenantCreateForm` component
- Options: `'internal-dev'` (default), `'internal-dev-rehearsal'`, `'production'`
- Form submission carries tenantTag
- **Validation**: RTL test — form renders with each option; submission carries tag

### T2.2 — Production-tag confirmation gate
- When operator selects `'production'`, render an inline warning: "This tag is immutable. You will not be able to delete this tenant via AdminWeb."
- Require an extra checkbox "I understand" before form is submittable
- **Validation**: RTL test — submit blocked unless checkbox confirmed; warning text present

### T2.3 — AdminWeb tenant list: tenantTag badge column
- Add badge column to tenant list
- Color-coded (e.g., green=`production`, blue=`internal-dev`, yellow=`internal-dev-rehearsal`)
- **Validation**: snapshot test — list renders with each tag value

### T2.4 — AdminWeb tenant list: filter dropdown
- Filter: All / Production only / Internal only (default Production only — operator's day-to-day view should not be cluttered with dev noise)
- URL state persisted (querystring)
- **Validation**: RTL test — filter narrows displayed rows; URL updates

### T2.5 — AdminWeb tenant detail page: tenantTag display
- Prominently display tenantTag with the same color-coded badge
- For `'production'` tenants, indicate "Read-only via UI" (the delete button will only appear for internal-dev* in Sprint 8)
- **Validation**: snapshot test

### T2.6 — Deploy controlplane-stack (rebuilds AdminWeb)
- jsdom bundle sim (CLAUDE.md hard gate)
- `./scripts/deploy-analytics.sh controlplane-stack prod`
- Verify CodePipeline succeeded; sanity-curl the bundle for the new dropdown text
- **Validation**: deploy log; live UI tested

### T2.7 — End-to-end UI validation
- Open AdminWeb, exercise form with each tag value
- Provision throwaway tenants (cleanup via existing SBT deprovision)
- Saraswati smoke regression check
- **Validation**: validation log + screenshots in `docs/deploys/`

## Risks
- AdminWeb publish-gate: workspace-only packages still break CodeBuild — verify no new workspace-only imports were introduced (CLAUDE.md gotcha).

## Rollback
- Revert PR; redeploy controlplane-stack. Backend (Sprint 1) remains live and working without UI.

---

# Sprint 3 — First Persistent Dev Tenants

**Goal**: Three persistent dev tenants exist on prod infra, each manually provisioned via AdminWeb. Each has been logged into to confirm Cognito, archetype defaults, and tenant scoping work.

**Demoable**:
- AdminWeb tenant list shows 4 tenants: Saraswati (`production`) + 3 dev tenants (`internal-dev`)
- Log into `dev-pabson-primary`, see PABSON-specific defaults (NPR currency, BS calendar widgets)
- Confirm Saraswati data is invisible from a dev-tenant session

**Success metric**: 3 dev tenants live, logged-in, archetype defaults verified, scoping verified.

## Tasks

### T3.1 — Document dev tenant roster
- `docs/dev-tenant-system/roster.md` — tenantId, archetype, country, email, purpose for each
- Include the email-rotation convention: `shoaib.dev+<tenant-shortname>-<rotation>@gmail.com` where rotation is bumped each cycle (e.g., `q2-2026`)
- **Validation**: doc reviewed

### T3.2 — Provision `dev-pabson-primary` via AdminWeb
- tag=`'internal-dev'`, archetype=`'PABSON'`, country=`'NPL'`, email=`shoaib.dev+pabson1-q2-2026@gmail.com`
- Receive Cognito invite; set password; log in
- Verify regional defaults: NPR currency, ne-NP locale, Bikram Sambat calendar, Sun-Fri week
- **Validation**: provision log in `docs/deploys/`; screenshot of tenant home

### T3.3 — Provision `dev-pabson-spare` via AdminWeb
- Same as T3.2 with different tenantId/email
- **Validation**: provision log

### T3.4 — Provision `dev-generic-01` via AdminWeb
- tag=`'internal-dev'`, archetype=`'GENERIC'`, country=`'USA'`, email=`shoaib.dev+generic-q2-2026@gmail.com`
- **Validation**: provision log; verify GENERIC archetype defaults applied (USD, en-US, Gregorian, Mon-Fri week — or whatever GENERIC ships with)

### T3.5 — Tenant-scoping smoke
- From `dev-pabson-primary` session, attempt to query Saraswati's school IDs (using a known Saraswati schoolId)
- Expect empty result or 403
- Same check from `dev-generic-01` against `dev-pabson-primary` (cross-dev-tenant isolation)
- **Validation**: smoke output captured in deploy log

### T3.6 — Document the manual provisioning runbook
- `docs/dev-tenant-system/manual-provisioning-runbook.md`
- Step-by-step with expected wait times (CodeBuild ~5–10 min)
- Note that Sprint 4 replaces this with a scripted flow; runbook is fallback
- **Validation**: doc reviewed

## Risks
- Cognito email delivery — Gmail filters Cognito invites occasionally; check spam if invite doesn't arrive in 5 min.
- SBT ISSUE-008 (CodeBuild fail vs Step Function success) — watch the CodeBuild alarm in `prod-basic` cluster.

## Rollback
- Tenant problems: deprovision via existing SBT flow (`deprovision-tenant.sh`); accept gaps until Sprint 5 ships gap-fillers.

---

# Sprint 4 — CLI Provision + JWT Helper

**Goal**: Provision a new dev tenant from CLI in <5 min walked away. Get a fresh JWT for any dev tenant via CLI in <2 seconds.

**Demoable**:
- `./scripts/dev-tenant/provision.sh dev-test-temp PABSON shoaib.dev+temp-q2-2026@gmail.com` provisions a tenant, polls until ready, prints credentials
- `./scripts/dev-tenant/jwt.sh dev-pabson-primary` outputs a fresh ID token (cached if not expired)

**Success metric**: provision.sh completes unattended; jwt.sh returns a token in <2s warm.

## Tasks

### T4.1 — Confirm ControlPlane API auth model (read-only research)
- Per `server/lib/bootstrap-template/control-plane-stack.ts:27,41`: `sbt.CognitoAuth` is the auth backend → system-admin Cognito SRP
- Document the SRP flow + verify with a manual `curl` example
- Update `scripts/dev-tenant/README.md` with the working curl
- **Validation**: working curl committed

### T4.2 — Decide: separate `cli-system-admin` Cognito user
- Recommendation: provision a dedicated `cli-system-admin@<domain>` user in the system-admin pool, separate from operator's day-to-day login
- Reason: a script outage / credential rotation doesn't lock operator out of AdminWeb
- Document in `scripts/dev-tenant/README.md`
- **Open for user confirmation** — see decisions log at end of plan
- **Validation**: doc + provisioned user (or rationale for sharing if user prefers)

### T4.3 — `scripts/dev-tenant/lib/cognito-srp.ts`
- TypeScript wrapper around `amazon-cognito-identity-js` (or equivalent established library — avoid hand-rolling SRP)
- Inputs: poolId, clientId, username, password
- Output: `{ idToken, accessToken, refreshToken, expiresAt }`
- **Validation**: integration test against system-admin pool with known good credentials

### T4.4 — `scripts/dev-tenant/lib/control-plane-client.ts`
- Typed client: `createTenant`, `getTenant`, `listTenants`, `deleteTenant` (used Sprint 5)
- Auth: takes JWT
- **Validation**: contract tests against a mock server

### T4.5 — `scripts/dev-tenant/lib/credential-store.ts`
- Reads from `.env.dev-tenant` (gitignored) OR shells out to `op` (1Password CLI)
- Returns credentials by tenantId or `'system-admin'`
- **Validation**: unit tests for both backends

### T4.6 — `scripts/dev-tenant/provision.sh`
- Args: `<tenantId> <archetype> <email> [--country=NPL] [--tag=internal-dev]`
- Reads system-admin creds via credential-store
- SRP login; POST `/tenants` with tenantTag
- Polls GET `/tenants/:tenantId` until provisioning state = SUCCESS or 15-min timeout
- On timeout: surfaces SBT Step Function execution ARN + CodeBuild project; exit nonzero
- Tee output to `docs/deploys/`
- **Validation**: integration test against a throwaway tenant (cleanup via Sprint 5 once shipped, or manual SBT deprovision until then)

### T4.7 — `scripts/dev-tenant/jwt.sh`
- Args: `<tenantId> [--user <email>] [--access-token]`
- Reads tenant-user creds via credential-store
- SRP login for the per-tenant pool; output ID token
- JWT cache: `~/.edforge/dev-tenant-jwts/<tenantId>.json` (chmod 600 enforced)
- Cache hit if token expiry > 5 min away
- **Validation**: integration test — fresh token + cache hit + cache miss + expiry path

### T4.8 — Document credential management
- `scripts/dev-tenant/README.md` — `.env.dev-tenant` schema + 1Password CLI integration recipe
- Include `.env.dev-tenant.example` (no real creds)
- **Validation**: doc + example file committed

### T4.9 — End-to-end validation
- provision.sh creates a temp tenant
- jwt.sh gets a token for it
- curl makes an authenticated API call (e.g., GET /me) and succeeds
- Saraswati smoke regression check
- **Validation**: validation log

## Risks
- ControlPlane API auth surprises (despite T4.1 baseline)
- SRP lib choice: prefer `amazon-cognito-identity-js`; do not hand-roll

## Rollback
- Code-only sprint; revert PRs if needed.
- Dev tenants created during validation can be removed via existing SBT deprovision until Sprint 5 ships.

---

# Sprint 5 — CLI Deprovision (Verifier + Gap-Filler) — CRITICAL SAFETY SPRINT

**Goal**: Safely deprovision an `internal-dev*` tenant from CLI. The CLI does NOT re-implement what SBT's `DeprovisioningScriptJob` already does — it triggers SBT, then verifies the result, then fills documented gaps (analytics tables, SNS topic, tenant-mapping registration, audit retention). Production tenants are mechanically refused at three layers.

**Architecture (post-Sprint 0 audit)**:
- SBT's existing `deprovision-tenant.sh` already deletes the tenant's Cognito users + group (within the shared BASIC pool — pool is preserved across tenants) and DDB rows in identity / academics / finance (verified in Sprint 0 T0.3; live evidence from T0.4 will confirm tenant-mapping coverage)
- Gap-fillers needed for: analytics tables (analytics, analytics-landing, user-session-events), per-tenant SNS topic, tenant-mapping registration row (status pending T0.4), audit log retention policy
- The CLI is a **trigger + verifier + gap-filler**, not a parallel deleter

**Demoable**:
- `./scripts/dev-tenant/deprovision.sh dev-test-temp` (default dry-run): prints expected delete counts per gap-fill table
- `./scripts/dev-tenant/deprovision.sh dev-test-temp --apply`: typed-confirms tenantId; triggers SBT; polls; fills gaps; verifies; exits 0 with zero orphan rows
- `./scripts/dev-tenant/deprovision.sh saraswati-prod-tenant --apply`: refused with `tenantTag is 'production'` error from the API layer (and CLI layer if API is bypassed)

**Success metric**: After deprovision, `verify-cleanup.sh` reports 0 rows for any in-scope DDB table; tenant Cognito group gone (pool preserved); per-tenant SNS topic gone.

## Tasks

### Phase 5A — Read-only foundations (safe to ship/demo without destruction)

#### T5.1 — `scripts/dev-tenant/lib/tenant-tag-guard.ts`
- `getTenantTag(tenantId)`: reads METADATA row, returns tenantTag (caches per-process)
- `assertNotProduction(tenantId)`: throws `ProductionTagViolation` on `'production'` or unknown
- **Validation**: unit + integration tests against real tenants — Saraswati throws; dev tenants pass; non-existent tenant throws

#### T5.2 — Per-tenant resource scanner
- `scripts/dev-tenant/lib/ddb-cleanup.ts` (read-only mode)
- `scanTenantRows(tenantId)` → `{ tableName, pkPattern, count }[]`
- Walks every in-scope table identified in T0.3 (gap-fill set: analytics, analytics-landing, user-session-events, tenant-mapping; plus identity/academics/finance for verification that SBT cleaned up)
- Uses Query (PK begins_with) where possible
- `--strict` mode: full Scan with FilterExpression to detect orphans whose PK doesn't match `<tenantId>` patterns
- **Validation**: integration test against a seeded tenant; counts match expectations; strict mode catches a deliberately-malformed orphan row

#### T5.3 — `scripts/dev-tenant/verify-cleanup.sh`
- Calls scanner; reports nonzero counts as orphans
- Exit 0 if clean, nonzero if dirty
- Output: tabular summary per table
- **Validation**: against a known-clean (deprovisioned) and known-dirty (active dev) tenant

#### T5.4 — Document SBT-coverage gap matrix
- `docs/dev-tenant-system/gap-matrix.md`
- For every in-scope table/resource, two columns: "covered by SBT?" + "gap-fill task ID"
- Output drives Phase 5B task list
- **Validation**: doc reviewed; gap-fill tasks below cite this matrix

### Phase 5B — Gap-fill operations (destructive, layered defenses)

#### T5.5 — Analytics-tables row deleter
- `scripts/dev-tenant/lib/analytics-cleanup.ts`
- `deleteTenantAnalyticsRows(tenantId, options: { dryRun: boolean })`
- BatchWriteItem in chunks of 25; retries `UnprocessedItems` with exp backoff
- **Tag-gating: refuses to proceed unless `assertNotProduction(tenantId)` passes** (defense in depth — even though API will reject, the function itself rejects too)
- **Validation**: integration test on throwaway — counts before/after

#### T5.6 — Per-tenant SNS topic deleter
- `scripts/dev-tenant/lib/sns-cleanup.ts`
- `deleteTenantSnsTopic(tenantId)` — derive ARN by name pattern, delete topic + subscriptions
- Idempotent (silently passes if topic doesn't exist)
- Tag-gated
- **Validation**: integration test

#### T5.7 — Tenant-mapping table cleanup
- If T0.3 confirmed SBT cleans this, this task is a no-op verifier
- Else: implement deleter for the tenant-mapping registration row
- Tag-gated
- **Validation**: integration test or no-op verifier

#### T5.8 — Audit log retention policy
- After deprovision, audit log entries for the deprovisioned tenant should be retained for N days, then purged
- Decision: keep 30 days (operational forensics window); purge via TTL on the audit table
- If audit table doesn't have TTL: add to ecs-dynamodb.ts; needs CDK deploy
- **Validation**: schema check — audit table has TTL on the right attribute

#### T5.9 — ControlPlane API DELETE /tenants/:tenantId
- New endpoint; system-admin auth (existing)
- **Tag-gating**: 403 if METADATA tenantTag === `'production'` with structured error response
- Triggers SBT `DeprovisioningScriptJob` via EventBridge
- Returns 202 with jobId
- Emits `AUDIT_TENANT_DEPROVISION_REQUESTED` event
- **Validation**: e2e — internal-dev returns 200; production returns 403 with structured error

#### T5.10 — Lifecycle status endpoint
- GET `/tenants/:tenantId/lifecycle-status` returns `{ status, progress, errors[] }`
- Used by CLI poll + Sprint 8 UI
- **Validation**: e2e — status reflects SBT job phase

#### T5.11 — `scripts/dev-tenant/deprovision.sh` orchestrator
- Args: `<tenantId> [--apply] [--keep-on-failure]`
- Default: dry-run
- Steps:
  1. `assertNotProduction(tenantId)` — hard-fail (CLI-layer defense)
  2. Run scanner (read-only); print expected delete counts per gap-fill table
  3. If `--apply`: prompt for typed-confirmation of tenantId
  4. Call DELETE `/tenants/:tenantId`; capture jobId (API-layer defense will also reject if production)
  5. Poll lifecycle-status until SBT job finishes (default timeout 15 min, configurable via `--sbt-timeout`)
  6. On timeout: print SBT execution ARN + CodeBuild project; exit nonzero. Do NOT proceed to gap-fillers.
  7. Run analytics-tables row deleter
  8. Run SNS topic deleter
  9. Run tenant-mapping verifier (or deleter per T5.7)
  10. Run `verify-cleanup.sh`; hard-fail on orphans
- Tee output to `docs/deploys/`
- `--keep-on-failure`: skip gap-fillers if SBT job failed; useful for forensic debugging
- **Validation**: integration test — provision throwaway via Sprint 4 → deprovision → verify zero rows

#### T5.12 — Audit log emission for full lifecycle
- Events: `TENANT_DEPROVISION_REQUESTED`, `TENANT_SBT_JOB_COMPLETED`, `TENANT_ANALYTICS_ROWS_DELETED`, `TENANT_SNS_DELETED`, `TENANT_DEPROVISION_VERIFIED`, `TENANT_DEPROVISION_COMPLETED`, `TENANT_DEPROVISION_FAILED`
- **Validation**: e2e — verify events appear in audit log table after deprovision

#### T5.13 — Backout drill (T+1 sanity test)
- On a freshly-provisioned throwaway tenant, simulate a partial deprovision: kill the script after step 4 (SBT triggered) but before step 7 (gap-fillers)
- Verify:
  - (a) `verify-cleanup.sh` correctly reports orphans
  - (b) re-running deprovision is idempotent (gap-fillers complete cleanly)
  - (c) audit log shows partial state
- Document recovery in `docs/dev-tenant-system/deprovision-recovery-runbook.md`
- **Validation**: drill log + runbook

#### T5.14 — End-to-end validation
- Provision throwaway tenant via Sprint 4 provision.sh
- Run deprovision --dry-run; verify counts match seeded data
- Run deprovision --apply; verify zero orphans; verify audit log entries
- Attempt deprovision against Saraswati (--dry-run!); verify production-refusal at API and CLI layers
- Saraswati smoke regression check
- **Validation**: validation log

## Risks
- SBT job may not actually clean SBT registration row — Sprint 0 T0.3 / T0.4 should expose this; T5.7 either no-ops or fills the gap.
- Layered tag-gating must be airtight — defense in depth: helper library + CLI + API.
- Re-provisioning a previously-deprovisioned tenantId (Cognito tombstone) — verify in T5.14; document workaround if it surfaces (use rotated email per roster convention).

## Rollback
- Tables have RemovalPolicy.RETAIN + deletionProtection (Sprint 2 of infra-sunset). Tables cannot be lost.
- Row-level recovery: PITR (verified in Sprint 0 T0.2). Restore-to-table or export-restore workflow documented in `docs/dev-tenant-system/deprovision-recovery-runbook.md` (T5.13).
- If a production tenant is mistakenly deprovisioned (which the three-layer defense should prevent): immediate PITR restore; audit log + post-mortem mandatory.

---

# Sprint 6 — Cycle + Seeding

**Goal**: One-command quarterly reset for the full dev tenant fleet. Seeds tenants with realistic minimum-viable state.

**Demoable**:
- `./scripts/dev-tenant/cycle-all.sh` rebuilds all 3 persistent dev tenants in parallel (concurrency confirmed safe by Sprint 0 T0.6)
- Takes <30 min unattended
- Emits fresh JWTs cached for local dev configs
- Final state: tenant exists, has minimum-viable seeded data, JWT in cache

**Success metric**: cycle-all.sh completes; all 3 dev tenants logged-in-able after with seeded state visible.

## Tasks

### T6.1 — Define "minimum viable dev tenant state"
- `docs/dev-tenant-system/seed-spec.md`
- Per archetype (PABSON, GENERIC): 1 school, 1 academic year, 1 session, 5 students, 2 teachers, 2 sections, 2 courses, basic finance setup (1 fee structure, 1 invoice, 1 payment)
- Note: existing `server/lib/provision-scripts/seed-existing-tenant.sh` may be reusable — evaluate
- **Validation**: doc reviewed

### T6.2 — Evaluate existing `seed-existing-tenant.sh` for reuse
- Read the existing script
- Determine if it satisfies the seed-spec or needs replacement/extension
- Output: 1-paragraph addition to seed-spec.md
- **Validation**: doc reviewed

### T6.3 — `scripts/dev-tenant/lib/seed.ts` — typed seed builder
- Uses tenant API endpoints (with tenant JWT) to create entities per seed-spec
- Idempotent: skip entities by name/key if exist
- If T6.2 says reuse existing: this becomes a thin wrapper instead
- **Validation**: integration test against a fresh tenant — second run is no-op

### T6.4 — `scripts/dev-tenant/seed.sh`
- Args: `<tenantId>`
- Loads tenant credentials, gets JWT, runs seed
- Tee output to `docs/deploys/`
- **Validation**: manual run on a throwaway

### T6.5 — Named dev tenants config
- `scripts/dev-tenant/dev-tenants.json` — list each persistent dev tenant: tenantId, archetype, country, email-template, seedSpec
- Email-template carries `<rotation>` placeholder substituted at cycle time
- **Validation**: schema validates config

### T6.6 — `scripts/dev-tenant/cycle.sh`
- Args: `<tenantId>`
- Reads config; steps: deprovision (--apply with verification) → wait → provision → wait → seed → jwt
- Email rotation: each cycle generates a fresh suffix (e.g., `q2-2026`, `q3-2026`) per the roster convention
- Tee output to `docs/deploys/`
- **Validation**: end-to-end test on a single tenant

### T6.7 — `scripts/dev-tenant/cycle-all.sh`
- Reads `dev-tenants.json`
- Fans out cycle.sh in parallel (max concurrency from T0.6 — typically 1 for default CodeBuild quota)
- Falls back to serial if parallel fails (e.g., AWS throttling)
- Aggregate output; final summary table
- **Validation**: end-to-end test on 3 tenants

### T6.8 — First operational quarterly reset
- Run cycle-all.sh; document timing, surprises, fixes
- Update runbook with actual evidence
- **Validation**: `docs/deploys/dev-tenant-quarterly-reset-<date>.log`

## Risks
- Seed spec iteration — first version may need adjustment based on actual dev surface area.
- Email-rotation collision: if two cycles in same quarter, suffixes need finer granularity (e.g., timestamp).
- ~~CodeBuild concurrency limit~~ — Sprint 0 T0.6 confirmed Linux/Small quota = 60 concurrent builds, no per-project cap. Parallel-by-default in `cycle-all.sh` is safe.

## Rollback
- Cycle interrupted partway: deprovision phase is idempotent (re-run with --apply); provision/seed are forward-only.
- Failed seed: tenant exists with partial data; re-run seed (idempotent) or cycle to reset.

---

# Sprint 7 — Operator Hygiene + Cost Attribution

**Goal**: Internal tenants are visually distinct in operator views. Production-usage metrics exclude them by default. Cost attribution can identify dev tenant spend (best-effort given shared infra).

**Demoable**:
- AdminWeb tenant list filter dropdown (already shipped Sprint 2) — confirm default = "Production only"
- Operator analytics dashboard has "Include internal tenants" toggle (default off)
- AWS cost-explorer report can filter to `EdForge:TenantTag` and show dev tenant cost separately

**Success metric**: Default operator dashboards exclude internal tenants; cost-explorer shows tagged spend (best-effort, scope documented).

## Tasks

### T7.1 — Audit operator analytics queries
- List every operator query in `server/lib/analytics/lambda/api/analytics-service.ts` (read path)
- Identify which need tenantTag filtering
- Output: `docs/dev-tenant-system/operator-query-audit.md`
- **Validation**: doc reviewed

### T7.2 — Add tenantTag filter to analytics queries
- Modify analytics-service.ts to filter by tenantTag (default exclude internal-dev*)
- Add `?includeInternal=true` query param
- **Validation**: e2e tests with mixed tenants — default excludes; param includes

### T7.3 — AdminWeb operator dashboard UI: include-internal toggle
- Toggle "Include internal tenants" (default off); visual cue when on
- Querystring param persisted
- **Validation**: snapshot tests + RTL test for toggle behavior

### T7.4 — AWS resource tagging for cost attribution (provisioning-time)
- SNS topic, CloudWatch log group: tag with `EdForge:TenantTag` and `EdForge:TenantId`
- Update tenant-template-stack-basic to apply tags at provisioning
- **Validation**: cdk synth shows tags on the right resources

### T7.5 — Backfill tags on existing dev tenant resources
- For dev tenants provisioned in Sprint 3 (before T7.4): use `aws sns tag-resource` and `aws logs tag-log-group` to apply tags
- **Validation**: tag listing per resource

### T7.6 — Document cost-attribution scope
- `docs/dev-tenant-system/cost-attribution-scope.md`
- In-scope: SNS, CloudWatch logs, per-tenant Cognito (if pool tagging supported)
- Out-of-scope: DDB partitions in shared tables (BASIC tier is pooled — cost-per-tenant on DDB is not directly attributable)
- Operator expectations: best-effort, not dollar-precision
- **Validation**: doc reviewed

### T7.7 — Deploy chain
- shared-types (if changed) → controlplane-stack → analytics-stack → tenant-template-stack-basic
- Standard publish + deploy chain per CLAUDE.md
- **Validation**: deploy logs

### T7.8 — End-to-end validation
- Confirm dev tenants don't show in default operator dashboards
- Confirm cost report (Cost Explorer) shows internal-dev separate from production
- Saraswati smoke regression check
- **Validation**: screenshots + validation log

## Risks
- Tags only attach to resources created AFTER deploy — Sprint 3 dev tenants need T7.5 backfill or re-provisioning.
- Some AWS resources don't surface in cost-explorer (e.g., DDB partitions). Best-effort only — scope documented in T7.6.
- AdminWeb publish-gate: jsdom bundle sim before T7.7 controlplane redeploy.

## Rollback
- UI toggle defaults to off — even if backend filter has a bug, default behavior matches pre-change.
- Backend filter regression: revert analytics-service.ts; ECS roll.

---

# Sprint 8 — AdminWeb Deprovision UI

**Goal**: System-admin can deprovision an `internal-dev*` tenant from AdminWeb. Production tenants have no delete affordance.

**Demoable**:
- AdminWeb tenant detail page shows "Delete tenant" button only for `internal-dev*`
- Click → modal requires typing tenantId + shows scanner preview counts
- Submit → progress UI (polls lifecycle-status) → final success/failure status

**Success metric**: AdminWeb-driven deprovision results in zero orphan rows; UI matches CLI behavior.

## Tasks

### T8.1 — AdminWeb tenant detail: delete button (gated)
- Visible only if `tenantTag !== 'production'`
- Disabled if any pending lifecycle operation
- **Validation**: snapshot tests for both tag values

### T8.2 — ControlPlane API GET `/tenants/:tenantId/deprovision-preview`
- Returns expected delete counts (read-only — calls scanner from T5.2)
- Auth: system-admin
- Tag-gating: 403 if production
- **Validation**: e2e

### T8.3 — AdminWeb confirmation modal
- Requires typing exact tenantId
- Shows scanner preview counts via T8.2 endpoint
- Cancel/Confirm buttons; Confirm disabled until tenantId match
- **Validation**: RTL test for typed-confirmation gate

### T8.4 — AdminWeb deprovision submission
- On modal submit, call DELETE `/tenants/:tenantId` (Sprint 5 endpoint T5.9)
- Capture jobId; transition UI to progress view
- **Validation**: e2e

### T8.5 — AdminWeb post-deprovision UI
- Polls `/lifecycle-status` (T5.10); shows progress (SBT job → analytics cleanup → SNS cleanup → verify)
- Final success/failure with details
- On failure: link to `docs/dev-tenant-system/deprovision-recovery-runbook.md`
- **Validation**: snapshot tests for each progress state

### T8.6 — End-to-end test
- Cypress / Playwright test: full UI flow on a throwaway tenant
- **Validation**: e2e green

### T8.7 — Deploy + smoke
- jsdom bundle sim (CLAUDE.md)
- Deploy controlplane-stack
- Manual smoke: delete a throwaway via UI; verify zero orphans
- Saraswati smoke regression check
- **Validation**: deploy log + smoke log

## Risks
- Long-running deprovision (>5 min) needs UI polling + reasonable timeout + retry on transient errors.
- UI must not lie about success — only confirm after verify step passes (T5.11 step 10).

## Rollback
- UI is additive; revert PR if needed.
- Backend (Sprint 5) remains live and CLI-accessible.

---

# Sprint 9 — Pilot Onboarding Playbook (MVP DELIVERY)

**Goal**: Pre-pilot smoke against an ephemeral rehearsal tenant gates real pilot tenant provisioning. Operator runs `./scripts/playbook/onboard-pilot.sh ...` → either green and proceed, or red and stop.

**This sprint is the user-stated MVP — the reason the project exists.**

**Demoable**:
- Run playbook against a planned pilot config
- Watch ephemeral tenant provisioned, smokes pass, tenant deprovisioned
- Final output: PASS with link to AdminWeb create-tenant form pre-filled with pilot config; OR FAIL with detailed evidence

**Success metric**: Playbook runs in <15 min (or whatever CodeBuild allows), gates real tenant creation, leaves zero orphan tenants.

## Tasks

### T9.1 — Define playbook smoke checklist
- `docs/dev-tenant-system/playbook-smoke-checklist.md`
- Smoke list:
  - smoke-provisioning: tenant provisioned in <15 min
  - smoke-cognito-invite: invite delivered + accepted
  - smoke-post-auth-trigger: tenant-seeder writes correct METADATA + SETTINGS#WORKSPACE
  - smoke-archetype-defaults: currency, locale, calendar, numbers, week-start match archetype
  - smoke-school-create: archetype-specific validation passes
  - smoke-ay-create: AY creation works; sessions template applied correctly
  - smoke-iemis-codes (PABSON only): IEMIS code mapping works (reuse existing IEMIS smoke patterns from `scripts/smoke-tests/`)
  - smoke-tenant-scoping: rehearsal tenant cannot see other tenants' data
  - smoke-finance-currency: currency derives from workspace settings, not hardcoded
- **Validation**: checklist reviewed

### T9.2 — `scripts/playbook/lib/smokes/` — individual smoke modules (atomic per smoke)
Each smoke is a separate atomic task with its own commit:

- T9.2a — `smoke-provisioning.ts`: validates tenant provisioned successfully
- T9.2b — `smoke-cognito-invite.ts`: validates invite email sent (SES delivery confirmed)
- T9.2c — `smoke-post-auth-trigger.ts`: validates METADATA + SETTINGS#WORKSPACE written
- T9.2d — `smoke-archetype-defaults.ts`: validates archetype-specific defaults
- T9.2e — `smoke-school-create.ts`: validates school creation
- T9.2f — `smoke-ay-create.ts`: validates AY + session template
- T9.2g — `smoke-iemis-codes.ts`: validates IEMIS code mapping (PABSON only, skipped for GENERIC)
- T9.2h — `smoke-tenant-scoping.ts`: validates ABAC isolation
- T9.2i — `smoke-finance-currency.ts`: validates currency from workspace settings

Each smoke: takes tenantId + admin creds, returns `{ passed, duration, evidence }`. Per-smoke retries (3x with exp backoff for transient errors).
- **Validation**: each smoke unit-tested with mocks

### T9.3 — `scripts/playbook/onboard-pilot.sh` orchestrator
- Args: `<pilot-name> <archetype> <country> [--keep-on-failure]`
- Steps:
  1. Generate ephemeral tenantId: `dev-rehearsal-<pilot-name>-<timestamp>`
  2. Provision via Sprint 4 provision.sh (tenantTag=`'internal-dev-rehearsal'`)
  3. Run all applicable smokes in parallel (PABSON adds smoke-iemis-codes; GENERIC skips it)
  4. Aggregate results
  5. Deprovision via Sprint 5 deprovision.sh — always (green or red), unless `--keep-on-failure`
  6. On green: print AdminWeb URL with prefilled pilot form; exit 0
  7. On red: print failed smoke evidence + remediation hints; exit nonzero
- Tee output to `docs/deploys/`
- **Validation**: integration test — full run against a synthetic pilot config

### T9.4 — Operator notification routing
- Decide: should the existing `edforge-provisioning-alerts` SNS topic also fire for rehearsal tenant provision/deprovision events? Or filter by tenantTag?
- Recommendation: filter by tenantTag on the subscription policy — rehearsal tenant lifecycle should NOT page operator
- **Open for user confirmation** — see decisions log
- **Validation**: subscription policy applied; verified by triggering a rehearsal lifecycle event

### T9.5 — End-to-end validation against a real planned pilot
- Run against `saraswati-rehearsal-1 PABSON NPL` (or another planned pilot)
- Expected: PASS
- Verify ephemeral tenant deprovisioned cleanly (zero orphans)
- Saraswati smoke regression check
- **Validation**: validation log

### T9.6 — Document operator workflow
- `docs/dev-tenant-system/playbook-runbook.md`: when to run, what to expect, what to do on red
- Include the prefilled-AdminWeb-URL template
- **Validation**: doc reviewed

### T9.7 — Update CLAUDE.md
- Add to project rules: "Before provisioning a pilot tenant, run `./scripts/playbook/onboard-pilot.sh ...`. Skip only with explicit operator reason in deploy log."
- **Validation**: PR

## Risks
- Smokes must be reasonably fast (<15 min total); parallel execution mitigates.
- Deprovision-on-failure is critical — orphan rehearsal tenants would clutter the dashboard (excluded by Sprint 7 hygiene, but still ugly).
- Some smokes may be flaky (network, eventual consistency); per-smoke retries.

## Rollback
- Playbook is additive; revert if needed.
- Ephemeral tenants self-destruct on completion; `--keep-on-failure` preserves for debugging.

---

# Decisions Log — Open for User Confirmation

These are decisions I made or recommended in the plan that the user may want to override:

| # | Decision | My recommendation | Reason / fallback |
|---|---|---|---|
| 1 | Default tenantTag in AdminWeb form | `'internal-dev'` | Operator's day-to-day case is dev work; production is rare. Forces conscious choice for production. |
| 2 | Filter dropdown default in AdminWeb tenant list | "Production only" | Reduces noise for daily ops; toggle available for full view. |
| 3 | Email convention | `shoaib.dev+<tenant-shortname>-<rotation>@gmail.com` | V1 ships with personal email; future improvement: route to `dev-tenants@<domain>` group address so a future engineer doesn't depend on Shoaib's gmail. |
| 4 | CLI auth user | Separate `cli-system-admin@<domain>` user, not Shoaib's operator account | Decoupling: script outage / credential rotation doesn't lock Shoaib out of AdminWeb. |
| 5 | Quarterly reset trigger | Manual operator-run | V2 can add EventBridge cron if desired; manual is fine pre-pilot. |
| 6 | Operator SNS routing for rehearsal lifecycle | Filter by tenantTag on subscription policy — DON'T page on rehearsal lifecycle | Rehearsal noise should not interrupt operator; CodeBuild failure alarm covers genuine failures. |
| 7 | PABSON IEMIS smoke depth | Reuse existing IEMIS smoke patterns from `scripts/smoke-tests/` | Lower implementation cost; aligned with existing IEMIS test surface. |
| 8 | Plus-address rotation cadence | Per-cycle suffix (e.g., `q2-2026`); finer granularity if same-quarter cycle needed | Avoids Cognito tombstone collision when re-provisioning the same tenantId. |

---

# Out of Scope (V1)

Explicitly deferred to keep V1 focused:

- Multi-region dev tenants (single-region is the post-infra-sunset stance)
- Automated quarterly reset on a schedule (manual trigger sufficient)
- Cost-budget alerts per dev tenant (best-effort tagging only)
- Dev tenant data anonymization (treated as throwaway)
- A separate "infra sandbox" AWS account for CDK/IAM testing (accept blast radius per CLAUDE.md ground rules)
- Self-service dev tenant creation by future engineers (single-operator pre-pilot world; revisit post-pilot)
- Migration from gmail to a shared group address (V2 hygiene improvement)

---

# References

Files referenced throughout this plan:

- `/Users/shoaibrain/edforge/CLAUDE.md` — project rules + ground rules
- `/Users/shoaibrain/edforge/server/lib/provision-scripts/provision-tenant.sh` — existing provisioning entry point
- `/Users/shoaibrain/edforge/server/lib/provision-scripts/deprovision-tenant.sh` — existing SBT-driven deprovisioning (T0.3 audit target)
- `/Users/shoaibrain/edforge/server/lib/provision-scripts/seed-existing-tenant.sh` — existing seed script (T6.2 reuse evaluation)
- `/Users/shoaibrain/edforge/server/lib/bootstrap-template/core-appplane-stack.ts` — DeprovisioningScriptJob wiring (lines 74-174)
- `/Users/shoaibrain/edforge/server/lib/bootstrap-template/control-plane-stack.ts` — sbt.CognitoAuth (lines 27, 41) — answers T4.1
- `/Users/shoaibrain/edforge/server/lib/tenant-template/identity-provider.ts` — Cognito pool model (line 20); audit confirmed shared-pool-per-tier in BASIC (T0.5)
- `/Users/shoaibrain/edforge/server/lib/tenant-template/ecs-dynamodb.ts` — RETAIN + deletionProtection (lines 30-37); PITR check (T0.2)
- `/Users/shoaibrain/edforge/scripts/utils/update-provision-source.sh` — T1.8 prereq
- `/Users/shoaibrain/edforge/packages/shared-types/src/identity/field-governance.ts` — T1.2 target
- `/Users/shoaibrain/edforge/scripts/smoke-tests/` — Saraswati regression smokes; T9.2 reuse target

# Document History

- 2026-05-07 — Initial draft (Shoaib + Claude)
- 2026-05-07 — Post-review revision: split Sprint 1 into 1+2; added Sprint 0 baselining; restructured Sprint 5 as verifier+gap-filler model on top of existing SBT job; added decisions log; added cost-attribution scope; added backout drill (T5.13)

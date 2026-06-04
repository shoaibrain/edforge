# Repeatable deploy prompt — app-code service deploy (± shared-types publish)

Hand this to the deploy agent (Claude Code in VS Code, on the operator Mac that
holds `server/.env.prod`, AWS creds, Docker daemon, and npm publish auth). It
covers the **most common EdForge deploy shape**: one or more ECS services
(identity / academics / finance / rproxy) change, optionally preceded by an
`@aibrains/shared-types` (or `@aibrains/pdf-renderer`) publish, with **no
CDK/infra change** (empty `cdk diff`).

> **Process note — no UAT.** UAT is sunset; `prod` is the only deployed
> environment (`server/.env.prod`). The safety gate is **PR-first**: the change
> merges to `main` via a reviewed PR (CodeRabbit + CI) before any deploy, and the
> agent **stops for explicit operator authorization** before the prod AWS calls.
> "Never deploy straight to prod" from `CLAUDE.md` is satisfied by the PR-review
> gate + smoke, not a separate UAT environment.
>
> If the change DOES touch infra (`server/lib/**`, `service-info`,
> `tenant-api-prod.json`, `nginx.template`, `ecs-dynamodb.ts`, Cognito/CORS,
> AdminWeb, or a Lambda), this template is **not** sufficient — follow the full
> change-to-deploy matrix in `CLAUDE.md` and do the cross-stack export pre-flight.

---

## Fill these in

| Param | Value |
|---|---|
| Sprint / PRs | `<e.g. GB1.1-fix — #NNN>` |
| Merge commit on `main` | `<sha>` |
| shared-types publish | `<version, e.g. 0.68.0 — or "none">` |
| Service(s) to roll | `<identity / academics / finance / rproxy ...>` |
| Smoke script(s) | `<scripts/smoke-tests/*.ts>` |
| Smoke tenant archetype | `<PABSON / GENERIC>` |
| Infra (`cdk diff`) | `<must be EMPTY for this template>` |

---

## Prompt to the agent

> You are deploying **<Sprint/PRs>** (merged to `main` at `<sha>`) to EdForge
> **prod** (the only environment — UAT is sunset). This is an app-code deploy
> with **no infra change**; confirm `cdk diff` is empty before trusting that.
> The PR-review gate is already passed (that is the pre-prod gate). Tee every
> AWS/npm command to `docs/deploys/prod-<action>-<target>-$(date -u +%Y%m%d-%H%M%S)-<sha>.log`
> and update `docs/deploys/INDEX.md`. **Do not run any `aws` / `npm publish`
> command until I explicitly authorize this prod deploy in the conversation.**
>
> **0 · Publish (only if shared-types/pdf-renderer changed):**
> ```bash
> cd packages/<pkg> && npm run build && npm publish        # <version>
> npm view @aibrains/<pkg> version                          # confirm <version> is live
> ```
> Publish FIRST — the service Docker images resolve the package from the npm
> registry via their `^<version>` pin; an unpublished version 404s the build.
>
> **1 · LOCAL gates (on `<sha>`):**
> ```bash
> cd packages/shared-types && npm run build && npx jest --config jest.config.cjs   # if shared-types changed
> cd server/application && npx nest build <service> && npx jest <affected-specs>
> cd server && source .env.prod && CDK_NAG_ENABLED=false npx cdk diff tenant-template-stack-basic   # read-only; expect EMPTY
> ```
> If the diff is non-empty, STOP — this is not an app-only deploy; escalate to me.
>
> **2 · PROD build + roll** (`cd server && source .env.prod`, after I authorize):
> ```bash
> SHA=$(git rev-parse --short HEAD); TS=$(date -u +%Y%m%d-%H%M%S)
> ./scripts/build-application.sh <service> 2>&1 | tee docs/deploys/prod-build-application-<service>-$TS-$SHA.log
> export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"      # prod-basic
> SVC=$(aws ecs list-services --cluster "$CDK_BASIC_CLUSTER" --query "serviceArns[?contains(@,'<service>')]" --output text); SVC=${SVC##*/}
> aws ecs update-service --cluster "$CDK_BASIC_CLUSTER" --service "$SVC" --force-new-deployment \
>   2>&1 | tee docs/deploys/prod-ecs-roll-<service>basic-$TS-$SHA.log
> ```
> Verify the roll the way the retros say — **do not** rely on
> `rolloutState: COMPLETED`:
> - the new task is `healthStatus: HEALTHY` and its image digest matches the push;
> - the ECS log group shows a clean Nest bootstrap (no `Cannot resolve
>   dependencies` / `MODULE_NOT_FOUND` / `UnknownDependenciesException`).
>
> **3 · Smoke (prod):** paste a prod JWT into `<smoke script>` (set
> `TENANT_ARCHETYPE=<archetype>`, `BASE_URL` = prod API GW; or export
> `GB1_JWT_FILE=/path/to/token`), then
> `npx ts-node <smoke script> 2>&1 | tee docs/deploys/prod-smoke-<sprint>-$TS-$SHA.log`.
> All checks must pass. If a check fails, STOP, do not flip the INDEX, report the
> evidence (request/response + the relevant service log line) — do not attempt a
> code fix in the deploy session.
>
> **4 · Record:** write `docs/deploys/prod-<sprint>-deploy-summary-<date>-<sha>.md`
> and set the INDEX.md entry 🟢. Capture the prior image digest as the rollback
> target.
>
> **Rollback:** re-tag the prior service ECR digest as `:latest` and
> `aws ecs update-service … --force-new-deployment`. The ECR lifecycle keeps the
> last 10 versioned images. Note in the log whether any data heal is needed (a
> behavior-change deploy may have written wrong values between roll and fix — see
> the deploy summary's "heal" section).

---

## Pre-filled instantiation — GB1.1 calendar-derivation FIX (re-deploy after the incident)

| Param | Value |
|---|---|
| Sprint / PRs | GB1.1-fix — `<this PR #>` |
| Merge commit | `<sha after merge>` |
| shared-types publish | **0.68.0** (removes the `createSchoolSchema` calendar default) |
| Service(s) to roll | **identity** (only) |
| Smoke script | `scripts/smoke-tests/gb1-calendar-derivation.ts` |
| Smoke tenant archetype | `PABSON` (omit `calendarSystem` → must now return `bikram_sambat`) |
| Infra (`cdk diff`) | EMPTY |

GB1.1-fix notes:
- The 2026-06-04 incident: `createSchoolSchema` defaulted `calendarSystem` to
  `'gregorian'`, which the global `ZodValidationPipe` applied before the
  service's archetype derivation — so an omitted value short-circuited to
  `gregorian`. Fix makes the field `.optional()` (no default).
- After deploy, re-run `gb1-calendar-derivation.ts`: Case 1 (omit) must now
  return `bikram_sambat`. Then run the **data heal** (see the incident entry in
  INDEX.md) for any PABSON school created without an explicit calendarSystem
  since the first GB1 roll.
- `nepal-school-e2e.ts` does NOT cover this (it sends `calendarSystem`
  explicitly). Use `gb1-calendar-derivation.ts`.

# Repeatable deploy prompt — app-code service deploy (± shared-types publish)

Hand this to the deploy agent (Claude Code in VS Code, on the operator Mac that
holds `server/.env.uat` / `server/.env.prod`, AWS creds, Docker daemon, and npm
publish auth). It covers the **most common EdForge deploy shape**: one or more
ECS services (identity / academics / finance / rproxy) change, optionally
preceded by an `@aibrains/shared-types` (or `@aibrains/pdf-renderer`) publish,
with **no CDK/infra change** (empty `cdk diff`).

> If the change DOES touch infra (`server/lib/**`, `service-info`,
> `tenant-api-prod.json`, `nginx.template`, `ecs-dynamodb.ts`, Cognito/CORS,
> AdminWeb, or a Lambda), this template is **not** sufficient — follow the full
> change-to-deploy matrix in `CLAUDE.md` and do the cross-stack export pre-flight.

---

## Fill these in

| Param | Value |
|---|---|
| Sprint / PRs | `<e.g. GB1 — #239, #240>` |
| Merge commit on `main` | `<sha>` |
| shared-types publish | `<version, e.g. 0.67.0 — or "none">` |
| Service(s) to roll | `<identity | academics | finance | rproxy ...>` |
| Smoke script(s) | `<scripts/smoke-tests/*.ts>` |
| Smoke tenant archetype | `<PABSON | GENERIC>` |
| Infra (`cdk diff`) | `<must be EMPTY for this template>` |

---

## Prompt to the agent

> You are deploying **<Sprint/PRs>** (merge `<sha>`) to EdForge. This is an
> app-code deploy with **no infra change** — confirm `cdk diff` is empty before
> trusting that. Follow the ladder in `CLAUDE.md` (LOCAL → UAT → human gate →
> PROD). **Never deploy straight to prod.** Tee every environment-touching
> command to `docs/deploys/<env>-<action>-<target>-$(date -u +%Y%m%d-%H%M%S)-<sha>.log`
> and add/update the `docs/deploys/INDEX.md` entry. Do not run
> `aws --profile prod ...` until I explicitly authorize the prod leg in this
> conversation.
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
> cd server && source .env.uat && CDK_NAG_ENABLED=false npx cdk diff tenant-template-stack-basic   # expect EMPTY
> ```
> If the diff is non-empty, STOP — this is not an app-only deploy; escalate to me.
>
> **2 · UAT** (`cd server && source .env.uat`):
> ```bash
> SHA=$(git rev-parse --short HEAD); TS=$(date -u +%Y%m%d-%H%M%S)
> ./scripts/build-application.sh <service> 2>&1 | tee docs/deploys/uat-build-application-<service>-$TS-$SHA.log
> export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"
> SVC=$(aws ecs list-services --cluster "$CDK_BASIC_CLUSTER" --query "serviceArns[?contains(@,'<service>')]" --output text); SVC=${SVC##*/}
> aws ecs update-service --cluster "$CDK_BASIC_CLUSTER" --service "$SVC" --force-new-deployment \
>   2>&1 | tee docs/deploys/uat-ecs-roll-<service>basic-$TS-$SHA.log
> ```
> Verify the roll the way the retros say — **do not** wait for
> `rolloutState: COMPLETED`:
> - the new task is `healthStatus: HEALTHY` and its image digest matches the push;
> - the ECS log group shows a clean Nest bootstrap (no `Cannot resolve
>   dependencies` / `MODULE_NOT_FOUND` / `UnknownDependenciesException`).
>
> **Smoke (UAT):** paste a UAT JWT into `<smoke script>` (set
> `TENANT_ARCHETYPE=<archetype>`, `BASE_URL` = UAT API GW), then
> `npx ts-node <smoke script> 2>&1 | tee docs/deploys/uat-smoke-<sprint>-$TS-$SHA.log`.
> All checks must pass.
>
> **3 · HUMAN GATE:** post the UAT evidence (build digest, roll status, smoke
> pass count) and **stop**. Wait for my explicit "go to prod".
>
> **4 · PROD** (only after I authorize): `cd server && source .env.prod`, repeat
> step 2 with `prod-` log prefixes and a prod JWT for the smoke. Then write a
> `docs/deploys/prod-<sprint>-deploy-summary-<date>-<sha>.md` and flip the
> INDEX.md entry 🟡→🟢.
>
> **Rollback (either env):** re-tag the prior service ECR digest as `:latest`
> and `aws ecs update-service … --force-new-deployment`. The ECR lifecycle keeps
> the last 10 versioned images. Note in the log whether any data migration must
> be unwound (most app-code deploys: none).

---

## Pre-filled instantiation — GB1 (this deploy)

| Param | Value |
|---|---|
| Sprint / PRs | GB1 — #239, #240 |
| Merge commit | `74e4323` |
| shared-types publish | **0.67.0** |
| Service(s) to roll | **identity** (only) |
| Smoke script | `scripts/smoke-tests/gb1-calendar-derivation.ts` |
| Smoke tenant archetype | `PABSON` (primary: omit `calendarSystem` → `bikram_sambat`) |
| Infra (`cdk diff`) | EMPTY (verified — no `server/lib/**` etc. in the GB1 delta) |

GB1-specific notes:
- The **only** runtime behavior changed is GB1.1's `calendarSystem` derivation;
  GB1.2's `getDefaultConfigForArchetype` has no call-site yet (deploys inert).
- `nepal-school-e2e.ts` does **not** validate GB1.1 (it sends `calendarSystem`
  explicitly). Use `gb1-calendar-derivation.ts`, which omits it.
- For a GENERIC tenant the NPL-address case **flips** old→new
  (`bikram_sambat`→`gregorian`); that is the intended GB1.1 correction, not a
  regression.

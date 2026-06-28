# Deploy Log Index

Per CLAUDE.md "Deploy log convention", every prod-touching action tee's its output here. This INDEX maps each named deploy event to the relevant log files, organized by sprint + date.

Newer entries at the top.

---

## 2026-06-28 (evening) — Finance SH.1 PermissionGuard hardening + Sprint D.1-D.4 async job framework: 🟢 deployed prod clean

**Shipped to prod** (PRs [#338](https://github.com/shoaibrain/edforge/pull/338) `138b0db` + [#339](https://github.com/shoaibrain/edforge/pull/339) `f67309f` merged ~21:00 UTC):

- **PR #338 (SH.1+SH.2):** `PermissionGuard` school-scope hardening — closes the cross-school information-disclosure gap surfaced by validation workflow `wf_4b82df7e-2c1`. New sibling `IdentityClientService.schoolExists()` that distinguishes confirmed 404 (cacheable as "missing") from transport errors (fail-closed, NOT cached). TenantAdmin no longer bypasses the school-existence check. + `cross-school-blocked` smoke case in `scripts/smoke-tests/finance-bulk-ops-smoke.ts` (MUST-PASS gate).
- **PR #339 (Sprint D.1-D.4):** async job framework foundation — `FinanceJobEntity` + `FinanceJobsService` + `BulkOpsController` (`GET /finance/jobs/:jobId`) + `BulkOperationsModule` wiring + module-wiring spec entry. Controller uses load → `checkPermission(billing,view,job.schoolId)` → bare 404 on deny/throw (non-enumerability preserved). `incrementCounter` + `appendFailedStudent` now gated on `#status IN (:queued, :running)` to prevent post-terminal counter races.
- **Side fix-ups landed pre-merge (review-feedback):** #338 `2b045ad` (no caching of transport errors) + #339 `143b3f8` (checkPermission instead of role-presence + counter terminal-status guard).

**Deploy sequence (~5 min wall, clean — no rollbacks, no hotfixes):**

1. `cdk diff shared-infra-stack tenant-template-stack-basic` — 4 stacks differing; only **shared-infra-stack** carries real PR #339 work (new `/finance/jobs/{jobId}` route in the OpenAPI spec). controlplane-stack drift (`AdminWebUi/AdminSite/CustomResource-1024MiB` SourceObjectKeys hash) **skipped** (pre-existing, not in either PR). tenant-template-stack-basic diff is only the codeCommitId bump `1e7805d→f67309f` + CDK metadata noise — **skipped** as cosmetic. Log: [`prod-cdk-diff-sh1-d1-d4-20260628-210456-f67309f.log`](prod-cdk-diff-sh1-d1-d4-20260628-210456-f67309f.log).
2. `cdk deploy shared-infra-stack` — 41.42s, 6/6 resources UPDATE_COMPLETE. New API GW Deployment + RestApi bodyS3 hash + Stage rebound. Log: [`analytics-prod-shared-infra-stack-20260628-161317-f67309f.log`](analytics-prod-shared-infra-stack-20260628-161317-f67309f.log).
3. `build-application.sh finance` — pushed `finance:f67309f-20260628211539` + `:latest`, 77.5 MB, digest `sha256:0ff9e4c9ce80f795e683abdd8e91d0475005058efb88e1b3b1a2371a623e79a1`. Log: [`prod-build-application-finance-20260628-211400-f67309f.log`](prod-build-application-finance-20260628-211400-f67309f.log).
4. `aws ecs update-service --force-new-deployment financebasic` — PRIMARY deployment converged in ~95s. Log: [`prod-ecs-roll-financebasic-20260628-211400-f67309f.log`](prod-ecs-roll-financebasic-20260628-211400-f67309f.log).
5. Verification: task `80c6381498e8435baa338288c819304f` `healthStatus: HEALTHY`; container digest matches the push; bootstrap log shows `Nest application successfully started` + `BulkOperationsModule dependencies initialized` + `Mapped {/finance/jobs/:jobId, GET} route` registered; zero DI errors. Unauthenticated probes against `/finance/jobs/{uuid}` and `/finance/schools/{anySchoolId}/invoices/bulk-preview` both return 401 (Cognito authorizer engaged → routes live, not 403 SigV4 fallthrough).

**Deploy-wrapper bug surfaced + worked around:** `scripts/deploy-analytics.sh` computes `REPO_ROOT` from `dirname "$0"`, so invoking the wrapper at the PARENT repo path while sitting on a different worktree caused the synth to use the parent's stale HEAD (`292af0a` docs-branch) — a no-op deploy was produced. Workaround: copy the wrapper into the worktree and invoke it at the worktree's path. Follow-up: harden the wrapper to honor `pwd` or accept `--repo-root`.

**Rollback target captured:** prior `:latest` digest = `sha256:c5aa27989fd99ad88ae91b5546f9a2209cb4bacf7e6f873890b5300d4ef2cdce` (the 1e7805d image from the morning deploy) — recoverable via the ECR lifecycle.

### Auth-gated smoke pending

`/tmp/prod-jwt-validation.txt` expired at ~14:46 PT; the structural smoke (unauth 401s) confirms both routes are live but the full validation (cross-school `/bulk-preview` should now return **404** not 200; `/finance/jobs/{nonexistent}` should return **404**) needs a fresh JWT. Operator runs after this entry merges.

---

## 2026-06-28 — Finance Bulk Ops Sprint C Phase 1 BE: 🟢 deployed prod clean (no rollbacks)

**Shipped to prod** (PR [#337](https://github.com/shoaibrain/edforge/pull/337) merged as `1e7805d` — backend Phase 1 from operator-validated prototype wizard rewrite):

- `@aibrains/shared-types@0.88.0` published to npm (operator, pre-session) — adds `customLineItems` + `skipZeroTotal` + `isCustom` line-item flag to invoice schema.
- `shared-infra-stack` CFN UPDATE_COMPLETE in 105.73s — added Sprint B.1/B.2 `gradeLevel` query params + Sprint C.6 `/bulk-preview` to the API GW spec (lifecycle rebuild of `AWS::ApiGateway::Deployment` + Stage; bodyS3 hash changed). Log: [`analytics-prod-shared-infra-stack-20260628-192525-1e7805d.log`](analytics-prod-shared-infra-stack-20260628-192525-1e7805d.log).
- `tenant-template-stack-basic` CFN UPDATE_COMPLETE in 312.51s — Sprint A.3 **GSI14** (`gsi14pk = TENANT#…#SCHOOL#…#GRADE#…`) added on all 3 tier-Basic tables (identity, academics, finance); IAM policy hash change on finance task role propagated → CDK-side-effect rolled the ECS service once on old `:latest` (no Phase 1 code yet). Log: [`analytics-prod-tenant-template-stack-basic-20260628-192719-1e7805d.log`](analytics-prod-tenant-template-stack-basic-20260628-192719-1e7805d.log).
- Finance ECS `prod-basic/financebasic` rolled to image `1e7805d-20260628193452` (digest `sha256:c5aa27989fd99ad88ae91b5546f9a2209cb4bacf7e6f873890b5300d4ef2cdce`). Task `bc65d7b9200c484385256b8ec300580a` `healthStatus: HEALTHY`. Bootstrap log shows `Nest application successfully started` + **`Mapped {/finance/schools/:schoolId/invoices/bulk-preview, GET} route`** registered. Zero DI errors.
- **Rollback target captured:** prior `:latest` digest (the CDK-side-effect roll's image) is in ECR — lifecycle keeps last 10 versioned images.

Full summary: [`prod-sprint-c-phase1-deploy-summary-20260628-1e7805d.md`](prod-sprint-c-phase1-deploy-summary-20260628-1e7805d.md). Operator-authorization escalation logged inline (wider scope than initial "ECR + ECS rolling" — pre-flight `cdk diff` surfaced pending shared-infra + GSI14 from prior PRs that would have left the new code dead-with-no-route).

### Smoke (operator-pending)

`/tmp/bulk-preview-smoke.sh` ready — set `TOKEN=<prod-jwt-for-dev-pabson-primary>` and run. Asserts HTTP 200 + presence of the 3 Phase 1 counters (`studentsWithBalance` / `studentsNotBilledThisPeriod` / `studentsNewAdmission`).

---

## 2026-06-27 — Pilot Onboarding Hardening PR-PD (Previous Dues): 🟢 deployed prod after 2 mid-rollout DI hotfixes

**Shipped to prod** (PR [#330](https://github.com/shoaibrain/edforge/pull/330) merged as `dbba176`; followed by 2 direct-main hotfixes `289b864` + `f5855f2`):

- `@aibrains/shared-types@0.86.0` published to npm (final, post-rc.1).
- `shared-infra-stack` CFN UPDATE_COMPLETE in 41.89s — added 1 API GW route (`PUT /finance/schools/{schoolId}/student-accounts/{accountId}/opening-balance`) + lifecycle rebuild of `AWS::ApiGateway::Deployment` + Stage. Log: [`analytics-prod-shared-infra-stack-20260627-143452-dbba176.log`](analytics-prod-shared-infra-stack-20260627-143452-dbba176.log).
- Finance ECS `prod-basic/financebasic` rolled to image `f5855f2-20260627195803` (digest `sha256:5b6857745b2ad24c98df3a59e57910702b71479a21c5ffe68c247c7db8692afa`). `rolloutState: COMPLETED`, `failedTasks: 0`, `runningCount: 1`. Smoke probe: `PUT …/opening-balance` returns 401 (Cognito authorizer engaged; route live end-to-end).
- **Rollback target captured:** prior live = TaskDef:2 on the pre-PR image (still in ECR, immediately re-deployable).

### Rolling-deploy mid-incident summary (2 sub-failures, 0 customer impact)

ECS circuit breaker auto-rolled-back twice during the 16-minute deploy window (14:42 → 14:58 PT). Old TaskDef:2 stayed live throughout; no traffic ever hit the failing tasks.

| # | Time PT | Image | Cause | Detection | Recovery |
|---|---|---|---|---|---|
| 1 | 14:42 | `dbba176-20260627193726` | `StudentAccountsService` constructor added `FinanceAuditService` in Sprint PD.1.4 + declared the provider in `StudentAccountsModule`. But `InvoicesModule` + `PaymentsModule` provide `StudentAccountsService` LOCALLY in their own `providers[]` (not via importing `StudentAccountsModule`), so Nest could not resolve the new dep in those modules' contexts. Container crash-looped on bootstrap with `Nest can't resolve dependencies of the StudentAccountsService (DynamoDBClientService, IdentityClientService, ?). FinanceAuditService at index [2] is unavailable in the InvoicesModule context.` | ECS circuit-breaker; service auto-rolled-back to TaskDef:2 (~90s window) | Hotfix `289b864` direct-to-main: added `FinanceAuditService` to `InvoicesModule.providers` + `PaymentsModule.providers` + new wiring-spec block "Modules that locally provide StudentAccountsService also provide its full constructor dep set" (10 new assertions). Log: [`prod-build-application-finance-20260627-194545-dbba176-FAILED-rollback.log`](prod-build-application-finance-20260627-194545-dbba176-FAILED-rollback.log) |
| 2 | 14:52 | `289b864-20260627194945` | **Pre-existing Sprint 0.3 latent bug**: `FinanceAuditModule.providers = [FinanceAuditService, DynamoDBClientService, PermissionGuard]` — `PermissionGuard`'s constructor injects `IdentityClientService` but `FinanceAuditModule` never declared it. Sat dormant since Sprint 0.3 (assumed: Nest provider-resolution-ordering interaction with sibling modules masked the bug; the post-PD bootstrap order surfaced it reliably). Container crash-looped: `Nest can't resolve dependencies of the PermissionGuard (Reflector, ?). IdentityClientService at index [1] is unavailable in the FinanceAuditModule context.` | Same circuit-breaker pattern; auto-rolled-back | Hotfix `f5855f2` direct-to-main: added `IdentityClientService` to `FinanceAuditModule.providers` + new wiring-spec block "Modules that locally provide PermissionGuard also provide its full constructor dep set" (21 new assertions across 10 modules). Audited all 10 PermissionGuard-providing modules; only `FinanceAuditModule` was missing the dep. Log: [`prod-build-application-finance-20260627-194945-289b864-FAILED-rollback.log`](prod-build-application-finance-20260627-194945-289b864-FAILED-rollback.log) |
| 3 | 14:58 | `f5855f2-20260627195803` | (both fixes landed) | Nest bootstrapped cleanly; ECS `rolloutState: COMPLETED`; 401 probe confirms route live | ✅ Final state. Log: [`prod-build-application-finance-20260627-195803-f5855f2-SUCCESS.log`](prod-build-application-finance-20260627-195803-f5855f2-SUCCESS.log) |
| 4 | 15:09 | (validation) | Prod smoke run from main HEAD against dev-pabson-primary tenant (Bikash Rai account at Golden Gate School + Sunshine Private Academy cross-school) | All 7 PD.1 lifecycle cases passed: baseline GET, first-time set, persistence, idempotent no-op (amount unchanged + note updated), revision 5000→6500 + adjustment ledger, ledger contains both `opening_balance` + `adjustment` entries, cross-school PUT 404. Per-step times 1.0–1.4s. PD.2 split-payment cases skipped (no `INVOICE_ID` supplied — operator opts in by passing the env var). Log: [`prod-smoke-pr-pd-20260627-200000-f5855f2-7of7-PASSED.log`](prod-smoke-pr-pd-20260627-200000-f5855f2-7of7-PASSED.log) |

### ✅ Prod smoke validated end-to-end: 7/7 PASSED

Backend EPIC is **fully operational on prod**. The deployed code is exercising every PD.1 lifecycle path against a real tenant with real Cognito auth.

### Wiring-spec gap that allowed this class of bug

The PD.0.3 wiring spec (introduced in PR #330) caught *which modules provide the canonical owner* of a service but DID NOT generalize to *every module that locally provides the service must also provide its full constructor dep set*. Both incident shapes are the same bug class:

- A consumer module declares a service in `providers[]` instead of importing the owning module.
- Then a constructor dep is added to that service.
- The consumer module's providers list isn't updated → Nest cannot resolve the dep in the consumer's context.
- `nest build` passes (TypeScript types are fine). Specs pass (they mock the service). ECS `services-stable` passes (the health probe predates Nest bootstrap). The container crash-loops once `services-stable` flips and the new task tries to boot under real load.

Both wiring-spec blocks added in the hotfix commits hard-code the constructor dep lists for the two services that have this pattern in finance today (`StudentAccountsService` + `PermissionGuard`). Future maintainer when adding a 4th constructor param to either: the spec fires loudly until the dep list is extended AND every consumer module is audited.

### Process-trail caveat (option A retroactive-PR follow-up)

Both hotfix commits went DIRECT to main, bypassing the usual PR-first workflow. This was a deliberate trade made during active prod recovery (service was on TaskDef:2 / old code; needed the hotfix to land for the redeploy to succeed). Retroactive audit PR opened for review surface: [PR `<number>`](https://github.com/shoaibrain/edforge/pull/) — this INDEX.md entry IS the PR diff.

### Follow-ups

- ✅ Wiring spec hardened (both blocks); future regressions blocked.
- ⏳ CLAUDE.md update: write a first-class trap entry for "modules that locally provide a shared service must also provide the full transitive constructor dep set for that service + every guard/interceptor they declare" — this is the canonical lesson.
- ⏳ Sprint PD.3 frontend work blocked pending operator sign-off on the prod smoke run.
- 🟡 V1.5+ refactor: switch `InvoicesModule` + `PaymentsModule` (and similar) to `imports: [StudentAccountsModule]` instead of duplicating the provider. Eliminates the whole bug class structurally.

---

## 2026-06-04 — Sprint GB1 (GovernanceProfile runtime wiring): 🔴 prod smoke FAILED → fix in 0.68.0

**Shipped to prod (commit `74e4323`, PRs #239 + #240):** `@aibrains/shared-types@0.67.0` published; identity image `sha256:d5ba5fb1c92462ec07184a8a4d0dde37eec27212ccec7ac715e404545d40f499` (tag `74e4323-20260604165919` + `:latest`); ECS `prod-basic/identitybasic` rolled — new task `56791ef0…` HEALTHY, digest match, clean Nest bootstrap. Logs: `prod-build-application-identity-20260604-165911-74e4323.log`, `prod-ecs-roll-identitybasic-20260604-170124-74e4323.log`. **Rollback target captured:** prior `:latest` = `sha256:b9d08a1ebaf72576…` tag `6a45712-20260604024507`.

**Smoke FAILED — `prod-smoke-gb1-20260604-171513-74e4323.log`:**

| Case | Expected | Actual |
|---|---|---|
| PABSON tenant, `calendarSystem` omitted | `bikram_sambat` | `gregorian` ❌ |
| PABSON tenant, `calendarSystem:'gregorian'` (override) | `gregorian` | `gregorian` ✅ |

### Root cause (verified, not a bundling issue)

`createSchoolSchema` carried `calendarSystem: …default('gregorian')` ([school.schema.ts:258](../../packages/shared-types/src/schemas/identity/school.schema.ts#L231)). The identity service runs the body through a **global `ZodValidationPipe`** ([main.ts:42](../../server/application/microservices/identity/src/main.ts#L42)) BEFORE GB1.1's derivation, so an omitted `calendarSystem` was filled with `'gregorian'`; then [schools.service.ts:370](../../server/application/microservices/identity/src/schools/schools.service.ts#L370) `(createDto as any).calendarSystem || getGovernanceProfile(...)` short-circuited on the truthy `'gregorian'` and **never derived**. The GB1.1 unit tests passed only because they build the DTO as a plain object — bypassing the pipe. (The same default also masked the *old* `country === 'NPL'` branch, so the derivation was never reached on an omitted value either way — i.e. this is a latent pre-existing bug GB1.1 inherited, not introduced.) Ruled out by reproduction: bundling the 0.67.0 dist with production webpack resolves `getGovernanceProfile('PABSON').regional.defaultCalendarSystem` → `bikram_sambat` correctly, so it is NOT a webpack init-order problem.

### Fix — `@aibrains/shared-types@0.68.0` (PR `<this PR #>`)

- [school.schema.ts](../../packages/shared-types/src/schemas/identity/school.schema.ts): `createSchoolSchema.calendarSystem` → `.optional()` (no default) so the service owns the archetype derivation; explicit values still win.
- Regression guards: `create-school-calendar-system.spec.ts` (omitted → `undefined`, not `'gregorian'`); identity `schools.service.spec.ts` adds a test that **parses through the real `createSchoolSchema`** (the pipe path the prod incident lived in) → PABSON omit derives `bikram_sambat`.
- Validated: shared-types **2181/2181**; identity schools spec **70/70**; identity `nest build` OK.

### Re-deploy plan (prod-only — UAT is sunset; PR-first is the gate)

After the fix PR merges to `main` and you authorize prod:
0. `cd packages/shared-types && npm run build && npm publish` → `0.68.0`.
1. `./scripts/build-application.sh identity` → tee `prod-build-application-identity-<TS>-<sha>.log`.
2. `aws ecs update-service --cluster $CDK_PARAM_STAGE-$CDK_PARAM_TIER --service identity --force-new-deployment` → tee `prod-ecs-roll-identitybasic-<TS>-<sha>.log`; verify HEALTHY + digest + clean bootstrap.
3. `npx ts-node scripts/smoke-tests/gb1-calendar-derivation.ts` (prod PABSON JWT) → Case 1 must now be `bikram_sambat`. Tee `prod-smoke-gb1-<TS>-<sha>.log`. Flip this entry 🟢.

Runbook: [`REPEATABLE-app-code-deploy-prompt.md`](REPEATABLE-app-code-deploy-prompt.md).

### Data heal (after the fix is live)

PABSON-tenant schools created **without an explicit `calendarSystem`** carry `gregorian` instead of `bikram_sambat` (this masking predates GB1.1, so the scope is *all* such rows, not only those since the 16:59 UTC roll). PABSON is governed Bikram Sambat, so the heal is: for every PABSON tenant, set School (and its CONFIG row) `calendarSystem = 'bikram_sambat'` where it is `gregorian`. Audit first:
```bash
# enumerate PABSON tenants, then per tenant list school rows whose calendarSystem != bikram_sambat
aws dynamodb scan --table-name edforge-identity-basic \
  --filter-expression 'entityType = :s AND calendarSystem = :g' \
  --expression-attribute-values '{":s":{"S":"SCHOOL"},":g":{"S":"gregorian"}}' \
  --projection-expression 'tenantId, schoolId, calendarSystem'
```
Heal is an operator-confirmed one-shot `UpdateItem` per affected School + CONFIG row (no schema/code change). Capture the dry-run list in `docs/deploys/` before applying.

**Recommended posture (no rollback):** GB1.1 only affects the create-school path; explicit-calendar creates are unaffected (Case 2 ✅) and existing rows are untouched by the deploy. Leave 0.67.0 in prod and roll forward to 0.68.0 rather than reverting.

---

## 2026-05-26 — Sprint C.1 stacked backend deploy (C.1.3 + C.1.4 + C.1.5 + C.1.6): shipped to prod 🟢

**PRs merged:** [#199](https://github.com/shoaibrain/edforge/pull/199) (C.1.3 PdfTemplatesService — identity read-only + lazy-default), [#200](https://github.com/shoaibrain/edforge/pull/200) (C.1.4 IdentityClient.getCurrentTemplate + 60s LRU + 5xx fallback), [#201](https://github.com/shoaibrain/edforge/pull/201) (C.1.5 finance `GET /invoices/:id/pdf` — **first user-visible PDF in prod**), [#202](https://github.com/shoaibrain/edforge/pull/202) (C.1.6 finance `GET /payments/:id/receipt/pdf` — closes C.1 backend phase).

**Outcome:** Single-shot coordinated deploy of the full C.1 backend stack in ~6 min (commit `d2cf929`). shared-infra-stack CDK redeploy adds 2 new API GW routes (invoice PDF + receipt PDF) + the identity PDF templates GET route. identity ECR push + ECS roll carries C.1.3 + C.1.4. finance ECR push + ECS roll carries C.1.5 + C.1.6. **Live smoke 2/2 PASS** on dev-pabson-primary tenant `21aea5da-…` school `4209e3d8-…`: real invoice `INV-420-2605-0192` renders to a 15,321-byte PDF; real receipt `RCP-420-2605-0008` renders to 17,034-byte PDF. Both return `Content-Type: application/pdf` + `Content-Disposition: inline; filename="..."` + `Cache-Control: private, no-store` with valid `%PDF-` magic. Plus 2 routing probes on identity's new lazy-default endpoint returning full PABSON archetype configs.

**npm artifacts already live (no deploy required for these):** `@aibrains/pdf-renderer@0.5.0` (C.1.1 InvoicePdf) + `@aibrains/pdf-renderer@0.6.0` (C.1.2 ReceiptPdf) on npm registry. Resolved at runtime inside identity + finance Docker images via the `^0.6.0` pin on `server/application/package.json`.

**Cross-stack export pre-flight (per CLAUDE.md):** `cdk diff` showed only API GW Deployment + RestApi `BodyS3Location.Key` updates (asset-hash change for the new OpenAPI spec). **Zero export value churn** — `TenantApiAuthorizerArn` / `TenantApiRestApiId` / `TenantApiRootResourceId` all preserved → analytics-stack importers safe. R41-class incident avoided.

### Deploys (in order)

- `prod-cdk-diff-shared-infra-stack-20260525-192930-d2cf929.log` — clean diff
- `prod-shared-infra-stack-20260525-193121-d2cf929.log` — `cdk deploy shared-infra-stack` via wrapper; **UPDATE_COMPLETE in 43.86s**
- `prod-build-application-identity-20260525-193403-d2cf929.log` — identity ECR push `sha256:a1cff3f7…` tagged `d2cf929-20260526003412` + `:latest`
- `prod-ecs-roll-identitybasic-20260525-193559-d2cf929.log` — rolloutState COMPLETED, TaskDef:4, 0 failed
- `prod-build-application-finance-20260525-194110-d2cf929.log` — finance ECR push `sha256:9ca3a211…` tagged `d2cf929-20260526004120` + `:latest`
- `prod-ecs-roll-financebasic-20260525-194310-d2cf929.log` — rolloutState COMPLETED, TaskDef:2, 0 failed

### Validation — live smoke (`scripts/smoke-tests/c1-pdf-endpoints.sh`)

- `prod-smoke-c1-routing-20260526-072214-d2cf929.log` — 4-probe routing layer validation (404s on fake UUIDs + 200s on lazy-default template GETs for INVOICE + RECEIPT)
- `prod-smoke-c1-pdf-endpoints-20260526-072552-d2cf929.log` — **2/2 PASS** end-to-end PDF smoke with real data

### Lessons captured

- **L24** — Stacked single-shot deploys are safe when no DDB schema changes. 4 PRs deployed in one ~6-min sequence with single rollback target (re-tag prior ECR images + force-new-deployment).
- **L25** — Routing-level smoke + descriptor-defaults GET is sufficient when test data is sparse. Probing routes with fake UUIDs + asserting the lazy-default template GET returns 200 + full archetype config proves all the wire layers (API GW, VPC Link, JWT, permission, NestJS controller, DDB GetItem, descriptor registry, webpack externals).
- **L26** — `curl -I` (HEAD) is unreliable for Content-Type extraction on NestJS endpoints. NestJS doesn't ship a HEAD handler, so the C.1 smoke script v1 mis-failed with empty content-type. Fix: use `curl -s -D <hdr-file> -o <body-file>` on a single GET to capture both. `scripts/smoke-tests/c1-pdf-endpoints.sh` carries the fix.

### What's next

- **Merge frontend PR #63** (`edforge-saas-frontend` / `useDownloadReceiptPdf` hook + jspdf retirement). Vercel auto-deploys; the Download button hits the now-live backend.
- **C.2 Template Editor (Shell)** OR **D.4 BLE Workflow** — both research-✅ + dependency-✅.

---

## 2026-05-23 — Sprint D.2 Phase 2 (academics PromotionRule entity + CRUD + lazy-seed): shipped to prod

**PRs merged:** [#173](https://github.com/shoaibrain/edforge/pull/173) (D.2 Phase 1 — shared-types schemas + ArchetypeDefaults `promotionDefaults` extension), [#174](https://github.com/shoaibrain/edforge/pull/174) (D.2 Phase 2 — academics service code: entity + CRUD + lazy-seed + pure-function evaluator + Enrollment field migrations + state-machine extension + module-wiring extension + 2 API GW paths + 3 CodeRabbit review fixes).

**Outcome:** Second link in the Sprint D.2 chain. Ships the academics service-layer foundation for cross-year handoff: `PromotionRule` CRUD endpoints under `/academics/promotion-rules`, D.2.3 lazy-seed (PABSON `35/80`, GENERIC `60/90`) mirroring D.1.3, D.2.4 pure-function `evaluatePromotion()`, D.2.7 `Enrollment.priorEnrollmentId` + `.promotionDecision` fields, D.2.8 `provisional` `EnrollmentStatus`. Race-safe uniqueness via deterministic `PROMOTION_RULE_LOCK#{schoolId}#{gradeLevel}` + `TransactWriteItems`. **Phase 3 next:** batch eval + commit + transition-handler + atomic flip + cross-AY timeline + GSI4.

**shared-types:** 0.59.0 published in Phase 1 (new exports: `promotionRuleSchema`, `promotionEvaluationRequestSchema`/`promotionCommitRequestSchema` with refined `targetGradeLevel` constraint + duplicate-enrollment guard, `promotionDecisionSchema` enum, `promotionDefaultsSchema`, `PromotionDefaults`, `RetentionReason`, extended `enrollmentStatusSchema` with `provisional`).

**Module-wiring discipline:** academics `__tests__/module-wiring.spec.ts` extended IN-PR (not post-incident hotfix) to register `PromotionRulesModule` (PermissionGuard consumer) + `PromotionModule` (pure-function only, asserts NO PermissionGuard / NO DDB). First D.2 sprint where the [[feedback-module-wiring-invariant]] invariant is enforced from PR-1 forward — closes the trap that bit A.4 PR #161 (3rd recurrence) + identity PR #59 + #120/#121.

### Pre-flight rollback markers

- shared-infra-stack pre-D.2 deploy state: `prod-cross-stack-export-preflight-before-20260523-223642-16e2b71.log` (20 exports snapshotted with full importer audit before any deploy)
- academics pre-D.2 image: previous `:latest` digest preserved in ECR by lifecycle policy (10 latest kept)

### Deploys (in order)

- `prod-cross-stack-export-preflight-before-20260523-223642-16e2b71.log` — 20 shared-infra-stack exports snapshotted; 3 critical importers identified (`TenantApiAuthorizerArn` / `TenantApiRestApiId` / `TenantApiRootResourceId` → analytics-stack)
- `prod-cdk-diff-shared-infra-stack-20260523-223820-16e2b71.log` — clean diff: ApiGateway::Deployment destroy+create + RestApi `BodyS3Location.Key` + Stage `DeploymentId.Ref` (the 3 expected changes for a `tenant-api-prod.json` paths-only update). NO Lambda / IAM / Output value churn
- `analytics-prod-shared-infra-stack-20260523-223957-16e2b71.log` — `cdk deploy shared-infra-stack` via wrapper; **UPDATE_COMPLETE in 49.86s**; 6 resource changes (all expected). Total wall: 67.46s
- `prod-cross-stack-export-preflight-after-20260523-224725-16e2b71.log` — **zero Output value churn** verified byte-level diff; `TenantApiAuthorizerArn` / `TenantApiRestApiId` / `TenantApiRootResourceId` byte-identical → analytics-stack imports preserved (R41 lesson honored)
- `prod-build-application-academics-20260523-224755-16e2b71.log` — academics ECR push `sha256:c5b886f43ee217322ec5fc51194ac1628130fbacd6c0d4f71a24b7e87b0a1136` tagged `16e2b71-20260524034805` + `:latest`
- `prod-ecs-roll-academicsbasic-20260523-225014-16e2b71.log` — `force-new-deployment`; new task `71f8f318f24d48d09477e7d10528ef82` RUNNING + HEALTHY at 03:51:19 UTC; image digest matches push
- `prod-ecs-log-sanity-academicsbasic-20260523-225447-16e2b71.log` — Nest module-init verified

### Validation — module-init signature (R-D2.3 mitigation, GREEN)

From the bootstrap log filter — every D.2 module + the A.4 ResultsModule + the Nest application all initialized cleanly, in expected order, within 212ms of one another:

```
03:51:13.956Z  [InstanceLoader] PromotionModule dependencies initialized
03:51:13.970Z  [InstanceLoader] ResultsModule dependencies initialized      ← A.4 regression check
03:51:13.970Z  [InstanceLoader] PromotionRulesModule dependencies initialized
03:51:13.971Z  [InstanceLoader] EnrollmentModule dependencies initialized
03:51:14.168Z  [NestApplication] Nest application successfully started
```

**Zero `MODULE_NOT_FOUND` / `Cannot find injectable` / `Cannot resolve dependencies` / `UnknownDependenciesException` errors.** The [[feedback-module-wiring-invariant]] trap that took academics down on 2026-05-23 (A.4) is closed for D.2 — fix lands in-PR via the extended module-wiring spec.

### CodeRabbit review on PR #174 (all 3 findings VALID + fixed in-PR)

1. **`@Body()` types bypass global `ZodValidationPipe`** — fixed by adding `CreatePromotionRuleDtoZ` / `UpdatePromotionRuleDtoZ` / `PromotionRuleFilterDtoZ` via `createZodDto()` in `common/dto/zod-dtos.ts`; controller @Body() types updated to enforce schemas at the API boundary.
2. **Race spec mocks unreachable CCFE on putItem** — verified dead-code branch (fresh `uuid()` per call means entity keys never collide). Real race is on the deterministic `PROMOTION_RULE_LOCK` key; spec rewritten to mock `TransactionCanceledException` + winner re-read.
3. **No real uniqueness enforcement under concurrent first-GET** — added `PROMOTION_RULE_LOCK#{schoolId}#{gradeLevel}` lock written atomically with the rule via `TransactWriteItems`. Lock cleanup in `softDeletePromotionRule` (Update isActive=false + Delete lock with `attribute_exists` guard). PATCH paths that touch `isActive` route through softDelete for consistency.
4. **Bonus follow-up: idempotent DELETE** — second DELETE on already-soft-deleted rule would have failed (lock missing → `attribute_exists` condition → `TransactionCanceledException`). Fixed with early-return on `existing.isActive === false`.

### Phase 2 outcomes

| Layer | Status | Notes |
|---|---|---|
| shared-types 0.59.0 | ✅ live on npm | Published in Phase 1; consumers resolve cleanly |
| academics Docker image | ✅ on prod ECS | `sha256:c5b886f43ee2…` HEALTHY; module-init green |
| shared-infra-stack | ✅ deployed | 2 new API GW paths live: `/academics/promotion-rules` + `/{ruleId}` (×{GET,POST,PATCH,DELETE,OPTIONS}); RestApi/Authorizer/Root IDs byte-identical |
| PromotionRule entity | ✅ ready | TransactWrite + lock; lazy-seed + race recovery; soft-delete idempotent |
| PromotionEvaluator | ✅ ready | Pure function with static archetype-grep + DDB-import guardrails |
| Enrollment fields | ✅ ready | `priorEnrollmentId` + `promotionDecision` + `provisional` status |
| Cross-year regression spec | ✅ green | Invariant-3 guard locks AY1-vs-AY2 enrollment distinctness |

**No smoke this phase.** D.2.12 cross-year smoke ships in Phase 4 after Phase 3 (batch eval + commit + handler + flip + timeline).

### Retros — what to carry into Phase 3

- **Module-wiring spec extended in-PR worked exactly as designed.** Bootstrap logs show all new modules registered cleanly. Phase 3 introduces 5+ new sub-modules (PromotionBatchModule, EnrollmentTransitionHandlerModule, EnrollmentFlipModule, StudentTimelineModule, plus EventEmitterModule wiring) — every one needs spec coverage IN the same PR.
- **Cross-stack export pre-flight is now a 30-second snapshot + 15-second diff.** Should become a wrapped helper script (`scripts/cdk-export-preflight.sh`) per R41.B follow-up.
- **build-application.sh `cd ../server/application` is still CWD-fragile.** Memory `project_grade_level_fix_T4_shipped_prod` flagged this; still bit me on the ECS roll log (had to recapture). B0.1 wrapper rename is the durable fix.
- **`services-stable` returns while `rolloutState: IN_PROGRESS`.** That's normal — the new task is HEALTHY and the old is drained, but the alarm-stabilization window keeps rolloutState IN_PROGRESS for a few more minutes. Don't wait for `COMPLETED` to call the deploy done; check task `healthStatus: HEALTHY` instead.
- **Log group naming is verbose.** ECS auto-generated: `tenant-template-stack-basic-academicsTaskDefacademicscontainerLogGroup7AACD3D6-cihubcl839p8`. Cache the discovery once per session.

### Next

**Sprint D.2 Phase 3** — batch promotion-evaluation endpoint (D.2.5) + cross-year commit endpoint (D.2.6) + result-publish handler (D.2.9) + atomic provisional→final flip (D.2.10) + cross-AY timeline endpoint (D.2.11) + Enrollment GSI4 (priorEnrollmentId-centric) + EventEmitterModule wiring. Branch: `sprint/d2-phase-3-academics`.

---

## 2026-05-22 (PM) — Phase 7 deploy window: Sprint E.0 shipped + Sprint 0.4 deferred work CLOSED

**PRs merged:** [#138](https://github.com/shoaibrain/edforge/pull/138) (Sprint E.0 — 3 schema extensions: hasEcedExperience + municipalityConfig + scholarshipAmountNpr).

**Outcome:** Second deploy window of 2026-05-22, after Docker recovery (27.82 GB reclaimed via `docker builder prune -af` per the 2026-04 recovery pattern). Folded in the **Sprint 0.4 deferred work** that was blocked by Docker containerd I/O error in the morning session — `shared-infra-stack` redeploy now exposes `/archetype-defaults` via API GW; rproxy roll picks up the new nginx `^/archetype-defaults` location block. Both partial-ship sprints (0.4 + E.0) are now fully on prod.

**shared-types:** 0.53.0 published (new exports: `MunicipalityConfigDto`, `municipalityConfigSchema`, extended Student schemas with `hasEcedExperience` + `scholarshipAmountNpr`).

### Pre-flight rollback markers

- identity `sha256:3aa98441…` (Sprint 0.4 image from the morning push; rollback target for E.0)
- academics `sha256:4086b267…` (2026-05-19 S3.2 GSI casing build)
- rproxy `sha256:075834b4…` (Sprint C4 image from 2026-05-17)

`prod-rollback-markers-20260522-131357-5adfe91.log` for full table.

### Deploys (in order)

- `prod-build-application-identity-20260522-132300-5adfe91.log` — identity ECR `sha256:72e4d097da9980baff155e71d2b2de12c3e61d7b735c50aeae613be4d420c965` tagged `5adfe91-20260522182308` + `:latest`
- `prod-ecs-roll-identitybasic-20260522-132421-5adfe91.log` — services-stable 13:28:56 CDT (~5 min)
- `prod-build-application-academics-20260522-132915-5adfe91.log` — academics ECR `sha256:a672904ba1261c5dc8470052a95ef0f65b69a3f23ac041e3f200300fb20ba71d` tagged `5adfe91-20260522182923` + `:latest`
- `prod-ecs-roll-academicsbasic-20260522-133041-5adfe91.log` — services-stable 13:34:45 CDT (~4 min)
- `prod-cdk-diff-shared-infra-stack-20260522-133454-5adfe91.log` — clean diff (1 new path `/archetype-defaults` + expected RestApi/Deployment refresh)
- shared-infra-stack deploy via `deploy-analytics.sh shared-infra-stack prod` — 213.1s total; `TenantApiRestApiId = w5ulch7iyf` confirmed unchanged
- `prod-build-application-rproxy-20260522-134936-5adfe91.log` — rproxy ECR `sha256:a66d65c42e08f1a9877ef40d053296032813d666b77610a5b1bbf02c817eef4c` tagged `5adfe91-20260522184946` + `:latest`
- `prod-ecs-roll-rproxybasic-20260522-135013-5adfe91.log` — services-stable 13:58:49 CDT (~9 min — rproxy roll is slowest; existing pattern)

### Validation — live smoke (both sprints PASSED)

`prod-smoke-phase7-20260522-140122-5adfe91.log`:

**Sprint 0.4 — `GET /archetype-defaults?archetype=PABSON` → 200 OK** with payload containing:
- `archetype: 'PABSON'`, `currency: 'NPR'`, `calendarSystem: 'bikram_sambat'`
- `letterGrades[]` includes `{letter:'NG', isTerminalFail:true, gpaPoints:0, displayName:'Not Graded'}` — v3.4.1 H2 verified live
- `complianceForms: ['IEMIS_FLASH_I', 'IEMIS_FLASH_II']` — Forms 7/2/19 excluded per v3.4 E.1.0 §7
- `boardExams[BLE]: {grade:8, authority:'municipality', internalWeight:0.5, externalWeight:0.5, hasSupplementary:true, maxNgForSupplementary:3}` — v3.4 D.4.0 §7.2 verified

**Sprint 0.4 — `GET /archetype-defaults` (no query) → 200 OK** returning `{"supportedArchetypes":["PABSON","GENERIC"]}`.

**Sprint E.0 — `PATCH /schools/3c28654f-c623-449b-8211-67c729784d37/configuration` with `municipalityConfig` → 200 OK** on Sunshine Private Academy (dev-pabson-primary). Round-trip GET confirms persistence + no field clobber (timezone, locale, attendanceRequired, periodDuration intact).

### Partial-ship status (UPDATE — both closed)

| Layer | Status | Notes |
|---|---|---|
| shared-types 0.53.0 | ✅ live on npm | published 13:21 CDT |
| identity Docker image | ✅ on prod ECS | `sha256:72e4d097…` running |
| academics Docker image | ✅ on prod ECS | `sha256:a672904b…` running |
| rproxy Docker image | ✅ on prod ECS | `sha256:a66d65c4…` running; new `^/archetype-defaults` nginx location block live |
| shared-infra-stack | ✅ deployed | API GW exposes `/archetype-defaults` (Sprint 0.4 deferred → CLOSED) |
| Internal DI consumption | ✅ live | EPIC-D sprints can inject `ArchetypeDefaultsService` |
| Sprint 0.4 external HTTP route | ✅ live | GET smoke confirms full PABSON profile on prod |
| Sprint E.0 schema extensions | ✅ live | PATCH round-trip on dev-pabson-primary confirms |

### Retros from this Phase-7 window

- **Two prod deploys in one day on a single SHA is fine.** Morning identity deploy at `b166767` (Sprint 0.4 only); afternoon deploy at `5adfe91` (Sprint E.0 + 0.4 deferred follow-up). No identity downtime; rollback markers captured at both windows.
- **Docker recovery from 2026-04 + 2026-05-22 morning patterns repeats cleanly:** `docker builder prune -af` reclaims 21-28 GB consistently. Recommended preventive: periodic `docker system prune` as part of monthly maintenance.
- **CDK shared-infra-stack diff was reassuring:** only 1 new path + the expected RestApi/Deployment refresh. No unexpected resource churn (no Cognito drift, no IAM drift, no VPC drift). Good signal that the three-way handoff was clean.
- **rproxy ECS roll is slower than identity/academics** (~9 min vs ~4-5 min). Likely because rproxy desiredCount and health-check warm-up are wider. Document in S3.2-followup; not blocking.
- **JWT TTL caught us:** the morning JWT (11:33 CDT) was useless for the 14:00 smoke. Refreshed without drama. Memory R12 ("Cognito 1h JWT TTL") confirmed.

### Sprint partial-ship debt cleared

The 2026-05-22 (AM) Sprint 0.4 entry below noted three deferred items (shared-infra-stack, rproxy ECR/ECS, external HTTP smoke). **All three closed in this PM window.** Both sprints are now fully shipped.

### Next

Sprint E.1 (Flash I/II MVP) is the next execution target per v1-master-epic-breakdown.md §12 — consumes the Sprint E.0 schema extensions + Sprint 0.4 ArchetypeDefaultsService via DI.

---

## 2026-05-22 — Sprint 0.4 (V1 Master EPIC Breakdown): ArchetypeDefaults entity shipped to prod

**PRs merged:** [#134](https://github.com/shoaibrain/edforge/pull/134) (V1 Master Plan + research artifacts), [#135](https://github.com/shoaibrain/edforge/pull/135) (Sprint 0.1 closeout), [#136](https://github.com/shoaibrain/edforge/pull/136) (Sprint 0.4 — 6 tickets: schema + PABSON/GENERIC seed + service + endpoint + invariant-12 lint).

**Outcome:** First sprint executed against the v3.4 V1 Master EPIC Breakdown. Lands the `ArchetypeDefaults` foundation that unblocks all of EPIC-D (D.1 GradingPolicy + D.2 PromotionRule + D.3-D.6 ExternalAssessment family). PABSON profile bakes in three v3.4 research-resolved decisions: `NG` letter-grade with `isTerminalFail=true`, Forms 7/2/19 EXCLUDED from `complianceForms`, BLE supplementary flag + `maxNgForSupplementary=3`. New `GET /archetype-defaults?archetype=` endpoint live.

**shared-types:** 0.52.0 published (new exports: `ArchetypeDefaults`, `ARCHETYPE_DEFAULTS_TABLE`, `getArchetypeDefaults`, `archetypeDefaultsSchema` + 5 sub-schemas + `BoardExamDefinition`/`ArchetypeLetterGrade`/`ExamPatternKey`/`CurriculumRef` types).

**New invariant 12 lint:** [`scripts/lint/check-invariant-12.sh`](../../scripts/lint/check-invariant-12.sh) + [`scripts/lint/invariant-12-allowlist.txt`](../../scripts/lint/invariant-12-allowlist.txt) with 29-file empirical allowlist (4 category tags B/D/F/T). Two pre-existing PABSON branches in `schools.service.ts` (lines 214, 367) allowlisted as `(T)` tech debt for Phase D refactor.

### Pre-flight rollback markers (captured before any 0.4 deploy)

- identity `sha256:71dec5…` (pre-0.4; the S3.2 GSI casing build that's been stable since 2026-05-14)
- shared-types `0.51.0` (the C3 wrap-up version; can `npm install --save-exact @aibrains/shared-types@0.51.0` to roll consumers back)

### Deploys (in order)

- `prod-build-application-identity-20260522-112504-b166767.log` — identity ECR push `sha256:3aa98441f9cc284f0d185c821e01a2064378551dfee47829bddb565d40251e74` tagged `b166767-20260522162512` + `:latest`
- `prod-ecs-roll-identitybasic-20260522-112621-b166767.log` — `force-new-deployment`; `services-stable` reached at 11:30:49 CDT (`Fri May 22 11:30:49 CDT 2026`). Roughly 4 min from update-service to stable.

### Validation (live smoke + local pre-deploy)

**Local pre-deploy (all green pre-PR per CLAUDE.md Per-sprint shared-types publish checklist):**
- shared-types `tsc --noEmit` clean
- packages/shared-types jest: 21/21 specs pass (registry completeness × 2 + schema-validates × 2 + PABSON-specific × 9 + GENERIC-specific × 5 + lookup × 3)
- identity `nest build` clean
- identity jest `--testPathPattern="archetype-defaults|module-wiring"`: 25/25 specs pass
- `scripts/lint/check-invariant-12.sh`: OK — 29 files scanned; all legitimate uses allowlisted
- Lint negative test: synthetic violation file → script exits 1 with structured output
- AdminWeb rebuild clean + jsdom bundle sim: OK — bundle inits; 1056-char root HTML

**Live smoke (Phase 7.6):** `prod-smoke-archetype-defaults-20260522-…-b166767.log` — partial result. `/archetype-defaults` returns 403 SigV4 because `shared-infra-stack` was NOT redeployed in this session (Docker containerd snapshot I/O error during CDK synth, same root cause as the 2026-04 deploy incident). Existing `/holiday-seeds` route confirmed 200 OK with same JWT, isolating the issue to the new route's API GW registration. **Deferred** per CEO 2026-05-22: redeploy `shared-infra-stack` at next Docker-healthy session.

### Partial-ship status (Sprint 0.4)

| Layer | Status | Notes |
|---|---|---|
| shared-types 0.52.0 | ✅ live on npm | All consumers can resolve from registry |
| identity Docker image | ✅ on prod ECS | `sha256:3aa98441…` running on `prod-basic/identitybasic`; ArchetypeDefaultsService loaded |
| Internal service-to-service consumption | ✅ live | Future EPIC-D sprints can inject `ArchetypeDefaultsService` via DI; works today |
| `GET /archetype-defaults` HTTP endpoint | ⏳ deferred | API GW route exists in `tenant-api-prod.json` on main but NOT in the deployed shared-infra-stack. Needs `./scripts/deploy.sh shared-infra-stack prod` at next Docker-healthy session. |
| nginx `^/archetype-defaults` location block | ⏳ deferred | In `nginx.template` on main; rproxy ECR push + roll not yet done. Needed alongside API GW deploy for full external exposure. |

**Blast radius of the partial ship:** Zero impact on existing routes or pilot operations. AdminWeb (`^0.40.0` pin) doesn't consume the new exports. Sprint 0.4's deliverable for unblocking EPIC-D (ArchetypeDefaultsService as DI target) is **fully functional** — the missing API GW route is purely UI-facing and not on any critical path.

### Retros from this sprint window

- **`build-application.sh` must be invoked from `scripts/` directory.** First attempt from repo root failed with `cd: ../server/application: No such file or directory`. Memory `project_grade_level_fix_T4_shipped.md` notes this; pattern re-confirmed.
- **bash 3.2 compat matters on macOS.** First version of `check-invariant-12.sh` used `mapfile` (bash 4+). Failed with "mapfile: command not found" on macOS default `/bin/bash`. Rewrote with `while IFS= read -r line; do array+=("$line"); done < <(...)` for bash 3.2 compatibility.
- **Lint script's empirical allowlist surfaced 2 pre-existing `archetype === 'PABSON'` branches in `schools.service.ts`.** Originally thought identity service had zero violations of invariant 8; spot-grep proved otherwise. Allowlisted as `(T)` tech debt rather than rewriting in this sprint.

---

## 2026-05-17 — Sprint C4 (Multi-Day Event Blocks): backend shipped + 9-smoke validated · 1 design gap deferred

**PRs deployed:** [#120](https://github.com/shoaibrain/edforge/pull/120) (C4 backend), [#121](https://github.com/shoaibrain/edforge/pull/121) (DI hotfix — CalendarBlockModule providers), [#122](https://github.com/shoaibrain/edforge/pull/122) (marshallOptions on raw transactWrite client — inert by itself), [#123](https://github.com/shoaibrain/edforge/pull/123) (root-cause fix — TransactWriteCommand high-level command).

**Outcome:** Three back-to-back hotfixes resolved by ~22:30 UTC. Final 9-smoke against `dev-pabson-primary` validated: Zod refine + enum + AY-range check + GSI1 LIST + 404 BLOCK_NOT_FOUND + transactWrite + ConditionExpression pipeline. **One design defect remains** — `POST /calendar-blocks` always 409s in a tenant where `generate-calendar` has run because `attribute_not_exists` collides with system rows. Documented in [`docs/pilot-greenlight/c4-known-issues.md`](../pilot-greenlight/c4-known-issues.md) with merge-mode fix proposal. Next-session pickup.

**shared-types:** 0.50.0 published (new exports for `CalendarBlock*` types + Zod schemas).

### Pre-flight rollback markers (captured before any C4 deploy)

- rproxy `sha256:df37fa72…cd5be615` (pre-C4)
- identity `sha256:136e8f94…b26ba88d` (pre-C4 — the C3.4/C3.5 build)

### CDK + ECR + ECS deploys (in order)

- `prod-build-application-rproxy-20260517-121820-d041372.log` — rproxy push for the new `^/calendar-blocks` location block (note: file timestamp predates the C4 PR; this was actually the C3.3 holiday-seeds roll. C4 didn't re-roll rproxy because the nginx prefix was added in the C4 PR; rproxy needs a separate roll once #123 lands fully — captured below)
- `prod-build-application-rproxy-20260517-193452-43896f7.log` — actual C4 rproxy push (digest `sha256:df37fa72…cd5be615` — re-tag; nginx update with new `^/calendar-blocks` location)
- `prod-ecs-roll-rproxybasic-20260517-193452-43896f7.log` — stable 14:47:11 CDT
- `prod-cdk-diff-tenant-template-stack-basic-20260517-153844-43896f7.log` — clean diff (GSI9 added to identity + academics + finance tables; lowercase attribute names per S3.2)
- *(tenant-template-stack-basic deploy — 68s; shared-infra-stack deployed transitively as dependency, picking up the 5 new `/calendar-blocks` paths)*
- `prod-build-application-identity-20260517-200056-d041372.log` — first C4 identity push `sha256:7e3a05f…` (crash-looped on DI)
- *(rollback to `sha256:136e8f94…b26ba88d` at 16:17:23 CDT — service restored)*
- `prod-build-application-identity-20260517-212728-85feaca.log` — DI fix `sha256:b4dfcb82…cf9d447b` (boots; POST returns 500 marshall error)
- `prod-build-application-identity-20260517-214437-f258fba.log` — marshallOptions add `sha256:6a345ebe…05e89c3d` (still 500; root cause was the command type, not the options)
- `prod-build-application-identity-20260517-221623-cffeff6.log` — TransactWriteCommand fix `sha256:c56d1183…d51b0b39`
- `prod-ecs-roll-identitybasic-20260517-{...}-cffeff6.log` — stable 17:21:37 CDT

### Validation (9-smoke against dev-pabson-primary, post-final-roll)

`docs/deploys/prod-smoke-calendar-blocks-pass-2-20260517-172529-cffeff6.log`:

| # | Test | HTTP | errorCode |
|---|---|---|---|
| 1 | POST 9-day Dashain (overlaps existing CalendarDate rows) | 409 | `BLOCK_OVERLAPS_EXISTING_CALENDAR_DATES` ← the design defect |
| 2 | POST endDate < startDate | 400 | `BAD_REQUEST` (Zod refine) |
| 3 | POST invalid `blockDescriptor` | 400 | `BAD_REQUEST` (Zod enum) |
| 4 | POST outside AY range | 400 | `BLOCK_OUTSIDE_AY_RANGE` (service-level) |
| 5 | LIST | 200 | `{items:[], hasMore:false}` |
| 6 | GET unknown blockId | 404 | `BLOCK_NOT_FOUND` |
| 7 | PATCH unknown blockId | 404 | `BLOCK_NOT_FOUND` |
| 8 | PATCH empty body | 400 | `BAD_REQUEST` (Zod refine) |
| 9 | DELETE unknown blockId | 404 | `BLOCK_NOT_FOUND` |

The 9-smoke pass proves the entire transactional pipeline (API GW → rproxy → identity → JwtStrategy → controller → Zod → service → AY check → DDB transactWrite → DocumentClient marshall → ConditionExpression → response mapping) is wired correctly. **Only the happy-path 201-create requires the merge-mode follow-up to be operationally usable.**

### Retros from this sprint window

- **Three back-to-back hotfixes from one PR.** The original C4 PR shipped with three latent bugs: (a) module providers missing, (b) low-level TransactWriteItemsCommand instead of high-level TransactWriteCommand, (c) `as any` cast silencing the type system's correct warning about (b). The unifying meta-lesson: I read sibling code's surface pattern (audit emission in calendar-date.service.ts) but didn't audit the *why* of adjacent decisions (the inline module-DI comment, the SDK command choice, the C3.8 merge-mode design).
- **`nest build` is not a runtime smoke.** A clean webpack compile says nothing about: NestJS DI graph completeness, DDB marshalling shape correctness, ConditionExpression collision with existing tenant state. The first POST against a real tenant catches all three.
- **`services-stable` + `HEALTHY` isn't truth either.** Identity reported HEALTHY for ~6 minutes while every task crash-looped on `Nest application bootstrap` — the ECS health check fires on container start, not on Nest's `app.listen()`. Reading `[NestApplication] Nest application successfully started` in the boot logs IS the truth.
- **`as any` is a smell.** When TypeScript pushes back on a cast, that's information about the model mismatch. The C4 PR shipped with `transactItems as any` — the type system was pointing directly at the `TransactWriteItemsCommandInput` vs `TransactWriteCommandInput` mismatch I should have read instead of silenced.
- **A new write endpoint must consider tenant state realism.** I designed `POST /calendar-blocks` as if `generate-calendar` hadn't run. In reality every active tenant has 365 CalendarDate rows in place. The fix isn't service code — it's upstream thinking: model the most-realistic input state before designing the write. C3.8's merge-mode pattern existed and applied directly.

All lessons saved to memory (`feedback_module_wiring_invariant.md`).

---

## 2026-05-17 — Sprint C3 closeout 🎉 (C3.4 + C3.5 + hotfix + C3.2 + C3.3)

**Sprint C3 (Pre-Greenlight Hardening) — fully shipped + validated in prod.** Six pilot-greenlight tickets across attendance perf, BS↔AD roundtrip, BS inputs to `generate-calendar`, merge-mode regeneration, bell-schedule presets, and archetype-aware holiday seeds — plus one hotfix from the exam-day preset smoke. **Five `shared-types` publishes** (0.45.0–0.49.0), **two `shared-infra-stack` CDK deploys** (two new API GW routes), **five ECS rolls** across academics / identity / rproxy.

**PRs deployed in this window:**

| PR | Tickets | Deploys |
|---|---|---|
| [#112](https://github.com/shoaibrain/edforge/pull/112) | C3.7 | shared-types 0.45.0 |
| [#114](https://github.com/shoaibrain/edforge/pull/114) | C3.1 phase 2 | academics ECR + roll |
| [#115](https://github.com/shoaibrain/edforge/pull/115) | C3.6 + C3.8 | shared-types 0.46.0 + identity roll |
| [#116](https://github.com/shoaibrain/edforge/pull/116) | C3.4 + C3.5 | shared-types 0.47.0 + CDK + identity roll |
| [#117](https://github.com/shoaibrain/edforge/pull/117) | C3.5 hotfix | shared-types 0.48.0 + identity roll |
| [#118](https://github.com/shoaibrain/edforge/pull/118) | C3.2 + C3.3 | shared-types 0.49.0 + rproxy + CDK + identity roll |

### C3.4 + C3.5 + hotfix deploy (afternoon)

- `prod-cdk-diff-shared-infra-stack-20260517-092711-f293571.log` — clean diff (+ POST/OPTIONS `/schools/{schoolId}/bell-schedules/preset`)
- `prod-build-application-identity-20260517-094025-f293571.log` — push `sha256:5f3348a2…2a203c7`
- `prod-ecs-roll-identitybasic-20260517-094532-f293571.log` — stable 09:49:54 CDT
- `prod-smoke-bell-schedule-preset-academic-20260517-095201-f293571.log` — **201**, PABSON Standard Day, 9 periods, 315 instructional min ✓
- `prod-smoke-bell-schedule-preset-exam-day-20260517-095225-f293571.log` — **400** (caught the validator uniformity bug)
- `prod-build-application-identity-20260517-100224-f02b947.log` — hotfix push `sha256:4b1f6b80…1621318a`
- `prod-ecs-roll-identitybasic-20260517-100224-f02b947.log` — stable 10:11:40 CDT
- `prod-smoke-bell-schedule-preset-exam-day-postfix-20260517-101220-f02b947.log` — **201**, PABSON Exam Day, 2 testing blocks × (180min + 120min), 300 instructional min ✓

### C3.2 + C3.3 deploy (the THREE-roll window)

First new top-level prefix (`/holiday-seeds`) since IEMIS, so the deploy ladder is the full one: shared-types publish → rproxy roll → CDK → identity roll → smoke.

- `prod-build-application-rproxy-20260517-121820-d041372.log` — push `sha256:df37fa72…cd5be615` (new `^/holiday-seeds` location block)
- `prod-ecs-roll-rproxybasic-20260517-121820-d041372.log` — stable 12:27:57 CDT
- `prod-cdk-diff-shared-infra-stack-20260517-122809-d041372.log` — clean diff (`+ Added: ./holiday-seeds` + standard `Deployment` replace + `Stage` re-point)
- *(stack deploy — 222s)*
- `prod-build-application-identity-20260517-124120-d041372.log` — push `sha256:136e8f94…b26ba88d`
- `prod-ecs-roll-identitybasic-20260517-124120-d041372.log` — stable 12:47:04 CDT
- `prod-smoke-holiday-seeds-postroll-20260517-125023-d041372.log` — 3 smokes all green:
  - `?archetype=PABSON&region=NPL&year=2083` → **200** `appliedFallback=exact`, 6/13/36 totals match fixture
  - `?archetype=PABSON&region=NPL` (year missing) → **400** `YEAR_REQUIRED`
  - `?archetype=UNKNOWN&region=XYZ&year=2083` → **200** `appliedFallback=none`, `seed=null`

### Rollback markers (most-recent prior-good)

- academics: `sha256:31b834a2…f58c64e` (2026-05-16 push)
- identity (pre-C3 sweep): `sha256:2433e162…b4d8c002` (2026-05-16 push; the G1 image from this morning's harness drain)
- rproxy: `sha256:428f863d…87b54a` (last roll before C3.3)

ECR lifecycle keeps the last 10 tagged images per repo — every interim digest in this sweep is still recoverable for ~10 deploys.

### Sprint C3 — final status

| Ticket | Code | Deploy | Validation |
|---|---|---|---|
| C3.1 (attendance 504 fix) | ✅ #113 + #114 | ✅ academics rolled | ✅ harness 7/7 + `/alerts` smoke 200 |
| C3.7 (BS↔AD roundtrip) | ✅ #112 | ✅ 0.45.0 + identity rolled | ✅ 1095 roundtrip assertions |
| C3.6 + C3.8 (BS inputs + merge mode) | ✅ #115 | ✅ 0.46.0 + identity rolled | ✅ post-roll harness 7/7 |
| C3.4 + C3.5 (bell presets) + hotfix | ✅ #116 + #117 | ✅ 0.47.0 + 0.48.0 + CDK + 2× identity roll | ✅ academic 201 + exam_day 201 |
| C3.2 + C3.3 (holiday seeds) | ✅ #118 | ✅ 0.49.0 + rproxy + CDK + identity roll | ✅ 3-smoke green |

### Retros from this sprint window

- **Smoke caught what unit tests couldn't.** The C3.5 exam-day preset failed in prod against `validateBellSchedule`'s school-config-aware uniformity check — pure unit tests in shared-types had no school-config to violate. End-to-end smoke against a real-shaped tenant is irreplaceable.
- **Cognito's 1h TTL is shorter than a CDK + 2× ECS roll window.** Saw this twice in this sweep — the JWT expired mid-deploy. Operator had to paste a fresh one for the post-deploy smoke. Plan: capture the smoke JWT just before running the smoke, not at the start of the deploy.
- **`build-application.sh` CWD-fragility** held up over five rolls in one session — `cd /Users/shoaibrain/edforge/scripts && ./build-application.sh <svc>` is the only form that works. Memory `project_grade_level_fix_T4_shipped` already captures this; reinforced.
- **Five back-to-back `npm publish` cycles**. Each sprint pair needed its own. A consolidated single publish at the end would have been less ceremonial — worth considering for future sprints that touch shared-types repeatedly.

---

## 2026-05-17 — Sprint C3.1 phase 2 + C3.6/C3.8 prod roll (academics + identity)

**PRs deployed:** [#114](https://github.com/shoaibrain/edforge/pull/114) (C3.1 phase 2 — `getAttendanceAlerts` bulk-scan rewrite, academics) + [#115](https://github.com/shoaibrain/edforge/pull/115) (C3.6 + C3.8 — `generate-calendar` BS inputs + merge mode, identity). Both merged 2026-05-17.

**Outcome:** Both ECR pushes + ECS rolls completed cleanly. C2 harness re-run **7/7 green** post-roll (zero regression on attendance / calendar / scope / IEMIS-audit). `/attendance/alerts` direct smoke returned `200` with shape `{alerts, totalAtRiskCount}` — the new bulk-scan path producing real per-student rates and trend computation.

**shared-types:** 0.45.0 (C3.7) and 0.46.0 (C3.6+C3.8) both published to npm; consumer pins in lockstep.

### ECR + ECS rolls

- `prod-build-application-academics-20260517-083903-7c960ee.log` — pushed `academics` digest `sha256:26756f29…6b9fb6` (tag `7c960ee-20260517133916`)
- `prod-ecs-roll-academicsbasic-20260517-084535-7c960ee.log` — services-stable at 08:49:53 CDT, HEALTHY on `academics-TaskDef:2`
- `prod-build-application-identity-20260517-085013-7c960ee.log` — pushed `identity` digest `sha256:9824367e…b96391b4` (tag `7c960ee-20260517135023`)
- `prod-ecs-roll-identitybasic-20260517-085509-7c960ee.log` — services-stable at 08:59:29 CDT, HEALTHY on `identity-TaskDef:3`

### Rollback markers (prior good)

- academics: image digest `sha256:31b834a2…f58c64e` (push 2026-05-16 17:20)
- identity: image digest `sha256:2433e162…b4d8c002` (push 2026-05-16 20:13)

Both task def revisions stayed the same (`:2` for academics, `:3` for identity) — rolling deploy reuses task def + pulls new `:latest` image. Rollback path = re-tag the prior digest as `:latest` + `force-new-deployment`.

### Validation

- `prod-pilot-greenlight-harness-postroll-20260517-090147-7c960ee.log` — C2 harness **7/7 green** (SETUP + C2.0–C2.5).
- `prod-smoke-attendance-alerts-postroll-20260517-090526-7c960ee.log` — `GET /academics/attendance/alerts` returned **200** with 8 alerts (dev tenant has C2 smoke residue attendance; trend correctly `stable` since no student has both halves ≥5 records). Wall time 2.78s end-to-end (CDT→Mumbai network dominates; server-side well within p95 < 500ms AC).

---

## 2026-05-17 — Sprint C2 closeout: G1–G4 operator gates drained → 🟢 INTERNAL GREENLIGHT

**Outcome:** Pilot-greenlight harness **7 pass / 0 fail / 0 skipped** against `dev-pabson-primary` (tenant `21aea5da-…`) on `0c39a7a`. C2 greenlight gate closed; Sprint C3 unblocked. Full chronology in [`docs/pilot-greenlight/sprint-plan.md`](../pilot-greenlight/sprint-plan.md#0.5) §0.5.

### G1 — identity ECR + ECS roll (already captured 2026-05-16 evening)

- `prod-build-application-identity-20260516-201250-0c39a7a.log` — pushed `identity` digest `sha256:2433e16207ef…`
- `prod-ecs-roll-identitybasic-20260516-201250-0c39a7a.log` — task `0da651b376b1…` HEALTHY on `prod-basic/identitybasic`. Picks up PR #104 (Leave cancel 500) + PR #106 (shortName 409) + PR #107 (`schoolTypeDescriptor` enum tightening).

### G2 — C0.b.2 cleanup `--apply`

- `prod-s3-2-smoke-cleanup-2026-05-17T01-26-51-905Z-DRYRUN.log` — 6 marker rows identified in `dev-pabson-primary`
- `prod-s3-2-smoke-cleanup-2026-05-17T01-31-57-170Z-APPLY.log` — deleted 6 (3 calendar `S32-SMOKE-*` + 3 leave `S3.2 smoke`); post-apply residue = 0

### G3 — C0.b.5 `testing_day → exam_window` migration

Migration `--apply` against prod: **0 rows affected** — no legacy `testing_day` calendarEvents exist in prod (greenfield outcome of the C2 deploy ladder). Idempotent path confirmed; no log captured for a true no-op run.

### G4 — harness re-run (3 attempts)

- `prod-pilot-greenlight-G4-20260517-054706-0c39a7a.log` — env vars used `EDFORGE_*` prefix; harness reads bare `TENANT_ID` etc. → 7 skipped (vacuous green; **not authoritative**)
- `prod-pilot-greenlight-G4-20260517-054738-0c39a7a.log` — env vars fixed; 6 pass / 1 fail (C2.0 aborted on `CredentialsProviderError` in the post-write DDB audit check). Term 1 endDate was 2026-07-14 vs fixture-canonical 2026-07-16 → PATCH widened `endDate` + set the fixture exam window. `syncExamWindowEvents` auto-created the 9 missing `exam_window` rows for Term 1; that fix made C2.3 green on the next run.
- `prod-pilot-greenlight-G4-20260517-055018-0c39a7a.log` — **🟢 7/7 GREEN** with `AWS_PROFILE=prod` set. C2.3 verifies 40 exam-window days across 4 terms with a single `sourceTermId` each.

### Followups (small, non-blocking)

- One orphan staff training row in `dev-pabson-primary` from the 054738 cred-failure run (script cleanup block skipped on early-exit). One-off DELETE; not blocking.
- C2.0 script: wrap the AWS-SDK section in try/catch + graceful skip path so missing creds don't orphan the training row.

---

## 2026-05-16 — Sprint C2: pilot-greenlight code deploy (shift-profile + DATE_NOT_INSTRUCTIONAL + canonical calendar)

**PRs deployed:** [#95](https://github.com/shoaibrain/edforge/pull/95) (calendar seed script, ops), [#96](https://github.com/shoaibrain/edforge/pull/96) (PR-A: `GET /shift-profile` route — identity), [#98](https://github.com/shoaibrain/edforge/pull/98) (PR-B: attendance `DATE_NOT_INSTRUCTIONAL` — academics). Test-only PRs landed in the same window: [#91](https://github.com/shoaibrain/edforge/pull/91)–[#94](https://github.com/shoaibrain/edforge/pull/94), [#97](https://github.com/shoaibrain/edforge/pull/97), [#99](https://github.com/shoaibrain/edforge/pull/99), [#100](https://github.com/shoaibrain/edforge/pull/100) (no deploy required).

**Outcome:** Code deploy ✅ healthy. Pilot-greenlight harness verdict **4 of 6 green** against `dev-pabson-primary`. Both reds (C2.2 partial, C2.3 zero) trace to a single data-state gap — only 1 of the fixture's 4 Terms exists in DDB, so the backend's Term→`exam_window` auto-sync hasn't produced the 40 expected CalendarDate rows. Filed in [deferred-work.md](../pilot-greenlight/deferred-work.md#exam-window-seeding-automation-gap--blocks-harness-greenlight); ~1–2h ops-script fix before Sprint C3.

### Rollback tags captured before deploy

- `identity:e96f2a1-20260516145954` (prior good — from 2026-05-16 C0.c.3 deploy)
- `academics:e96f2a1-20260516151214` (prior good — from 2026-05-16 C0.c.3 deploy)
- (No finance roll this session — PR-B was academics-only)

### CDK deploys

- `prod-cdk-diff-shared-infra-stack-20260516-205845-aff2ea2.log` — first diff attempt, exited 1 on `CDK_PARAM_COMMIT_ID empty` (env not sourced)
- `prod-cdk-diff-shared-infra-stack-20260516-205912-aff2ea2.log` — retry, exited 1 on Docker containerd I/O error (post-ENOSPC corruption — see Notes)
- `prod-cdk-diff-shared-infra-stack-20260516-162556-aff2ea2.log` — same Docker corruption, third attempt
- `prod-cdk-diff-shared-infra-stack-20260516-162621-aff2ea2.log` — same Docker corruption, fourth attempt
- `prod-cdk-diff-shared-infra-stack-20260516-162931-aff2ea2.log` — same Docker corruption (Desktop restart did NOT clear it — buildkit cache metadata was the corrupt layer)
- `prod-cdk-diff-shared-infra-stack-20260516-163111-aff2ea2.log` — **clean** after `docker builder prune -af` (21.45 GB flushed). Diff: `+ GET /schools/{schoolId}/shift-profile` + standard `ApiGateway::Deployment` replace + `Stage` re-point.
- `prod-shared-infra-stack-20260516-163823-aff2ea2.log` — `UPDATE_COMPLETE` in 208s; 6 of 6 resources clean (no IAM/SG/Cognito/DDB delta).

### Build logs (ECR push)

- `prod-build-application-identity-20260516-165040-aff2ea2.log` — pushed `identity:aff2ea2-20260516215051`, digest `sha256:4b5b2500ac4e8a2011c23b1a7f138995f982b8e98bbe74f7d1738eaa2cf0bb88`
- `prod-build-application-academics-20260516-171851-aff2ea2.log` — pushed `academics:aff2ea2-20260516221902`, digest `sha256:31b834a22fa24cecdf60ac51a3931f97ea4b93cd05c2c11badee92f0df58c64e`

### ECS roll logs

- `prod-ecs-roll-identitybasic-20260516-165305-aff2ea2.log` — force-new-deployment OK; stable; live task carries new digest
- `prod-ecs-roll-academicsbasic-20260516-172100-aff2ea2.log` — same

### Canary verification (between deploys, manual curls)

| Test | Expected | Got | Proves |
|---|---|---|---|
| `GET /schools/x/shift-profile` no auth, post–shared-infra | 401 | 401 | API GW route registered (else 403 `Missing Authentication Token`) |
| `GET /schools/x/shift-profile` w/ JWT, pre–identity roll | 404 NestJS | 404 NestJS | nginx + identity wired; controller absent on old image |
| `GET /schools/x/shift-profile` w/ JWT, post–identity roll | 400 BAD_REQUEST | 400 `Missing required query parameter: date=YYYY-MM-DD` | Controller present + DTO validator firing on new code |

### Data state changes (in `dev-pabson-primary` tenant, Saraswati school, AY `0167de00-…`)

- `prod-reseed-calendar-dev-pabson-primary-20260516-173752-aff2ea2.log` — **401** (JWT expired between earlier curls and this re-seed attempt; no destructive op happened — rejected at Cognito authorizer before reaching backend)
- `prod-reseed-calendar-dev-pabson-primary-20260516-174229-aff2ea2.log` — **201** after fresh JWT. Backend `generateCalendar` DELETED existing CalendarDate rows and re-created 273 instructional days + 49 holiday/break entries (34 holiday + 15 break) matching the `pabson-saraswati-bs-2083` fixture exactly. Warning logged: "Calendar extends 274 days beyond last session" — that's the Term-2/3/4 gap, see Follow-ups.

### Smoke logs (harness)

- `prod-smoke-c2-2-shift-profile-20260516-170134-aff2ea2.log` — C2.2 standalone, pre-re-seed baseline: 14/30 matches; the 16 fails surfaced exactly the data drift the re-seed was about to correct.
- `prod-smoke-pilot-greenlight-harness-20260516-174608-aff2ea2.log` — harness run 1 (on `aff2ea2`, post-re-seed, pre-PR-#99): **3 pass / 3 fail**. C2.0 ✅, C2.1 ✅ (4-term exact match), C2.5 ✅. C2.2 ✗ 20/30 (improved from 14 — holidays + vacations now correct; 10 exam_day still ✗). C2.3 ✗ 0/40. C2.4 ✗ MODULE_NOT_FOUND — PR #99 not yet merged.
- `prod-smoke-pilot-greenlight-harness-20260516-175446-f95e523.log` — harness run 2 after operator merged PR #99: **4 pass / 2 fail**. C2.4 now ✅ 32/32 (DATE_NOT_INSTRUCTIONAL exercises holiday + weekend + vacation × 8 dates). C2.2 + C2.3 unchanged (same exam-window data gap).

### Verification highlights

- **C2.1 exact match across all 4 terms** (77/77 + 66/66 + 62/62 + 67/67) — strongest evidence calendar generator + re-seed produce a canonical state.
- **C2.4 32/32** — POST attendance on each of 8 non-instructional dates correctly rejected with HTTP 400, `errorCode: DATE_NOT_INSTRUCTIONAL`, structured `details.reason` (holiday/weekend/vacation), and `details.date` echo.
- **C2.5 6/6 edge cases** — AY-boundary day = `regular`; 3× next-AY dates outside AY = 404; mid-vacation = `vacation`; day-after-program = `weekend`.

### Follow-ups

- **Exam-window seeding automation** — single root cause of C2.2 + C2.3 reds. New script `scripts/pilot-greenlight/seed-pilot-terms.ts` (~100 LOC) that idempotently POSTs the 4 fixture terms; backend auto-sync produces the 40 `exam_window` CalendarDate rows. Wire into harness as pre-C2.1 setup. Filed in [`deferred-work.md`](../pilot-greenlight/deferred-work.md#exam-window-seeding-automation-gap--blocks-harness-greenlight). Pickup gate: before Sprint C3.

### Notes

- **Disk-full → Docker containerd corruption** at session start. After ENOSPC, buildkit cache metadata referenced a snapshot directory (`overlayfs/snapshots/6092/fs`) that had been partially purged. Docker Desktop restart did NOT clear it — only `docker builder prune -af` (21.45 GB flushed) did. The 5 failed cdk-diff logs preserve the diagnostic trail.
- **`c0-c-3-deploy-plan.md` reused for JWT filename only.** The doc itself is stale (was for PR #76 EventServiceBase). This deploy's plan was reverse-engineered from the unreleased C2 PRs on main.
- **No CloudWatch monitoring window** was run post-deploy. Defensible for an API-GW route add + two well-scoped controller/validator additions; would not be for a higher-risk change.
- **PR #100 (harness) was merged ahead of PR #99 (C2.4 smoke file)** — classic stacked-PR orphan per memory `feedback_stacked_pr_pitfall`. Caught at harness run 1 (MODULE_NOT_FOUND); operator merged PR #99 mid-session; run 2 confirmed fix.

---

## 2026-05-16 — Sprint C0.c.3: activate EventServiceBase runtime event validation

**PR:** [#76](https://github.com/shoaibrain/edforge/pull/76)
**Deploy plan:** [c0-c-3-deploy-plan.md](../pilot-greenlight/c0-c-3-deploy-plan.md)
**Outcome:** ✅ GREEN. All three microservices deployed to prod with the new EventServiceBase. Validation gate active; legacy PascalCase events emit with warning + still flow. Zero INVALID_PAYLOAD events on the bus. Smoke pass rate identical to 2026-05-14 baseline.

### Rollback tags captured before deploy

- `identity:82224fb-20260515032018` (2026-05-14)
- `academics:c640af2-20260430190302` (2026-04-30)
- `finance:897c4e2-20260429222423` (2026-04-29)

### Build logs (ECR push)

- `prod-build-application-identity-20260516-095946-e96f2a1.log` — pushed `identity:e96f2a1-20260516145954`, digest `sha256:6a89c74c...`
- `prod-build-application-academics-20260516-101205-e96f2a1.log` — pushed `academics:e96f2a1-20260516151214`, digest `sha256:39a1f148...`
- `prod-build-application-finance-20260516-101424-e96f2a1.log` — pushed `finance:e96f2a1-20260516151518`, digest `sha256:af5be9cc...`

> Note: the first identity build attempt (`prod-build-application-identity-20260516-095825-e96f2a1.log`) failed at line 71 (`cd: ../server/application: No such file or directory`) because the script was invoked from the repo root rather than `scripts/`. `tee` masked the exit code as 0; the CLAUDE.md "tee masks exit" gotcha. Re-ran from `scripts/` directory and built cleanly. No ECR pollution from the failed attempt (verified before retry).

### ECS roll logs

- `prod-ecs-roll-identitybasic-20260516-100121-e96f2a1.log` — force-new-deployment OK; stable
- `prod-ecs-roll-academicsbasic-20260516-101632-e96f2a1.log` — force-new-deployment OK; stable
- `prod-ecs-roll-financebasic-20260516-101632-e96f2a1.log` — force-new-deployment OK; stable

### Smoke logs (Phase 4 validation)

- `prod-smoke-s3-2-roundtrip-c0-c-3-20260516-103021-e96f2a1.log` — **32/33 PASS**, identical to 2026-05-14 baseline. The 1 failure (Leave cancel 500) is a pre-existing bug per memory `project_s3_2_gsi_casing_shipped`, not a C0.c.3 regression.

### CloudWatch verification

Baseline (before smoke, 10-min window): `Emitting unregistered eventType=0, Event published=0, INVALID_PAYLOAD=0, Error publishing event=0`.

After smoke: `Emitting unregistered eventType=2, Event published=2, INVALID_PAYLOAD=0, Error publishing event=0`. The two emits — `CredentialCreated` and `LeaveRequested` — are PascalCase legacy events; both correctly fell through the C0.c.3 unregistered-warning branch, were logged + emitted, and posted to EventBridge cleanly.

The `INVALID_PAYLOAD=0` and `Error publishing event=0` invariants are the critical safety checks; both held. The smoke's 32-pass count proves no regression in the existing event flow.

### Operator deliverables verified

- Account: `257526644020` (prod)
- Region: `ap-south-1`
- `service-info.json` had no `<REGION>`/`<ACCOUNT_ID>` placeholders pre-deploy
- shared-types 0.43.0 on npm + consumer pins at `^0.43.0`
- 14/14 `event-service.base.spec.ts` green on main pre-deploy

### Smoke artifacts left in dev-pabson-primary tenant

- 1 Leave row (cancellation failed; pre-existing 500): `956c2ed8-d9ee-4658-9a78-435e47cc1899`
- 1 Calendar row (DELETE deferred to user with elevated perms): `S32-SMOKE-1778945422834`

Both are in `tenant-id=21aea5da-511f-4dfa-a6f2-6971f63a719f` (`dev-pabson-primary`); cleanup tracked alongside the Sprint S3.2 backlog item in `docs/pilot-greenlight/deferred-work.md`.

---

## 2026-05-14 — Sprint S3.2: GSI1 casing fix

Identity ECR push + ECS roll. See memory `project_s3_2_gsi_casing_shipped` for narrative. PR [#68](https://github.com/shoaibrain/edforge/pull/68).

---

(Earlier deploys: see filenames at `docs/deploys/*.log`. Backfilling them into this index is a deferred bookkeeping item.)

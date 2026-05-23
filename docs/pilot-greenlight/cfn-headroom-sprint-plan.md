# Sprint R41 — CFN headroom + Swagger maintainability: Sprint Plan

> **Drafted:** 2026-05-23 (v2 — supersedes the rejected programmatic-route migration draft at [routes-stack-split-sprint-plan.md](./routes-stack-split-sprint-plan.md))
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Master-plan section:** `v1-master-epic-breakdown.md` §11.2 R41 + §17.8 L6
> **Closes:** R41 (CFN ceiling) + sets up the master plan's growth trajectory (~150 more routes through end-V1) without further infra friction

---

## 0. Why this plan replaces the previous draft

The first draft proposed migrating 77 academics routes out of `tenant-api-prod.json` into a programmatic `academics-routes-stack` (mirroring analytics-stack). Sign-off feedback: *"competent solution to the wrong problem."*

The wrong problem framing: "how do we migrate routes out of inline Swagger?"
The actual problem: "how do we stop putting the entire Swagger document into the CFN template body?"

Empirical mechanism — `server/lib/shared-infra/api-gateway.ts:118-155`:
```ts
this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
  apiDefinition: apigateway.ApiDefinition.fromInline(JSON.parse(updateData)),  // ← this is the leak
  …
});
```

`fromInline()` writes the entire 750KB JSON into the `AWS::ApiGateway::RestApi.Body` CFN property. That property is what eats the 1MB CFN template ceiling.

### 0.1 Why `fromAsset` alone is not the fix (revised 2026-05-23)

My first draft of this plan claimed `ApiDefinition.fromAsset()` was a ~5 LOC swap. **It is not.** Empirical check (placeholder occurrences in `tenant-api-prod.json`):

| Placeholder | Count | Resolves to | Token? |
|---|---|---|---|
| `{{integration_uri}}` | 344 | `props.nlb.loadBalancerDnsName` | **CDK token** (per-route NLB DNS) |
| `{{connection_id}}` | 344 | `props.vpcLink.vpcLinkId` | **CDK token** (per-route VPC Link ID) |
| `{{CORS_ALLOWED_ORIGIN}}` | 215 | first CORS origin string | static |
| `{{region}}` | 2 | `cdk.Stack.of(this).region` | resolvable (env-bound) |
| `{{authorizer_function}}` | 1 | `authorizerFunction.functionName` | **CDK token** |
| `{{account_id}}` | 1 | `cdk.Stack.of(this).account` | resolvable (env-bound) |
| `{{API_TITLE}}` / `{{version}}` / `{{stage}}` | 3 | static strings | static |

689 placeholder occurrences bind to CDK tokens whose values aren't knowable until deploy time.

**Why this breaks `fromAsset`:** `fromInline()` works because CDK's CFN serializer walks the JSON object passed to it and pattern-matches `${Token[...]}` markers inside string values, rewriting them as CFN intrinsics (`Fn::GetAtt`, `Ref`, `Fn::Join`) embedded in the `Body` field at synth time. `fromAsset()` uploads the file byte-for-byte to S3; CDK's serializer never sees the file content. Any tokens in the file go to S3 as literal `${Token[TOKEN.123]}` strings, which API GW would reject.

### 0.2 The fix that actually works — Stage variables (chosen 2026-05-23)

API Gateway Stage variables substitute into integration URIs, integration connectionIds, and authorizer URIs at **request time** (well-trodden AWS feature). Rather than pre-baking token values into the Swagger, we substitute the 3 token-bearing placeholders with `${stageVariables.xxx}` markers, write the file (now containing only literal text + stage var placeholders) to S3 via `fromAsset`, and set the deployment Stage's `variables` map with the actual CDK token refs. CFN resolves the variables to their actual values at deploy time; API GW substitutes them into request paths at request time.

| Placeholder | Pre-R41.A substitution | R41.A substitution |
|---|---|---|
| `{{integration_uri}}` (344×) | `http://${Token[NLB.DNS]}` (CDK serializer rewrites at synth) | `http://${stageVariables.nlbDns}` (API GW substitutes at request time) |
| `{{connection_id}}` (344×) | `${Token[VpcLink.VpcLinkId]}` | `${stageVariables.vpcLinkId}` |
| `{{authorizer_function}}` (1×) | `${Token[Authorizer.FunctionName]}` | `${stageVariables.authorizerFn}` |
| `{{region}}`, `{{account_id}}` | resolvable (env-bound) | resolved at synth |
| `{{CORS_ALLOWED_ORIGIN}}`, `{{stage}}`, `{{API_TITLE}}`, `{{version}}` | static | substituted at synth |

The deployment Stage carries `variables: { nlbDns: props.nlb.loadBalancerDnsName, vpcLinkId: props.vpcLink.vpcLinkId, authorizerFn: authorizerFunction.functionName }` — these stay as CDK tokens (CFN resolves them at deploy time to the Stage's actual variable values).

**Behavioral semantics shift:**
- Pre-R41.A: request handling invokes the spec-baked integration URI (literal NLB DNS resolved at API GW import time)
- Post-R41.A: request handling invokes the spec template URI; API GW substitutes `${stageVariables.nlbDns}` to the current Stage's value at request time
- Net request behavior: **identical** for every endpoint
- Operational improvement: NLB DNS changes (e.g., NLB recreated) update Stage variables in the next deploy without spec re-import

The previous draft is preserved at [routes-stack-split-sprint-plan.md](./routes-stack-split-sprint-plan.md) as a record of the rejected approach. Memory written: [`feedback_check_root_cause_before_migration`](../../../../.claude/projects/-Users-shoaibrain-edforge/memory/feedback_check_root_cause_before_migration.md).

---

## 1. Diagnosis — two constraints, separable

| Constraint | Symptom | Root cause | Fix size | Roadmap impact |
|---|---|---|---|---|
| **C1 — CFN template body** | shared-infra-stack at 87.7% of 1MB; will fail between D.2 and D.3 | `fromInline()` embeds 750KB JSON into CFN `Body` | ~5 LOC | **Blocking** — D.2 onwards stall |
| **C2 — Human-diff burden** | 23,493-line JSON; every route PR is unreviewable; three-way handoff error-prone | Single monolithic Swagger file | ~2-3 days tooling | **DX tax** — not a hard blocker |
| C3 — API GW resource ceiling (300/RestApi) | Not yet hitting; ~280 expected after D-series | API GW service limit | (V1.5 decision) | Watch-list only |

**Principle:** address constraint-level mechanisms (C1: which CDK construct method delivers the spec) before designing pattern migrations (which routes go where). C1 has an L1 fix; C2 is independent and parallelizable; C3 is V1.5.

---

## 2. Solution architecture — three phases, two ships

### Phase A — R41.A — CFN headroom via Stage variables + fromAsset (THIS SPRINT; ~50-80 LOC; unblocks roadmap)

**A two-part change in one file — the substitution map shifts 3 token-bearing keys to stage-variable markers, the API definition switches to `fromAsset`, and the SpecRestApi's deployOptions carries the Stage variables map.**

Edits to `server/lib/shared-infra/api-gateway.ts`:

```ts
// (1) Substitution map — token-bearing entries become stage-variable markers.
//     Static + env-bound entries continue synth-time substitution.
const replacements: { [key: string]: string } = {
  '{{version}}': '1.0.0',
  '{{API_TITLE}}': 'EcsTenantAPI',
  '{{stage}}': props.stageName,
  '{{CORS_ALLOWED_ORIGIN}}': primaryCorsOrigin,
  '{{region}}': cdk.Stack.of(this).region,         // resolvable when env is bound
  '{{account_id}}': cdk.Stack.of(this).account,    // resolvable when env is bound
  '{{connection_id}}': '${stageVariables.vpcLinkId}',       // ← stage var
  '{{integration_uri}}': 'http://${stageVariables.nlbDns}', // ← stage var
  '{{authorizer_function}}': '${stageVariables.authorizerFn}', // ← stage var
};

// (2) Write the substituted Swagger to a file under cdk.out/ — pure text;
//     contains zero CDK tokens at this point because the 3 dynamic
//     substitutions are stage-variable strings handled by API GW at request
//     time.
const cdkOutDir = cdk.App.of(this)?.outdir ?? path.join(__dirname, '../../cdk.out');
fs.mkdirSync(cdkOutDir, { recursive: true });
const substitutedSpecPath = path.join(cdkOutDir, 'tenant-api-prod.substituted.json');
fs.writeFileSync(substitutedSpecPath, updateData, 'utf-8');

// (3) Construct the RestApi with fromAsset + deployOptions.variables
this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
  restApiName: 'TenantAPI',
  description: 'API imported from a Swagger/OpenAPI definition (loaded from S3 asset; dynamic values via Stage variables)',
  apiDefinition: apigateway.ApiDefinition.fromAsset(substitutedSpecPath),
  cloudWatchRole: true,
  deployOptions: {
    accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
    methodOptions: { '/*/*': { dataTraceEnabled: false, loggingLevel: apigateway.MethodLoggingLevel.ERROR } },
    stageName: props.stageName,
    variables: {
      vpcLinkId: props.vpcLink.vpcLinkId,
      nlbDns: props.nlb.loadBalancerDnsName,
      authorizerFn: authorizerFunction.functionName,
    },
  },
});
```

CDK uploads the substituted file to its bootstrap asset bucket at deploy time; CFN gets `BodyS3Location: { Bucket: <cdk-asset-bucket>, Key: <content-hash>.json, Version: <s3-version> }` (≤200 bytes) instead of the inline Body. shared-infra-stack template drops to <100KB total.

**Behavioral surface — what changes:**

| Layer | Pre-R41.A | Post-R41.A | Diff |
|---|---|---|---|
| `tenant-api-prod.json` source file | 750KB monolith | 750KB monolith | None |
| Placeholder substitution at synth | regex on in-memory string | regex on in-memory string + 3 stage-var markers | Substitution map: 3 keys now produce `${stageVariables.xxx}` markers |
| CFN template `Body` property | Full JSON inline (with CFN intrinsics for tokens) | (removed) | **Removed** |
| CFN template `BodyS3Location` property | (not present) | `{ Bucket, Key, Version }` | **Added (≤200 bytes)** |
| CFN template `Stage.Variables` | (not present) | `{ vpcLinkId, nlbDns, authorizerFn }` (CDK token refs) | **Added (≤300 bytes)** |
| CFN template total size | ~877KB | ~10KB (the rest of the stack) | **−867KB** |
| Deployed API GW spec — content | <750KB Swagger with literal NLB DNS / VPC Link ID / authorizer fn name baked in | <750KB Swagger with `${stageVariables.xxx}` markers in 689 places | Structural-equivalent: stage var substitution at request time produces identical URIs |
| API GW request handling for every endpoint | invoke integration at literal URI | invoke integration at stage-var-substituted URI (same URI) | **Identical** |
| API GW URL / methods / auth / CORS | unchanged | unchanged | **None** |

**Operator-facing impact: zero.** Request behavior, URL prefixes, auth headers, CORS responses — all identical pre/post.

### Phase B — R41.B — Per-domain Swagger fragments + merge step (FOLLOW-UP, ~2-3 days, opt-in)

**Decouples authoring from delivery. No CFN behavioral change.**

- Split `tenant-api-prod.json` into per-domain files:
  - `server/lib/api-spec/_envelope.json` — global `swagger`/`info`/`basePath`/`schemes`/`securityDefinitions` (~50 lines)
  - `server/lib/api-spec/academics.paths.json` — 77 academics paths (~7000 lines)
  - `server/lib/api-spec/schools.paths.json` — 38 schools paths
  - `server/lib/api-spec/finance.paths.json` — 38 finance paths
  - `server/lib/api-spec/users.paths.json`, `staff.paths.json`, `tenants.paths.json`, `auth.paths.json`, `sessions.paths.json`, `iemis.paths.json`, `calendar-blocks.paths.json`, `school-years.paths.json`, `education-organizations.paths.json`, `reporting.paths.json`, `credentials.paths.json`, `holiday-seeds.paths.json`, `archetype-defaults.paths.json` — remaining ~80 paths
- `scripts/build-tenant-api-spec.ts` — pre-synth build step (called from `cdk synth`'s preCommands or a `package.json` script):
  - Reads envelope + all `*.paths.json` files
  - Deep-merges into `cdk.out/tenant-api-prod.merged.json`
  - JSON-schema validates each fragment (catches malformed Swagger pre-synth)
  - Outputs byte-stable merged JSON (sorted keys) so `cdk diff` is meaningful
  - Detects path-key conflicts across fragments (catches "two domains accidentally claimed `/schools/{id}`")
- `api-gateway.ts` reads `cdk.out/tenant-api-prod.merged.json` instead of `tenant-api-prod.json`. `fromAsset` (already in place from R41.A) uploads it.
- Original `tenant-api-prod.json` archived (kept in git history; deleted from working tree to avoid two sources of truth).

**Why opt-in / follow-up sprint:**
- C2 is a DX tax, not a roadmap blocker. D.2 can ship before R41.B lands.
- R41.B has more surface area (file moves, build-script wiring, CI integration) and should land cleanly without urgency.
- Each domain's split can be a separate PR if reviewer load matters: `academics.paths.json` first (biggest), then schools/finance, then the long tail.

### Phase C — R41.C — Controller-derived spec generation (V1.5; deferred)

NestJS already has `@nestjs/swagger` which produces an OpenAPI document from controller decorators in-memory. R41.C persists that output to the per-domain fragment files at build time, making the controller the single source of truth and eliminating the three-way handoff for new routes.

Real engineering work (~1 week including request/response schema decoration), and a V1 pilot live first to validate priority. **Not in scope for any sprint between now and pilot greenlight.**

---

## 3. Non-regression validation strategy

R41.A is a CDK construct factory swap. The deployed API GW spec must be byte-identical pre-and-post. Three independent evidence layers:

### Layer 1 — CFN template diff (expected: predictable single delta)

```bash
cd server
AWS_PROFILE=edforge-prod CDK_NAG_ENABLED=false npx cdk diff shared-infra-stack 2>&1 | tee /tmp/r41a-cfn-diff.log
```

Expected diff: `Body` property removed from `AWS::ApiGateway::RestApi`; `BodyS3Location` property added. **No other resource changes.** Anything else in the diff is a red flag — investigate before deploying.

### Layer 2 — API GW exported spec structural-equivalence (revised 2026-05-23)

Because Stage variables substitute at request time, the exported spec post-R41.A contains `${stageVariables.xxx}` markers where the pre-R41.A spec had literal NLB DNS / VPC Link ID / authorizer function name. **A byte-equality check would fail by design — not because behavior changed, but because the substitution moved from import-time to request-time.**

The structural-equivalence assertion replaces byte equality. Three sub-checks:

```bash
REST_API_ID=$(AWS_PROFILE=edforge-prod aws apigateway get-rest-apis --region ap-south-1 \
  --query "items[?name=='TenantAPI'].id | [0]" --output text)

# Pre-deploy snapshot
AWS_PROFILE=edforge-prod aws apigateway get-export \
  --rest-api-id "$REST_API_ID" --stage-name prod --export-type swagger \
  --parameters extensions='integrations,authorizers' \
  --region ap-south-1 /tmp/api-gw-spec-before.json

# Deploy R41.A
./scripts/deploy-analytics.sh shared-infra-stack edforge-prod 2>&1 | tee /tmp/r41a-deploy.log

# Post-deploy snapshot
AWS_PROFILE=edforge-prod aws apigateway get-export \
  --rest-api-id "$REST_API_ID" --stage-name prod --export-type swagger \
  --parameters extensions='integrations,authorizers' \
  --region ap-south-1 /tmp/api-gw-spec-after.json

# Sub-check 2a — path/method shape preservation
# Diff after stripping the 3 dynamic-uri fields entirely; remainder must be byte-equal.
jq 'del(.. | .uri?, .connectionId?, .authorizerUri?) | walk(if type == "object" then to_entries | sort_by(.key) | from_entries else . end)' \
  /tmp/api-gw-spec-before.json > /tmp/before.normalized.json
jq 'del(.. | .uri?, .connectionId?, .authorizerUri?) | walk(if type == "object" then to_entries | sort_by(.key) | from_entries else . end)' \
  /tmp/api-gw-spec-after.json > /tmp/after.normalized.json
diff /tmp/before.normalized.json /tmp/after.normalized.json
# Expected: empty (every non-dynamic field of every path/method is preserved)

# Sub-check 2b — dynamic-uri fields now use stage variables (and ONLY stage variables)
jq '[.. | .uri?, .connectionId?, .authorizerUri? // empty | strings] | unique' /tmp/api-gw-spec-after.json
# Expected: every entry contains "${stageVariables.nlbDns}" OR "${stageVariables.vpcLinkId}" OR "${stageVariables.authorizerFn}"

# Sub-check 2c — Stage.Variables map carries correct CDK token refs
AWS_PROFILE=edforge-prod aws apigateway get-stage \
  --rest-api-id "$REST_API_ID" --stage-name prod --region ap-south-1 \
  --query 'variables'
# Expected: { "nlbDns": "<actual NLB DNS>", "vpcLinkId": "<actual VPC Link ID>", "authorizerFn": "<actual authorizer fn name>" }
```

If any sub-check fails: rollback, investigate. 2a and 2b together prove the spec changes are exactly bounded; 2c proves the runtime resolution maps correctly.

### Layer 3 — Cross-domain smoke (expected: all green)

15 routes spanning EVERY domain that currently exists in `tenant-api-prod.json`. Not just academics. One regression in any domain would be a prod-impacting bug.

Route table:

| # | Method | Path | Domain | Smoke checkpoint |
|---|---|---|---|---|
| 1 | GET | `/academics/dashboard/overview` | academics | A.4 dashboard responds 200 with overview shape |
| 2 | GET | `/academics/result-cards?examId={examId}` | academics | A.4 result-cards LIST responds 200 |
| 3 | PATCH | `/academics/exams/{examId}/status` | academics | A.3 state machine still answers (smoke calls with no-op transition for idempotency) |
| 4 | GET | `/schools/{schoolId}/configuration` | identity (schools) | F-CONFIG-1a fix still answers 200 with config |
| 5 | GET | `/users/me` | identity (users) | Auth context still resolves |
| 6 | GET | `/staff/{id}` | identity (staff) | Sprint A IEMIS staff path still answers |
| 7 | GET | `/sessions` | identity (sessions) | Sessions LIST still answers |
| 8 | GET | `/school-years` | identity (school-years) | AY LIST still answers |
| 9 | GET | `/finance/fee-structures` | finance | Finance read path |
| 10 | GET | `/iemis/jobs` | identity (iemis) | E.1 IEMIS job LIST |
| 11 | GET | `/calendar-blocks` | identity (calendar-blocks) | Phase C calendar blocks LIST |
| 12 | GET | `/archetype-defaults` | identity (archetype) | Sprint 0.4 archetype defaults |
| 13 | GET | `/tenants/{tenantId}` | tenants | Tenant metadata read |
| 14 | OPTIONS | `/academics/exams` | (cors) | OPTIONS preflight returns 204 + correct CORS headers |
| 15 | GET | `/academics/grading-policies` | academics | D.1 grading policies |

Script: `scripts/smoke-tests/r41a-cross-domain-routing.ts` — parametric on TENANT_ID + SCHOOL_ID + fresh JWT. Each check asserts `status === expectedStatus` (mostly 200, OPTIONS=204); deep response-shape assertions only on routes with stable shapes.

---

## 4. Tickets

### R41.A — CFN headroom via Stage variables + fromAsset (single PR, ~1 day, ~50-80 LOC)

| Ticket | Files | AC | Sized |
|---|---|---|---|
| R41.A.1 | `server/lib/shared-infra/api-gateway.ts` — substitution map shifts 3 token-bearing keys to stage-variable markers; write substituted file to `cdk.out/`; swap `fromInline` → `fromAsset`; add `deployOptions.variables` with CDK token refs | Synth produces CFN template with `BodyS3Location` + `Stage.Variables`; template <100KB; substituted file contains literal `${stageVariables.xxx}` markers in 689 spots | S |
| R41.A.2 | `server/lib/shared-infra/api-gateway.spec.ts` (NEW) — CDK assertions: `Body` absent; `BodyS3Location` present; `Stage.Variables` carries the 3 expected keys with non-empty values (CDK token refs); RestApi count = 1 | Spec green | XS |
| R41.A.3 | `scripts/smoke-tests/r41a-cross-domain-routing.ts` (NEW) — 15-checkpoint cross-domain smoke per §3 Layer 3 | 15/15 green on prod against pilot tenant | S |
| R41.A.4 | Layer 2 structural-equivalence evidence captured in deploy log: sub-checks 2a/2b/2c per §3 Layer 2 (revised) | 2a empty; 2b every dynamic field uses expected stage var; 2c Stage map has correct resolved values | XS |
| R41.A.5 | `docs/pilot-greenlight/cfn-headroom-sprint-plan.md` — closeout addendum (template size before/after, Layer 2 evidence, smoke result, master plan §11.2 R41 updated) | Doc updated; R41 closed in master plan | XS |

### R41.B — Per-domain Swagger fragments (follow-on PR, ~2-3 days, NOT blocking D.2)

| Ticket | Files | AC | Sized |
|---|---|---|---|
| R41.B.1 | `server/lib/api-spec/_envelope.json` + extract academics paths into `academics.paths.json` (NEW) | Envelope + one fragment authored | S |
| R41.B.2 | `scripts/build-tenant-api-spec.ts` (NEW) — pre-synth merge + JSON-schema validate + conflict-detect | Build script merges → `cdk.out/tenant-api-prod.merged.json`; spec round-trip equivalent to original | M |
| R41.B.3 | Wire build script into `cdk synth` (via `package.json` script or `cdk.context.json` preCommands) | `cdk synth shared-infra-stack` triggers the merge | XS |
| R41.B.4 | `api-gateway.ts` reads the merged file from `cdk.out/`; original `tenant-api-prod.json` archived | Source-of-truth file removed from working tree; merged file is generated artifact | XS |
| R41.B.5 | Extract remaining 15 domains into per-domain fragments | All paths migrated; merged output byte-equal to original (sorted) | M |
| R41.B.6 | `scripts/build-tenant-api-spec.spec.ts` (NEW) — round-trip + conflict-detect + schema-validate | Specs green | S |
| R41.B.7 | Document the new authoring workflow in `CLAUDE.md` (update three-way handoff rule) | Rule explicitly references per-domain fragments | XS |
| R41.B.8 | (Optional) `.github/CODEOWNERS` per-domain entries | Per-domain ownership enforced at PR review | XS |

### R41.C — Controller-derived spec (V1.5 backlog; not in this sprint)

---

## 5. Deploy ladder

### R41.A — single PR

```
R41.A PR
  ├── (CI green: typecheck, lint, jest including api-gateway.spec)
  ├── Local cdk synth shared-infra-stack — verify `BodyS3Location` in template
  ├── Local cdk synth | wc -c — verify <100KB
  ├── (Reviewer approval — Shoaib)
  ├── Capture Layer 2 pre-deploy snapshot:
  │     aws apigateway get-export … > /tmp/api-gw-spec-before.json
  │     jq -S . > /tmp/api-gw-spec-before.sorted.json
  ├── cdk diff shared-infra-stack — verify ONLY `Body`→`BodyS3Location` delta (Layer 1)
  ├── (Reviewer approval — diff matches expectation; AskUserQuestion gate)
  ├── ./scripts/deploy-analytics.sh shared-infra-stack edforge-prod
  ├── Wait for CFN UPDATE_COMPLETE
  ├── Capture Layer 2 post-deploy snapshot:
  │     aws apigateway get-export … > /tmp/api-gw-spec-after.json
  │     jq -S . > /tmp/api-gw-spec-after.sorted.json
  │     diff before.sorted.json after.sorted.json — MUST be empty (Layer 2 gate)
  ├── Run R41.A.3 cross-domain smoke against prod (Layer 3 gate)
  │     PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/r41a-cross-domain-routing.ts
  │     → 15/15 green
  ├── Tee all evidence to docs/deploys/prod-shared-infra-stack-r41a-<ts>-<sha>.log
  ├── (Closeout doc update — R41 closed in master plan §11.2)
  └── D.2 / D.3 unblocked
```

**Rollback (if Layer 2 diff is non-empty OR smoke fails):**
- `cdk deploy` previous SHA from worktree (per CLAUDE.md rollback playbook)
- Investigate the spec diff; the snapshot files are the post-mortem artifact

### R41.B — follow-on (separate PR, lower urgency)

Standard ladder; merge-equivalent JSON byte-for-byte → no CFN diff → no smoke required beyond `cdk diff shared-infra-stack` showing empty (because the merged output equals what `fromAsset` already uploaded last time).

---

## 6. Risks & mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-R41A.1 | `fromAsset` upload fails / asset bucket misconfigured | L | H | CDK bootstrap is established (UAT + prod have asset buckets; every CDK deploy uses them). Pre-synth check verifies bucket existence (CDK reports missing bootstrap explicitly). |
| R-R41A.2 | API GW pulls stale spec from S3 (caching) | L | M | API GW imports the spec at CFN deploy time, not at runtime. Once deployed, the spec is baked in. No runtime S3 dependency. |
| R-R41A.3 | Substitution timing — the temp file must be written before `fromAsset` reads it | L | M | CDK reads `fromAsset(path)` at synth time (eager). The `writeFileSync` happens earlier in the same constructor. Validated by R41.A.2 spec. |
| R-R41A.4 | `cdk.out` path resolution differs across local synth, CI synth, and deploy | L | M | Use `this.node.tryGetContext('aws:cdk:outdir')` with `'cdk.out'` fallback. Tested in CI by R41.A.2 spec snapshotting. |
| R-R41A.5 | Asset hash changes on every deploy because of trailing newline / encoding drift, leading to spurious re-uploads | L | L | Spec normalization: write with `JSON.stringify(parsed, null, 2)` so byte-stable. Acceptable to have occasional re-uploads regardless; old assets GC via bootstrap lifecycle policy. |
| R-R41A.6 | Stage variable substitution NOT supported in some spec context we use (e.g., a specific x-amazon-apigateway-* extension field) | M | H | Pre-deploy: confirm AWS docs for each of `integration.uri` / `integration.connectionId` / `authorizer.authorizerUri` explicitly list stage-variable substitution support. Layer 3 cross-domain smoke is the empirical gate — any 500/502 on a substituted endpoint = stage var didn't resolve. |
| R-R41A.7 | `cdk diff` shows additional unintended changes (e.g., authorizer recreate, stage recreate) | L | H | Layer 1 inspection — expected deltas: `Body` removed; `BodyS3Location` added; `Stage.Variables` added; new S3 asset deployment. Anything beyond these halts the deploy. |
| R-R41A.8 | Smoke fails on a route nobody on the team has thought about (e.g., legacy auth flow) | M | M | 15-route table covers every domain in the spec; widen if Layer 3 smoke surfaces something Layer 2 missed. |
| R-R41A.9 | Stage variable string `${stageVariables.xxx}` accidentally interpreted as a CDK token by CDK serializer + double-resolved | L | M | The `${stageVariables.xxx}` marker is API GW syntax, not CDK token syntax (`${Token[...]}`). CDK serializer pattern-matches the second; first passes through verbatim. Spec assertion: verify the substituted file written to disk contains the literal text `${stageVariables.nlbDns}`. |
| R-R41A.10 | CORS preflight (OPTIONS) responses use stage-var-substituted integration URI but OPTIONS is a mock integration with no actual integration backend | L | L | Inspection of `tenant-api-prod.json`: every OPTIONS method uses `type: mock` with hardcoded responses + headers; no `{{integration_uri}}` interpolation in OPTIONS handlers. Confirmed via grep: `{{integration_uri}}` placeholders appear only in non-OPTIONS integration blocks. |
| R-R41A.11 | New endpoints added in future sprints forget to use stage variable pattern + revert to literal NLB DNS hardcoding | M | L | `scripts/build-tenant-api-spec.ts` (R41.B) can lint for: stage var markers present and no hardcoded NLB DNS regex match. For now: CLAUDE.md three-way-handoff rule extended to "use `${stageVariables.nlbDns}` etc. for new integration URIs." |
| R-R41B.1 | Fragment merge silently drops paths (e.g., domain file forgotten) | M | H | R41.B.5 acceptance: merged output byte-equal to original (sorted). CI assertion. |
| R-R41B.2 | Two fragments claim the same path | L | H | R41.B.2 conflict-detect at merge time. |
| R-R41B.3 | Build script timing makes `cdk synth` slower in local dev | L | L | Merge is ~100ms (fs.readFile + Object.assign). Acceptable. |

---

## 7. Definition of Done

### R41.A

- [ ] PR merged
- [ ] CFN template size post-deploy: shared-infra-stack <100KB (`aws cloudformation get-template --stack-name shared-infra-stack | wc -c`)
- [ ] Layer 1 evidence — `cdk diff` log showing only `Body`→`BodyS3Location` delta
- [ ] Layer 2 evidence — empty `diff before.sorted.json after.sorted.json` captured in deploy log
- [ ] Layer 3 evidence — 15/15 cross-domain smoke green
- [ ] All evidence tee'd to `docs/deploys/prod-shared-infra-stack-r41a-<ts>-<sha>.log`
- [ ] Master plan §11.2 R41 marked CLOSED with link to closeout
- [ ] Closeout entry in `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] Memory written: `project_sprint_r41a_shipped_prod.md`
- [ ] D.2 / D.3 sprint plans unblocked — no longer have to flag template-size gate

### R41.B (separate sprint closeout)

- [ ] PR(s) merged
- [ ] All ~227 paths split across per-domain fragments
- [ ] `tenant-api-prod.json` archived from working tree (history preserved)
- [ ] Merged-output byte-equality test green
- [ ] `cdk diff shared-infra-stack` empty (no behavior change)
- [ ] CLAUDE.md three-way handoff rule updated to reference fragments
- [ ] Optional: CODEOWNERS per-domain

---

## 8. Open decisions (only 3 — none architecturally fundamental)

1. **R41.B scope — single PR or per-domain PRs?**
   - **(a) Single PR** — all 16 domain fragments + build script + cutover. Big diff but a single atomic switch; easier to verify the merged output equals the original.
   - **(b) Per-domain PRs** — academics first, then schools, then long tail. Easier reviewer load. Each PR proves byte-equality incrementally.
   - *Recommendation: (a) single PR. Atomic byte-equality is the cleanest invariant; cherry-picking a few domains while others stay inline introduces a hybrid state with no clear advantage.*

2. **R41.B timing — same week as R41.A or wait?**
   - **(a) Same week** — parallel work; R41.A unblocks roadmap immediately, R41.B follows ~2 days later.
   - **(b) Defer** — ship R41.A; let D.2 / D.3 proceed; queue R41.B for the next engineer with bandwidth.
   - *Recommendation: (b) defer. R41.A removes the urgency; D.2 / D.3 are higher business value; R41.B is DX investment that can wait until the next quieter sprint.*

3. **R41.C — confirm V1.5 deferral?**
   - **(a) V1.5 deferral.** *Recommendation.* Pilot live first, validate priority based on actual route-add cadence post-V1.
   - **(b) V1 stretch.** Adds 1 week of engineering for ergonomic gain; not pilot-critical.

---

## 9. Roadmap unblock signal

| Sprint | Was blocked by R41? | After R41.A ships |
|---|---|---|
| D.2 PromotionRule (~6 routes) | YES — would push CFN to ~92% | UNBLOCKED |
| D.3 ExternalAssessment Foundation (~10 routes) | YES — would push CFN past 100% | UNBLOCKED |
| D.4 BLE band 1 (~5 routes) | YES — past 100% | UNBLOCKED |
| D.5 SEE (~7 routes) | YES | UNBLOCKED |
| D.6 NEB (~6 routes) | YES | UNBLOCKED |
| C.1 Document Rendering | partially — depends on path additions | UNBLOCKED |
| C-series (~12 routes total) | YES | UNBLOCKED |
| A.1 Period Attendance (V1.5 candidate) | YES if pulled forward | UNBLOCKED |

**The day R41.A ships, every downstream sprint in the master plan loses its template-size gate.**

---

## 10. What this plan deliberately does NOT include

- Programmatic route stacks (the rejected pattern (b))
- Per-domain JSON file split as the primary fix (the misguided pattern (a)) — R41.B does the split but as a follow-on DX improvement, not as the CFN fix
- Custom Domain BasePathMapping or second RestApi (C3 future work)
- Authorizer rewrites or CORS hardening (orthogonal)
- New routes / new features
- Frontend changes (operator-facing surface unchanged)
- Migrations of any kind — R41.A is a CDK construct factory swap

---

## Sign-off requested

§8 open decisions (3 questions). Once signed off:

1. Cut feature branch: `sprint/r41a-cfn-headroom` on the server repo. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd /Users/shoaibrain/edforge` in the same invocation.
2. Begin R41.A implementation (single PR, ~1 day).
3. After R41.A ships and smoke is green: D.2 sprint plan kickoff. R41.B queued separately.

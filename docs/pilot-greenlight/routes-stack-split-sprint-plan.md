# Sprint R41 — `shared-api-routes-stack` Split (academics domain): Sprint Plan

> ⛔ **REJECTED 2026-05-23.** This draft was identified as a *"competent solution to the wrong problem"* during sign-off review. The actual fix for R41 is `ApiDefinition.fromAsset()` (~5 LOC), not a route migration. See [cfn-headroom-sprint-plan.md](./cfn-headroom-sprint-plan.md) for the adopted plan. This file is preserved as a record of the rejected approach + lessons captured in memory `feedback_check_root_cause_before_migration`.

> **Drafted:** 2026-05-23
> **Status:** ⛔ REJECTED — superseded by `cfn-headroom-sprint-plan.md`
> **Master-plan section:** `v1-master-epic-breakdown.md` §11.2 R41 + §17.8 L6
> **Companion precedents:** [`a4-sprint-plan.md`](./a4-sprint-plan.md), [`a3-sprint-plan.md`](./a3-sprint-plan.md), `server/lib/analytics/analytics-stack.ts` (in-tree pattern reference)

---

## 0. Pre-flight finding — the handoff's recommended pattern doesn't solve R41

The session-handoff doc that queued this sprint listed two patterns and recommended **(a) per-domain JSON files merged at synth time**. Empirical inspection of `server/lib/shared-infra/api-gateway.ts:118-155` finds that the whole `tenant-api-prod.json` is read → placeholder-substituted → parsed → passed to `apigateway.SpecRestApi` via `ApiDefinition.fromInline()`:

```ts
const swaggerFilePath = path.join(__dirname, '../tenant-api-prod.json');
let swaggerContent = fs.readFileSync(swaggerFilePath, 'utf-8');
// …regex placeholder replacements…
this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
  apiDefinition: apigateway.ApiDefinition.fromInline(JSON.parse(updateData)),
  …
});
```

`fromInline()` emits the entire JSON as the `Body` property of the single `AWS::ApiGateway::RestApi` resource in CFN. That `Body` is what's eating the 1MB CFN template ceiling.

**Therefore:**
- **Pattern (a) — split JSON, merge at synth.** Splitting `tenant-api-prod.json` into `academics-routes.json`, `identity-routes.json`, etc. and merging them in JS before `fromInline()` produces an **identical inline payload**. Same CFN size. ❌ Does not solve R41.
- **Pattern (b) — separate stack imports API + attaches routes programmatically.** Mirrors the existing `analytics-stack.ts:705-799` precedent. Migrated routes emit as standalone `AWS::ApiGateway::Resource` + `AWS::ApiGateway::Method` resources in the sibling stack's template — bytes physically move out of `shared-infra-stack`. ✅ Actually solves R41.

**Therefore this plan adopts pattern (b)** and starts with one domain (academics) as the first cut.

---

## 1. Why this sprint, why now

### Critical-path argument

`shared-infra-stack` CFN template is at **87.7% of the 1MB hard limit** (876,876 / 1,000,000 bytes; A.4 closeout 2026-05-23 PM). Each new top-level API GW path adds ~9KB. The next ~3 critical-path sprints in the master plan all add routes:

| Sprint | Routes added | Payload bump |
|---|---|---|
| D.2 PromotionRule | ~6 | ~54KB |
| D.3 ExternalAssessment Foundation | ~10 | ~90KB |
| D.4 BLE (band 1) | ~5 | ~45KB |

`shared-infra-stack` hits the **1MB hard limit between D.2 and D.3** if no split lands first. A `cdk deploy` failure with `Template format error: Template body is too large` blocks ALL infra changes — not just route additions. **This sprint is the gating prerequisite for every EPIC-D + EPIC-C sprint that adds API GW routes.**

### Foundation in place

- ✅ `analytics-stack.ts:705-799` already imports `TenantApiRestApiId`, `TenantApiRootResourceId`, `TenantApiAuthorizerArn` via `cdk.Fn.importValue()` and attaches 5 `/analytics/*` routes programmatically (CFN imports already exported from `shared-infra-stack` at lines 373-387 of `shared-infra-stack.ts`).
- ✅ `addResource()` traversal pattern + `TokenAuthorizer` wrapping + `LambdaIntegration`/`Integration` proxy patterns are all proven on prod for ~9 months.
- ✅ Per-domain breakdown of `tenant-api-prod.json` is mechanically extractable (227 paths grouped by first segment; academics owns 77 of them).
- ✅ `addCorsPreflight()` mirrors the existing inline-Swagger OPTIONS mock pattern (verified at `analytics-stack.ts:766-780`).

### Per §0 philosophy (CEO 2026-05-22)

Foundation work that unblocks product-completeness sprints. R41 split is **infrastructure plumbing, not product surface** — no operator-visible change; no behavioral change to existing routes; no new business logic. The acceptance evidence is: (1) academics routes still answer 200/4xx exactly as before; (2) `shared-infra-stack` template size drops by ~250KB; (3) `cdk deploy` for D.2 (next sprint) doesn't hit the ceiling.

---

## 1.5 Architecture principle — same Core Ed-Fi V6 + Edges discipline applies

This sprint touches infra, not domain code. The Core/Edge split is unchanged. **Specific invariants for R41:**

| Invariant | R41 enforcement |
|---|---|
| Three-way handoff (Nest controller + `tenant-api-prod.json` + nginx) | **Modified for migrated routes:** Nest controller + new `academics-routes-stack` programmatic route + nginx (unchanged — academics routes ride existing `^/academics` location block). For migrated routes, `tenant-api-prod.json` is the LEFT-BEHIND artifact, not the source of truth. |
| Invariant 13 (no pilot names in code/IaC) | Stack is named `shared-api-routes-stack` (or `academics-routes-stack` per §8 #1). No pilot identifiers. |
| Lambda authorizer reuse cardinal rule | Strict — re-import `TenantApiAuthorizerArn` exactly like analytics-stack does; do NOT modify or duplicate. |
| Single REST API id | Migrated routes attach to the SAME `TenantApiRestApiId` — operator-facing URL prefix `https://api.edforge.app/prod/academics/*` is unchanged. |
| Idempotent + reversible | Stack must be `cdk destroy`-able without breaking shared-infra. Routes can be reverted to inline-Swagger in a follow-up PR by un-attaching them from the new stack + re-adding them to `tenant-api-prod.json`. |

### Anti-pattern guardrails (rejected at PR review)

- Modifying the shared Python authorizer (`shared-infra/Resources/tenant_authorizer.py`) — strict cardinal rule from `analytics-stack.ts:702-704`.
- Creating a SECOND `RestApi` resource — the migrated routes must attach to the imported existing API; never create a new one (would create a SECOND API GW with a different URL → breaks operator clients).
- Inlining the per-domain Swagger fragments into the new stack via `SpecRestApi` — that just shifts the inline-bytes problem to the new stack. Use programmatic `addResource()`/`addMethod()` only.
- Migrating a route while leaving its entry in `tenant-api-prod.json` — at the API GW level, the two would conflict (last-deployed-wins is undefined behavior). Migrated routes MUST be deleted from `tenant-api-prod.json` in the SAME PR.
- Hardcoded path strings duplicated between Nest controller and the new stack — single source of truth is the controller's `@Controller('academics')` + `@Get('exams/:examId')` decorator metadata. Stack route registrations should structurally mirror, but they're additive new code, not generated. Drift between them produces 404 from API GW or wrong-method-on-resource. Mitigation: pre-deploy parity check (§5 R-R41.3).

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| R41.1 | NEW `server/lib/shared-api-routes/academics-routes-stack.ts` — imports `TenantApiRestApiId`/`TenantApiRootResourceId`/`TenantApiAuthorizerArn`; registers all 77 academics paths programmatically via `addResource()`/`addMethod()`; reuses imported authorizer | L |
| R41.2 | NEW shared helper `server/lib/shared-api-routes/route-builder.ts` — extracts the `addRoute()` + `addCorsPreflight()` pattern from `analytics-stack.ts:746-782` into a reusable builder so future domains (identity, finance) can reuse without duplication | S |
| R41.3 | NEW `server/lib/shared-api-routes/academics-routes-spec.ts` — declarative route table (path + methods + path-params) for academics; the stack reads this table and constructs API GW resources. Decouples "what routes exist" from "how to register them" | M |
| R41.4 | DELETE the 77 `/academics/*` entries from `server/lib/tenant-api-prod.json` (kept under git history; not a destructive op since they're reproduced in academics-routes-spec) — drops shared-infra-stack CFN template size by ~250KB | M |
| R41.5 | MODIFY `server/bin/ecs-saas-ref-template.ts` — instantiate `AcademicsRoutesStack` with `.addDependency(sharedInfraStack)` per CLAUDE.md stack topology | XS |
| R41.6 | NEW `server/lib/shared-api-routes/academics-routes-stack.spec.ts` — CDK assert spec: stack synthesizes; correct count of `AWS::ApiGateway::Resource` + `AWS::ApiGateway::Method` per route table; authorizer reused via import; no second RestApi created | M |
| R41.7 | NEW `server/lib/shared-api-routes/route-parity.spec.ts` — pre-deploy parity assertion: for each `@Controller('academics')` route in the NestJS academics service, verify a matching entry in academics-routes-spec (catches drift between controller + stack registration; mitigates R-R41.3) | M |
| R41.8 | NEW `scripts/smoke-tests/academics-routes-parity-smoke.ts` — post-deploy parametric smoke: hits a representative sample (~15) of academics routes with a real Cognito JWT against prod; assertions: same response codes/bodies as a pre-migration baseline. Reuses pilot-result-card-publish.ts harness shape | M |
| R41.9 | NEW `docs/pilot-greenlight/r41-foundation-readiness-audit.md` — confirms analytics-stack precedent applies; cites tested CFN imports; flags R-R41.1–R-R41.8 status; documents the academics route table baseline | S |
| (impl) | UPDATED `server/lib/shared-infra/api-gateway.ts` — JSDoc + inline comment pointing to academics-routes-stack as the new home for academics paths; rest of file unchanged | XS |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| Migrate `/schools/*`, `/users/*`, `/staff/*`, `/finance/*`, etc. into per-domain routes stacks | This sprint proves the pattern + recovers academics' ~250KB headroom. Subsequent sprints (or §17.x backlog) migrate identity (~80 paths, ~270KB recovery) + finance (~38 paths, ~125KB recovery) when their domain teams next touch routes. Forces ~33% recovery now and an opt-in migration cadence going forward. |
| Per-domain JSON file split (pattern (a) from the handoff) | §0 above — does not reduce CFN payload. Architectural dead-end. |
| Rewriting the Python authorizer in TS | Cardinal rule: do NOT touch the shared authorizer. Cross-domain change with prod blast radius unrelated to R41. |
| Adding new routes during this sprint | This is a pure migration. New routes from D.2/D.3 go through this sprint's pattern AFTER it lands. |
| Deleting the AdvancedTier / PremiumTier API key constructs | V1_DEFERRED tier infra; not relevant to R41. |
| Changing CORS behavior | OPTIONS mock + Lambda Authorizer Origin echo is unchanged. Strict carry-over. |
| Frontend changes | No operator-facing surface change. URL paths + auth headers + response shapes are identical pre- and post-migration. |
| Splitting `tenant-template-stack-basic` | Separate per-tenant stack; different size dynamic; not R41 scope. |

### Already-shipped foundation (precedents in-tree)

- `analytics-stack.ts:705-799` — 5 `/analytics/*` routes programmatically attached to imported `TenantApi`; running on prod since Sprint S2.
- `shared-infra-stack.ts:373-387` — CFN exports `TenantApiRestApiId`, `TenantApiRootResourceId`, `TenantApiAuthorizerArn` are already in place.
- nginx `^/academics` location block — unchanged; absorbs all migrated paths via prefix match.
- `tenant-template-stack-basic`'s ABAC role with execute-api permissions on `*` — covers the migrated resources without IAM changes.

---

## 3. PR cadence — 4 phases

**4 phases because the migration has distinct gates: spec/declarative table → new stack code → CFN deploy + post-deploy smoke → cleanup of the JSON file.** Phase boundaries chosen so each PR is independently revertable.

### Phase 0 — Route-table extraction (DECISION + extract academics paths into declarative spec, 1 PR)

**Trigger:** sign-off on §8 open decisions.

**Tickets:** R41.3 (academics-routes-spec) + R41.7 (route-parity spec) + R41.9 (foundation audit)

**Files:**
- NEW `server/lib/shared-api-routes/academics-routes-spec.ts` — declarative table `export const ACADEMICS_ROUTES: RouteSpec[] = [ { path: '/academics/exams', methods: ['GET', 'POST'], pathParams: [] }, …77 entries… ]`
- NEW `server/lib/shared-api-routes/types.ts` — `RouteSpec` interface
- NEW `server/lib/shared-api-routes/route-parity.spec.ts` — for each academics controller, parse `@Controller` + method decorators (statically via fs+regex; mirrors the academics module-wiring spec pattern from PR #163) and assert each appears in `ACADEMICS_ROUTES`
- NEW `docs/pilot-greenlight/r41-foundation-readiness-audit.md`
- NO source code in `microservices/` touched
- NO CDK code touched

**Validation:** spec runs in CI; parity assertion green.

**Deploy:** none (declarative + spec only; no infra change).

### Phase 1 — `academics-routes-stack` CDK code + isolated CFN deploy (1 PR)

**Tickets:** R41.1 + R41.2 + R41.5 + R41.6

**Files:**
- NEW `server/lib/shared-api-routes/route-builder.ts` — reusable `RouteBuilder` class: `addRoutes(tenantApi: IRestApi, sharedAuthorizer: ITokenAuthorizer, integration: IIntegration, routes: RouteSpec[])`. Internally walks each route's path segments via `addResource()`/`getResource()`; attaches `addMethod()` per HTTP verb; adds `addCorsPreflight()` per resource.
- NEW `server/lib/shared-api-routes/academics-routes-stack.ts` — `AcademicsRoutesStack extends cdk.Stack`. Imports `TenantApiRestApiId`/`TenantApiRootResourceId`/`TenantApiAuthorizerArn` via `cdk.Fn.importValue` (verbatim from `analytics-stack.ts:705-723`); imports nginx-proxied NLB integration via `tenant-template-stack-basic`'s exported `NlbDnsName` (NEW export needed — see §8 #2); calls `RouteBuilder.addRoutes(…, ACADEMICS_ROUTES)`.
- NEW `server/lib/shared-api-routes/academics-routes-stack.spec.ts` — CDK assertion test: `template.resourceCountIs('AWS::ApiGateway::Resource', expectedResourceCount)` + `template.resourceCountIs('AWS::ApiGateway::Method', expectedMethodCount)` + `template.resourceCountIs('AWS::ApiGateway::RestApi', 0)` (NEVER a new RestApi) + `template.hasResourceProperties('AWS::ApiGateway::Method', { AuthorizerId: { Ref: stringLike('*Authorizer*') } })`.
- MODIFIED `server/bin/ecs-saas-ref-template.ts` — instantiate `AcademicsRoutesStack`; `.addDependency(sharedInfraStack)`; gate the dependency under explicit flag so the stack can be skip-deployed if the academics ECS migration to the nginx-proxied integration URI isn't ready yet.
- MODIFIED `server/lib/shared-infra/api-gateway.ts` — JSDoc + inline comment pointing to the new stack as the new home for academics paths
- NO change to `tenant-api-prod.json` (deferred to Phase 2)

**Deploy:**
- `cdk diff academics-routes-stack` (tee'd) → review
- `cdk diff shared-infra-stack` should be empty
- `cdk deploy academics-routes-stack` (per memory `feedback_pr_first_no_more_uat` — prod only; per-step `AskUserQuestion`)
- After deploy: API GW now has **two** paths to academics — the inline-Swagger ones (still in `shared-infra-stack`) AND the new programmatic ones (in `academics-routes-stack`). At the API GW level, **two resources with the same path is undefined / last-deployed-wins**. **Therefore Phase 1 MUST NOT deploy `academics-routes-stack` to prod yet — it stays synth-validated only until Phase 2 ships in the same window.** (See §8 #3.)
- *Open decision §8 #3 — should Phase 1 + Phase 2 ship as ONE merged PR with a one-shot deploy? Recommendation: YES — atomic migration is safer than two-step.*

### Phase 2 — Delete academics paths from `tenant-api-prod.json` + atomic deploy (1 PR; OR merge with Phase 1)

**Tickets:** R41.4

**Files:**
- MODIFIED `server/lib/tenant-api-prod.json` — delete all 77 `/academics/*` path entries; commit with diff for review trail. The file shrinks from ~750KB to ~500KB.
- Phase 1 academics-routes-stack code is also in this PR if §8 #3 chooses single-PR atomic.

**Deploy ladder (atomic):**
- `cdk diff shared-infra-stack` (tee'd) → should show: **`AWS::ApiGateway::RestApi` `Body` shrinks by ~250KB; no Resource/Method deletions** (Swagger import doesn't emit individual Resource/Method CFN resources — they're nested in Body). Verify diff visually.
- `cdk diff academics-routes-stack` (tee'd) → should show: ~77 `AWS::ApiGateway::Resource` + ~150 `AWS::ApiGateway::Method` + ~77 OPTIONS preflight methods.
- `cdk deploy shared-infra-stack academics-routes-stack` (parallel-safe? — see §8 #4) per profile
- Wait `cdk deploy` complete + verify API GW deployment stage is updated for both stacks (CFN-level "Deployment" resource creates an API GW deployment; both stacks must trigger one)
- Smoke validation (Phase 3) immediately

### Phase 3 — Post-deploy parametric smoke + cleanup (1 PR)

**Tickets:** R41.8

**Files:**
- NEW `scripts/smoke-tests/academics-routes-parity-smoke.ts` — parametric (`TENANT_ID`, `SCHOOL_ID` env-driven). Hits ~15 representative academics routes spanning all 4 method-bearing patterns:
  1. `GET /academics/dashboard/overview` (no path params)
  2. `GET /academics/exams` (LIST)
  3. `POST /academics/exams` (CREATE — uses synthetic Exam payload from a4 smoke)
  4. `GET /academics/exams/{examId}` (single-resource GET)
  5. `PATCH /academics/exams/{examId}/status` (state-machine PATCH)
  6. `PATCH /academics/result-cards/{cardId}/publish` (deep nested PATCH)
  7. `GET /academics/grades/section/{sectionId}` (path-param subresource)
  8. `POST /academics/grades/record/bulk` (bulk POST)
  9. `GET /academics/attendance/student/{studentId}/summary` (3-segment nested)
  10. `POST /academics/attendance/bulk`
  11. `GET /academics/courses`
  12. `GET /academics/course-offerings/{courseOfferingId}`
  13. `OPTIONS /academics/exams` (CORS preflight — assert 204 + headers)
  14. `GET /academics/grading-policies` (D.1 endpoint sanity)
  15. `GET /academics/result-cards?examId=…` (A.4 endpoint sanity)
- Each assertion: status code matches pre-migration baseline (captured in §9 audit doc); response shape Zod-validates against the relevant shared-types schema; auth header is the imported authorizer (cross-check via response header `x-amzn-RequestId` traces correctly to imported authorizer logs).

**Deploy:** no infra change. Script execution against `dev-pabson-primary` + Saraswati prod (academics has limited prod data; subset of checkpoints will SKIP gracefully). Fresh Cognito JWT immediately before run per memory `feedback_just_ask_for_a_prod_token` + §17.10 L12.

---

## 4. Per-ticket detail

### R41.1 — AcademicsRoutesStack

**Files:** Phase 1.
- `server/lib/shared-api-routes/academics-routes-stack.ts` (NEW)
- `server/lib/shared-api-routes/academics-routes-stack.spec.ts` (NEW)

**Stack shape:**
```typescript
export class AcademicsRoutesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'AcademicsRoutesStack');

    const tenantApi = apigateway.RestApi.fromRestApiAttributes(this, 'TenantApiImport', {
      restApiId: cdk.Fn.importValue('TenantApiRestApiId'),
      rootResourceId: cdk.Fn.importValue('TenantApiRootResourceId'),
    });

    const authorizerFn = lambda.Function.fromFunctionAttributes(this, 'TenantApiAuthorizerImport', {
      functionArn: cdk.Fn.importValue('TenantApiAuthorizerArn'),
      sameEnvironment: true,
    });

    const sharedAuthorizer = new apigateway.TokenAuthorizer(this, 'AcademicsSharedTokenAuthorizer', {
      handler: authorizerFn,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // Nginx-proxied NLB integration for academics service (same as inline-Swagger)
    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      integrationHttpMethod: 'ANY',
      uri: `http://${cdk.Fn.importValue('NlbDnsName')}/{proxy}`,
      options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: apigateway.VpcLink.fromVpcLinkId(this, 'VpcLinkImport', cdk.Fn.importValue('VpcLinkId')),
        requestParameters: { 'integration.request.path.proxy': 'method.request.path.proxy' },
      },
    });

    new RouteBuilder().addRoutes(tenantApi, sharedAuthorizer, integration, ACADEMICS_ROUTES);
  }
}
```

**Validation:**
- `cdk synth academics-routes-stack` succeeds with no errors
- Stack spec: resource count assertions for Resource + Method
- Stack spec: zero `AWS::ApiGateway::RestApi` resources
- Stack spec: every Method declares `AuthorizationType: CUSTOM` + `AuthorizerId: { Ref: SharedAuthorizer }`
- Stack spec: every Resource has a sibling OPTIONS method (CORS preflight)

**AC:**
- Synthesizes clean against `dev-pabson-primary`-equivalent uat AND prod
- Imports the EXISTING authorizer (no new Lambda created)
- Imports the EXISTING RestApi (no new API created)
- All 77 academics paths registered

**Deps:** R41.2 + R41.3 + R41.5 + §8 #2 (NlbDnsName + VpcLinkId exports from shared-infra-stack).

### R41.2 — RouteBuilder helper

**Files:** Phase 1.
- `server/lib/shared-api-routes/route-builder.ts` (NEW)
- `server/lib/shared-api-routes/route-builder.spec.ts` (NEW)

**Class shape:**
```typescript
export class RouteBuilder {
  addRoutes(
    api: apigateway.IRestApi,
    authorizer: apigateway.ITokenAuthorizer,
    integration: apigateway.IIntegration,
    routes: RouteSpec[],
  ): void {
    // Walk path segments; idempotent `getResource()` fallback to `addResource()`
    // For each route, addMethod() per HTTP verb in route.methods
    // For each terminal resource, addCorsPreflight()
  }
}
```

**Validation:** unit tests with mock RestApi / synth assertion patterns.

**AC:**
- Idempotent `addResource()` traversal (matches `analytics-stack.ts:750-755`)
- Per-verb method addition
- OPTIONS preflight mock added once per terminal resource (NOT per verb)

**Deps:** none (foundational helper).

### R41.3 — academics-routes-spec

**Files:** Phase 0.
- `server/lib/shared-api-routes/academics-routes-spec.ts` (NEW)
- `server/lib/shared-api-routes/types.ts` (NEW)

**Shape:**
```typescript
export interface RouteSpec {
  path: string;                // e.g. '/academics/exams/{examId}'
  methods: HttpMethod[];       // e.g. ['GET', 'PATCH', 'DELETE']
  // No nginx prefix here — every academics path rides ^/academics in nginx
}

export const ACADEMICS_ROUTES: RouteSpec[] = [
  { path: '/academics/attendance', methods: ['GET', 'POST'] },
  { path: '/academics/attendance/alerts', methods: ['GET'] },
  // …75 more
];
```

**Validation:**
- Generation: extracted via one-shot script `scripts/extract-academics-routes-from-swagger.ts` that parses the current `tenant-api-prod.json` paths whose keys start with `/academics/` and dumps the JSON-derived RouteSpec[]. Output committed to source.
- Manual review against the controller decorators (cross-check via R41.7 parity spec).
- ≥77 entries (one per current academics path); spec asserts.

**AC:**
- Single source of truth for academics route registrations
- Maps 1:1 with the current `tenant-api-prod.json` academics entries
- Maps 1:1 with NestJS academics controller routes (verified by R41.7)

**Deps:** none.

### R41.4 — Delete academics paths from tenant-api-prod.json

**Files:** Phase 2.
- MODIFIED `server/lib/tenant-api-prod.json` — remove all 77 path entries whose keys start with `/academics/`. Drops file from ~750KB → ~500KB. NO change to non-academics paths.

**Validation:**
- Manual diff review (line-by-line — Phase 2 PR description includes the exact key list deleted).
- `cdk synth shared-infra-stack` after deletion produces a smaller `Body` field — visible in `cdk diff shared-infra-stack`.
- The CFN template's `AWS::ApiGateway::RestApi.Body` field shrinks; `cdk diff` shows the diff (CDK Body field is JSON-string-comparable).

**AC:**
- All 77 academics paths removed
- shared-infra-stack template body shrinks by ~250KB (verified via `cdk synth | wc -c` before and after)
- No non-academics paths touched

**Deps:** R41.1 ready (academics-routes-stack code merged + buildable; not yet deployed).

### R41.5 — Wire AcademicsRoutesStack into the app

**Files:** Phase 1.
- MODIFIED `server/bin/ecs-saas-ref-template.ts` — instantiate `AcademicsRoutesStack`; `.addDependency(sharedInfraStack)` per CLAUDE.md stack topology.

**Validation:** `cdk list` includes `academics-routes-stack`; `cdk synth academics-routes-stack` works.

**AC:**
- Stack appears in `cdk list` output
- Synth works in both UAT and prod profiles
- Stack dependency declared explicitly

**Deps:** R41.1.

### R41.6 — academics-routes-stack.spec.ts

**Files:** Phase 1.
- `server/lib/shared-api-routes/academics-routes-stack.spec.ts` (NEW)

**Assertions (CDK Template assertions API):**
- `template.resourceCountIs('AWS::ApiGateway::Resource', N)` where N = derived from path-segment count in ACADEMICS_ROUTES
- `template.resourceCountIs('AWS::ApiGateway::Method', M)` where M = sum of methods + 1 OPTIONS per terminal resource
- `template.resourceCountIs('AWS::ApiGateway::RestApi', 0)` — no new API
- `template.resourceCountIs('AWS::Lambda::Function', 0)` — no new authorizer Lambda
- Method-level: `template.hasResourceProperties('AWS::ApiGateway::Method', { AuthorizationType: 'CUSTOM' })` — at least 1 per HTTP method
- Imports: spec checks `Fn::ImportValue` for `TenantApiRestApiId`/`TenantApiRootResourceId`/`TenantApiAuthorizerArn`

**Validation:** `jest server/lib/shared-api-routes/academics-routes-stack.spec.ts` green.

**AC:** all assertions green; spec runs in <30s.

**Deps:** R41.1.

### R41.7 — Route parity spec

**Files:** Phase 0.
- `server/lib/shared-api-routes/route-parity.spec.ts` (NEW)

**Behavior:**
- Read each `*.controller.ts` file under `server/application/microservices/academics/src/`
- Regex-extract `@Controller('<base>')` + each method's `@Get('<path>')`/`@Post(…)`/etc decorators
- Construct expected path strings (controller base + method path, with `:param` → `{param}` translation)
- Assert each expected path appears in `ACADEMICS_ROUTES`
- Assert each `ACADEMICS_ROUTES[]` entry has a matching controller decorator
- Diff produces a readable failure listing the routes missing on either side

**Validation:** spec runs in CI; green at PR.

**AC:**
- Catches drift: if a controller adds a new @Get without updating ACADEMICS_ROUTES, spec fails
- Catches drift: if ACADEMICS_ROUTES has an entry with no controller backing, spec fails
- Mirrors the static-metadata pattern of `academics/__tests__/module-wiring.spec.ts` from PR #163

**Deps:** R41.3.

### R41.8 — Post-deploy parity smoke

**Files:** Phase 3.
- `scripts/smoke-tests/academics-routes-parity-smoke.ts` (NEW)

**Behavior:** see §3 Phase 3 above. 15 checkpoints.

**AC:**
- All 15 checkpoints return SAME status code as pre-migration baseline (baseline captured in r41-foundation-readiness-audit.md)
- All Zod-validatable bodies validate
- OPTIONS preflight returns 204 + correct CORS headers
- No `4xx`/`5xx` on routes that returned 2xx pre-migration (and vice versa)

**Deps:** Phase 2 deployed.

### R41.9 — Foundation readiness audit

**Files:** Phase 0.
- `docs/pilot-greenlight/r41-foundation-readiness-audit.md` (NEW)

**Contents:**
- Confirm analytics-stack precedent (`analytics-stack.ts:705-799` reference + cite that it has been live in prod for ~9 months)
- Confirm CFN exports `TenantApiRestApiId`, `TenantApiRootResourceId`, `TenantApiAuthorizerArn` already exist and have no consumers other than analytics-stack (no risk of breaking existing imports)
- Compute current shared-infra-stack template size (`cdk synth shared-infra-stack | wc -c`) → quote as Phase 2 baseline
- Compute projected post-Phase-2 shared-infra-stack template size → goal <600KB (60% of limit, safe runway for D.2 + D.3 + C series)
- Document the 15-checkpoint smoke baseline (per-route status code + body shape from current prod) so R41.8 smoke has something to compare against
- Flag each R-R41.* risk with mitigation status
- Append the §8 open-decisions resolutions once signed off

**Validation:** doc reviewed in Phase 0 PR.

**AC:**
- All facts in §17.8 L6 reconciled
- Pre-migration baseline captured (status codes + body shapes for the 15 smoke routes)

**Deps:** none.

---

## 5. Risks & mitigations (sprint-level)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-R41.1 | API Gateway behavior changes between Swagger-inline routes and CDK programmatic routes (e.g., request validators, integration request templates, OPTIONS preflight specifics) | M | H | R41.8 parity smoke captures pre-migration baseline (status codes + body shapes for 15 representative routes) and asserts post-migration matches. Differences are blocking. Specifically: nginx-proxied integration URI MUST be byte-equal to inline-Swagger's `x-amazon-apigateway-integration.uri` field. Integration request templates (path → proxy variable) MUST match. |
| R-R41.2 | API GW deployment has a duplicate-path window between Phase 1 + Phase 2 (both stacks claim `/academics/*`) | H | H | §8 #3 — ship Phase 1 + Phase 2 as ONE merged PR; single atomic deploy of `shared-infra-stack` (with deletions) + `academics-routes-stack` (with additions) in the same change window. CFN may reorder operations — manual `aws apigateway get-resources` check immediately post-deploy to verify exactly one resource per path. |
| R-R41.3 | Controller-vs-stack drift: a new controller route is added but ACADEMICS_ROUTES is not updated → API GW returns 403 (no path registered) | M | H | R41.7 parity spec runs in CI; catches drift pre-merge. Mirrors the static-metadata pattern from S0.3 module-wiring spec. Also: the three-way handoff invariant in CLAUDE.md is amended at §1.5 to read "Nest controller + academics-routes-spec.ts + (nginx if new top-level prefix)" for migrated domains. |
| R-R41.4 | Authorizer ARN re-import creates a NEW `AWS::ApiGateway::Authorizer` resource even though the underlying Lambda is shared (because the new stack creates its own `TokenAuthorizer` construct that wraps the imported Lambda) | H (acknowledged) | M | This is the analytics-stack pattern — proven on prod. Each downstream stack creates its own Authorizer construct that references the same imported Lambda. The result is N+1 Authorizer resources (one per stack) sharing one Lambda. Functionally identical; no operator-facing change. Documented. |
| R-R41.5 | NLB integration URI differs between Swagger-inline (raw NLB DNS) and programmatic (needs `VpcLinkId` import + L1 Integration config) | M | H | §8 #2 — add new CFN exports `NlbDnsName` + `VpcLinkId` from `shared-infra-stack` if not already present. Phase 0 audit verifies. If exports are missing, add them in a pre-sprint PR (XS scope, 1 file change). |
| R-R41.6 | CFN deployment-stage update timing: API GW Deployment resource has implicit re-trigger semantics; both stacks deploying simultaneously could create two Deployments and only one wins | M | M | `cdk deploy` is serial by default; CFN deployments serialize per-stack. Verify post-deploy: `aws apigateway get-deployments --rest-api-id $REST_API_ID` shows the latest. CDK's `deployOptions.stageName` should handle re-deployment; if not, manual `aws apigateway create-deployment` post-flight. |
| R-R41.7 | shared-infra-stack template size diff is `Body` field of one resource — `cdk diff` may render confusingly (huge inline string diff) | L | L | Pre-deploy `cdk synth shared-infra-stack | wc -c` before and after; tee the byte count to deploy log; review the size delta as a number, not a textual diff. |
| R-R41.8 | Lambda `:latest`-tag image consumers (academics ECS) unaffected — but a service rolling at the SAME time as the API GW migration could conflate failures | L | M | Do NOT roll academics ECS during this sprint. Pure infra migration; academics image stays at A.4 hotfix `sha256:2c9fd8b8`. Document in deploy ladder. |
| R-R41.9 | Existing operator clients caching old REST API id (none expected — REST API id is stable across this migration; only Resource+Method CFN ids change) | L | L | Same RestApi id stays; same URL prefix stays; same Custom Domain stays. Operator-facing zero-change. |
| R-R41.10 | Future R41-style migrations require parallel route-spec files (identity, finance) — duplication temptation | M | L | Phase 1's `RouteBuilder` helper is reusable; future domains just need their own `<domain>-routes-spec.ts`. ~50 LOC per domain. Forces a clean per-domain split going forward. |
| R-R41.11 | Rollback: if Phase 2 deploy fails or smoke fails, reverting requires re-adding the 77 paths to `tenant-api-prod.json` AND `cdk destroy academics-routes-stack` | M | H | Phase 2 PR's commit is a clean revertable patch (one file's deleted lines are git-restorable). `cdk destroy academics-routes-stack` is safe (only removes the API GW Resource+Method+CORS resources; doesn't touch the shared API GW itself). Rollback runbook documented in Phase 2 PR description. |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

| Invariant | R41 disposition |
|---|---|
| Audit + event paired (Sprint 0.2.7 lint) | N/A — infra migration; no new audit/event paths |
| Three-way route handoff | **AMENDED for migrated routes:** Nest controller + `<domain>-routes-spec.ts` + (nginx if new top-level prefix). For academics, nginx is unchanged. Master plan §17.x note added in closeout. |
| Shared-types changed → minor bump + npm publish + AdminWeb jsdom sim | N/A — no shared-types change |
| New NestJS module → module-wiring.spec.ts SAME PR | N/A — no new NestJS modules |
| New GSI → gsi-inventory.md BEFORE CDK deploy | N/A — no DDB changes |
| Invariant 13 (no pilot names in code/IaC) | YES — stack name + class name + variable names all pilot-agnostic |
| Invariant 12 (no implicit archetype branching) | N/A — infra only |
| Invariant 3 (cross-AY identity via enrollmentId) | N/A — no entity changes |
| `as any` cast smell | None expected; CDK constructs fully typed |
| New EventBridge rule + DLQ + alarm | N/A |
| Lambda cold-start budgeted | N/A — no new Lambda |
| L9 — sprint creating new NestJS module ships wiring spec same PR | N/A |
| **NEW for R41** — route parity spec required | R41.7 ships in Phase 0; CI green pre-merge of Phase 1 |
| **NEW for R41** — pre-deploy CFN template size byte-count tee'd to deploy log | YES — captured pre-Phase-2 and post-Phase-2 |
| **NEW for R41** — post-deploy parity smoke required | R41.8 in Phase 3 |

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

```
Phase 0 PR (route-table extraction + parity spec + foundation audit)
  ├── (CI green: typecheck, lint, jest, parity spec)
  ├── (Reviewer approval — Shoaib)
  ├── Merge PR to main
  └── No deploy — pure docs + spec

Phase 1+2 PR (CDK stack code + JSON deletion — ATOMIC, per §8 #3 recommendation)
  ├── (CI green; cdk synth shared-infra-stack academics-routes-stack; jest stack specs)
  ├── (Reviewer approval — final review per memory `feedback_consult_before_code_changes`)
  ├── (Pre-deploy: capture shared-infra-stack template size baseline)
  │     `npx cdk synth shared-infra-stack | wc -c > /tmp/baseline.txt`
  ├── Merge PR to main
  ├── cdk diff shared-infra-stack (tee'd) → review: Body shrinks ~250KB; no other deltas
  ├── (Reviewer approval — diff matches expectation)
  ├── cdk diff academics-routes-stack (tee'd) → review: ~77 Resources + ~150-220 Methods
  ├── (Reviewer approval — diff matches expectation)
  ├── cdk deploy shared-infra-stack academics-routes-stack (CFN serializes per-stack; serial is OK)
  ├── Post-deploy: `aws apigateway get-resources --rest-api-id $REST_API_ID` — confirm exactly one resource per path; no duplicates
  ├── Post-deploy: byte-count check
  │     `npx cdk synth shared-infra-stack | wc -c` ⇒ <600KB target
  └── Smoke validation (Phase 3) immediately

Phase 3 PR (post-deploy parity smoke + sprint closeout)
  ├── (CI green; script type-checks via tsc)
  ├── (Reviewer approval — script only)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT → /tmp/dev-jwt.txt (Write tool, NOT heredoc per §17.10 L13 retro)
  ├── PILOT_ID=dev-pabson-primary npx ts-node scripts/smoke-tests/academics-routes-parity-smoke.ts
  ├── tee log to docs/deploys/prod-smoke-academics-routes-parity-<ts>-<sha>.log
  └── Verify 15/15 checkpoints match pre-migration baseline
```

**No UAT.** Per memory `feedback_pr_first_no_more_uat`. Per-step user-in-the-loop authorization via `AskUserQuestion` for every CDK deploy + smoke execution.

---

## 8. Open decisions (need sign-off before branch cut)

1. **Stack scope — academics only or multiple domains?**
   - **(a) Academics only.** *Recommended.* Proves the pattern + recovers ~250KB → ~55% template utilization. Subsequent migrations (identity, finance) become opt-in per-domain sprints when each team next touches routes.
   - **(b) Academics + identity in one sprint.** Bigger PR; ~150 paths migrated; ~520KB recovery → ~30% utilization. Higher risk; harder review. *Not recommended for first cut.*
   - **(c) All domains.** Way too big for one sprint. *Not recommended.*

2. **NlbDnsName + VpcLinkId exports — do they already exist in `shared-infra-stack`?**
   - Phase 0 audit verifies. If exports are missing (likely — `analytics-stack` uses Lambda integration, not NLB-proxy), a pre-sprint XS PR adds them to `shared-infra-stack` BEFORE the R41 split work starts. **Critical prerequisite.**
   - *Recommendation: Phase 0 PR audits first; if missing, drop a pre-Phase-0 XS PR adding the exports.*

3. **Atomic single PR vs split PRs for Phase 1 + Phase 2?**
   - **(a) Atomic single PR.** *Recommended.* Avoids the duplicate-path window. Reviewers see the full migration in one diff. Rollback is git-revertable.
   - **(b) Two PRs with a flag-gated dual-deploy window.** Phase 1 deploys the new stack but `cdk synth` is gated; Phase 2 toggles the gate + deletes JSON entries. More moving parts; "duplicate-path window" risk avoided via flag.
   - *Recommendation: (a). Per CLAUDE.md migration discipline — atomic over phased when the change has a cross-stack invariant.*

4. **Parallel `cdk deploy shared-infra-stack academics-routes-stack` — safe?**
   - CFN `cdk deploy <stack1> <stack2>` is **serial by default** per the AWS CDK docs (dependency order). `academics-routes-stack` has `.addDependency(sharedInfraStack)` so it deploys AFTER shared-infra. But the migration intent is "delete from shared-infra AND add to academics-routes" → in the dependency order, that means the old paths are unregistered FIRST, then the new ones registered → brief window where academics routes 403/404.
   - **Mitigation:** Deploy `academics-routes-stack` FIRST (independently — it requires CFN exports already present), then `shared-infra-stack` SECOND (with deletions). This creates a brief overlap window instead of a brief gap window — overlap is recoverable, gap is operator-visible 503s. CFN dependency order MAY need explicit override or a 2-step `cdk deploy` invocation.
   - *Recommendation: invert the dependency order for this migration — `shared-infra-stack` depends on (or sequenced after) `academics-routes-stack` for this specific change. Phase 0 audit confirms approach with a synth-time test.*

5. **Smoke target — `dev-pabson-primary` + Saraswati prod, or only `dev-pabson-primary`?**
   - Saraswati has minimal academics data (no exams, no result-cards). Most smoke checkpoints would SKIP gracefully.
   - **Recommendation:** run full smoke on `dev-pabson-primary`. Run a 5-checkpoint subset on Saraswati prod to verify API GW routing works end-to-end on the real pilot tenant.

6. **Sprint number / naming.**
   - Master plan §11.2 R41 is the risk register entry; this isn't yet an EPIC sprint with a letter+number.
   - **Recommendation:** call it "Sprint R41" in PR titles + closeout entry; file under "Foundation infra" or "B0.1 backlog" in the master plan.

7. **Backward compatibility for the previous shared-infra-stack template-size baseline.**
   - Once academics paths leave the inline Swagger, future engineers reading `tenant-api-prod.json` won't see the full API surface for academics. The file becomes a partial source of truth.
   - **Recommendation:** add a top-level comment to `tenant-api-prod.json` (Swagger spec allows `x-` extensions but no top-level comments — alternative: a banner on the closest companion file) noting "Academics paths are now declared in `server/lib/shared-api-routes/academics-routes-spec.ts`. See routes-stack-split-sprint-plan.md".
   - Per-domain README in `server/lib/shared-api-routes/` recommended.

8. **What happens to the existing UAT account.**
   - UAT was sunset per memory `feedback_pr_first_no_more_uat`. **No UAT deployment for this sprint.** Synth + diff against prod only. Smoke against dev-pabson-primary (prod tenant).

9. **Phase count — 3 vs 4.**
   - Combining Phase 1 + Phase 2 atomically (per §8 #3 (a)) yields **3 phases total: Phase 0 (extract) + Phase 1+2 (deploy) + Phase 3 (smoke)**. Cleaner than 4.
   - *Recommendation: 3 phases.*

---

## 9. Definition of Done (Sprint R41)

- [ ] All 9 tickets meet §1.1 per-ticket DoD (Files + Validation + AC + Deps + Risk)
- [ ] §8 open decisions signed off + documented in r41-foundation-readiness-audit.md
- [ ] All 3 PRs merged to main
- [ ] Pre-deploy template-size baseline captured in r41-foundation-readiness-audit.md (`cdk synth shared-infra-stack | wc -c`)
- [ ] Phase 1+2 deploy log: `docs/deploys/prod-cdk-deploy-shared-infra-stack-<ts>-<sha>.log` + `prod-cdk-deploy-academics-routes-stack-<ts>-<sha>.log`
- [ ] Post-deploy template-size measurement: shared-infra-stack <600KB (vs ~877KB pre-migration)
- [ ] Post-deploy `aws apigateway get-resources` snapshot: exactly one CFN-managed resource per academics path; no duplicates
- [ ] Phase 3 smoke log: `prod-smoke-academics-routes-parity-<ts>-<sha>.log` with 15/15 checkpoints matching baseline
- [ ] Saraswati 5-checkpoint smoke subset: 5/5 green
- [ ] Closeout entry added to `docs/pilot-greenlight/sprint-closeouts.md`
- [ ] Status table in `v1-master-epic-breakdown.md` §0.4 updated: `R41 🟢 shipped <date>` + PRs/logs
- [ ] Master plan §11.2 R41 row marked CLOSED with reference to the closeout
- [ ] Master plan §17.x updated with a new "L14 — inline-Swagger pattern is a CFN-ceiling foot-gun" lesson if the migration surfaces unexpected gotchas
- [ ] Memory written: `project_sprint_r41_shipped_prod.md` (status, recovered byte count, next-domain pre-greenlight gate)
- [ ] CLAUDE.md change-to-deploy matrix updated: a new row "`<domain>-routes-spec.ts` change" → `deploy <domain>-routes-stack`
- [ ] CLAUDE.md "three-way handoff" rule amended to reflect that migrated domains use the routes-spec.ts file instead of `tenant-api-prod.json`
- [ ] No regressions in A.4 / A.3 / D.1 / E.0 / E.1 / 0.4 smokes (regression bundle re-run pre-merge of Phase 1+2)

---

## 10. What this plan deliberately does NOT include

- Migrating `/schools/*`, `/users/*`, `/staff/*`, `/finance/*`, `/education-organizations/*` — separate per-domain follow-up sprints when their owners next touch routes. Each is XS-S scope using the helpers built here.
- Rewriting the Python authorizer in TS — strict cardinal rule from analytics-stack precedent
- Adding new API GW routes — pure migration; new routes from D.2/D.3 go through this pattern AFTER it lands
- Modifying CORS behavior or auth flow — strict carry-over of existing behavior
- Frontend changes — operator-facing URL/path/auth-header surface is unchanged
- Per-domain JSON file split (pattern (a) from the session handoff) — does NOT solve R41 (§0 finding)
- Per-domain README / onboarding doc for the new pattern — recommended but separate doc PR (not blocking R41 ship)
- Stack-level CDK Nag audit — V1.5; pre-existing CDK Nag debt covers this already (CLAUDE.md note)
- Custom Domain re-mapping or DNS changes — RestApi id stays; no DNS impact
- Stage-specific deployments — `prod` stage only; no UAT
- Auto-generation of routes-spec from controller decorators — V1.5 (would be nice but adds tooling complexity; the parity spec is sufficient)

---

## Sign-off requested

Open decisions in §8 above are the gates. Once signed off:

1. **Cut feature branch:** `sprint/r41-phase-0-extract` on the server repo for Phase 0 docs + parity spec. Per memory `feedback_explicit_cd_per_git`: every git op starts with explicit `cd /Users/shoaibrain/edforge` in the same invocation.
2. **Pre-Phase-0 prerequisite (if §8 #2 confirms missing exports):** open a separate XS PR adding `NlbDnsName` + `VpcLinkId` CFN exports to `shared-infra-stack`; ship before R41 work begins.
3. Begin Phase 0 implementation.

# Sprint 2 — pre-implementation audit (2026-09-04)

Read before C2.1 was written, against the code as merged in PR #447. The
Sprint 2 rows in `MIGRATION_PLAN.md` carry pointers to the findings that
change them. Nothing here re-opens the Q2 decision (REST stays, strangler
API-B, stage variables); it corrects the plan where the code disagreed.

## What was read

`server/lib/shared-infra/api-gateway.ts`, `usage-plans.ts`, the API/usage-plan
and export wiring in `shared-infra-stack.ts`; `server/lib/tenant-api-prod.json`
(Swagger 2.0, 279 paths, 408 `http_proxy` operations, 279 `MOCK` `OPTIONS`,
two unauthenticated operations, one TOKEN authorizer definition);
`server/lib/analytics/analytics-stack.ts` (the API Lambda and the five routes
attached to API-A); `scripts/check-route-drift.ts` (controller sources,
exemptions); `server/application/reverseproxy/nginx.template` (the prefix
table); every cross-service HTTP call site in academics and finance and the
`libs/http-client` request path; the internal-API-key guard; the plan's §0
assumptions about service-to-service traffic.

## Findings

1. **Three routes are deliberately outside the spec and the plan did not
   know it.** `POST /internal/webhooks/enrollment-completed`,
   `POST /internal/webhooks/student-withdrawn` (finance) and
   `GET /internal/schools/{schoolId}/academic-years` (identity) are exempted
   in the route linter as "Service Connect only" and authenticate with the
   shared `x-internal-api-key`. §0 said internal calls "can go through API-B
   with no code change"; through API-B as specified they would get 403 before
   any header is read. Every one of those call sites *does* forward the
   operator's JWT alongside the key (finance `identity-client.service.ts:420`,
   academics `enrollment.service.ts:255,806`), so the fix needs no service
   code: the three operations join **API-B's** spec behind the shared
   authorizer, and the service-side key guard still applies. Public exposure
   changes from "unreachable" to "JWT of the tenant + shared key", which is
   the same trust the operator-facing routes already carry plus the key.
2. **nginx has no `/internal` location**, so the finance webhooks cannot reach
   finance-on-ECS through the VPC link (`location /` would send them to
   identity). They target the **finance Lambda** (`financeFn`), which runs the
   same code against the same table and exists since Sprint 1, while
   operator-facing `/finance/*` stays on the VPC link until Sprint 5. The
   identity internal route targets `identityFn`.
3. **API-B-only paths must not enter the source spec.** API-A already owns
   `/analytics/*` as CloudFormation resources created by the analytics stack;
   importing a body that declares the same paths on API-A would fight those
   resources. The five analytics routes and the three internal routes live in
   a new `server/lib/tenant-api-additions.json` that only the API-B generator
   reads. `tenant-api-prod.json` (API-A) is not edited in Sprint 2 at all.
4. **The analytics API Lambda already has the fixed name
   `edforge-analytics-api`** (`analytics-stack.ts:615`; 1,024 MB, 30 s). C2.7's
   feared replacement does not exist. What remains of C2.7 in Sprint 2 is the
   `apigateway.amazonaws.com` invoke permission scoped to API-B. **The attach
   on API-A must stay** until the frontend has left API-A (C4.2): deleting it
   deletes API-A's `/analytics/*` methods. The deletion moves to C6.3.
5. **Route map.** Seventeen top-level prefixes in the source spec route to
   identity (including `/`, which carries only the `OPTIONS` mock), `academics`
   to academics, `finance` to the VPC link in Sprint 2. nginx's `/parents` 501
   stub has no spec path and simply disappears with the reverse proxy.
6. **Request-parameter mappings.** All 63 distinct `requestParameters`
   shapes are `tenantPath` plus path-parameter passthroughs; an `aws_proxy`
   integration needs none of them. The generator strips the whole block for
   Lambda targets; the linter's residue check (C2.3) proves nothing survived.
7. **The two unauthenticated operations** (`POST /auth/login`,
   `GET /tenants/lookup`) fail on API-A without a `tenantPath` header because
   the ALB default action answers (F0.5). On API-B there is no ALB; they work.
   F0.5 closes when the frontend moves.
8. **Authorizer sharing is a function-level fact, not a construct-level one.**
   API-B's spec names the same function through `${stageVariables.authorizerFn}`
   with literal region/account, exactly as API-A does; the function needs one
   more resource-policy statement for API-B's `execute-api` ARN. API-B gets
   its own three usage plans bound to its stage with the **same** `ApiKey`
   constructs, and `apiKeySourceType: AUTHORIZER`.
9. **Stage variables on API-B:** `authorizerFn`, `vpcLinkId`, `nlbDns`,
   `identityFn`, `academicsFn`, `financeFn`, `analyticsFn`. The existing
   `api-gateway.spec.ts` asserts exactly three on API-A; API-A does not change.
10. **Binary media types** go in the spec root
    (`x-amazon-apigateway-binary-media-types`, supported for Swagger 2.0
    import); `minCompressionSize` is a `SpecRestApi` prop. Responses' CORS
    headers on `aws_proxy` come from Nest's `enableCors` (both runtimes),
    not from the mock; C2.8 checks a real cross-origin request, not only the
    preflight.
11. **Deploy order.** shared-infra (API-B, needs Docker for the Python
    authorizer bundle) → tenant-template (invoke permissions import
    `TenantApiLambdaRestApiId`) → analytics (invoke permission). API-A's three
    exports are untouched, so no export-lock pre-flight is needed; the new
    exports are `TenantApiLambdaRestApiId` and `TenantApiLambdaUrl`.
12. **The frontend repo is not in this worktree** (nested, separate git
    repository), so the Vercel variable name for C2.9 is confirmed from that
    repo at ops time; the ticket is an ops step either way.
13. **6 MB Lambda-proxy response cap.** CSV exports already go through a
    presigned URL (`export-csv-url`); PDFs are hundreds of KB. C2.8 records the
    largest observed response size from API-B's access logs so the cap is a
    measured non-issue rather than an assumed one.

## Decisions taken

- **D2.1** API-B reads `tenant-api-prod.json` + `route-map.json` +
  `tenant-api-additions.json`; API-A keeps reading `tenant-api-prod.json`
  alone. The strangler invariant becomes a deploy gate: `cdk diff
  shared-infra-stack` for Sprint 2 must show API-A's RestApi, Stage and
  Deployment unchanged.
- **D2.2** Internal routes: through API-B behind the authorizer; finance's to
  `financeFn`, identity's to `identityFn`. Closes F1.1 (the finance guard's
  school check) once C2.6 points `IDENTITY_SERVICE_URL` at API-B.
- **D2.3** C2.7 is reduced to the API-B invoke permission; the API-A attach
  deletion moves to C6.3.
- **D2.4** The linter's `/internal/*` exemptions are removed in C2.3 (they
  become spec'd paths for API-B); `/auth/health` stays exempt.

## Refined ticket deltas

| Ticket | Delta from the plan |
|---|---|
| C2.1 | Adds `tenant-api-additions.json` (5 analytics + 3 internal paths, explicit target per path) beside `route-map.json`; the spec keeps the additions in lockstep with the analytics stack's `addRoute` list and the linter's exemptions. The source spec is not edited. |
| C2.2 | Generator merges the additions; strips `requestParameters` for Lambda targets; keeps `finance` on the VPC link verbatim. |
| C2.3 | Drops the three `/internal/*` exemptions; treats additions as spec surface for check (2)/(4). |
| C2.6 | No `/internal` code change needed; finance webhooks flow academics → API-B → finance Lambda. F1.1 closes here. |
| C2.7 | Permission only; no rename, no attach deletion (→ C6.3). |
| C2.8 | Adds: real cross-origin request check, largest-response measurement, F0.5 verification on API-B. |

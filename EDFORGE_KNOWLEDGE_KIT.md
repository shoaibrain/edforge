# EdForge — Knowledge Kit (Job Search & Resume)

> A distilled, **honest** reference for talking about EdForge in resumes, cover
> letters, and interviews. Everything here is grounded in the actual codebase
> (`edforge` backend + `edforge-saas-frontend`). Numbers are counted, not
> estimated. Nothing here inflates scope — see [§9 Honest scope](#9-how-to-be-honest-about-scope) for what *not* to claim.

**Owner:** Shoaib Rain — architect & lead engineer, Edforge Technologies LLC.

---

## 1. The one-liner and the pitch

**One-liner (resume header / LinkedIn):**
> Architected and built EdForge, a multi-tenant SaaS EMIS (school-operations
> platform) on AWS — NestJS microservices, event-driven DynamoDB, and a
> Module-Federation micro-frontend — aligned to the Ed-Fi education data standard.

**30-second version (recruiter / "tell me about a project"):**
> EdForge is a multi-tenant Education Management Information System — think the
> operating system for a K–12 school: enrolment, attendance, academics, exams,
> results, and finance, plus the regional reporting that ties a school back to
> its national education data standard. I designed and built it end to end:
> five AWS CDK stacks, three NestJS backend services behind an API gateway, a
> five-app micro-frontend, and the shared type/contract packages that hold them
> together. It's source-available and running its first production pilot with a
> school in Nepal.

**2-minute version (technical screen):** cover, in order — (1) the *problem*:
schools need one system for operations + national reporting, and it has to
localize deeply (calendar, currency, language, grade taxonomies); (2) the
*multi-tenant SaaS shape*: control plane provisions tenants, application plane
runs their workloads, they talk over EventBridge; (3) the *data model*:
DynamoDB single-table-per-service with a tenant partition key, no cross-table
joins — services integrate via events/HTTP; (4) the *extensibility bet*:
"archetypes" of school operations instead of hard-coded country logic, enforced
in CI; (5) the *frontend*: Module Federation so each domain (academics,
finance, people) is an independently-deployable remote loaded by a shell host.

---

## 2. What it actually is (honest framing)

| Dimension | Reality |
|---|---|
| **Stage** | Early-stage / **first production pilot** (a Nepal community school). Not a large-scale, high-traffic production system. |
| **Team** | Effectively **solo founder-engineer** (Shoaib), AI-assisted development. Sole primary author across both repos. |
| **Maturity** | V1 ships **`BASIC` tier only**; `ADVANCED`/`PREMIUM` tiers are deliberate dormant scaffolding (`V1_DEFERRED`). One archetype live (`PABSON`, Nepal) + a `GENERIC` fallback. |
| **License** | Source-available (Business Source License 1.1, converts to Apache-2.0 in 2030). Not open source. |
| **Deployment** | Single AWS account/region per environment; two env profiles (non-prod + prod). Data model is multi-region-*ready*; deployment is not. |

**Why this framing helps you:** the honest story is *breadth + ownership + depth*,
not *scale*. You designed a real, coherent, production-deployed distributed
system solo. That is a strong signal for staff/senior IC and founding-engineer
roles — don't dilute it by pretending it's a 10M-user system.

---

## 3. Tech stack at a glance

**Backend (`edforge`)**
- **Runtime/framework:** NestJS (TypeScript) — 3 services: `identity`, `academics`, `finance`; NGINX `rproxy` as the request router.
- **Compute:** Amazon ECS Fargate (pooled cluster for BASIC tenants).
- **Data:** DynamoDB single-table design **per service**; GSIs for access patterns; soft-delete via `isActive`; `TransactWriteItems` for atomic finance writes.
- **Events:** Amazon EventBridge (domain events, analytics fan-out, DLQ + poison-pill capture).
- **Auth:** Amazon Cognito (system-admin pool + per-tier tenant pool), JWT claims, **ABAC** (attribute-based access control), post-auth trigger Lambda injecting tenant context.
- **Edge/API:** API Gateway (REST, OpenAPI spec, Cognito authorizer), ALB + NLB.
- **IaC:** AWS CDK (TypeScript) — **5 stacks**; built on the AWS SaaS Builder Toolkit (SBT) + ECS SaaS reference architecture.
- **Tenant lifecycle:** SBT control plane + CodeBuild provisioning/deprovisioning ScriptJobs; tenant-seeder Lambda.
- **Analytics:** write-path + read-path Lambdas, dedicated analytics DDB, CloudWatch dashboards, SNS operator alerts.
- **Validation/contracts:** Zod schemas in shared packages (pinned `~3.24.4` — see [§8 STAR #1](#star-1--the-white-screen-that-typechecked-clean)).
- **Standards:** Ed-Fi Data Standard **v6** alignment (descriptors, mappers).

**Frontend (`edforge-saas-frontend`)**
- **Architecture:** Micro-frontend via **Module Federation** (`@module-federation/enhanced`) — a `shell` host + remotes: `academics`, `finance`, `people`, `analytics`.
- **Build:** Rsbuild, Turborepo, pnpm workspaces.
- **UI/runtime:** React 19, TanStack Router / Query / Table / Virtual (pinned singletons), Zustand, Tailwind CSS v4, Framer Motion.
- **i18n:** i18next (English + Nepali), custom **Bikram Sambat** date picker.
- **Shared packages (16):** `ui`, `abac`, `theme`, `types`, `auth`, `api-client`, `wizard`, `forms`, `i18n`, `archetype`, `date-utils`, domain service SDKs, etc.
- **Testing:** Vitest + MSW (unit/component), Playwright (E2E, incl. AI-agent-driven planner/generator/healer flows via Playwright MCP), role fixtures, WCAG-contrast checks.

**Cross-cutting:** TypeScript everywhere, monorepos, CI gates (typecheck/lint/route-drift/archetype-invariants/secret-scan), a documented multi-stage deploy ladder (local → non-prod → human approval → prod).

---

## 4. Architecture in 60 seconds

```
CONTROL PLANE                          APPLICATION PLANE
  AdminWeb (S3+CloudFront)               SBT ApplicationPlane
  Control-Plane API (Lambda+SBT)  ──►      (Provision/Deprovision CodeBuild)
  System-admin Cognito pool              Shared infra: VPC, ALB/NLB, API GW,
  SBT EventBridge bus  ───────────────►  Lambda authorizer, tenant-mapping DDB
                                         BASIC tier (pooled):
                                           ECS Fargate cluster
                                             identity · academics · finance · rproxy
                                           Tenant Cognito pool + ABAC roles
                                           Domain events → EventBridge → analytics
```

**Five mechanisms worth being able to draw on a whiteboard:**
1. **Two-plane SaaS** — control plane manages tenant lifecycle; application plane runs tenant workloads; they're decoupled through EventBridge (`onboardingRequest` → CodeBuild provision → `provisionSuccess` → seeder Lambda).
2. **Pooled multi-tenancy** — BASIC tenants share ECS services and DDB tables; isolation is a **tenant partition key + ABAC**, not separate infra. (Dedicated-infra tiers are scaffolded, dormant.)
3. **Single-table-per-service** — each service owns one DDB table; no cross-service joins; integration is events or HTTP to the owning service.
4. **Three-way route registration** — every API route exists in *three* places in lockstep: NestJS controller, API Gateway OpenAPI spec, NGINX rproxy. A CI route-drift linter enforces it. (Great "systems thinking" talking point.)
5. **Archetype model** — locale/calendar/currency/grade-taxonomy defaults are keyed on an *archetype* (operational pattern), not a country; branching on `country === 'NPL'` is a **CI build failure**. This is the extensibility thesis of the whole product.

---

## 5. Resume bullets (a menu — pick 3–5 per role)

Copy-paste ready. Verifiable counts in brackets are real; keep or drop the numbers to taste. Lead with the ones that match the job description.

**Architecture / systems (senior/staff IC, platform):**
- Architected a multi-tenant SaaS EMIS as **5 AWS CDK stacks** with a two-plane (control/application) design, using the AWS SaaS Builder Toolkit for tenant lifecycle and Amazon EventBridge to decouple tenant provisioning from workload runtime.
- Designed **pooled multi-tenancy** for the BASIC tier — shared ECS Fargate services and DynamoDB tables isolated by a tenant partition key and attribute-based access control (ABAC) — with dormant, tested scaffolding for per-tenant dedicated-infra upgrade tiers.
- Modeled the data layer as **single-table DynamoDB per service** with GSI access patterns and event-driven cross-service integration (no cross-table joins), including atomic multi-item finance writes via `TransactWriteItems`.

**Backend (NestJS / distributed systems):**
- Built **3 NestJS microservices** (identity, academics, finance) behind an NGINX reverse proxy and API Gateway, emitting a consistent domain-event envelope to EventBridge for analytics fan-out and audit archival. [~397 service source files, ~223 test specs]
- Implemented an event-driven analytics pipeline (write-path/read-path Lambdas, dedicated DDB, DLQ + poison-pill capture, CloudWatch dashboards, SNS operator alerts).
- Enforced API-contract integrity with a custom **route-drift linter** guaranteeing every endpoint is registered across NestJS, the API Gateway OpenAPI spec, and the NGINX proxy.

**Frontend (React / micro-frontends):**
- Built a **Module Federation micro-frontend**: a shell host dynamically loading independently-deployable remotes (academics, finance, people, analytics) with shared singleton runtime deps (React 19, TanStack Router/Query). [5 apps, **16 shared packages**, ~1,000 source files]
- Delivered deep localization for the Nepal market — i18next (English/Nepali) and a from-scratch **Bikram Sambat ↔ Gregorian** calendar (BS 2000–2090) shared across UI date pickers and backend analytics.
- Stood up a **210-spec** Vitest + MSW test suite and a Playwright E2E harness, including AI-agent-driven test planning/generation/healing via Playwright MCP.

**Domain / standards:**
- Aligned the data model to the **Ed-Fi v6** education data standard (descriptors, mappers, TypeScript projections) and built a report-time projection layer mapping each school's local grade codes to the archetype's canonical national taxonomy for regulatory (IEMIS) reporting.
- Designed an **archetype-based extensibility model** so locale/calendar/currency/grade rules scale to new operational patterns without country-specific branching — enforced by a CI invariant check.

**Infra / DevEx / reliability:**
- Authored a codified **deploy ladder** (local gates → non-prod → human approval → prod) with a CDK deploy wrapper (SHA stamping, artifact regeneration, cdk-nag toggle) and a change-to-deploy matrix mapping each change type to the exact stack to redeploy.
- Diagnosed and documented a class of **silent production failures** (bundle-init crashes, cross-stack CFN export locks, IAM action-name mismatches) as reusable engineering playbooks.

---

## 6. Skills matrix (ATS keywords → evidence)

| Skill / keyword | Concrete evidence in EdForge |
|---|---|
| AWS (CDK, ECS Fargate, DynamoDB, Lambda, EventBridge, Cognito, API Gateway, S3, CloudFront, SNS, CodeBuild, CloudWatch) | 5-stack CDK app; pooled ECS; single-table DDB; event-driven Lambdas; Cognito ABAC |
| Multi-tenant SaaS architecture | Control/application plane split; pooled tier; SBT tenant lifecycle |
| Infrastructure as Code | AWS CDK (TypeScript), 92 CDK source files, deploy ladder + wrapper |
| Microservices | 3 NestJS services + rproxy; event choreography; per-service data ownership |
| Event-driven architecture | EventBridge envelope, analytics fan-out, DLQ/poison-pill handling |
| NoSQL data modeling | DynamoDB single-table design, GSIs, transactions, soft-delete axis |
| React / TypeScript frontend | React 19, TanStack stack, Zustand, Tailwind v4 |
| Micro-frontends | Module Federation (Rsbuild), shell + 5 remotes, shared singletons |
| Auth & access control | Cognito, JWT claims, ABAC, post-auth trigger Lambda, field governance |
| Testing | Vitest + MSW (210 specs), Playwright E2E, AI-agent test flows, WCAG checks |
| i18n / localization | i18next EN/NE, Bikram Sambat calendar, currency/number/timezone by tenant |
| Domain / data standards | Ed-Fi v6 alignment, IEMIS regulatory reporting projection |
| Monorepo / DevEx | pnpm + Turborepo (FE), npm workspaces (BE), CI invariant gates |
| Dependency & release management | Load-bearing version pins, publish-and-redeploy discipline, semver traps |

---

## 7. Interview deep-dive topics (know these cold)

Each is a place an interviewer can go deep. For each: the *substance*, then the
*why-it's-interesting* hook.

1. **Multi-tenant isolation strategy** — pooled (shared services + tenant partition key + ABAC) vs. the dormant dedicated-infra tiers. *Hook:* the classic SaaS cost/isolation tradeoff, and why you built the cheap tier first but left the isolation seam in place.
2. **DynamoDB single-table-per-service** — how you encode entity type + tenant in keys, why you refuse cross-table joins, and how services stay consistent via events. *Hook:* CAP/consistency tradeoffs; eventual consistency between services.
3. **The archetype model** — why localization is keyed on operational archetype, not country, and how it's enforced in CI. *Hook:* designing for extensibility without over-engineering; the "school-first" nuance where a school's local grade codes are the source of truth and the national taxonomy is a report-time projection.
4. **Three-way route registration + route-drift linter** — one endpoint, three files (controller/OpenAPI/nginx), and the CI gate that keeps them honest. *Hook:* turning a repeated production incident into a static check.
5. **Event-driven analytics + failure handling** — EventBridge envelope, fan-out, DLQ, poison-pill capture, operator SNS alerts. *Hook:* observability and graceful degradation in async systems.
6. **Localization depth** — building a Bikram Sambat calendar converter and threading tenant-level regional settings (currency/timezone/week-start) through both backend and UI without letting school entities override them.
7. **The deploy ladder** — codified local→non-prod→approval→prod pipeline, the change-to-deploy matrix, and cross-stack export hazards. *Hook:* release engineering discipline for a solo operator managing real infra.

---

## 8. STAR stories (concrete, technical, memorable)

These are real debugging/design episodes documented in the codebase. They make
you sound like an engineer who ships and diagnoses, not just designs.

### STAR #1 — "The white screen that typechecked clean"
- **S/T:** After a dependency bump, the admin portal rendered a blank white tab in production — no error in the build output, nothing in the HTML.
- **A:** Traced it to `zod` 3.25's "v4 preview" shipping a circular ESM re-export that webpack (CRA) couldn't statically analyze; a `TypeError` fired at module-init *before* React could call `createRoot`. Pinned zod repo-wide to `~3.24.4`, added a `<3.25.0` peer-dependency bug-fence, and established a **jsdom bundle-init simulation** as a pre-deploy gate because a clean `npm run build` is not proof the bundle mounts.
- **R:** Turned a silent, severe, hard-to-reproduce failure into a one-line pin + an automated guard. *Lesson:* the type-checker and the bundler validate different things; guard the runtime bundle, not just the types.

### STAR #2 — "AccessDenied that wasn't a permissions bug"
- **S/T:** A CDK-deployed Lambda kept getting IAM `AccessDenied` calling an AWS API despite a syntactically correct inline policy.
- **A:** Instead of reaching for retries/backoff, ran the **IAM Policy Simulator** against the deployed role — got `implicitDeny` with zero matched statements, which meant the *action name itself* wasn't recognized at evaluation time (SES v1 action names return implicitDeny in-region; the v2 SDK names are honored). Switched to the v2 SDK + action names.
- **R:** 30-second diagnosis instead of hours of retry-budget guessing. *Lesson:* `AccessDenied` has multiple root causes; simulate before you retry.

### STAR #3 — "The empty diff *was* the bug"
- **S/T:** A new academics code path read a row from the identity service's DynamoDB table for archetype resolution; it silently returned empty/wrong data in a deployed environment, no 5xx.
- **A:** Recognized that each service's ECS task role is scoped to its *own* table, so cross-service reads need an explicit IAM grant — and that a *clean* `cdk diff` was a **false-clear** (an empty diff meant the grant was missing, exactly the gap). Added the minimal `dynamodb:GetItem` grant on the identity table to the academics task role.
- **R:** Fixed a silent data-degradation bug and documented "empty diff can be the failure signal" as a team trap. *Lesson:* graceful degradation can hide missing infra; verify the grant appears in the diff.

### STAR #4 — "One endpoint, three files"
- **S/T:** New API routes kept failing post-deploy with confusing symptoms — `403 SigV4` in one case, `404` (nginx) in another — even though the NestJS controller existed.
- **A:** Identified that every route must be registered in **three** places in lockstep (NestJS controller, hand-maintained API Gateway OpenAPI spec, NGINX rproxy) and wrote a **route-drift linter** to enforce it at build time, plus a symptom→cause diagnosis table (403 SigV4 = API GW missing; nginx 404 = proxy missing; JSON 404 = controller missing).
- **R:** Converted a recurring class of deploy incidents into a static CI check. *Lesson:* when a mistake repeats, encode the fix as a gate.

### STAR #5 — "Designing for the second customer, not the first"
- **S/T:** The first pilot is a Nepal school, but hard-coding `country === 'NPL'` logic would make the codebase un-scalable to the next operator type.
- **A:** Introduced a first-class **archetype** concept (write-once, immutable at provisioning) carrying locale/calendar/currency/grade defaults, made archetype defaults override country defaults, and added a CI invariant that *fails the build* on `country ===`-style branches in service code.
- **R:** Extensibility is enforced mechanically, not by discipline. *Lesson:* the cheapest time to prevent a country-specific mess is before the second country.

> **Runner-up stories** (mention if asked for more): cross-stack CFN export
> locks (`Cannot update export … in use by <stack>`) and the SSM-decoupling
> two-PR migration pattern; NestJS DI module-wiring invariant caught by a
> dedicated wiring spec; the `status` vs `isActive` two-axis entity-state model.

---

## 9. How to be honest about scope

Say these plainly if asked — they build credibility, and getting caught
overclaiming destroys it.

- **"It's a pilot, not a system at scale."** First production pilot with one
  school. Don't cite user/traffic numbers you don't have.
- **"I built it largely solo, AI-assisted."** True and increasingly normal.
  Frame AI as a force-multiplier on a system *you* architected and understand
  end-to-end — then prove the understanding in the deep-dives (§7). The commit
  history shows AI co-authorship; be upfront, and let your ability to explain
  every tradeoff carry the credibility.
- **"V1 is the BASIC tier."** The advanced/premium tiers and multi-region are
  deliberate scaffolding, not shipped features. Call them design seams, not
  capabilities.
- **"One archetype is live."** PABSON (Nepal) + a generic fallback. Other
  archetype enum values are reserved, not runtime-valid.
- **Don't claim** SOC2/compliance, 99.9% SLAs, load-tested throughput, or a
  team you didn't have. You don't need them — the architecture breadth is the
  story.

**The honest headline:** *"I designed and shipped a real, coherent,
production-deployed multi-tenant SaaS on AWS — solo — and I can defend every
architectural decision in it."* That is a strong claim precisely because it's
true.

---

## 10. Likely tough questions → honest answers

| Question | Honest, strong answer |
|---|---|
| "Solo project — how do I know it's real?" | It's source-available and deployed; walk through the CDK stacks, the event flow, and a specific bug I diagnosed (§8). I can whiteboard the two-plane architecture from memory. |
| "How much did AI write?" | AI accelerated implementation; I own the architecture and every tradeoff. Ask me why single-table-per-service, or why archetype-not-country — the reasoning is mine. |
| "Why DynamoDB single-table and not Postgres?" | Pooled multi-tenant access patterns are key-driven and known ahead of time; DDB gives per-tenant partitioning and predictable scaling. Tradeoff: no ad-hoc joins, so cross-service integration is events/HTTP by design. |
| "Why micro-frontends for a solo build — isn't that overkill?" | It maps to independently-deployable business domains and lets the shell own cross-cutting concerns (auth, tenant context, nav). Honest cost: build/runtime complexity and shared-singleton discipline. |
| "What would you do differently?" | Finish the local clone-and-run loop (finance/rproxy aren't in docker-compose yet); reduce the `no-explicit-any` ratchet backlog; add integration tests under real task roles to catch the IAM false-clear class earlier. |
| "Biggest thing you learned?" | Distributed-systems failures are usually silent (white screen, empty diff, degraded fallback). Most of my hardening work was turning silent failures into loud, automated gates. |

---

## 11. Role targeting

Strongest fits, in rough order:
- **Founding / early engineer** at a startup — you've done the 0→1 full-stack + infra + product ownership.
- **Senior/Staff backend or platform engineer** — AWS + IaC + distributed systems depth.
- **Cloud / DevOps / Infrastructure engineer** — CDK, ECS, multi-account deploy discipline.
- **Full-stack senior** — genuine both-ends coverage (NestJS ↔ React MFE) tied by shared contracts.
- **SaaS architecture / solutions** roles — multi-tenancy is the throughline.

Tailoring tip: for a **backend/platform** JD lead with §5 architecture+backend
bullets and STAR #2/#3/#4; for a **frontend/full-stack** JD lead with the
Module Federation + i18n + testing bullets and STAR #1/#4.

---

## 12. Verifiable facts appendix (so you never misquote yourself)

- Backend: **3 NestJS services** (identity, academics, finance) + NGINX rproxy; **5 CDK stacks**; ~**397** service source files, ~**223** test specs, ~**92** CDK source files; **5** shared packages.
- Frontend: **5 MFE apps** (shell, academics, finance, people, analytics); **16 shared packages**; ~**1,000** source files; **210** Vitest specs; ~**38** E2E/spec files.
- Standards: **Ed-Fi v6**; regional reporting = IEMIS (Nepal).
- Localization: **English + Nepali**; Bikram Sambat calendar **BS 2000–2090**.
- Live scope: **BASIC tier**, **PABSON + GENERIC** archetypes, single region, two env profiles.
- Stack keywords: NestJS · React 19 · TypeScript · AWS CDK · ECS Fargate · DynamoDB · EventBridge · Cognito · Lambda · API Gateway · Module Federation · TanStack · Tailwind · Zod · Vitest · Playwright · pnpm · Turborepo.

---

*This kit is a personal job-search aid for Shoaib Rain. It lives on a feature
branch, not `main` — keep it out of the public source-available release unless
you intend it to be public.*

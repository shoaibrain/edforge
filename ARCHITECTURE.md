# EdForge — Architecture

This document explains EdForge's runtime shape: the stacks it deploys, the
services that run inside them, how data and events flow between those
services, and the conventions that hold the codebase together. It is the
companion to [README.md](README.md) for evaluators, contributors, and
self-hosters.

> **Scope.** This document describes the V1 BASIC tier — the only tier that
> ships running today. Forward-looking scaffolding for `ADVANCED` and
> `PREMIUM` tiers exists in the codebase (`tenant-template-stack-advanced`,
> dedicated ECS clusters, per-tenant Cognito pools), but it is labelled
> `V1_DEFERRED` and is intentionally dormant. Treat dormant ≠ dead.

---

## Bird's-eye view

EdForge is a **multi-tenant SaaS** deployed into a single AWS account, with a
**control plane** that manages tenants and an **application plane** that runs
each tenant's workloads. The two planes communicate via Amazon EventBridge:
SBT events (`onboardingRequest`, `provisionSuccess`, etc.) drive tenant
lifecycle from the control plane into the per-tier infrastructure.

```
                    ┌────────────────────────────────────────────────────┐
                    │                    CONTROL PLANE                    │
                    │                                                      │
                    │   ┌─────────────┐    ┌──────────────────────┐       │
                    │   │  AdminWeb   │ →  │  Control-Plane API   │       │
                    │   │  (S3 + CF)  │    │  (Lambda + SBT)      │       │
                    │   └─────────────┘    └──────────┬───────────┘       │
                    │                                  │                    │
                    │   ┌──────────────────┐    SBT EventBridge bus         │
                    │   │ System-admin     │    (onboarding, provision,     │
                    │   │ Cognito pool     │     deprovision events)        │
                    │   └──────────────────┘                                │
                    └────────────────────────────────────┬─────────────────┘
                                                          │
                                                          ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │                          APPLICATION PLANE                         │
        │                                                                     │
        │  ┌─────────────────┐   ┌─────────────────────────────────────┐     │
        │  │ SBT             │   │   Shared infrastructure              │     │
        │  │ ApplicationPlane│ → │   • VPC + multi-AZ subnets          │     │
        │  │ (Provisioning + │   │   • ALB + NLB + API Gateway          │     │
        │  │  Deprovisioning │   │   • Tenant-mapping DDB                │     │
        │  │  CodeBuild jobs)│   │   • Lambda authorizer                 │     │
        │  └─────────────────┘   └─────────────────────────────────────┘     │
        │                                                                     │
        │  ┌────────────────────── BASIC tier (pool) ──────────────────────┐ │
        │  │                                                                │ │
        │  │   ECS cluster (Fargate)                                        │ │
        │  │     ├── identity   (NestJS, per-service DDB)                   │ │
        │  │     ├── academics  (NestJS, per-service DDB)                   │ │
        │  │     ├── finance    (NestJS, per-service DDB)                   │ │
        │  │     └── rproxy     (NGINX request routing)                     │ │
        │  │                                                                │ │
        │  │   Tenant Cognito pool, ABAC roles, post-auth trigger Lambda    │ │
        │  │   Service domain events → EventBridge → analytics fan-out      │ │
        │  └────────────────────────────────────────────────────────────────┘ │
        └──────────────────────────────────────────────────────────────────┘
```

Each tenant in `BASIC` is logically separated by an ABAC partition key on
shared DynamoDB tables, served by shared ECS services. The
`ADVANCED`/`PREMIUM` tiers (dormant) would add dedicated services and
dedicated clusters per tenant; the CDK stack scaffolding is present.

---

## CDK stack topology

The application is defined as five [AWS CDK](https://aws.amazon.com/cdk/)
stacks. They deploy in this order; explicit `addDependency` calls in
`server/bin/ecs-saas-ref-template.ts` enforce the ordering.

```
shared-infra-stack
   ├── VPC + multi-AZ subnets
   ├── ALB (per-tier listener) + NLB
   ├── API Gateway (REST API, Cognito authorizer, OpenAPI from
   │   server/lib/tenant-api-prod.json)
   ├── Tenant-mapping DDB table
   ├── CloudFront distribution for AdminWeb
   ├── Lambda layers (shared runtime deps)
   └── EventDLQ sub-stack (poison-pill capture for SBT events)

controlplane-stack   (depends on shared-infra-stack)
   ├── System-admin Cognito user pool
   ├── SBT EventBus (tenant lifecycle events)
   ├── Control Plane API
   ├── AdminWeb S3 source bucket + CodePipeline (rebuilds AdminWeb
   │   from `client/AdminWeb/` on every deploy)
   └── tenant-seeder Lambda (writes per-tenant METADATA + SETTINGS rows
       to the identity service's DDB table after provision)

analytics-stack   (depends on controlplane-stack)
   ├── Write-path Lambdas (consume EventBridge, write to analytics DDB)
   ├── Read-path Lambdas (serve analytics queries via API Gateway)
   ├── Analytics DDB (RETAIN — survives stack destroy)
   ├── Operator-alert SNS topic
   └── CloudWatch dashboards

core-appplane-stack   (depends on analytics-stack)
   ├── SBT ApplicationPlane
   ├── ProvisioningScriptJob (CodeBuild)
   ├── DeprovisioningScriptJob (CodeBuild)
   └── CloudWatch alarms for CodeBuild failures

tenant-template-stack-basic   (depends on shared-infra-stack)
   ├── ECS cluster (Fargate) — one cluster shared by all BASIC tenants
   ├── ECS services: identity, academics, finance, rproxy
   ├── Per-service DynamoDB tables (RETAIN)
   ├── Tenant Cognito user pool
   ├── Post-auth trigger Lambda (injects tenant context into JWT claims)
   └── ABAC IAM roles

tenant-template-stack-advanced   (defined but NOT deployed in V1)
   └── Same shape as -basic, but with the V1_DEFERRED hooks for
       per-tenant cluster + per-tenant Cognito pool isolation.
```

`scripts/deploy.sh` wraps `cdk deploy` with the guardrails the deploy
ladder expects: SHA stamping, log tee, `cdk-nag` toggle, and a pre-flight
check for unsubstituted placeholders in `server/lib/service-info.json`
(generated at deploy time from `server/service-info.txt`).

---

## Backend services

Each ECS service is a [NestJS](https://nestjs.com/) application packaged as
a single Docker image, pushed to ECR by `scripts/build-application.sh`, and
deployed as a service in the per-tier ECS cluster. There are four:

### `identity`

The tenant boundary. Owns:

- **Users + roles** — Cognito-backed authentication; ABAC roles encoded in
  JWT claims; `RolesService` + `RoleAssignmentService` manage assignments.
- **Schools** — each tenant has one or more schools; school-level config
  (calendar system, locale, branding) lives here.
- **Workspace settings** — tenant-level settings (locale, calendar,
  currency, regional defaults) sourced from archetype + country defaults
  at provision time, mutable afterward at tenant-admin level.
- **EMIS codes** — opaque external identifiers (e.g., national reporting
  identifiers) attached to schools and credentials for regional reporting.
- **Branding** — tenant logo / colors / contact / PAN / VAT for invoice +
  receipt + admit-card rendering.
- **Audit log** — all identity-domain writes emit `*.{c,e,d}` events
  (`created`, `edited`, `deleted`) to EventBridge with the actor's claims.

### `academics`

The academic year. Owns:

- **Academic years + terms** — calendar shape, term boundaries.
- **Calendar** — sessions, holidays, grading periods, multi-day events
  (parent-teacher conferences, sports week, etc.).
- **Grade levels + courses** — Ed-Fi-aligned grade level descriptors
  (incl. archetype-specific extensions like `ECD/PPC` for early childhood
  in Nepal); courses extend the Ed-Fi course descriptor.
- **Exams + results** — exam subsystem (component-based, weighted), result
  cards, grading policies, gradebook.
- **Enrolment** — student-section enrolments, in-process IEMIS bulk
  imports.

### `finance`

The money. Owns:

- **Fee structures** — per-grade-level recurring fees, one-off charges.
- **Invoices** — auto-generated from fee structures, currency from tenant
  workspace settings (locked currency-from-tenant-settings).
- **Payments** — manual entry + receipt rendering; atomic
  `TransactWriteItems` over payment + invoice + ledger + billing-account.
- **Ledger** — per-school running balance; appended on every payment,
  void, refund.
- **Credit notes + refund requests** — non-cash adjustments with audit.

### `rproxy`

NGINX in a container. Routes tenant-API requests to the right backend
service based on URL prefix (`/users`, `/schools`, `/academics/*`,
`/finance/*`, …). All cross-service request shape lives in
`server/application/reverseproxy/nginx.template`; adding a new
top-level URL prefix requires editing this file (in addition to the
NestJS controller and the `server/lib/tenant-api-prod.json` OpenAPI
spec — the **three-way route registration** is one of EdForge's
common-edit traps).

---

## Data model

EdForge uses **DynamoDB single-table design per service**: every service
has one table whose primary key encodes the entity type and tenant ABAC
boundary. Cross-service queries do **not** join across tables — they go
through EventBridge or through HTTP calls to the owning service.

### Tenant boundary on every key

Every item in every per-service table carries:

- A bare tenant UUID as the partition key (column-level; entity files
  describe the logical `TENANT#<tid>` notation, but the stored value is the
  bare UUID — trust the factory functions over file headers).
- A composite sort key encoding entity type + entity id, e.g.
  `SCHOOL#<schoolId>`, `USER#<userId>`, `INVOICE#<invoiceId>`.
- GSI projections for common access patterns (e.g., GSI1 for `SCHOOL`
  partitioned by tenant for listings).

### Settings inheritance

Tenant-wide settings live on `WorkspaceSettings` in the `identity` table.
School entities **must not override** regional settings (currency,
timezone, calendar, locale, number format, week start) — they are
inherited from the tenant. This rule is enforced by code review and by
the archetype-aware default-resolution in `ArchetypeDefaultsService`.

Archetype defaults override country defaults when both are set. Branching
on archetype, not country: `archetype === 'PABSON'` is the right check;
`country === 'NPL'` is not. The codebase scales to additional archetypes
by adding entries to `ArchetypeDefaults`, not by sprinkling country checks.

---

## Event flow

Domain mutations emit events to **Amazon EventBridge** with a consistent
envelope:

```
{
  source:        "edforge.<service>",                // edforge.identity, edforge.academics, ...
  detailType:    "<entity>.<verb>",                  // user.created, exam.scheduled, invoice.voided
  detail: {
    tenantId, schoolId, userId, ...,                 // ABAC + correlation
    actor: { sub, roles[], claims },                 // who did it
    before, after,                                   // optional diff payload
    correlationId,                                   // optional idempotency key
    ts
  }
}
```

Consumers fan out from a single bus:

- **Analytics write-path Lambda** — projects events into the analytics
  DDB tables (read by AdminWeb dashboards).
- **Operator-alert SNS topic** — paged on failure events from any
  service or from CodeBuild provisioning jobs.
- **Cross-service projections** — e.g., `identity.user.created` triggers
  a tenant-seeder Lambda that backfills downstream service rows.
- **Audit-log archival** — every audit event lands in an immutable
  log GSI partition for compliance.

The `analytics-stack`'s `EventDLQ` sub-stack captures poison-pill events
that fail every consumer, with CloudWatch alarms on DLQ depth.

---

## Frontends

### AdminWeb (`client/AdminWeb/`)

The system-administrator portal. React + MUI, built with Create React App.

- Deployed via the `controlplane-stack` CodePipeline (S3 → CloudFront).
- **Requires every dependency to resolve from the npm registry** — npm
  workspace symlinks are invisible to CodeBuild. Any dependency that
  AdminWeb imports must be published (or made workspace-only and
  manually inlined). This constraint is unique to AdminWeb's StaticSite
  deploy model — backend services (resolved at local `nest build`) do
  not have it.
- Bundled with webpack via CRA, which is sensitive to `package.json`
  pin drift (see [Dependency pins](#dependency-pins-that-must-not-drift)
  below) — silent browser-bundle failures are a documented failure mode.

### Tenant-facing frontend

The tenant-facing web is a **separate repository** (module-federation host
+ per-domain MFEs) and is **not** in this repo today. Its public release
is planned as a follow-up. The backend services in this repo serve its
APIs; CORS origins must include the tenant frontend URL or requests fail.

---

## Shared libraries (`packages/`)

EdForge's npm-workspace packages are the cross-service contract.

| Package | Distribution | Consumers |
|---|---|---|
| `@aibrains/shared-types` | **Published to npm** (public) | Every service, every MFE, AdminWeb |
| `@aibrains/pdf-renderer` | Published to npm | finance (invoices/receipts), academics (admit cards/report cards) |
| `@edforge/edfi-ts-models` | Workspace + (optional) npm | TypeScript projections of Ed-Fi v6 JSON schemas |
| `@edforge/pilot-fixtures` | Workspace-only (private) | Synthetic demo data, parametric per archetype |
| `@edforge/tenant-settings-resolver` | Workspace-only (private) | analytics + finance (cached tenant settings read) |

**Rule of consumption**: anything AdminWeb imports must be in the
**`@aibrains/*` (published)** column. Workspace-only packages are fine for
backend services + Lambdas (which resolve symlinks locally during build),
but they will break the AdminWeb CodeBuild pipeline.

---

## Archetype model

EdForge builds for **archetypes** of school operations, not individual
schools or countries:

- `Tenant.archetype` is a first-class field, **write-once** at
  provisioning, immutable afterward. Field-governance enforces this.
- V1 archetype values: `'PABSON'` (the first shipped) and `'GENERIC'`.
  Reserved (type-only, not runtime-valid): `'CBSE_IN'`, `'NAIS_US'`,
  `'GEMS_UAE'`.
- Each archetype carries `ArchetypeDefaults`: locale, calendar system,
  currency, week-start, number format, grade-level catalog, allowed
  IEMIS code shapes, etc.
- Regional settings live **only** on `WorkspaceSettings` at the tenant
  level. Schools may not override them.

### Bikram Sambat calendar

The first archetype (`PABSON`) is a Nepal-aligned community-school
archetype, which means EdForge ships a [Bikram Sambat
↔ Gregorian](https://en.wikipedia.org/wiki/Vikram_Samvat) converter
([`packages/shared-types/src/utils/bikram-sambat.ts`](packages/shared-types/src/utils/bikram-sambat.ts), BS 2000–2090). The
analytics Lambda and the `BsDatePicker` UI component both depend on it.
**Do not build a second BS converter** — import from `@aibrains/shared-types`.

---

## Dependency pins that must not drift

A small number of package versions are pinned tighter than `^semver`
would suggest because a newer "compatible" release breaks a downstream
bundler or runtime. These pins are **load-bearing**, not paranoia.

### `zod` → `~3.24.4` (repo-wide)

zod `3.25+` ships a "v4 preview" via a circular ESM re-export through
`./v4/classic/external.js`. The re-export chain cannot be statically
analyzed by webpack (as used by AdminWeb's CRA build), and the runtime
symptom is silent and severe: a `TypeError` fires at module-init on the
AdminWeb bundle before React can call `createRoot` — the browser tab
stays white, and the HTML reveals nothing.

- All consumer `package.json` files use **`"~3.24.4"`** (tilde, patch
  range), not `"^3.x"`.
- The `@aibrains/shared-types` peerDependency is `">=3.22.0 <3.25.0"` —
  the `<3.25.0` upper bound is the bug-fence.
- Migration to zod v4 is a deliberate coordinated effort, gated on
  AdminWeb webpack compatibility and an end-to-end jsdom bundle-init
  simulation that catches silent module-init crashes.

### General rule — guard the bundle, not just the type-check

When any frontend-consumed package's dep graph shifts (`@aibrains/*`
publish, lockfile churn, `npm audit fix`), a clean `npm run build` of
AdminWeb is **not** sufficient evidence. webpack will build a bundle
that crashes at module init without producing any error in the build
output. The defensive check is a jsdom bundle-init simulation; before
the next AdminWeb publish you should be able to reproduce the
simulation locally.

---

## Local development

Backend services have a local-development loop via
`server/docker-compose.local.yml`:

- **LocalStack** — fakes AWS APIs (DynamoDB, SQS, SNS, EventBridge).
- **DynamoDB Local** — table CRUD without network round-trip.
- **identity + academics** — services run in containers with `NODE_ENV`
  set to local; auth is configurable via `SKIP_ABAC` (currently dead, on
  the cleanup list).

The local loop today covers identity + academics. **finance** and
**rproxy** are not yet in the compose file — adding them is a tracked
follow-up. Clone-and-run completeness is a public roadmap item; until
then, a full evaluation requires deploying to a real AWS account.

---

## Production deployment

EdForge deploys to a **single AWS account per environment**. Multi-account
or multi-region deployments are V1_DEFERRED. The deploy steps are:

1. CDK bootstrap the target account / region (one-time per environment).
2. Set environment variables (account ID, region, tenant frontend URL,
   CORS origins, system-admin email, etc.) in `server/.env.<profile>`.
3. Deploy the stacks in dependency order via `scripts/deploy.sh`:
   shared-infra → controlplane → analytics → core-appplane →
   tenant-template-basic.
4. Build + push the ECR images via `scripts/build-application.sh`.
5. Force an ECS rolling update for each service to pick up the new
   images.
6. Provision the first tenant via the AdminWeb UI (or the
   control-plane API directly).

Every CDK deploy needs `cdk diff` first; mutating an export that another
stack imports is a known failure mode and the deploy must be staged in
two passes (e.g., temporarily decoupling via SSM).

Specifics of regions, account IDs, and per-environment settings are
**not** in this document — those live in operator-private configuration
files. The CDK code is parameterized so the same stack synthesizes for
any region or account given the right context values.

---

## Frontends, services, and CDK — where to look next

| Question | Read |
|---|---|
| What's the data model? | `packages/shared-types/src/` (Zod schemas + types) |
| How does archetype/locale work? | `packages/shared-types/src/archetype/` and `packages/shared-types/src/locale/` |
| How does identity work end-to-end? | `server/application/microservices/identity/src/` |
| What does the academic year look like? | `server/application/microservices/academics/src/` |
| How are stacks wired? | `server/bin/ecs-saas-ref-template.ts` (entry) + `server/lib/` (stack defs) |
| How is auth claims-mapped? | `server/application/libs/auth/` |
| How are events emitted? | look for `EventsService` or `eventBridge.putEvents` in each service |
| How does AdminWeb authenticate? | `client/AdminWeb/src/services/` + Amplify Cognito setup |
| Where are the PDF templates? | `packages/pdf-renderer/src/` |
| Where is the BS converter? | `packages/shared-types/src/utils/bikram-sambat.ts` |

---

## Acknowledgements

EdForge extends and re-deploys substantial work from the upstream
[`aws-samples/saas-reference-architecture-ecs`](https://github.com/aws-samples/saas-reference-architecture-ecs)
reference architecture (MIT-0) and the
[AWS SaaS Builder Toolkit](https://github.com/awslabs/sbt-aws). Without
those primitives the V1 control plane would not exist. See
[NOTICE](NOTICE) for the upstream attribution preserved with each
distribution.

The data model aligns to the [Ed-Fi Data Standard v6](https://www.ed-fi.org/)
maintained by the Ed-Fi Alliance.

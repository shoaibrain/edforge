# EdForge

> A multi-tenant Education Management Information System (EMIS) for K–12 schools.
> Cloud-native, [Ed-Fi v6](https://www.ed-fi.org/) aligned, source-available.

EdForge is the operating system for a school: enrolment, attendance, academics,
exams, results, finance, and the regional reporting that ties a school back to
its national education data standard. It is built for archetypes of school
operations — not for a single country, district, or product tier — so the same
codebase can serve a community school in Nepal, a charter network in the US, or
any operator whose workflows we have a model for.

This repository is the **public source** of EdForge. It is **source-available**,
not open source: see [Licensing](#licensing) below for what that means in
practice and the [LICENSE](LICENSE) file for the legal text. The runtime shape
— stacks, services, data model, event flow — is documented in
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## Status

EdForge is **in active development by a small team** and is being used to power
its first production pilot. The first public release covers:

- **`BASIC` tier only.** The codebase contains forward-looking scaffolding for
  `ADVANCED` and `PREMIUM` tiers (tenant-template-stack-advanced, dedicated
  ECS clusters per tenant, etc.); those paths are intentionally dormant in V1
  and labelled `V1_DEFERRED` throughout the code. Do not mistake them for dead
  code.
- **One archetype** of operations is shipped: a community/private school
  serving K–12 in a national curriculum, with archetype-aware locale,
  calendar (including [Bikram Sambat](https://en.wikipedia.org/wiki/Vikram_Samvat)
  date support), currency, and regional reporting.
- **Single AWS region per environment**, multi-tenant within that region. The
  data model is multi-region-ready; the deployment is not.

Read this as: the parts you can run today are production-tested; the parts
labelled deferred or experimental in code are exactly that.

---

## What's in the box

EdForge ships as a monorepo with three deployable surfaces and a handful of
shared libraries.

### Backend microservices (NestJS on Amazon ECS Fargate)

- **`identity`** — tenant users, roles, school registry, workspace settings
  (locale, calendar, regional defaults), branding, EMIS codes, ABAC.
- **`academics`** — academic years, terms, calendar (sessions, holidays,
  multi-day events), grade levels, courses, exams, results, gradebook.
- **`finance`** — fee structures, invoices, payments, ledger, receipts,
  credit notes, refund requests, currency-aware from tenant settings.
- **`rproxy`** — the NGINX reverse proxy that fronts the per-tier service
  mesh.

Each service is a NestJS application with its own DynamoDB single-table model
and emits domain events to Amazon EventBridge for fan-out to analytics and
cross-service integration.

### Frontends

- **`client/AdminWeb/`** — the system-administrator React/MUI portal. Tenant
  provisioning, system-wide configuration, ops UX. Built with Create React
  App, deployed to S3 + CloudFront by the control-plane CDK stack.
- **The tenant-facing web frontend** is **not** in this repository (it ships
  as a separate module-federation host with per-domain MFEs). Its public
  release is planned as a follow-up.

### Shared libraries (`packages/`)

- **`@aibrains/shared-types`** — Zod schemas, TypeScript types, validators,
  mappers, locale defaults, archetype catalogs. Published to npm. The
  contract between every service, every MFE, and every consumer.
- **`@aibrains/pdf-renderer`** — JSX-based document templates for invoices,
  receipts, report cards, admit cards. Localized (English + Nepali) and
  Bikram-Sambat-date-aware.
- **`@edforge/edfi-ts-models`** — TypeScript interfaces generated from the
  Ed-Fi Data Standard v6 JSON schemas.
- **`@edforge/pilot-fixtures`** — synthetic, parametric demo data. The
  engine knows zero real pilots; concrete pilots are data dropped under
  `packages/pilot-fixtures/pilots/<archetype>-<id>/`.
- **`@edforge/tenant-settings-resolver`** — pluggable resolver for tenant
  workspace settings with LRU + TTL caching; two backends (direct DDB for
  in-VPC consumers, HTTP for ECS services).

### Infrastructure (AWS CDK in `server/`)

- `shared-infra-stack` — VPC, ALB, NLB, API Gateway, tenant-mapping DDB,
  CloudFront for the admin portal.
- `controlplane-stack` — Cognito system-admin user pool, SBT EventBus,
  control-plane API, tenant-seeder Lambda, admin-portal S3 + CloudFront.
- `analytics-stack` — write-path and read-path Lambdas, analytics DDB,
  EventBridge fan-out, operator-alert SNS topic.
- `core-appplane-stack` — SBT ApplicationPlane, tenant provisioning +
  deprovisioning CodeBuild jobs.
- `tenant-template-stack-basic` — the per-tier template that becomes the
  shared compute plane for `BASIC` tenants (ECS cluster, services, per-
  service DDB tables, tenant Cognito pool, ABAC roles).

EdForge is built on top of the [AWS SaaS Builder Toolkit (SBT) ECS reference
architecture](https://github.com/aws-samples/saas-reference-architecture-ecs)
— see [NOTICE](NOTICE) for the upstream attribution.

---

## Quick orientation

This is not a "run-it-in-five-minutes" project. EdForge deploys into your own
AWS account and provisions real infrastructure (CodeBuild, ECS, DynamoDB,
Cognito, API Gateway, S3, CloudFront). Setup is a deliberate process.

- **Read the source first.** The architecture, naming conventions, and the
  deploy ladder are documented inline in the code and in the per-package
  READMEs under `packages/`.
- **Local development** is partially supported via
  `server/docker-compose.local.yml` (LocalStack + DynamoDB Local + the
  `identity` and `academics` services). A complete clone-and-run local
  loop is on the public roadmap and not finished today.
- **A full AWS deployment** requires CDK bootstrap, environment context, the
  stacks above deployed in order, and several configuration parameters
  (Cognito setup, CORS origins, tenant-frontend URL). The runtime shape and
  deploy ladder are documented in [ARCHITECTURE.md](ARCHITECTURE.md); a
  step-by-step `docs/deploy.md` is forthcoming.

If you are evaluating EdForge for adoption, the highest-signal next reads are:

1. `packages/shared-types/src/` — the data model and validators.
2. `server/application/microservices/identity/src/` — tenant + user + school
   domain logic, including the archetype/locale model.
3. `server/lib/` — the CDK stacks; this is where the deployment shape lives.

---

## Project governance

EdForge is **owner-driven**. The roadmap, scope, and merge decisions sit with
Edforge Technologies LLC.

- **Bug reports** are welcome via Issues. Please include a minimal reproducer
  and the commit SHA you observed it on.
- **Pull requests** are reviewed at the owner's discretion. Small, focused
  PRs that fix a real bug or improve test coverage land most easily. See
  [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow,
  including the **Developer Certificate of Origin (DCO)** sign-off
  requirement on every commit.
- **Feature requests are not accepted as Issues.** Use a Discussion if you
  want to surface a use case; we will fold it into the roadmap (or not) at
  our discretion.
- **Security issues** must not be filed publicly. A `SECURITY.md` with the
  reporting process is forthcoming; until then, contact the project owner
  via the address on their GitHub profile.

EdForge is **built in public**, but the public surface is intentionally
narrow: the repository, the README, and the changelog. Roadmap conversations
happen between the team and pilots, not on GitHub.

---

## Licensing

EdForge is licensed under the **Business Source License 1.1** (BSL 1.1):
see [LICENSE](LICENSE) for the full terms.

In plain English:

- **You can** read the source, run it for your own organization's operations
  (including a for-profit school or school network), modify it, and
  redistribute it under the same license.
- **You cannot** use EdForge to provide a hosted or managed service to
  third parties. If your business model is "SaaS-ify EdForge and resell it,"
  that requires a commercial license from Edforge Technologies LLC.
- On the **Change Date** (June 1, 2030), the license auto-converts to
  Apache License 2.0. The version you receive under that flip is the
  version released on or before that date; future versions stay BSL 1.1.

EdForge is **source-available, not open source**. We try to message it
that way. The codebase contains and depends on a wide range of open-source
work: see [NOTICE](NOTICE) for upstream attribution (notably the AWS SBT
ECS reference architecture, Apache-2.0) and
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the full
enumeration of npm dependencies.

`"EdForge"` and the EdForge logo are trademarks of Edforge Technologies
LLC. Self-hosting EdForge does not grant trademark rights — see the
Trademarks section of [NOTICE](NOTICE).

---

## Acknowledgements

- The [AWS SaaS Builder Toolkit](https://github.com/awslabs/sbt-aws) team for
  the SBT control plane primitives, and the
  [`aws-samples/saas-reference-architecture-ecs`](https://github.com/aws-samples/saas-reference-architecture-ecs)
  project for the ECS multi-tenancy reference patterns that EdForge extends.
- The [Ed-Fi Alliance](https://www.ed-fi.org/) for the Ed-Fi Data Standard
  that EdForge's data models align to.
- Every educator and operator who has corrected our assumptions about how
  school operations actually work, especially in the Nepal-archetype
  context where EdForge first ships.

# Changelog — `@aibrains/shared-types`

All notable changes to the package are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/) — but note the `~3.24.4` zod pin in CLAUDE.md and the `~` pin convention for consumers (caret on a 0.x version is a footgun, see EdForge memory `edforge_shared_types_caret_pin`).

History before 0.39.0 lives in git log — this changelog starts at the release where per-release notes became a standing requirement (Sprint 1 of the dev-tenant-system project, ground rule from `docs/dev-tenant-system/SPRINT-PLAN.md`).

## [0.39.0] — 2026-05-07

### Added
- `tenantTagSchema` enum in `schemas/identity/tenant.schema.ts` distinguishing tenant lifecycle classes: `'production' | 'internal-dev' | 'internal-dev-rehearsal'`. Foundation for the dev-tenant-system project — lets the same prod infra host real customer tenants alongside internal R&D tenants without ambiguity.
- `tenantTag` field on `tenantResponseSchema` (optional during the Sprint 1 transition window; tightened to required in a follow-up after Saraswati's backfill ships).
- Schema-layer immutability reject for `tenantTag` on `updateTenantSchema` via the existing `immutableField` helper — PATCH attempts surface a targeted `'tenantTag is immutable — set at provisioning, cannot be changed'` message rather than silently stripping.
- Field-governance entry: `tenantTag` added to `FIELD_MUTABILITY.immutable` for defense in depth alongside the API-layer reject. Block-comment explains the rationale (silent mutation would defeat operator dashboard hygiene + the deprovision tag-gate).
- Tests: 21 new specs across `tenant.schema.spec.ts` and `field-governance.spec.ts` covering enum acceptance/rejection, schema-level immutability with targeted error messages, response-with-and-without-tag parsing, and field-governance classification (`isFieldLocked`, `classifyUpdateFields`, `getFieldMutability`).

### Notes for consumers
- **No silent default at the schema layer.** The default `'production'` is applied at the controller in `POST /tenants` (T1.6), not in this schema, so a missing value at the API surface is an explicit business decision.
- **AdminWeb consumes this release.** Per the AdminWeb publish-gate (CLAUDE.md), the jsdom bundle sim must pass before `controlplane-stack` redeploy — see Sprint 1 T1.11 in the dev-tenant-system sprint plan.
- **Identity service consumes this release at runtime** via the tenant-seeder Lambda (T1.5) and ControlPlane API (T1.6). After publish, deploy `controlplane-stack` (re-bundles tenant-seeder + AdminWeb), then ECR push + ECS roll for `identitybasic`.

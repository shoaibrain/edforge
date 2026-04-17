# @aibrains/shared-types v0.24.0 — Release Notes

## Summary

Adds analytics API contract schemas under `./schemas/analytics`. Backwards
compatible with v0.23.x — purely additive.

## What's new

New subpath: `@aibrains/shared-types/schemas/analytics`

Exports (zod schemas + inferred types):

- **Time-series**: `metricSeriesSchema`, `metricSeriesPointSchema`, `tenantTimeSeriesResponseSchema`
- **Adoption**: `adoptionReportSchema`, `adoptionMetricEntrySchema`, `adoptionMetricKeySchema`, `adoptionStatusSchema`
- **Fleet**: `fleetSummarySchema`, `fleetFeatureCountSchema`
- **Sessions**: `sessionHistoryResponseSchema`, `sessionHistoryEventSchema`, `sessionEventTypeSchema`
- **Export**: `exportCsvUrlResponseSchema`
- **Errors**: `analyticsErrorResponseSchema`
- **Primitives**: `granularitySchema`, `dateSecondarySchema` (generic dual-calendar — supports BS, HIJRI, THAI_BUDDHIST, etc.)

All exports also flow through the main entry (`from '@aibrains/shared-types'`).

## Why this release

The EdForge analytics platform serves both the AWS-deployed analytics-api Lambda
and the Vercel-deployed tenant-facing saas-frontend. Without shared types in
the published npm package, the two would drift. Previously these types lived in
a private workspace package (`@edforge/shared-analytics-types`) only
accessible to the AWS monorepo; this release makes them available to the
saas-frontend via npm.

## Migration

No breaking changes. Existing consumers continue to work.

New consumers should:

```ts
// AWS-side (Lambda, AdminWeb)
import type { FleetSummary } from '@aibrains/shared-types'; // main entry works

// Vercel saas-frontend (via @edforge/types bridge)
import type { FleetSummary } from '@edforge/types/analytics';
```

## Publishing checklist

```bash
cd packages/shared-types
npm run clean && npm run build
npm publish
```

After publish:
1. saas-frontend bridge already declares `^0.24.0` — `pnpm install` pulls it
2. Verify `pnpm --filter @edforge/types build` succeeds
3. Verify a saas-frontend app builds: `pnpm --filter shell build`

## Risks / rollback

None — purely additive subpath. If a critical bug is found post-publish,
deprecate v0.24.0 (`npm deprecate`) and consumers stay on v0.23.1.

/**
 * Analytics API Schemas — Single Source of Truth
 *
 * Response shapes for the EdForge analytics-api Lambda's `/analytics/*`
 * endpoints. Both the AWS-deployed Lambda handler AND the Vercel-deployed
 * tenant-facing saas-frontend consume these via `@aibrains/shared-types`,
 * so the contract cannot drift between producer and consumer.
 *
 * Design notes:
 * - `dateSecondary` is a GENERIC dual-calendar field (not BS-specific).
 *   When tenant settings have `enableDualDateDisplay = true`, responses
 *   carry the secondary calendar; otherwise the field is omitted.
 *   Supports `system: 'BS' | 'HIJRI' | 'THAI_BUDDHIST' | <future>`.
 * - Schemas are zod for runtime validation; types inferred for TS.
 * - Request validation lives in the Lambda (server-side); this package
 *   exports response shapes only — keeps browser bundle slim.
 */

export * from './primitives';
export * from './metric-series';
export * from './adoption-report';
export * from './fleet-summary';
export * from './session-history';
export * from './export-csv-url';
export * from './error';

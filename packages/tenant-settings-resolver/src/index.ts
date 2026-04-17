/**
 * @edforge/tenant-settings-resolver
 *
 * Pluggable resolver for tenant WorkspaceSettings with LRU + TTL caching.
 *
 * Backends:
 *   - DdbTenantSettingsResolver — DDB-direct, for in-VPC high-frequency
 *     consumers (analytics aggregator, future insights/digest Lambdas).
 *   - HttpTenantSettingsResolver — HTTP via caller-supplied fetcher, for
 *     ECS services (finance, future academics).
 *   - InMemoryTenantSettingsResolver — for tests + local dev.
 *
 * All backends share:
 *   - LRU cache (default 200 entries) + TTL (default 5 minutes)
 *   - In-flight dedup (concurrent get(tenantId) → 1 backend call)
 *   - invalidate(tenantId) and invalidateAll() for event-driven cache busting
 *   - Normalized error model (TenantSettingsNotFoundError, TenantSettingsBackendError)
 */

export * from './types';
export * from './cache';
export * from './resolver';
export * from './ddb-resolver';
export * from './http-resolver';
export * from './in-memory-resolver';

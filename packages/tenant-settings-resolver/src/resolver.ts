/**
 * Resolver interface + base class with caching.
 *
 * Backends (DDB, HTTP, in-memory) extend `BaseTenantSettingsResolver` and
 * implement `fetchUncached()`. The base class handles caching, in-flight
 * dedup (multiple concurrent get(t) → single backend call), and error
 * normalization.
 */

import { LruTtlCache, LruTtlCacheOptions } from './cache';
import {
  TenantSettingsBackendError,
  TenantSettingsNotFoundError,
  TenantWorkspaceSettings,
} from './types';

export interface TenantSettingsResolver {
  /**
   * Get workspace settings for a tenant.
   * @throws TenantSettingsNotFoundError if the tenant has no settings row
   * @throws TenantSettingsBackendError on backend failures (network, etc.)
   */
  get(tenantId: string): Promise<TenantWorkspaceSettings>;

  /** Drop a single tenant's cached entry. Idempotent. */
  invalidate(tenantId: string): void;

  /** Drop all cached entries. Used after bulk-config changes or on shutdown. */
  invalidateAll(): void;
}

export interface BaseResolverOptions extends LruTtlCacheOptions {
  /**
   * Optional logger for cache hits/misses + backend errors. The resolver is
   * NOT in the analytics hot path's blocking surface (failures degrade
   * gracefully via the consumer's fallback), but operators want visibility.
   */
  logger?: Logger;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export abstract class BaseTenantSettingsResolver implements TenantSettingsResolver {
  protected readonly cache: LruTtlCache<TenantWorkspaceSettings>;
  protected readonly logger: Logger;
  /** In-flight requests keyed by tenantId — coalesces concurrent get() calls. */
  private readonly inflight = new Map<string, Promise<TenantWorkspaceSettings>>();

  constructor(opts: BaseResolverOptions = {}) {
    this.cache = new LruTtlCache<TenantWorkspaceSettings>(opts);
    this.logger = opts.logger ?? noopLogger;
  }

  /** Subclasses implement the actual fetch. Errors must be normalized below. */
  protected abstract fetchUncached(tenantId: string): Promise<TenantWorkspaceSettings>;

  async get(tenantId: string): Promise<TenantWorkspaceSettings> {
    if (!tenantId) {
      throw new TenantSettingsBackendError('tenantId is required');
    }
    const cached = this.cache.get(tenantId);
    if (cached) {
      this.logger.debug('tenant-settings cache hit', { tenantId });
      return cached;
    }

    // Dedup concurrent fetches.
    const existing = this.inflight.get(tenantId);
    if (existing) {
      this.logger.debug('tenant-settings dedup hit', { tenantId });
      return existing;
    }

    const promise = this.fetchUncached(tenantId)
      .then((settings) => {
        this.cache.set(tenantId, settings);
        this.logger.debug('tenant-settings cache miss → fetched', {
          tenantId,
          cacheSize: this.cache.size,
        });
        return settings;
      })
      .finally(() => {
        this.inflight.delete(tenantId);
      });

    this.inflight.set(tenantId, promise);
    return promise;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.inflight.delete(tenantId);
    this.logger.info('tenant-settings invalidated', { tenantId });
  }

  invalidateAll(): void {
    this.cache.clear();
    this.inflight.clear();
    this.logger.info('tenant-settings invalidated (all)');
  }
}

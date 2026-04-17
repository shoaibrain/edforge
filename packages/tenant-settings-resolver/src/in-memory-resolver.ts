/**
 * In-memory resolver — for tests and local development.
 *
 * Backend = a Map<tenantId, TenantWorkspaceSettings>. Useful for asserting
 * that a consumer behaves correctly with specific settings without
 * standing up DDB or HTTP.
 */

import {
  BaseTenantSettingsResolver,
  type BaseResolverOptions,
} from './resolver';
import {
  TenantSettingsNotFoundError,
  type TenantWorkspaceSettings,
} from './types';

export interface InMemoryResolverOptions extends BaseResolverOptions {
  /** Initial seed entries; can be added/removed later via setSetting/deleteSetting. */
  seed?: ReadonlyArray<TenantWorkspaceSettings>;
}

export class InMemoryTenantSettingsResolver extends BaseTenantSettingsResolver {
  private readonly store = new Map<string, TenantWorkspaceSettings>();
  /** Number of times fetchUncached() has been invoked — surfaces cache hits in tests. */
  public fetchCount = 0;

  constructor(opts: InMemoryResolverOptions = {}) {
    super(opts);
    for (const s of opts.seed ?? []) this.store.set(s.tenantId, s);
  }

  setSetting(s: TenantWorkspaceSettings): void {
    this.store.set(s.tenantId, s);
    this.invalidate(s.tenantId);
  }

  deleteSetting(tenantId: string): void {
    this.store.delete(tenantId);
    this.invalidate(tenantId);
  }

  protected async fetchUncached(tenantId: string): Promise<TenantWorkspaceSettings> {
    this.fetchCount++;
    const existing = this.store.get(tenantId);
    if (!existing) throw new TenantSettingsNotFoundError(tenantId);
    return existing;
  }
}

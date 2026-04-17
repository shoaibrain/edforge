/**
 * HTTP-backed resolver — used by NestJS ECS services that already have an
 * authenticated HTTP client (finance, future academics) and don't have
 * IAM grants to read the identity DDB table directly.
 *
 * Caller provides the actual fetch function (typed as `HttpFetcher`); the
 * resolver doesn't depend on a specific HTTP library so it works with
 * Nest's HttpService, axios, undici, fetch, etc.
 *
 * Endpoint contract:
 *   GET /tenants/{tenantId}/workspace-settings
 *   200 → JSON body shaped as TenantWorkspaceSettings (minus tenantId)
 *   404 → throw TenantSettingsNotFoundError
 *   any other failure → throw TenantSettingsBackendError
 */

import {
  BaseTenantSettingsResolver,
  type BaseResolverOptions,
} from './resolver';
import {
  TenantSettingsBackendError,
  TenantSettingsNotFoundError,
  type TenantWorkspaceSettings,
} from './types';

/**
 * Caller-supplied HTTP function.
 *
 * MUST throw on non-2xx responses; resolver inspects the thrown value
 * for a `status` (number) property to detect 404 specifically.
 */
export type HttpFetcher = (url: string) => Promise<unknown>;

export interface HttpResolverOptions extends BaseResolverOptions {
  /** Identity service base URL, no trailing slash (e.g., 'http://identity-api.basic.sc:3010'). */
  identityBaseUrl: string;
  /** Caller-supplied fetcher. */
  fetcher: HttpFetcher;
}

export class HttpTenantSettingsResolver extends BaseTenantSettingsResolver {
  private readonly baseUrl: string;
  private readonly fetcher: HttpFetcher;

  constructor(opts: HttpResolverOptions) {
    super(opts);
    if (!opts.identityBaseUrl) {
      throw new Error('HttpTenantSettingsResolver: identityBaseUrl is required');
    }
    if (!opts.fetcher) {
      throw new Error('HttpTenantSettingsResolver: fetcher is required');
    }
    this.baseUrl = opts.identityBaseUrl.replace(/\/+$/, '');
    this.fetcher = opts.fetcher;
  }

  protected async fetchUncached(tenantId: string): Promise<TenantWorkspaceSettings> {
    const url = `${this.baseUrl}/tenants/${encodeURIComponent(tenantId)}/workspace-settings`;
    let body;
    try {
      body = await this.fetcher(url);
    } catch (err) {
      if (isHttpStatus(err, 404)) {
        throw new TenantSettingsNotFoundError(tenantId);
      }
      throw new TenantSettingsBackendError(
        `HTTP fetch failed for tenant=${tenantId}: ${(err as Error).message}`,
        err,
      );
    }
    if (!body || typeof body !== 'object') {
      throw new TenantSettingsBackendError(
        `tenant=${tenantId}: workspace-settings response was not an object`,
      );
    }
    const settings = body as Partial<TenantWorkspaceSettings>;
    if (!settings.regional || !settings.branding || !settings.policies) {
      throw new TenantSettingsBackendError(
        `tenant=${tenantId}: workspace-settings response is missing required sections`,
      );
    }
    return {
      tenantId,
      regional: settings.regional,
      branding: settings.branding,
      policies: settings.policies,
      isLocked: settings.isLocked ?? false,
      lockReason: settings.lockReason,
      workspaceConfirmedAt: settings.workspaceConfirmedAt,
      onboardingCompletedAt: settings.onboardingCompletedAt,
    };
  }
}

function isHttpStatus(err: unknown, status: number): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as Record<string, unknown>;
  if (candidate.status === status) return true;
  if (
    candidate.response &&
    typeof candidate.response === 'object' &&
    (candidate.response as Record<string, unknown>).status === status
  ) {
    return true;
  }
  return false;
}

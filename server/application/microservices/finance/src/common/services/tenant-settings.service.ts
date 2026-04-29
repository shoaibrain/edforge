/**
 * Tenant Settings Client Service for Finance
 *
 * Resolves a tenant's WorkspaceSettings (regional currency, locale, calendar)
 * via the identity service's `GET /tenants/my/settings` endpoint, which is
 * intentionally accessible to any authenticated user for MFE consumption.
 *
 * Replaces the literal `'NPR'` defaults that Sprint 2 ticket S2-T1 closes —
 * non-Nepal tenants have always carried the wrong currency on invoices and
 * payments because the entity factories defaulted to NPR. This service is
 * the canonical injection point so every invoice/payment write site can
 * resolve the right currency from a single source of truth.
 *
 * Caching: 5 min in-memory TTL keyed on tenantId. Identical pattern to
 * IdentityClientService — see that service for the established convention
 * for HTTP error handling in this microservice.
 *
 * NOTE: this service requires a `RequestContext` with a valid `jwtToken`.
 * The webhook path (enrollment auto-issue) currently uses a service-to-
 * service flow without a user JWT and must call into a different code path
 * — that is out of scope for S2-T1 and tracked separately.
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpClientService } from '@app/http-client';
import { RequestContext } from '../entities/base.entity';

interface RegionalSettings {
  defaultTimezone: string;
  defaultLocale: string;
  defaultCurrency: string;
  defaultCalendarSystem: 'gregorian' | 'bikram_sambat';
  defaultDateFormat?: string;
  defaultTimeFormat?: string;
  defaultWeekStartsOn?: string;
  enableDualDateDisplay?: boolean;
  defaultNumberFormat?: string;
}

interface WorkspaceSettings {
  tenantId?: string;
  regional: RegionalSettings;
  // branding + policies omitted — finance only needs `regional` today.
  // Add fields here when a future caller in finance needs them.
  [key: string]: unknown;
}

interface CacheEntry {
  data: WorkspaceSettings;
  cachedAt: number;
}

@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);
  private readonly identityServiceUrl: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 5 * 60 * 1000;

  constructor(private readonly httpClient: HttpClientService) {
    this.identityServiceUrl =
      process.env.IDENTITY_SERVICE_URL || 'http://identity-api.default.sc:3010';
  }

  async getSettings(context: RequestContext): Promise<WorkspaceSettings> {
    const cached = this.cache.get(context.tenantId);
    if (cached && Date.now() - cached.cachedAt < this.TTL_MS) {
      return cached.data;
    }

    try {
      const response = await this.httpClient.get<WorkspaceSettings>(
        `${this.identityServiceUrl}/tenants/my/settings`,
        {},
        {
          tenantId: context.tenantId,
          userId: context.userId,
          jwtToken: context.jwtToken,
          userRole: context.role,
        },
      );
      const data = response.data;
      if (!data || typeof data !== 'object' || !data.regional) {
        throw new Error('workspace-settings response missing `regional` section');
      }
      this.cache.set(context.tenantId, { data, cachedAt: Date.now() });
      return data;
    } catch (err: any) {
      this.logger.error(
        `Failed to resolve tenant settings for tenant=${context.tenantId}: ${err?.message ?? err}`,
      );
      throw new ServiceUnavailableException(
        'Unable to resolve tenant currency. The identity service is temporarily unavailable.',
      );
    }
  }

  async getCurrency(context: RequestContext): Promise<string> {
    const settings = await this.getSettings(context);
    return settings.regional.defaultCurrency;
  }

  /** Test-only — clear the cache. */
  invalidate(tenantId?: string): void {
    if (tenantId) {
      this.cache.delete(tenantId);
    } else {
      this.cache.clear();
    }
  }
}

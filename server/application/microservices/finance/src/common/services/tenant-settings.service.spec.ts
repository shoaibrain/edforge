/**
 * tenant-settings.service spec — Sprint C2.T1.
 *
 * Locks the finance-side resolver shim that closes BUG-F2 (hardcoded 'NPR'):
 *   - Calls identity GET /tenants/my/settings with the caller's JWT context.
 *   - Caches by tenantId for 5 minutes — bulk-generate paths pay one HTTP
 *     hop per tenant per 5 min, not N.
 *   - Throws ServiceUnavailableException on backend failure (fail loud, no
 *     silent fallback to a wrong currency).
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { TenantSettingsService } from './tenant-settings.service';
import { RequestContext } from '../entities/base.entity';

const ctxA: RequestContext = {
  tenantId: 'tenant-a',
  userId: 'user-1',
  email: 'a@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-a',
};

const ctxB: RequestContext = {
  ...ctxA,
  tenantId: 'tenant-b',
  jwtToken: 'jwt-b',
};

const settingsNpr = {
  tenantId: 'tenant-a',
  regional: {
    defaultCurrency: 'NPR',
    defaultTimezone: 'Asia/Kathmandu',
    defaultLocale: 'ne-NP',
    defaultCalendarSystem: 'bikram_sambat' as const,
  },
  branding: {},
  policies: {},
};

const settingsInr = {
  tenantId: 'tenant-b',
  regional: {
    defaultCurrency: 'INR',
    defaultTimezone: 'Asia/Kolkata',
    defaultLocale: 'en-IN',
    defaultCalendarSystem: 'gregorian' as const,
  },
  branding: {},
  policies: {},
};

describe('TenantSettingsService', () => {
  let httpClient: { get: jest.Mock };
  let service: TenantSettingsService;

  beforeEach(() => {
    httpClient = { get: jest.fn() };
    service = new TenantSettingsService(httpClient as any);
  });

  describe('getCurrency', () => {
    it('returns the regional defaultCurrency from the identity service', async () => {
      httpClient.get.mockResolvedValueOnce({ data: settingsNpr });
      await expect(service.getCurrency(ctxA)).resolves.toBe('NPR');
    });

    it('forwards JWT + tenant + user context to the HTTP client', async () => {
      httpClient.get.mockResolvedValueOnce({ data: settingsNpr });
      await service.getCurrency(ctxA);
      expect(httpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('/tenants/my/settings'),
        {},
        expect.objectContaining({
          tenantId: 'tenant-a',
          userId: 'user-1',
          jwtToken: 'jwt-a',
          userRole: 'TenantAdmin',
        }),
      );
    });

    it('returns a non-NPR currency when the tenant is not Nepal', async () => {
      httpClient.get.mockResolvedValueOnce({ data: settingsInr });
      await expect(service.getCurrency(ctxB)).resolves.toBe('INR');
    });
  });

  describe('caching', () => {
    it('hits the HTTP client only once for repeated calls within the TTL', async () => {
      httpClient.get.mockResolvedValueOnce({ data: settingsNpr });
      await service.getCurrency(ctxA);
      await service.getCurrency(ctxA);
      await service.getCurrency(ctxA);
      expect(httpClient.get).toHaveBeenCalledTimes(1);
    });

    it('caches per tenant — different tenants do not share entries', async () => {
      httpClient.get
        .mockResolvedValueOnce({ data: settingsNpr })
        .mockResolvedValueOnce({ data: settingsInr });
      await expect(service.getCurrency(ctxA)).resolves.toBe('NPR');
      await expect(service.getCurrency(ctxB)).resolves.toBe('INR');
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });

    it('invalidate(tenantId) re-fetches on the next call', async () => {
      httpClient.get
        .mockResolvedValueOnce({ data: settingsNpr })
        .mockResolvedValueOnce({ data: { ...settingsNpr, regional: { ...settingsNpr.regional, defaultCurrency: 'USD' } } });
      await expect(service.getCurrency(ctxA)).resolves.toBe('NPR');
      service.invalidate('tenant-a');
      await expect(service.getCurrency(ctxA)).resolves.toBe('USD');
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('throws ServiceUnavailableException when the backend fails (no silent fallback)', async () => {
      httpClient.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.getCurrency(ctxA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException on a malformed response (missing regional section)', async () => {
      httpClient.get.mockResolvedValueOnce({ data: { branding: {}, policies: {} } });
      await expect(service.getCurrency(ctxA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does NOT cache failures — a subsequent successful call resolves correctly', async () => {
      httpClient.get
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ data: settingsNpr });
      await expect(service.getCurrency(ctxA)).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.getCurrency(ctxA)).resolves.toBe('NPR');
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });
  });
});

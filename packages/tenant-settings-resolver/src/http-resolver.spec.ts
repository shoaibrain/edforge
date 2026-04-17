import { HttpTenantSettingsResolver } from './http-resolver';
import {
  TenantSettingsBackendError,
  TenantSettingsNotFoundError,
} from './types';

const VALID_BODY = {
  regional: {
    defaultTimezone: 'Asia/Kathmandu',
    defaultLocale: 'ne-NP',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '24h',
    defaultWeekStartsOn: 'sunday',
    defaultCurrency: 'NPR',
    defaultCalendarSystem: 'bikram_sambat',
    enableDualDateDisplay: true,
    defaultNumberFormat: 'south_asian',
  },
  branding: { organizationName: 'Test School' },
  policies: { defaultAttendancePolicy: 'daily' },
  isLocked: false,
};

describe('HttpTenantSettingsResolver', () => {
  it('rejects construction without identityBaseUrl or fetcher', () => {
    expect(
      () => new HttpTenantSettingsResolver({ identityBaseUrl: '', fetcher: async () => null }),
    ).toThrow('identityBaseUrl is required');
    expect(
      () =>
        new HttpTenantSettingsResolver({
          identityBaseUrl: 'http://x',
          fetcher: undefined as never,
        }),
    ).toThrow('fetcher is required');
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetcher = jest.fn().mockResolvedValue(VALID_BODY);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://identity-api.basic.sc:3010///',
      fetcher,
    });
    await r.get('tenant-A');
    expect(fetcher).toHaveBeenCalledWith(
      'http://identity-api.basic.sc:3010/tenants/tenant-A/workspace-settings',
    );
  });

  it('URL-encodes the tenantId path segment', async () => {
    const fetcher = jest.fn().mockResolvedValue(VALID_BODY);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await r.get('weird tenant/id');
    expect(fetcher).toHaveBeenCalledWith(
      'http://x/tenants/weird%20tenant%2Fid/workspace-settings',
    );
  });

  it('returns parsed settings on 200', async () => {
    const fetcher = jest.fn().mockResolvedValue(VALID_BODY);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    const result = await r.get('tenant-A');
    expect(result.tenantId).toBe('tenant-A');
    expect(result.regional.defaultCurrency).toBe('NPR');
  });

  it('throws TenantSettingsNotFoundError on 404 (status field)', async () => {
    const err: Error & { status?: number } = new Error('not found');
    err.status = 404;
    const fetcher = jest.fn().mockRejectedValue(err);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsNotFoundError);
  });

  it('throws TenantSettingsNotFoundError on 404 (response.status field, axios-style)', async () => {
    const err = Object.assign(new Error('not found'), { response: { status: 404 } });
    const fetcher = jest.fn().mockRejectedValue(err);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsNotFoundError);
  });

  it('wraps non-404 fetcher errors in TenantSettingsBackendError', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('connection refused'));
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsBackendError);
    await expect(r.get('tenant-A')).rejects.toThrow(/connection refused/);
  });

  it('throws TenantSettingsBackendError on malformed response', async () => {
    const fetcher = jest.fn().mockResolvedValue({ regional: {} });
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsBackendError);
  });

  it('caches across calls — fetcher only invoked once per tenant', async () => {
    const fetcher = jest.fn().mockResolvedValue(VALID_BODY);
    const r = new HttpTenantSettingsResolver({
      identityBaseUrl: 'http://x',
      fetcher,
    });
    await r.get('tenant-A');
    await r.get('tenant-A');
    await r.get('tenant-A');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

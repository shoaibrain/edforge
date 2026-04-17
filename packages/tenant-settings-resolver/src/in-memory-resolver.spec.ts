import { InMemoryTenantSettingsResolver } from './in-memory-resolver';
import { TenantSettingsNotFoundError } from './types';
import type { TenantWorkspaceSettings } from './types';

const NEPAL_SETTINGS: TenantWorkspaceSettings = {
  tenantId: 'tenant-A',
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

const US_SETTINGS: TenantWorkspaceSettings = {
  tenantId: 'tenant-B',
  regional: {
    defaultTimezone: 'America/New_York',
    defaultLocale: 'en-US',
    defaultDateFormat: 'MM/DD/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'sunday',
    defaultCurrency: 'USD',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'international',
  },
  branding: { organizationName: 'US School' },
  policies: { defaultAttendancePolicy: 'period' },
  isLocked: false,
};

describe('InMemoryTenantSettingsResolver', () => {
  it('throws TenantSettingsBackendError on empty tenantId', async () => {
    const r = new InMemoryTenantSettingsResolver();
    await expect(r.get('')).rejects.toThrow('tenantId is required');
  });

  it('throws TenantSettingsNotFoundError when tenant is missing', async () => {
    const r = new InMemoryTenantSettingsResolver();
    await expect(r.get('does-not-exist')).rejects.toBeInstanceOf(TenantSettingsNotFoundError);
  });

  it('returns seeded settings on first call (cache miss)', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    const result = await r.get('tenant-A');
    expect(result.regional.defaultTimezone).toBe('Asia/Kathmandu');
    expect(r.fetchCount).toBe(1);
  });

  it('caches subsequent calls — only one backend fetch per tenant', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    await r.get('tenant-A');
    await r.get('tenant-A');
    await r.get('tenant-A');
    expect(r.fetchCount).toBe(1);
  });

  it('isolates per-tenant — different tenants miss independently', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS, US_SETTINGS] });
    await r.get('tenant-A');
    await r.get('tenant-B');
    await r.get('tenant-A');
    await r.get('tenant-B');
    expect(r.fetchCount).toBe(2);
  });

  it('invalidate(tenant) drops the cached entry', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    await r.get('tenant-A');
    r.invalidate('tenant-A');
    await r.get('tenant-A');
    expect(r.fetchCount).toBe(2);
  });

  it('invalidateAll() drops all cached entries', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS, US_SETTINGS] });
    await r.get('tenant-A');
    await r.get('tenant-B');
    r.invalidateAll();
    await r.get('tenant-A');
    await r.get('tenant-B');
    expect(r.fetchCount).toBe(4);
  });

  it('coalesces concurrent get() calls (in-flight dedup)', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    // Fire three simultaneously before any has resolved.
    const [a, b, c] = await Promise.all([
      r.get('tenant-A'),
      r.get('tenant-A'),
      r.get('tenant-A'),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(r.fetchCount).toBe(1);
  });

  it('setSetting() updates the store and invalidates the cache', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    await r.get('tenant-A');
    const updated: TenantWorkspaceSettings = {
      ...NEPAL_SETTINGS,
      regional: { ...NEPAL_SETTINGS.regional, defaultTimezone: 'Asia/Tokyo' },
    };
    r.setSetting(updated);
    const result = await r.get('tenant-A');
    expect(result.regional.defaultTimezone).toBe('Asia/Tokyo');
    expect(r.fetchCount).toBe(2);
  });

  it('deleteSetting() removes the entry and invalidates the cache', async () => {
    const r = new InMemoryTenantSettingsResolver({ seed: [NEPAL_SETTINGS] });
    await r.get('tenant-A');
    r.deleteSetting('tenant-A');
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsNotFoundError);
  });
});

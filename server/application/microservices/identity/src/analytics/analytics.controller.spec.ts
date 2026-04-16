/**
 * Layer 7 — authz-boundary + controller validation tests.
 *
 * Focused on the cardinal rule: "Every read endpoint must have a negative
 * authz-boundary test proving user/tenant X cannot read user/tenant Y's data."
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import type { TenantContext } from '@app/auth';

function mkTenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: 'user-a',
    username: 'user-a@example.com',
    tenantId: 'tenant-A',
    tenantTier: 'BASIC',
    tenantName: 'Tenant A',
    email: 'user-a@example.com',
    globalRole: 'TenantAdmin',
    userPoolId: 'pool',
    appClientId: 'client',
    ...overrides,
  };
}

function mkController(overrides: {
  analytics?: Partial<Record<string, jest.Mock>>;
  dynamoDB?: Partial<Record<string, jest.Mock>>;
}) {
  const analyticsStub: any = {
    getTenantTimeSeries: jest.fn().mockResolvedValue([]),
    getAdoptionReport: jest.fn().mockResolvedValue({}),
    getFleetSummary: jest.fn().mockResolvedValue({
      active: 0, inactive: 0, dormant: 0, atRisk: 0, topFeatures: [],
    }),
    getSessionHistory: jest.fn().mockResolvedValue([]),
    streamExportCsv: jest.fn().mockImplementation(async function* () {
      yield 'date,metric,value,dimension,dimensionValue\n';
    }),
    ...overrides.analytics,
  };
  const dynamoDBStub: any = {
    getSystemClient: jest.fn().mockReturnValue({}),
    getItem: jest.fn().mockResolvedValue({
      createdAt: '2026-01-01T00:00:00Z',
    }),
    ...overrides.dynamoDB,
  };
  return new AnalyticsController(analyticsStub, dynamoDBStub);
}

beforeEach(() => {
  process.env.SYSTEM_ADMIN_EMAILS = 'sysadmin@example.com';
});
afterEach(() => {
  delete process.env.SYSTEM_ADMIN_EMAILS;
});

describe('AnalyticsController — authz boundaries (cardinal rule)', () => {
  it('7.1 TenantAdmin of tenant-B cannot read tenant-A analytics', async () => {
    const c = mkController({});
    const tenantB = mkTenant({ tenantId: 'tenant-B' });
    await expect(
      c.getTenantSeries(
        'tenant-A',
        '2026-04-01',
        '2026-04-14',
        'day',
        tenantB,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('7.1 own-tenant read succeeds', async () => {
    const c = mkController({});
    await expect(
      c.getTenantSeries(
        'tenant-A',
        '2026-04-01',
        '2026-04-14',
        'day',
        mkTenant(),
      ),
    ).resolves.toEqual([]);
  });

  it('7.1 SystemAdmin can read any tenant', async () => {
    const c = mkController({});
    const sysAdmin = mkTenant({
      email: 'sysadmin@example.com',
      tenantId: 'tenant-B',
    });
    await expect(
      c.getTenantSeries('tenant-A', '2026-04-01', '2026-04-14', 'day', sysAdmin),
    ).resolves.toEqual([]);
  });

  it('7.3 TenantAdmin cannot call /analytics/fleet', async () => {
    const c = mkController({});
    await expect(
      c.getFleet('2026-04-01', '2026-04-14', mkTenant()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('7.3 SystemAdmin can call /analytics/fleet', async () => {
    const c = mkController({});
    const sysAdmin = mkTenant({ email: 'sysadmin@example.com' });
    await expect(
      c.getFleet('2026-04-01', '2026-04-14', sysAdmin),
    ).resolves.toEqual({
      active: 0, inactive: 0, dormant: 0, atRisk: 0, topFeatures: [],
    });
  });

  it('7.4 /me/session-history always scopes to JWT sub (never path)', async () => {
    const getSessionHistory = jest.fn().mockResolvedValue([]);
    const c = mkController({ analytics: { getSessionHistory } });
    await c.getMySessionHistory('30', mkTenant({ userId: 'user-a' }));
    expect(getSessionHistory).toHaveBeenCalledWith('user-a', 30);
  });

  it('7.4 /me/session-history uses tenant.userId regardless of any path param', async () => {
    // Even if someone tried to hack a /me/:userId pattern, our controller
    // only consumes tenant.userId — so user-A's JWT cannot retrieve user-B.
    const getSessionHistory = jest.fn().mockResolvedValue([]);
    const c = mkController({ analytics: { getSessionHistory } });
    await c.getMySessionHistory('30', mkTenant({ userId: 'user-a' }));
    const firstArg = getSessionHistory.mock.calls[0][0];
    expect(firstArg).toBe('user-a');
    expect(firstArg).not.toBe('user-b');
  });

  it('7.2 TenantAdmin of tenant-B cannot read tenant-A adoption-report', async () => {
    const c = mkController({});
    await expect(
      c.getAdoptionReport(
        'tenant-A',
        '2026-W16',
        mkTenant({ tenantId: 'tenant-B' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('7.5 CSV export cannot leak a foreign tenant', async () => {
    const c = mkController({});
    const res: any = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn() };
    const req: any = { headers: {} };
    await expect(
      c.exportCsv(
        'tenant-A',
        '2026-04-01',
        '2026-04-14',
        'day',
        mkTenant({ tenantId: 'tenant-B' }),
        req,
        res,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('AnalyticsController — query validation', () => {
  const c = mkController({});

  it('rejects missing/bad from/to', async () => {
    await expect(
      c.getTenantSeries('tenant-A', '', '2026-04-14', 'day', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      c.getTenantSeries('tenant-A', '2026/04/01', '2026-04-14', 'day', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects to < from', async () => {
    await expect(
      c.getTenantSeries('tenant-A', '2026-04-14', '2026-04-01', 'day', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects range > 365 days', async () => {
    await expect(
      c.getTenantSeries(
        'tenant-A',
        '2024-01-01',
        '2026-04-14',
        'day',
        mkTenant(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown granularity', async () => {
    await expect(
      c.getTenantSeries(
        'tenant-A',
        '2026-04-01',
        '2026-04-14',
        'hour',
        mkTenant(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects bad adoption-report week format', async () => {
    await expect(
      c.getAdoptionReport('tenant-A', '2026-04-14', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects /me/session-history days out of range', async () => {
    await expect(
      c.getMySessionHistory('500', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      c.getMySessionHistory('0', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      c.getMySessionHistory('abc', mkTenant()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults days to 30 when unspecified', async () => {
    const getSessionHistory = jest.fn().mockResolvedValue([]);
    const c2 = mkController({ analytics: { getSessionHistory } });
    await c2.getMySessionHistory('', mkTenant());
    expect(getSessionHistory).toHaveBeenCalledWith('user-a', 30);
  });
});

describe('AnalyticsController — adoption report', () => {
  it('404s when tenant METADATA row missing', async () => {
    const c = mkController({
      dynamoDB: { getItem: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      c.getAdoptionReport('tenant-A', '2026-W16', mkTenant()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes provisionedAt through to the service', async () => {
    const getAdoptionReport = jest.fn().mockResolvedValue({});
    const c = mkController({
      analytics: { getAdoptionReport },
      dynamoDB: {
        getItem: jest.fn().mockResolvedValue({ createdAt: '2026-03-25T00:00:00Z' }),
      },
    });
    await c.getAdoptionReport('tenant-A', '2026-W16', mkTenant());
    expect(getAdoptionReport).toHaveBeenCalledWith(
      'tenant-A',
      '2026-W16',
      '2026-03-25T00:00:00Z',
    );
  });
});

describe('AnalyticsController — CSV streaming', () => {
  it('sets CSV headers and writes all chunks', async () => {
    const c = mkController({
      analytics: {
        streamExportCsv: jest.fn().mockImplementation(async function* () {
          yield 'date,metric,value,dimension,dimensionValue\n';
          yield '2026-04-14,auth.login.success,7,,\n';
        }),
      },
    });
    const res: any = { setHeader: jest.fn(), write: jest.fn(), end: jest.fn() };
    const req: any = { headers: {} };
    await c.exportCsv(
      'tenant-A',
      '2026-04-01',
      '2026-04-14',
      'day',
      mkTenant(),
      req,
      res,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename='),
    );
    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.end).toHaveBeenCalled();
  });
});

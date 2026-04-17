import {
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { DdbTenantSettingsResolver } from './ddb-resolver';
import {
  TenantSettingsBackendError,
  TenantSettingsNotFoundError,
} from './types';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => sendMock(...args),
    })),
  };
});

const NEPAL_DDB_ITEM = {
  tenantId: { S: 'tenant-A' },
  entityKey: { S: 'SETTINGS#WORKSPACE' },
  regional: {
    M: {
      defaultTimezone: { S: 'Asia/Kathmandu' },
      defaultLocale: { S: 'ne-NP' },
      defaultDateFormat: { S: 'DD/MM/YYYY' },
      defaultTimeFormat: { S: '24h' },
      defaultWeekStartsOn: { S: 'sunday' },
      defaultCurrency: { S: 'NPR' },
      defaultCalendarSystem: { S: 'bikram_sambat' },
      enableDualDateDisplay: { BOOL: true },
      defaultNumberFormat: { S: 'south_asian' },
    },
  },
  branding: {
    M: {
      organizationName: { S: 'Test School' },
    },
  },
  policies: {
    M: {
      defaultAttendancePolicy: { S: 'daily' },
    },
  },
  isLocked: { BOOL: false },
  workspaceConfirmedAt: { S: '2026-04-01T00:00:00Z' },
};

beforeEach(() => {
  sendMock.mockReset();
});

describe('DdbTenantSettingsResolver', () => {
  it('rejects construction without tableName', () => {
    expect(() => new DdbTenantSettingsResolver({ tableName: '' })).toThrow(
      'tableName is required',
    );
  });

  it('issues a GetItemCommand with the right key shape', async () => {
    sendMock.mockResolvedValueOnce({ Item: NEPAL_DDB_ITEM });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    await r.get('tenant-A');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0] as GetItemCommand;
    expect(cmd.constructor.name).toBe('GetItemCommand');
    expect(cmd.input).toEqual({
      TableName: 'edforge-identity-basic',
      Key: {
        tenantId: { S: 'tenant-A' },
        entityKey: { S: 'SETTINGS#WORKSPACE' },
      },
      ConsistentRead: false,
    });
  });

  it('unmarshalls a Nepal DDB item correctly', async () => {
    sendMock.mockResolvedValueOnce({ Item: NEPAL_DDB_ITEM });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    const result = await r.get('tenant-A');
    expect(result.tenantId).toBe('tenant-A');
    expect(result.regional.defaultTimezone).toBe('Asia/Kathmandu');
    expect(result.regional.defaultCurrency).toBe('NPR');
    expect(result.regional.enableDualDateDisplay).toBe(true);
    expect(result.branding.organizationName).toBe('Test School');
    expect(result.policies.defaultAttendancePolicy).toBe('daily');
    expect(result.isLocked).toBe(false);
    expect(result.workspaceConfirmedAt).toBe('2026-04-01T00:00:00Z');
  });

  it('throws TenantSettingsNotFoundError when DDB returns no Item', async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    await expect(r.get('missing')).rejects.toBeInstanceOf(TenantSettingsNotFoundError);
  });

  it('throws TenantSettingsBackendError when the row is malformed', async () => {
    sendMock.mockResolvedValueOnce({
      Item: { tenantId: { S: 'tenant-A' }, entityKey: { S: 'SETTINGS#WORKSPACE' } },
    });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    await expect(r.get('tenant-A')).rejects.toBeInstanceOf(TenantSettingsBackendError);
  });

  it('wraps DDB errors in TenantSettingsBackendError', async () => {
    sendMock.mockRejectedValue(new Error('throughput exceeded'));
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    const err = await r.get('tenant-A').catch((e) => e);
    expect(err).toBeInstanceOf(TenantSettingsBackendError);
    expect(err.message).toMatch(/throughput exceeded/);
  });

  it('caches across calls — DDB only hit once', async () => {
    sendMock.mockResolvedValue({ Item: NEPAL_DDB_ITEM });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    await r.get('tenant-A');
    await r.get('tenant-A');
    await r.get('tenant-A');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate(tenant) forces next get to re-fetch', async () => {
    sendMock.mockResolvedValue({ Item: NEPAL_DDB_ITEM });
    const r = new DdbTenantSettingsResolver({ tableName: 'edforge-identity-basic' });
    await r.get('tenant-A');
    r.invalidate('tenant-A');
    await r.get('tenant-A');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

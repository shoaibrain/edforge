/**
 * TenantsService Unit Tests — Workspace Settings Lazy-Creation with Country
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('TenantsService', () => {
  let service: TenantsService;

  const mockContext: RequestContext = {
    userId: 'admin-user-id',
    tenantId: 'tenant-123',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockDynamoDBClientService = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getSystemClient: jest.fn().mockReturnValue({ send: jest.fn() }),
    getItem: jest.fn(),
    putItem: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    query: jest.fn(),
    queryGSI: jest.fn(),
    batchWrite: jest.fn(),
    transactWrite: jest.fn(),
    getTableName: jest.fn().mockReturnValue('test-table'),
  };

  // A-WS2.T1: TenantsService now emits WorkspaceSettingsUpdated on PATCH.
  // Mock the publisher; assertions on emit behavior live in dedicated tests.
  const mockIdentityEventsService = {
    publishWorkspaceSettingsUpdated: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DynamoDBClientService,
          useValue: mockDynamoDBClientService,
        },
        {
          provide: IdentityEventsService,
          useValue: mockIdentityEventsService,
        },
        {
          provide: TenantsService,
          useFactory: (db: DynamoDBClientService, ev: IdentityEventsService) =>
            new TenantsService(db, ev),
          inject: [DynamoDBClientService, IdentityEventsService],
        },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getWorkspaceSettings — lazy-creation with country', () => {
    it('should create Nepal defaults when tenant has country NPL', async () => {
      // First call: no existing workspace settings
      // Second call: tenant metadata with country
      mockDynamoDBClientService.getItem
        .mockResolvedValueOnce(null) // SETTINGS#WORKSPACE not found
        .mockResolvedValueOnce({     // METADATA found
          tenantId: 'tenant-123',
          entityKey: 'METADATA',
          entityType: 'TENANT',
          name: 'Nepal School',
          country: 'NPL',
        });
      mockDynamoDBClientService.putItem.mockResolvedValue(undefined);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      expect(result.regional.defaultCurrency).toBe('NPR');
      expect(result.regional.defaultTimezone).toBe('Asia/Kathmandu');
      expect(result.regional.defaultCalendarSystem).toBe('bikram_sambat');
      expect(result.regional.enableDualDateDisplay).toBe(true);
      expect(result.regional.defaultNumberFormat).toBe('south_asian');
      expect(result.regional.defaultLocale).toBe('ne-NP');
      expect(result.regional.defaultTimeFormat).toBe('24h');
      expect(result.branding.organizationName).toBe('Nepal School');

      // Verify putItem was called to persist the lazy-created settings
      expect(mockDynamoDBClientService.putItem).toHaveBeenCalledTimes(1);
    });

    it('should create US defaults when tenant has no country', async () => {
      mockDynamoDBClientService.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          tenantId: 'tenant-123',
          entityKey: 'METADATA',
          entityType: 'TENANT',
          name: 'US School',
        });
      mockDynamoDBClientService.putItem.mockResolvedValue(undefined);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      expect(result.regional.defaultCurrency).toBe('USD');
      expect(result.regional.defaultTimezone).toBe('America/New_York');
      expect(result.regional.defaultCalendarSystem).toBe('gregorian');
      expect(result.regional.enableDualDateDisplay).toBe(false);
      expect(result.regional.defaultNumberFormat).toBe('international');
    });

    it('should fall back to address.country when top-level country is absent', async () => {
      mockDynamoDBClientService.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          tenantId: 'tenant-123',
          entityKey: 'METADATA',
          entityType: 'TENANT',
          name: 'Nepal School via Address',
          address: { country: 'NPL', city: 'Kathmandu', state: 'Bagmati', zipCode: '44600', street1: 'Main St' },
        });
      mockDynamoDBClientService.putItem.mockResolvedValue(undefined);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      expect(result.regional.defaultCurrency).toBe('NPR');
      expect(result.regional.defaultCalendarSystem).toBe('bikram_sambat');
      expect(result.regional.defaultTimezone).toBe('Asia/Kathmandu');
    });

    it('should create India defaults when tenant has country IND', async () => {
      mockDynamoDBClientService.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          tenantId: 'tenant-123',
          entityKey: 'METADATA',
          entityType: 'TENANT',
          name: 'India School',
          country: 'IND',
        });
      mockDynamoDBClientService.putItem.mockResolvedValue(undefined);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      expect(result.regional.defaultCurrency).toBe('INR');
      expect(result.regional.defaultTimezone).toBe('Asia/Kolkata');
      expect(result.regional.defaultCalendarSystem).toBe('gregorian');
      expect(result.regional.defaultNumberFormat).toBe('south_asian');
      expect(result.regional.defaultLocale).toBe('en-IN');
      expect(result.regional.defaultWeekStartsOn).toBe('monday');
    });

    it('should parse JSON string regional/branding/policies from Lambda-provisioned data', async () => {
      const lambdaProvisionedSettings = {
        tenantId: 'tenant-123',
        entityKey: 'SETTINGS#WORKSPACE',
        entityType: 'WORKSPACE_SETTINGS',
        regional: JSON.stringify({
          defaultCurrency: 'NPR',
          defaultTimezone: 'Asia/Kathmandu',
          defaultCalendarSystem: 'bikram_sambat',
          enableDualDateDisplay: true,
          defaultNumberFormat: 'south_asian',
          defaultLocale: 'ne-NP',
          defaultDateFormat: 'DD/MM/YYYY',
          defaultTimeFormat: '24h',
          defaultWeekStartsOn: 'sunday',
        }),
        branding: JSON.stringify({ organizationName: 'Nepal School' }),
        policies: JSON.stringify({ defaultAttendancePolicy: 'daily' }),
        isLocked: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockDynamoDBClientService.getItem.mockResolvedValueOnce(lambdaProvisionedSettings);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      // regional should be a parsed object, not a string
      expect(result.regional.defaultCurrency).toBe('NPR');
      expect(result.regional.defaultCalendarSystem).toBe('bikram_sambat');
      expect(result.branding.organizationName).toBe('Nepal School');
      expect(result.policies.defaultAttendancePolicy).toBe('daily');
    });

    it('should return existing settings without re-creation', async () => {
      const existingSettings = {
        tenantId: 'tenant-123',
        entityKey: 'SETTINGS#WORKSPACE',
        entityType: 'WORKSPACE_SETTINGS',
        regional: {
          defaultCurrency: 'NPR',
          defaultTimezone: 'Asia/Kathmandu',
          defaultCalendarSystem: 'bikram_sambat',
          enableDualDateDisplay: true,
          defaultNumberFormat: 'south_asian',
          defaultLocale: 'ne-NP',
          defaultDateFormat: 'DD/MM/YYYY',
          defaultTimeFormat: '24h',
          defaultWeekStartsOn: 'sunday',
        },
        branding: { organizationName: 'Nepal School' },
        policies: { defaultAttendancePolicy: 'daily' },
        isLocked: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      mockDynamoDBClientService.getItem.mockResolvedValueOnce(existingSettings);

      const result = await service.getWorkspaceSettings('tenant-123', mockContext);

      expect(result.regional.defaultCurrency).toBe('NPR');
      // putItem should NOT be called — settings already exist
      expect(mockDynamoDBClientService.putItem).not.toHaveBeenCalled();
      // getItem should only be called once (for settings, not for tenant metadata)
      expect(mockDynamoDBClientService.getItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('completeOnboarding', () => {
    it('should set onboardingCompletedAt and return timestamp', async () => {
      mockDynamoDBClientService.updateItem.mockResolvedValueOnce({});

      const result = await service.completeOnboarding('tenant-123', mockContext);

      expect(result.completed).toBe(true);
      expect(result.onboardingCompletedAt).toBeDefined();
      expect(mockDynamoDBClientService.updateItem).toHaveBeenCalledTimes(1);

      // Verify the update expression includes both fields
      const updateCall = mockDynamoDBClientService.updateItem.mock.calls[0];
      const updateExpression = updateCall[3] as string;
      expect(updateExpression).toContain('onboardingCompletedAt');
      expect(updateExpression).toContain('workspaceConfirmedAt');
    });

    it('should be idempotent — calling twice does not error', async () => {
      mockDynamoDBClientService.updateItem.mockResolvedValue({});

      const result1 = await service.completeOnboarding('tenant-123', mockContext);
      const result2 = await service.completeOnboarding('tenant-123', mockContext);

      expect(result1.completed).toBe(true);
      expect(result2.completed).toBe(true);
      expect(mockDynamoDBClientService.updateItem).toHaveBeenCalledTimes(2);
    });
  });

  describe('A-WS2.T1 — updateWorkspaceSettings emits WorkspaceSettingsUpdated', () => {
    /**
     * Helpers to seed an existing-settings response so updateWorkspaceSettings
     * passes the lock check and reaches the DDB update + emit.
     */
    const existingSettings = {
      tenantId: 'tenant-123',
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

    it('emits WorkspaceSettingsUpdated with the changed sections', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValueOnce(existingSettings);
      mockDynamoDBClientService.updateItem.mockResolvedValueOnce({
        ...existingSettings,
        regional: { ...existingSettings.regional, defaultTimezone: 'America/New_York' },
      });

      await service.updateWorkspaceSettings(
        'tenant-123',
        { regional: { defaultTimezone: 'America/New_York' } },
        mockContext,
      );

      expect(mockIdentityEventsService.publishWorkspaceSettingsUpdated).toHaveBeenCalledTimes(1);
      expect(mockIdentityEventsService.publishWorkspaceSettingsUpdated).toHaveBeenCalledWith(
        'tenant-123',
        ['regional'],
      );
    });

    it('reports multiple changed sections when several are updated together', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValueOnce(existingSettings);
      mockDynamoDBClientService.updateItem.mockResolvedValueOnce(existingSettings);

      await service.updateWorkspaceSettings(
        'tenant-123',
        {
          regional: { defaultTimezone: 'America/New_York' },
          branding: { organizationName: 'Renamed School' },
        },
        mockContext,
      );

      expect(mockIdentityEventsService.publishWorkspaceSettingsUpdated).toHaveBeenCalledWith(
        'tenant-123',
        ['regional', 'branding'],
      );
    });

    it('does NOT emit when the update is a no-op (empty body)', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValueOnce(existingSettings);

      await service.updateWorkspaceSettings('tenant-123', {}, mockContext);

      // updateItem should not be called either — service short-circuits.
      expect(mockDynamoDBClientService.updateItem).not.toHaveBeenCalled();
      expect(mockIdentityEventsService.publishWorkspaceSettingsUpdated).not.toHaveBeenCalled();
    });

    it('PATCH succeeds even when the EventBridge emit fails (non-blocking)', async () => {
      mockDynamoDBClientService.getItem.mockResolvedValueOnce(existingSettings);
      mockDynamoDBClientService.updateItem.mockResolvedValueOnce(existingSettings);
      // Simulate a publisher failure (e.g., bus throttled).
      mockIdentityEventsService.publishWorkspaceSettingsUpdated.mockRejectedValueOnce(
        new Error('eventbridge throttled'),
      );

      // Should NOT throw — emit is fire-and-forget (void).
      await expect(
        service.updateWorkspaceSettings(
          'tenant-123',
          { regional: { defaultTimezone: 'America/New_York' } },
          mockContext,
        ),
      ).resolves.toBeDefined();
    });
  });
});

/**
 * TenantsService Unit Tests — Workspace Settings Lazy-Creation with Country
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DynamoDBClientService,
          useValue: mockDynamoDBClientService,
        },
        {
          provide: TenantsService,
          useFactory: (db: DynamoDBClientService) => new TenantsService(db),
          inject: [DynamoDBClientService],
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
});

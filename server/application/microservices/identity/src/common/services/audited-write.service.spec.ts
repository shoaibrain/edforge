/**
 * AuditedWriteService unit tests — Sprint S0.8
 *
 * Covers:
 *   - happy path: emit writes an AUDIT_LOG row with the expected shape
 *   - error path: DDB failure is logged but does NOT throw to the caller
 *   - empty changes[] is allowed (status-only transitions)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AuditedWriteService } from './audited-write.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import { RequestContext, GlobalRole } from '../entities/base.entity';

describe('AuditedWriteService', () => {
  let service: AuditedWriteService;
  let mockDynamoDBClient: any;

  const mockContext: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
    username: 'admin.user',
  };

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      putItem: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        {
          provide: AuditedWriteService,
          useFactory: (db: DynamoDBClientService) => new AuditedWriteService(db),
          inject: [DynamoDBClientService],
        },
      ],
    }).compile();

    service = module.get<AuditedWriteService>(AuditedWriteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('writes an AUDIT_LOG row with the expected shape', async () => {
    await service.emit(mockContext, {
      schoolId: 'school-1',
      targetEntity: 'SCHOOL',
      targetEntityId: 'school-1',
      action: 'status_change',
      changes: [{ field: 'status', oldValue: 'setup', newValue: 'active' }],
    });

    expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    const [, item] = mockDynamoDBClient.putItem.mock.calls[0];
    expect(item.entityType).toBe('AUDIT_LOG');
    expect(item.tenantId).toBe('tenant-1');
    expect(item.schoolId).toBe('school-1');
    expect(item.targetEntity).toBe('SCHOOL');
    expect(item.targetEntityId).toBe('school-1');
    expect(item.action).toBe('status_change');
    expect(item.changedBy).toBe('admin-user');
    expect(item.changedByName).toBe('admin.user');
    expect(item.changes).toEqual([
      { field: 'status', oldValue: 'setup', newValue: 'active' },
    ]);
  });

  it('forwards optional reason + severity onto the row', async () => {
    await service.emit(mockContext, {
      schoolId: 'school-1',
      targetEntity: 'CONFIG',
      targetEntityId: 'school-1',
      action: 'update',
      changes: [{ field: 'gradingScale', oldValue: 'A', newValue: 'B' }],
      reason: 'Mid-year scale change per principal request',
      severity: 'high',
    });

    const [, item] = mockDynamoDBClient.putItem.mock.calls[0];
    expect(item.reason).toBe('Mid-year scale change per principal request');
    expect(item.severity).toBe('high');
  });

  it('accepts an empty changes[] array (status-only transitions)', async () => {
    await service.emit(mockContext, {
      schoolId: 'school-1',
      targetEntity: 'SCHOOL',
      targetEntityId: 'school-1',
      action: 'status_change',
      changes: [],
    });

    const [, item] = mockDynamoDBClient.putItem.mock.calls[0];
    expect(item.changes).toEqual([]);
  });

  it('logs but does NOT throw when the DDB write fails', async () => {
    mockDynamoDBClient.putItem.mockRejectedValueOnce(
      new Error('Simulated DDB throttle'),
    );
    const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(
      service.emit(mockContext, {
        schoolId: 'school-1',
        targetEntity: 'SCHOOL',
        targetEntityId: 'school-1',
        action: 'update',
        changes: [{ field: 'name', oldValue: 'old', newValue: 'new' }],
      }),
    ).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalled();
    const logMessage = loggerErrorSpy.mock.calls[0][0] as string;
    expect(logMessage).toContain('Failed to write audit log');
    expect(logMessage).toContain('tenantId=tenant-1');
    expect(logMessage).toContain('targetEntity=SCHOOL');
    expect(logMessage).toContain('Simulated DDB throttle');

    loggerErrorSpy.mockRestore();
  });

  it('logs but does NOT throw when getClient fails', async () => {
    mockDynamoDBClient.getClient.mockRejectedValueOnce(
      new Error('Auth provider unavailable'),
    );
    const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(
      service.emit(mockContext, {
        schoolId: 'school-1',
        targetEntity: 'SCHOOL',
        targetEntityId: 'school-1',
        action: 'create',
        changes: [],
      }),
    ).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalled();
    loggerErrorSpy.mockRestore();
  });

  it('builds the entityKey with the SCHOOL#<id>#AUDIT#<timestamp>#<uuid> shape', async () => {
    await service.emit(mockContext, {
      schoolId: 'school-1',
      targetEntity: 'ACADEMIC_YEAR',
      targetEntityId: 'year-1',
      action: 'status_change',
      changes: [{ field: 'status', oldValue: 'planning', newValue: 'active' }],
    });

    const [, item] = mockDynamoDBClient.putItem.mock.calls[0];
    expect(item.entityKey).toMatch(/^SCHOOL#school-1#AUDIT#.+#.+$/);
    // The entity-key construction is delegated to createAuditLogEntity,
    // so we don't repeat its internal regex here — we just confirm the
    // PK/SK pattern remains intact (regression: breaking the SK pattern
    // would re-introduce the orphan rows that plagued the lazy-create era).
  });
});

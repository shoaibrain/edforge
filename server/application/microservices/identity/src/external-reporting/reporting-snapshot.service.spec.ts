/**
 * ReportingSnapshotService Unit Tests — list + download (Sprint E.1 follow-up).
 *
 * Covers the two endpoints that make a generated CSV reachable end-to-end:
 *   - listSnapshots()        — school-scoped query + optional filters + newest-first
 *   - getSnapshotDownloadUrl() — presigned GET URL with status/dry-run guards
 *
 * DynamoDBClientService + S3PresignerService + AuditedWriteService +
 * IdentityEventsService are mocked so the credential/STS/S3 flow is isolated.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReportingSnapshotService } from './reporting-snapshot.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import {
  ReportingSnapshot,
  ReportingSnapshotStatus,
} from '../common/entities/reporting-snapshot.entity';

describe('ReportingSnapshotService — list + download', () => {
  let service: ReportingSnapshotService;
  let mockDynamoDBClient: any;
  let mockS3Presigner: any;

  const TENANT_ID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
  const SCHOOL_ID = '3c28654f-c623-449b-8211-67c729784d37';
  const USER_ID = 'admin-user-id';

  const ctx: RequestContext = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    email: 'admin@example.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  function snapshot(overrides: Partial<ReportingSnapshot> = {}): ReportingSnapshot {
    return {
      tenantId: TENANT_ID,
      entityKey: `SCHOOL#${SCHOOL_ID}#REPORTING_SNAPSHOT#${overrides.snapshotId ?? 'snap-1'}`,
      entityType: 'REPORTING_SNAPSHOT',
      snapshotId: overrides.snapshotId ?? 'snap-1',
      schoolId: SCHOOL_ID,
      templateId: 'IEMIS_NPL_CEHRD_FLASH_I',
      academicYearBs: '2083',
      status: 'generated' as ReportingSnapshotStatus,
      s3Key: `tenant=${TENANT_ID}/school=${SCHOOL_ID}/template=IEMIS_NPL_CEHRD_FLASH_I/year=2083/snap-1.csv`,
      rowCount: 42,
      schemaVersion: 'v1',
      createdAt: '2026-06-01T00:00:00.000Z',
      createdBy: USER_ID,
      updatedAt: '2026-06-01T00:00:00.000Z',
      updatedBy: USER_ID,
      version: 1,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      query: jest.fn(),
      getItem: jest.fn(),
    };
    mockS3Presigner = {
      presignReportDownload: jest
        .fn()
        .mockImplementation((_jwt: string, key: string) =>
          Promise.resolve(`https://s3-presigned/${key}?sig=mocked`),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportingSnapshotService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: S3PresignerService, useValue: mockS3Presigner },
        { provide: AuditedWriteService, useValue: { emit: jest.fn() } },
        { provide: IdentityEventsService, useValue: { publishValidatedEvent: jest.fn() } },
      ],
    }).compile();

    service = module.get(ReportingSnapshotService);
  });

  describe('listSnapshots', () => {
    it('queries the school REPORTING_SNAPSHOT partition prefix and maps to DTOs', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [snapshot()], hasMore: false });

      const res = await service.listSnapshots({ schoolId: SCHOOL_ID }, ctx);

      // client, tenantId, sk-prefix are the first three positional args.
      expect(mockDynamoDBClient.query.mock.calls[0].slice(0, 3)).toEqual([
        {},
        TENANT_ID,
        `SCHOOL#${SCHOOL_ID}#REPORTING_SNAPSHOT#`,
      ]);
      expect(res.count).toBe(1);
      expect(res.snapshots[0].snapshotId).toBe('snap-1');
      // P1d — response DTO must not leak internal entity keys.
      expect((res.snapshots[0] as any).entityKey).toBeUndefined();
    });

    it('returns newest-first by createdAt', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          snapshot({ snapshotId: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
          snapshot({ snapshotId: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
        ],
        hasMore: false,
      });

      const res = await service.listSnapshots({ schoolId: SCHOOL_ID }, ctx);

      expect(res.snapshots.map((s) => s.snapshotId)).toEqual(['new', 'old']);
    });

    it('paginates across DynamoDB pages (no truncation, correct count)', async () => {
      // Page 1 returns a cursor; page 2 is the last page. All rows must be
      // collected and counted, and filters applied across the full set.
      mockDynamoDBClient.query
        .mockResolvedValueOnce({
          items: [snapshot({ snapshotId: 'p1', createdAt: '2026-01-01T00:00:00.000Z' })],
          lastEvaluatedKey: Buffer.from(JSON.stringify({ tenantId: TENANT_ID })).toString('base64'),
          hasMore: true,
        })
        .mockResolvedValueOnce({
          items: [snapshot({ snapshotId: 'p2', createdAt: '2026-02-01T00:00:00.000Z' })],
          hasMore: false,
        });

      const res = await service.listSnapshots({ schoolId: SCHOOL_ID }, ctx);

      expect(mockDynamoDBClient.query).toHaveBeenCalledTimes(2);
      // Second call must pass the decoded cursor as exclusiveStartKey (8th arg).
      expect(mockDynamoDBClient.query.mock.calls[1][7]).toEqual({ tenantId: TENANT_ID });
      expect(res.count).toBe(2);
      expect(res.snapshots.map((s) => s.snapshotId)).toEqual(['p2', 'p1']);
    });

    it('applies templateId / academicYearBs / status filters', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          snapshot({ snapshotId: 'a', templateId: 'IEMIS_NPL_CEHRD_FLASH_I', status: 'generated' }),
          snapshot({ snapshotId: 'b', templateId: 'IEMIS_NPL_CEHRD_FLASH_II', status: 'generated' }),
          snapshot({ snapshotId: 'c', templateId: 'IEMIS_NPL_CEHRD_FLASH_I', status: 'submitted' }),
        ],
        hasMore: false,
      });

      const res = await service.listSnapshots(
        { schoolId: SCHOOL_ID, templateId: 'IEMIS_NPL_CEHRD_FLASH_I', status: 'generated' },
        ctx,
      );

      expect(res.count).toBe(1);
      expect(res.snapshots[0].snapshotId).toBe('a');
    });
  });

  describe('getSnapshotDownloadUrl', () => {
    it('mints a presigned URL + friendly filename for a generated snapshot', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(snapshot());

      const res = await service.getSnapshotDownloadUrl('snap-1', SCHOOL_ID, ctx);

      expect(mockS3Presigner.presignReportDownload).toHaveBeenCalledWith(
        'mock-jwt',
        snapshot().s3Key,
        expect.any(Number),
      );
      expect(res.url).toContain('https://s3-presigned/');
      expect(res.fileName).toBe('IEMIS_NPL_CEHRD_FLASH_I_2083.csv');
      expect(res.expiresInSeconds).toBeGreaterThan(0);
      expect(Date.parse(res.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('allows download for submitted + verified statuses', async () => {
      for (const status of ['submitted', 'verified'] as ReportingSnapshotStatus[]) {
        mockDynamoDBClient.getItem.mockResolvedValue(snapshot({ status }));
        const res = await service.getSnapshotDownloadUrl('snap-1', SCHOOL_ID, ctx);
        expect(res.url).toBeTruthy();
      }
    });

    it('rejects download while still generating (409, no presign)', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(
        snapshot({ status: 'generating', s3Key: undefined }),
      );

      await expect(
        service.getSnapshotDownloadUrl('snap-1', SCHOOL_ID, ctx),
      ).rejects.toThrow(ConflictException);
      expect(mockS3Presigner.presignReportDownload).not.toHaveBeenCalled();
    });

    it('rejects download for a failed snapshot (409)', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(
        snapshot({ status: 'failed', s3Key: undefined, errorCode: 'X', errorSummary: 'y' }),
      );

      await expect(
        service.getSnapshotDownloadUrl('snap-1', SCHOOL_ID, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects download for a dry-run snapshot (no S3 object was written)', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(snapshot({ dryRun: true }));

      await expect(
        service.getSnapshotDownloadUrl('snap-1', SCHOOL_ID, ctx),
      ).rejects.toThrow(ConflictException);
      expect(mockS3Presigner.presignReportDownload).not.toHaveBeenCalled();
    });

    it('throws NotFound when the snapshot does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(undefined);

      await expect(
        service.getSnapshotDownloadUrl('missing', SCHOOL_ID, ctx),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

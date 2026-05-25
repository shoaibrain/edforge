/**
 * BrandingService Unit Tests — Sprint C.0-followup C.0-fu.3.
 *
 * Establishes the missing test coverage flagged by the 2026-05-25 audit.
 * Mocks DynamoDBClientService + S3PresignerService + AuditedWriteService
 * so the runtime credential flow (TVM → STS → S3 SDK) is fully isolated.
 *
 * Coverage focus:
 *   1. getBranding — happy path with full assets, partial assets, no
 *      branding, missing school (404).
 *   2. presignUploadUrl — MIME allowlist, size limits, school existence,
 *      tenant-scoped S3 key construction.
 *   3. updateBranding — partial merge, version bump, tenant-scope key
 *      validation, audit emission.
 *   4. C.0-fu.2 specific — `urls` field present iff branding has ≥1
 *      S3-backed asset, absent otherwise.
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { BrandingService } from './branding.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { RequestContext, GlobalRole, EntityKeyBuilder } from '../common/entities/base.entity';
import { School } from '../common/entities/school.entity';

describe('BrandingService', () => {
  let service: BrandingService;
  let mockDynamoDBClient: any;
  let mockS3Presigner: any;
  let mockAuditedWrite: any;

  const TENANT_ID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
  const SCHOOL_ID = '3c28654f-c623-449b-8211-67c729784d37';
  const USER_ID = 'admin-user-id';

  const mockContext: RequestContext = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    email: 'admin@example.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockSchoolWithoutBranding: School = {
    tenantId: TENANT_ID,
    entityKey: EntityKeyBuilder.school(SCHOOL_ID),
    entityType: 'SCHOOL',
    schoolId: SCHOOL_ID,
    schoolCode: 'SCH001',
    name: 'Sunshine Private Academy',
    schoolType: 'private',
    gradeRange: { start: 'ECD', end: '10' },
    status: 'active',
    timezone: 'Asia/Kathmandu',
    locale: 'ne-NP',
    academicCalendarType: 'annual',
    calendarSystem: 'bikram_sambat',
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'system',
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'system',
    version: 1,
  };

  const tenantKeyPrefix = `tenants/${TENANT_ID}/schools/${SCHOOL_ID}/branding`;

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn(),
      updateItem: jest.fn(),
      getTableName: jest.fn().mockReturnValue('edforge-identity-basic'),
    };
    mockS3Presigner = {
      getBucketName: jest.fn().mockReturnValue('edforge-pdf-assets-257526644020-ap-south-1'),
      presignPut: jest.fn().mockResolvedValue('https://s3-presigned-put-url'),
      presignGet: jest.fn().mockImplementation((_jwt, key) =>
        Promise.resolve(`https://s3-presigned-get/${key}?sig=mocked`),
      ),
    };
    mockAuditedWrite = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandingService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: S3PresignerService, useValue: mockS3Presigner },
        { provide: AuditedWriteService, useValue: mockAuditedWrite },
      ],
    }).compile();

    service = module.get<BrandingService>(BrandingService);
  });

  // ============================================================
  // getBranding
  // ============================================================
  describe('getBranding', () => {
    it('returns { branding: null } when school has no branding sub-document', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchoolWithoutBranding);

      const result = await service.getBranding(SCHOOL_ID, mockContext);

      expect(result).toEqual({ branding: null });
      expect(result.urls).toBeUndefined();
      // C.0-fu.2 — no presign hops on the null path
      expect(mockS3Presigner.presignGet).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when school does not exist in tenant partition', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(undefined);

      await expect(service.getBranding(SCHOOL_ID, mockContext)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns raw S3 keys + signed GET URLs for every S3-backed asset present (C.0-fu.2)', async () => {
      const schoolWithFullBranding: School = {
        ...mockSchoolWithoutBranding,
        branding: {
          formalName: 'Sunshine Private Academy — Smoke',
          logoS3Key: `${tenantKeyPrefix}/logo/uuid.png`,
          principalSignatureS3Key: `${tenantKeyPrefix}/signature/uuid.png`,
          letterheadBackgroundS3Key: `${tenantKeyPrefix}/letterhead/uuid.pdf`,
          colorPalette: { primary: '#1F4E79', accent: '#FFC000' },
        },
      };
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithFullBranding);

      const result = await service.getBranding(SCHOOL_ID, mockContext);

      // Raw keys preserved (back-compat with C.0.7 clients)
      expect(result.branding?.logoS3Key).toBe(`${tenantKeyPrefix}/logo/uuid.png`);
      // Signed URLs minted for all 3 assets
      expect(result.urls?.logo).toMatch(/^https:\/\/s3-presigned-get\//);
      expect(result.urls?.principalSignature).toMatch(/^https:\/\/s3-presigned-get\//);
      expect(result.urls?.letterheadBackground).toMatch(/^https:\/\/s3-presigned-get\//);
      // Exactly 3 presign hops
      expect(mockS3Presigner.presignGet).toHaveBeenCalledTimes(3);
    });

    it('omits the urls field entirely when branding has no S3-backed assets (C.0-fu.2)', async () => {
      const schoolWithMetadataOnlyBranding: School = {
        ...mockSchoolWithoutBranding,
        branding: {
          formalName: 'Metadata-only branding',
          colorPalette: { primary: '#FF0000', accent: '#00FF00' },
          panNumber: '123456789',
        },
      };
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithMetadataOnlyBranding);

      const result = await service.getBranding(SCHOOL_ID, mockContext);

      expect(result.branding).toBeDefined();
      // No `urls: {}` noise — field is absent when no S3 keys to sign
      expect(result.urls).toBeUndefined();
      expect(mockS3Presigner.presignGet).not.toHaveBeenCalled();
    });

    it('returns partial urls when only some S3-backed assets are present (C.0-fu.2)', async () => {
      const schoolWithLogoOnly: School = {
        ...mockSchoolWithoutBranding,
        branding: {
          logoS3Key: `${tenantKeyPrefix}/logo/uuid.png`,
        },
      };
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithLogoOnly);

      const result = await service.getBranding(SCHOOL_ID, mockContext);

      expect(result.urls?.logo).toBeDefined();
      expect(result.urls?.principalSignature).toBeUndefined();
      expect(result.urls?.letterheadBackground).toBeUndefined();
      expect(mockS3Presigner.presignGet).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // presignUploadUrl
  // ============================================================
  describe('presignUploadUrl', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchoolWithoutBranding);
    });

    it('mints a presigned PUT URL with tenant-scoped key for a valid logo upload', async () => {
      const result = await service.presignUploadUrl(
        SCHOOL_ID,
        { assetType: 'logo', contentType: 'image/png', contentLength: 67 },
        mockContext,
      );

      expect(result.uploadUrl).toBe('https://s3-presigned-put-url');
      expect(result.key).toMatch(
        new RegExp(`^tenants/${TENANT_ID}/schools/${SCHOOL_ID}/branding/logo/[0-9a-f-]{36}\\.png$`),
      );
      expect(result.expiresInSeconds).toBe(300);
      expect(mockS3Presigner.presignPut).toHaveBeenCalledWith(
        'mock-jwt-token',
        result.key,
        'image/png',
        67,
        300,
      );
    });

    it('rejects an SVG upload for the signature assetType (per per-asset MIME allowlist)', async () => {
      // SVG is allowed for logo, NOT for signature
      await expect(
        service.presignUploadUrl(
          SCHOOL_ID,
          { assetType: 'signature', contentType: 'image/svg+xml', contentLength: 100 },
          mockContext,
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('rejects a logo upload that exceeds the 2 MB size limit', async () => {
      await expect(
        service.presignUploadUrl(
          SCHOOL_ID,
          {
            assetType: 'logo',
            contentType: 'image/png',
            contentLength: 3 * 1024 * 1024, // 3 MB
          },
          mockContext,
        ),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('returns 404 if the schoolId does not exist in the tenant partition', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(undefined);

      await expect(
        service.presignUploadUrl(
          SCHOOL_ID,
          { assetType: 'logo', contentType: 'image/png', contentLength: 100 },
          mockContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // updateBranding
  // ============================================================
  describe('updateBranding', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchoolWithoutBranding);
      mockDynamoDBClient.updateItem.mockResolvedValue(mockSchoolWithoutBranding);
    });

    it('mints a fresh brandingVersionId on every PATCH', async () => {
      const result = await service.updateBranding(
        SCHOOL_ID,
        { formalName: 'Updated Name' },
        mockContext,
      );

      expect(result.branding?.brandingVersionId).toBeDefined();
      expect(result.branding?.brandingVersionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('rejects a PATCH where logoS3Key is not scoped to this tenant', async () => {
      await expect(
        service.updateBranding(
          SCHOOL_ID,
          {
            logoS3Key: 'tenants/SOME-OTHER-TENANT/schools/x/branding/logo/forged.png',
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('emits an audit row after a successful PATCH', async () => {
      await service.updateBranding(
        SCHOOL_ID,
        { formalName: 'Audited Update' },
        mockContext,
      );

      expect(mockAuditedWrite.emit).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({
          schoolId: SCHOOL_ID,
          targetEntity: 'SCHOOL',
          targetEntityId: SCHOOL_ID,
          action: 'update',
        }),
      );
    });

    it('returns signed GET URLs in the response after a successful PATCH (C.0-fu.2)', async () => {
      const result = await service.updateBranding(
        SCHOOL_ID,
        { logoS3Key: `${tenantKeyPrefix}/logo/new-uuid.png` },
        mockContext,
      );

      expect(result.urls?.logo).toMatch(/^https:\/\/s3-presigned-get\//);
      expect(mockS3Presigner.presignGet).toHaveBeenCalledWith(
        'mock-jwt-token',
        `${tenantKeyPrefix}/logo/new-uuid.png`,
      );
    });
  });
});

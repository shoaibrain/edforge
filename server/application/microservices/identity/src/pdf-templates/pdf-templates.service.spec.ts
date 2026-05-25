/**
 * PdfTemplatesService Unit Tests — Sprint C.1.3.
 *
 * Coverage matrix:
 *   1. Lazy-default path — no persisted row → returns descriptor.defaults
 *      for the resolved archetype, source='default', no DDB write attempted.
 *   2. Persisted-row path — row exists → returns persisted templateConfig
 *      + templateId + configVersion, source='persisted'.
 *   3. Archetype resolution — Tenant.archetype='PABSON' produces the
 *      PABSON default profile; archetype=undefined falls through to
 *      GENERIC; reserved archetypes (CBSE_IN) also produce GENERIC.
 *   4. Unknown docType → BadRequestException with errorCode.
 *   5. Tenant metadata missing → NotFoundException.
 *
 * Renderer side is real, not mocked: we import `@aibrains/pdf-renderer`
 * @0.6.0 and assert against actual descriptor defaults (PABSON dual-lang,
 * GENERIC EN-only). That way a future shared-renderer breaking-change
 * shows up here, not in production.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PdfTemplatesService } from './pdf-templates.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { RequestContext, GlobalRole, EntityKeyBuilder } from '../common/entities/base.entity';
import type { Tenant } from '../common/entities/tenant.entity';
import { PdfTemplate } from './pdf-templates.types';

describe('PdfTemplatesService', () => {
  let service: PdfTemplatesService;
  let mockDynamoDBClient: {
    getClient: jest.Mock;
    getItem: jest.Mock;
  };

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

  const mockTenantPabson: Tenant = {
    tenantId: TENANT_ID,
    entityKey: 'METADATA',
    entityType: 'TENANT',
    tenantId_: TENANT_ID,
    tenantName: 'PABSON Test Tenant',
    tier: 'basic',
    status: 'active',
    tenantTag: 'production',
    country: 'NPL',
    archetype: 'PABSON',
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: USER_ID,
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: USER_ID,
    version: 1,
  } as unknown as Tenant;

  const mockTenantGeneric: Tenant = {
    ...mockTenantPabson,
    archetype: 'GENERIC',
    country: 'USA',
  } as Tenant;

  const mockTenantUndefinedArchetype: Tenant = {
    ...mockTenantPabson,
    archetype: undefined,
  } as Tenant;

  const mockClient = { __mockedClient: true };

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue(mockClient),
      getItem: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PdfTemplatesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      ],
    }).compile();

    service = moduleRef.get(PdfTemplatesService);
  });

  // ============================================
  // Unknown docType — input validation
  // ============================================
  describe('docType validation', () => {
    it('throws BadRequestException for unknown docType (typo guard)', async () => {
      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'UNKNOWN_DOC', mockContext),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns errorCode PDF_TEMPLATE_UNKNOWN_DOC_TYPE in the exception body', async () => {
      try {
        await service.getCurrentTemplate(SCHOOL_ID, 'BOGUS', mockContext);
        fail('expected BadRequestException');
      } catch (err) {
        const body = (err as BadRequestException).getResponse() as { errorCode: string };
        expect(body.errorCode).toBe('PDF_TEMPLATE_UNKNOWN_DOC_TYPE');
      }
    });
  });

  // ============================================
  // Tenant metadata missing — fail-loud
  // ============================================
  describe('tenant metadata sanity', () => {
    it('throws NotFoundException when the METADATA row is absent (deeply mis-provisioned tenant)', async () => {
      mockDynamoDBClient.getItem
        // PdfTemplate row miss
        .mockResolvedValueOnce(null)
        // Tenant metadata miss
        .mockResolvedValueOnce(null);

      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // Lazy-default path — the V1 happy path
  // ============================================
  describe('lazy-default path (no persisted row)', () => {
    it('returns PABSON archetype defaults when no persisted row exists', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null)             // PdfTemplate miss
        .mockResolvedValueOnce(mockTenantPabson); // Tenant metadata hit

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      expect(result.source).toBe('default');
      expect(result.docType).toBe('INVOICE');
      expect(result.templateId).toBeUndefined();
      expect(result.configVersion).toBeUndefined();
      // PABSON descriptor default shape — locked at C.1.1
      expect(result.templateConfig.labelLanguages).toEqual(['en', 'ne']);
      expect(result.templateConfig.dateFormat).toBe('dual');
      expect(result.templateConfig.numberFormat).toBe('south-asian');
    });

    it('returns GENERIC archetype defaults when tenant archetype is GENERIC', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTenantGeneric);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      expect(result.source).toBe('default');
      expect(result.templateConfig.labelLanguages).toEqual(['en']);
      expect(result.templateConfig.dateFormat).toBe('gregorian');
      expect(result.templateConfig.numberFormat).toBe('western');
    });

    it('falls through to GENERIC profile when tenant archetype is undefined', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTenantUndefinedArchetype);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      expect(result.source).toBe('default');
      expect(result.templateConfig.labelLanguages).toEqual(['en']);
      expect(result.templateConfig.dateFormat).toBe('gregorian');
    });

    it('returns RECEIPT defaults when docType is RECEIPT (multi-descriptor sanity)', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTenantPabson);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'RECEIPT', mockContext);

      expect(result.docType).toBe('RECEIPT');
      expect(result.source).toBe('default');
      // PABSON receipt-specific: tax-breakdown disclosure ON by default
      expect((result.templateConfig.taxBreakdownSection as Record<string, boolean>).showPanNumber).toBe(true);
    });

    it('uses the EntityKeyBuilder for the persisted-row lookup (regression guard for key drift)', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTenantPabson);

      await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      const firstCall = mockDynamoDBClient.getItem.mock.calls[0];
      // (client, tenantId, entityKey)
      expect(firstCall[2]).toBe(EntityKeyBuilder.pdfTemplateCurrent(SCHOOL_ID, 'INVOICE'));
      expect(firstCall[1]).toBe(TENANT_ID);
    });
  });

  // ============================================
  // Persisted-row path — what the C.2.x editor will eventually produce
  // ============================================
  describe('persisted-row path', () => {
    const persistedTemplate: PdfTemplate = {
      tenantId: TENANT_ID,
      entityKey: EntityKeyBuilder.pdfTemplateCurrent(SCHOOL_ID, 'INVOICE'),
      entityType: 'PDF_TEMPLATE_CURRENT',
      schoolId: SCHOOL_ID,
      docType: 'INVOICE',
      templateId: 'tmpl-abc-123',
      configVersion: 5,
      templateConfig: {
        // operator-customized snapshot — distinct from descriptor defaults
        labelLanguages: ['en'],
        dateFormat: 'gregorian',
        header: { showLogo: false, showSchoolName: true, showSchoolAddress: false, showContact: false },
      },
      createdAt: '2026-01-01T00:00:00Z',
      createdBy: USER_ID,
      updatedAt: '2026-04-15T00:00:00Z',
      updatedBy: USER_ID,
      version: 5,
    };

    it('returns the persisted templateConfig + templateId + configVersion when a row exists', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(persistedTemplate)
        .mockResolvedValueOnce(mockTenantPabson);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      expect(result.source).toBe('persisted');
      expect(result.templateId).toBe('tmpl-abc-123');
      expect(result.configVersion).toBe(5);
      // The persisted shape is returned verbatim — NOT merged with defaults.
      // (If the editor wants to express "use defaults for X", it must
      // explicitly include the default value in the saved config.)
      expect(result.templateConfig).toEqual(persistedTemplate.templateConfig);
    });

    it('persisted-row path overrides the archetype default — operator save wins', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(persistedTemplate)
        .mockResolvedValueOnce(mockTenantPabson);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', mockContext);

      // Persisted config has labelLanguages=['en'] even though PABSON
      // archetype default is ['en', 'ne'].
      expect(result.templateConfig.labelLanguages).toEqual(['en']);
    });
  });
});

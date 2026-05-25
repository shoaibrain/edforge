/**
 * `IdentityClientService.getCurrentTemplate` Unit Tests — Sprint C.1.4.
 *
 * Coverage matrix:
 *   1. Cache hit — second call within TTL doesn't trigger HTTP.
 *   2. Cache miss — first call triggers HTTP.
 *   3. TTL expiry — call after 60s triggers HTTP again.
 *   4. 5xx fallback — server returns 500 → returns descriptor.defaults
 *      (no throw). 4xx propagates as-is.
 *   5. LRU eviction — fill 100 entries, add 101st, oldest evicted.
 *   6. Per-tenant isolation — same schoolId+docType but different tenantId
 *      have separate cache entries.
 *   7. fallbackArchetype option — PABSON archetype preserved on degraded
 *      path; absence defaults to GENERIC.
 *
 * Mocks `HttpClientService` so no real HTTP fires. Jest fake timers control
 * the TTL window deterministically.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { HttpClientService } from '@app/http-client';
import { IdentityClientService } from './identity-client.service';
import type { PdfTemplateCurrentResponse } from './identity-client.service';
import type { RequestContext } from '@app/http-client';

const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';
const SCHOOL_ID = 'school-1';

const ctx = (tenantId: string): RequestContext =>
  ({
    tenantId,
    userId: 'u1',
    jwtToken: 'jwt',
    userRole: 'TenantAdmin',
    userName: 'admin',
  }) as unknown as RequestContext;

function persistedResponse(overrides?: Partial<PdfTemplateCurrentResponse>): PdfTemplateCurrentResponse {
  return {
    docType: 'INVOICE',
    templateConfig: { mocked: true } as Record<string, unknown>,
    source: 'persisted',
    templateId: 'tmpl-xyz',
    configVersion: 3,
    ...overrides,
  };
}

describe('IdentityClientService.getCurrentTemplate (Sprint C.1.4)', () => {
  let service: IdentityClientService;
  let httpClient: { get: jest.Mock };

  beforeEach(() => {
    httpClient = { get: jest.fn() };
    service = new IdentityClientService(httpClient as unknown as HttpClientService);
    service._clearTemplateCacheForTest();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============================================
  // Hit / miss / TTL
  // ============================================
  describe('cache lifecycle', () => {
    it('cache miss on first call → fires HTTP and returns response', async () => {
      httpClient.get.mockResolvedValueOnce({ data: persistedResponse() });

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('persisted');
      expect(result.templateId).toBe('tmpl-xyz');
    });

    it('cache hit on second call within TTL → does NOT fire HTTP', async () => {
      httpClient.get.mockResolvedValueOnce({ data: persistedResponse() });

      await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
      // Advance time but stay within TTL
      jest.advanceTimersByTime(30_000);
      const result2 = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(1);
      expect(result2.source).toBe('persisted');
    });

    it('TTL expiry after 60s → fires HTTP again', async () => {
      httpClient.get
        .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'tmpl-1' }) })
        .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'tmpl-2' }) });

      const first = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
      // Advance just past the 60s TTL
      jest.advanceTimersByTime(60_001);
      const second = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(2);
      expect(first.templateId).toBe('tmpl-1');
      expect(second.templateId).toBe('tmpl-2');
    });
  });

  // ============================================
  // 5xx fallback — render never 500s on template-fetch failure
  // ============================================
  describe('graceful degradation on identity 5xx', () => {
    it('returns descriptor default with source="default" when identity returns 500', async () => {
      const err: any = new Error('Server Error');
      err.response = { status: 500 };
      httpClient.get.mockRejectedValueOnce(err);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(result.source).toBe('default');
      expect(result.docType).toBe('INVOICE');
      // GENERIC archetype default (no fallbackArchetype passed)
      expect((result.templateConfig as any).labelLanguages).toEqual(['en']);
      expect((result.templateConfig as any).dateFormat).toBe('gregorian');
    });

    it('returns descriptor default when identity returns 503', async () => {
      const err: any = new Error('Bad Gateway');
      err.response = { status: 503 };
      httpClient.get.mockRejectedValueOnce(err);

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(result.source).toBe('default');
    });

    it('returns descriptor default on network failure (no status code)', async () => {
      // No `response` object at all — represents network/connection failure
      httpClient.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(result.source).toBe('default');
    });

    it('PABSON archetype is preserved when caller passes fallbackArchetype', async () => {
      const err: any = new Error('Server Error');
      err.response = { status: 500 };
      httpClient.get.mockRejectedValueOnce(err);

      const result = await service.getCurrentTemplate(
        SCHOOL_ID,
        'INVOICE',
        ctx(TENANT_A),
        { fallbackArchetype: 'PABSON' },
      );

      expect(result.source).toBe('default');
      // PABSON archetype default — dual-lang + dual-date + south-asian
      expect((result.templateConfig as any).labelLanguages).toEqual(['en', 'ne']);
      expect((result.templateConfig as any).dateFormat).toBe('dual');
      expect((result.templateConfig as any).numberFormat).toBe('south-asian');
    });

    it('5xx fallback does NOT pollute the cache (next call retries identity)', async () => {
      const err: any = new Error('Server Error');
      err.response = { status: 500 };
      httpClient.get
        .mockRejectedValueOnce(err)
        // Second call — identity recovered
        .mockResolvedValueOnce({ data: persistedResponse() });

      await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
      const second = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(2);
      expect(second.source).toBe('persisted');
    });

    it('5xx fallback for UNKNOWN docType throws ServiceUnavailableException (cannot synthesize)', async () => {
      const err: any = new Error('Server Error');
      err.response = { status: 500 };
      httpClient.get.mockRejectedValueOnce(err);

      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'UNKNOWN_DOC', ctx(TENANT_A)),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ============================================
  // 4xx propagates — real client error
  // ============================================
  describe('4xx propagation', () => {
    it('404 propagates (not fallback) — unknown school is a real error', async () => {
      const err: any = new Error('Not Found');
      err.response = { status: 404 };
      httpClient.get.mockRejectedValueOnce(err);

      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A)),
      ).rejects.toBe(err);
    });

    it('403 propagates — missing pdf-templates:view permission is a real error', async () => {
      const err: any = new Error('Forbidden');
      err.response = { status: 403 };
      httpClient.get.mockRejectedValueOnce(err);

      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A)),
      ).rejects.toBe(err);
    });

    it('400 propagates — unknown docType from identity surfaces upstream', async () => {
      const err: any = new Error('Bad Request');
      err.response = { status: 400 };
      httpClient.get.mockRejectedValueOnce(err);

      await expect(
        service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A)),
      ).rejects.toBe(err);
    });
  });

  // ============================================
  // LRU + cap
  // ============================================
  describe('LRU eviction at 100-entry cap', () => {
    it('evicts the oldest entry when adding the 101st', async () => {
      // Fill cache with 100 entries (school-0…school-99)
      for (let i = 0; i < 100; i++) {
        httpClient.get.mockResolvedValueOnce({
          data: persistedResponse({ templateId: `tmpl-${i}` }),
        });
        await service.getCurrentTemplate(`school-${i}`, 'INVOICE', ctx(TENANT_A));
      }
      expect(httpClient.get).toHaveBeenCalledTimes(100);

      // Add the 101st — should evict school-0 (oldest)
      httpClient.get.mockResolvedValueOnce({
        data: persistedResponse({ templateId: 'tmpl-100' }),
      });
      await service.getCurrentTemplate('school-100', 'INVOICE', ctx(TENANT_A));

      // school-0 should now be a cache miss (re-fetch)
      httpClient.get.mockResolvedValueOnce({
        data: persistedResponse({ templateId: 'tmpl-0-refetched' }),
      });
      const refetched = await service.getCurrentTemplate('school-0', 'INVOICE', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(102);
      expect(refetched.templateId).toBe('tmpl-0-refetched');
    });

    it('reading an entry within TTL refreshes its LRU position (touches it)', async () => {
      // Fill 100 entries
      for (let i = 0; i < 100; i++) {
        httpClient.get.mockResolvedValueOnce({
          data: persistedResponse({ templateId: `tmpl-${i}` }),
        });
        await service.getCurrentTemplate(`school-${i}`, 'INVOICE', ctx(TENANT_A));
      }

      // Touch school-0 within TTL — moves it to most-recently-used end
      const touched = await service.getCurrentTemplate('school-0', 'INVOICE', ctx(TENANT_A));
      expect(touched.templateId).toBe('tmpl-0'); // still cached, not re-fetched
      expect(httpClient.get).toHaveBeenCalledTimes(100);

      // Add 101st entry — should evict school-1 (now the oldest after touch)
      httpClient.get.mockResolvedValueOnce({
        data: persistedResponse({ templateId: 'tmpl-100' }),
      });
      await service.getCurrentTemplate('school-100', 'INVOICE', ctx(TENANT_A));

      // school-0 still cached (just got touched)
      const still0 = await service.getCurrentTemplate('school-0', 'INVOICE', ctx(TENANT_A));
      expect(still0.templateId).toBe('tmpl-0');
      expect(httpClient.get).toHaveBeenCalledTimes(101);

      // school-1 should now be a miss — it was the oldest when school-100 was added
      httpClient.get.mockResolvedValueOnce({
        data: persistedResponse({ templateId: 'tmpl-1-refetched' }),
      });
      const refetched1 = await service.getCurrentTemplate('school-1', 'INVOICE', ctx(TENANT_A));
      expect(refetched1.templateId).toBe('tmpl-1-refetched');
      expect(httpClient.get).toHaveBeenCalledTimes(102);
    });
  });

  // ============================================
  // Per-tenant isolation
  // ============================================
  describe('per-tenant isolation', () => {
    it('same (school, docType) across different tenants have separate cache entries', async () => {
      httpClient.get
        .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'tenant-a-tmpl' }) })
        .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'tenant-b-tmpl' }) });

      const a = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
      const b = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_B));

      expect(a.templateId).toBe('tenant-a-tmpl');
      expect(b.templateId).toBe('tenant-b-tmpl');
      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });

    it('same school+tenant but different docType have separate cache entries', async () => {
      httpClient.get
        .mockResolvedValueOnce({ data: persistedResponse({ docType: 'INVOICE', templateId: 'inv' }) })
        .mockResolvedValueOnce({ data: persistedResponse({ docType: 'RECEIPT', templateId: 'rct' }) });

      await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
      await service.getCurrentTemplate(SCHOOL_ID, 'RECEIPT', ctx(TENANT_A));

      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * `IdentityClientService.getCurrentTemplate` — finance-side smoke spec.
 *
 * Sprint C.1.4. The full lifecycle matrix (LRU eviction, all 5xx variants,
 * etc.) is covered by the academics-side spec since both implementations
 * are byte-for-byte identical except for the `HttpClientService` call
 * signature adaptation (finance uses `userRole: context.role` instead of
 * the @app/http-client shape).
 *
 * This finance spec is the **lockstep smoke** — verifies the finance
 * version is functional. Mirrors essential cases from the academics
 * spec: hit / miss / TTL / 5xx fallback / 4xx propagate. If this drifts
 * from the academics impl, fix BOTH; do not let one become stale.
 */

import { HttpClientService } from '@app/http-client';
import { IdentityClientService } from './identity-client.service';
import type { PdfTemplateCurrentResponse } from './identity-client.service';
import type { RequestContext } from '../entities/base.entity';

const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';
const SCHOOL_ID = 'school-1';

const ctx = (tenantId: string): RequestContext =>
  ({
    tenantId,
    userId: 'u1',
    jwtToken: 'jwt',
    role: 'TenantAdmin',
    schoolId: SCHOOL_ID,
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

describe('finance IdentityClientService.getCurrentTemplate (Sprint C.1.4 — lockstep smoke)', () => {
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

  it('cache miss → HTTP → cache hit on second call within TTL', async () => {
    httpClient.get.mockResolvedValueOnce({ data: persistedResponse() });

    const first = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
    const second = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(first.templateId).toBe('tmpl-xyz');
    expect(second.templateId).toBe('tmpl-xyz');
  });

  it('TTL expiry after 60s re-fetches', async () => {
    httpClient.get
      .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'first' }) })
      .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'second' }) });

    await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
    jest.advanceTimersByTime(60_001);
    const second = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

    expect(httpClient.get).toHaveBeenCalledTimes(2);
    expect(second.templateId).toBe('second');
  });

  it('5xx → descriptor default (GENERIC by default)', async () => {
    const err: any = new Error('Server Error');
    err.response = { status: 500 };
    httpClient.get.mockRejectedValueOnce(err);

    const result = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));

    expect(result.source).toBe('default');
    expect((result.templateConfig as any).labelLanguages).toEqual(['en']);
  });

  it('5xx + fallbackArchetype=PABSON → preserves PABSON locale', async () => {
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
    expect((result.templateConfig as any).labelLanguages).toEqual(['en', 'ne']);
    expect((result.templateConfig as any).dateFormat).toBe('dual');
  });

  it('404 propagates (not silenced as fallback) — real client error', async () => {
    const err: any = new Error('Not Found');
    err.response = { status: 404 };
    httpClient.get.mockRejectedValueOnce(err);

    await expect(
      service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A)),
    ).rejects.toBe(err);
  });

  it('per-tenant isolation — same school+docType across tenants → separate cache entries', async () => {
    httpClient.get
      .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'a' }) })
      .mockResolvedValueOnce({ data: persistedResponse({ templateId: 'b' }) });

    const a = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_A));
    const b = await service.getCurrentTemplate(SCHOOL_ID, 'INVOICE', ctx(TENANT_B));

    expect(a.templateId).toBe('a');
    expect(b.templateId).toBe('b');
    expect(httpClient.get).toHaveBeenCalledTimes(2);
  });
});

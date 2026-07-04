/**
 * Identity Client Service for Finance Service
 *
 * Communicates with the Identity service for:
 * - School validation
 * - Permission checks
 * - User role resolution
 * - Student data lookups
 */

import { Injectable, Logger, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { HttpClientService } from '@app/http-client';
import { RequestContext } from '../entities/base.entity';
import {
  getDescriptor,
  hasDescriptor,
  type Archetype as PdfArchetype,
  type DocType,
} from '@aibrains/pdf-renderer';

const ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LINKED_STUDENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/**
 * EPIC-FB FB-0.2 — school display-name cache TTL. Read paths (invoice
 * list/detail, PDF/receipt renders) now resolve the CURRENT school name on
 * every request; this cache keeps that at ~1 identity hop per school per
 * 5 minutes per process. A school rename therefore propagates to finance
 * responses within 5 minutes (vs never, pre-FB-0.2).
 */
const SCHOOL_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const BACKOFF_BASE = 200;
/** Cross-request PDF template cache TTL — Sprint C.1.4. 60s. */
const TEMPLATE_CACHE_TTL_MS = 60_000;
/** Cap on cached template entries; LRU-evict oldest on overflow. */
const TEMPLATE_CACHE_MAX_ENTRIES = 100;

interface RoleCacheEntry {
  data: { role: string; staffId?: string } | null;
  cachedAt: number;
}

interface LinkedStudentsCacheEntry {
  studentIds: string[];
  cachedAt: number;
}

/**
 * Identity-side response for `GET /schools/:schoolId/pdf-templates/:docType/current`.
 *
 * Sprint C.1.4. Mirrors the same-named type in academics' IdentityClient
 * and the source-of-truth `PdfTemplateCurrentResponse` in identity's
 * pdf-templates module. Declared locally because cross-service type
 * imports are forbidden (services communicate via HTTP, not by importing
 * each other's symbols).
 */
export interface PdfTemplateCurrentResponse {
  docType: DocType;
  templateConfig: Record<string, unknown>;
  source: 'persisted' | 'default';
  templateId?: string;
  configVersion?: number;
}

/** Cache entry for `getCurrentTemplate`. Sprint C.1.4. */
interface TemplateCacheEntry {
  response: PdfTemplateCurrentResponse;
  cachedAt: number;
}

/**
 * Branding fields stored on a school's `branding` sub-document. Mirrors
 * `SchoolBrandingDto` in `@aibrains/shared-types` (declared locally
 * because cross-service type imports are forbidden — identity is HTTP).
 *
 * Sprint C.1.5 — consumed by the Invoice PDF render endpoint.
 */
export interface SchoolBrandingResponse {
  formalName?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;
  logoS3Key?: string;
  principalSignatureS3Key?: string;
  letterheadBackgroundS3Key?: string;
  colorPalette?: { primary: string; accent: string };
  panNumber?: string;
  vatNumber?: string;
  tagline?: string;
  brandingVersionId?: string;
}

/**
 * Short-lived signed GET URLs for branding S3 assets. Minted by identity
 * on every `GET /schools/:id/branding` response (10-min TTL). Sprint C.1.5
 * render endpoints consume these directly — no second presign hop needed.
 */
export interface BrandingAssetUrls {
  logo?: string;
  principalSignature?: string;
  letterheadBackground?: string;
}

/** Identity-side response for `GET /schools/:schoolId/branding`. Sprint C.1.5. */
export interface BrandingFetchResponse {
  branding: SchoolBrandingResponse | null;
  urls?: BrandingAssetUrls;
}

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;
  private readonly roleCache = new Map<string, RoleCacheEntry>();
  private readonly linkedStudentsCache = new Map<string, LinkedStudentsCacheEntry>();
  /** FB-0.2 — `${tenantId}:${schoolId}` → resolved name. Nulls never cached. */
  private readonly schoolNameCache = new Map<string, { name: string; cachedAt: number }>();
  /**
   * In-memory cache for per-(tenant,school,docType) PDF template lookups
   * (60s TTL, 100-entry LRU). Sprint C.1.4 — see `getCurrentTemplate`.
   */
  private readonly templateCache = new Map<string, TemplateCacheEntry>();
  /**
   * Single-flight dedup for in-flight `getCurrentTemplate` fetches.
   * Sprint C.1.4 (CodeRabbit catch) — see academics-side JSDoc for the
   * full rationale. Lockstep with academics.
   */
  private readonly pendingPdfTemplateRequests = new Map<string, Promise<PdfTemplateCurrentResponse>>();
  private readonly REQUEST_TIMEOUT = 5000;
  private readonly MAX_RETRIES = 2;

  constructor(private readonly httpClient: HttpClientService) {
    this.identityServiceUrl = process.env.IDENTITY_SERVICE_URL || 'http://identity-api.default.sc:3010';
  }

  /**
   * Get the current PDF template for `(school, docType)`.
   *
   * **Sprint C.1.4** — finance-side mirror of the same helper in
   * academics' IdentityClient. The two implementations stay in lockstep
   * because the cross-service caching + 5xx-fallback contract is the
   * same regardless of calling service. Wraps
   * `GET /schools/:schoolId/pdf-templates/:docType/current` on identity.
   *
   * See the academics-side JSDoc for the full caching + fallback rationale.
   * In short:
   *   - 60s TTL, 100-entry LRU keyed `{tenantId}:{schoolId}:{docType}`
   *   - 5xx / network failure → `descriptor.defaults(fallbackArchetype, 'en-US')`
   *     so finance Invoice + Receipt render endpoints never 500 due to a
   *     template-fetch failure
   *   - 4xx (404, 403, 400) propagates — real client errors
   *
   * @param options.fallbackArchetype — used only on identity 5xx. Defaults
   *   to `'GENERIC'`. Callers that know the tenant's archetype (e.g. via a
   *   recently-cached Tenant fetch) should pass it to preserve locale on
   *   degraded paths.
   */
  async getCurrentTemplate(
    schoolId: string,
    docType: string,
    context: RequestContext,
    options?: { fallbackArchetype?: PdfArchetype },
  ): Promise<PdfTemplateCurrentResponse> {
    const key = `${context.tenantId}:${schoolId}:${docType}`;
    const now = Date.now();
    const start = now;

    // Cache hit within TTL — LRU touch on read.
    const cached = this.templateCache.get(key);
    if (cached && now - cached.cachedAt < TEMPLATE_CACHE_TTL_MS) {
      this.templateCache.delete(key);
      this.templateCache.set(key, cached);
      this.logger.debug(
        `getCurrentTemplate: cache hit schoolId=${schoolId} docType=${docType} age=${now - cached.cachedAt}ms`,
      );
      return cached.response;
    }

    // Single-flight dedup — share an in-flight fetch with concurrent
    // callers on the same key. (CodeRabbit Sprint C.1.4 fix, lockstep with
    // academics.)
    const inFlight = this.pendingPdfTemplateRequests.get(key);
    if (inFlight) {
      this.logger.debug(
        `getCurrentTemplate: in-flight share schoolId=${schoolId} docType=${docType}`,
      );
      return inFlight;
    }

    // encodeURIComponent on each path segment is defensive — schoolId is a
    // UUID and docType is an enum string today, both safe — but encoding
    // fences against future reuse with untrusted input that could otherwise
    // smuggle `..%2F` path traversal. (CodeRabbit Sprint C.1.4 fix.)
    const url =
      `${this.identityServiceUrl}/schools/${encodeURIComponent(schoolId)}` +
      `/pdf-templates/${encodeURIComponent(docType)}/current`;
    const fetchPromise: Promise<PdfTemplateCurrentResponse> = (async () => {
      // Finance's HttpClientService expects the tenant context object
      // explicitly; mirror the same pattern other finance IdentityClient
      // methods use (see validateSchoolExists / getSchoolDetails).
      const response = await this.httpClient.get<PdfTemplateCurrentResponse>(
        url,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      // LRU refresh-order fix — Map.set on existing key doesn't reorder
      // insertion-order; delete first to force MRU placement on re-insert.
      // (CodeRabbit Sprint C.1.4 fix, lockstep with academics.)
      this.templateCache.delete(key);
      this.templateCache.set(key, { response: response.data, cachedAt: now });
      while (this.templateCache.size > TEMPLATE_CACHE_MAX_ENTRIES) {
        const oldestKey = this.templateCache.keys().next().value;
        if (oldestKey === undefined) break;
        this.templateCache.delete(oldestKey);
      }
      this.logger.debug(
        `getCurrentTemplate: ${response.data.source} schoolId=${schoolId} docType=${docType} ${Date.now() - start}ms`,
      );
      return response.data;
    })();
    this.pendingPdfTemplateRequests.set(key, fetchPromise);
    const cleanup = () => {
      if (this.pendingPdfTemplateRequests.get(key) === fetchPromise) {
        this.pendingPdfTemplateRequests.delete(key);
      }
    };
    void fetchPromise.then(cleanup, cleanup);

    try {
      return await fetchPromise;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === undefined || status >= 500) {
        this.logger.warn(
          `getCurrentTemplate: identity ${status ?? 'NETWORK'} on schoolId=${schoolId} docType=${docType}; ` +
            `returning descriptor default (fallbackArchetype=${options?.fallbackArchetype ?? 'GENERIC'})`,
        );
        return this.synthesizeDescriptorDefault(docType, options?.fallbackArchetype);
      }
      this.logger.debug(
        `getCurrentTemplate: schoolId=${schoolId} docType=${docType} status=${status} ${Date.now() - start}ms`,
      );
      throw error;
    }
  }

  /**
   * Build a `PdfTemplateCurrentResponse` from the renderer's descriptor
   * defaults — used by `getCurrentTemplate`'s 5xx fallback. Throws
   * `ServiceUnavailableException` when the requested docType isn't a
   * registered descriptor (unrecoverable — no JSON to synthesize).
   *
   * Sprint C.1.4.
   */
  private synthesizeDescriptorDefault(
    docType: string,
    fallbackArchetype?: PdfArchetype,
  ): PdfTemplateCurrentResponse {
    if (!hasDescriptor(docType as DocType)) {
      throw new ServiceUnavailableException(
        `Identity service unavailable AND docType '${docType}' is not a known descriptor — ` +
          `cannot synthesize fallback config. Known docTypes are registered in @aibrains/pdf-renderer.`,
      );
    }
    const archetype = fallbackArchetype ?? 'GENERIC';
    const descriptor = getDescriptor(docType as DocType);
    return {
      docType: docType as DocType,
      templateConfig: descriptor.defaults(archetype, 'en-US') as unknown as Record<string, unknown>,
      source: 'default',
    };
  }

  /** Test-only escape hatch — clears the template cache. Sprint C.1.4. */
  _clearTemplateCacheForTest(): void {
    this.templateCache.clear();
  }

  async validateSchoolExists(schoolId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.httpClient.get(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) return false;
      this.logger.error(`School validation failed for ${schoolId}: ${error.message}`);
      throw new ServiceUnavailableException(
        'Unable to validate school. The identity service is temporarily unavailable.',
      );
    }
  }

  /**
   * Fetch a school's branding sub-document from identity. Sprint C.1.5 —
   * consumed by the Invoice PDF render endpoint to populate the
   * `<BrandedHeader>` + `<SignatureLine>` primitives.
   *
   * Returns `{ branding, urls }` exactly as identity emits it:
   *   - `branding` is null when the school has not yet configured branding
   *     (the renderer falls back to schoolName-only + no logo in that case)
   *   - `urls` carries short-lived (10-min TTL) presigned GET URLs for
   *     each S3-backed asset that's present; absent or empty when the
   *     school has no S3-backed assets
   *
   * Throws on transport failure (network / 5xx). Callers should catch and
   * degrade — for V1, the render endpoint can render with `branding: null`
   * to produce a logo-less PDF rather than 500ing.
   */
  async getBranding(
    schoolId: string,
    context: RequestContext,
  ): Promise<BrandingFetchResponse> {
    const url =
      `${this.identityServiceUrl}/schools/${encodeURIComponent(schoolId)}/branding`;
    const response = await this.httpClient.get<BrandingFetchResponse>(
      url,
      {},
      { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
    );
    return response.data;
  }

  /**
   * Get the display name for a school. Returns null if not found.
   * Uses the same endpoint as validateSchoolExists but extracts the name.
   *
   * NB: this swallows ALL errors as `null` — callers cannot distinguish a
   * real 404 from a transport/5xx blip. That's fine for display-name
   * fallback (invoice rendering uses schoolId as fallback either way) but
   * NOT for cache-poisoning-sensitive callers like PermissionGuard's
   * existence check — use `schoolExists` instead, which discriminates.
   */
  async getSchoolName(schoolId: string, context: RequestContext): Promise<string | null> {
    const cacheKey = `${context.tenantId}:${schoolId}`;
    const cached = this.schoolNameCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SCHOOL_NAME_CACHE_TTL_MS) {
      return cached.name;
    }
    try {
      const response = await this.httpClient.get<{ name?: string; schoolName?: string }>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      const name = response.data?.name || response.data?.schoolName || null;
      if (name) {
        this.schoolNameCache.set(cacheKey, { name, cachedAt: Date.now() });
      }
      return name;
    } catch {
      return null;
    }
  }

  /**
   * SH.1 (PR #338 review fix-up) — discriminating school-existence probe.
   *
   * Used by `PermissionGuard.assertSchoolExists`. Returns a definitive
   * boolean only when identity gave a definitive answer; THROWS on
   * transport / 5xx / timeout so the caller can fail-closed for *this*
   * request without poisoning a 60s "missing" cache.
   *
   *  - 2xx response → `true` (school resolves; we don't require a non-empty
   *    name because a school technically being persisted but missing a
   *    name attribute still means "exists in this tenant")
   *  - HTTP 404 → `false` (identity-confirmed missing — cacheable)
   *  - HTTP 403 → throws (not a "missing" answer — could be a tenancy
   *    mismatch; caller should NOT cache as missing because a future
   *    correctly-scoped request might succeed)
   *  - 5xx / network / timeout / other → throws (transport-class — caller
   *    fails closed but MUST NOT cache)
   *
   * Sibling method to `getSchoolName` rather than a refactor of it because
   * `getSchoolName` has a non-guard caller (invoices.service.ts) that
   * relies on the swallow-to-null behavior for display-name fallback.
   */
  async schoolExists(schoolId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.httpClient.get(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return true;
    } catch (error: any) {
      if (error?.response?.status === 404) return false;
      throw error;
    }
  }

  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ allowed: boolean; reason?: string }> {
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.httpClient.post<{ allowed: boolean; reason?: string }>(
            `${this.identityServiceUrl}/users/${userId}/roles/permissions/check`,
            { resource, action, schoolId },
            {},
            { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
          ),
          this.timeoutPromise<never>(this.REQUEST_TIMEOUT),
        ]);
        return response.data;
      } catch (error: any) {
        if (attempt === this.MAX_RETRIES) {
          return { allowed: false, reason: 'Permission check unavailable' };
        }
        await this.sleep(BACKOFF_BASE * Math.pow(2, attempt));
      }
    }
    return { allowed: false };
  }

  async getUserRole(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ role: string; staffId?: string } | null> {
    const cacheKey = `${userId}:${schoolId}`;
    const cached = this.roleCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await this.httpClient.get<{ role: string; userId: string; schoolId: string }>(
        `${this.identityServiceUrl}/users/${userId}/roles/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      const result = { role: response.data.role };
      this.roleCache.set(cacheKey, { data: result, cachedAt: Date.now() });
      return result;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.roleCache.set(cacheKey, { data: null, cachedAt: Date.now() });
        return null;
      }
      throw error;
    }
  }

  /**
   * Resolve a userId to its display name via the identity service's
   * permissive `GET /users/:id/display-name` endpoint. Used by the
   * receipt renderer to replace the recorder UUID with a human name
   * on customer-facing receipts. Best-effort: returns null on any
   * failure (missing user, identity 5xx, network timeout) so the
   * caller can degrade rather than 5xx-ing the receipt.
   */
  async getUserDisplayName(
    userId: string,
    context: RequestContext,
  ): Promise<string | null> {
    try {
      const response = await this.httpClient.get<{ userId: string; displayName: string | null }>(
        `${this.identityServiceUrl}/users/${userId}/display-name`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data?.displayName ?? null;
    } catch {
      return null;
    }
  }

  async getStudentInfo(
    studentId: string,
    context: RequestContext,
  ): Promise<{
    studentId: string;
    firstName: string;
    lastName: string;
    gradeLevel: string;
    studentNumber?: string;
    emisStudentId?: string;
  } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010'}/academics/students/${studentId}`,
        { params: { schoolId: context.schoolId } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      const d = response.data;
      return {
        studentId: d.studentId,
        firstName: d.firstName,
        lastName: d.lastName,
        gradeLevel: d.currentGradeLevel || d.gradeLevel || '',
        studentNumber: d.studentNumber || undefined,
        emisStudentId: d.emisStudentId || undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * EPIC-FB FB-2.3 — resolve a student's family via the academics HTTP API
   * (`GET /academics/students/{id}/family?schoolId=…` — finance NEVER reads
   * the academics table directly, epic §3.0).
   *
   * Contract mirrors the academics endpoint: 200 with `family: null` for an
   * unlinked student. Returns `null` (distinct from `{ family: null }`) on
   * transport/5xx failure so callers can fail CLOSED on membership
   * validation — an unverifiable membership claim is rejected, not assumed.
   *
   * FB-5.1 — the response now also surfaces `siblings` (subject student
   * excluded), each carrying the optional `status` academics projects from
   * its batch-fetched student rows. Pre-FB-5.1 academics builds omit
   * `status`; consumers must treat a missing status as NOT active.
   */
  async getStudentFamily(
    studentId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{
    family: { id: string; name?: string } | null;
    siblings?: Array<{ studentId: string; studentName?: string; status?: string }>;
  } | null> {
    try {
      const academicsUrl = process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010';
      const response = await this.httpClient.get<{
        family: { id: string; name?: string } | null;
        siblings?: Array<{ studentId: string; studentName?: string; status?: string }>;
      }>(
        `${academicsUrl}/academics/students/${encodeURIComponent(studentId)}/family`,
        { params: { schoolId } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data ?? null;
    } catch (error: any) {
      this.logger.warn(
        `getStudentFamily: failed studentId=${studentId} schoolId=${schoolId}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  /**
   * EPIC-FB FB-4.6 — resolve a family's MEMBERS (family → students; the
   * inverse of `getStudentFamily` above) via the academics HTTP API.
   *
   * Two calls:
   *   1. `GET /academics/schools/{sid}/families/{fid}` — validates the
   *      family exists in this school (also covers the academics
   *      FAMILY_GROUPS feature flag: guard-off surfaces as 404 here) and
   *      supplies the display name. 404 → `{ kind: 'not_found' }`.
   *   2. `GET /academics/schools/{sid}/families/{fid}/members` — the
   *      RESTful GET companion of the existing POST/DELETE member routes.
   *      Shipped by academics in the same release (FB-4.6 companion
   *      commit). If that leg ever fails (mixed-version rollout, flag
   *      off), the result is
   *      `{ kind: 'members_unavailable' }` — the caller surfaces a
   *      distinct 503 rather than lying with an empty family. Tolerates
   *      both a bare array and `{ items: [...] }` response shapes.
   */
  async getFamilyMembers(
    familyId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<
    | { kind: 'ok'; family: { id: string; name: string }; members: Array<{ studentId: string; studentName: string }> }
    | { kind: 'not_found' }
    | { kind: 'members_unavailable'; family: { id: string; name: string } }
  > {
    const academicsUrl = process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010';
    const headers = { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role };
    const familyPath =
      `${academicsUrl}/academics/schools/${encodeURIComponent(schoolId)}/families/${encodeURIComponent(familyId)}`;

    let family: { id: string; name: string };
    try {
      const response = await this.httpClient.get<{ id: string; name: string }>(familyPath, {}, headers);
      family = { id: response.data.id, name: response.data.name };
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return { kind: 'not_found' };
      }
      this.logger.warn(
        `getFamilyMembers: family fetch failed familyId=${familyId} schoolId=${schoolId}: ${error?.message ?? error}`,
      );
      // Unverifiable family (academics 5xx / network) — treated like the
      // members leg failing: the caller must not guess.
      return { kind: 'members_unavailable', family: { id: familyId, name: '' } };
    }

    try {
      const response = await this.httpClient.get<
        Array<{ studentId: string; studentName: string }> | { items: Array<{ studentId: string; studentName: string }> }
      >(`${familyPath}/members`, {}, headers);
      const raw = response.data;
      const rows = Array.isArray(raw) ? raw : raw?.items ?? [];
      return {
        kind: 'ok',
        family,
        members: rows.map(m => ({ studentId: m.studentId, studentName: m.studentName })),
      };
    } catch (error: any) {
      this.logger.warn(
        `getFamilyMembers: member enumeration failed familyId=${familyId} schoolId=${schoolId}: `
        + `${error?.message ?? error} — academics GET /members route missing or down`,
      );
      return { kind: 'members_unavailable', family };
    }
  }

  /**
   * Get the student IDs linked to a parent/student user at a school.
   * Uses the academics service DataScopeService (via GET /academics/students)
   * which auto-scopes results to the parent's guardianship records.
   * Cache key includes tenantId to prevent cross-tenant leakage.
   */
  async getLinkedStudentIds(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<string[]> {
    const cacheKey = `${context.tenantId}:${userId}:${schoolId}`;
    const cached = this.linkedStudentsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < LINKED_STUDENTS_CACHE_TTL_MS) {
      return cached.studentIds;
    }

    try {
      const academicsUrl = process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010';
      const response = await this.httpClient.get<{ items: Array<{ studentId: string }> }>(
        `${academicsUrl}/academics/students`,
        { params: { schoolId, limit: 500 } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );

      const studentIds = (response.data?.items ?? []).map(s => s.studentId);
      this.linkedStudentsCache.set(cacheKey, { studentIds, cachedAt: Date.now() });
      return studentIds;
    } catch (error: any) {
      this.logger.warn(`Failed to resolve linked students for user ${userId} at school ${schoolId}: ${error.message}`);
      // Fail-closed: return empty array so caller denies access
      return [];
    }
  }

  /**
   * Bulk Ops Sprint C.3 — resolve student IDs for a given gradeLevel
   * (or all grades, when `gradeLevel` is undefined) at the named school.
   * Used by InvoicesService.resolveStudentIdsForBulkGenerate to power
   * the wizard's "By Grade" tab.
   *
   * Partial-failure tolerant: returns `[]` on a request failure so the
   * caller can log + continue across multiple grades without one bad
   * call killing the whole flow.
   */
  async getStudentIdsByGrade(
    schoolId: string,
    gradeLevel: string | undefined,
    context: RequestContext,
  ): Promise<string[]> {
    try {
      const academicsUrl = process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010';
      const response = await this.httpClient.get<{ items: Array<{ studentId: string }> }>(
        `${academicsUrl}/academics/students`,
        { params: { schoolId, limit: 1000, ...(gradeLevel && { gradeLevel }) } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return (response.data?.items ?? []).map(s => s.studentId);
    } catch (error: any) {
      this.logger.warn(
        `getStudentIdsByGrade: failed schoolId=${schoolId} grade=${gradeLevel ?? 'ALL'}: ${error?.message ?? error}`,
      );
      return [];
    }
  }

  /**
   * Enforce that the caller owns the student referenced in the entity.
   * Admin/Principal/Accountant bypass; Parent/Student must have linked student.
   * Throws ForbiddenException if access is denied.
   */
  async enforceStudentOwnership(
    entityStudentId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    // TenantAdmin bypasses all checks
    if (context.role === 'TenantAdmin') return;

    const roleResult = await this.getUserRole(context.userId, schoolId, context);
    const role = roleResult?.role;

    // Admin-level school roles bypass entity-level ownership
    if (role === 'Principal' || role === 'VicePrincipal' || role === 'Accountant') return;

    // Parent/Student must own the student
    if (role === 'Parent' || role === 'Student') {
      const linkedStudentIds = await this.getLinkedStudentIds(context.userId, schoolId, context);
      if (!linkedStudentIds.includes(entityStudentId)) {
        throw new ForbiddenException('Access denied to this resource');
      }
      return;
    }

    // Staff and other roles with billing:view can see all (list-level access is enough)
    // No entity-level restriction for non-parent/student roles that passed PermissionGuard
  }

  /**
   * Get workspace settings for a tenant. Returns the regional settings
   * including default currency, calendar system, locale, etc.
   */
  async getWorkspaceSettings(
    context: RequestContext,
  ): Promise<{ regional?: { defaultCurrency?: string; defaultCalendarSystem?: string } } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/tenants/${context.tenantId}/settings`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Get school details for grade level validation. Returns the legacy
   * `gradeRange` (start/end pair) and the P1 `enabledGradeLevels` array.
   * Callers should prefer `enabledGradeLevels` when populated and fall back
   * to `gradeRange`-derived options otherwise (mirrors the frontend
   * `useSchoolEnabledGradeOptions` resolution chain).
   */
  async getSchoolDetails(
    schoolId: string,
    context: RequestContext,
  ): Promise<{
    gradeRange?: { start: string; end: string };
    enabledGradeLevels?: string[];
  } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data;
    } catch {
      return null;
    }
  }

  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

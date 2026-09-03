/**
 * Identity Client Service
 * 
 * HTTP client for calling the Identity Service from Academics Service.
 * Uses circuit breaker and retry strategy for resilience.
 */

import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpClientService, RequestContext } from '@app/http-client';
import { FEATURE_FLAG_KEYS, type FeatureFlagKey, type AttendancePolicy, isFeatureEnabled as isFeatureEnabledPure } from '@aibrains/shared-types';
import {
  getDescriptor,
  hasDescriptor,
  type Archetype as PdfArchetype,
  type DocType,
} from '@aibrains/pdf-renderer';
// NOTE: `getDescriptor` / `hasDescriptor` are runtime imports, so academics
// bundles @react-pdf transitively through @aibrains/pdf-renderer (~3 MB).
// Converting these two to a descriptor-only entry point is tracked in the
// cost-redesign plan (C0.7 follow-up); the type imports above are already erased.

/**
 * School response from Identity Service
 */
export interface SchoolResponse {
  schoolId: string;
  schoolCode: string;
  /**
   * External government/EMIS school code (e.g. Nepal IEMIS). Required for
   * PABSON tenants, optional elsewhere. Present when the identity service
   * has populated it on the School entity.
   */
  emisSchoolCode?: string;
  name: string;
  shortName?: string;
  schoolType: string;
  gradeRange: {
    start: string;
    end: string;
  };
  /**
   * Phase 1 — the authoritative list of grade-level codes the school
   * operates (subset of `ORDERED_GRADES`). Identity backfills this from
   * `gradeRange.start..gradeRange.end` for legacy rows, so consumers can
   * trust it's populated on every response. Used by ELS.1 to validate
   * `Exam.gradeLevels[]` ⊆ school's enabled set.
   */
  enabledGradeLevels?: string[];
  status: string;
  timezone: string;
  locale: string;
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  currentAcademicYearId?: string;
}

/**
 * Academic year response from Identity Service
 */
export interface AcademicYearResponse {
  yearId: string;
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

/**
 * Staff response from Identity Service
 */
export interface StaffResponse {
  staffId: string;
  staffUniqueId?: string;
  firstName: string;
  lastSurname: string;
  email: string;
  role: string;
  employmentStatus: string;
  primarySchoolId?: string;
  department?: string;
  title?: string;
  schoolAssignments?: Array<{
    schoolId: string;
    isPrimary: boolean;
    role?: string;
  }>;
}

/**
 * Paginated staff list response from Identity Service
 */
export interface StaffListResponse {
  items: StaffResponse[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

/**
 * Academic session response from Identity Service
 */
export interface AcademicSessionResponse {
  academicSessionId: string;
  schoolId: string;
  sessionName: string;
  beginDate: string;
  endDate: string;
}

/**
 * Class period response from Identity Service
 */
export interface ClassPeriodResponse {
  periodId: string;
  schoolId: string;
  classPeriodName: string;
  startTime: string;
  endTime: string;
}

/**
 * Location response from Identity Service
 */
export interface LocationResponse {
  locationId: string;
  schoolId: string;
  roomNumber: string;
  locationType: string;
}

/**
 * Calendar date response from Identity Service
 */
export interface CalendarDateResponse {
  calendarDateId: string;
  schoolId: string;
  date: string;
  isInstructionalDay: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  dayOfWeek: string;
  calendarEvents?: Array<{
    description?: string;
    isAllDay?: boolean;
    eventType: string;
  }>;
}

/**
 * Parent account response from Identity Service
 */
export interface ParentAccountResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  studentId: string;
  schoolRole: 'Parent';
  status: string;
}

/**
 * Student account response from Identity Service
 */
export interface StudentAccountResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  studentId: string;
  schoolRole: 'Student';
  status: string;
}

/** Cache entry for user role lookups */
interface RoleCacheEntry {
  data: { role: string; staffId?: string } | null;
  cachedAt: number;
}

/**
 * Identity-side response for `GET /schools/:schoolId/pdf-templates/:docType/current`.
 *
 * Mirrors `PdfTemplateCurrentResponse` exported from the identity service's
 * pdf-templates module. Declared locally (NOT imported from identity)
 * because cross-service type imports are forbidden — identity is HTTP-only.
 * The contract is shipped through this duplicated shape; identity-side
 * changes must update both sides in lockstep (same convention as
 * `SchoolResponse` above).
 *
 * Sprint C.1.4.
 */
export interface PdfTemplateCurrentResponse {
  docType: DocType;
  templateConfig: Record<string, unknown>;
  source: 'persisted' | 'default';
  templateId?: string;
  configVersion?: number;
}

/**
 * Cache entry for `getCurrentTemplate`. Stores the resolved response with
 * a wall-clock timestamp for TTL semantics. Sprint C.1.4.
 */
interface TemplateCacheEntry {
  response: PdfTemplateCurrentResponse;
  cachedAt: number;
}

/** Cross-request template cache TTL — 60s. */
const TEMPLATE_CACHE_TTL_MS = 60_000;
/** Cap on cached template entries; LRU-evict oldest on overflow. */
const TEMPLATE_CACHE_MAX_ENTRIES = 100;

const ROLE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes (reduced from 10 to limit staleness on role changes)

/**
 * Per-request cache for identity-service school lookups.
 *
 * IEMIS bulk imports (and any batch op that creates N students for the
 * same school) previously invoked `getSchool` once per row, pinning the
 * commit phase on N inter-service HTTP round-trips. This wrapper memoizes
 * the School response for the lifetime of a single request/operation,
 * collapsing N lookups to 1.
 *
 * NOT a long-lived cache — construct a fresh instance at the top of each
 * request handler (or SQS message handler) and hand it down to callees.
 * Staleness is impossible because the cache is thrown away with the
 * request context.
 */
export class RequestScopedSchoolCache {
  private readonly cache = new Map<string, Promise<SchoolResponse>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly identityClient: Pick<IdentityClientService, 'getSchool'>,
  ) {}

  /**
   * Returns a cached School response or fetches on cache miss. Concurrent
   * callers for the same schoolId share the in-flight promise — avoids
   * the classic "N parallel creates stampede the backend" footgun.
   */
  async getSchool(schoolId: string, context: RequestContext): Promise<SchoolResponse> {
    const existing = this.cache.get(schoolId);
    if (existing) {
      this.hits++;
      return existing;
    }
    this.misses++;
    const pending = this.identityClient.getSchool(schoolId, context);
    this.cache.set(schoolId, pending);
    // If the underlying call fails, evict so later callers can retry.
    pending.catch(() => this.cache.delete(schoolId));
    return pending;
  }

  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}

/**
 * Cache entry for a tenant's feature flag map.
 *
 * Flags change rarely (an operator flips a flag via PATCH), so a 30-second
 * TTL is a reasonable trade-off between latency and rollback responsiveness:
 * a flag flip takes up to 30s to propagate to any academics-service pod
 * that has a fresh cache entry.
 */
interface FeatureFlagCacheEntry {
  flags: Record<string, boolean> | null;
  cachedAt: number;
}
const FEATURE_FLAG_CACHE_TTL_MS = 30 * 1000;

/**
 * Shape of the `/tenants/my/settings` response that matters for flag reads.
 * We intentionally pick only what we use to avoid coupling to the full DTO.
 */
interface WorkspaceSettingsForFlags {
  features?: Record<string, boolean>;
}

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;
  /** In-memory cache for user role lookups (avoids repeated Identity Service calls) */
  private readonly roleCache = new Map<string, RoleCacheEntry>();
  /** In-memory cache for per-tenant feature flag maps (30s TTL) */
  private readonly featureFlagCache = new Map<string, FeatureFlagCacheEntry>();
  /**
   * In-memory cache for per-(tenant,school,docType) PDF template lookups
   * (60s TTL, 100-entry LRU). Sprint C.1.4. See `getCurrentTemplate`.
   */
  private readonly templateCache = new Map<string, TemplateCacheEntry>();
  /**
   * Single-flight dedup for in-flight `getCurrentTemplate` fetches.
   *
   * **Sprint C.1.4 (CodeRabbit catch).** Without this map, N concurrent
   * callers on a cache miss each fire one identity-service GET. The
   * RequestScopedSchoolCache in this same file uses the same Promise-
   * storing pattern to dedupe the IEMIS-779-row stampede class; we use
   * it here for the analogous batch-render stampede class (e.g., finance
   * generating PDFs for a whole AY at once).
   *
   * Key uses the same `${tenantId}:${schoolId}:${docType}` shape as
   * `templateCache`. Cleared on settle (success OR rejection) so a
   * failed fetch doesn't pin the slot.
   */
  private readonly pendingPdfTemplateRequests = new Map<string, Promise<PdfTemplateCurrentResponse>>();

  // Timeout and retry configuration for permission checks
  private readonly REQUEST_TIMEOUT = 5000; // 5 seconds
  private readonly MAX_RETRIES = 2;
  private readonly BACKOFF_BASE = 100; // ms

  constructor(private readonly httpClient: HttpClientService) {
    // Use ECS Service Connect DNS name for internal service communication
    this.identityServiceUrl = process.env.IDENTITY_SERVICE_URL || 
      'http://identity-api.default.sc:3010';
    
    this.logger.log(`Identity Client initialized with URL: ${this.identityServiceUrl}`);
  }

  /**
   * Get the current PDF template for `(school, docType)`.
   *
   * **Sprint C.1.4** — cross-service helper consumed by render endpoints
   * (C.3.2 ReportCard in academics; C.1.5/C.1.6 invoice+receipt in finance
   * mirror this method). Wraps `GET /schools/:schoolId/pdf-templates/:docType/current`
   * on the identity service with:
   *   - **Per-process LRU cache** keyed `{tenantId}:{schoolId}:{docType}`,
   *     60s TTL, 100-entry cap. Identical config across tenants because
   *     the underlying templates change rarely (operator edits via C.2.x
   *     editor) and a 60s staleness window is acceptable trade for
   *     dropping N inter-service HTTPs per render to ~1.
   *   - **Graceful-degradation fallback** — on identity 5xx (or network
   *     failure), return `descriptor.defaults(fallbackArchetype, 'en-US')`
   *     so the calling render endpoint never 500s due to a template-fetch
   *     failure. PABSON tenants would temporarily see GENERIC defaults
   *     during an identity outage (English-only, gregorian dates); the
   *     caller can pass `fallbackArchetype: 'PABSON'` if it already knows
   *     the tenant archetype, preserving locale.
   *   - **4xx errors propagate** — 404 (unknown school), 403 (missing
   *     `pdf-templates:view`), 400 (unknown docType) are real client
   *     errors; we surface them upstream so the calling endpoint can
   *     translate to its own response envelope.
   *
   * @param options.fallbackArchetype — used only on identity 5xx (and only
   *   then). When omitted, defaults to `'GENERIC'`.
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

    // Cache hit within TTL — LRU touch on read (delete + re-set to move
    // the entry to the most-recently-used end of the insertion-ordered Map).
    const cached = this.templateCache.get(key);
    if (cached && now - cached.cachedAt < TEMPLATE_CACHE_TTL_MS) {
      this.templateCache.delete(key);
      this.templateCache.set(key, cached);
      this.logger.debug(
        `getCurrentTemplate: cache hit schoolId=${schoolId} docType=${docType} age=${now - cached.cachedAt}ms`,
      );
      return cached.response;
    }

    // Single-flight dedup — if another caller is already fetching this key,
    // await their result instead of firing a duplicate HTTP. Cleared on
    // settle below via `.finally`. (CodeRabbit Sprint C.1.4 fix.)
    const inFlight = this.pendingPdfTemplateRequests.get(key);
    if (inFlight) {
      this.logger.debug(
        `getCurrentTemplate: in-flight share schoolId=${schoolId} docType=${docType}`,
      );
      return inFlight;
    }

    // Fetch from identity. encodeURIComponent on each path segment is
    // defensive — schoolId is a UUID and docType is an enum string today,
    // both safe — but encoding fences against future reuse with untrusted
    // input that could otherwise smuggle `..%2F` path-traversal or break
    // routing. (CodeRabbit Sprint C.1.4 fix.)
    const url =
      `${this.identityServiceUrl}/schools/${encodeURIComponent(schoolId)}` +
      `/pdf-templates/${encodeURIComponent(docType)}/current`;
    const fetchPromise: Promise<PdfTemplateCurrentResponse> = (async () => {
      // Errors reject this promise and propagate to the outer catch (5xx
      // fallback + 4xx propagation) when it is awaited below.
      const response = await this.httpClient.get<PdfTemplateCurrentResponse>(
        url,
        {},
        context,
      );
      // **LRU refresh-order fix** — JS Map.set on an EXISTING key updates
      // the value but does NOT move the entry in insertion order. An
      // expired entry that gets refreshed would otherwise stay at its
      // original (now oldest) position and get evicted on the next
      // overflow sweep despite being just-fetched. Delete first to
      // force MRU placement on re-insert. (CodeRabbit Sprint C.1.4 fix.)
      this.templateCache.delete(key);
      this.templateCache.set(key, { response: response.data, cachedAt: now });
      // Evict oldest entries (insertion-order = LRU) while over cap.
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
    // Clear the slot on settle so a failed fetch doesn't pin in-flight state.
    // Uses `.then(cleanup, cleanup)` rather than `.finally()` because
    // `.finally()` re-throws the underlying rejection on its chained
    // promise — which would surface as an UnhandledPromiseRejection in
    // tests since this cleanup chain is not awaited. The two-arg `.then`
    // swallows both outcomes (cleanup is the same handler either way);
    // the original `fetchPromise` is still awaited below and its rejection
    // is caught by the outer try.
    const cleanup = () => {
      // Only delete if the slot still holds our promise — guards against
      // the unlikely case where another code path stored a newer promise
      // on the same key while this one was settling.
      if (this.pendingPdfTemplateRequests.get(key) === fetchPromise) {
        this.pendingPdfTemplateRequests.delete(key);
      }
    };
    void fetchPromise.then(cleanup, cleanup);

    try {
      return await fetchPromise;
    } catch (error: any) {
      const status = error?.response?.status;
      // 5xx (or network failure with no status code) → degrade gracefully.
      // 4xx is a real client error — propagate so the caller renders the
      // right diagnostic in its own response envelope.
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
   * defaults — used by `getCurrentTemplate`'s 5xx fallback path AND callable
   * by tests for assertion. Throws `ServiceUnavailableException` when the
   * requested `docType` isn't a known descriptor (unrecoverable — can't
   * synthesize a default for a type we don't know).
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

  /**
   * Test-only escape hatch — clears the template cache. Useful in jest
   * spec setup to avoid cross-test leakage. Not exposed via Nest DI.
   *
   * Sprint C.1.4.
   */
  _clearTemplateCacheForTest(): void {
    this.templateCache.clear();
  }

  /**
   * Get school by ID
   */
  async getSchool(schoolId: string, context: RequestContext): Promise<SchoolResponse> {
    const start = Date.now();
    this.logger.debug(`getSchool: schoolId=${schoolId}`);
    try {
      const response = await this.httpClient.get<SchoolResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        context
      );
      this.logger.debug(`getSchool: schoolId=${schoolId} status=200 ${Date.now() - start}ms`);
      return response.data;
    } catch (error: any) {
      this.logger.debug(`getSchool: schoolId=${schoolId} status=${error.response?.status || 'ERR'} ${Date.now() - start}ms`);
      this.handleError(error, 'getSchool', schoolId);
      throw error;
    }
  }

  /**
   * Validate school exists
   */
  async validateSchoolExists(schoolId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.getSchool(schoolId, context);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get current academic year for a school
   */
  async getCurrentAcademicYear(schoolId: string, context: RequestContext): Promise<AcademicYearResponse | null> {
    const start = Date.now();
    this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId}`);
    try {
      const response = await this.httpClient.get<AcademicYearResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-years/current`,
        {},
        context
      );
      this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId} yearId=${response.data?.yearId} ${Date.now() - start}ms`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId} not found (404) ${Date.now() - start}ms`);
        return null;
      }
      this.handleError(error, 'getCurrentAcademicYear', schoolId);
      throw error;
    }
  }

  /**
   * Get all academic years for a school
   */
  async getAcademicYears(
    schoolId: string, 
    context: RequestContext
  ): Promise<AcademicYearResponse[]> {
    try {
      const response = await this.httpClient.get<{ items: AcademicYearResponse[] }>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-years`,
        {},
        context
      );
      return response.data.items;
    } catch (error: any) {
      this.handleError(error, 'getAcademicYears', schoolId);
      throw error;
    }
  }

  /**
   * Get staff member by ID
   */
  async getStaff(staffId: string, context: RequestContext): Promise<StaffResponse> {
    try {
      const response = await this.httpClient.get<StaffResponse>(
        `${this.identityServiceUrl}/staff/${staffId}`,
        {},
        context
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'getStaff', staffId);
    }
  }

  /**
   * Get staff member by email (User-to-Staff bridge)
   */
  async getStaffByEmail(email: string, context: RequestContext): Promise<StaffResponse | null> {
    try {
      const response = await this.httpClient.get<StaffResponse>(
        `${this.identityServiceUrl}/staff/by-email`,
        { params: { email } },
        context
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getStaffByEmail', email);
    }
  }

  /**
   * Get all staff for a school
   */
  async getSchoolStaff(
    schoolId: string,
    context: RequestContext,
    filters?: { role?: string; limit?: number },
  ): Promise<StaffListResponse> {
    try {
      const params: Record<string, any> = {};
      if (filters?.role) params.role = filters.role;
      if (filters?.limit) params.limit = filters.limit;

      const response = await this.httpClient.get<StaffListResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/staff`,
        { params },
        context
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'getSchoolStaff', schoolId);
    }
  }

  /**
   * Validate staff member exists
   */
  async validateStaffExists(staffId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.getStaff(staffId, context);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404 || error instanceof NotFoundException) {
        return false;
      }
      throw error;
    }
  }

  // ============================================
  // RBAC Permission Check
  // ============================================

  /**
   * Check if a user has permission for a specific resource:action at a school.
   * Calls the identity service's permission check endpoint.
   *
   * Fail-closed: if the identity service is unavailable, access is denied.
   *
   * @returns { allowed: boolean, reason?: string }
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const start = Date.now();
    this.logger.debug(`checkPermission: userId=${userId} ${resource}:${action} schoolId=${schoolId}`);
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.httpClient.post<{ allowed: boolean; reason?: string }>(
            `${this.identityServiceUrl}/users/${userId}/roles/permissions/check`,
            { resource, action, schoolId },
            {},
            context,
          ),
          this.timeoutPromise<never>(this.REQUEST_TIMEOUT),
        ]);
        this.logger.debug(
          `checkPermission: userId=${userId} ${resource}:${action} allowed=${response.data.allowed} attempt=${attempt} ${Date.now() - start}ms`,
        );
        return response.data;
      } catch (error: any) {
        if (attempt === this.MAX_RETRIES) {
          this.logger.error(
            `checkPermission FAILED after ${this.MAX_RETRIES + 1} attempts for ${userId}: ${resource}:${action} at ${schoolId} ${Date.now() - start}ms`,
            { error: error.message, status: error.response?.status },
          );
          return { allowed: false, reason: 'Permission check unavailable — access denied (fail-closed)' };
        }
        this.logger.debug(`checkPermission: retry attempt=${attempt + 1} for ${userId} ${resource}:${action}`);
        await this.sleep(this.BACKOFF_BASE * Math.pow(2, attempt));
      }
    }
    return { allowed: false, reason: 'Permission check unavailable' };
  }

  /**
   * Get a user's role at a specific school.
   * Used by DataScopeService to determine row-level access.
   *
   * @returns Role info with optional staffId, or null if no role found
   */
  async getUserRole(
    userId: string,
    schoolId: string,
    context: RequestContext,
    email?: string,
  ): Promise<{ role: string; staffId?: string } | null> {
    // Check cache first (avoids repeated Identity Service + staff email lookups)
    const cacheKey = `${userId}:${schoolId}`;
    const cached = this.roleCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
      this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} cache=HIT role=${cached.data?.role || 'null'}`);
      return cached.data;
    }

    const start = Date.now();
    this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} cache=MISS`);

    // Step 1: Fetch role from identity service
    let role: string;
    try {
      const response = await this.httpClient.get<{
        role: string;
        userId: string;
        schoolId: string;
        departmentId?: string;
      }>(
        `${this.identityServiceUrl}/users/${userId}/roles/${schoolId}`,
        {},
        context,
      );
      role = response.data.role;
      this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} role=${role} ${Date.now() - start}ms`);
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} no role (404) ${Date.now() - start}ms`);
        this.roleCache.set(cacheKey, { data: null, cachedAt: Date.now() });
        return null;
      }
      this.logger.error(`getUserRole HTTP failed for ${userId} at ${schoolId}: ${error.message} ${Date.now() - start}ms`);
      throw error;
    }

    // Step 2: For Teachers, resolve staffId via email lookup
    // If this fails, we still have the role — staffId stays undefined
    // DataScopeService will assign empty scope for Teacher without staffId
    let staffId: string | undefined;
    if (role === 'Teacher' && email) {
      try {
        const staff = await this.getStaffByEmail(email, context);
        staffId = staff?.staffId;
      } catch (error: any) {
        this.logger.warn(`Staff lookup failed for Teacher ${userId} (${email}): ${error.message}`);
        // staffId stays undefined → DataScopeService returns empty Teacher scope
      }
      if (!staffId) {
        this.logger.warn(`Teacher ${userId} has no staffId for email ${email}`);
      }
    }

    const result = { role, staffId };
    this.roleCache.set(cacheKey, { data: result, cachedAt: Date.now() });
    return result;
  }

  /**
   * Invalidate cached role for a specific user at a school.
   * Called when a user's role changes (e.g., SchoolRoleChanged event).
   */
  invalidateRoleCache(userId: string, schoolId: string): void {
    const key = `${userId}:${schoolId}`;
    this.roleCache.delete(key);
    this.logger.debug(`Role cache invalidated for ${key}`);
  }

  // ============================================
  // Feature flags (S0.6)
  // ============================================

  /**
   * Resolve the feature-flag map for a tenant by calling the identity
   * service's `GET /tenants/my/settings` endpoint. 30-second in-memory
   * cache keeps flag reads cheap on hot paths (e.g., per-row branching
   * inside a bulk import) while keeping flag flips rolling-reversible
   * within half a minute.
   *
   * Returns `null` if the identity call fails. Callers should treat null
   * as "flag off" — fail-closed, never fail-open on a telemetry/perf feature.
   */
  private async getFeatureFlagsForTenant(
    tenantId: string,
    context: RequestContext,
  ): Promise<Record<string, boolean> | null> {
    const cached = this.featureFlagCache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < FEATURE_FLAG_CACHE_TTL_MS) {
      return cached.flags;
    }

    try {
      const response = await this.httpClient.get<WorkspaceSettingsForFlags>(
        `${this.identityServiceUrl}/tenants/my/settings`,
        {},
        context,
      );
      const flags = response.data.features ?? {};
      this.featureFlagCache.set(tenantId, { flags, cachedAt: Date.now() });
      return flags;
    } catch (error: any) {
      this.logger.warn(
        `getFeatureFlagsForTenant failed for ${tenantId} — returning null (flags treated as off): ${error.message}`,
      );
      // Do NOT cache failures — we want the next caller to retry.
      return null;
    }
  }

  /**
   * Returns true iff the given flag is explicitly set to true for this
   * tenant. Absent flag, missing settings, or identity-service failure all
   * resolve to false (fail-closed).
   */
  async isFeatureEnabled(
    tenantId: string,
    flagKey: FeatureFlagKey,
    context: RequestContext,
  ): Promise<boolean> {
    if (!FEATURE_FLAG_KEYS.includes(flagKey)) {
      // Defensive — TS already enforces this, but log if someone hands a
      // stringly-typed key through (e.g., from a config).
      this.logger.warn(`isFeatureEnabled called with unknown flag key: ${flagKey}`);
      return false;
    }

    const flags = await this.getFeatureFlagsForTenant(tenantId, context);
    return isFeatureEnabledPure(flags ?? undefined, flagKey);
  }

  /**
   * Drop the cached flag map for a tenant. Useful for tests and for any
   * in-process code that mutates the tenant's settings and wants the next
   * flag read to see the change immediately.
   */
  invalidateFeatureFlagCache(tenantId: string): void {
    this.featureFlagCache.delete(tenantId);
  }

  // ============================================
  // Master Schedule (Sprint 3)
  // ============================================

  /**
   * Get academic session by ID
   */
  async getAcademicSession(
    schoolId: string,
    sessionId: string,
    context: RequestContext,
  ): Promise<AcademicSessionResponse | null> {
    try {
      const response = await this.httpClient.get<AcademicSessionResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-sessions/${sessionId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getAcademicSession', sessionId);
    }
  }

  /**
   * Get class period by ID
   */
  async getClassPeriod(
    schoolId: string,
    periodId: string,
    context: RequestContext,
  ): Promise<ClassPeriodResponse | null> {
    try {
      const response = await this.httpClient.get<ClassPeriodResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/class-periods/${periodId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getClassPeriod', periodId);
    }
  }

  /**
   * Get location by ID
   */
  async getLocation(
    schoolId: string,
    locationId: string,
    context: RequestContext,
  ): Promise<LocationResponse | null> {
    try {
      const response = await this.httpClient.get<LocationResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/locations/${locationId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getLocation', locationId);
    }
  }

  // ============================================
  // School Configuration
  // ============================================

  /**
   * Get school configuration (hours, days, period duration)
   */
  async getSchoolConfiguration(
    schoolId: string,
    context: RequestContext,
  ): Promise<{ startTime?: string; endTime?: string; schoolDays?: number[]; periodDuration?: number; attendancePolicy?: AttendancePolicy } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/schools/${schoolId}/configuration`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getSchoolConfiguration', schoolId);
    }
  }

  // ============================================
  // Calendar (Sprint 5)
  // ============================================

  /**
   * Get calendar date info for a school on a specific date
   * Returns null if calendar date is not configured (graceful degradation)
   */
  async getCalendarDate(
    schoolId: string,
    date: string,
    context: RequestContext,
  ): Promise<CalendarDateResponse | null> {
    try {
      const response = await this.httpClient.get<CalendarDateResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/calendar-dates/${date}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getCalendarDate', `${schoolId}/${date}`);
    }
  }

  // ============================================
  // Portal Account Provisioning
  // ============================================

  /**
   * Create a parent portal account in the Identity service.
   * Creates Cognito user + DynamoDB record + 'Parent' SchoolRole.
   *
   * @returns The created parent account, or null if the user already exists (409)
   */
  async createParentAccount(
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      phone?: string;
      schoolId: string;
      studentId: string;
      guardianId?: string;
    },
    context: RequestContext,
  ): Promise<ParentAccountResponse | null> {
    try {
      const response = await this.httpClient.post<ParentAccountResponse>(
        `${this.identityServiceUrl}/users/parent-accounts`,
        dto,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        this.logger.log(`Parent account already exists for ${dto.email} — skipping`);
        return null;
      }
      this.logger.error(
        `Failed to create parent account for ${dto.email}: ${error.message}`,
        { status: error.response?.status },
      );
      throw error;
    }
  }

  /**
   * Create a student portal account in the Identity service.
   * Creates Cognito user + DynamoDB record + 'Student' SchoolRole.
   *
   * @returns The created student account, or null if the user already exists (409)
   */
  async createStudentAccount(
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      schoolId: string;
      studentId: string;
    },
    context: RequestContext,
  ): Promise<StudentAccountResponse | null> {
    try {
      const response = await this.httpClient.post<StudentAccountResponse>(
        `${this.identityServiceUrl}/users/student-accounts`,
        dto,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        this.logger.log(`Student account already exists for ${dto.email} — skipping`);
        return null;
      }
      this.logger.error(
        `Failed to create student account for ${dto.email}: ${error.message}`,
        { status: error.response?.status },
      );
      throw error;
    }
  }

  /**
   * Handle HTTP errors with proper logging and error transformation
   */
  private handleError(error: any, operation: string, resourceId: string): never {
    // Check for circuit breaker open
    if (error.isCircuitBreakerOpen) {
      this.logger.error(`Circuit breaker OPEN for Identity Service during ${operation}`, {
        operation,
        resourceId
      });
      throw new ServiceUnavailableException(
        'Identity service is temporarily unavailable. Please try again later.'
      );
    }

    // Check for 404 Not Found
    if (error.response?.status === 404) {
      throw new NotFoundException(`Resource not found: ${resourceId}`);
    }

    // Log and rethrow other errors
    this.logger.error(`Error in ${operation}: ${error.message}`, {
      operation,
      resourceId,
      status: error.response?.status,
      error: error.message
    });

    // For 5xx errors, wrap in ServiceUnavailableException
    if (error.response?.status >= 500) {
      throw new ServiceUnavailableException(
        'Identity service encountered an error. Please try again later.'
      );
    }

    // Network errors (DNS failure, connection refused, timeout) — no HTTP response
    if (!error.response) {
      throw new ServiceUnavailableException(
        'Identity service is unreachable. Please try again later.'
      );
    }

    throw error;
  }

  /** Returns a promise that rejects after the given timeout */
  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms),
    );
  }

  /** Sleep for the given duration */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}


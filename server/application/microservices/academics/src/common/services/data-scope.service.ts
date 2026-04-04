/**
 * Data Scope Service — Row-level security for ABAC
 *
 * Determines what data a user can access based on their school role.
 * Inspired by Ed-Fi Analytics Middle Tier data scope patterns:
 *
 *   - School scope: Principal, VicePrincipal, Staff, Counselor, Nurse, Accountant
 *     → can view all data within their school
 *   - Section scope: Teacher
 *     → can only view data for students in their assigned sections
 *   - Student scope: Parent (children), Student (self)
 *     → can only view data for specific student IDs
 *
 * Usage:
 *   const scope = await dataScopeService.resolveScope(userId, schoolId, context);
 *   if (scope.type === 'section') {
 *     // filter results to scope.studentIds
 *   }
 *
 * Design: Fail-closed by default — if scope resolution fails, access is denied.
 * Set DATA_SCOPE_FAIL_CLOSED=false to opt out (not recommended for production).
 */

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { IdentityClientService } from './identity-client.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import { RequestContext, GSIKeyBuilder } from '../entities';
import type { CourseSection } from '../entities/course.entity';
import type { SectionEnrollment } from '../entities/section-enrollment.entity';
import type { Student } from '../entities/student.entity';

/**
 * Data scope describing what rows a user can access
 */
export interface DataScope {
  /** Scope level: school (all data), section (teacher's students), student (specific IDs) */
  type: 'school' | 'section' | 'student';
  schoolId: string;
  /** Section IDs the user is assigned to (section scope) */
  sectionIds?: string[];
  /** Student IDs the user can access (section/student scope) */
  studentIds?: string[];
  /** The user's resolved role at this school */
  role?: string;
}

/** Roles that get full school-level data access */
const SCHOOL_SCOPE_ROLES = new Set([
  'Principal',
  'VicePrincipal',
  'Accountant',
  'Counselor',
  'Nurse',
  'Staff',
]);

/** Fail-closed by default; set to 'false' to opt out */
const FAIL_CLOSED = process.env.DATA_SCOPE_FAIL_CLOSED !== 'false';

/** Scope cache TTL: 5 minutes (matches permission cache) */
const SCOPE_CACHE_TTL_MS = parseInt(process.env.SCOPE_CACHE_TTL_MS || '300000', 10);
const SCOPE_CACHE_MAX_SIZE = 200;

interface ScopeCacheEntry {
  data: DataScope;
  cachedAt: number;
}

@Injectable()
export class DataScopeService {
  private readonly logger = new Logger(DataScopeService.name);

  /** In-memory cache: userId:schoolId → resolved DataScope */
  private readonly scopeCache = new Map<string, ScopeCacheEntry>();

  constructor(
    private readonly identityClient: IdentityClientService,
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Resolve the data scope for a user at a specific school.
   *
   * @param userId - The user whose scope to resolve
   * @param schoolId - The school context
   * @param context - Academics RequestContext (with email, jwtToken, etc.)
   * @returns DataScope describing what data the user can access
   */
  async resolveScope(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    const start = Date.now();

    // TenantAdmin sees everything
    if (context.role === 'TenantAdmin') {
      this.logger.debug(`resolveScope: userId=${userId} schoolId=${schoolId} role=TenantAdmin → school scope (bypass)`);
      return { type: 'school', schoolId, role: 'TenantAdmin' };
    }

    // Check scope cache
    const cacheKey = `${userId}:${schoolId}`;
    const cached = this.scopeCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SCOPE_CACHE_TTL_MS) {
      this.logger.debug(`resolveScope: userId=${userId} schoolId=${schoolId} cache=HIT type=${cached.data.type}`);
      return cached.data;
    }
    this.logger.debug(`resolveScope: userId=${userId} schoolId=${schoolId} cache=MISS`);

    try {
      // Build HTTP context for identity service calls
      const httpContext = {
        tenantId: context.tenantId,
        userId: context.userId,
        jwtToken: context.jwtToken,
        userRole: context.role,
      };

      // Look up the user's role at this school via identity service
      const roleResponse = await this.identityClient.getUserRole(
        userId, schoolId, httpContext, context.email,
      );

      if (!roleResponse) {
        // No role at this school — deny access (null means 404 from identity service)
        this.logger.warn(`No role found for user ${userId} at school ${schoolId} — denying access`);
        throw new ForbiddenException('No role found at this school');
      }

      const { role, staffId } = roleResponse;

      let scope: DataScope;

      // School-level roles: see all data in the school
      if (SCHOOL_SCOPE_ROLES.has(role)) {
        scope = { type: 'school', schoolId, role };
      } else if (role === 'Teacher') {
        // Teacher: section-scoped (see only their students)
        if (!staffId) {
          // Fail-closed: Teacher without staffId gets empty scope, not school-wide
          this.logger.warn(`Teacher ${userId} has no staffId — restricting to empty scope`);
          scope = { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };
        } else {
          scope = await this.resolveTeacherScope(staffId, schoolId, context);
        }
      } else if (role === 'Parent') {
        // Parent: student-scoped (see only their children's data)
        scope = await this.resolveParentScope(userId, schoolId, context);
      } else if (role === 'Student') {
        // Student: self-scoped (see only their own data)
        scope = await this.resolveStudentScope(userId, schoolId, context);
      } else {
        // Unknown role — fail-closed
        this.logger.warn(`Unknown role '${role}' for user ${userId} — denying access`);
        throw new ForbiddenException(`Role '${role}' does not have a defined data scope`);
      }

      this.logger.debug(
        `resolveScope: userId=${userId} schoolId=${schoolId} resolved type=${scope.type} role=${scope.role} ` +
        `sections=${scope.sectionIds?.length ?? 'n/a'} students=${scope.studentIds?.length ?? 'n/a'} ${Date.now() - start}ms`,
      );
      this.cacheScope(cacheKey, scope);
      return scope;
    } catch (error: any) {
      // Re-throw ForbiddenException directly (from null-role or inner scope checks)
      if (error instanceof ForbiddenException) {
        throw error;
      }

      // Configurable fail mode: fail-closed (default) throws 403, fail-open returns school scope
      if (FAIL_CLOSED) {
        this.logger.error(`Scope resolution failed for ${userId} at ${schoolId} (fail-closed): ${error.message}`);
        throw new ForbiddenException('Unable to resolve data scope — access denied');
      }
      // Fail-open (opt-in only): if scope resolution fails, default to school scope
      this.logger.error(`Scope resolution failed for ${userId} at ${schoolId} (fail-open): ${error.message}`);
      return { type: 'school', schoolId };
    }
  }

  /**
   * Resolve a teacher's section scope by looking up their assigned sections
   * and the students enrolled in those sections.
   *
   * Fail-closed: if DynamoDB queries fail, returns empty scope (not school-wide).
   */
  private async resolveTeacherScope(
    staffId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      // Query GSI1 for sections at this school, filter by teacher
      const sectionsResult = await this.dynamoDBClient.queryGSI<CourseSection>(
        client,
        'GSI1',
        GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        'SECTION#',
        'begins_with',
        'primaryTeacherId = :teacherId AND isActive = :isActive',
        { ':teacherId': staffId, ':isActive': true },
      );

      const sectionIds = sectionsResult.items.map(s => s.sectionId);

      if (sectionIds.length === 0) {
        this.logger.debug(`Teacher ${staffId} has no sections at school ${schoolId}`);
        return { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };
      }

      // Get enrolled students for all sections in parallel
      const studentIdSet = new Set<string>();
      const enrollmentResults = await Promise.all(
        sectionIds.map(sectionId =>
          this.dynamoDBClient.queryGSI<SectionEnrollment>(
            client,
            'GSI1',
            GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
            `SEC_ENROLL#${sectionId}#`,
            'begins_with',
            'isActive = :isActive',
            { ':isActive': true },
          ),
        ),
      );
      for (const result of enrollmentResults) {
        for (const enrollment of result.items) {
          if (enrollment.studentId) {
            studentIdSet.add(enrollment.studentId);
          }
        }
      }

      const studentIds = Array.from(studentIdSet);
      this.logger.debug(
        `Teacher ${staffId} scope: ${sectionIds.length} sections, ${studentIds.length} students`,
      );

      return {
        type: 'section',
        schoolId,
        sectionIds,
        studentIds,
        role: 'Teacher',
      };
    } catch (error: any) {
      // Fail-closed for Teachers: empty scope, NOT school-wide
      this.logger.error(`Teacher scope resolution failed for ${staffId}: ${error.message}`);
      return { type: 'section', schoolId, sectionIds: [], studentIds: [], role: 'Teacher' };
    }
  }

  /**
   * Resolve a parent's scope by finding students whose guardian records
   * have a matching userId.
   *
   * Queries all students at the school and filters for guardian.userId match.
   * Fail-closed: if resolution fails, returns empty student scope.
   */
  private async resolveParentScope(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      // Query students at this school via GSI1
      const studentsResult = await this.dynamoDBClient.queryGSI<Student>(
        client,
        'GSI1',
        GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        'STUDENT#',
        'begins_with',
        'entityType = :entityType',
        { ':entityType': 'STUDENT' },
        undefined,
        1000,
      );

      // Find students whose guardian list includes this userId
      const studentIds: string[] = [];
      for (const student of studentsResult.items) {
        if (student.guardians?.some(g => g.userId === userId)) {
          studentIds.push(student.studentId);
        }
      }

      this.logger.debug(
        `Parent ${userId} scope: ${studentIds.length} student(s) at school ${schoolId}`,
      );

      return { type: 'student', schoolId, studentIds, role: 'Parent' };
    } catch (error: any) {
      // Fail-closed: empty scope
      this.logger.error(`Parent scope resolution failed for ${userId}: ${error.message}`);
      return { type: 'student', schoolId, studentIds: [], role: 'Parent' };
    }
  }

  /**
   * Resolve a student's scope — they can only see their own data.
   *
   * Matches the logged-in user to a student record by:
   *   1. portalUserId === userId (direct link set during portal provisioning)
   *   2. email match (fallback for legacy records without portalUserId)
   *
   * Fail-closed: if resolution fails, returns empty student scope.
   */
  private async resolveStudentScope(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<DataScope> {
    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      const studentsResult = await this.dynamoDBClient.queryGSI<Student>(
        client,
        'GSI1',
        GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
        'STUDENT#',
        'begins_with',
        'entityType = :entityType',
        { ':entityType': 'STUDENT' },
        undefined,
        1000,
      );

      // Match by portalUserId (preferred) or email (fallback)
      const email = context.email;
      const studentIds: string[] = [];
      for (const student of studentsResult.items) {
        // Direct link: portalUserId was set during student portal provisioning
        if (student.portalUserId && student.portalUserId === userId) {
          studentIds.push(student.studentId);
          continue;
        }
        // Fallback: email match for records without portalUserId
        if (student.email && email && student.email.toLowerCase() === email.toLowerCase()) {
          studentIds.push(student.studentId);
        }
      }

      this.logger.debug(
        `Student ${userId} scope: ${studentIds.length} student record(s) at school ${schoolId}`,
      );

      return { type: 'student', schoolId, studentIds, role: 'Student' };
    } catch (error: any) {
      // Fail-closed: empty scope
      this.logger.error(`Student scope resolution failed for ${userId}: ${error.message}`);
      return { type: 'student', schoolId, studentIds: [], role: 'Student' };
    }
  }

  /**
   * Check if a specific student ID is within the user's data scope.
   */
  isStudentInScope(scope: DataScope, studentId: string): boolean {
    if (scope.type === 'school') return true;
    const inScope = scope.studentIds?.includes(studentId) ?? false;
    this.logger.debug(`isStudentInScope: studentId=${studentId} scopeType=${scope.type} result=${inScope}`);
    return inScope;
  }

  /**
   * Check if a specific section ID is within the user's data scope.
   */
  isSectionInScope(scope: DataScope, sectionId: string): boolean {
    if (scope.type === 'school') return true;
    if (scope.type === 'section') {
      return scope.sectionIds?.includes(sectionId) ?? false;
    }
    return false;
  }

  /**
   * Filter an array of items to only those within scope.
   * Items must have a studentId property.
   */
  filterByStudentScope<T extends { studentId?: string }>(scope: DataScope, items: T[]): T[] {
    if (scope.type === 'school') return items;
    if (!scope.studentIds || scope.studentIds.length === 0) return [];
    const studentIdSet = new Set(scope.studentIds);
    const filtered = items.filter(item => item.studentId && studentIdSet.has(item.studentId));
    this.logger.debug(`filterByStudentScope: input=${items.length} output=${filtered.length} scopeType=${scope.type}`);
    return filtered;
  }

  /**
   * Filter an array of items to only those sections within scope.
   * Items must have a sectionId property.
   */
  filterBySectionScope<T extends { sectionId?: string }>(scope: DataScope, items: T[]): T[] {
    if (scope.type === 'school') return items;
    if (!scope.sectionIds || scope.sectionIds.length === 0) return [];
    const sectionIdSet = new Set(scope.sectionIds);
    const filtered = items.filter(item => item.sectionId && sectionIdSet.has(item.sectionId));
    this.logger.debug(`filterBySectionScope: input=${items.length} output=${filtered.length} scopeType=${scope.type}`);
    return filtered;
  }

  /**
   * Cache a resolved scope with LRU eviction.
   */
  private cacheScope(key: string, scope: DataScope): void {
    if (this.scopeCache.size >= SCOPE_CACHE_MAX_SIZE) {
      const oldest = this.scopeCache.keys().next().value;
      if (oldest) this.scopeCache.delete(oldest);
    }
    this.scopeCache.set(key, { data: scope, cachedAt: Date.now() });
  }

  /**
   * Invalidate cached scope for a specific user at a school.
   * Called when a user's role changes (Task 6.2).
   */
  invalidateScope(userId: string, schoolId: string): void {
    const key = `${userId}:${schoolId}`;
    this.scopeCache.delete(key);
    this.logger.debug(`Scope cache invalidated for ${key}`);
  }
}

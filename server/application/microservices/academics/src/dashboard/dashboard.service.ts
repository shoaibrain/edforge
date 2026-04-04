/**
 * Dashboard Service
 *
 * Aggregates enrollment summary, active sections count, and
 * today's attendance into a single response with in-memory caching.
 *
 * Cache key includes tenantId for multi-tenant safety.
 * TTL: 60 seconds (matches attendance overview pattern).
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { DataScopeService } from '../common/services/data-scope.service';
import {
  GSIKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import { Enrollment } from '../common/entities/enrollment.entity';
import { CourseSection } from '../common/entities/course.entity';
import { SchoolAttendance } from '../common/entities/school-attendance.entity';
import {
  DashboardOverviewDto,
  DashboardEnrollmentSummary,
  DashboardAttendanceSummary,
} from './dashboard.dto';

// ============================================================================
// CACHE
// ============================================================================

const CACHE_TTL_MS = 60 * 1000; // 60 seconds

interface CacheEntry {
  data: DashboardOverviewDto;
  cachedAt: number;
}

/** In-memory cache keyed by tenantId:schoolId:academicYearId:date */
const overviewCache = new Map<string, CacheEntry>();

function getCacheKey(
  tenantId: string,
  schoolId: string,
  academicYearId: string,
  date: string,
): string {
  return `${tenantId}:${schoolId}:${academicYearId}:${date}`;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  async getOverview(
    schoolId: string,
    academicYearId: string,
    date: string,
    context: RequestContext,
  ): Promise<DashboardOverviewDto> {
    this.logger.debug(`getOverview: entry, schoolId=${schoolId}, academicYearId=${academicYearId}, date=${date}`);
    const cacheKey = getCacheKey(
      context.tenantId,
      schoolId,
      academicYearId,
      date,
    );

    // Check cache
    const cached = overviewCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      this.logger.debug(`getOverview: cache HIT for key=${cacheKey}`);
      return { ...cached.data, _cached: true };
    }
    this.logger.debug(`getOverview: cache MISS for key=${cacheKey}, running parallel sub-queries`);

    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    // Run all three queries in parallel
    const [enrollmentData, sectionsData, attendanceData] = await Promise.all([
      this.queryEnrollmentSummary(client, context, schoolId, academicYearId),
      this.queryActiveSectionsCount(client, context, schoolId),
      this.queryAttendanceSummary(client, context, schoolId, date, academicYearId),
    ]);

    const result: DashboardOverviewDto = {
      schoolId,
      academicYearId,
      date,
      enrollment: enrollmentData,
      activeSectionsCount: sectionsData,
      attendance: attendanceData,
      _cached: false,
    };

    // Store in cache
    overviewCache.set(cacheKey, { data: result, cachedAt: Date.now() });

    this.logger.debug(`getOverview: completed, totalEnrolled=${enrollmentData.totalEnrolled}, activeSections=${sectionsData}, attendanceRecorded=${attendanceData?.totalRecorded ?? 0}`);
    return result;
  }

  // --------------------------------------------------------------------------
  // Enrollment Summary (mirrors EnrollmentService.getEnrollmentSummary)
  // --------------------------------------------------------------------------

  private async queryEnrollmentSummary(
    client: any,
    context: RequestContext,
    schoolId: string,
    academicYearId: string,
  ): Promise<DashboardEnrollmentSummary> {
    try {
      const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);
      const skPrefix = `ENROLLMENT#${academicYearId}`;

      this.logger.debug(
        `queryEnrollmentSummary: querying GSI1PK=${gsi1pk}, SK_prefix=${skPrefix}`,
      );

      const result = await this.dynamoDBClient.queryGSI<Enrollment>(
        client,
        'GSI1',
        gsi1pk,
        skPrefix,
        'begins_with',
        'entityType = :entityType',
        { ':entityType': 'ENROLLMENT' },
        undefined,
        1000,
      );

      this.logger.debug(
        `queryEnrollmentSummary: returned ${result.items.length} enrollment items`,
      );

      const byGradeLevel: Record<string, number> = {};
      const byStatus: Record<string, number> = {
        enrolled: 0,
        pending: 0,
        withdrawn: 0,
        graduated: 0,
        transferred: 0,
      };

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      let recentEnrollments = 0;
      let recentWithdrawals = 0;

      for (const enrollment of result.items) {
        if (enrollment.status === 'enrolled') {
          byGradeLevel[enrollment.gradeLevel] =
            (byGradeLevel[enrollment.gradeLevel] || 0) + 1;
          if (enrollment.enrollmentDate >= thirtyDaysAgoStr) {
            recentEnrollments++;
          }
        }
        byStatus[enrollment.status] =
          (byStatus[enrollment.status] || 0) + 1;

        if (
          enrollment.status === 'withdrawn' &&
          enrollment.withdrawalDate &&
          enrollment.withdrawalDate >= thirtyDaysAgoStr
        ) {
          recentWithdrawals++;
        }
      }

      return {
        totalEnrolled: byStatus.enrolled,
        byGradeLevel,
        byStatus,
        recentEnrollments,
        recentWithdrawals,
      };
    } catch (error) {
      this.logger.error(
        `Enrollment summary failed for school=${schoolId} year=${academicYearId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        totalEnrolled: 0,
        byGradeLevel: {},
        byStatus: { enrolled: 0, pending: 0, withdrawn: 0, graduated: 0, transferred: 0 },
        recentEnrollments: 0,
        recentWithdrawals: 0,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Active Sections Count
  // --------------------------------------------------------------------------

  private async queryActiveSectionsCount(
    client: any,
    context: RequestContext,
    schoolId: string,
  ): Promise<number> {
    try {
      const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

      this.logger.debug(`queryActiveSectionsCount: querying GSI1PK=${gsi1pk}, SK_prefix=SECTION#`);

      let result = await this.dynamoDBClient.queryGSI<CourseSection>(
        client,
        'GSI1',
        gsi1pk,
        'SECTION#',
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true },
        undefined,
        1000,
      );

      // Resilience: if boolean filter returns 0, retry without filter
      // (handles DynamoDB string/boolean type mismatch for isActive field)
      if (result.items.length === 0) {
        this.logger.debug(
          'queryActiveSectionsCount: filtered query returned 0, retrying without isActive filter',
        );
        const unfilteredResult =
          await this.dynamoDBClient.queryGSI<CourseSection>(
            client,
            'GSI1',
            gsi1pk,
            'SECTION#',
            'begins_with',
            undefined,
            undefined,
            undefined,
            1000,
          );
        // Manually filter for active sections (handles boolean or string)
        result = {
          ...unfilteredResult,
          items: unfilteredResult.items.filter(
            (s: any) => s.isActive === true || s.isActive === 'true',
          ),
        };
        this.logger.debug(
          `queryActiveSectionsCount: unfiltered=${unfilteredResult.items.length} total, ${result.items.length} active after manual filter`,
        );
      } else {
        this.logger.debug(
          `queryActiveSectionsCount: returned ${result.items.length} active sections`,
        );
      }

      // Apply section scope for teachers (they only see their sections)
      const scope = await this.dataScopeService.resolveScope(
        context.userId,
        schoolId,
        context,
      );
      if (scope.type === 'section') {
        return result.items.filter((s) =>
          this.dataScopeService.isSectionInScope(scope, s.sectionId),
        ).length;
      }

      return result.items.length;
    } catch (error) {
      this.logger.error(
        `Sections count failed for school=${schoolId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  // --------------------------------------------------------------------------
  // Today's Attendance Summary (mirrors AttendanceService.getDailyAttendanceSummary)
  // --------------------------------------------------------------------------

  private async queryAttendanceSummary(
    client: any,
    context: RequestContext,
    schoolId: string,
    date: string,
    academicYearId: string,
  ): Promise<DashboardAttendanceSummary | null> {
    try {
      this.logger.debug(`queryAttendanceSummary: querying attendance for schoolId=${schoolId}, date=${date}`);
      // Query attendance records for this school+date via GSI3
      const result = await this.dynamoDBClient.queryGSI<SchoolAttendance>(
        client,
        'GSI3',
        GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
        'SCH_ATTEND#',
        'begins_with',
        undefined,
        undefined,
        undefined,
        1000,
      );

      // Row-level security
      const scope = await this.dataScopeService.resolveScope(
        context.userId,
        schoolId,
        context,
      );
      const scopedAttendance = this.dataScopeService.filterByStudentScope(
        scope,
        result.items,
      );

      // Get enrollment count for totalStudents denominator
      let totalStudents = scopedAttendance.length;
      try {
        const enrollmentResult = await this.dynamoDBClient.queryGSI<Enrollment>(
          client,
          'GSI1',
          GSIKeyBuilder.schoolScope(context.tenantId, schoolId),
          `ENROLLMENT#${academicYearId}`,
          'begins_with',
          'entityType = :entityType AND #status = :enrolled',
          { ':entityType': 'ENROLLMENT', ':enrolled': 'enrolled' },
          { '#status': 'status' },
          1000,
        );
        const scopedEnrollments = this.dataScopeService.filterByStudentScope(
          scope,
          enrollmentResult.items,
        );
        if (scopedEnrollments.length > 0) {
          totalStudents = scopedEnrollments.length;
        }
      } catch {
        // Fall back to attendance record count
      }

      const summary: DashboardAttendanceSummary = {
        date,
        totalStudents,
        totalRecorded: scopedAttendance.length,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        halfDay: 0,
        remote: 0,
        attendanceRate: 0,
      };

      for (const record of scopedAttendance) {
        const status = (record.status || '').toLowerCase();
        if (status === 'present') summary.present++;
        else if (status === 'absent') summary.absent++;
        else if (status === 'late' || status === 'tardy') summary.late++;
        else if (status === 'excused') summary.excused++;
        else if (status === 'half_day' || status === 'half-day') summary.halfDay++;
        else if (status === 'remote') summary.remote++;
        else summary.present++; // Default unknown to present
      }

      // Attendance rate = (present + late + remote + excused) / totalStudents
      const attendingCount =
        summary.present + summary.late + summary.remote + summary.excused;
      summary.attendanceRate =
        totalStudents > 0
          ? Math.round((attendingCount / totalStudents) * 10000) / 100
          : 0;

      this.logger.debug(`queryAttendanceSummary: totalStudents=${totalStudents}, totalRecorded=${scopedAttendance.length}, attendanceRate=${summary.attendanceRate}%`);
      return summary;
    } catch (error) {
      this.logger.error(
        `Attendance summary failed for school=${schoolId} date=${date}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}

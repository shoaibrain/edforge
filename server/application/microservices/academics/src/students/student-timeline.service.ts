/**
 * StudentTimelineService — Sprint D.2.11
 *
 * `GET /academics/students/{studentId}/timeline` — returns every
 * enrollment for a student across all academic years, sorted by AY,
 * with optional denormalized AY metadata.
 *
 * **Invariant 3 guarantees:**
 *   - Every row in the response carries its own `enrollmentId`. Spec
 *     asserts cross-AY enrollmentId distinctness.
 *   - `priorEnrollmentId` is included when set (provisional / post-flip
 *     rows from D.2.6 commit), enabling client-side chain reconstruction.
 *
 * **Sort:** ascending by `academicYearId` (best-effort lex sort). When
 * the operator provides date-range filters, we filter post-fetch.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.11
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { Enrollment } from '../common/entities/enrollment.entity';
import { RequestContext } from '../common/entities/base.entity';
import { enrollmentEntityToDto } from '../common/mappers/enrollment.mapper';
import type { EnrollmentResponseDto } from '@aibrains/shared-types';

export interface StudentTimelineParams {
  studentId: string;
  fromAyId?: string;
  toAyId?: string;
  limit?: number;
}

export interface StudentTimelineRow {
  enrollment: EnrollmentResponseDto;
  academicYearLabel?: string;
  academicYearStartDate?: string;
  academicYearEndDate?: string;
}

export interface StudentTimelineResponse {
  studentId: string;
  enrollments: StudentTimelineRow[];
  total: number;
}

@Injectable()
export class StudentTimelineService {
  private readonly logger = new Logger(StudentTimelineService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * GSI2 (student-centric) query for every enrollment under this studentId.
   * Sorted by `academicYearId` ascending. Optionally denormalized with AY
   * metadata from identity service (best-effort; failures degrade to
   * undefined fields, not 5xx).
   */
  async getTimeline(
    params: StudentTimelineParams,
    context: RequestContext,
  ): Promise<StudentTimelineResponse> {
    const { studentId, fromAyId, toAyId, limit = 50 } = params;
    this.logger.debug(
      `getTimeline: entry studentId=${studentId} fromAyId=${fromAyId ?? '*'} toAyId=${toAyId ?? '*'} limit=${limit}`,
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // GSI2: gsi2pk = studentId, gsi2sk = ENROLLMENT#{yearId}
    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI2',
      studentId,
      'ENROLLMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      Math.min(limit * 4, 200), // small over-fetch to accommodate filter
    );

    let items = result.items;
    if (fromAyId || toAyId) {
      items = items.filter((e) => {
        if (fromAyId && e.academicYearId < fromAyId) return false;
        if (toAyId && e.academicYearId > toAyId) return false;
        return true;
      });
    }

    // Sort ascending by AY; stable on enrollmentId for tie-breaking.
    items.sort((a, b) => {
      const ayCmp = a.academicYearId.localeCompare(b.academicYearId);
      if (ayCmp !== 0) return ayCmp;
      return a.enrollmentId.localeCompare(b.enrollmentId);
    });

    items = items.slice(0, limit);

    // Best-effort AY metadata denormalization. We pull all years for the
    // first row's schoolId (a student typically belongs to one school in
    // the V1 PABSON model); if multiple schools appear, the helper just
    // omits the metadata for non-matching rows.
    const ayMetadataByYearId = await this.fetchAyMetadata(items, context);

    const enrollments: StudentTimelineRow[] = items.map((e) => {
      const meta = ayMetadataByYearId.get(e.academicYearId);
      return {
        enrollment: enrollmentEntityToDto(e),
        academicYearLabel: meta?.name,
        academicYearStartDate: meta?.startDate,
        academicYearEndDate: meta?.endDate,
      };
    });

    return {
      studentId,
      enrollments,
      total: enrollments.length,
    };
  }

  /**
   * Best-effort AY metadata fetch. Returns empty map on any failure.
   * Single getAcademicYears call per unique schoolId in the cohort.
   */
  private async fetchAyMetadata(
    enrollments: Enrollment[],
    context: RequestContext,
  ): Promise<Map<string, { name: string; startDate: string; endDate: string }>> {
    const out = new Map<string, { name: string; startDate: string; endDate: string }>();
    const schoolIds = new Set(enrollments.map((e) => e.schoolId));
    for (const schoolId of schoolIds) {
      try {
        const years = await this.identityClient.getAcademicYears(schoolId, context);
        for (const y of years) {
          out.set(y.yearId, {
            name: y.name,
            startDate: y.startDate,
            endDate: y.endDate,
          });
        }
      } catch (err: unknown) {
        // Degrade silently — operator still sees the enrollment rows with
        // the IDs; the AY label is a nice-to-have.
        this.logger.warn(
          `fetchAyMetadata: getAcademicYears failed for schoolId=${schoolId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return out;
  }
}

/**
 * School Years Service - Tenant-wide school year aggregation
 * 
 * Provides a tenant-level view of academic years across all schools.
 * Used by frontend Shell context for initial data loading.
 */

import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicYear } from '../common/entities/academic-year.entity';
import { School } from '../common/entities/school.entity';
import {
  RequestContext,
} from '../common/entities/base.entity';
import type {
  SchoolYearResponseDto,
  SchoolYearListResponseDto,
} from '@aibrains/shared-types';

@Injectable()
export class SchoolYearsService {
  private readonly logger = new Logger(SchoolYearsService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * List all school years across all schools for a tenant
   * GET /school-years?tenantId=
   */
  async listSchoolYears(
    context: RequestContext,
    tenantId?: string
  ): Promise<SchoolYearListResponseDto> {
    const targetTenantId = tenantId || context.tenantId;
    const client = await this.dynamoDBClient.getClient(targetTenantId, context.jwtToken);

    // First, get all schools for the tenant
    const schoolsResult = await this.dynamoDBClient.query<School>(
      client,
      targetTenantId,
      'SCHOOL#',
      'entityType = :entityType',
      { ':entityType': 'SCHOOL' },
      undefined,
      100
    );

    const allSchoolYears: SchoolYearResponseDto[] = [];
    const schoolNameMap = new Map<string, string>();

    // Build school name lookup map
    for (const school of schoolsResult.items) {
      schoolNameMap.set(school.schoolId, school.name);
    }

    // Get academic years for each school
    for (const school of schoolsResult.items) {
      const yearsResult = await this.dynamoDBClient.query<AcademicYear>(
        client,
        targetTenantId,
        `SCHOOL#${school.schoolId}#YEAR#`,
        'entityType = :entityType',
        { ':entityType': 'ACADEMIC_YEAR' },
        undefined,
        50
      );

      for (const year of yearsResult.items) {
        allSchoolYears.push(this.toSchoolYearResponse(year, schoolNameMap));
      }
    }

    // Sort by startDate descending (most recent first)
    allSchoolYears.sort((a, b) => 
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    this.logger.log(`Listed ${allSchoolYears.length} school years for tenant ${targetTenantId}`);

    return {
      items: allSchoolYears,
      total: allSchoolYears.length,
    };
  }

  /**
   * Get the current school year(s) for a tenant
   * GET /school-years/current?tenantId=
   * 
   * Returns the current academic year for each school.
   * If a user has a defaultSchoolId, that school's current year is returned first.
   */
  async getCurrentSchoolYear(
    context: RequestContext,
    tenantId?: string,
    defaultSchoolId?: string
  ): Promise<SchoolYearResponseDto | null> {
    const schoolYears = await this.listSchoolYears(context, tenantId);
    
    // Filter to only current years
    const currentYears = schoolYears.items.filter(y => y.isCurrent);

    if (currentYears.length === 0) {
      return null;
    }

    // If defaultSchoolId is provided, prioritize that school's current year
    if (defaultSchoolId) {
      const defaultYear = currentYears.find(y => y.schoolId === defaultSchoolId);
      if (defaultYear) {
        return defaultYear;
      }
    }

    // Return the first current year (most recently started)
    return currentYears[0];
  }

  /**
   * Get all current school years for a tenant
   * Returns current years for all schools
   */
  async getAllCurrentSchoolYears(
    context: RequestContext,
    tenantId?: string
  ): Promise<SchoolYearResponseDto[]> {
    const schoolYears = await this.listSchoolYears(context, tenantId);
    return schoolYears.items.filter(y => y.isCurrent);
  }

  /**
   * Map academic year entity to SchoolYearResponseDto
   */
  private toSchoolYearResponse(
    year: AcademicYear,
    schoolNameMap: Map<string, string>
  ): SchoolYearResponseDto {
    return {
      yearId: year.yearId,
      schoolId: year.schoolId,
      schoolName: schoolNameMap.get(year.schoolId) || year.schoolId,
      name: year.name,
      shortName: year.shortName,
      startDate: year.startDate,
      endDate: year.endDate,
      status: year.status,
      isCurrent: year.isCurrent,
      calendarType: year.calendarType,
      createdAt: year.createdAt,
      updatedAt: year.updatedAt,
    };
  }
}

/**
 * School Years Service - Tenant-wide school year aggregation
 * 
 * Provides a tenant-level view of academic years across all schools.
 * Used by frontend Shell context for initial data loading.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicYear } from '../common/entities/academic-year.entity';
import { School } from '../common/entities/school.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';

/**
 * School Year Response DTO - Frontend-friendly format
 */
export interface SchoolYearDto {
  yearId: string;
  schoolId: string;
  schoolName: string;
  name: string;
  shortName?: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
  calendarType: 'semester' | 'quarter' | 'trimester';
  createdAt: string;
  updatedAt: string;
}

/**
 * School Years List Response DTO
 */
export interface SchoolYearsListDto {
  items: SchoolYearDto[];
  total: number;
}

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
  ): Promise<SchoolYearsListDto> {
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

    const allSchoolYears: SchoolYearDto[] = [];
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
        allSchoolYears.push({
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
        });
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
  ): Promise<SchoolYearDto | null> {
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
  ): Promise<SchoolYearDto[]> {
    const schoolYears = await this.listSchoolYears(context, tenantId);
    return schoolYears.items.filter(y => y.isCurrent);
  }
}


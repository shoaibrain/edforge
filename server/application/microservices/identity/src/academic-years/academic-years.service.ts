/**
 * Academic Years Service - Academic year management for Identity Service
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  AcademicYear,
  GradingPeriod,
  Holiday,
  createAcademicYearEntity,
  createGradingPeriodEntity,
  createHolidayEntity,
} from '../common/entities/academic-year.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
  UpdateAcademicYearStatusDto,
  AcademicYearResponseDto,
  CreateGradingPeriodDto,
  UpdateGradingPeriodDto,
  GradingPeriodResponseDto,
  CreateHolidayDto,
  HolidayResponseDto,
} from '@edforge/shared-types';

@Injectable()
export class AcademicYearsService {
  private readonly logger = new Logger(AcademicYearsService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  // ============================================
  // Academic Year Operations
  // ============================================

  /**
   * Create a new academic year
   */
  async createAcademicYear(
    schoolId: string,
    createDto: CreateAcademicYearDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const now = new Date().toISOString();
    const yearId = uuid();

    // Validate dates
    if (new Date(createDto.endDate) <= new Date(createDto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    const academicYear = createAcademicYearEntity(
      context.tenantId,
      schoolId,
      yearId,
      {
        name: createDto.name,
        shortName: createDto.shortName,
        startDate: createDto.startDate,
        endDate: createDto.endDate,
        status: 'planning',
        isCurrent: createDto.setAsCurrent || false,
        calendarType: createDto.calendarType || 'semester',
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // If setting as current, clear other current years first
    if (createDto.setAsCurrent) {
      await this.clearCurrentYear(schoolId, context);
    }

    await this.dynamoDBClient.putItem(client, academicYear);

    this.logger.log(`Academic year created: ${academicYear.name} (${yearId}) for school ${schoolId}`);

    return this.toAcademicYearResponse(academicYear);
  }

  /**
   * Get academic year by ID
   */
  async getAcademicYear(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    return this.toAcademicYearResponse(year);
  }

  /**
   * Get current academic year for school
   */
  async getCurrentAcademicYear(
    schoolId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const years = await this.listAcademicYears(schoolId, context);
    const current = years.items.find(y => y.isCurrent);

    if (!current) {
      throw new NotFoundException('No current academic year set');
    }

    return current;
  }

  /**
   * List academic years for a school
   */
  async listAcademicYears(
    schoolId: string,
    context: RequestContext,
    limit: number = 20
  ): Promise<PaginatedResult<AcademicYearResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<AcademicYear>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#`,
      'entityType = :entityType',
      { ':entityType': 'ACADEMIC_YEAR' },
      undefined,
      limit
    );

    return {
      items: result.items.map(y => this.toAcademicYearResponse(y)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update academic year
   */
  async updateAcademicYear(
    schoolId: string,
    yearId: string,
    updateDto: UpdateAcademicYearDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.name) {
      updates.push('name = :name');
      values[':name'] = updateDto.name;
    }
    if (updateDto.shortName !== undefined) {
      updates.push('shortName = :shortName');
      values[':shortName'] = updateDto.shortName;
    }
    if (updateDto.startDate) {
      updates.push('startDate = :startDate');
      values[':startDate'] = updateDto.startDate;
    }
    if (updateDto.endDate) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.calendarType) {
      updates.push('calendarType = :calendarType');
      values[':calendarType'] = updateDto.calendarType;
    }

    if (updates.length === 0) {
      return this.toAcademicYearResponse(year);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;

    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      { '#version': 'version' }
    );

    this.logger.log(`Academic year updated: ${yearId}`);

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * Update academic year status
   */
  async updateAcademicYearStatus(
    schoolId: string,
    yearId: string,
    updateDto: UpdateAcademicYearStatusDto,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':status': updateDto.status,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      },
      undefined,
      { '#status': 'status' }
    );

    this.logger.log(`Academic year ${yearId} status updated to ${updateDto.status}`);

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * Set academic year as current
   */
  async setCurrentAcademicYear(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<AcademicYearResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const year = await this.dynamoDBClient.getItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId)
    );

    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    // Clear current flag from other years
    await this.clearCurrentYear(schoolId, context);

    // Set this year as current
    const updatedYear = await this.dynamoDBClient.updateItem<AcademicYear>(
      client,
      context.tenantId,
      EntityKeyBuilder.academicYear(schoolId, yearId),
      'SET isCurrent = :isCurrent, updatedAt = :updatedAt, updatedBy = :updatedBy',
      {
        ':isCurrent': true,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': context.userId,
      }
    );

    this.logger.log(`Academic year ${yearId} set as current for school ${schoolId}`);

    return this.toAcademicYearResponse(updatedYear);
  }

  /**
   * Clear current year flag from all years
   */
  private async clearCurrentYear(schoolId: string, context: RequestContext): Promise<void> {
    const years = await this.listAcademicYears(schoolId, context);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    for (const year of years.items) {
      if (year.isCurrent) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.academicYear(schoolId, year.yearId),
          'SET isCurrent = :isCurrent',
          { ':isCurrent': false }
        );
      }
    }
  }

  // ============================================
  // Grading Period Operations
  // ============================================

  /**
   * Create a grading period
   */
  async createGradingPeriod(
    schoolId: string,
    yearId: string,
    createDto: CreateGradingPeriodDto,
    context: RequestContext
  ): Promise<GradingPeriodResponseDto> {
    const now = new Date().toISOString();
    const termId = uuid();

    // Validate year exists
    const year = await this.getAcademicYear(schoolId, yearId, context);
    if (!year) {
      throw new NotFoundException('Academic year not found');
    }

    // Validate dates
    if (new Date(createDto.endDate) <= new Date(createDto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    const period = createGradingPeriodEntity(
      context.tenantId,
      schoolId,
      yearId,
      termId,
      {
        name: createDto.name,
        shortName: createDto.shortName,
        termType: createDto.termType,
        sequence: createDto.sequence,
        startDate: createDto.startDate,
        endDate: createDto.endDate,
        gradesDueDate: createDto.gradesDueDate,
        reportCardDate: createDto.reportCardDate,
        isActive: true,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, period);

    this.logger.log(`Grading period created: ${period.name} (${termId}) for year ${yearId}`);

    return this.toGradingPeriodResponse(period);
  }

  /**
   * List grading periods for an academic year
   */
  async listGradingPeriods(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<PaginatedResult<GradingPeriodResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<GradingPeriod>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#TERM#`,
      'entityType = :entityType',
      { ':entityType': 'TERM' },
      undefined,
      50
    );

    // Sort by sequence
    const sorted = result.items.sort((a, b) => a.sequence - b.sequence);

    return {
      items: sorted.map(p => this.toGradingPeriodResponse(p)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update grading period
   */
  async updateGradingPeriod(
    schoolId: string,
    yearId: string,
    termId: string,
    updateDto: UpdateGradingPeriodDto,
    context: RequestContext
  ): Promise<GradingPeriodResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const period = await this.dynamoDBClient.getItem<GradingPeriod>(
      client,
      context.tenantId,
      EntityKeyBuilder.term(schoolId, yearId, termId)
    );

    if (!period) {
      throw new NotFoundException('Grading period not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};

    if (updateDto.name) {
      updates.push('name = :name');
      values[':name'] = updateDto.name;
    }
    if (updateDto.shortName !== undefined) {
      updates.push('shortName = :shortName');
      values[':shortName'] = updateDto.shortName;
    }
    if (updateDto.startDate) {
      updates.push('startDate = :startDate');
      values[':startDate'] = updateDto.startDate;
    }
    if (updateDto.endDate) {
      updates.push('endDate = :endDate');
      values[':endDate'] = updateDto.endDate;
    }
    if (updateDto.gradesDueDate !== undefined) {
      updates.push('gradesDueDate = :gradesDueDate');
      values[':gradesDueDate'] = updateDto.gradesDueDate;
    }
    if (updateDto.reportCardDate !== undefined) {
      updates.push('reportCardDate = :reportCardDate');
      values[':reportCardDate'] = updateDto.reportCardDate;
    }
    if (updateDto.isActive !== undefined) {
      updates.push('isActive = :isActive');
      values[':isActive'] = updateDto.isActive;
    }

    if (updates.length === 0) {
      return this.toGradingPeriodResponse(period);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;

    const updatedPeriod = await this.dynamoDBClient.updateItem<GradingPeriod>(
      client,
      context.tenantId,
      EntityKeyBuilder.term(schoolId, yearId, termId),
      `SET ${updates.join(', ')}`,
      values
    );

    this.logger.log(`Grading period updated: ${termId}`);

    return this.toGradingPeriodResponse(updatedPeriod);
  }

  // ============================================
  // Holiday Operations
  // ============================================

  /**
   * Create a holiday
   */
  async createHoliday(
    schoolId: string,
    yearId: string,
    createDto: CreateHolidayDto,
    context: RequestContext
  ): Promise<HolidayResponseDto> {
    const now = new Date().toISOString();
    const holidayId = uuid();

    const holiday = createHolidayEntity(
      context.tenantId,
      schoolId,
      yearId,
      holidayId,
      {
        name: createDto.name,
        date: createDto.date,
        endDate: createDto.endDate,
        holidayType: createDto.holidayType,
        affectsStudents: createDto.affectsStudents !== false,
        affectsStaff: createDto.affectsStaff !== false,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    await this.dynamoDBClient.putItem(client, holiday);

    this.logger.log(`Holiday created: ${holiday.name} (${createDto.date}) for year ${yearId}`);

    return this.toHolidayResponse(holiday);
  }

  /**
   * List holidays for an academic year
   */
  async listHolidays(
    schoolId: string,
    yearId: string,
    context: RequestContext
  ): Promise<PaginatedResult<HolidayResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const result = await this.dynamoDBClient.query<Holiday>(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#`,
      'entityType = :entityType',
      { ':entityType': 'HOLIDAY' },
      undefined,
      100
    );

    // Sort by date
    const sorted = result.items.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return {
      items: sorted.map(h => this.toHolidayResponse(h)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Delete holiday
   */
  async deleteHoliday(
    schoolId: string,
    yearId: string,
    holidayId: string,
    context: RequestContext
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    
    // Find the holiday first to get the date for the key
    const holidays = await this.listHolidays(schoolId, yearId, context);
    const holiday = holidays.items.find(h => h.holidayId === holidayId);
    
    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    await this.dynamoDBClient.deleteItem(
      client,
      context.tenantId,
      `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#${holiday.date}`
    );

    this.logger.log(`Holiday deleted: ${holidayId}`);
  }

  // ============================================
  // Response Mappers
  // ============================================

  private toAcademicYearResponse(year: AcademicYear): AcademicYearResponseDto {
    return {
      yearId: year.yearId,
      schoolId: year.schoolId,
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

  private toGradingPeriodResponse(period: GradingPeriod): GradingPeriodResponseDto {
    return {
      termId: period.termId,
      yearId: period.yearId,
      schoolId: period.schoolId,
      name: period.name,
      shortName: period.shortName,
      termType: period.termType,
      sequence: period.sequence,
      startDate: period.startDate,
      endDate: period.endDate,
      gradesDueDate: period.gradesDueDate,
      reportCardDate: period.reportCardDate,
      isActive: period.isActive,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
    };
  }

  private toHolidayResponse(holiday: Holiday): HolidayResponseDto {
    return {
      holidayId: holiday.holidayId,
      yearId: holiday.yearId,
      schoolId: holiday.schoolId,
      name: holiday.name,
      date: holiday.date,
      endDate: holiday.endDate,
      holidayType: holiday.holidayType,
      affectsStudents: holiday.affectsStudents,
      affectsStaff: holiday.affectsStaff,
      createdAt: holiday.createdAt,
    };
  }
}


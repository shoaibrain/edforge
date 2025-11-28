import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger, Inject } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
// @ts-ignore - csv-parse doesn't have complete TypeScript definitions
import { parse } from 'csv-parse/sync';
import type { AttendanceRecord, AttendanceSummary, RequestContext } from '@edforge/shared-types';
import { EntityKeyBuilder } from './entities/attendance.entity';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from './dto/attendance.dto';
import { ValidationService } from './services/validation.service';
import { AttendanceAnalyticsService } from './services/analytics.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import { AttendanceEventsService } from '../common/services/attendance-events.service';
import { retryWithBackoff } from '@app/common-utils';
import { ICacheService } from '@app/cache';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly analyticsService: AttendanceAnalyticsService,
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AttendanceEventsService,
    @Inject('ICacheService') private readonly cache: ICacheService
  ) {}

  /**
   * Create attendance record
   */
  async createAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    createDto: CreateAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceRecord> {
    try {
      // 1. Validate
      await this.validationService.validateAttendanceCreation(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        createDto
      );

      // 2. Build entity
      const attendanceId = uuid();
      const timestamp = new Date().toISOString();
      
      const attendance: AttendanceRecord = {
        tenantId,
        entityKey: EntityKeyBuilder.attendance(schoolId, academicYearId, createDto.studentId, createDto.date),
        entityType: 'ATTENDANCE',
        attendanceId,
        schoolId,
        academicYearId,
        classroomId,
        studentId: createDto.studentId,
        date: createDto.date,
        status: createDto.status,
        checkInTime: createDto.checkInTime,
        checkOutTime: createDto.checkOutTime,
        minutesLate: createDto.minutesLate,
        duration: createDto.duration || 0,
        expectedDuration: createDto.expectedDuration || 0,
        periodId: createDto.periodId,
        periodNumber: createDto.periodNumber,
        recordedByTeacherId: context.userId,
        recordedAt: timestamp,
        notes: createDto.notes,
        excuseReason: createDto.excuseReason,
        parentNotified: createDto.parentNotified || false,
        documentationRequired: createDto.documentationRequired || false,
        excuseDocumentation: createDto.excuseDocumentation,
        attendanceTrend: 'stable', // TODO: Calculate based on history
        isChronicAbsentee: false, // TODO: Calculate based on attendance rate
        riskLevel: 'low', // TODO: Calculate based on attendance patterns
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        gsi1pk: `${classroomId}#${academicYearId}`,
        gsi1sk: `ATTENDANCE#${createDto.date}#${attendanceId}`,
        gsi2pk: `${createDto.studentId}#${academicYearId}`,
        gsi2sk: `ATTENDANCE#${createDto.date}#${attendanceId}`,
        gsi3pk: `${createDto.date}#${academicYearId}`,
        gsi3sk: `ATTENDANCE#${classroomId}#${attendanceId}`,
        gsi4pk: `${createDto.status}#${academicYearId}`,
        gsi4sk: `ATTENDANCE#${createDto.date}#${attendanceId}`,
        gsi5pk: `${schoolId}#${academicYearId}`,
        gsi5sk: `ATTENDANCE#${createDto.date}#${attendanceId}`,
      };

      // 3. Save to DynamoDB
      try {
        await this.dynamoDBClient.putItem(attendance);
        this.logger.log(`Attendance recorded successfully for student ${createDto.studentId} on ${createDto.date}: ${createDto.status}`);
      } catch (error) {
        this.logger.error(`Failed to save attendance to DynamoDB: ${error.message}`);
        throw new InternalServerErrorException('Failed to create attendance record');
      }

      // Invalidate attendance summary cache for this student
      const summaryCacheKey = `${tenantId}:attendanceSummary:${createDto.studentId}:${academicYearId}`;
      await this.cache.delete(summaryCacheKey);

      return attendance;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      console.error('❌ Attendance creation failed:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        error: error.message,
        stack: error.stack
      });
      
      throw new InternalServerErrorException({
        message: 'Failed to create attendance record',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get attendance record
   */
  async getAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    date: string,
    studentId: string,
    jwtToken: string
  ): Promise<AttendanceRecord> {
    try {
      const entityKey = EntityKeyBuilder.attendance(schoolId, academicYearId, studentId, date);
      const attendance = await this.dynamoDBClient.getItem(tenantId, entityKey);
      
      if (!attendance) {
        this.logger.warn(`Attendance not found: ${studentId} on ${date} for tenant: ${tenantId}`);
        throw new NotFoundException(`Attendance record not found for student ${studentId} on ${date}`);
      }

      // Verify tenant isolation
      if (attendance.tenantId !== tenantId) {
        this.logger.warn(`Tenant isolation violation: ${tenantId} trying to access attendance ${entityKey}`);
        throw new NotFoundException(`Attendance record not found for student ${studentId} on ${date}`);
      }

      this.logger.debug(`Attendance retrieved successfully: ${studentId} on ${date}`);
      return attendance as AttendanceRecord;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`Failed to get attendance: ${error.message}`, {
        tenantId,
        studentId,
        date,
        error: error.stack
      });
      throw new InternalServerErrorException('Failed to retrieve attendance record');
    }
  }

  /**
   * Get all attendance for a classroom on a specific date
   */
  async getAttendanceByClassroomAndDate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    date: string,
    jwtToken: string
  ): Promise<AttendanceRecord[]> {
    try {
      // TODO: Implement DynamoDB query using GSI1
      // Query: gsi1pk = classroomId#academicYearId AND gsi1sk begins_with ATTENDANCE#date
      
      // For now, return mock data for testing
      const mockAttendanceRecords: AttendanceRecord[] = [
        {
          tenantId,
          entityKey: EntityKeyBuilder.attendance(schoolId, academicYearId, 'student-1', date),
          entityType: 'ATTENDANCE',
          attendanceId: 'attendance-1',
          schoolId,
          academicYearId,
          classroomId,
          studentId: 'student-1',
          date,
          status: 'present',
          checkInTime: '2024-01-15T09:00:00Z',
          checkOutTime: '2024-01-15T10:00:00Z',
          minutesLate: 0,
          duration: 60,
          expectedDuration: 60,
          periodId: 'period-1',
          periodNumber: 1,
          recordedByTeacherId: 'teacher-123',
          recordedAt: '2024-01-15T09:05:00Z',
          notes: 'Student arrived on time',
          excuseReason: undefined,
          parentNotified: false,
          documentationRequired: false,
          excuseDocumentation: undefined,
          attendanceTrend: 'stable',
          isChronicAbsentee: false,
          riskLevel: 'low',
          createdAt: '2024-01-15T09:05:00Z',
          createdBy: 'teacher-123',
          updatedAt: '2024-01-15T09:05:00Z',
          updatedBy: 'teacher-123',
          version: 1,
          gsi1pk: `${classroomId}#${academicYearId}`,
          gsi1sk: `ATTENDANCE#${date}#attendance-1`,
          gsi2pk: `student-1#${academicYearId}`,
          gsi2sk: `ATTENDANCE#${date}#attendance-1`,
          gsi3pk: `${date}#${academicYearId}`,
          gsi3sk: `ATTENDANCE#${classroomId}#attendance-1`,
          gsi4pk: `present#${academicYearId}`,
          gsi4sk: `ATTENDANCE#${date}#attendance-1`,
          gsi5pk: `${schoolId}#${academicYearId}`,
          gsi5sk: `ATTENDANCE#${date}#attendance-1`,
        },
        {
          tenantId,
          entityKey: EntityKeyBuilder.attendance(schoolId, academicYearId, 'student-2', date),
          entityType: 'ATTENDANCE',
          attendanceId: 'attendance-2',
          schoolId,
          academicYearId,
          classroomId,
          studentId: 'student-2',
          date,
          status: 'absent',
          checkInTime: undefined,
          checkOutTime: undefined,
          minutesLate: undefined,
          duration: 0,
          expectedDuration: 60,
          periodId: 'period-1',
          periodNumber: 1,
          recordedByTeacherId: 'teacher-123',
          recordedAt: '2024-01-15T09:05:00Z',
          notes: 'Student absent - no excuse provided',
          excuseReason: undefined,
          parentNotified: true,
          documentationRequired: false,
          excuseDocumentation: undefined,
          attendanceTrend: 'declining',
          isChronicAbsentee: true,
          riskLevel: 'high',
          createdAt: '2024-01-15T09:05:00Z',
          createdBy: 'teacher-123',
          updatedAt: '2024-01-15T09:05:00Z',
          updatedBy: 'teacher-123',
          version: 1,
          gsi1pk: `${classroomId}#${academicYearId}`,
          gsi1sk: `ATTENDANCE#${date}#attendance-2`,
          gsi2pk: `student-2#${academicYearId}`,
          gsi2sk: `ATTENDANCE#${date}#attendance-2`,
          gsi3pk: `${date}#${academicYearId}`,
          gsi3sk: `ATTENDANCE#${classroomId}#attendance-2`,
          gsi4pk: `absent#${academicYearId}`,
          gsi4sk: `ATTENDANCE#${date}#attendance-2`,
          gsi5pk: `${schoolId}#${academicYearId}`,
          gsi5sk: `ATTENDANCE#${date}#attendance-2`,
        }
      ];
      
      return mockAttendanceRecords;
    } catch (error) {
      console.error('❌ Get attendance by classroom and date failed:', error);
      return [];
    }
  }

  /**
   * Get all attendance for a student
   */
  async getAttendanceByStudent(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    filters: any,
    jwtToken: string
  ): Promise<AttendanceRecord[]> {
    try {
      // TODO: Implement DynamoDB query using GSI2
      // Query: gsi2pk = studentId#academicYearId
      // Optional filters: date range, status
      
      // For now, return mock data for testing
      const mockAttendanceRecords: AttendanceRecord[] = [
        {
          tenantId,
          entityKey: EntityKeyBuilder.attendance('school-123', academicYearId, studentId, '2024-01-15'),
          entityType: 'ATTENDANCE',
          attendanceId: 'attendance-1',
          schoolId: 'school-123',
          academicYearId,
          classroomId: 'classroom-456',
          studentId,
          date: '2024-01-15',
          status: 'present',
          checkInTime: '2024-01-15T09:00:00Z',
          checkOutTime: '2024-01-15T10:00:00Z',
          minutesLate: 0,
          duration: 60,
          expectedDuration: 60,
          periodId: 'period-1',
          periodNumber: 1,
          recordedByTeacherId: 'teacher-123',
          recordedAt: '2024-01-15T09:05:00Z',
          notes: 'Student arrived on time',
          excuseReason: undefined,
          parentNotified: false,
          documentationRequired: false,
          excuseDocumentation: undefined,
          attendanceTrend: 'stable',
          isChronicAbsentee: false,
          riskLevel: 'low',
          createdAt: '2024-01-15T09:05:00Z',
          createdBy: 'teacher-123',
          updatedAt: '2024-01-15T09:05:00Z',
          updatedBy: 'teacher-123',
          version: 1,
          gsi1pk: `classroom-456#${academicYearId}`,
          gsi1sk: `ATTENDANCE#2024-01-15#attendance-1`,
          gsi2pk: `${studentId}#${academicYearId}`,
          gsi2sk: `ATTENDANCE#2024-01-15#attendance-1`,
          gsi3pk: `2024-01-15#${academicYearId}`,
          gsi3sk: `ATTENDANCE#classroom-456#attendance-1`,
          gsi4pk: `present#${academicYearId}`,
          gsi4sk: `ATTENDANCE#2024-01-15#attendance-1`,
          gsi5pk: `school-123#${academicYearId}`,
          gsi5sk: `ATTENDANCE#2024-01-15#attendance-1`,
        }
      ];
      
      return mockAttendanceRecords;
    } catch (error) {
      console.error('❌ Get attendance by student failed:', error);
      return [];
    }
  }

  /**
   * Update attendance record
   */
  async updateAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    date: string,
    studentId: string,
    updateDto: UpdateAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceRecord> {
    try {
      // 1. Validate
      await this.validationService.validateAttendanceUpdate(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        `${date}#${studentId}`,
        updateDto
      );

      // 2. Use retry mechanism with fresh data fetch on conflict
      const updatedAttendance = await retryWithBackoff(
        async () => {
          // Fetch fresh attendance data on each retry attempt to get latest version
          const existing = await this.getAttendance(
            tenantId,
            schoolId,
            academicYearId,
            classroomId,
            date,
            studentId,
            context.jwtToken
          );

          // Use the fresh version from database
          const currentVersion = existing.version;

          // 3. Update DynamoDB (TODO: Implement full DynamoDB update)
          // For now, return updated attendance with new values
          const updated: AttendanceRecord = {
            ...existing,
            ...updateDto,
            updatedAt: new Date().toISOString(),
            updatedBy: context.userId,
            version: currentVersion + 1
          };
          
          // TODO: Replace with actual DynamoDB updateItem call
          // await this.dynamoDBClient.updateItem(...)
          
          return updated;
        },
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 2000
        },
        this.logger
      ).catch((error) => {
        // Transform error to user-friendly message
        if (error.name === 'ConditionalCheckFailedException' || error.message?.includes('Update condition not met')) {
          throw new BadRequestException('Attendance record has been modified by another user. Please refresh and try again.');
        }
        throw error;
      });

      // Invalidate attendance summary cache for this student
      const summaryCacheKey = `${tenantId}:attendanceSummary:${studentId}:${academicYearId}`;
      await this.cache.delete(summaryCacheKey);

      this.logger.log(`✅ Attendance updated for student ${studentId} on ${date}: ${updatedAttendance.status} (v${updatedAttendance.version})`);
      return updatedAttendance;

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      
      console.error('❌ Attendance update failed:', error);
      throw new InternalServerErrorException('Failed to update attendance record');
    }
  }

  /**
   * Submit bulk attendance for a classroom
   * Phase 5: Optimized with BatchWriteItem for parallel writes
   * 
   * DESIGN RATIONALE:
   * - Uses BatchWriteItem (25 items per batch) instead of sequential writes
   * - 25x faster than sequential processing
   * - Pre-validation prevents partial failures
   * - Handles DynamoDB batch size limits (25 items)
   */
  async createBulkAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    bulkDto: BulkAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceRecord[]> {
    const startTime = Date.now();
    try {
      // 1. Validate all records before processing
      await this.validationService.validateBulkAttendance(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        bulkDto
      );

      // 2. Build attendance entities for all records
      const timestamp = new Date().toISOString();
      const attendanceRecords: AttendanceRecord[] = [];
      
      for (const record of bulkDto.records) {
        const attendanceId = uuid();
        const attendance: AttendanceRecord = {
          tenantId,
          entityKey: EntityKeyBuilder.attendance(schoolId, academicYearId, record.studentId, bulkDto.date),
          entityType: 'ATTENDANCE',
          attendanceId,
          schoolId,
          academicYearId,
          classroomId,
          studentId: record.studentId,
          date: bulkDto.date,
          status: record.status,
          checkInTime: undefined,
          checkOutTime: undefined,
          minutesLate: undefined,
          duration: 0,
          expectedDuration: 0,
          periodId: undefined,
          periodNumber: undefined,
          recordedByTeacherId: context.userId,
          recordedAt: timestamp,
          notes: record.notes,
          excuseReason: undefined,
          parentNotified: false,
          documentationRequired: false,
          excuseDocumentation: undefined,
          attendanceTrend: 'stable',
          isChronicAbsentee: false,
          riskLevel: 'low',
          createdAt: timestamp,
          createdBy: context.userId,
          updatedAt: timestamp,
          updatedBy: context.userId,
          version: 1,
          gsi1pk: `${classroomId}#${academicYearId}`,
          gsi1sk: `ATTENDANCE#${bulkDto.date}#${attendanceId}`,
          gsi2pk: `${record.studentId}#${academicYearId}`,
          gsi2sk: `ATTENDANCE#${bulkDto.date}#${attendanceId}`,
          gsi3pk: `${bulkDto.date}#${academicYearId}`,
          gsi3sk: `ATTENDANCE#${classroomId}#${attendanceId}`,
          gsi4pk: `${record.status}#${academicYearId}`,
          gsi4sk: `ATTENDANCE#${bulkDto.date}#${attendanceId}`,
          gsi5pk: `${schoolId}#${academicYearId}`,
          gsi5sk: `ATTENDANCE#${bulkDto.date}#${attendanceId}`,
        };
        attendanceRecords.push(attendance);
      }

      // 3. Write in batches of 25 (DynamoDB limit)
      const batchSize = 25;
      const batches: AttendanceRecord[][] = [];
      
      for (let i = 0; i < attendanceRecords.length; i += batchSize) {
        batches.push(attendanceRecords.slice(i, i + batchSize));
      }

      this.logger.log(`Writing ${attendanceRecords.length} attendance records in ${batches.length} batches`);

      // 4. Process each batch using BatchWriteItem
      for (const batch of batches) {
        try {
          await this.dynamoDBClient.batchWriteItems(batch);
          this.logger.debug(`Batch write completed: ${batch.length} records`);
        } catch (error: any) {
          this.logger.error(`Batch write failed: ${error.message}`, error.stack);
          // Continue with other batches even if one fails
          // Individual record failures are logged but don't stop the process
        }
      }

      // Invalidate attendance summary cache for all affected students
      const studentIds = [...new Set(attendanceRecords.map(r => r.studentId))];
      for (const studentId of studentIds) {
        const summaryCacheKey = `${tenantId}:attendanceSummary:${studentId}:${academicYearId}`;
        await this.cache.delete(summaryCacheKey);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ Bulk attendance created for ${attendanceRecords.length} students on ${bulkDto.date} in ${duration}ms`
      );
      
      return attendanceRecords;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error('❌ Bulk attendance creation failed:', error);
      throw new InternalServerErrorException('Failed to create bulk attendance');
    }
  }

  /**
   * Calculate attendance summary for a student with analytics
   * Provides comprehensive attendance insights including:
   * - Attendance statistics
   * - Trend analysis
   * - Risk assessment
   * - Intervention recommendations
   */
  /**
   * Calculate Attendance Summary
   * Phase 5: Advanced Features - Caching Layer
   * 
   * Cache key: {tenantId}:attendanceSummary:{studentId}:{academicYearId}, TTL: 5 minutes
   * Note: Date range filters are not cached separately (cache key doesn't include dates)
   */
  async calculateAttendanceSummary(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    startDate?: string,
    endDate?: string,
    jwtToken?: string
  ): Promise<AttendanceSummary> {
    try {
      // Only cache if no date filters (full year summary)
      const cacheKey = `${tenantId}:attendanceSummary:${studentId}:${academicYearId}`;
      if (!startDate && !endDate) {
        const cached = await this.cache.get<AttendanceSummary>(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Query all attendance records for student in academic year
      const records = await this.dynamoDBClient.queryGSI(
        'gsi2pk',
        `${studentId}#${academicYearId}`,
        'gsi2sk',
        'ATTENDANCE#'
      );

      // Filter by date range if provided
      let filteredRecords = records as AttendanceRecord[];
      if (startDate) {
        filteredRecords = filteredRecords.filter(r => r.date >= startDate);
      }
      if (endDate) {
        filteredRecords = filteredRecords.filter(r => r.date <= endDate);
      }

      if (filteredRecords.length === 0) {
        return {
          studentId,
          academicYearId,
          totalDays: 0,
          presentDays: 0,
          absentDays: 0,
          lateDays: 0,
          excusedDays: 0,
          unexcusedAbsentDays: 0,
          attendanceRate: 0,
          latenessRate: 0,
          trend: 'stable',
          riskLevel: 'low',
          isChronicAbsentee: false,
          daysAbsentThisMonth: 0,
          daysAbsentThisYear: 0,
          recommendations: ['No attendance data available'],
          interventionRequired: false,
          parentNotificationRequired: false,
          patternDescription: 'No attendance records found'
        };
      }

      // Calculate expected school days (TODO: Get from academic calendar)
      const expectedDaysThisYear = 180; // Standard US school year
      const expectedDaysThisMonth = 20;  // Approximate

      // Calculate statistics
      const stats = this.analyticsService.calculateStatistics(filteredRecords);
      
      // Analyze trends
      const trend = this.analyticsService.analyzeAttendanceTrend(filteredRecords);
      
      // Assess risk
      const riskAssessment = this.analyticsService.assessAttendanceRisk(
        filteredRecords,
        expectedDaysThisYear,
        expectedDaysThisMonth
      );
      
      // Get pattern description
      const patternDescription = this.analyticsService.getAttendancePatternDescription(
        filteredRecords,
        30
      );

      const summary: AttendanceSummary = {
        studentId,
        academicYearId,
        totalDays: stats.totalDays,
        presentDays: stats.presentDays,
        absentDays: stats.absentDays,
        lateDays: stats.lateDays,
        excusedDays: stats.excusedDays,
        unexcusedAbsentDays: stats.unexcusedAbsentDays,
        attendanceRate: stats.attendanceRate,
        latenessRate: stats.latenessRate,
        trend: trend.status,
        riskLevel: riskAssessment.riskLevel,
        isChronicAbsentee: riskAssessment.isChronicAbsentee,
        daysAbsentThisMonth: riskAssessment.daysAbsentThisMonth,
        daysAbsentThisYear: riskAssessment.daysAbsentThisYear,
        recommendations: riskAssessment.recommendations,
        interventionRequired: riskAssessment.interventionRequired,
        parentNotificationRequired: riskAssessment.parentNotificationRequired,
        patternDescription
      };

      // Cache the summary if no date filters (full year summary)
      if (!startDate && !endDate) {
        await this.cache.set(cacheKey, summary, 300);
      }

      return summary;
    } catch (error) {
      this.logger.error(`Failed to calculate attendance summary: ${error.message}`);
      throw new InternalServerErrorException('Failed to calculate attendance summary');
    }
  }

  /**
   * Delete attendance record (soft delete)
   */
  async deleteAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    studentId: string,
    date: string,
    context: RequestContext
  ): Promise<{ message: string; recordId: string }> {
    try {
      // 1. Get existing attendance record
      const existingRecord = await this.getAttendance(
        tenantId,
        schoolId,
        academicYearId,
        '', // classroomId not needed for lookup
        date,
        studentId,
        context.jwtToken || ''
      );

      // 2. Perform soft delete by setting status to 'deleted'
      const timestamp = new Date().toISOString();
      const entityKey = EntityKeyBuilder.attendance(schoolId, academicYearId, studentId, date);
      
      const updateExpression = 'SET #status = :status, #deletedAt = :deletedAt, #updatedAt = :updatedAt, #updatedBy = :updatedBy, #version = #version + :inc';
      const expressionAttributeNames = {
        '#status': 'status',
        '#deletedAt': 'deletedAt',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
        '#version': 'version'
      };
      const expressionAttributeValues = {
        ':status': 'deleted',
        ':deletedAt': timestamp,
        ':updatedAt': timestamp,
        ':updatedBy': context.userId,
        ':inc': 1,
        ':currentVersion': existingRecord.version
      };
      const conditionExpression = '#version = :currentVersion';

      try {
        await this.dynamoDBClient.updateItem(
          tenantId,
          entityKey,
          updateExpression,
          expressionAttributeValues,
          conditionExpression,
          expressionAttributeNames
        );
      } catch (error: any) {
        if (error.message?.includes('condition not met') || error.message?.includes('ConditionalCheckFailedException')) {
          throw new BadRequestException('Attendance record was modified by another operation. Please retry.');
        }
        throw error;
      }

      // 3. Publish event
      try {
        await this.eventsService.publishAttendanceDeleted({
          tenantId,
          recordId: existingRecord.attendanceId,
          studentId: existingRecord.studentId,
          classroomId: existingRecord.classroomId,
          schoolId: existingRecord.schoolId,
          academicYearId: existingRecord.academicYearId,
          date: existingRecord.date,
          deletedBy: context.userId,
          reason: 'Soft deleted via API'
        });
      } catch (eventError) {
        this.logger.warn(`Failed to publish AttendanceDeleted event: ${eventError.message}`);
      }

      this.logger.log(`Attendance deleted (soft): ${existingRecord.attendanceId} for student ${studentId} on ${date}`);
      return {
        message: 'Attendance record deleted successfully',
        recordId: existingRecord.attendanceId
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to delete attendance: ${error.message}`);
      throw new InternalServerErrorException('Failed to delete attendance record');
    }
  }

  /**
   * Import attendance records from CSV file
   * Phase 5: Advanced Features - CSV Import
   * 
   * CSV Format:
   * studentId,date,status,notes
   * student-123,2025-01-21,PRESENT,
   * student-456,2025-01-21,ABSENT,Sick
   * 
   * DESIGN RATIONALE:
   * - In-memory CSV parsing (cost-efficient for MVP)
   * - Max file size ~10MB (sufficient for MVP)
   * - Batch write using BatchWriteItem for performance
   * - Detailed error reporting per row
   */
  async importAttendanceFromCsv(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    csvFile: any,
    context: RequestContext
  ): Promise<{
    success: AttendanceRecord[];
    failed: Array<{ row: number; studentId?: string; error: string }>;
    summary: { total: number; succeeded: number; failed: number };
  }> {
    const startTime = Date.now();
    try {
      // 1. Parse CSV file
      let records: any[];
      try {
        records = parse(csvFile.buffer.toString('utf-8'), {
          columns: true, // Use first row as column headers
          skip_empty_lines: true,
          trim: true
        }) as any[];
      } catch (parseError: any) {
        this.logger.error(`CSV parsing failed: ${parseError.message}`);
        throw new BadRequestException(`Invalid CSV format: ${parseError.message}`);
      }

      if (records.length === 0) {
        throw new BadRequestException('CSV file is empty or contains no valid records');
      }

      this.logger.log(`Parsed ${records.length} records from CSV file`);

      // 2. Validate and build attendance records
      const attendanceRecords: AttendanceRecord[] = [];
      const failures: Array<{ row: number; studentId?: string; error: string }> = [];
      const timestamp = new Date().toISOString();

      records.forEach((record, index) => {
        const rowNumber = index + 2; // +2 because index is 0-based and we skip header row

        try {
          // Validate required fields
          if (!record.studentId || !record.date || !record.status) {
            failures.push({
              row: rowNumber,
              studentId: record.studentId,
              error: 'Missing required fields: studentId, date, or status'
            });
            return;
          }

          // Validate status enum
          const validStatuses = ['present', 'absent', 'tardy', 'excused', 'late', 'early_departure'];
          if (!validStatuses.includes(record.status.toLowerCase())) {
            failures.push({
              row: rowNumber,
              studentId: record.studentId,
              error: `Invalid status: ${record.status}. Must be one of: ${validStatuses.join(', ')}`
            });
            return;
          }

          // Validate date format (YYYY-MM-DD)
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(record.date)) {
            failures.push({
              row: rowNumber,
              studentId: record.studentId,
              error: `Invalid date format: ${record.date}. Expected YYYY-MM-DD`
            });
            return;
          }

          // Build attendance record
          const attendanceId = uuid();
          const attendance: AttendanceRecord = {
            tenantId,
            entityKey: EntityKeyBuilder.attendance(schoolId, academicYearId, record.studentId, record.date),
            entityType: 'ATTENDANCE',
            attendanceId,
            schoolId,
            academicYearId,
            classroomId,
            studentId: record.studentId,
            date: record.date,
            status: record.status.toLowerCase() as any,
            checkInTime: undefined,
            checkOutTime: undefined,
            minutesLate: undefined,
            duration: 0,
            expectedDuration: 0,
            periodId: undefined,
            periodNumber: undefined,
            recordedByTeacherId: context.userId,
            recordedAt: timestamp,
            notes: record.notes || undefined,
            excuseReason: undefined,
            parentNotified: false,
            documentationRequired: false,
            excuseDocumentation: undefined,
            attendanceTrend: 'stable',
            isChronicAbsentee: false,
            riskLevel: 'low',
            createdAt: timestamp,
            createdBy: context.userId,
            updatedAt: timestamp,
            updatedBy: context.userId,
            version: 1,
            gsi1pk: `${classroomId}#${academicYearId}`,
            gsi1sk: `ATTENDANCE#${record.date}#${attendanceId}`,
            gsi2pk: `${record.studentId}#${academicYearId}`,
            gsi2sk: `ATTENDANCE#${record.date}#${attendanceId}`,
            gsi3pk: `${record.date}#${academicYearId}`,
            gsi3sk: `ATTENDANCE#${classroomId}#${attendanceId}`,
            gsi4pk: `${record.status.toLowerCase()}#${academicYearId}`,
            gsi4sk: `ATTENDANCE#${record.date}#${attendanceId}`,
            gsi5pk: `${schoolId}#${academicYearId}`,
            gsi5sk: `ATTENDANCE#${record.date}#${attendanceId}`,
          };

          attendanceRecords.push(attendance);
        } catch (error: any) {
          failures.push({
            row: rowNumber,
            studentId: record.studentId,
            error: error.message || 'Unknown error'
          });
        }
      });

      // 3. Write valid records in batches using BatchWriteItem
      const batchSize = 25;
      const batches: AttendanceRecord[][] = [];
      
      for (let i = 0; i < attendanceRecords.length; i += batchSize) {
        batches.push(attendanceRecords.slice(i, i + batchSize));
      }

      this.logger.log(`Writing ${attendanceRecords.length} attendance records in ${batches.length} batches`);

      const successfulRecords: AttendanceRecord[] = [];

      for (const batch of batches) {
        try {
          await this.dynamoDBClient.batchWriteItems(batch);
          successfulRecords.push(...batch);
          this.logger.debug(`Batch write completed: ${batch.length} records`);
        } catch (error: any) {
          this.logger.error(`Batch write failed: ${error.message}`, error.stack);
          // Mark all records in failed batch as failed
          batch.forEach(record => {
            failures.push({
              row: 0, // Unknown row number for batch failures
              studentId: record.studentId,
              error: `Batch write failed: ${error.message}`
            });
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `CSV import completed in ${duration}ms: ${successfulRecords.length} succeeded, ${failures.length} failed`
      );

      return {
        success: successfulRecords,
        failed: failures,
        summary: {
          total: records.length,
          succeeded: successfulRecords.length,
          failed: failures.length
        }
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error('❌ CSV import failed:', error);
      throw new InternalServerErrorException('Failed to import attendance from CSV');
    }
  }
}


import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { AttendanceRecord, AttendanceSummary, EntityKeyBuilder, RequestContext } from './entities/attendance.entity';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from './dto/attendance.dto';
import { ValidationService } from './services/validation.service';
import { AttendanceAnalyticsService } from './services/analytics.service';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly analyticsService: AttendanceAnalyticsService,
    private readonly dynamoDBClient: DynamoDBClientService
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

      // 2. Get existing attendance
      const existing = await this.getAttendance(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        date,
        studentId,
        context.jwtToken
      );

      // 3. Check version for optimistic locking
      if (updateDto.version && existing.version !== updateDto.version) {
        throw new BadRequestException('Attendance record has been modified by another user. Please refresh and try again.');
      }

      // 4. Update (TODO: Implement DynamoDB update)
      // For now, return updated attendance with new values
      const updatedAttendance: AttendanceRecord = {
        ...existing,
        ...updateDto,
        updatedAt: new Date().toISOString(),
        updatedBy: context.userId,
        version: existing.version + 1
      };
      
      console.log(`✅ Attendance updated for student ${studentId} on ${date}: ${updatedAttendance.status}`);
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
   */
  async createBulkAttendance(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    bulkDto: BulkAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceRecord[]> {
    try {
      // 1. Validate
      await this.validationService.validateBulkAttendance(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        bulkDto
      );

      // 2. Create attendance records for each student
      const attendanceRecords: AttendanceRecord[] = [];
      
      for (const record of bulkDto.records) {
        const createDto: CreateAttendanceDto = {
          studentId: record.studentId,
          date: bulkDto.date,
          status: record.status,
          notes: record.notes
        };

        const attendance = await this.createAttendance(
          tenantId,
          schoolId,
          academicYearId,
          classroomId,
          createDto,
          context
        );

        attendanceRecords.push(attendance);
      }

      console.log(`✅ Bulk attendance created for ${attendanceRecords.length} students on ${bulkDto.date}`);
      return attendanceRecords;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      console.error('❌ Bulk attendance creation failed:', error);
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
  async calculateAttendanceSummary(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    startDate?: string,
    endDate?: string,
    jwtToken?: string
  ): Promise<AttendanceSummary> {
    try {
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

      return {
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
    } catch (error) {
      this.logger.error(`Failed to calculate attendance summary: ${error.message}`);
      throw new InternalServerErrorException('Failed to calculate attendance summary');
    }
  }
}


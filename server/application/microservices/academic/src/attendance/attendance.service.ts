import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { AttendanceRecord, AttendanceSummary, EntityKeyBuilder, RequestContext } from './entities/attendance.entity';
import { CreateAttendanceDto, UpdateAttendanceDto, BulkAttendanceDto } from './dto/attendance.dto';
import { ValidationService } from './services/validation.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly validationService: ValidationService
  ) {}

  private tableName: string = process.env.TABLE_NAME || 'ACADEMIC_TABLE';

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

      // 3. Save to DynamoDB (TODO: Add when DynamoDB is configured)
      // await this.saveToDynamoDB(attendance);

      console.log(`✅ Attendance recorded for student ${createDto.studentId} on ${createDto.date}: ${createDto.status}`);
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
    // TODO: Implement DynamoDB query
    throw new NotFoundException(`Attendance record not found for student ${studentId} on ${date}`);
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
    // TODO: Implement DynamoDB query using GSI1
    // Query: gsi1pk = classroomId#academicYearId#date
    return [];
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
    // TODO: Implement DynamoDB query using GSI3
    // Query: gsi3pk = studentId#academicYearId
    // Optional filters: date range, status
    return [];
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
      throw new Error('Update not implemented yet');

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
   * Calculate attendance summary for a student
   */
  async calculateAttendanceSummary(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    startDate?: string,
    endDate?: string,
    jwtToken?: string
  ): Promise<AttendanceSummary> {
    // TODO: Implement
    // 1. Get all attendance records for student in date range
    // 2. Calculate statistics
    // 3. Calculate consecutive absences
    
    return {
      studentId,
      totalDays: 0,
      presentDays: 0,
      absentDays: 0,
      tardyDays: 0,
      excusedDays: 0,
      attendanceRate: 0,
      consecutiveAbsences: 0
    };
  }
}


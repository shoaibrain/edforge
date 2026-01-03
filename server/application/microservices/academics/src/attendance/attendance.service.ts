/**
 * Attendance Service - Daily attendance tracking
 */

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { 
  Attendance, 
  createAttendanceEntity,
  AttendanceSummary,
} from '../common/entities/attendance.entity';
import { 
  EntityKeyBuilder, 
  GSIKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  RecordAttendanceDto,
  BulkAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
  BulkAttendanceResponseDto,
} from '../common/dto/attendance.dto';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Record attendance for a single student
   */
  async recordAttendance(
    recordDto: RecordAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const attendanceId = uuid();

    // Check if attendance already exists for this date
    const existing = await this.dynamoDBClient.getItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(recordDto.date, recordDto.studentId)
    );

    if (existing) {
      // Update existing record
      return this.updateAttendance(
        recordDto.date,
        recordDto.studentId,
        {
          status: recordDto.status,
          checkInTime: recordDto.checkInTime,
          checkOutTime: recordDto.checkOutTime,
          note: recordDto.note,
          reason: recordDto.reason,
          periodAttendance: recordDto.periodAttendance,
        },
        context
      );
    }

    const attendance = createAttendanceEntity(
      context.tenantId,
      attendanceId,
      recordDto.studentId,
      recordDto.schoolId,
      recordDto.date,
      {
        academicYearId: recordDto.academicYearId,
        status: recordDto.status,
        checkInTime: recordDto.checkInTime,
        checkOutTime: recordDto.checkOutTime,
        periodAttendance: recordDto.periodAttendance,
        note: recordDto.note,
        reason: recordDto.reason,
        recordedBy: context.userId,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      }
    );

    await this.dynamoDBClient.putItem(client, attendance);

    this.logger.log(`Attendance recorded: ${recordDto.studentId} on ${recordDto.date}`);

    return this.toAttendanceResponse(attendance);
  }

  /**
   * Record attendance in bulk (for a class/section)
   */
  async recordBulkAttendance(
    bulkDto: BulkAttendanceDto,
    context: RequestContext
  ): Promise<BulkAttendanceResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    
    const response: BulkAttendanceResponseDto = {
      date: bulkDto.date,
      schoolId: bulkDto.schoolId,
      processed: 0,
      created: 0,
      updated: 0,
      errors: [],
    };

    for (const record of bulkDto.records) {
      try {
        response.processed++;

        // Check for existing attendance
        const existing = await this.dynamoDBClient.getItem<Attendance>(
          client,
          context.tenantId,
          EntityKeyBuilder.attendance(bulkDto.date, record.studentId)
        );

        if (existing) {
          // Update existing
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            EntityKeyBuilder.attendance(bulkDto.date, record.studentId),
            'SET #status = :status, checkInTime = :checkInTime, note = :note, updatedAt = :updatedAt, updatedBy = :updatedBy',
            {
              ':status': record.status,
              ':checkInTime': record.checkInTime || null,
              ':note': record.note || null,
              ':updatedAt': now,
              ':updatedBy': context.userId,
            },
            undefined,
            { '#status': 'status' }
          );
          response.updated++;
        } else {
          // Create new
          const attendanceId = uuid();
          const attendance = createAttendanceEntity(
            context.tenantId,
            attendanceId,
            record.studentId,
            bulkDto.schoolId,
            bulkDto.date,
            {
              academicYearId: bulkDto.academicYearId,
              status: record.status,
              checkInTime: record.checkInTime,
              note: record.note,
              recordedBy: context.userId,
              createdAt: now,
              createdBy: context.userId,
              updatedAt: now,
              updatedBy: context.userId,
              version: 1,
            }
          );

          await this.dynamoDBClient.putItem(client, attendance);
          response.created++;
        }
      } catch (error: any) {
        response.errors.push({
          studentId: record.studentId,
          error: error.message,
        });
      }
    }

    this.logger.log(`Bulk attendance recorded: ${response.created} created, ${response.updated} updated for ${bulkDto.date}`);

    return response;
  }

  /**
   * Get attendance for a specific date
   */
  async getAttendanceByDate(
    schoolId: string,
    date: string,
    context: RequestContext,
    limit: number = 100
  ): Promise<PaginatedResult<AttendanceResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Attendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'ATTENDANCE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      limit
    );

    return {
      items: result.items.map(a => this.toAttendanceResponse(a)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get attendance for a student over date range
   */
  async getStudentAttendance(
    studentId: string,
    startDate: string,
    endDate: string,
    context: RequestContext
  ): Promise<AttendanceResponseDto[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Query by tenant + date range
    const result = await this.dynamoDBClient.query<Attendance>(
      client,
      context.tenantId,
      `ATTENDANCE#`,
      'studentId = :studentId AND #date BETWEEN :startDate AND :endDate',
      {
        ':studentId': studentId,
        ':startDate': startDate,
        ':endDate': endDate,
      },
      { '#date': 'date' },
      365  // Max 1 year
    );

    return result.items
      .filter(a => a.studentId === studentId)
      .map(a => this.toAttendanceResponse(a));
  }

  /**
   * Update attendance record
   */
  async updateAttendance(
    date: string,
    studentId: string,
    updateDto: UpdateAttendanceDto,
    context: RequestContext
  ): Promise<AttendanceResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const attendance = await this.dynamoDBClient.getItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(date, studentId)
    );

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    const updates: string[] = [];
    const values: Record<string, any> = {};
    const names: Record<string, string> = {};

    if (updateDto.status) {
      updates.push('#status = :status');
      values[':status'] = updateDto.status;
      names['#status'] = 'status';
    }

    if (updateDto.checkInTime !== undefined) {
      updates.push('checkInTime = :checkInTime');
      values[':checkInTime'] = updateDto.checkInTime;
    }

    if (updateDto.checkOutTime !== undefined) {
      updates.push('checkOutTime = :checkOutTime');
      values[':checkOutTime'] = updateDto.checkOutTime;
    }

    if (updateDto.note !== undefined) {
      updates.push('note = :note');
      values[':note'] = updateDto.note;
    }

    if (updateDto.reason !== undefined) {
      updates.push('reason = :reason');
      values[':reason'] = updateDto.reason;
    }

    if (updateDto.periodAttendance) {
      updates.push('periodAttendance = :periodAttendance');
      values[':periodAttendance'] = updateDto.periodAttendance;
    }

    if (updates.length === 0) {
      return this.toAttendanceResponse(attendance);
    }

    updates.push('updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#version = #version + :inc');
    values[':updatedAt'] = new Date().toISOString();
    values[':updatedBy'] = context.userId;
    values[':inc'] = 1;
    names['#version'] = 'version';

    const updatedAttendance = await this.dynamoDBClient.updateItem<Attendance>(
      client,
      context.tenantId,
      EntityKeyBuilder.attendance(date, studentId),
      `SET ${updates.join(', ')}`,
      values,
      undefined,
      names
    );

    this.logger.log(`Attendance updated: ${studentId} on ${date}`);

    return this.toAttendanceResponse(updatedAttendance);
  }

  /**
   * Get daily attendance summary for a school
   */
  async getDailyAttendanceSummary(
    schoolId: string,
    date: string,
    context: RequestContext
  ): Promise<DailyAttendanceSummaryDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.queryGSI<Attendance>(
      client,
      'GSI3',
      GSIKeyBuilder.attendanceDate(context.tenantId, schoolId, date),
      'ATTENDANCE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      1000
    );

    const summary: DailyAttendanceSummaryDto = {
      schoolId,
      date,
      totalStudents: result.items.length,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      halfDay: 0,
      attendanceRate: 0,
    };

    for (const attendance of result.items) {
      switch (attendance.status) {
        case 'present':
          summary.present++;
          break;
        case 'absent':
          summary.absent++;
          break;
        case 'late':
          summary.late++;
          break;
        case 'excused':
          summary.excused++;
          break;
        case 'half_day':
          summary.halfDay++;
          break;
      }
    }

    // Calculate attendance rate (present + late + half_day count as attending)
    const attending = summary.present + summary.late + summary.halfDay;
    summary.attendanceRate = summary.totalStudents > 0
      ? Math.round((attending / summary.totalStudents) * 100 * 100) / 100
      : 0;

    return summary;
  }

  /**
   * Get student attendance summary
   */
  async getStudentAttendanceSummary(
    studentId: string,
    schoolId: string,
    academicYearId: string,
    startDate: string,
    endDate: string,
    context: RequestContext
  ): Promise<StudentAttendanceSummaryDto> {
    const attendanceRecords = await this.getStudentAttendance(
      studentId,
      startDate,
      endDate,
      context
    );

    const summary: StudentAttendanceSummaryDto = {
      studentId,
      schoolId,
      academicYearId,
      dateRange: { start: startDate, end: endDate },
      totalDays: attendanceRecords.length,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      halfDay: 0,
      attendanceRate: 0,
    };

    for (const record of attendanceRecords) {
      switch (record.status) {
        case 'present':
          summary.present++;
          break;
        case 'absent':
          summary.absent++;
          break;
        case 'late':
          summary.late++;
          break;
        case 'excused':
          summary.excused++;
          break;
        case 'half_day':
          summary.halfDay++;
          break;
      }
    }

    const attending = summary.present + summary.late + summary.halfDay;
    summary.attendanceRate = summary.totalDays > 0
      ? Math.round((attending / summary.totalDays) * 100 * 100) / 100
      : 0;

    return summary;
  }

  /**
   * Convert Attendance entity to response DTO
   */
  private toAttendanceResponse(attendance: Attendance): AttendanceResponseDto {
    return {
      attendanceId: attendance.attendanceId,
      studentId: attendance.studentId,
      schoolId: attendance.schoolId,
      academicYearId: attendance.academicYearId,
      date: attendance.date,
      dayOfWeek: attendance.dayOfWeek,
      status: attendance.status,
      checkInTime: attendance.checkInTime,
      checkOutTime: attendance.checkOutTime,
      periodAttendance: attendance.periodAttendance,
      note: attendance.note,
      reason: attendance.reason,
      recordedBy: attendance.recordedBy,
      verifiedBy: attendance.verifiedBy,
      parentNotified: attendance.parentNotified,
      createdAt: attendance.createdAt,
      updatedAt: attendance.updatedAt,
    };
  }
}


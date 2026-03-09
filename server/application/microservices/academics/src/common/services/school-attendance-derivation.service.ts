/**
 * School Attendance Derivation Service
 *
 * Derives a single SchoolAttendance record (Ed-Fi: StudentSchoolAttendanceEvent)
 * from one or more SectionAttendance records for a given student+date.
 *
 * Derivation logic (worst-status-wins):
 *   absent in ANY section → absent
 *   late in ANY section → late
 *   all sections present → present
 *   excused → excused (only if all are excused)
 *
 * Called after section attendance is recorded/updated.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from './dynamodb-client.service';
import {
  SchoolAttendance,
  createSchoolAttendanceEntity,
} from '../entities/school-attendance.entity';
import { SectionAttendance } from '../entities/section-attendance.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  AttendanceStatus,
} from '../entities/base.entity';
import { v4 as uuid } from 'uuid';

@Injectable()
export class SchoolAttendancDerivationService {
  private readonly logger = new Logger(SchoolAttendancDerivationService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Derive school attendance from all section attendance records for a student on a date.
   * Called after recording/updating section attendance.
   *
   * @param tenantId - Tenant ID
   * @param studentId - Student ID
   * @param schoolId - School ID
   * @param date - Date (YYYY-MM-DD)
   * @param jwtToken - JWT for DynamoDB client
   * @param userId - User performing the action (for audit)
   */
  async deriveSchoolAttendance(
    tenantId: string,
    studentId: string,
    schoolId: string,
    date: string,
    jwtToken: string,
    userId: string,
  ): Promise<SchoolAttendance | null> {
    const client = await this.dynamoDBClient.getClient(tenantId, jwtToken);
    const now = new Date().toISOString();

    // 1. Query all section attendance records for this student on this date
    //    Using GSI3: PK=TENANT#{tid}#SCHOOL#{sid}#DATE#{date}, SK begins_with SEC_ATTEND#
    //    Then filter by studentId
    const gsi3pk = GSIKeyBuilder.attendanceDate(tenantId, schoolId, date);
    const sectionRecords = await this.dynamoDBClient.queryGSI<SectionAttendance>(
      client,
      'GSI3',
      gsi3pk,
      'SEC_ATTEND#',
      'begins_with',
      'studentId = :studentId',
      { ':studentId': studentId },
      undefined,
      100,
    );

    if (sectionRecords.items.length === 0) {
      // No section attendance → remove school attendance if it was derived
      await this.removeIfDerived(client, tenantId, studentId, date);
      return null;
    }

    // 2. Derive school-level status using worst-status-wins
    const derivedStatus = this.deriveStatus(sectionRecords.items);

    // 3. Check if school attendance already exists
    const existingKey = EntityKeyBuilder.schoolAttendance(date, studentId);
    const existing = await this.dynamoDBClient.getItem<SchoolAttendance>(
      client, tenantId, existingKey,
    );

    if (existing) {
      // Update existing — only if status changed or was derived
      if (existing.status === derivedStatus && existing.derivedFrom === 'section_attendance') {
        return existing; // No change needed
      }

      const updateExpr = 'SET #status = :status, derivedFrom = :derivedFrom, derivedAt = :derivedAt, updatedAt = :updatedAt, updatedBy = :updatedBy, #version = #version + :inc';
      const conditionExpr = '#version = :expectedVersion';
      try {
        const updatedRecord = await this.dynamoDBClient.updateItem<SchoolAttendance>(
          client,
          tenantId,
          existingKey,
          updateExpr,
          {
            ':status': derivedStatus,
            ':derivedFrom': 'section_attendance',
            ':derivedAt': now,
            ':updatedAt': now,
            ':updatedBy': userId,
            ':inc': 1,
            ':expectedVersion': existing.version ?? 0,
          },
          conditionExpr,
          { '#status': 'status', '#version': 'version' },
        );

        this.logger.debug(`School attendance updated (derived): ${studentId} on ${date} → ${derivedStatus}`);
        return updatedRecord;
      } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
          // Concurrent derivation — re-read and retry once
          this.logger.warn(`Concurrent derivation for ${studentId} on ${date}, retrying once`);
          const refreshed = await this.dynamoDBClient.getItem<SchoolAttendance>(client, tenantId, existingKey);
          if (refreshed && refreshed.status === derivedStatus && refreshed.derivedFrom === 'section_attendance') {
            return refreshed; // Other derivation already set the correct status
          }
          if (refreshed) {
            await this.dynamoDBClient.updateItem<SchoolAttendance>(
              client, tenantId, existingKey, updateExpr,
              {
                ':status': derivedStatus,
                ':derivedFrom': 'section_attendance',
                ':derivedAt': now,
                ':updatedAt': now,
                ':updatedBy': userId,
                ':inc': 1,
                ':expectedVersion': refreshed.version ?? 0,
              },
              conditionExpr,
              { '#status': 'status', '#version': 'version' },
            );
          }
          return refreshed;
        }
        throw error;
      }
    }

    // 4. Create new school attendance record
    const schoolAttendance = createSchoolAttendanceEntity(
      tenantId,
      uuid(),
      studentId,
      schoolId,
      date,
      {
        academicYearId: sectionRecords.items[0].academicYearId || '',
        status: derivedStatus,
        studentName: sectionRecords.items[0].studentName,
        derivedFrom: 'section_attendance',
        derivedAt: now,
        recordedBy: userId,
        createdAt: now,
        createdBy: userId,
        updatedAt: now,
        updatedBy: userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, schoolAttendance);
    this.logger.debug(`School attendance created (derived): ${studentId} on ${date} → ${derivedStatus}`);
    return schoolAttendance;
  }

  /**
   * Derive school-level status from section attendance records.
   * Worst-status-wins priority: absent > late > half_day > excused > present
   */
  private deriveStatus(records: SectionAttendance[]): AttendanceStatus {
    const statusPriority: Record<string, number> = {
      absent: 5,
      late: 4,
      tardy: 4,
      half_day: 3,
      early_departure: 3,
      excused: 2,
      remote: 1,
      present: 0,
    };

    let worstStatus: AttendanceStatus = 'present';
    let worstPriority = 0;

    for (const record of records) {
      const priority = statusPriority[record.status] ?? 0;
      if (priority > worstPriority) {
        worstPriority = priority;
        worstStatus = record.status;
        // Normalize tardy → late
        if (worstStatus === 'tardy') worstStatus = 'late';
      }
    }

    return worstStatus;
  }

  /**
   * Remove school attendance record if it was derived (not directly recorded).
   * This handles the case where all section attendance is deleted.
   */
  private async removeIfDerived(
    client: any,
    tenantId: string,
    studentId: string,
    date: string,
  ): Promise<void> {
    const existingKey = EntityKeyBuilder.schoolAttendance(date, studentId);
    const existing = await this.dynamoDBClient.getItem<SchoolAttendance>(
      client, tenantId, existingKey,
    );

    if (existing?.derivedFrom === 'section_attendance') {
      await this.dynamoDBClient.deleteItem(client, tenantId, existingKey);
      this.logger.debug(`Removed derived school attendance: ${studentId} on ${date}`);
    }
  }
}

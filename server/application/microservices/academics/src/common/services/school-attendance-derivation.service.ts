/**
 * School Attendance Derivation Service — Layer 2 (per-student, per-day aggregate).
 *
 * Derives a single SchoolAttendance record (Ed-Fi: StudentSchoolAttendanceEvent)
 * from a student's SectionAttendance records for a date, per the school's
 * AGGREGATION policy (the only layer that knows the policy — recording + export
 * stay policy-agnostic):
 *
 *   daily_presence       — present for the day if the student physically attended
 *                          ANY section that day (present/late/tardy/remote/
 *                          half_day/early_departure). Mirrors "did they come to
 *                          school today" (PABSON default).
 *   per_section_granular  — present if they attended >= granularPresenceThresholdPct
 *                          (default 50%) of their recorded sections. Audit-friendly.
 *
 * Either way the day collapses to present | excused | absent on SCH_ATTEND.
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
import {
  PLATFORM_ATTENDANCE_COUNTING_POLICY,
  type AttendancePolicy,
  type AttendanceCountingPolicy,
} from '@aibrains/shared-types';
import { AttendancePolicyResolverService } from '../../attendance/attendance-policy-resolver.service';

interface ResolvedPolicy {
  policy: AttendancePolicy;
  counting: AttendanceCountingPolicy;
}

@Injectable()
export class SchoolAttendancDerivationService {
  private readonly logger = new Logger(SchoolAttendancDerivationService.name);

  // Per-school resolved-policy cache. Derivation runs per student/date (and N
  // times in a bulk save for one school/date), but the policy rarely changes —
  // a short TTL avoids a resolver round-trip (identity HTTP + archetype read)
  // per student. Keyed by tenant+school so one tenant's policy can't leak to another.
  private readonly policyCache = new Map<string, { value: ResolvedPolicy; at: number }>();
  private static readonly POLICY_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly policyResolver: AttendancePolicyResolverService,
  ) {}

  /**
   * Resolve a school's effective aggregation policy + counting policy (cached).
   * Degrades to the platform default (per_section_granular + platform counting)
   * on any resolver failure so derivation never throws.
   */
  private async resolvePolicy(
    schoolId: string,
    tenantId: string,
    userId: string,
    jwtToken: string,
  ): Promise<ResolvedPolicy> {
    const cacheKey = `${tenantId}#${schoolId}`;
    const cached = this.policyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SchoolAttendancDerivationService.POLICY_TTL_MS) {
      return cached.value;
    }
    let value: ResolvedPolicy = {
      policy: 'per_section_granular',
      counting: PLATFORM_ATTENDANCE_COUNTING_POLICY,
    };
    try {
      const resolved = await this.policyResolver.resolveEffectivePolicy(
        schoolId,
        { tenantId, userId, jwtToken } as any,
      );
      value = { policy: resolved.effectiveMode, counting: resolved.countingPolicy };
    } catch (err) {
      this.logger.warn(`resolvePolicy: failed for ${schoolId}; using platform default (per_section_granular): ${(err as Error).message}`);
    }
    this.policyCache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

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
    this.logger.debug(`deriveSchoolAttendance: entry, studentId=${studentId}, schoolId=${schoolId}, date=${date}`);

    // Derivation always runs: a "homeroom" is no longer a stored entity, so the
    // school-day record is always derived from per-section attendance.
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

    this.logger.debug(`deriveSchoolAttendance: sectionCount=${sectionRecords.items.length}, studentId=${studentId}, date=${date}`);

    if (sectionRecords.items.length === 0) {
      // No section attendance → remove school attendance if it was derived
      await this.removeIfDerived(client, tenantId, studentId, date);
      return null;
    }

    // 2. Derive the school-day status per the school's aggregation policy.
    const { policy, counting } = await this.resolvePolicy(schoolId, tenantId, userId, jwtToken);
    const derivedStatus = this.deriveStatus(sectionRecords.items, policy, counting);

    // 3. Check if school attendance already exists
    const existingKey = EntityKeyBuilder.schoolAttendance(date, studentId);
    const existing = await this.dynamoDBClient.getItem<SchoolAttendance>(
      client, tenantId, existingKey,
    );

    if (existing) {
      // Provenance precedence: a directly-recorded school-day event (e.g. a
      // daily homeroom roll-call) is authoritative and must NEVER be overwritten
      // by section-derived attendance. This service only owns rows it derived
      // (derivedFrom === 'section_attendance'); anything else (including legacy
      // direct rows that predate the provenance tag, where derivedFrom is
      // absent) is left untouched.
      if (existing.derivedFrom !== 'section_attendance') {
        this.logger.debug(`deriveSchoolAttendance: existing record for ${studentId} on ${date} is direct/authoritative (derivedFrom=${existing.derivedFrom ?? 'absent'}) — skipping derivation`);
        return existing;
      }

      // Update existing — only if status changed
      if (existing.status === derivedStatus) {
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
          // Provenance precedence holds on the retry path too: if a direct write
          // won the race, the refreshed row is now authoritative — never retag it
          // to 'section_attendance' (that would silently break the invariant for
          // all future derivations of this student/date).
          if (refreshed && refreshed.derivedFrom !== 'section_attendance') {
            return refreshed;
          }
          if (refreshed && refreshed.status === derivedStatus) {
            return refreshed; // Another derivation already set the correct status
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
   * Derive the school-day status (present | excused | absent) from a student's
   * section-attendance records, per the school's aggregation policy.
   *
   * "Attended" = physically at school in that section: any status EXCEPT `absent`
   * and `excused` (i.e. present/late/tardy/remote/half_day/early_departure all
   * count as having shown up). This is intentionally distinct from the counting
   * policy's `attendingCategories` (which weights the attendance RATE, not the
   * binary did-they-come-to-school decision).
   *
   *   daily_presence       — present if attended >= 1 section.
   *   per_section_granular — present if attended >= thresholdPct of recorded sections.
   *
   * When not present: excused if every non-attended record is excused (and none
   * are plain absences); otherwise absent.
   */
  private deriveStatus(
    records: SectionAttendance[],
    policy: AttendancePolicy,
    counting: AttendanceCountingPolicy,
  ): AttendanceStatus {
    const NON_ATTENDING = new Set<string>(['absent', 'excused']);
    const total = records.length;
    const attended = records.filter(r => !NON_ATTENDING.has(r.status)).length;
    const absent = records.filter(r => r.status === 'absent').length;
    const excused = records.filter(r => r.status === 'excused').length;

    const present =
      policy === 'daily_presence'
        ? attended >= 1
        : total > 0 && (attended / total) * 100 >= counting.granularPresenceThresholdPct;

    if (present) return 'present';
    // Not present for the day. Treat as excused only when there's no plain
    // absence and at least one approved (excused) absence; otherwise absent.
    if (excused > 0 && absent === 0) return 'excused';
    return 'absent';
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

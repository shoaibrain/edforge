/**
 * Section-attendance granular helpers (S6 dashboard-truth).
 *
 * After the attendance realignment, the daily SCH_ATTEND aggregate collapses to
 * present|excused|absent, so the school-day readers can no longer carry the
 * granular late/half_day/remote breakdown. These helpers source that breakdown
 * from the SECTION layer (SEC_ATTEND) — the authoritative source for per-section
 * status — as INFORMATIONAL OVERLAYS: a student late in any section is counted
 * `present` for the day (the daily aggregate) AND surfaced as "late" here, so the
 * overlays are NOT part of the present/absent/excused partition and never affect
 * the attendance rate.
 *
 * Shared by AttendanceService + DashboardService (neither injects the other) so
 * the bounded SEC_ATTEND drain + the distinct-student tally live in one place.
 */

import { Logger } from '@nestjs/common';
import { DynamoDBClientService } from './dynamodb-client.service';
import { GSIKeyBuilder } from '../entities/base.entity';
import { SectionAttendance } from '../entities/section-attendance.entity';

const MAX_PAGES = 20;

/**
 * Drain all SEC_ATTEND rows for a school + date (GSI3, school-scoped, bounded).
 * Uses queryGSI (no cursor off-by-one). Returns [] and logs on truncation rather
 * than looping unbounded.
 */
export async function drainSectionAttendanceForDate(
  ddb: DynamoDBClientService,
  client: unknown,
  tenantId: string,
  schoolId: string,
  date: string,
  logger?: Logger,
): Promise<SectionAttendance[]> {
  const records: SectionAttendance[] = [];
  let startKey: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    const page = await ddb.queryGSI<SectionAttendance>(
      client as never,
      'GSI3',
      GSIKeyBuilder.attendanceDate(tenantId, schoolId, date),
      'SEC_ATTEND#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      1000,
      true,
      startKey,
    );
    records.push(...page.items);
    startKey = page.lastEvaluatedKey
      ? JSON.parse(Buffer.from(page.lastEvaluatedKey, 'base64').toString())
      : undefined;
    pages++;
    if (startKey && pages >= MAX_PAGES) {
      logger?.warn(`drainSectionAttendanceForDate: hit ${MAX_PAGES}-page cap for school=${schoolId} date=${date}; granular overlay may be incomplete`);
      break;
    }
  } while (startKey);
  return records;
}

/**
 * Distinct studentIds per granular attending status across section-attendance
 * rows. A student counts toward a status if ANY of their sections has it
 * (any-late-mark semantics); a student can appear in more than one set.
 */
export function granularStudentSets(
  records: ReadonlyArray<{ studentId: string; status: string }>,
): { late: Set<string>; halfDay: Set<string>; remote: Set<string> } {
  const late = new Set<string>();
  const halfDay = new Set<string>();
  const remote = new Set<string>();
  for (const r of records) {
    if (r.status === 'late' || r.status === 'tardy') late.add(r.studentId);
    else if (r.status === 'half_day') halfDay.add(r.studentId);
    else if (r.status === 'remote') remote.add(r.studentId);
  }
  return { late, halfDay, remote };
}

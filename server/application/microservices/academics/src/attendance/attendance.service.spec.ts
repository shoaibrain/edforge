/**
 * Unit spec for attendance.service.ts — pilot greenlight C2 PR-B.
 *
 * Covers `deriveNonInstructionalReason` precedence + the structured
 * BadRequestException shape that `validateInstructionalDay` throws
 * (DATE_NOT_INSTRUCTIONAL errorCode).
 *
 * Reason taxonomy (must match identity's ShiftResolverService):
 *   1. isWeekend                → 'weekend'
 *   2. event eventType='break'  → 'vacation'
 *   3. isHoliday                → 'holiday'
 *   4. otherwise                → 'non_instructional'
 */

import { BadRequestException } from '@nestjs/common';
import {
  AttendanceService,
  deriveNonInstructionalReason,
  enumerateDatesUTC,
  midpointDateUTC,
  dayBeforeUTC,
  countAttendingAbsent,
  computeRecentVsBaselineTrend,
  computeStudentTrendFromRecords,
  formatAttendanceCoverageMetric,
} from './attendance.service';
import type { CalendarDateResponse } from '../common/services/identity-client.service';
import type { SchoolAttendance } from '../common/entities/school-attendance.entity';

const baseCalendarDate: CalendarDateResponse = {
  calendarDateId: 'school-1::2026-07-27',
  schoolId: 'school-1',
  date: '2026-07-27',
  isInstructionalDay: false,
  isHoliday: false,
  isWeekend: false,
  dayOfWeek: 'monday',
  calendarEvents: [],
};

describe('deriveNonInstructionalReason', () => {
  it('returns weekend when isWeekend=true (precedence #1)', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        isWeekend: true,
        dayOfWeek: 'saturday',
      }),
    ).toBe('weekend');
  });

  it('returns weekend even when other flags are set (highest precedence)', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        isWeekend: true,
        isHoliday: true,
        calendarEvents: [{ eventType: 'break' }],
      }),
    ).toBe('weekend');
  });

  it('returns vacation for a break event (precedence #2)', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        isHoliday: true, // both set — vacation wins
        calendarEvents: [{ eventType: 'break', description: 'Winter Break' }],
      }),
    ).toBe('vacation');
  });

  it('returns holiday when isHoliday=true and no break event (precedence #3)', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        isHoliday: true,
        calendarEvents: [{ eventType: 'holiday', description: 'Buddha Jayanti' }],
      }),
    ).toBe('holiday');
  });

  it('returns non_instructional for teacher_only or other non-flag cases', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        calendarEvents: [{ eventType: 'teacher_only', description: 'In-service' }],
      }),
    ).toBe('non_instructional');
  });

  it('returns non_instructional when no flags and no events', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        calendarEvents: [],
      }),
    ).toBe('non_instructional');
  });

  it('handles missing calendarEvents array defensively', () => {
    expect(
      deriveNonInstructionalReason({
        ...baseCalendarDate,
        calendarEvents: undefined,
      }),
    ).toBe('non_instructional');
  });
});

describe('formatAttendanceCoverageMetric (S1.T5)', () => {
  it('emits a parseable line with coverage = recorded ÷ enrolled', () => {
    const line = formatAttendanceCoverageMetric({
      schoolId: 'sch-1', date: '2026-06-16', recorded: 40, enrolled: 250, attendanceRate: 16,
    });
    expect(line).toContain('metric=attendance.coverage');
    expect(line).toContain('schoolId=sch-1');
    expect(line).toContain('date=2026-06-16');
    expect(line).toContain('recorded=40');
    expect(line).toContain('enrolled=250');
    expect(line).toContain('coveragePct=16');
    expect(line).toContain('attendanceRatePct=16');
  });

  it('rounds coverage to 2 decimals', () => {
    expect(
      formatAttendanceCoverageMetric({ schoolId: 's', date: 'd', recorded: 1, enrolled: 3, attendanceRate: 0 }),
    ).toContain('coveragePct=33.33');
  });

  it('reports 0 coverage when enrolled is 0 (avoids divide-by-zero)', () => {
    expect(
      formatAttendanceCoverageMetric({ schoolId: 's', date: 'd', recorded: 0, enrolled: 0, attendanceRate: 0 }),
    ).toContain('coveragePct=0');
  });
});

describe('AttendanceService.validateInstructionalDay (DATE_NOT_INSTRUCTIONAL)', () => {
  function buildService(
    getCalendarDate: jest.Mock,
  ): { svc: AttendanceService; getCalendarDate: jest.Mock } {
    const identityClient = { getCalendarDate } as any;
    const svc = new AttendanceService(
      {} as any, // DynamoDBClientService
      {} as any, // AcademicsEventsService
      identityClient,
      {} as any, // DataScopeService
    );
    return { svc, getCalendarDate };
  }

  const ctx = {
    userId: 'u',
    tenantId: 't',
    email: 'a@b.c',
    globalRole: 'TenantAdmin',
    jwtToken: 'jwt',
    username: 'a@b.c',
  } as any;

  async function callValidate(svc: AttendanceService, date: string) {
    // validateInstructionalDay is private — reach in via bracket access for
    // the spec only. The runtime behavior is exercised via recordAttendance
    // + recordBulkAttendance in production.
    return (svc as any).validateInstructionalDay('school-1', date, ctx);
  }

  it('allows attendance when calendar-date row is missing (graceful degradation)', async () => {
    const { svc } = buildService(jest.fn().mockResolvedValue(null));
    await expect(callValidate(svc, '2026-07-27')).resolves.toBeUndefined();
  });

  it('allows attendance when identity service errors (graceful degradation)', async () => {
    const { svc } = buildService(jest.fn().mockRejectedValue(new Error('network')));
    await expect(callValidate(svc, '2026-07-27')).resolves.toBeUndefined();
  });

  it('allows attendance on an instructional day', async () => {
    const { svc } = buildService(
      jest.fn().mockResolvedValue({
        ...baseCalendarDate,
        date: '2026-07-27',
        isInstructionalDay: true,
        calendarEvents: [{ eventType: 'instructional_day' }],
      }),
    );
    await expect(callValidate(svc, '2026-07-27')).resolves.toBeUndefined();
  });

  it('throws DATE_NOT_INSTRUCTIONAL with reason=holiday on a Buddha Jayanti row', async () => {
    const { svc } = buildService(
      jest.fn().mockResolvedValue({
        ...baseCalendarDate,
        date: '2026-05-23',
        isHoliday: true,
        calendarEvents: [{ eventType: 'holiday', description: 'Buddha Jayanti' }],
      }),
    );
    try {
      await callValidate(svc, '2026-05-23');
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      const r = e.getResponse();
      expect(r.errorCode).toBe('DATE_NOT_INSTRUCTIONAL');
      expect(r.details).toEqual({
        date: '2026-05-23',
        reason: 'holiday',
        description: 'Buddha Jayanti',
      });
      expect(r.message).toMatch(/non-instructional day/);
    }
  });

  it('throws DATE_NOT_INSTRUCTIONAL with reason=weekend on a Saturday row', async () => {
    const { svc } = buildService(
      jest.fn().mockResolvedValue({
        ...baseCalendarDate,
        date: '2026-08-01',
        isWeekend: true,
        dayOfWeek: 'saturday',
        calendarEvents: [{ eventType: 'non_instructional_day' }],
      }),
    );
    try {
      await callValidate(svc, '2026-08-01');
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      const r = e.getResponse();
      expect(r.errorCode).toBe('DATE_NOT_INSTRUCTIONAL');
      expect(r.details.reason).toBe('weekend');
    }
  });

  it('throws DATE_NOT_INSTRUCTIONAL with reason=vacation on a school break row', async () => {
    const { svc } = buildService(
      jest.fn().mockResolvedValue({
        ...baseCalendarDate,
        date: '2026-12-26',
        isHoliday: true, // both flags possible — break wins
        calendarEvents: [{ eventType: 'break', description: 'Winter Vacation' }],
      }),
    );
    try {
      await callValidate(svc, '2026-12-26');
      fail('expected BadRequestException');
    } catch (e: any) {
      const r = e.getResponse();
      expect(r.details.reason).toBe('vacation');
      expect(r.details.description).toBe('Winter Vacation');
    }
  });
});

describe('AttendanceService.recordDailyAttendance (S4.T1)', () => {
  const ctx = { userId: 'u1', tenantId: 't1', email: 'e', globalRole: 'TenantAdmin', jwtToken: 'jwt', username: 'e' } as any;

  function buildService(overrides: { getItem?: any; queryGSI?: any; batchGetItems?: any } = {}) {
    const putItem = jest.fn().mockResolvedValue(undefined);
    const updateItem = jest.fn().mockResolvedValue(undefined);
    const dynamo = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: overrides.getItem ?? jest.fn().mockImplementation((_c: any, _t: any, sk: string) =>
        Promise.resolve(sk.startsWith('SECTION#') ? { sectionId: 'hr-1', sectionType: 'homeroom', isActive: true, sectionNumber: 'G6A' } : null)),
      queryGSI: overrides.queryGSI ?? jest.fn().mockResolvedValue({
        items: [
          { studentId: 's1', studentName: 'Alice', isActive: true },
          { studentId: 's2', studentName: 'Bob', isActive: true },
        ],
        hasMore: false,
      }),
      batchGetItems: overrides.batchGetItems ?? jest.fn().mockResolvedValue([]),
      putItem,
      updateItem,
    } as any;
    const identityClient = { getCalendarDate: jest.fn().mockResolvedValue(null) } as any; // instructional (graceful)
    const dataScope = {
      resolveScope: jest.fn().mockResolvedValue({ type: 'school' }),
      isSectionInScope: jest.fn().mockReturnValue(true),
    } as any;
    const svc = new AttendanceService(dynamo, {} as any, identityClient, dataScope);
    return { svc, putItem, updateItem };
  }

  const dto = (marks: any[] = []) =>
    ({ schoolId: 'school-1', homeroomSectionId: 'hr-1', academicYearId: 'year-1', date: '2026-06-17', marks } as any);

  it('expands the roster: marked absent + unmarked default-present, with Ed-Fi descriptors', async () => {
    const { svc, putItem } = buildService();
    const res = await svc.recordDailyAttendance(dto([{ studentId: 's1', status: 'absent' }]), ctx);

    expect(res.rosterSize).toBe(2);
    expect(res.marked).toBe(1);
    expect(res.defaultedPresent).toBe(1);
    expect(res.recordsWritten).toBe(2);

    const written = putItem.mock.calls.map((c: any[]) => c[1]);
    const attendance = written.filter((w: any) => w.entityType === 'SCHOOL_ATTENDANCE');
    const marker = written.find((w: any) => w.entityType === 'SECTION_ATTENDANCE_TAKEN');
    expect(attendance).toHaveLength(2);
    expect(marker).toBeDefined();         // S4.T2: homeroom "taken" marker
    expect(marker.studentsRecorded).toBe(2);
    const s1 = attendance.find((w: any) => w.studentId === 's1');
    const s2 = attendance.find((w: any) => w.studentId === 's2');
    // marked absent -> Unexcused Absence, eventDuration 0, authoritative (direct)
    expect(s1.status).toBe('absent');
    expect(s1.attendanceEventCategory).toBe('Unexcused Absence');
    expect(s1.eventDuration).toBe(0);
    expect(s1.derivedFrom).toBe('direct');
    // unmarked -> present -> In Attendance, eventDuration 1
    expect(s2.status).toBe('present');
    expect(s2.attendanceEventCategory).toBe('In Attendance');
    expect(s2.eventDuration).toBe(1);
    expect(s2.derivedFrom).toBe('direct');
  });

  it('is idempotent: re-saving identical marks writes no SCH_ATTEND rows', async () => {
    const { svc, putItem } = buildService({
      batchGetItems: jest.fn().mockResolvedValue([
        { studentId: 's1', status: 'absent', derivedFrom: 'direct', eventDuration: 0, note: null },
        { studentId: 's2', status: 'present', derivedFrom: 'direct', eventDuration: 1, note: null },
      ]),
    });
    const res = await svc.recordDailyAttendance(dto([{ studentId: 's1', status: 'absent' }]), ctx);

    expect(res.recordsWritten).toBe(0);
    // No SCH_ATTEND writes; only the homeroom "taken" marker is (re)written.
    const written = putItem.mock.calls.map((c: any[]) => c[1]);
    expect(written.filter((w: any) => w.entityType === 'SCHOOL_ATTENDANCE')).toHaveLength(0);
    expect(written.some((w: any) => w.entityType === 'SECTION_ATTENDANCE_TAKEN')).toBe(true);
  });

  it('roster-diff on re-save: preserves an unmarked student\'s existing record (no clobber, S4.T3)', async () => {
    const { svc, putItem, updateItem } = buildService({
      batchGetItems: jest.fn().mockResolvedValue([
        // s1 already recorded absent earlier; this save does NOT mark s1.
        { studentId: 's1', status: 'absent', derivedFrom: 'direct', eventDuration: 0, note: null },
      ]),
    });
    const res = await svc.recordDailyAttendance(dto([{ studentId: 's2', status: 'late' }]), ctx);

    const attendanceWrites = putItem.mock.calls.map((c: any[]) => c[1]).filter((w: any) => w.entityType === 'SCHOOL_ATTENDANCE');
    // s1 (unmarked, has a prior record) is preserved — neither put nor updated.
    expect(attendanceWrites.some((w: any) => w.studentId === 's1')).toBe(false);
    expect(updateItem.mock.calls.some((u: any[]) => String(u[2]).includes('s1'))).toBe(false);
    // s2 (explicitly marked) is written.
    expect(attendanceWrites.some((w: any) => w.studentId === 's2' && w.status === 'late')).toBe(true);
    expect(res.marked).toBe(1);
  });

  it('rejects a non-homeroom section', async () => {
    const { svc } = buildService({
      getItem: jest.fn().mockResolvedValue({ sectionId: 'sec-1', sectionType: 'instructional', isActive: true }),
    });
    await expect(svc.recordDailyAttendance(dto(), ctx)).rejects.toThrow(BadRequestException);
  });
});

describe('AttendanceService.getDailyAttendanceSummary (S4.T5 policy-weighted rate + coverage)', () => {
  const ctx = { userId: 'u1', tenantId: 't1', email: 'e', globalRole: 'TenantAdmin', jwtToken: 'jwt', username: 'e' } as any;
  const SCHOOL = '11111111-1111-1111-1111-111111111111';
  const YEAR = '22222222-2222-2222-2222-222222222222';

  function buildService(attendanceItems: any[], enrollmentItems: any[]) {
    const queryGSI = jest.fn().mockImplementation((_c: any, index: string) =>
      Promise.resolve(index === 'GSI1'
        ? { items: enrollmentItems, hasMore: false }
        : { items: attendanceItems, hasMore: false }),
    );
    const dynamo = { getClient: jest.fn().mockResolvedValue({}), queryGSI } as any;
    const dataScope = {
      resolveScope: jest.fn().mockResolvedValue({ type: 'school' }),
      filterByStudentScope: jest.fn().mockImplementation((_s: any, items: any[]) => items),
    } as any;
    const svc = new AttendanceService(dynamo, {} as any, {} as any, dataScope);
    return { svc };
  }

  it('weights half_day as 0.5, excludes excused, and reports recording coverage', async () => {
    const attendance = [
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'half_day' },
      { studentId: 's3', status: 'absent' },
      { studentId: 's4', status: 'excused' },
    ];
    const enrollments = ['s1', 's2', 's3', 's4'].map((studentId) => ({ studentId, status: 'enrolled', gradeLevel: '6' }));
    const { svc } = buildService(attendance, enrollments);

    const summary = await svc.getDailyAttendanceSummary(SCHOOL, '2026-06-17', ctx, YEAR);

    // attendingWeight = present(1) + half_day(0.5) + absent(0) + excused(0) = 1.5
    // rate = 1.5 / 4 enrolled = 37.5%  (old whole-day half_day counting → 50%)
    expect(summary.attendanceRate).toBe(37.5);
    // every enrolled student has a record → 100% coverage
    expect(summary.coveragePct).toBe(100);
    expect(summary.totalStudents).toBe(4);
    expect(summary.halfDay).toBe(1);
  });

  it('coverage reflects sparse recording (recorded ÷ enrolled)', async () => {
    const attendance = [{ studentId: 's1', status: 'present' }];
    const enrollments = ['s1', 's2', 's3', 's4'].map((studentId) => ({ studentId, status: 'enrolled', gradeLevel: '6' }));
    const { svc } = buildService(attendance, enrollments);

    const summary = await svc.getDailyAttendanceSummary(SCHOOL, '2026-06-17', ctx, YEAR);

    // 1 of 4 enrolled recorded → 25% coverage; rate = 1/4 = 25%
    expect(summary.coveragePct).toBe(25);
    expect(summary.attendanceRate).toBe(25);
  });
});

// ============================================================================
// C3.1 phase 2: pure helpers extracted for the bulk-scan rewrite of
// getAttendanceAlerts. Tests are TZ-robust — `enumerateDatesUTC` uses UTC
// methods throughout, mirroring the gregorianToBs C3.7 fix.
// ============================================================================

describe('enumerateDatesUTC', () => {
  it('returns inclusive range', () => {
    expect(enumerateDatesUTC('2026-05-01', '2026-05-03')).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('returns single-day range', () => {
    expect(enumerateDatesUTC('2026-05-01', '2026-05-01')).toEqual(['2026-05-01']);
  });

  it('returns empty array when end < start', () => {
    expect(enumerateDatesUTC('2026-05-03', '2026-05-01')).toEqual([]);
  });

  it('crosses month boundary correctly', () => {
    expect(enumerateDatesUTC('2026-04-30', '2026-05-02')).toEqual([
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ]);
  });

  it('returns same dates regardless of host timezone', () => {
    const ORIGINAL_TZ = process.env.TZ;
    try {
      process.env.TZ = 'America/Chicago';
      expect(enumerateDatesUTC('2026-05-01', '2026-05-03')).toEqual([
        '2026-05-01',
        '2026-05-02',
        '2026-05-03',
      ]);
    } finally {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    }
  });

  it('returns empty for malformed dates', () => {
    expect(enumerateDatesUTC('not-a-date', '2026-05-01')).toEqual([]);
  });
});

describe('midpointDateUTC + dayBeforeUTC', () => {
  it('midpoint of an even-day range', () => {
    expect(midpointDateUTC('2026-05-01', '2026-05-11')).toBe('2026-05-06');
  });

  it('dayBefore goes back one calendar day', () => {
    expect(dayBeforeUTC('2026-05-01')).toBe('2026-04-30');
    expect(dayBeforeUTC('2026-01-01')).toBe('2025-12-31');
  });
});

describe('countAttendingAbsent', () => {
  const r = (status: SchoolAttendance['status']) =>
    ({ status } as SchoolAttendance);

  it('treats present+late+tardy+half_day+remote as attending', () => {
    const recs = [
      r('present'),
      r('late'),
      r('tardy'),
      r('half_day'),
      r('remote'),
    ];
    expect(countAttendingAbsent(recs)).toEqual({ attending: 5, absent: 0 });
  });

  it('treats absent as absent', () => {
    expect(countAttendingAbsent([r('absent'), r('absent')])).toEqual({
      attending: 0,
      absent: 2,
    });
  });

  it('excludes excused from both counts (matches old per-record switch)', () => {
    expect(countAttendingAbsent([r('present'), r('excused'), r('absent')])).toEqual({
      attending: 1,
      absent: 1,
    });
  });

  it('handles empty input', () => {
    expect(countAttendingAbsent([])).toEqual({ attending: 0, absent: 0 });
  });
});

describe('computeRecentVsBaselineTrend (Issue 1 — per-student trend)', () => {
  const rec = (date: string, status: SchoolAttendance['status']): SchoolAttendance =>
    ({ date, status } as SchoolAttendance);
  // endDate 2026-06-20 → recent window 06-14..06-20, baseline 05-22..06-13.
  const END = '2026-06-20';

  it("returns 'improving' when the recent window beats the baseline by >5pp", () => {
    const records = [
      ...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => rec(d, 'absent')),
      ...['2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'].map((d) => rec(d, 'present')),
    ];
    expect(computeRecentVsBaselineTrend(records, END)).toBe('improving');
  });

  it("returns 'declining' when the recent window trails the baseline by >5pp", () => {
    const records = [
      ...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => rec(d, 'present')),
      ...['2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'].map((d) => rec(d, 'absent')),
    ];
    expect(computeRecentVsBaselineTrend(records, END)).toBe('declining');
  });

  it("returns 'stable' when a window has fewer than minRecords (sparse)", () => {
    const records = [
      ...['2026-06-01', '2026-06-02', '2026-06-03'].map((d) => rec(d, 'present')),
      ...['2026-06-19', '2026-06-20'].map((d) => rec(d, 'present')), // only 2 recent
    ];
    expect(computeRecentVsBaselineTrend(records, END)).toBe('stable');
  });

  it("returns 'stable' when recent and baseline rates are within ±5pp", () => {
    // both windows 80% (4 present / 1 absent)
    const records = [
      rec('2026-06-01', 'absent'), ...['2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => rec(d, 'present')),
      rec('2026-06-14', 'absent'), ...['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'].map((d) => rec(d, 'present')),
    ];
    expect(computeRecentVsBaselineTrend(records, END)).toBe('stable');
  });
});

describe('computeStudentTrendFromRecords (Sprint 2 — roster sparkline)', () => {
  const rec = (date: string, status: SchoolAttendance['status']): SchoolAttendance =>
    ({ studentId: 's1', date, status } as SchoolAttendance);

  it('computes the aggregate rate as attending / total records', () => {
    const t = computeStudentTrendFromRecords(
      [rec('2026-06-01', 'present'), rec('2026-06-02', 'present'), rec('2026-06-03', 'absent'), rec('2026-06-04', 'present')],
      '2026-06-04',
    );
    expect(t.rate).toBe(75);
    expect(t.totalDays).toBe(4);
    expect(t.absentDays).toBe(1);
  });

  it('builds a chronological per-date daily-rate series (sorted by date)', () => {
    const t = computeStudentTrendFromRecords(
      [rec('2026-06-03', 'absent'), rec('2026-06-01', 'present'), rec('2026-06-02', 'present')],
      '2026-06-03',
    );
    expect(t.series).toEqual([100, 100, 0]);
  });

  it("is 'stable' when the window is too sparse to judge", () => {
    expect(
      computeStudentTrendFromRecords(
        [rec('2026-06-01', 'present'), rec('2026-06-02', 'absent')],
        '2026-06-02',
      ).trend,
    ).toBe('stable');
  });

  it("detects 'improving' across the window (early absent → late present)", () => {
    const recs = [
      ...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => rec(d, 'absent')),
      ...['2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'].map((d) => rec(d, 'present')),
    ];
    expect(computeStudentTrendFromRecords(recs, '2026-06-11').trend).toBe('improving');
  });

  it('handles empty records', () => {
    expect(computeStudentTrendFromRecords([], '2026-06-07')).toMatchObject({
      rate: 0,
      series: [],
      totalDays: 0,
      absentDays: 0,
      trend: 'stable',
    });
  });
});

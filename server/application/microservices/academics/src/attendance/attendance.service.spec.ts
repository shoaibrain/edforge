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
  computeTrendFromRecords,
  computeStudentTrendFromRecords,
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

describe('computeTrendFromRecords', () => {
  const rec = (date: string, status: SchoolAttendance['status']): SchoolAttendance =>
    ({ date, status } as SchoolAttendance);

  it("returns 'stable' when either half has fewer than 5 records", () => {
    const records = [
      rec('2026-05-01', 'present'),
      rec('2026-05-02', 'present'),
      rec('2026-05-10', 'present'),
      rec('2026-05-11', 'present'),
      rec('2026-05-12', 'present'),
      rec('2026-05-13', 'present'),
    ];
    expect(computeTrendFromRecords(records, '2026-05-05', '2026-05-06')).toBe(
      'stable',
    );
  });

  it("returns 'improving' when second-half rate is >5pt higher", () => {
    const firstHalf = Array.from({ length: 10 }, (_, i) =>
      rec(`2026-05-0${i % 5 + 1}`, i < 4 ? 'absent' : 'present'),
    );
    const secondHalf = Array.from({ length: 10 }, (_, i) =>
      rec(`2026-05-${10 + (i % 5)}`, i < 1 ? 'absent' : 'present'),
    );
    expect(
      computeTrendFromRecords(
        [...firstHalf, ...secondHalf],
        '2026-05-09',
        '2026-05-10',
      ),
    ).toBe('improving');
  });

  it("returns 'declining' when second-half rate is >5pt lower", () => {
    const firstHalf = Array.from({ length: 10 }, (_, i) =>
      rec(`2026-05-0${i % 5 + 1}`, 'present'),
    );
    const secondHalf = Array.from({ length: 10 }, (_, i) =>
      rec(`2026-05-${10 + (i % 5)}`, i < 6 ? 'absent' : 'present'),
    );
    expect(
      computeTrendFromRecords(
        [...firstHalf, ...secondHalf],
        '2026-05-09',
        '2026-05-10',
      ),
    ).toBe('declining');
  });

  it("returns 'stable' when delta within ±5pt", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      rec(
        i < 10 ? `2026-05-0${i % 5 + 1}` : `2026-05-${10 + (i % 5)}`,
        i % 5 === 0 ? 'absent' : 'present',
      ),
    );
    expect(
      computeTrendFromRecords(records, '2026-05-09', '2026-05-10'),
    ).toBe('stable');
  });
});

describe('computeStudentTrendFromRecords (Sprint 2 — roster sparkline)', () => {
  const rec = (date: string, status: SchoolAttendance['status']): SchoolAttendance =>
    ({ studentId: 's1', date, status } as SchoolAttendance);

  it('computes the aggregate rate as attending / total records', () => {
    const t = computeStudentTrendFromRecords(
      [rec('2026-06-01', 'present'), rec('2026-06-02', 'present'), rec('2026-06-03', 'absent'), rec('2026-06-04', 'present')],
      '2026-06-01',
      '2026-06-04',
    );
    expect(t.rate).toBe(75);
    expect(t.totalDays).toBe(4);
    expect(t.absentDays).toBe(1);
  });

  it('builds a chronological per-date daily-rate series (sorted by date)', () => {
    const t = computeStudentTrendFromRecords(
      [rec('2026-06-03', 'absent'), rec('2026-06-01', 'present'), rec('2026-06-02', 'present')],
      '2026-06-01',
      '2026-06-03',
    );
    expect(t.series).toEqual([100, 100, 0]);
  });

  it("is 'stable' when halves have fewer than 5 records", () => {
    expect(
      computeStudentTrendFromRecords(
        [rec('2026-06-01', 'present'), rec('2026-06-02', 'absent')],
        '2026-06-01',
        '2026-06-02',
      ).trend,
    ).toBe('stable');
  });

  it("detects 'improving' across the window (early absent → late present)", () => {
    const recs = [
      ...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => rec(d, 'absent')),
      ...['2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'].map((d) => rec(d, 'present')),
    ];
    expect(computeStudentTrendFromRecords(recs, '2026-06-01', '2026-06-11').trend).toBe('improving');
  });

  it('handles empty records', () => {
    expect(computeStudentTrendFromRecords([], '2026-06-01', '2026-06-07')).toMatchObject({
      rate: 0,
      series: [],
      totalDays: 0,
      absentDays: 0,
      trend: 'stable',
    });
  });
});

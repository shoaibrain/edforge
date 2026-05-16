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
} from './attendance.service';
import type { CalendarDateResponse } from '../common/services/identity-client.service';

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

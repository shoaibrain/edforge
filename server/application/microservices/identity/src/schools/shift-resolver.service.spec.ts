/**
 * Unit specs for ShiftResolverService — pilot greenlight C2.2.
 *
 * Tests the pure classifier `classifyShiftFromCalendarDate` against the
 * 5-way precedence matrix that mirrors @edforge/pilot-fixtures'
 * `shiftProfileForDate`:
 *
 *   1. isWeekend                → 'weekend'
 *   2. event.eventType='break'  → 'vacation'
 *   3. isHoliday                → 'holiday'
 *   4. event.eventType='exam_window' → 'exam_day'
 *   5. otherwise                → 'regular'
 */

import { NotFoundException } from '@nestjs/common';
import {
  ShiftResolverService,
  classifyShiftFromCalendarDate,
} from './shift-resolver.service';
import { CalendarDateService } from './calendar-date.service';
import { RequestContext } from '../common/entities';
import type { CalendarDateResponseDto } from '@aibrains/shared-types';

const baseRow: CalendarDateResponseDto = {
  calendarDateId: 'school-1::2083-04-12',
  schoolId: '00000000-0000-0000-0000-000000000001',
  academicYearId: '00000000-0000-0000-0000-000000000002',
  tenantId: '00000000-0000-0000-0000-000000000003',
  date: '2026-07-27',
  calendarEvents: [{ eventType: 'instructional_day', isAllDay: true }],
  isInstructionalDay: true,
  isHoliday: false,
  isWeekend: false,
  dayOfWeek: 'monday',
  bellScheduleId: 'bell-default',
  bellScheduleName: 'Regular',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('classifyShiftFromCalendarDate', () => {
  it('returns regular for a standard weekday row', () => {
    const r = classifyShiftFromCalendarDate(baseRow);
    expect(r.classification).toBe('regular');
    expect(r.isInstructionalDay).toBe(true);
    expect(r.bellScheduleId).toBe('bell-default');
  });

  it('returns weekend when isWeekend=true (precedence #1)', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      isWeekend: true,
      isInstructionalDay: false,
      dayOfWeek: 'saturday',
      calendarEvents: [{ eventType: 'non_instructional_day', isAllDay: true }],
    });
    expect(r.classification).toBe('weekend');
    expect(r.reason).toContain('saturday');
  });

  it('returns vacation for a break event (precedence #2 — beats holiday flag)', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      isHoliday: true, // both set — vacation wins
      isInstructionalDay: false,
      calendarEvents: [
        { eventType: 'break', description: 'Winter Break', isAllDay: true },
      ],
    });
    expect(r.classification).toBe('vacation');
    expect(r.reason).toBe('Winter Break');
  });

  it('returns holiday when isHoliday=true and no break event (precedence #3)', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      isHoliday: true,
      isInstructionalDay: false,
      calendarEvents: [
        { eventType: 'holiday', description: 'Buddha Jayanti', isAllDay: true },
      ],
    });
    expect(r.classification).toBe('holiday');
    expect(r.reason).toBe('Buddha Jayanti');
  });

  it('returns holiday for a row with BOTH holiday and exam_window (holiday wins)', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      isHoliday: true,
      isInstructionalDay: false,
      calendarEvents: [
        { eventType: 'holiday', description: 'National Day', isAllDay: true },
        { eventType: 'exam_window', description: 'Term 2 Exam', isAllDay: true },
      ],
    });
    expect(r.classification).toBe('holiday');
  });

  it('returns exam_day when only exam_window event present (precedence #4)', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      calendarEvents: [
        { eventType: 'exam_window', description: 'Term 1 Exam', isAllDay: true },
      ],
    });
    expect(r.classification).toBe('exam_day');
    expect(r.reason).toBe('Term 1 Exam');
    expect(r.isInstructionalDay).toBe(true); // exam days are instructional
  });

  it('returns regular when no special events and no flags', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      calendarEvents: [{ eventType: 'instructional_day', isAllDay: true }],
    });
    expect(r.classification).toBe('regular');
    expect(r.reason).toBe('regular instructional day');
  });

  it('uses default reason when event has no description', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      isHoliday: true,
      calendarEvents: [{ eventType: 'holiday', isAllDay: true }],
    });
    expect(r.classification).toBe('holiday');
    expect(r.reason).toBe('holiday');
  });

  it('passes through bellScheduleId/Name and dayOfWeek unchanged', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      bellScheduleId: 'bell-exam',
      bellScheduleName: 'Exam Day Schedule',
      dayOfWeek: 'thursday',
    });
    expect(r.bellScheduleId).toBe('bell-exam');
    expect(r.bellScheduleName).toBe('Exam Day Schedule');
    expect(r.dayOfWeek).toBe('thursday');
  });

  it('handles missing calendarEvents array defensively', () => {
    const r = classifyShiftFromCalendarDate({
      ...baseRow,
      calendarEvents: [] as any,
    });
    expect(r.classification).toBe('regular');
  });
});

describe('ShiftResolverService.resolve', () => {
  const ctx: RequestContext = {
    userId: 'u',
    tenantId: 't',
    email: 'a@b.c',
    globalRole: 'TenantAdmin',
    jwtToken: 'jwt',
    username: 'a@b.c',
  };

  function makeService(getCalendarDate: jest.Mock): ShiftResolverService {
    const cdService = { getCalendarDate } as unknown as CalendarDateService;
    return new ShiftResolverService(cdService);
  }

  it('delegates to CalendarDateService.getCalendarDate and classifies', async () => {
    const getCalendarDate = jest.fn().mockResolvedValue({
      ...baseRow,
      isHoliday: true,
      isInstructionalDay: false,
      calendarEvents: [{ eventType: 'holiday', description: 'Dashain', isAllDay: true }],
    });
    const svc = makeService(getCalendarDate);
    const r = await svc.resolve('school-1', '2026-10-02', ctx);

    expect(getCalendarDate).toHaveBeenCalledWith('school-1', '2026-10-02', ctx);
    expect(r.classification).toBe('holiday');
    expect(r.reason).toBe('Dashain');
  });

  it('propagates NotFoundException from CalendarDateService unchanged', async () => {
    const getCalendarDate = jest.fn().mockRejectedValue(
      new NotFoundException('Calendar date not found: 2026-10-02'),
    );
    const svc = makeService(getCalendarDate);
    await expect(svc.resolve('school-1', '2026-10-02', ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

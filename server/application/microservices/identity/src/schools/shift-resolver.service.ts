/**
 * Shift Resolver Service — single-date classification for pilot greenlight C2.2.
 *
 * Reads the CalendarDate row for a `(schoolId, date)` pair and reduces it to
 * a 5-way classification matching the fixture's `shiftProfileForDate` helper
 * in `@edforge/pilot-fixtures`:
 *
 *   regular  | exam_day | holiday | weekend | vacation
 *
 * This is intentionally a *read-only* derivation — it does NOT write events,
 * does NOT generate calendar dates, does NOT consult bell-schedule shifts
 * beyond identifying which `BellSchedule` row (if any) applies for the day.
 * The fixture-side helper compares against this output for parity.
 *
 * Precedence (must match `packages/pilot-fixtures/src/loader.ts:shiftProfileForDate`):
 *   1. `isWeekend === true`               → 'weekend'
 *   2. event eventType === 'break'        → 'vacation'  (school-specific vacation block)
 *   3. `isHoliday === true`               → 'holiday'   (national/religious holiday)
 *   4. event eventType === 'exam_window'  → 'exam_day'
 *   5. otherwise                          → 'regular'
 *
 * Edge cases:
 *   - Day with BOTH exam_window AND holiday: holiday wins (per fixture).
 *   - Day with no CalendarDate row: throws 404 (NotFoundException). The
 *     C2.2 smoke handles this gracefully by treating it as "calendar not
 *     generated for this date".
 */

import { Injectable } from '@nestjs/common';
import { CalendarDateService } from './calendar-date.service';
import { RequestContext } from '../common/entities';
import type { CalendarDateResponseDto } from '@aibrains/shared-types';

export type ShiftClassification =
  | 'regular'
  | 'exam_day'
  | 'holiday'
  | 'weekend'
  | 'vacation';

export interface ShiftProfileResponse {
  date: string;
  classification: ShiftClassification;
  isInstructionalDay: boolean;
  dayOfWeek: string;
  bellScheduleId?: string;
  bellScheduleName?: string;
  reason: string;
}

/**
 * Pure classifier — no I/O. Exported for spec coverage.
 *
 * Takes the CalendarDate response from `CalendarDateService.getCalendarDate`
 * and emits the 5-way classification + a short reason string the caller can
 * surface in UI or log output.
 */
export function classifyShiftFromCalendarDate(
  cd: CalendarDateResponseDto,
): ShiftProfileResponse {
  const events = cd.calendarEvents ?? [];
  const hasBreakEvent = events.some((e) => e.eventType === 'break');
  const hasExamEvent = events.some((e) => e.eventType === 'exam_window');

  let classification: ShiftClassification;
  let reason: string;

  if (cd.isWeekend) {
    classification = 'weekend';
    reason = `${cd.dayOfWeek} is not in this school's instructional week`;
  } else if (hasBreakEvent) {
    classification = 'vacation';
    const breakEvent = events.find((e) => e.eventType === 'break');
    reason = breakEvent?.description ?? 'school break';
  } else if (cd.isHoliday) {
    classification = 'holiday';
    const holidayEvent = events.find((e) => e.eventType === 'holiday');
    reason = holidayEvent?.description ?? 'holiday';
  } else if (hasExamEvent) {
    classification = 'exam_day';
    const examEvent = events.find((e) => e.eventType === 'exam_window');
    reason = examEvent?.description ?? 'exam window';
  } else {
    classification = 'regular';
    reason = 'regular instructional day';
  }

  return {
    date: cd.date,
    classification,
    isInstructionalDay: cd.isInstructionalDay,
    dayOfWeek: cd.dayOfWeek,
    bellScheduleId: cd.bellScheduleId,
    bellScheduleName: cd.bellScheduleName,
    reason,
  };
}

@Injectable()
export class ShiftResolverService {
  constructor(private readonly calendarDateService: CalendarDateService) {}

  /**
   * Resolve the shift profile for a single school+date.
   *
   * Throws NotFoundException (from CalendarDateService.getCalendarDate) when
   * no row exists for the date — caller's responsibility to interpret as
   * "calendar not yet generated for this date".
   */
  async resolve(
    schoolId: string,
    date: string,
    context: RequestContext,
  ): Promise<ShiftProfileResponse> {
    const cd = await this.calendarDateService.getCalendarDate(
      schoolId,
      date,
      context,
    );
    return classifyShiftFromCalendarDate(cd);
  }
}

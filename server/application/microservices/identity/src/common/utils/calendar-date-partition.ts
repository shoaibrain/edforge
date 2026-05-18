/**
 * Calendar-date source partitioning — shared utility.
 *
 * Splits a CalendarDate row set into:
 *   - `systemRowKeys`: entity keys of rows where BOTH `createdBy` and
 *     `updatedBy` equal `'SYSTEM'`. Safe to delete on regenerate or
 *     block-create — they were last written by the generator with no
 *     operator touch.
 *   - `preservedDates`: AD date strings (`YYYY-MM-DD`) for the rows
 *     the operator has either created from scratch or edited after
 *     generation.
 *
 * The dual-field "createdBy AND updatedBy = SYSTEM" gate is generous:
 * one operator edit on an auto-generated row promotes `updatedBy` to
 * a userId, and that's enough signal to preserve.
 *
 * Originally introduced in Sprint C3.8 (`generate-calendar` merge mode)
 * inside `schools/calendar-date.service.ts`. Extracted here in Sprint
 * C4-followup so `CalendarBlockService.createBlock` can apply the same
 * source-aware merge rule without duplicating logic — same operator-
 * override-is-sacred invariant across both write paths.
 *
 * Pure — no I/O. Safe at CDK synth time or in the request path.
 */

import type { CalendarDate } from '../entities/calendar-date.entity';

export interface PartitionedCalendarDates {
  /** Entity keys of CalendarDate rows that are safe to delete (SYSTEM-only). */
  systemRowKeys: string[];
  /** AD date strings the operator has touched (createdBy or updatedBy ≠ SYSTEM). */
  preservedDates: Set<string>;
}

export function partitionRowsBySource(
  rows: ReadonlyArray<CalendarDate>,
): PartitionedCalendarDates {
  const systemRowKeys: string[] = [];
  const preservedDates = new Set<string>();
  for (const row of rows) {
    const isSystem = row.createdBy === 'SYSTEM' && row.updatedBy === 'SYSTEM';
    if (isSystem) {
      systemRowKeys.push(row.entityKey);
    } else {
      preservedDates.add(row.date);
    }
  }
  return { systemRowKeys, preservedDates };
}

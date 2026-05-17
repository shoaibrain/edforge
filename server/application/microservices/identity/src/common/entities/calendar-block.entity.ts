/**
 * CalendarBlock Entity - Sprint C4 (Multi-Day Event Blocks)
 *
 * Operator-created umbrella for a multi-day event (Dashain, Tihar,
 * Summer Vacation, Term-1 exam week). Each block owns N child
 * CalendarDate rows; deleting the block cascades to those children.
 *
 * Persistence layout:
 *
 *   tenantId  = TENANT#{tenantId}
 *   entityKey = SCHOOL#{schoolId}#BLOCK#{blockId}
 *
 *   gsi1pk    = TENANT#{tenantId}#SCHOOL#{schoolId}
 *   gsi1sk    = CALBLOCK#{startDate}#{blockId}    (date-sortable; LIST scope)
 *
 * Child CalendarDate rows are queried by `blockId` via GSI9
 * (gsi9pk=BLOCK#{blockId}, gsi9sk=DATE#{date}) — see
 * docs/pilot-greenlight/gsi-inventory.md.
 */

import { BaseEntity } from './base.entity';

export type CalendarBlockDescriptor =
  | 'religious_festival'
  | 'school_vacation'
  | 'exam_block'
  | 'national_observance'
  | 'other';

export interface CalendarBlockSubEvent {
  date: string;        // YYYY-MM-DD (AD)
  name: string;
  description?: string;
}

export interface CalendarBlock extends BaseEntity {
  entityType: 'CALENDARBLOCK';

  // Identifiers
  blockId: string;
  schoolId: string;
  academicYearId: string;

  // Block metadata
  blockName: string;
  blockDescriptor: CalendarBlockDescriptor;
  startDate: string;       // YYYY-MM-DD (AD; inclusive)
  endDate: string;         // YYYY-MM-DD (AD; inclusive)
  childEventType: string;  // event type written on each child CalendarDate
  childDateCount: number;  // denormalized = (endDate - startDate + 1)

  // Optional named sub-events
  subEvents?: CalendarBlockSubEvent[];

  // Operator description (calendar-grid hover, etc.)
  description?: string;

  // GSI1 keys — school-scope LIST query.
  // PK matches the existing school-scope pattern used elsewhere.
  gsi1pk?: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  gsi1sk?: string;  // CALBLOCK#{startDate}#{blockId}  (date-sortable)
}

// ============================================
// Entity Key Builders
// ============================================

export const CalendarBlockKeyBuilder = {
  /**
   * CalendarBlock entity key: SCHOOL#{schoolId}#BLOCK#{blockId}
   */
  calendarBlock: (schoolId: string, blockId: string): string =>
    `SCHOOL#${schoolId}#BLOCK#${blockId}`,

  /**
   * Prefix for all blocks within a school: SCHOOL#{schoolId}#BLOCK#
   */
  calendarBlocksPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#BLOCK#`,

  /**
   * GSI1PK — school scope (matches the established pattern used by
   * the academics microservice for GSI1 reads).
   */
  schoolScope: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI1SK — sortable on startDate; suffix with blockId for uniqueness
   * when two blocks start on the same date.
   */
  blockDateSort: (startDate: string, blockId: string): string =>
    `CALBLOCK#${startDate}#${blockId}`,
};

// ============================================
// Factory
// ============================================

export function createCalendarBlockEntity(
  tenantId: string,
  schoolId: string,
  data: Omit<
    CalendarBlock,
    | 'tenantId'
    | 'entityKey'
    | 'entityType'
    | 'schoolId'
    | 'gsi1pk'
    | 'gsi1sk'
    | 'childDateCount'
  > & { childDateCount?: number },
): CalendarBlock {
  return {
    tenantId,
    entityKey: CalendarBlockKeyBuilder.calendarBlock(schoolId, data.blockId),
    entityType: 'CALENDARBLOCK',
    schoolId,
    ...data,
    childDateCount: data.childDateCount ?? computeChildDateCount(data.startDate, data.endDate),
    gsi1pk: CalendarBlockKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: CalendarBlockKeyBuilder.blockDateSort(data.startDate, data.blockId),
  };
}

/**
 * Count of inclusive days between startDate and endDate.
 *
 * UTC-safe — parses with explicit T12:00:00Z anchor to dodge the
 * negative-offset shift the C3.7 fix patched in `gregorianToBs`.
 * Pure; no I/O.
 */
export function computeChildDateCount(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days > 0 ? days : 0;
}

/**
 * Enumerate every AD date in the inclusive [startDate, endDate] range.
 * Used by the service to build child CalendarDate rows in a single
 * TransactWriteItems call.
 */
export function enumerateBlockDates(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
  const out: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().split('T')[0]);
  }
  return out;
}

/**
 * Calendar Block Schemas — Sprint C4 (Multi-Day Event Blocks)
 *
 * A `CalendarBlock` is the operator's umbrella for a multi-day event:
 *   - religious festivals (Dashain, Tihar, Holi)
 *   - school vacations (Summer Vacation, Winter Vacation)
 *   - exam blocks (Term-1 exam week)
 *
 * On block create, the service emits one CalendarBlock row + N child
 * CalendarDate rows (one per day in the range, atomically via
 * TransactWriteItems). Each child date carries `blockId` + the
 * denormalized `blockName` / `blockDescriptor` / optional
 * `subEventName` (for blocks with named sub-events, e.g.,
 * "Dashain Day 3 — Mahaastami").
 *
 * Per-day overrides on child dates survive a block PATCH (C4.4): the
 * service rewrites block-level fields but leaves anything the operator
 * has hand-edited on individual child rows intact.
 */

import { z } from 'zod';
import { dateSchema } from '../common';
import {
  calendarEventDescriptorSchema,
  calendarBlockDescriptorSchema,
  type CalendarEventDescriptor,
  type CalendarBlockDescriptor,
} from './calendar-date.schema';

// Re-export the descriptor for backward compatibility with consumers that
// import it from this module. Canonical home is calendar-date.schema.ts
// (avoids a circular import — block schema already imports from date schema).
export { calendarBlockDescriptorSchema };
export type { CalendarBlockDescriptor };

// ============================================
// Sub-event — optional named entries within a block
// ============================================

/**
 * Named sub-event within a multi-day block. Operators tag specific
 * days inside Dashain (Mahaastami, Nawami, Vijaya Dashami) or inside
 * an exam block ("Math paper", "English paper") without needing a
 * separate block per sub-event.
 *
 * The `date` is the AD calendar date the sub-event lands on. Must
 * fall within [block.startDate, block.endDate].
 */
export const calendarBlockSubEventSchema = z.object({
  date: dateSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(255).optional(),
});

export type CalendarBlockSubEvent = z.infer<typeof calendarBlockSubEventSchema>;

// ============================================
// Create / Update DTOs
// ============================================

export const createCalendarBlockSchema = z.object({
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),

  // Block identification
  blockName: z.string().min(1).max(120),
  blockDescriptor: calendarBlockDescriptorSchema,

  // Inclusive date range — both endpoints are written as CalendarDate
  // children. Cross-AY blocks are rejected (the service validates the
  // range falls within the AY's start/end).
  startDate: dateSchema,
  endDate: dateSchema,

  // The eventType written onto each child CalendarDate's `calendarEvents`
  // array. Defaults to `'break'` for vacations / religious festivals;
  // exam_block descriptors typically pass `'exam_window'`.
  childEventType: calendarEventDescriptorSchema.default('break'),

  // Optional named sub-events. Service validates each date falls within
  // the block's range.
  subEvents: z.array(calendarBlockSubEventSchema).max(50).optional(),

  // Description shown in the calendar grid hover.
  description: z.string().max(500).optional(),
}).refine(
  (data) => new Date(data.endDate) >= new Date(data.startDate),
  { message: 'endDate must be on or after startDate', path: ['endDate'] },
);

export type CreateCalendarBlockDto = z.infer<typeof createCalendarBlockSchema>;

/**
 * Update is intentionally narrow: only block-level metadata can be
 * updated. To change the date range, delete + recreate (preserves
 * the audit trail of "operator regretted the range" vs "operator
 * silently widened the range").
 */
export const updateCalendarBlockSchema = z.object({
  blockName: z.string().min(1).max(120).optional(),
  blockDescriptor: calendarBlockDescriptorSchema.optional(),
  description: z.string().max(500).optional(),
  subEvents: z.array(calendarBlockSubEventSchema).max(50).optional(),
}).refine(
  (data) =>
    data.blockName !== undefined ||
    data.blockDescriptor !== undefined ||
    data.description !== undefined ||
    data.subEvents !== undefined,
  { message: 'At least one field must be provided for update' },
);

export type UpdateCalendarBlockDto = z.infer<typeof updateCalendarBlockSchema>;

// ============================================
// Response shape
// ============================================

export const calendarBlockResponseSchema = z.object({
  blockId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  academicYearId: z.string().uuid(),

  blockName: z.string(),
  blockDescriptor: calendarBlockDescriptorSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  childEventType: calendarEventDescriptorSchema,
  childDateCount: z.number().int().min(1),

  subEvents: z.array(calendarBlockSubEventSchema).optional(),
  description: z.string().optional(),

  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

export type CalendarBlockResponseDto = z.infer<typeof calendarBlockResponseSchema>;

/**
 * List response — includes a brief shape (no full subEvents) to keep
 * the wire payload small for calendar setup screens. Detail screens
 * call `GET /calendar-blocks/:id` for the full record.
 */
export const calendarBlockListItemSchema = calendarBlockResponseSchema.pick({
  blockId: true,
  blockName: true,
  blockDescriptor: true,
  startDate: true,
  endDate: true,
  childEventType: true,
  childDateCount: true,
});
export type CalendarBlockListItemDto = z.infer<typeof calendarBlockListItemSchema>;

export const calendarBlockListResponseSchema = z.object({
  items: z.array(calendarBlockListItemSchema),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});
export type CalendarBlockListResponseDto = z.infer<typeof calendarBlockListResponseSchema>;

// ============================================
// Filter for LIST endpoint
// ============================================

export const calendarBlockFilterSchema = z.object({
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid().optional(),
  blockDescriptor: calendarBlockDescriptorSchema.optional(),
  /** Inclusive — blocks overlapping the [from, to] window are returned. */
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

export type CalendarBlockFilterDto = z.infer<typeof calendarBlockFilterSchema>;

/**
 * Re-export for ergonomics so identity service can grab everything
 * from a single import.
 */
export type { CalendarEventDescriptor };

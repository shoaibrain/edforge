/**
 * Calendar (multi-day event block) domain event schemas — Sprint C0.c.2.
 *
 * Three events covering the multi-day block CRUD lifecycle (Sprint C4):
 *
 *   - calendar.block_created — operator drags a multi-day range, names it
 *                              with sub-events; one event for the block
 *                              even though N child date rows are written
 *                              atomically.
 *   - calendar.block_updated — block-level rename or sub-event metadata
 *                              update. Per-day overrides on child dates
 *                              are preserved (C4.4 contract).
 *   - calendar.block_deleted — cascade-delete of the block and its N
 *                              child date rows.
 *
 * The existing `CalendarCreated` / `CalendarDateGenerated` /
 * `CalendarDateUpdated` events cover a different concept (school
 * calendars + per-date events). The block taxonomy is for the
 * multi-day block UX layered on top.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const calendarBlockCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('calendar.block_created'),
  blockId: z.string().min(1),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  blockName: z.string().min(1),
  blockDescriptor: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Count of child CalendarDate rows written atomically with the block. */
  dateCount: z.number().int().positive(),
});

export const calendarBlockUpdatedSchema = baseEventSchema.extend({
  eventType: z.literal('calendar.block_updated'),
  blockId: z.string().min(1),
  schoolId: z.string().min(1),
  updatedFields: z.array(z.string().min(1)).min(1),
});

export const calendarBlockDeletedSchema = baseEventSchema.extend({
  eventType: z.literal('calendar.block_deleted'),
  blockId: z.string().min(1),
  schoolId: z.string().min(1),
  deletedDateCount: z.number().int().nonnegative(),
});

export type CalendarBlockCreatedEvent = z.infer<typeof calendarBlockCreatedSchema>;
export type CalendarBlockUpdatedEvent = z.infer<typeof calendarBlockUpdatedSchema>;
export type CalendarBlockDeletedEvent = z.infer<typeof calendarBlockDeletedSchema>;

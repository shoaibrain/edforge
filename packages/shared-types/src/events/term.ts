/**
 * Term (GradingPeriod) domain event schemas — Sprint C0.c.2.
 *
 * Three events:
 *   - term.created         — emitted by GradingPeriodsService.create
 *   - term.updated         — emitted by GradingPeriodsService.update
 *   - term.exam_scheduled  — emitted when an exam window is attached to a term
 *
 * The existing service uses the noun "grading period"; the event taxonomy
 * uses "term" because that's the operational language across PABSON and
 * other archetypes. Both refer to the same DDB entity.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const termCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('term.created'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  termId: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const termUpdatedSchema = baseEventSchema.extend({
  eventType: z.literal('term.updated'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  termId: z.string().min(1),
  updatedFields: z.array(z.string().min(1)).min(1),
});

export const termExamScheduledSchema = baseEventSchema.extend({
  eventType: z.literal('term.exam_scheduled'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  termId: z.string().min(1),
  examWindowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  examWindowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type TermCreatedEvent = z.infer<typeof termCreatedSchema>;
export type TermUpdatedEvent = z.infer<typeof termUpdatedSchema>;
export type TermExamScheduledEvent = z.infer<typeof termExamScheduledSchema>;

/**
 * Exam domain event schemas — Sprint C0.c.2.
 *
 * Three events. None of these flow live in prod yet; they're the
 * Sprint C5 emission target. Carrying the schemas now means C5 can
 * implement the state machine without re-litigating event shapes.
 *
 *   - exam.created   — emitted by ExamsService.create (status=draft)
 *   - exam.closed    — emitted on state transition draft→...→closed.
 *                      Triggers the C7 result-generation Lambda.
 *   - exam.published — emitted when the operator publishes the exam
 *                      (status=published). Distinct from `result.published`
 *                      which signals per-card publication.
 *
 * Per invariant 8 — examType is a runtime string from the SchoolConfiguration
 * grading scale, NOT branched on archetype in code.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const examCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('exam.created'),
  examId: z.string().min(1),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  termId: z.string().min(1),
  examName: z.string().min(1),
  examType: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const examClosedSchema = baseEventSchema.extend({
  eventType: z.literal('exam.closed'),
  examId: z.string().min(1),
  schoolId: z.string().min(1),
  termId: z.string().min(1),
  closedAt: z.string().datetime({ offset: true }),
});

export const examPublishedSchema = baseEventSchema.extend({
  eventType: z.literal('exam.published'),
  examId: z.string().min(1),
  schoolId: z.string().min(1),
  termId: z.string().min(1),
  publishedAt: z.string().datetime({ offset: true }),
});

export type ExamCreatedEvent = z.infer<typeof examCreatedSchema>;
export type ExamClosedEvent = z.infer<typeof examClosedSchema>;
export type ExamPublishedEvent = z.infer<typeof examPublishedSchema>;

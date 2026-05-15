/**
 * Result domain event schemas — Sprint C0.c.2.
 *
 * One event:
 *   - result.published — emitted by ResultCardsService.publish for each
 *                        per-student per-term card. Triggers the C9.5
 *                        provisional → final enrollment flip on the
 *                        next AY (terminal-exam flag).
 *
 * Existing PascalCase `GradePublished` covers a related concept (grade
 * publication on the academics service); `result.published` is finer-
 * grained and per-card per the C7 ResultCard entity design.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const resultPublishedSchema = baseEventSchema.extend({
  eventType: z.literal('result.published'),
  cardId: z.string().min(1),
  enrollmentId: z.string().min(1),
  schoolId: z.string().min(1),
  termId: z.string().min(1),
  examId: z.string().min(1),
  /**
   * True when the exam this card belongs to is the terminal exam of the
   * AY. The C9.5 cross-year handoff flips next-AY provisional enrollments
   * to `enrolled` only on terminal-exam result publication; non-terminal
   * publishes (Term-1, Term-2, etc.) don't.
   */
  isTerminal: z.boolean(),
  publishedAt: z.string().datetime({ offset: true }),
});

export type ResultPublishedEvent = z.infer<typeof resultPublishedSchema>;

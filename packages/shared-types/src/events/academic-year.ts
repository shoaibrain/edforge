/**
 * Academic Year domain event schemas — Sprint C0.c.2.
 *
 * Three events covering the AY lifecycle:
 *   - academic_year.created   — emitted by AcademicYearsService.createAcademicYear
 *   - academic_year.activated — emitted by AcademicYearsService.setCurrent / updateStatus(active)
 *   - academic_year.completed — emitted when AY transitions to status=completed
 *
 * None of these flow live in prod yet; they're the C0.c emission target.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const academicYearCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('academic_year.created'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calendarType: z.enum(['semester', 'quarter', 'trimester', 'annual']),
});

export const academicYearActivatedSchema = baseEventSchema.extend({
  eventType: z.literal('academic_year.activated'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  activatedAt: z.string().datetime({ offset: true }),
});

export const academicYearCompletedSchema = baseEventSchema.extend({
  eventType: z.literal('academic_year.completed'),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  completedAt: z.string().datetime({ offset: true }),
});

export type AcademicYearCreatedEvent = z.infer<typeof academicYearCreatedSchema>;
export type AcademicYearActivatedEvent = z.infer<typeof academicYearActivatedSchema>;
export type AcademicYearCompletedEvent = z.infer<typeof academicYearCompletedSchema>;

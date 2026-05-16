/**
 * Enrollment domain event schemas — Sprint C0.c.2.
 *
 * Four events covering the enrollment lifecycle including the cross-year
 * promotion/retention handoff (Sprint C9 centerpiece):
 *
 *   - enrollment.created   — emitted on initial enrollment into an AY
 *   - enrollment.promoted  — emitted by batch-promote (creates next-AY
 *                            enrollment with priorEnrollmentId set)
 *   - enrollment.retained  — emitted when promotionDecision='retained'
 *                            and the next-AY gradeLevel is rewritten
 *                            to match the prior AY
 *   - enrollment.withdrawn — emitted on withdrawal from a school
 *
 * Invariant 3 reminder: every academic record references `enrollmentId`,
 * not raw `(studentId, date)`. These events carry `enrollmentId` as the
 * primary key; `studentId` is a denormalized convenience field for
 * downstream consumers.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const enrollmentCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('enrollment.created'),
  enrollmentId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  gradeLevel: z.string().min(1),
  status: z.enum(['provisional', 'enrolled', 'withdrawn']),
});

export const enrollmentPromotedSchema = baseEventSchema.extend({
  eventType: z.literal('enrollment.promoted'),
  enrollmentId: z.string().min(1),
  priorEnrollmentId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  fromYearId: z.string().min(1),
  toYearId: z.string().min(1),
  fromGradeLevel: z.string().min(1),
  toGradeLevel: z.string().min(1),
});

export const enrollmentRetainedSchema = baseEventSchema.extend({
  eventType: z.literal('enrollment.retained'),
  enrollmentId: z.string().min(1),
  priorEnrollmentId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  yearId: z.string().min(1),
  gradeLevel: z.string().min(1),
  reason: z.string().optional(),
});

export const enrollmentWithdrawnSchema = baseEventSchema.extend({
  eventType: z.literal('enrollment.withdrawn'),
  enrollmentId: z.string().min(1),
  studentId: z.string().min(1),
  schoolId: z.string().min(1),
  withdrawnAt: z.string().datetime({ offset: true }),
  reason: z.string().optional(),
});

export type EnrollmentCreatedEvent = z.infer<typeof enrollmentCreatedSchema>;
export type EnrollmentPromotedEvent = z.infer<typeof enrollmentPromotedSchema>;
export type EnrollmentRetainedEvent = z.infer<typeof enrollmentRetainedSchema>;
export type EnrollmentWithdrawnEvent = z.infer<typeof enrollmentWithdrawnSchema>;

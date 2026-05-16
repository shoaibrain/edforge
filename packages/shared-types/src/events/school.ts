/**
 * School domain event schemas — Sprint C0.c.2.
 *
 * Four events covering the school lifecycle:
 *   - school.created     — emitted by SchoolsService.createSchool
 *   - school.activated   — emitted by SchoolsService.transitionStatus(active)
 *   - school.updated     — emitted by SchoolsService.updateSchool
 *   - school.deactivated — emitted by SchoolsService.transitionStatus(inactive)
 *
 * The existing PascalCase `SchoolCreated` / `SchoolUpdated` event types
 * (identity-events.service.ts) continue to flow as-is. This taxonomy is
 * the forward-looking target; emit-site migration happens as their
 * owning code is touched.
 */

import { z } from 'zod';
import { baseEventSchema } from './base';

export const SCHOOL_TYPES = [
  'elementary',
  'middle',
  'high',
  'k12',
  'preschool',
  'other',
] as const;

export const schoolCreatedSchema = baseEventSchema.extend({
  eventType: z.literal('school.created'),
  schoolId: z.string().min(1),
  schoolCode: z.string().min(1),
  name: z.string().min(1),
  schoolType: z.enum(SCHOOL_TYPES),
});

export const schoolActivatedSchema = baseEventSchema.extend({
  eventType: z.literal('school.activated'),
  schoolId: z.string().min(1),
  activatedAt: z.string().datetime({ offset: true }),
});

export const schoolUpdatedSchema = baseEventSchema.extend({
  eventType: z.literal('school.updated'),
  schoolId: z.string().min(1),
  updatedFields: z.array(z.string().min(1)).min(1),
});

export const schoolDeactivatedSchema = baseEventSchema.extend({
  eventType: z.literal('school.deactivated'),
  schoolId: z.string().min(1),
  deactivatedAt: z.string().datetime({ offset: true }),
  reason: z.string().optional(),
});

export type SchoolCreatedEvent = z.infer<typeof schoolCreatedSchema>;
export type SchoolActivatedEvent = z.infer<typeof schoolActivatedSchema>;
export type SchoolUpdatedEvent = z.infer<typeof schoolUpdatedSchema>;
export type SchoolDeactivatedEvent = z.infer<typeof schoolDeactivatedSchema>;

/**
 * Family Group Schemas — EPIC-FB Sprint FB-1.1
 *
 * FamilyGroup lives in academics (the people domain owns relationships).
 * A family links students within ONE school so operators can answer
 * "students in family X" — the prerequisite for family-level billing
 * agreements (finance resolves families via the academics API and
 * snapshots what it needs; it never reads the academics table directly).
 *
 * V1 invariants (service-enforced; see epic §3.1):
 *   - a student belongs to at most one family
 *   - same-school families only (matches the school-scoped operator UI)
 *
 * @see docs/family-billing/family-billing-agreements-epic.md §3.1
 */

import { z } from 'zod';
import { uuidSchema, emailSchema, isoDateSchema } from '../common';
import { studentStatusSchema } from './student.schema';

// ============================================
// Primary contact
// ============================================

/**
 * The family's primary contact — a display/communication snapshot, NOT a
 * foreign key to an identity User or a student's embedded guardian. Live
 * pilot data carries no guardian emails/phones (epic §4.7 L4), so this is
 * operator-entered.
 */
export const familyPrimaryContactSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(20).optional(),
  email: emailSchema.optional(),
});

export type FamilyPrimaryContactDto = z.infer<typeof familyPrimaryContactSchema>;

// ============================================
// Response
// ============================================

export const familyResponseSchema = z.object({
  id: uuidSchema,
  schoolId: uuidSchema,
  /** Operator-facing family label, e.g. "Adhikari family". */
  name: z.string().min(1).max(120),
  primaryContact: familyPrimaryContactSchema,
  notes: z.string().max(500).optional(),

  // P1d — `isActive` (soft-delete flag) is intentionally NOT in the response
  // DTO. Deactivated families are filtered server-side; the flag stays on the
  // entity + filter schemas only. See CLAUDE.md "Two orthogonal axes".
  createdBy: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type FamilyResponseDto = z.infer<typeof familyResponseSchema>;

// ============================================
// Create / Update
// ============================================

export const createFamilySchema = z.object({
  schoolId: uuidSchema,
  name: z.string().min(1).max(120),
  primaryContact: familyPrimaryContactSchema,
  notes: z.string().max(500).optional(),
});

export type CreateFamilyDto = z.infer<typeof createFamilySchema>;

/**
 * Partial update. Identity fields (`id`, `schoolId`) are immutable —
 * they come from the route, never the body.
 */
export const updateFamilySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  primaryContact: familyPrimaryContactSchema.optional(),
  notes: z.string().max(500).optional(),
});

export type UpdateFamilyDto = z.infer<typeof updateFamilySchema>;

// ============================================
// Membership
// ============================================

/**
 * One family-member link row. `studentName` is denormalized at link time
 * (display convenience for the family panel; the student record stays the
 * source of truth).
 */
export const familyMemberSchema = z.object({
  familyId: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  relationshipNote: z.string().max(200).optional(),
  addedBy: z.string(),
  createdAt: isoDateSchema,
});

export type FamilyMemberDto = z.infer<typeof familyMemberSchema>;

/**
 * Request body for linking a student into a family
 * (`POST …/families/{familyId}/members`). The single-family invariant
 * (student already in another family → 409) is enforced service-side
 * via GSI2 pre-check + conditional put (FB-1.4).
 */
export const addFamilyMemberSchema = z.object({
  studentId: uuidSchema,
  relationshipNote: z.string().max(200).optional(),
});

export type AddFamilyMemberDto = z.infer<typeof addFamilyMemberSchema>;

// ============================================
// Student family view
// ============================================

/**
 * Response for `GET /academics/students/{studentId}/family` (FB-1.5).
 *
 * 200-with-null contract: an unlinked student is NOT a 404 — the endpoint
 * returns `{ family: null, siblings: [] }` so consumers (finance sibling
 * resolution, the student-profile panel) can treat "no family" as a normal
 * state, not an error. `siblings` excludes the subject student.
 */
export const studentFamilySiblingSchema = z.object({
  studentId: uuidSchema,
  studentName: z.string(),
  gradeLevel: z.string().optional(),
  /**
   * EPIC-FB FB-5.1 — the sibling's enrollment lifecycle status, projected
   * from the same batch-fetched student rows that supply `gradeLevel`.
   * Optional: absent when the student row was missing from the batch get
   * (or on pre-FB-5.1 academics builds). Finance's sibling-discount count
   * treats only `'active'` siblings as countable.
   */
  status: studentStatusSchema.optional(),
});

export type StudentFamilySiblingDto = z.infer<typeof studentFamilySiblingSchema>;

export const studentFamilyViewSchema = z.object({
  family: familyResponseSchema.nullable(),
  siblings: z.array(studentFamilySiblingSchema),
});

export type StudentFamilyViewDto = z.infer<typeof studentFamilyViewSchema>;

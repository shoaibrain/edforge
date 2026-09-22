/**
 * IEMIS Code Format Validators (Sprints 1 + 4, S1.1 + S4.6)
 *
 * Nepal's Integrated Educational Management Information System (IEMIS)
 * issues three identifier formats that EdForge treats as first-class:
 *
 *   - `emisSchoolCode`  — code issued by the local municipality to every
 *                         school registered with CEHRD. Required for schools
 *                         reporting to IEMIS (PABSON archetype in V1).
 *                         Immutable post-first-save. The regex here is a
 *                         deliberately loose 8–10 digit cross-archetype
 *                         format guard; CEHRD issues exactly 9 (encoding
 *                         province/district/local-level/school) and that
 *                         exact width is enforced for PABSON in
 *                         `SchoolsService.createSchool`, where the archetype
 *                         is known. Do not tighten it here — GENERIC and
 *                         future governance bodies must not inherit Nepal's
 *                         width.
 *   - `emisStudentId`   — 16 digit persistent student identifier issued
 *                         within IEMIS, after Flash I rather than at
 *                         enrolment (see #481).
 *
 *                         The student ID is understood to CARRY the school's
 *                         9-digit code, which is what makes 16 the right
 *                         length (9 + a 7-digit serial). That relationship is
 *                         why the school-code width above is load-bearing
 *                         rather than cosmetic.
 *
 *                         Deliberately NOT validated as a prefix today. CEHRD
 *                         does not publish the composition rule, and the
 *                         behaviour on school transfer is unknown: if the ID
 *                         follows the student, a transferred pupil's prefix
 *                         encodes their ORIGINAL school and a check against
 *                         the current one would reject exactly the cohort
 *                         that legitimately arrives holding an ID. Implement
 *                         prefix validation only once that rule is confirmed,
 *                         and gate it on `isTransferred`.
 *
 *                         `emisStudentId` is enforced unique per tenant via
 *                         GSI7. Note this is weaker than the identifier
 *                         itself: an ID embedding a national school code is
 *                         globally unique by construction, so a cross-tenant
 *                         collision more likely indicates bad data than a
 *                         genuine migration.
 *   - `emisStaffId`     — 16 digit persistent staff identifier issued
 *                         within IEMIS for reporting under CEHRD's Flash II
 *                         Staff module. Format mirrors `emisStudentId` in
 *                         V1 (CEHRD spec not yet confirmed — Sprint 11
 *                         tightens once the Staff export round-trips).
 *
 * These validators are format-only. Real verification against CEHRD
 * requires a lookup API that does not yet exist — a placeholder
 * endpoint returns `{ valid, reason? }` today (S1.5) so the contract
 * is future-compatible when CEHRD publishes one.
 */

import { z } from 'zod';

/** Strict digits-only, 8–10 characters. No spaces, no dashes. */
export const IEMIS_SCHOOL_CODE_REGEX = /^\d{8,10}$/;

/** Strict digits-only, exactly 16 characters. */
export const IEMIS_STUDENT_ID_REGEX = /^\d{16}$/;

/**
 * Strict digits-only, exactly 16 characters. Placeholder format per Sprint
 * 4 (S4.6): the CEHRD Staff register uses a similar length to the Student
 * register, but the official spec isn't published. Kept at 16 digits so the
 * regex is interchangeable with `IEMIS_STUDENT_ID_REGEX` for now; Sprint 11
 * tightens (or widens) this when the real Staff export round-trips.
 */
export const IEMIS_STAFF_ID_REGEX = /^\d{16}$/;

/**
 * Zod schema for an IEMIS school code. Accepts the canonical digits-only
 * form. Callers that allow user input with spaces should `.trim()` first
 * (we do NOT coerce here — silent coercion hides bad data).
 */
export const iemisSchoolCodeSchema = z
  .string({
    required_error: 'IEMIS school code is required',
    invalid_type_error: 'IEMIS school code must be a string',
  })
  .regex(IEMIS_SCHOOL_CODE_REGEX, {
    message: 'IEMIS school code must be 8–10 digits (digits only, no spaces or dashes)',
  });

/**
 * Zod schema for an IEMIS student ID (16 digits). Leading zeros are
 * valid and preserved (CEHRD issues them as left-padded strings, not
 * integers — `0012…` is NOT the same as `12…` to the portal).
 */
export const iemisStudentIdSchema = z
  .string({
    required_error: 'IEMIS student ID is required',
    invalid_type_error: 'IEMIS student ID must be a string',
  })
  .regex(IEMIS_STUDENT_ID_REGEX, {
    message: 'IEMIS student ID must be exactly 16 digits (digits only)',
  });

/**
 * Zod schema for an IEMIS staff ID (16 digits, placeholder spec — S4.6).
 * Mirrors `iemisStudentIdSchema` intentionally while the CEHRD Staff
 * module spec is confirmed (Sprint 11). Leading zeros preserved.
 */
export const iemisStaffIdSchema = z
  .string({
    required_error: 'IEMIS staff ID is required',
    invalid_type_error: 'IEMIS staff ID must be a string',
  })
  .regex(IEMIS_STAFF_ID_REGEX, {
    message: 'IEMIS staff ID must be exactly 16 digits (digits only)',
  });

export type IemisSchoolCode = z.infer<typeof iemisSchoolCodeSchema>;
export type IemisStudentId = z.infer<typeof iemisStudentIdSchema>;
export type IemisStaffId = z.infer<typeof iemisStaffIdSchema>;

/**
 * Pure helper: true iff the input is a well-formed IEMIS school code.
 * Use in contexts where a boolean is cleaner than a try/catch around
 * `.parse()` (e.g., UI guards, filter predicates).
 */
export function isValidIemisSchoolCode(code: unknown): code is IemisSchoolCode {
  return typeof code === 'string' && IEMIS_SCHOOL_CODE_REGEX.test(code);
}

/** Pure helper: true iff the input is a well-formed IEMIS student ID. */
export function isValidIemisStudentId(id: unknown): id is IemisStudentId {
  return typeof id === 'string' && IEMIS_STUDENT_ID_REGEX.test(id);
}

/**
 * Pure helper: true iff the input is a well-formed IEMIS staff ID.
 * Placeholder format per S4.6 — see the regex doc above.
 */
export function isValidIemisStaffId(id: unknown): id is IemisStaffId {
  return typeof id === 'string' && IEMIS_STAFF_ID_REGEX.test(id);
}

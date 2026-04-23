/**
 * IEMIS Code Format Validators (Sprint 1, S1.1)
 *
 * Nepal's Integrated Educational Management Information System (IEMIS)
 * issues two identifier formats that EdForge treats as first-class:
 *
 *   - `emisSchoolCode`  — 8–10 digit code issued by the local municipality
 *                         to every school registered with CEHRD. Required
 *                         for schools reporting to IEMIS (PABSON archetype
 *                         in V1). Immutable post-first-save.
 *   - `emisStudentId`   — 16 digit persistent student identifier issued
 *                         within IEMIS. Unique per tenant in EdForge;
 *                         cross-tenant collisions are intentional (a
 *                         student migrating between two EdForge tenants
 *                         retains their IEMIS ID in each).
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

export type IemisSchoolCode = z.infer<typeof iemisSchoolCodeSchema>;
export type IemisStudentId = z.infer<typeof iemisStudentIdSchema>;

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

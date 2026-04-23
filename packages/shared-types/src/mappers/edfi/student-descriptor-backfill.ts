/**
 * Student descriptor backfill — Sprint 3.
 *
 * Derives Ed-Fi descriptor URIs from the pre-Sprint-3 legacy Student fields
 * (`gender`, `primaryLanguage`, `ethnicity`). Existing tenants persisted those
 * free-form strings before we had a resolver; this helper lets the read path
 * and the UI show IEMIS-shaped data without a full data migration.
 *
 * Behavior:
 *   - Only populates descriptors that are currently missing. If a student row
 *     already has `sexDescriptor` set, this helper will NOT overwrite it.
 *   - Uses `resolveDescriptor()` — unrecognized legacy values stay as `null`
 *     (the UI shows "Not specified" per the Sprint 3 UX contract).
 *   - Pure function, no I/O. Safe to call on hundreds of rows in a map().
 *
 * This is NOT a persistence helper — callers decide whether to write back to
 * DDB. The intended usage is:
 *   1. Read path: `const enriched = deriveDescriptorsFromLegacy(student)` before returning to UI.
 *   2. Import path: if a pre-S3 row is being re-processed, enrich + save once.
 *   3. UI: treat as read-only derivation; never show the legacy free-form
 *      fields side-by-side with derived descriptors (confusing).
 */

import { resolveDescriptor } from '../../ed-fi/descriptors/resolve-descriptor';

/**
 * Minimal Student-shaped input accepted by the backfill. Any object with
 * these keys (optional) is fine — we don't care about the rest of the Student
 * shape. Using a structural type keeps this file decoupled from the full
 * `studentResponseSchema`.
 */
export interface LegacyStudentFields {
  gender?: string | null;
  primaryLanguage?: string | null;
  homeLanguage?: string | null;
  ethnicity?: string | null;
  sexDescriptor?: string | null;
  languageDescriptor?: string | null;
  motherTongueDescriptor?: string | null;
  ethnicityDescriptor?: string | null;
}

/** Output of the backfill — only the descriptor fields, ready to merge. */
export interface DerivedDescriptors {
  sexDescriptor?: string;
  languageDescriptor?: string;
  motherTongueDescriptor?: string;
  ethnicityDescriptor?: string;
}

/**
 * Pure derivation — returns only the descriptor fields that can be filled in
 * from the student's legacy fields without overwriting existing ones.
 *
 * Mapping:
 *   - `gender` "male"/"female"/"other"/"prefer_not_to_say" → `SexDescriptor` URI.
 *     `prefer_not_to_say` does NOT resolve (no Ed-Fi equivalent that preserves
 *     the user's intent — deliberately left unset).
 *   - `primaryLanguage` → `LanguageDescriptor` URI via resolver aliases.
 *   - `homeLanguage` → `motherTongueDescriptor` URI (closest semantic match in
 *     CEHRD Flash I).
 *   - `ethnicity` free-form → ethnicity catalog (Sprint 6); skipped in V1.
 */
export function deriveDescriptorsFromLegacy(
  student: LegacyStudentFields,
): DerivedDescriptors {
  const out: DerivedDescriptors = {};

  if (!student.sexDescriptor && student.gender) {
    const uri = resolveDescriptor('SexDescriptor', student.gender);
    if (uri) out.sexDescriptor = uri;
  }

  if (!student.languageDescriptor && student.primaryLanguage) {
    const uri = resolveDescriptor('LanguageDescriptor', student.primaryLanguage);
    if (uri) out.languageDescriptor = uri;
  }

  if (!student.motherTongueDescriptor && student.homeLanguage) {
    const uri = resolveDescriptor('LanguageDescriptor', student.homeLanguage);
    if (uri) out.motherTongueDescriptor = uri;
  }

  // ethnicityDescriptor intentionally skipped — Sprint 6 ships the catalog.

  return out;
}

/**
 * Returns a shallow-merged copy of `student` with derived descriptors filled
 * in (non-destructive). Existing descriptor values on `student` win.
 */
export function enrichStudentWithDerivedDescriptors<T extends LegacyStudentFields>(
  student: T,
): T & DerivedDescriptors {
  const derived = deriveDescriptorsFromLegacy(student);
  return { ...student, ...derived } as T & DerivedDescriptors;
}

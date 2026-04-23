/**
 * StudentSchoolAssociation mapper — Sprint 3 (S3.2, S3.3, S3.5).
 *
 * EdForge stores enrollments as the internal `Enrollment` entity (see
 * `server/application/microservices/academics/src/common/entities/enrollment.entity.ts`);
 * this mapper projects that row into the Ed-Fi 5.x `StudentSchoolAssociation`
 * resource shape so exporters and API consumers see canonical Ed-Fi data
 * without requiring duplicate DDB rows.
 *
 * Canonical Ed-Fi reference:
 *   https://api.ed-fi.org/v5/api/data/v3/ed-fi/studentSchoolAssociations
 *
 * This is a *read* mapper only — write operations stay on the Enrollment path
 * (create / update / withdraw / transfer). Sprint 10's Flash I exporter is
 * the primary consumer.
 *
 * Fields intentionally omitted vs Ed-Fi canonical:
 *   - `classOfSchoolYearTypeReference` — not tracked in V1 Enrollment
 *   - `educationOrganizationReference` — schoolId already carries it
 *   - `nextYearSchoolReference` — not tracked
 *   - `studentReference` — studentUniqueId + tenantId carry it
 * Add them as the Enrollment entity grows; keep the mapper strictly
 * dataloss-free — any new Enrollment field that matters for IEMIS must be
 * projected here.
 */

import { z } from 'zod';
import {
  exitWithdrawTypeDescriptorUriSchema,
  gradeLevelDescriptorUriSchema,
  anyEdFiDescriptorUriSchema,
} from '../../ed-fi/descriptors/descriptor-uri-schema';

// ---------------------------------------------------------------------------
// Input — the minimum Enrollment-shaped fields we need to project.
// ---------------------------------------------------------------------------

/**
 * Structural type covering only the Enrollment fields this mapper reads.
 * Keeps the mapper decoupled from the full Enrollment TS definition (which
 * lives in the academics microservice, not shared-types).
 */
export interface EnrollmentForSsaProjection {
  tenantId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string;
  gradeLevel: string;
  entryDate: string;
  exitWithdrawDate?: string;
  entryGradeLevelDescriptor?: string;
  entryTypeDescriptor?: string;
  exitWithdrawTypeDescriptor?: string;
  primarySchool?: boolean;
  studentName?: string;
}

/** AcademicYear-shaped subset read by the SchoolYearType resolver (S3.5). */
export interface AcademicYearForSchoolYearType {
  academicYearId?: string;
  id?: string;
  yearId?: string;
  /** e.g. "2082-2083" or "2082/2083" — the display form. */
  name?: string;
  /** BS start year (e.g. 2082). When present, preferred over parsing `name`. */
  startYearBS?: number;
  /** Gregorian start year (e.g. 2025) — fallback when BS year isn't stored. */
  startYear?: number;
}

// ---------------------------------------------------------------------------
// S3.5 — SchoolYearType Ed-Fi reference type.
// ---------------------------------------------------------------------------

/**
 * Ed-Fi `SchoolYearType` is a simple reference — a four-digit year plus the
 * human-readable description (typically "YYYY-YYYY"). In the IEMIS context we
 * emit the BS year (e.g. 2082) because Flash I reports are filed in BS; the
 * Gregorian equivalent is derivable but not the primary key for CEHRD.
 */
export interface SchoolYearType {
  schoolYear: number;
  schoolYearDescription: string;
  currentSchoolYear?: boolean;
  /** 1-based term index — Ed-Fi leaves this optional. */
  beginDate?: string;
  endDate?: string;
}

export const schoolYearTypeSchema = z
  .object({
    schoolYear: z.number().int().gte(2000).lte(2100),
    schoolYearDescription: z.string().min(1).max(32),
    currentSchoolYear: z.boolean().optional(),
    beginDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .strict();

/**
 * Parse an AcademicYear into an Ed-Fi SchoolYearType reference. `schoolYear`
 * is the BS start year when available; falls back to parsing `name`.
 *
 * Returns `null` when neither explicit year nor parseable name is present —
 * better to skip the reference than emit a wrong year into a Flash I export.
 */
export function academicYearToSchoolYearType(
  year: AcademicYearForSchoolYearType,
): SchoolYearType | null {
  const derivedYear = pickSchoolYear(year);
  if (derivedYear === null) return null;

  const description = year.name && year.name.length > 0
    ? year.name
    : String(derivedYear);

  return {
    schoolYear: derivedYear,
    schoolYearDescription: description,
  };
}

function pickSchoolYear(year: AcademicYearForSchoolYearType): number | null {
  if (typeof year.startYearBS === 'number') return year.startYearBS;
  if (typeof year.startYear === 'number') return year.startYear;
  // Parse "2082-2083" / "2082/2083" / "2082" — BS convention preferred.
  if (year.name) {
    const m = year.name.match(/\b(\d{4})\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// S3.2 / S3.3 — the StudentSchoolAssociation projection itself.
// ---------------------------------------------------------------------------

/**
 * Ed-Fi StudentSchoolAssociation projection. The canonical composite key is
 * (studentUniqueId, schoolId, schoolYear, entryDate) — we compose a string
 * `studentSchoolAssociationId` for convenience but downstream consumers
 * should key on the composite.
 */
export interface StudentSchoolAssociation {
  studentSchoolAssociationId: string;
  tenantId: string;
  studentUniqueId: string;
  schoolId: string;
  schoolYearId: string;
  schoolYear?: SchoolYearType;
  entryDate: string;
  entryGradeLevelDescriptor?: string;
  entryTypeDescriptor?: string;
  exitWithdrawDate?: string;
  exitWithdrawTypeDescriptor?: string;
  primarySchool: boolean;
  // Convenience payload for UIs that want to avoid a separate Student fetch
  studentName?: string;
}

export const studentSchoolAssociationSchema = z
  .object({
    studentSchoolAssociationId: z.string().min(1),
    tenantId: z.string().min(1),
    studentUniqueId: z.string().min(1),
    schoolId: z.string().uuid(),
    schoolYearId: z.string().min(1),
    schoolYear: schoolYearTypeSchema.optional(),
    entryDate: z.string().min(1),
    entryGradeLevelDescriptor: gradeLevelDescriptorUriSchema.optional(),
    entryTypeDescriptor: anyEdFiDescriptorUriSchema.optional(),
    exitWithdrawDate: z.string().optional(),
    exitWithdrawTypeDescriptor: exitWithdrawTypeDescriptorUriSchema.optional(),
    primarySchool: z.boolean(),
    studentName: z.string().optional(),
  })
  .strict();

/**
 * Project an Enrollment row plus its matching AcademicYear into the canonical
 * `StudentSchoolAssociation` shape. Pass-through mapping — no business logic,
 * no enrichment. Exporters wrap this with IEMIS-specific post-processing.
 */
export function enrollmentToStudentSchoolAssociation(
  enrollment: EnrollmentForSsaProjection,
  academicYear: AcademicYearForSchoolYearType | null = null,
): StudentSchoolAssociation {
  const schoolYear =
    academicYear !== null ? academicYearToSchoolYearType(academicYear) ?? undefined : undefined;

  return {
    studentSchoolAssociationId: buildStudentSchoolAssociationId(enrollment),
    tenantId: enrollment.tenantId,
    studentUniqueId: enrollment.studentId,
    schoolId: enrollment.schoolId,
    schoolYearId: enrollment.academicYearId,
    schoolYear,
    entryDate: enrollment.entryDate,
    entryGradeLevelDescriptor: enrollment.entryGradeLevelDescriptor,
    entryTypeDescriptor: enrollment.entryTypeDescriptor,
    exitWithdrawDate: enrollment.exitWithdrawDate,
    exitWithdrawTypeDescriptor: enrollment.exitWithdrawTypeDescriptor,
    primarySchool: enrollment.primarySchool ?? true,
    studentName: enrollment.studentName,
  };
}

/**
 * Build the canonical composite id. Mirrors the Enrollment entity's SK so
 * every consumer sees the same external identifier.
 */
export function buildStudentSchoolAssociationId(
  enrollment: Pick<EnrollmentForSsaProjection, 'schoolId' | 'academicYearId' | 'studentId'>,
): string {
  return `SSA#${enrollment.schoolId}#${enrollment.academicYearId}#${enrollment.studentId}`;
}

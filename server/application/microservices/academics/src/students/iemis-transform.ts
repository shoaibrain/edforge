/**
 * IEMIS (Integrated Educational Management Information System) row transformer.
 *
 * Project Midnight Lockin P0.6 — PABSON (Nepal) archetype pilot for
 * Saraswati English Boarding School. Converts one IEMIS CSV row (exported
 * from CEHRD's government portal) into a EdForge `CreateStudentDto` plus
 * any warnings/errors.
 *
 * The upstream data is messy by design (779 rows of real-world IEMIS
 * output). We tolerate known quirks at the edges rather than rejecting
 * rows wholesale — our goal is to preserve as much of the government
 * record as possible while yielding clean downstream data.
 *
 * Quirks handled:
 *   - BS date format variants: `2072-3-13` (non-padded) vs `2072-06-10`
 *   - Whitespace on every field (`"   Roshani  Khatun   "`)
 *   - Address literals like `-null,` treated as null
 *   - Parent name `Na`/`NA`/`na` treated as null
 *   - Placeholder phone `123` treated as null (with warning, not error)
 *   - Mixed-case names (ALL CAPS and Title Case both present in one file)
 *   - Compound Nepali names split on LAST space, not first
 *   - ECD/PPC accepted as grade levels (PABSON-specific, P0.9)
 *   - Gender `M`/`F`/`Male`/`Female` all normalized (P0.5)
 *   - IEMIS `Student Id` preserved as `emisStudentId` (P0.2)
 *
 * The transform is pure — no I/O, no side effects. Callers are responsible
 * for uniqueness (via GSI7 in `students.service.findByEmisStudentId`) and
 * persistence.
 */

import type { CreateStudentDto, Gender, GuardianDto } from '@aibrains/shared-types';
import { parseBsDate, resolveDescriptor } from '@aibrains/shared-types';
import {
  normalizeGender,
  cleanNullish,
  cleanPhone,
  splitFullNameLastSpace,
  isValidGradeForArchetype,
  normalizeName,
} from '../common/utils/import-normalize';

// ============================================================================
// TYPES
// ============================================================================

/** Raw IEMIS row — column names match the IEMIS CSV export. */
export interface IemisRow {
  'S.N'?: string | number;
  'IEMIS Code'?: string;
  'Current School'?: string;
  'Student Id'?: string;
  'FullName'?: string;
  'Gender'?: string;
  'Father Name'?: string;
  'Mother Name'?: string;
  'CurrentClass'?: string;
  'Section'?: string;
  'Year'?: string | number;
  'Permanent Address'?: string;
  'Temporary Address'?: string;
  'DOB'?: string;
  'Is Transferred'?: string;
  'Mother Tongue'?: string;
  'Disability Type'?: string;
  'Age'?: string | number;
  'Guardian Name'?: string;
  'Guardian Contact Number'?: string;
}

/** Severity of a row-level finding. `error` blocks the row; `warn` is informational. */
export type IemisFindingLevel = 'warn' | 'error';

/** A single row-level finding (error or warning). */
export interface IemisFinding {
  row: number;
  field: string;
  level: IemisFindingLevel;
  message: string;
}

/** Transform output for a single row. */
export interface IemisTransformResult {
  /** Row number (1-based for operator display). */
  row: number;
  /** Normalized DTO ready for `createStudent`, or null if any error. */
  dto: CreateStudentDto | null;
  /** emisStudentId, split out for dedup convenience. null if missing. */
  emisStudentId: string | null;
  /** Warnings + errors collected during transformation. */
  findings: IemisFinding[];
}

/** Options to influence transform behavior. */
export interface IemisTransformOptions {
  /** Required — archetype gate for grade taxonomy and BS date handling. */
  archetype: 'PABSON' | 'GENERIC';
  /** Required — destination school's EdForge UUID. */
  schoolId: string;
  /**
   * Optional — the IEMIS School Code from the destination `School.emisSchoolCode`.
   * If provided and the row's `IEMIS Code` disagrees, emit a warning.
   */
  expectedIemisSchoolCode?: string;
}

// ============================================================================
// TRANSFORM
// ============================================================================

/**
 * Transform one IEMIS row. Always returns a result with findings; `dto` is
 * non-null only when all required fields are present and valid.
 */
export function transformIemisRow(
  row: IemisRow,
  rowNumber: number,
  opts: IemisTransformOptions,
): IemisTransformResult {
  const findings: IemisFinding[] = [];
  const err = (field: string, message: string) =>
    findings.push({ row: rowNumber, field, level: 'error', message });
  const warn = (field: string, message: string) =>
    findings.push({ row: rowNumber, field, level: 'warn', message });

  // ── emisStudentId ──
  const emisStudentId = cleanNullish(row['Student Id']);
  if (!emisStudentId) {
    err('Student Id', 'IEMIS Student Id is required');
  }

  // ── IEMIS School Code (warn on mismatch) ──
  const iemisSchoolCode = cleanNullish(row['IEMIS Code']);
  if (iemisSchoolCode && opts.expectedIemisSchoolCode && iemisSchoolCode !== opts.expectedIemisSchoolCode) {
    warn(
      'IEMIS Code',
      `Row's IEMIS Code "${iemisSchoolCode}" does not match destination school "${opts.expectedIemisSchoolCode}"`,
    );
  }

  // ── Name: split on last space, preserve compound given names ──
  const { first, last } = splitFullNameLastSpace(row['FullName']);
  const firstName = normalizeName(first);
  const lastName = normalizeName(last);
  if (!firstName) err('FullName', 'First name missing (FullName empty)');
  if (!lastName) {
    // A single-token name is valid in some cultures but breaks Ed-Fi which
    // requires last name. Use first name as last name fallback so row still
    // imports; operator can edit later.
    warn('FullName', 'No last name in FullName — using first name as last name');
  }

  // ── Gender ──
  const gender: Gender | null = normalizeGender(row['Gender']);
  if (!gender) {
    err('Gender', `Unknown gender value: "${row['Gender']}"`);
  }

  // ── DOB: BS → Gregorian for PABSON, expect Gregorian otherwise ──
  let dateOfBirth = '';
  const rawDob = cleanNullish(row['DOB']);
  if (!rawDob) {
    err('DOB', 'Date of birth is required');
  } else if (opts.archetype === 'PABSON') {
    try {
      // IEMIS dates may omit zero-padding ("2072-3-13"). parseBsDate handles
      // both `/` and `-` separators; normalize padding first for robustness.
      const padded = padBsDate(rawDob);
      dateOfBirth = parseBsDate(padded);
    } catch (e: any) {
      err('DOB', `Invalid BS date "${rawDob}": ${e.message}`);
    }
  } else {
    // Generic archetype — expect Gregorian ISO.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
      err('DOB', `Invalid Gregorian date "${rawDob}" (expected YYYY-MM-DD)`);
    } else {
      dateOfBirth = rawDob;
    }
  }

  // ── Grade level ──
  const rawClass = cleanNullish(row['CurrentClass']);
  const currentGradeLevel = rawClass ? normalizeGradeLevel(rawClass) : '';
  if (!currentGradeLevel) {
    err('CurrentClass', 'Grade level is required');
  } else if (!isValidGradeForArchetype(currentGradeLevel, opts.archetype)) {
    err('CurrentClass', `Invalid grade "${currentGradeLevel}" for archetype ${opts.archetype}`);
  } else if (rawClass && COMBINED_BAND_ECD_PPC.test(rawClass)) {
    // Sprint C3 / BUG-S7 — Saraswati's IEMIS file uses `ECD/PPC` for the
    // combined pre-primary cohort. The student is admitted at ECD by
    // default; flag the row so the operator can re-classify to PPC if the
    // school's roster intends that band.
    warn(
      'CurrentClass',
      `Combined band "${rawClass.trim()}" — placed in ECD; manual review recommended`,
    );
  }

  // ── Guardians: father / mother / guardian as separate contact records ──
  const guardians: GuardianDto[] = [];
  const pushGuardian = (
    nameRaw: unknown,
    relationship: 'father' | 'mother' | 'guardian',
    phoneRaw?: unknown,
  ) => {
    const cleaned = cleanNullish(nameRaw);
    if (!cleaned) return;
    const { first: gFirst, last: gLast } = splitFullNameLastSpace(cleaned);
    const gFirstNorm = normalizeName(gFirst);
    const gLastNorm = normalizeName(gLast) || gFirstNorm;
    const phone = cleanPhone(phoneRaw);
    if (phoneRaw && !phone) {
      warn(`${relationship} phone`, `Placeholder or invalid phone "${phoneRaw}" — stored as null`);
    }
    guardians.push({
      relationship,
      firstName: gFirstNorm,
      lastName: gLastNorm,
      phone: phone ?? undefined,
      isPrimary: guardians.length === 0,
      hasPortalAccess: false,
      canPickup: true,
    });
  };
  pushGuardian(row['Father Name'], 'father');
  pushGuardian(row['Mother Name'], 'mother');
  // "Guardian Name" is a separate person in IEMIS (e.g. an uncle serving as guardian)
  // and may share a contact number with the child.
  pushGuardian(row['Guardian Name'], 'guardian', row['Guardian Contact Number']);

  // ── Addresses ──
  const permanentAddress = cleanNullish(row['Permanent Address']);
  const temporaryAddress = cleanNullish(row['Temporary Address']);

  // ── Sprint D0a.2 (ENG-2) — Ed-Fi descriptor fields ──
  // Previously the transformer dropped `Mother Tongue`, `Is Transferred`,
  // `Disability Type` at DTO build, and never derived `sexDescriptor` from
  // `Gender`. The audit on 2026-05-19 found 204/206 of Saraswati's imported
  // records null on these four fields. Phase F C10 IEMIS submission needs
  // them. Resolution uses `resolveDescriptor` (from shared-types) so the
  // CEHRD/Nepal-specific aliases (Maithili, Bhojpuri, Tharu, etc.) come
  // from the canonical catalog and stay in sync with the rest of the system.

  // sexDescriptor — derive from the already-normalized Gender. Should
  // always resolve since normalizeGender produces canonical male/female/other.
  const sexDescriptor = gender
    ? resolveDescriptor('SexDescriptor', gender) ?? undefined
    : undefined;

  // motherTongueDescriptor — Mother Tongue → Ed-Fi LanguageDescriptor.
  // Unknown emits warning + leaves field unset (no fallback URI invented).
  let motherTongueDescriptor: string | undefined;
  const rawMotherTongue = cleanNullish(row['Mother Tongue']);
  if (rawMotherTongue) {
    const uri = resolveDescriptor('LanguageDescriptor', rawMotherTongue);
    if (uri) {
      motherTongueDescriptor = uri;
    } else {
      warn(
        'Mother Tongue',
        `Unknown language "${rawMotherTongue}" — not mapped to Ed-Fi descriptor; field left blank`,
      );
    }
  }

  // disabilities — Disability Type → Ed-Fi DisabilityDescriptor.
  // "No Disability" is a valid descriptor in the catalog and is recorded
  // explicitly (differentiates "asked + confirmed none" from "never asked").
  let disabilities: Array<{ descriptor: string }> | undefined;
  const rawDisability = cleanNullish(row['Disability Type']);
  if (rawDisability) {
    const uri = resolveDescriptor('DisabilityDescriptor', rawDisability);
    if (uri) {
      disabilities = [{ descriptor: uri }];
    } else {
      warn(
        'Disability Type',
        `Unknown disability "${rawDisability}" — not mapped to Ed-Fi descriptor; field left blank`,
      );
    }
  }

  // isTransferred — parse boolean from yes/no/true/false (case-insensitive).
  const isTransferred = parseIsTransferred(row['Is Transferred'], warn);

  // If any errors, return early with null DTO.
  if (findings.some((f) => f.level === 'error')) {
    return { row: rowNumber, dto: null, emisStudentId, findings };
  }

  const dto: CreateStudentDto = {
    firstName,
    lastName: lastName || firstName,
    dateOfBirth,
    gender: gender!,
    schoolId: opts.schoolId,
    currentGradeLevel,
    emisStudentId: emisStudentId!,
    guardians: guardians.length > 0 ? guardians : undefined,
    contactInfo: permanentAddress || temporaryAddress ? {
      address: permanentAddress
        ? parseNepaliAddress(permanentAddress, 'permanent')
        : undefined,
      mailingAddress: temporaryAddress && temporaryAddress !== permanentAddress
        ? parseNepaliAddress(temporaryAddress, 'temporary')
        : undefined,
      useMailingAddress: !!temporaryAddress && temporaryAddress !== permanentAddress,
    } : undefined,
    // Sprint D0a.2 — Ed-Fi descriptor fields (all optional; populated only
    // when the IEMIS row supplied a recognized value).
    sexDescriptor,
    motherTongueDescriptor,
    disabilities,
    isTransferred,
  };

  return { row: rowNumber, dto, emisStudentId, findings };
}

/**
 * Parse the `Is Transferred` column into a boolean. Accepts yes/no/y/n/true/
 * false/1/0 case-insensitively. Unknown emits a warning and returns
 * undefined so the row still imports.
 *
 * Sprint D0a.2 (ENG-2).
 */
function parseIsTransferred(
  raw: unknown,
  warn: (field: string, message: string) => void,
): boolean | undefined {
  const cleaned = cleanNullish(raw);
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(lower)) return true;
  if (['no', 'n', 'false', '0'].includes(lower)) return false;
  warn(
    'Is Transferred',
    `Unrecognized value "${cleaned}" — expected yes/no/true/false; field left blank`,
  );
  return undefined;
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Pad BS date parts with leading zeros so `parseBsDate` (which expects
 * YYYY/MM/DD or YYYY-MM-DD with 4/2/2 digits) works for either
 * "2072-3-13" or "2072-06-10".
 */
function padBsDate(s: string): string {
  const parts = s.split(/[\/\-]/);
  if (parts.length !== 3) return s;
  const [y, m, d] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Match the IEMIS combined-band token used by some PABSON exporters
 * (Saraswati's actual export uses `ECD/PPC` for the pre-primary cohort).
 * Tolerates whitespace around the slash and either case. Sprint C3 / BUG-S7.
 */
export const COMBINED_BAND_ECD_PPC = /^\s*ECD\s*\/\s*PPC\s*$/i;

/**
 * Normalize an IEMIS CurrentClass token into a canonical grade code.
 * IEMIS uses `ECD`, `PPC`, `1`..`12` directly; accept common variants
 * like `Class 5`, `Grade 5`, `G5`, lowercase `ecd`.
 *
 * Combined-band tokens (`ECD/PPC` in Saraswati's chunk1.xlsx) resolve to
 * `'ECD'` as the canonical PABSON pre-primary placement — the transform
 * layer surfaces a warning so the operator can re-classify if needed.
 * No new Ed-Fi descriptor invented; uses existing `EarlyChildhoodDevelopment`.
 */
export function normalizeGradeLevel(raw: string): string {
  const s = raw.trim();
  const upper = s.toUpperCase();
  if (COMBINED_BAND_ECD_PPC.test(upper)) {
    return 'ECD';
  }
  if (upper === 'ECD' || upper === 'PPC' || upper === 'PK' || upper === 'K') {
    return upper;
  }
  // Strip common prefixes
  const stripped = upper
    .replace(/^CLASS\s*/, '')
    .replace(/^GRADE\s*/, '')
    .replace(/^G\s*/, '')
    .trim();
  if (/^(1[0-2]|[1-9])$/.test(stripped)) {
    return stripped;
  }
  return '';
}

/**
 * Parse a Nepali-style address like `Kshireshwarnath-9, Dhanusha` into an
 * EdForge address shape. Best-effort — IEMIS doesn't give us structured
 * address fields, so we preserve the original string in `street1` and
 * attempt to extract district + ward from the comma pattern.
 */
function parseNepaliAddress(
  addr: string,
  _kind: 'permanent' | 'temporary',
): CreateStudentDto['contactInfo'] extends { address?: infer A } ? A : never {
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  const municipality = parts[0] || addr;
  const district = parts[1];
  // Try to extract ward number from "Kshireshwarnath-9"
  const wardMatch = municipality.match(/-(\d+)\s*$/);
  const wardNumber = wardMatch ? wardMatch[1] : undefined;
  return {
    street1: addr,
    city: municipality.replace(/-\d+\s*$/, '').trim() || municipality,
    state: district || '',
    zipCode: '',
    country: 'NPL',
    ...(wardNumber ? { wardNumber } : {}),
    ...(district ? { district } : {}),
  } as any;
}

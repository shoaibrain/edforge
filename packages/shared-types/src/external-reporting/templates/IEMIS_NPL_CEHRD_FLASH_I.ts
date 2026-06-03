/**
 * IEMIS NPL CEHRD Flash I — Template descriptor (Sprint E.1.2)
 *
 * Canonical column → source-path mapping for the CEHRD Flash I CSV
 * upload (intake / beginning-of-year census). Schema per the v3.4
 * research artifact `docs/pilot-greenlight/e1-flash-csv-schema.md` §11.
 *
 * Cadence: due end of Jestha (mid-June BS), ~2 months after AY starts.
 *
 * The runtime template config is loaded from S3 at Lambda invocation
 * time (E.1.3) so CEHRD header renames can be hot-fixed via S3 PutObject
 * without backend redeploy. This TS file declares the canonical
 * schema-version of the template + its column dimensions for type
 * safety + roundtrip property tests in shared-types.
 */

export const FLASH_I_TEMPLATE_ID = 'IEMIS_NPL_CEHRD_FLASH_I' as const;
export const FLASH_I_SCHEMA_VERSION = 'v1' as const;

/**
 * Source-path expression for one column. The Lambda resolves these
 * against the joined Student + Enrollment + Session result row.
 *
 * Future enhancement: full JMESPath. For v1, simple dot-paths.
 */
export interface FlashISourcePath {
  /** Dot-path into the merged row: `student.firstName`, `enrollment.gradeLevel`, etc. */
  path: string;
  /** Optional descriptor-to-display-string transform. */
  transform?:
    | 'sexDescriptorToMF'
    | 'ethnicityDescriptorToBand'
    | 'languageDescriptorToName'
    | 'disabilityFirstDescriptorToName'
    | 'gregorianDateToBs'
    | 'schoolGradeToCanonical';
  /** Conditional emit — column populated only when the predicate matches. */
  conditional?: 'grade1Only' | 'grade11_12Only';
}

export interface FlashIColumnSpec {
  /** Canonical CSV column header (matches CEHRD published template). */
  header: string;
  /** Stable code-side name for reference (snake_case). */
  name: string;
  /** Whether the column is required or optional. */
  required: boolean;
  /** Where to read the value from. */
  source: FlashISourcePath;
  /** Order in the CSV output (1-based, matches research §11 col numbers). */
  order: number;
}

/**
 * The 13 (effective 14 with conditional has_eced_exp) columns of Flash I.
 * Order matches `docs/pilot-greenlight/e1-flash-csv-schema.md` §11
 * exactly. Headers are placeholder English; the S3-versioned config
 * overrides them with the exact strings IEMIS rejects/accepts at
 * upload time (operator iterates).
 */
export const FLASH_I_COLUMNS: FlashIColumnSpec[] = [
  {
    order: 1,
    name: 'school_iemis_code',
    header: 'school_iemis_code',
    required: true,
    source: { path: 'school.emisCode' },
  },
  {
    order: 2,
    name: 'academic_year_bs',
    header: 'academic_year_bs',
    required: true,
    source: { path: 'session.yearBs' },
  },
  {
    order: 3,
    name: 'student_iemis_id',
    header: 'student_iemis_id',
    required: false,
    source: { path: 'student.emisStudentId' },
  },
  {
    order: 4,
    name: 'first_name',
    header: 'first_name',
    required: true,
    source: { path: 'student.firstName' },
  },
  {
    order: 5,
    name: 'last_name',
    header: 'last_name',
    required: true,
    source: { path: 'student.lastName' },
  },
  {
    order: 6,
    name: 'dob_bs',
    header: 'dob_bs',
    required: true,
    source: { path: 'student.dateOfBirth', transform: 'gregorianDateToBs' },
  },
  {
    order: 7,
    name: 'gender',
    header: 'gender',
    required: true,
    source: { path: 'student.sexDescriptor', transform: 'sexDescriptorToMF' },
  },
  {
    order: 8,
    name: 'caste_ethnicity',
    header: 'caste_ethnicity',
    required: true,
    source: { path: 'student.ethnicityDescriptor', transform: 'ethnicityDescriptorToBand' },
  },
  {
    order: 9,
    name: 'mother_tongue',
    header: 'mother_tongue',
    required: true,
    source: { path: 'student.motherTongueDescriptor', transform: 'languageDescriptorToName' },
  },
  {
    order: 10,
    name: 'disability_type',
    header: 'disability_type',
    required: false,
    source: { path: 'student.disabilities', transform: 'disabilityFirstDescriptorToName' },
  },
  {
    order: 11,
    name: 'grade_level',
    header: 'grade_level',
    required: true,
    // School-first design: enrollment.gradeLevel carries the school's
    // operator-chosen local code (e.g., PABSON-school 'PG'/'NUR'/'LKG'/'UKG'
    // for Saraswati). The CEHRD canonical projection (ECD/PPC/1-10) is
    // applied here at report-time via the schoolGradeToCanonical transform.
    // See CLAUDE.md "School-first architecture" section.
    source: { path: 'enrollment.gradeLevel', transform: 'schoolGradeToCanonical' },
  },
  {
    order: 12,
    name: 'stream',
    header: 'stream',
    required: false,
    source: { path: 'enrollment.track', conditional: 'grade11_12Only' },
  },
  {
    order: 13,
    name: 'enrollment_type',
    header: 'enrollment_type',
    required: true,
    source: { path: 'enrollment.type' },
  },
  {
    order: 14,
    name: 'has_eced_exp',
    header: 'has_eced_exp',
    required: false,
    source: { path: 'student.hasEcedExperience', conditional: 'grade1Only' },
  },
];

export const FLASH_I_TEMPLATE = {
  templateId: FLASH_I_TEMPLATE_ID,
  schemaVersion: FLASH_I_SCHEMA_VERSION,
  description:
    'CEHRD IEMIS Flash I — beginning-of-year intake/enrollment census. ' +
    'Due end of Jestha (mid-June BS) per CEHRD directive.',
  columns: FLASH_I_COLUMNS,
} as const;

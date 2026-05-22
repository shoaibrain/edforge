/**
 * IEMIS NPL CEHRD Flash II — Template descriptor (Sprint E.1.2)
 *
 * Canonical column → source-path mapping for the CEHRD Flash II CSV
 * upload (outcomes/retention, end-of-year). Schema per the v3.4
 * research artifact `docs/pilot-greenlight/e1-flash-csv-schema.md` §12.
 *
 * Cadence: due end of Chaitra (mid-March BS).
 */

export const FLASH_II_TEMPLATE_ID = 'IEMIS_NPL_CEHRD_FLASH_II' as const;
export const FLASH_II_SCHEMA_VERSION = 'v1' as const;

export interface FlashIISourcePath {
  path: string;
  transform?:
    | 'sumAttendancePresentDays'
    | 'scholarshipCategoryToName'
    | 'computeExamTotalMarks'
    | 'computeExamGpa'
    | 'computeAcademicStatus';
}

export interface FlashIIColumnSpec {
  header: string;
  name: string;
  required: boolean;
  source: FlashIISourcePath;
  order: number;
}

/**
 * 10 columns of Flash II per research §12. The aggregation Lambda
 * (E.1.3) materializes the computed columns (attendance sum, exam
 * total, GPA, academic status derived from PromotionDecision +
 * Enrollment.endStatus) from per-student joins.
 */
export const FLASH_II_COLUMNS: FlashIIColumnSpec[] = [
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
    required: true,
    source: { path: 'student.emisStudentId' },
  },
  {
    order: 4,
    name: 'grade_level',
    header: 'grade_level',
    required: true,
    source: { path: 'enrollment.gradeLevel' },
  },
  {
    order: 5,
    name: 'total_attendance_days',
    header: 'total_attendance_days',
    required: true,
    source: { path: 'attendance', transform: 'sumAttendancePresentDays' },
  },
  {
    order: 6,
    name: 'scholarship_type',
    header: 'scholarship_type',
    required: false,
    source: { path: 'student.scholarshipCategory', transform: 'scholarshipCategoryToName' },
  },
  {
    order: 7,
    name: 'scholarship_amount',
    header: 'scholarship_amount',
    required: false,
    source: { path: 'student.scholarshipAmountNpr' },
  },
  {
    order: 8,
    name: 'exam_total_marks',
    header: 'exam_total_marks',
    required: true,
    source: { path: 'resultCards', transform: 'computeExamTotalMarks' },
  },
  {
    order: 9,
    name: 'exam_gpa',
    header: 'exam_gpa',
    required: false,
    source: { path: 'resultCards', transform: 'computeExamGpa' },
  },
  {
    order: 10,
    name: 'academic_status',
    header: 'academic_status',
    required: true,
    source: { path: 'enrollment.endStatus', transform: 'computeAcademicStatus' },
  },
];

export const FLASH_II_TEMPLATE = {
  templateId: FLASH_II_TEMPLATE_ID,
  schemaVersion: FLASH_II_SCHEMA_VERSION,
  description:
    'CEHRD IEMIS Flash II — end-of-year outcomes/retention. ' +
    'Due end of Chaitra (mid-March BS) per CEHRD directive.',
  columns: FLASH_II_COLUMNS,
} as const;

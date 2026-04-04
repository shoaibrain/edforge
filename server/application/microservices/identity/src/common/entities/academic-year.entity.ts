/**
 * Academic Year Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#YEAR#{yearId}
 * 
 * GSI2 (Academic Year queries by school):
 * - GSI2PK: TENANT#{tenantId}#SCHOOL#{schoolId}
 * - GSI2SK: YEAR#{yearId}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  AcademicYearStatus,
  TermType,
} from './base.entity';

/**
 * Academic Year entity stored in DynamoDB
 */
export interface AcademicYear extends BaseEntity {
  entityType: 'ACADEMIC_YEAR';
  
  // Identity
  yearId: string;
  schoolId: string;
  name: string;          // e.g., "2024-2025"
  shortName?: string;    // e.g., "AY24-25"
  
  // Dates
  startDate: string;     // ISO date (YYYY-MM-DD)
  endDate: string;       // ISO date
  
  // Status
  status: AcademicYearStatus;
  isCurrent: boolean;
  
  // Configuration
  calendarType: 'semester' | 'quarter' | 'trimester' | 'annual';
  
  // GSI Keys
  gsi2pk: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  gsi2sk: string;  // YEAR#{yearId}
}

/**
 * Grading Period (Term/Semester/Quarter)
 * Stored as separate entity under the academic year
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#YEAR#{yearId}#TERM#{termId}
 */
export interface GradingPeriod extends BaseEntity {
  entityType: 'TERM';
  
  // Identity
  termId: string;
  yearId: string;
  schoolId: string;
  
  // Details
  name: string;          // e.g., "Fall Semester", "Q1"
  shortName?: string;    // e.g., "Fall", "Q1"
  termType: TermType;
  sequence: number;      // 1, 2, 3, 4 for ordering
  
  // Dates
  startDate: string;
  endDate: string;
  
  // Grading
  gradesDueDate?: string;
  reportCardDate?: string;
  
  // Status
  isActive: boolean;

  // Academic Session Link (Ed-Fi: GradingPeriod → Session)
  academicSessionId?: string;

  // GSI Keys
  gsi2pk: string;  // TENANT#{tenantId}#SCHOOL#{schoolId}
  gsi2sk: string;  // YEAR#{yearId}#TERM#{sequence}
}

/**
 * School Holiday/Closure
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#YEAR#{yearId}#HOLIDAY#{date}
 */
export interface Holiday extends BaseEntity {
  entityType: 'HOLIDAY';
  
  // Identity
  holidayId: string;
  yearId: string;
  schoolId: string;
  
  // Details
  name: string;
  date: string;          // ISO date
  endDate?: string;      // For multi-day holidays
  
  // Type
  holidayType: 'federal' | 'state' | 'school' | 'break' | 'professional_development';
  
  // Affects
  affectsStudents: boolean;
  affectsStaff: boolean;
}

/**
 * Create a new Academic Year entity with proper keys
 */
export function createAcademicYearEntity(
  tenantId: string,
  schoolId: string,
  yearId: string,
  data: Omit<AcademicYear, 'tenantId' | 'entityKey' | 'entityType' | 'yearId' | 'schoolId' | 'gsi2pk' | 'gsi2sk'>
): AcademicYear {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.academicYear(schoolId, yearId),
    entityType: 'ACADEMIC_YEAR',
    yearId,
    schoolId,
    gsi2pk: `TENANT#${tenantId}#SCHOOL#${schoolId}`,
    gsi2sk: `YEAR#${yearId}`,
    ...data,
  };
}

/**
 * Create a new Grading Period entity with proper keys
 */
export function createGradingPeriodEntity(
  tenantId: string,
  schoolId: string,
  yearId: string,
  termId: string,
  data: Omit<GradingPeriod, 'tenantId' | 'entityKey' | 'entityType' | 'termId' | 'yearId' | 'schoolId' | 'gsi2pk' | 'gsi2sk'>
): GradingPeriod {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.term(schoolId, yearId, termId),
    entityType: 'TERM',
    termId,
    yearId,
    schoolId,
    gsi2pk: `TENANT#${tenantId}#SCHOOL#${schoolId}`,
    gsi2sk: `YEAR#${yearId}#TERM#${String(data.sequence).padStart(2, '0')}`,
    ...data,
  };
}

/**
 * Create a new Holiday entity with proper keys
 */
export function createHolidayEntity(
  tenantId: string,
  schoolId: string,
  yearId: string,
  holidayId: string,
  data: Omit<Holiday, 'tenantId' | 'entityKey' | 'entityType' | 'holidayId' | 'yearId' | 'schoolId'>
): Holiday {
  return {
    tenantId,
    entityKey: `SCHOOL#${schoolId}#YEAR#${yearId}#HOLIDAY#${data.date}`,
    entityType: 'HOLIDAY',
    holidayId,
    yearId,
    schoolId,
    ...data,
  };
}


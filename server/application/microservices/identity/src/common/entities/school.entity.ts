/**
 * School Entity for Identity Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  SchoolStatus,
} from './base.entity';
import type { SchoolTypeDescriptor } from '@aibrains/shared-types';

/**
 * School entity stored in DynamoDB
 */
export interface School extends BaseEntity {
  entityType: 'SCHOOL';
  
  // Identity
  schoolId: string;
  schoolCode: string;  // Unique within tenant (used as studentNumber prefix)
  /**
   * External government/EMIS school code (e.g. Nepal IEMIS School Code like
   * `170840012`). Required for PABSON tenants, optional elsewhere. Immutable
   * after school creation (government-issued).
   */
  emisSchoolCode?: string;
  name: string;
  shortName?: string;
  
  // Type
  schoolType: SchoolType;
  gradeRange: GradeRange;
  
  // Contact
  phone?: string;
  email?: string;
  website?: string;
  
  // Address
  address?: SchoolAddress;
  
  // Principal
  principalName?: string;
  principalEmail?: string;
  
  // Status
  status: SchoolStatus;
  
  // Configuration
  timezone: string;
  locale: string;
  academicCalendarType: 'semester' | 'quarter' | 'trimester' | 'annual';
  calendarSystem: 'gregorian' | 'bikram_sambat';
  
  // Current academic year
  currentAcademicYearId?: string;
  
  // Statistics
  studentCount?: number;
  staffCount?: number;
  teacherCount?: number;
  
  // Branding
  logoUrl?: string;

  // Ed-Fi Education Organization Fields
  localEducationAgencyId?: string;   // LEA parent reference (UUID)
  schoolCategories?: string[];       // Ed-Fi: schoolCategoryDescriptor[]
  /**
   * Ed-Fi: schoolTypeDescriptor. Sprint C0.b.4 — typed as the
   * `SchoolTypeDescriptor` enum from shared-types so the entity surface
   * mirrors the runtime Zod validation enforced by `CreateSchoolDtoZ`
   * at the controller boundary. Only valid Ed-Fi descriptor values
   * (`Regular | SpecialEducation | CareerAndTechnical | Alternative`)
   * can land on the persisted row.
   */
  schoolTypeDescriptor?: SchoolTypeDescriptor;
  gradeLevels?: string[];            // Ed-Fi: gradeLevelDescriptor[]
  charterStatusDescriptor?: string;  // Ed-Fi: charterStatusDescriptor
  administrativeFundingControlDescriptor?: string;
  titleIPartASchoolDesignationDescriptor?: string;
  identificationCodes?: Array<{ identificationCode: string; educationOrganizationIdentificationSystemDescriptor: string }>;
  institutionTelephones?: Array<{ telephoneNumber: string; institutionTelephoneNumberTypeDescriptor: string }>;
  accountabilityRatings?: Array<{ schoolYear: number; title: string; rating: string; ratingOrganization?: string; ratingDate?: string }>;

  /**
   * GSI8 — cross-tenant IEMIS School Code uniqueness (Sprint 1, S1.3).
   *
   * Sparse: present only when `emisSchoolCode` is set. Absent rows are
   * invisible to the index, so the index cardinality stays at
   * "number of schools with an emisSchoolCode" (small and cheap).
   *
   *   gsi8pk = <emisSchoolCode>         e.g. "31012345"
   *   gsi8sk = TENANT#{tid}#SCHOOL#{sid}   (audit / debug context)
   *
   * Uniqueness is enforced at the service layer: a pre-create query
   * on `gsi8pk = newCode` must return 0 items (409 otherwise). The
   * code is immutable post-save (FIELD_MUTABILITY.immutable), so there's
   * no subsequent re-check on UPDATE paths.
   */
  gsi8pk?: string;
  gsi8sk?: string;
}

/**
 * School type
 */
export type SchoolType = 
  | 'elementary'
  | 'middle'
  | 'high'
  | 'k12'
  | 'charter'
  | 'private'
  | 'vocational'
  | 'special_education';

/**
 * Grade range
 */
export interface GradeRange {
  start: string;  // e.g., 'K', '1', '6', '9'
  end: string;    // e.g., '5', '8', '12'
}

/**
 * School address
 */
export interface SchoolAddress {
  street1: string;
  street2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  // Nepal-specific fields
  wardNumber?: string;
  municipality?: string;
  district?: string;
  province?: string;
  // Generic international field
  region?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

/**
 * Create a new School entity with proper keys
 */
export function createSchoolEntity(
  tenantId: string,
  schoolId: string,
  data: Omit<School, 'tenantId' | 'entityKey' | 'entityType' | 'schoolId'>
): School {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.school(schoolId),
    entityType: 'SCHOOL',
    schoolId,
    ...data,
  };
}


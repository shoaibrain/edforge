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

/**
 * School entity stored in DynamoDB
 */
export interface School extends BaseEntity {
  entityType: 'SCHOOL';
  
  // Identity
  schoolId: string;
  schoolCode: string;  // Unique within tenant
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
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  
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
  schoolTypeDescriptor?: string;     // Ed-Fi: schoolTypeDescriptor
  gradeLevels?: string[];            // Ed-Fi: gradeLevelDescriptor[]
  charterStatusDescriptor?: string;  // Ed-Fi: charterStatusDescriptor
  administrativeFundingControlDescriptor?: string;
  titleIPartASchoolDesignationDescriptor?: string;
  identificationCodes?: Array<{ identificationCode: string; educationOrganizationIdentificationSystemDescriptor: string }>;
  institutionTelephones?: Array<{ telephoneNumber: string; institutionTelephoneNumberTypeDescriptor: string }>;
  accountabilityRatings?: Array<{ schoolYear: number; title: string; rating: string; ratingOrganization?: string; ratingDate?: string }>;
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
  city: string;
  state: string;
  zipCode: string;
  country?: string;
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


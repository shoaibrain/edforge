/**
 * Student Entity for Academics Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: STUDENT#{studentId}
 * 
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: STUDENT#{lastName}#{firstName}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
  Gender,
  StudentStatus,
} from './base.entity';

/**
 * Student entity stored in DynamoDB
 */
export interface Student extends BaseEntity {
  entityType: 'STUDENT';
  
  // Identity
  studentId: string;
  studentNumber: string;  // School-assigned ID
  
  // Personal info
  firstName: string;
  lastName: string;
  middleName?: string;
  preferredName?: string;
  dateOfBirth: string;  // ISO date
  gender: Gender;
  
  // Contact
  email?: string;
  phone?: string;
  
  // Address
  address?: Address;
  
  // Guardian/Parent info
  guardians: Guardian[];
  
  // Emergency contact
  emergencyContact?: EmergencyContact;
  
  // Medical
  medicalInfo?: MedicalInfo;
  
  // Academic
  primarySchoolId: string;
  currentGradeLevel: string;
  status: StudentStatus;
  enrollmentDate?: string;
  withdrawalDate?: string;
  
  // Special programs
  specialPrograms?: string[];
  accommodations?: string[];
  
  // Portal access
  portalUserId?: string;  // Link to student portal user in Identity service

  // Photo
  photoUrl?: string;

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // STUDENT#{lastName}#{firstName}
}

/**
 * Address structure
 * Note: country is optional to match DTO flexibility
 */
export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

/**
 * Guardian/Parent information
 */
export interface Guardian {
  guardianId: string;
  relationship: 'mother' | 'father' | 'guardian' | 'grandparent' | 'other';
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  phoneType?: 'mobile' | 'home' | 'work';
  alternatePhone?: string;
  isPrimary: boolean;
  hasPortalAccess: boolean;
  canPickup: boolean;
  userId?: string;  // Link to parent portal user
  employer?: string;
  occupation?: string;
  address?: Address;
}

/**
 * Emergency contact
 */
export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternatePhone?: string;
}

/**
 * Medical information
 */
export interface MedicalInfo {
  allergies?: string[];
  medications?: string[];
  conditions?: string[];
  dietaryRestrictions?: string[];
  notes?: string;
  physicianName?: string;
  physicianPhone?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
}

/**
 * Create a new Student entity with proper keys
 */
export function createStudentEntity(
  tenantId: string,
  studentId: string,
  schoolId: string,
  data: Omit<Student, 'tenantId' | 'entityKey' | 'entityType' | 'studentId' | 'gsi1pk' | 'gsi1sk'>
): Student {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.student(studentId),
    entityType: 'STUDENT',
    studentId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('STUDENT', `${data.lastName.toUpperCase()}#${data.firstName.toUpperCase()}`),
    ...data,
  };
}

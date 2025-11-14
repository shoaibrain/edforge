/**
 * Enrollment Service Request/Response DTOs
 * 
 * These interfaces are extracted from NestJS DTO classes in:
 * server/application/microservices/enrollment/src/
 * 
 * Validation rules are documented in JSDoc comments.
 * Source of truth: NestJS DTO classes with class-validator decorators.
 */

import type { AddressRequest, ContactInfoRequest as SchoolContactInfoRequest } from '../school/dto';

/**
 * Address DTO (re-exported from school for consistency)
 */
export type { AddressRequest } from '../school/dto';

/**
 * Guardian Information Request
 * @validation - guardianId: required, string (UUID)
 * @validation - relationship: required, enum ['parent', 'guardian', 'emergency_contact']
 * @validation - isPrimary: required, boolean
 */
export interface GuardianRequest {
  guardianId: string;
  relationship: 'parent' | 'guardian' | 'emergency_contact';
  isPrimary: boolean;
}

/**
 * Enrollment Contact Information Request (for Student/Parent/Staff)
 * @validation - email: optional, valid email format
 * @validation - phone: optional, string
 * @validation - address: required, AddressRequest
 */
export interface EnrollmentContactInfoRequest {
  email?: string;
  phone?: string;
  address: AddressRequest;
}

/**
 * Medical Information Request
 * @validation - allergies: optional, array of strings
 * @validation - medications: optional, array of strings
 * @validation - emergencyContact: required, object with name, phone, relationship
 * @note - Medical info should be encrypted at application level before storing
 */
export interface MedicalInfoRequest {
  allergies?: string[];
  medications?: string[];
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
}

/**
 * Create Student Request
 * @validation - firstName: required, string (min 1 char)
 * @validation - lastName: required, string (min 1 char)
 * @validation - middleName: optional, string
 * @validation - dateOfBirth: required, ISO date string
 * @validation - gender: optional, enum ['male', 'female', 'other', 'prefer_not_to_say']
 * @validation - contactInfo: required, EnrollmentContactInfoRequest
 * @validation - guardians: optional, array of GuardianRequest
 * @validation - medicalInfo: optional, MedicalInfoRequest
 */
export interface CreateStudentRequest {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string; // ISO date
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  contactInfo: EnrollmentContactInfoRequest;
  guardians?: GuardianRequest[];
  medicalInfo?: MedicalInfoRequest;
}

/**
 * Update Student Request
 * @validation - firstName: optional, string (min 1 char)
 * @validation - lastName: optional, string (min 1 char)
 * @validation - middleName: optional, string
 * @validation - contactInfo: optional, EnrollmentContactInfoRequest
 * @validation - guardians: optional, array of GuardianRequest
 * @validation - medicalInfo: optional, MedicalInfoRequest
 */
export interface UpdateStudentRequest {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  contactInfo?: EnrollmentContactInfoRequest;
  guardians?: GuardianRequest[];
  medicalInfo?: MedicalInfoRequest;
}

/**
 * Create Enrollment Request
 * @validation - schoolId: required, string (UUID)
 * @validation - academicYearId: required, string (UUID)
 * @validation - gradeLevel: required, string ("K", "1", "2", ..., "12")
 * @validation - section: optional, string ("A", "B", "C")
 * @validation - enrollmentDate: required, ISO date string
 * @validation - status: optional, enum ['pending', 'active']
 */
export interface CreateEnrollmentRequest {
  schoolId: string;
  academicYearId: string;
  gradeLevel: string; // "K", "1", "2", ..., "12"
  section?: string; // "A", "B", "C"
  enrollmentDate: string; // ISO date
  status?: 'pending' | 'active';
}

/**
 * Update Enrollment Status Request
 * @validation - status: required, enum ['pending', 'active', 'suspended', 'graduated', 'transferred', 'withdrawn']
 * @validation - statusReason: optional, string
 */
export interface UpdateEnrollmentStatusRequest {
  status: 'pending' | 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  statusReason?: string;
}

/**
 * Transfer Enrollment Request
 * @validation - targetSchoolId: required, string (UUID)
 * @validation - targetAcademicYearId: required, string (UUID)
 * @validation - targetGradeLevel: required, string ("K", "1", "2", ..., "12")
 * @validation - transferDate: required, ISO date string
 * @validation - reason: optional, string
 */
export interface TransferEnrollmentRequest {
  targetSchoolId: string;
  targetAcademicYearId: string;
  targetGradeLevel: string;
  transferDate: string; // ISO date
  reason?: string;
}

/**
 * Suspend Enrollment Request
 * @validation - reason: required, string
 * @validation - suspensionDate: required, ISO date string
 * @validation - expectedReturnDate: optional, ISO date string
 */
export interface SuspendEnrollmentRequest {
  reason: string;
  suspensionDate: string; // ISO date
  expectedReturnDate?: string; // ISO date
}

/**
 * Graduate Enrollment Request
 * @validation - graduationDate: required, ISO date string
 * @validation - diplomaNumber: optional, string
 * @validation - honors: optional, boolean
 */
export interface GraduateEnrollmentRequest {
  graduationDate: string; // ISO date
  diplomaNumber?: string;
  honors?: boolean;
}

/**
 * Education Information Request
 * @validation - degree: required, string
 * @validation - institution: required, string
 * @validation - year: required, string
 */
export interface EducationRequest {
  degree: string;
  institution: string;
  year: string;
}

/**
 * Qualifications Request
 * @validation - education: required, array of EducationRequest
 * @validation - certifications: required, array of strings
 * @validation - licenses: required, array of strings
 */
export interface QualificationsRequest {
  education: EducationRequest[];
  certifications: string[];
  licenses: string[];
}

/**
 * Role Request
 * @validation - roleType: required, enum ['teacher', 'principal', 'vice_principal', 'counselor', 'administrator', 'support_staff']
 * @validation - schoolId: required, string (UUID)
 * @validation - departmentId: optional, string (UUID)
 * @validation - startDate: required, ISO date string
 * @validation - endDate: optional, ISO date string
 * @validation - isPrimary: required, boolean
 */
export interface RoleRequest {
  roleType: 'teacher' | 'principal' | 'vice_principal' | 'counselor' | 'administrator' | 'support_staff';
  schoolId: string;
  departmentId?: string;
  startDate: string; // ISO date
  endDate?: string; // ISO date
  isPrimary: boolean;
}

/**
 * Create Staff Request
 * @validation - firstName: required, string (min 1 char)
 * @validation - lastName: required, string (min 1 char)
 * @validation - middleName: optional, string
 * @validation - dateOfBirth: optional, ISO date string
 * @validation - gender: optional, enum ['male', 'female', 'other', 'prefer_not_to_say']
 * @validation - contactInfo: required, object with email, phone, address
 * @validation - hireDate: required, ISO date string
 * @validation - employmentType: required, enum ['full_time', 'part_time', 'contract', 'substitute']
 * @validation - roles: required, array of RoleRequest
 * @validation - qualifications: optional, QualificationsRequest
 */
export interface CreateStaffRequest {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string; // ISO date
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  contactInfo: {
    email: string;
    phone: string;
    address: AddressRequest;
  };
  hireDate: string; // ISO date
  employmentType: 'full_time' | 'part_time' | 'contract' | 'substitute';
  roles: RoleRequest[];
  qualifications?: QualificationsRequest;
}

/**
 * Update Staff Request
 * @validation - firstName: optional, string
 * @validation - lastName: optional, string
 * @validation - contactInfo: optional, object
 * @validation - roles: optional, array of RoleRequest
 * @validation - qualifications: optional, QualificationsRequest
 */
export interface UpdateStaffRequest {
  firstName?: string;
  lastName?: string;
  contactInfo?: {
    email: string;
    phone: string;
    address: AddressRequest;
  };
  roles?: RoleRequest[];
  qualifications?: QualificationsRequest;
}

/**
 * Child Relationship Request
 * @validation - studentId: required, string (UUID)
 * @validation - relationship: required, enum ['parent', 'guardian', 'emergency_contact']
 * @validation - isPrimary: required, boolean
 */
export interface ChildRequest {
  studentId: string;
  relationship: 'parent' | 'guardian' | 'emergency_contact';
  isPrimary: boolean;
}

/**
 * Create Parent Request
 * @validation - firstName: required, string (min 1 char)
 * @validation - lastName: required, string (min 1 char)
 * @validation - middleName: optional, string
 * @validation - contactInfo: required, object with email, phone, alternatePhone, address
 * @validation - children: optional, array of ChildRequest
 * @validation - portalEnabled: optional, boolean
 */
export interface CreateParentRequest {
  firstName: string;
  lastName: string;
  middleName?: string;
  contactInfo: {
    email: string;
    phone: string;
    alternatePhone?: string;
    address: AddressRequest;
  };
  children?: ChildRequest[];
  portalEnabled?: boolean;
}

/**
 * Update Parent Request
 * @validation - firstName: optional, string
 * @validation - lastName: optional, string
 * @validation - contactInfo: optional, object
 * @validation - children: optional, array of ChildRequest
 */
export interface UpdateParentRequest {
  firstName?: string;
  lastName?: string;
  contactInfo?: {
    email: string;
    phone: string;
    alternatePhone?: string;
    address: AddressRequest;
  };
  children?: ChildRequest[];
}

/**
 * Tuition Rate Request
 * @validation - amount: required, number
 * @validation - currency: required, string (ISO 4217: USD, EUR, etc.)
 * @validation - frequency: required, enum ['annual', 'semester', 'monthly', 'quarterly']
 * @validation - dueDates: optional, array of ISO date strings
 * @validation - description: optional, string
 */
export interface TuitionRateRequest {
  amount: number;
  currency: string; // ISO 4217
  frequency: 'annual' | 'semester' | 'monthly' | 'quarterly';
  dueDates?: string[]; // ISO dates
  description?: string;
}

/**
 * Fee Request
 * @validation - feeName: required, string
 * @validation - feeType: required, enum ['registration', 'technology', 'activity', 'lab', 'sports', 'field_trip', 'uniform', 'other']
 * @validation - amount: required, number
 * @validation - frequency: required, enum ['one_time', 'annual', 'semester', 'monthly', 'per_course']
 * @validation - isMandatory: required, boolean
 * @validation - applicableGrades: optional, array of strings
 * @validation - description: optional, string
 */
export interface FeeRequest {
  feeName: string;
  feeType: 'registration' | 'technology' | 'activity' | 'lab' | 'sports' | 'field_trip' | 'uniform' | 'other';
  amount: number;
  frequency: 'one_time' | 'annual' | 'semester' | 'monthly' | 'per_course';
  isMandatory: boolean;
  applicableGrades?: string[];
  description?: string;
}

/**
 * Discount Policy Request
 * @validation - name: required, string
 * @validation - type: required, enum ['sibling', 'early_payment', 'scholarship', 'financial_aid', 'staff_discount', 'custom']
 * @validation - discountPercentage: optional, number (e.g., 10 for 10%)
 * @validation - discountAmount: optional, number (fixed discount)
 * @validation - conditions: required, string (human-readable)
 * @validation - applicableTo: required, enum ['tuition', 'fees', 'both']
 */
export interface DiscountPolicyRequest {
  name: string;
  type: 'sibling' | 'early_payment' | 'scholarship' | 'financial_aid' | 'staff_discount' | 'custom';
  discountPercentage?: number;
  discountAmount?: number;
  conditions: string;
  applicableTo: 'tuition' | 'fees' | 'both';
}

/**
 * Create Tuition Configuration Request
 * @validation - schoolId: required, string (UUID)
 * @validation - academicYearId: required, string (UUID)
 * @validation - tuitionRates: required, object with gradeLevel keys and TuitionRateRequest values
 * @validation - fees: optional, array of FeeRequest
 * @validation - discountPolicies: optional, array of DiscountPolicyRequest
 */
export interface CreateTuitionConfigurationRequest {
  schoolId: string;
  academicYearId: string;
  tuitionRates: { [gradeLevel: string]: TuitionRateRequest };
  fees?: FeeRequest[];
  discountPolicies?: DiscountPolicyRequest[];
}

/**
 * Create Payment Request
 * @validation - invoiceId: required, string (UUID)
 * @validation - amount: required, number
 * @validation - currency: required, string (ISO 4217)
 * @validation - paymentDate: required, ISO date string
 * @validation - paymentMethod: required, enum ['cash', 'check', 'bank_transfer', 'credit_card', 'debit_card', 'other']
 * @validation - referenceNumber: optional, string
 * @validation - notes: optional, string
 */
export interface CreatePaymentRequest {
  invoiceId: string;
  amount: number;
  currency: string;
  paymentDate: string; // ISO date
  paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';
  referenceNumber?: string;
  notes?: string;
}


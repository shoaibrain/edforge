/**
 * Enrollment Schemas - Academics Service
 * 
 * Zod schemas for student enrollment, staff, and parent management DTOs.
 */

import { z } from 'zod';
import { 
  emailSchema, 
  phoneSchema, 
  addressSchema, 
  isoDateSchema,
  dateSchema,
  createPaginatedResponseSchema,
} from '../common';
import { genderSchema, guardianSchema, emergencyContactSchema } from '../academics/student.schema';

// ============================================
// Enrollment Status Enum
// ============================================

export const enrollmentStatusSchema = z.enum([
  'pending',
  'active',
  'enrolled',  // Alias for active - used in entity model
  'withdrawn',
  'graduated',
  'transferred',
  'suspended',
  'expelled',
  'completed',
]);
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;

export const enrollmentTypeSchema = z.enum([
  'new',
  'transfer',
  'returning',
  're_enrollment',
]);
export type EnrollmentType = z.infer<typeof enrollmentTypeSchema>;

// ============================================
// Staff Role Schema
// ============================================

export const staffRoleTypeSchema = z.enum([
  'teacher',
  'principal',
  'vice_principal',
  'counselor',
  'administrator',
  'office_staff',
  'librarian',
  'nurse',
  'custodian',
  'security',
  'it_support',
  'substitute',
  'aide',
  'coach',
  'other',
]);
export type StaffRoleType = z.infer<typeof staffRoleTypeSchema>;

export const employmentStatusSchema = z.enum([
  'active',
  'on_leave',
  'terminated',
  'retired',
  'pending',
]);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'volunteer',
]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

// ============================================
// Education Schema (for Staff)
// ============================================

export const educationSchema = z.object({
  degree: z.string().min(1).max(100),
  institution: z.string().min(1).max(200),
  major: z.string().max(100).optional(),
  minor: z.string().max(100).optional(),
  graduationYear: z.number().int().min(1950).max(2100),
  gpa: z.number().min(0).max(4.0).optional(),
});

export type EducationDto = z.infer<typeof educationSchema>;

// ============================================
// Qualifications Schema (for Staff)
// ============================================

export const qualificationsSchema = z.object({
  certifications: z.array(z.object({
    name: z.string().min(1).max(200),
    issuingAuthority: z.string().max(200).optional(),
    issueDate: dateSchema.optional(),
    expirationDate: dateSchema.optional(),
    credentialNumber: z.string().max(100).optional(),
  })).optional(),
  licenses: z.array(z.object({
    type: z.string().min(1).max(100),
    state: z.string().max(50).optional(),
    number: z.string().max(100).optional(),
    expirationDate: dateSchema.optional(),
  })).optional(),
  endorsements: z.array(z.string().max(200)).optional(),
  specializations: z.array(z.string().max(200)).optional(),
  yearsOfExperience: z.number().int().min(0).max(60).optional(),
});

export type QualificationsDto = z.infer<typeof qualificationsSchema>;

// ============================================
// Staff Role Assignment Schema
// ============================================

export const staffRoleSchema = z.object({
  roleType: staffRoleTypeSchema,
  schoolId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  isPrimary: z.boolean().default(false),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  subjects: z.array(z.string().max(100)).optional(),
  gradeLevels: z.array(z.string().max(10)).optional(),
});

export type StaffRoleDto = z.infer<typeof staffRoleSchema>;

// ============================================
// Create Staff Schema
// ============================================

export const createStaffSchema = z.object({
  // Personal Info
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  preferredName: z.string().max(50).optional(),
  dateOfBirth: dateSchema.optional(),
  gender: genderSchema.optional(),
  
  // Contact
  email: emailSchema,
  phone: z.string().min(10).max(20).optional(),
  alternatePhone: z.string().max(20).optional(),
  address: addressSchema.optional(),
  
  // Employment
  employeeNumber: z.string().max(20).optional(),
  hireDate: dateSchema,
  employmentType: employmentTypeSchema.default('full_time'),
  employmentStatus: employmentStatusSchema.default('active'),
  
  // Roles
  roles: z.array(staffRoleSchema).min(1).max(10),
  
  // Education & Qualifications
  education: z.array(educationSchema).optional(),
  qualifications: qualificationsSchema.optional(),
  
  // Emergency Contact
  emergencyContact: emergencyContactSchema.optional(),
  
  // Notes
  notes: z.string().max(2000).optional(),
});

export type CreateStaffDto = z.infer<typeof createStaffSchema>;

// ============================================
// Update Staff Schema
// ============================================

export const updateStaffSchema = createStaffSchema.partial();

export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

// ============================================
// Staff Response Schema
// ============================================

export const staffResponseSchema = z.object({
  staffId: z.string().uuid(),
  tenantId: z.string(),
  
  // Personal Info
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  preferredName: z.string().optional(),
  fullName: z.string(),
  dateOfBirth: dateSchema.optional(),
  gender: genderSchema.optional(),
  
  // Contact
  email: z.string(),
  phone: z.string().optional(),
  alternatePhone: z.string().optional(),
  address: addressSchema.optional(),
  
  // Employment
  employeeNumber: z.string().optional(),
  hireDate: dateSchema,
  terminationDate: dateSchema.optional(),
  employmentType: employmentTypeSchema,
  employmentStatus: employmentStatusSchema,
  
  // Roles
  roles: z.array(staffRoleSchema),
  primarySchoolId: z.string().uuid().optional(),
  
  // Education & Qualifications
  education: z.array(educationSchema).optional(),
  qualifications: qualificationsSchema.optional(),
  
  // Emergency Contact
  emergencyContact: emergencyContactSchema.optional(),
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type StaffResponseDto = z.infer<typeof staffResponseSchema>;

// ============================================
// Staff List Response Schema
// ============================================

export const staffListResponseSchema = createPaginatedResponseSchema(staffResponseSchema);
export type StaffListResponseDto = z.infer<typeof staffListResponseSchema>;

// ============================================
// Parent/Guardian Schema (for enrollment contact)
// ============================================

export const childAssociationSchema = z.object({
  studentId: z.string().uuid(),
  relationship: z.enum(['mother', 'father', 'guardian', 'grandparent', 'other']),
  isPrimaryContact: z.boolean().default(false),
  hasPickupPermission: z.boolean().default(true),
  canAccessPortal: z.boolean().default(true),
});

export type ChildAssociationDto = z.infer<typeof childAssociationSchema>;

export const createParentSchema = z.object({
  // Personal Info
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  preferredName: z.string().max(50).optional(),
  
  // Contact
  email: emailSchema,
  phone: z.string().min(10).max(20),
  alternatePhone: z.string().max(20).optional(),
  workPhone: z.string().max(20).optional(),
  preferredContactMethod: z.enum(['email', 'phone', 'text']).default('email'),
  
  // Address
  address: addressSchema.optional(),
  
  // Employment
  employer: z.string().max(200).optional(),
  occupation: z.string().max(100).optional(),
  
  // Children
  children: z.array(childAssociationSchema).min(1).max(20),
  
  // Portal Access
  createPortalAccount: z.boolean().default(true),
  
  // Notes
  notes: z.string().max(2000).optional(),
});

export type CreateParentDto = z.infer<typeof createParentSchema>;

// ============================================
// Update Parent Schema
// ============================================

export const updateParentSchema = createParentSchema.partial();

export type UpdateParentDto = z.infer<typeof updateParentSchema>;

// ============================================
// Parent Response Schema
// ============================================

export const parentResponseSchema = z.object({
  parentId: z.string().uuid(),
  tenantId: z.string(),
  userId: z.string().uuid().optional(),
  
  // Personal Info
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  preferredName: z.string().optional(),
  fullName: z.string(),
  
  // Contact
  email: z.string(),
  phone: z.string(),
  alternatePhone: z.string().optional(),
  workPhone: z.string().optional(),
  preferredContactMethod: z.enum(['email', 'phone', 'text']),
  
  // Address
  address: addressSchema.optional(),
  
  // Employment
  employer: z.string().optional(),
  occupation: z.string().optional(),
  
  // Children
  children: z.array(z.object({
    studentId: z.string().uuid(),
    studentName: z.string().optional(),
    relationship: z.string(),
    isPrimaryContact: z.boolean(),
    hasPickupPermission: z.boolean(),
    canAccessPortal: z.boolean(),
  })),
  
  // Portal
  hasPortalAccess: z.boolean(),
  lastLoginAt: isoDateSchema.optional(),
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type ParentResponseDto = z.infer<typeof parentResponseSchema>;

// ============================================
// Parent List Response Schema
// ============================================

export const parentListResponseSchema = createPaginatedResponseSchema(parentResponseSchema);
export type ParentListResponseDto = z.infer<typeof parentListResponseSchema>;

// ============================================
// Create Enrollment Schema
// ============================================

export const createEnrollmentSchema = z.object({
  studentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  gradeLevel: z.string().min(1).max(10),
  
  enrollmentType: enrollmentTypeSchema.default('new'),
  enrollmentDate: dateSchema,
  expectedGraduationDate: dateSchema.optional(),
  
  // Previous School (for transfers)
  previousSchoolName: z.string().max(200).optional(),
  previousSchoolAddress: z.string().max(500).optional(),
  transferReason: z.string().max(500).optional(),
  
  // Homeroom/Section
  homeroomId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  
  // Additional Info
  notes: z.string().max(2000).optional(),
});

export type CreateEnrollmentDto = z.infer<typeof createEnrollmentSchema>;

// ============================================
// Update Enrollment Status Schema
// ============================================

export const updateEnrollmentStatusSchema = z.object({
  status: enrollmentStatusSchema,
  statusChangeDate: dateSchema.optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export type UpdateEnrollmentStatusDto = z.infer<typeof updateEnrollmentStatusSchema>;

// ============================================
// Transfer Enrollment Schema
// ============================================

export const transferEnrollmentSchema = z.object({
  newSchoolId: z.string().uuid(),
  effectiveDate: dateSchema,
  transferReason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export type TransferEnrollmentDto = z.infer<typeof transferEnrollmentSchema>;

// ============================================
// Enrollment Response Schema
// ============================================

export const enrollmentResponseSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  schoolId: z.string().uuid(),
  schoolName: z.string().optional(),
  tenantId: z.string(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string().optional(),
  
  gradeLevel: z.string(),
  enrollmentType: enrollmentTypeSchema,
  status: enrollmentStatusSchema,
  
  enrollmentDate: dateSchema,
  withdrawalDate: dateSchema.optional(),
  expectedGraduationDate: dateSchema.optional(),
  actualGraduationDate: dateSchema.optional(),
  
  previousSchoolName: z.string().optional(),
  previousSchoolAddress: z.string().optional(),
  transferReason: z.string().optional(),
  
  homeroomId: z.string().uuid().optional(),
  homeroomName: z.string().optional(),
  sectionId: z.string().uuid().optional(),
  
  notes: z.string().optional(),
  
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type EnrollmentResponseDto = z.infer<typeof enrollmentResponseSchema>;

// ============================================
// Enrollment List Response Schema
// ============================================

export const enrollmentListResponseSchema = createPaginatedResponseSchema(enrollmentResponseSchema);
export type EnrollmentListResponseDto = z.infer<typeof enrollmentListResponseSchema>;

// ============================================
// Filter Schemas
// ============================================

export const staffFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  roleType: staffRoleTypeSchema.optional(),
  employmentStatus: employmentStatusSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type StaffFilterDto = z.infer<typeof staffFilterSchema>;

export const enrollmentFilterSchema = z.object({
  studentId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  gradeLevel: z.string().optional(),
  status: enrollmentStatusSchema.optional(),
  enrollmentType: enrollmentTypeSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type EnrollmentFilterDto = z.infer<typeof enrollmentFilterSchema>;

// ============================================
// Update Enrollment Schema
// ============================================

export const updateEnrollmentSchema = z.object({
  gradeLevel: z.string().min(1).max(10).optional(),
  homeroomId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  expectedGraduationDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export type UpdateEnrollmentDto = z.infer<typeof updateEnrollmentSchema>;

// ============================================
// Withdraw Student Schema
// ============================================

export const withdrawStudentSchema = z.object({
  withdrawalDate: dateSchema,
  reason: z.string().max(500),
  notes: z.string().max(2000).optional(),
  lastDayAttended: dateSchema.optional(),
  exitCode: z.string().max(20).optional(),
});

export type WithdrawStudentDto = z.infer<typeof withdrawStudentSchema>;

// ============================================
// Transfer Student Schema  
// ============================================

export const transferStudentSchema = z.object({
  newSchoolId: z.string().uuid(),
  effectiveDate: dateSchema,
  transferReason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  newGradeLevel: z.string().max(10).optional(),
  sendRecords: z.boolean().default(true),
});

export type TransferStudentDto = z.infer<typeof transferStudentSchema>;

// ============================================
// Enrollment Summary Schema
// ============================================

export const enrollmentSummarySchema = z.object({
  schoolId: z.string().uuid(),
  schoolName: z.string().optional(),
  academicYearId: z.string().uuid(),
  academicYearName: z.string().optional(),
  totalEnrolled: z.number().int().min(0),
  byGradeLevel: z.record(z.string(), z.number().int().min(0)),
  byStatus: z.record(z.string(), z.number().int().min(0)),
  recentEnrollments: z.number().int().min(0),
  recentWithdrawals: z.number().int().min(0),
  attendanceRate: z.number().min(0).max(100).optional(),
});

export type EnrollmentSummaryDto = z.infer<typeof enrollmentSummarySchema>;

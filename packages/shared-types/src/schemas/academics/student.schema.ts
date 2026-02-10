/**
 * Student Schemas - Academics Service
 * 
 * Zod schemas for student management DTOs.
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

// ============================================
// Enums
// ============================================

export const genderSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
export type Gender = z.infer<typeof genderSchema>;

export const studentStatusSchema = z.enum([
  'active',
  'inactive',
  'graduated',
  'transferred',
  'withdrawn',
  'suspended',
]);
export type StudentStatus = z.infer<typeof studentStatusSchema>;

export const guardianRelationshipSchema = z.enum([
  'mother',
  'father',
  'guardian',
  'grandparent',
  'sibling',
  'aunt',
  'uncle',
  'other',
]);
export type GuardianRelationship = z.infer<typeof guardianRelationshipSchema>;

export const phoneTypeSchema = z.enum(['mobile', 'home', 'work']);
export type PhoneType = z.infer<typeof phoneTypeSchema>;

// ============================================
// Guardian Schema
// ============================================

export const guardianSchema = z.object({
  guardianId: z.string().uuid().optional(),
  relationship: guardianRelationshipSchema,
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  phoneType: phoneTypeSchema.optional(),
  alternatePhone: z.string().max(20).optional(),
  isPrimary: z.boolean().default(false),
  hasPortalAccess: z.boolean().default(false),
  canPickup: z.boolean().default(true),
  address: addressSchema.optional(),
  employer: z.string().max(100).optional(),
  occupation: z.string().max(100).optional(),
});

export type GuardianDto = z.infer<typeof guardianSchema>;

// ============================================
// Emergency Contact Schema
// ============================================

export const emergencyContactSchema = z.object({
  name: z.string().min(1).max(100),
  relationship: z.string().min(1).max(50),
  phone: z.string().max(20),
  alternatePhone: z.string().max(20).optional(),
  priority: z.number().int().min(1).max(5).default(1),
});

export type EmergencyContactDto = z.infer<typeof emergencyContactSchema>;

// ============================================
// Medical Info Schema
// ============================================

export const medicalInfoSchema = z.object({
  allergies: z.array(z.string().max(100)).optional(),
  medications: z.array(z.string().max(100)).optional(),
  conditions: z.array(z.string().max(100)).optional(),
  dietaryRestrictions: z.array(z.string().max(100)).optional(),
  bloodType: z.string().max(10).optional(),
  notes: z.string().max(1000).optional(),
  physicianName: z.string().max(100).optional(),
  physicianPhone: z.string().max(20).optional(),
  insuranceProvider: z.string().max(100).optional(),
  insurancePolicyNumber: z.string().max(50).optional(),
  hasIEP: z.boolean().optional(),
  has504Plan: z.boolean().optional(),
});

export type MedicalInfoDto = z.infer<typeof medicalInfoSchema>;

// ============================================
// Student Contact Info Schema
// ============================================

export const studentContactInfoSchema = z.object({
  email: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  phoneType: phoneTypeSchema.optional(),
  address: addressSchema.optional(),
  mailingAddress: addressSchema.optional(),
  useMailingAddress: z.boolean().optional(),
});

export type StudentContactInfoDto = z.infer<typeof studentContactInfoSchema>;

// ============================================
// Create Student Schema
// ============================================

export const createStudentSchema = z.object({
  // Basic Info
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  middleName: z.string().max(50).optional(),
  preferredName: z.string().max(50).optional(),
  suffix: z.string().max(10).optional(),
  dateOfBirth: dateSchema,
  gender: genderSchema,
  
  // School Info
  schoolId: z.string().uuid(),
  currentGradeLevel: z.string().min(1).max(10),
  studentNumber: z.string().max(20).optional(),
  stateStudentId: z.string().max(30).optional(),
  
  // Contact Info
  contactInfo: studentContactInfoSchema.optional(),
  
  // Family
  guardians: z.array(guardianSchema).min(1).max(10).optional(),
  emergencyContacts: z.array(emergencyContactSchema).max(5).optional(),
  
  // Health
  medicalInfo: medicalInfoSchema.optional(),
  
  // Programs & Accommodations
  specialPrograms: z.array(z.string().max(100)).optional(),
  accommodations: z.array(z.string().max(200)).optional(),
  
  // Demographics
  ethnicity: z.string().max(50).optional(),
  primaryLanguage: z.string().max(50).optional(),
  homeLanguage: z.string().max(50).optional(),
  countryOfBirth: z.string().max(100).optional(),
  
  // Enrollment
  enrollmentDate: dateSchema.optional(),
  previousSchool: z.string().max(200).optional(),
  
  // Notes
  notes: z.string().max(2000).optional(),
});

export type CreateStudentDto = z.infer<typeof createStudentSchema>;

// ============================================
// Update Student Schema
// ============================================

export const updateStudentSchema = createStudentSchema.partial().omit({
  schoolId: true,
});

export type UpdateStudentDto = z.infer<typeof updateStudentSchema>;

// ============================================
// Student Response Schema
// ============================================

export const studentResponseSchema = z.object({
  studentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),
  
  // Basic Info
  firstName: z.string(),
  lastName: z.string(),
  middleName: z.string().optional(),
  preferredName: z.string().optional(),
  suffix: z.string().optional(),
  fullName: z.string(),
  dateOfBirth: dateSchema,
  gender: genderSchema,
  
  // Identifiers
  studentNumber: z.string().optional(),
  stateStudentId: z.string().optional(),
  
  // School Info
  currentGradeLevel: z.string(),
  status: studentStatusSchema,
  
  // Contact Info
  contactInfo: studentContactInfoSchema.optional(),
  
  // Family
  guardians: z.array(guardianSchema).optional(),
  emergencyContacts: z.array(emergencyContactSchema).optional(),
  
  // Health
  medicalInfo: medicalInfoSchema.optional(),
  
  // Programs
  specialPrograms: z.array(z.string()).optional(),
  accommodations: z.array(z.string()).optional(),
  
  // Demographics
  ethnicity: z.string().optional(),
  primaryLanguage: z.string().optional(),
  homeLanguage: z.string().optional(),
  countryOfBirth: z.string().optional(),
  
  // Enrollment
  enrollmentDate: dateSchema.optional(),
  previousSchool: z.string().optional(),
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type StudentResponseDto = z.infer<typeof studentResponseSchema>;

// ============================================
// Student List Response Schema
// ============================================

export const studentListResponseSchema = createPaginatedResponseSchema(studentResponseSchema);
export type StudentListResponseDto = z.infer<typeof studentListResponseSchema>;

// ============================================
// Student Search/Filter Schema
// ============================================

export const studentFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  gradeLevel: z.string().optional(),
  status: studentStatusSchema.optional(),
  searchTerm: z.string().max(100).optional(),
  enrollmentDateFrom: dateSchema.optional(),
  enrollmentDateTo: dateSchema.optional(),
  hasIEP: z.boolean().optional(),
  has504Plan: z.boolean().optional(),
});

export type StudentFilterDto = z.infer<typeof studentFilterSchema>;

// ============================================
// Student Profile Response Schema (Extended)
// ============================================

export const studentProfileResponseSchema = studentResponseSchema.extend({
  // Enrollment History
  currentEnrollment: z.object({
    enrollmentId: z.string().uuid(),
    academicYearId: z.string().uuid(),
    academicYearName: z.string().optional(),
    gradeLevel: z.string(),
    enrollmentDate: dateSchema,
    status: z.string(),
    homeroomId: z.string().uuid().optional(),
    homeroomName: z.string().optional(),
  }).optional(),
  
  enrollmentHistory: z.array(z.object({
    enrollmentId: z.string().uuid(),
    academicYearId: z.string().uuid(),
    academicYearName: z.string().optional(),
    gradeLevel: z.string(),
    schoolId: z.string().uuid(),
    schoolName: z.string().optional(),
    enrollmentDate: dateSchema,
    withdrawalDate: dateSchema.optional(),
    status: z.string(),
  })).optional(),
  
  // Attendance Summary
  attendanceSummary: z.object({
    totalDays: z.number().int().min(0),
    present: z.number().int().min(0),
    absent: z.number().int().min(0),
    late: z.number().int().min(0),
    excused: z.number().int().min(0),
    attendanceRate: z.number().min(0).max(100),
  }).optional(),
  
  // Academic Performance (optional summary)
  academicSummary: z.object({
    gpa: z.number().min(0).max(5).optional(),
    currentCourses: z.number().int().min(0).optional(),
    completedCredits: z.number().min(0).optional(),
  }).optional(),
  
  // Classrooms
  classrooms: z.array(z.object({
    classroomId: z.string().uuid(),
    name: z.string(),
    subject: z.string().optional(),
    teacherName: z.string().optional(),
  })).optional(),
});

export type StudentProfileResponseDto = z.infer<typeof studentProfileResponseSchema>;

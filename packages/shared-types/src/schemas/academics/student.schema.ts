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
import { iemisStudentIdSchema } from '../../identity/iemis-codes';
import {
  sexDescriptorUriSchema,
  languageDescriptorUriSchema,
  disabilityDescriptorUriSchema,
  anyEdFiDescriptorUriSchema,
} from '../../ed-fi/descriptors/descriptor-uri-schema';

// ============================================
// Enums
// ============================================

export const genderSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
export type Gender = z.infer<typeof genderSchema>;

export const studentStatusSchema = z.enum([
  'active',
  'inactive',
  'pending',
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
// Sprint 3 S3.1 — IEMIS / Ed-Fi demographic descriptors
// ============================================

/**
 * Nested shape for a student's disability entries. Supports the common case
 * (one disability descriptor) as well as IEMIS's multi-disability model
 * (a child may be recorded under more than one CEHRD category). `notes` is
 * free-form and visible only to authorized staff per the privacy model
 * (Sprint 13). Keep it short — it is NOT a medical record.
 */
export const studentDisabilitySchema = z
  .object({
    descriptor: disabilityDescriptorUriSchema,
    notes: z.string().max(500).optional(),
  })
  .strict();

export type StudentDisabilityDto = z.infer<typeof studentDisabilitySchema>;

/**
 * The patchable subset of the Student schema that contains only Ed-Fi
 * descriptors. Used by `PATCH /students/:id/descriptors` (S3.7) so the
 * endpoint never accidentally clobbers an unrelated field.
 *
 * `ethnicityDescriptor` is validated only at the URI-shape level in Sprint 3
 * because the ethnicity / caste catalog lands in Sprint 6. The schema will
 * tighten to `ethnicityDescriptorUriSchema` (catalog-existence check) then.
 */
export const studentDescriptorPatchSchema = z
  .object({
    sexDescriptor: sexDescriptorUriSchema.optional(),
    languageDescriptor: languageDescriptorUriSchema.optional(),
    motherTongueDescriptor: languageDescriptorUriSchema.optional(),
    disabilities: z.array(studentDisabilitySchema).max(8).optional(),
    ethnicityDescriptor: anyEdFiDescriptorUriSchema.optional(),
    isTransferred: z.boolean().optional(),
    belowPovertyLine: z.boolean().optional(),
    scholarshipCategory: z.string().max(80).optional(),
    // Sprint E.0.3 — CEHRD Flash II amount field (optional; harmless if
    // IEMIS portal accepts only category)
    scholarshipAmountNpr: z.number().min(0).max(10_000_000).optional(),
    // Sprint E.0.1 — CEHRD Flash I Grade 1 ECED entrant flag
    hasEcedExperience: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => !(v.scholarshipCategory && v.belowPovertyLine === false),
    {
      message:
        'scholarshipCategory only applies when belowPovertyLine is true; set belowPovertyLine=true first',
      path: ['scholarshipCategory'],
    },
  )
  .refine(
    (v) => !(v.scholarshipAmountNpr !== undefined && v.belowPovertyLine === false),
    {
      message:
        'scholarshipAmountNpr only applies when belowPovertyLine is true; set belowPovertyLine=true first',
      path: ['scholarshipAmountNpr'],
    },
  );

export type StudentDescriptorPatchDto = z.infer<typeof studentDescriptorPatchSchema>;

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
  /**
   * External government/EMIS student ID (e.g. Nepal IEMIS 16-digit ID).
   * Required for PABSON tenants (enforced at service layer since archetype
   * lookup is not in Zod scope). Unique per tenant (see GSI7).
   *
   * Format enforced by `iemisStudentIdSchema` (S1.1): exactly 16 digits,
   * leading zeros preserved — CEHRD treats `0012…` as a distinct ID from
   * `12…` so silent trimming would corrupt data. Tightened 2026-04-23
   * from loose `z.string().min(1).max(64)`; malformed IDs previously
   * landed in DDB and blocked downstream import dedup (GSI7) from
   * matching against the CEHRD portal.
   */
  emisStudentId: iemisStudentIdSchema.optional(),
  
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
  
  // Demographics (legacy free-form — kept for backwards compatibility with
  // every pre-Sprint-3 caller; new code should use the descriptor fields below)
  ethnicity: z.string().max(50).optional(),
  primaryLanguage: z.string().max(50).optional(),
  homeLanguage: z.string().max(50).optional(),
  countryOfBirth: z.string().max(100).optional(),

  // Sprint 3 S3.1 — Ed-Fi descriptor fields (IEMIS demographic columns).
  // All optional and additive; `deriveDescriptorsFromLegacy()` can backfill
  // from `gender` / `primaryLanguage` for pre-existing rows.
  sexDescriptor: sexDescriptorUriSchema.optional(),
  languageDescriptor: languageDescriptorUriSchema.optional(),
  motherTongueDescriptor: languageDescriptorUriSchema.optional(),
  disabilities: z.array(studentDisabilitySchema).max(8).optional(),
  // Ethnicity catalog lands in Sprint 6; validated at URI shape only for now.
  ethnicityDescriptor: anyEdFiDescriptorUriSchema.optional(),
  isTransferred: z.boolean().optional(),
  belowPovertyLine: z.boolean().optional(),
  scholarshipCategory: z.string().max(80).optional(),
  // Sprint E.0.3 — CEHRD Flash II amount field
  scholarshipAmountNpr: z.number().min(0).max(10_000_000).optional(),
  // Sprint E.0.1 — CEHRD Flash I Grade 1 ECED entrant flag
  hasEcedExperience: z.boolean().optional(),

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
  emisStudentId: z.string().optional(),
  
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
  
  // Demographics (legacy)
  ethnicity: z.string().optional(),
  primaryLanguage: z.string().optional(),
  homeLanguage: z.string().optional(),
  countryOfBirth: z.string().optional(),

  // Sprint 3 S3.1 — Ed-Fi descriptor fields
  sexDescriptor: z.string().optional(),
  languageDescriptor: z.string().optional(),
  motherTongueDescriptor: z.string().optional(),
  disabilities: z.array(studentDisabilitySchema).optional(),
  ethnicityDescriptor: z.string().optional(),
  isTransferred: z.boolean().optional(),
  belowPovertyLine: z.boolean().optional(),
  scholarshipCategory: z.string().optional(),
  // Sprint E.0.3 — CEHRD Flash II amount field
  scholarshipAmountNpr: z.number().optional(),
  // Sprint E.0.1 — CEHRD Flash I Grade 1 ECED entrant flag
  hasEcedExperience: z.boolean().optional(),

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

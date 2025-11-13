/**
 * EdForge EMIS - Staff Schema
 * 
 * Comprehensive staff/teacher data schema
 * Extends current Staff interface with SABER framework requirements
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, emailSchema, phoneSchema, identifierNumberSchema } from "../base"
import { addressSchema } from "../base/address-schema"
import { requiredContactInfoSchema } from "../base/contact-schema"

/**
 * Gender Schema
 */
export const genderSchema = z.enum(["male", "female", "other", "prefer_not_to_say"])

/**
 * Employment Type Schema
 */
export const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "substitute",
])

/**
 * Employment Status Schema
 */
export const employmentStatusSchema = z.enum([
  "active",
  "on_leave",
  "terminated",
  "retired",
])

/**
 * Staff Role Type Schema
 */
export const staffRoleTypeSchema = z.enum([
  "teacher",
  "principal",
  "vice_principal",
  "counselor",
  "administrator",
  "support_staff",
  "security",
  "janitorial",
  "transportation",
  "nurse",
  "librarian",
  "other",
])

/**
 * Staff Role Schema
 * Multiple roles per staff member
 */
export const staffRoleSchema = z.object({
  roleId: uuidSchema,
  roleType: staffRoleTypeSchema,
  schoolId: uuidSchema,
  departmentId: uuidSchema.optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  isPrimary: z.boolean().default(false),
  subjects: z.array(z.string()).optional(), // For teachers
  gradeLevels: z.array(z.string()).optional(), // For teachers
})

/**
 * Education Record Schema
 */
export const educationRecordSchema = z.object({
  degree: z.string().min(1, "Degree is required").max(255),
  institution: z.string().min(1, "Institution is required").max(255),
  year: z.number().int().min(1900).max(2100),
  fieldOfStudy: z.string().max(255).optional(),
  gpa: z.number().min(0).max(4.0).optional(),
})

/**
 * Qualifications Schema
 */
export const qualificationsSchema = z.object({
  education: z.array(educationRecordSchema),
  certifications: z.array(z.string()),
  licenses: z.array(z.string()),
  specializations: z.array(z.string()).optional(),
})

/**
 * Staff Schema
 * Comprehensive staff entity
 */
export const staffSchema = z.object({
  staffId: uuidSchema,
  employeeNumber: identifierNumberSchema,
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  middleName: z.string().max(100).optional(),
  dateOfBirth: isoDateSchema.optional(),
  gender: genderSchema.optional(),
  contactInfo: requiredContactInfoSchema,
  employment: z.object({
    hireDate: isoDateSchema,
    employmentType: employmentTypeSchema,
    status: employmentStatusSchema,
    terminationDate: isoDateSchema.optional(),
    terminationReason: z.string().max(500).optional(),
  }),
  roles: z.array(staffRoleSchema),
  qualifications: qualificationsSchema.optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type Gender = z.infer<typeof genderSchema>
export type EmploymentType = z.infer<typeof employmentTypeSchema>
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>
export type StaffRoleType = z.infer<typeof staffRoleTypeSchema>
export type StaffRole = z.infer<typeof staffRoleSchema>
export type EducationRecord = z.infer<typeof educationRecordSchema>
export type Qualifications = z.infer<typeof qualificationsSchema>
export type Staff = z.infer<typeof staffSchema>


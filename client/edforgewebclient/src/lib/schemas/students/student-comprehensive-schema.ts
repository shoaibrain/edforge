/**
 * EdForge EMIS - Comprehensive Student Schema
 * 
 * Comprehensive student schema that composes all relevant sub-schemas
 * Aligns with SABER framework and EMIS requirements
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, emailSchema, phoneSchema, gradeLevelSchema } from "../base"
import { addressSchema } from "../base/address-schema"
import { studentBehavioralAnalyticsSchema } from "../administrative/behavioral-schema"
import { specialNeedsStudentRecordSchema } from "../administrative/special-needs-schema"
import { gradeSummarySchema } from "../learning-outcomes/grades-schema"

/**
 * Gender Schema
 */
const genderSchema = z.enum(["male", "female", "other", "prefer_not_to_say"])

/**
 * Student Contact Schema
 */
export const studentContactSchema = z.object({
  type: z.enum(["primary", "emergency", "guardian"]),
  name: z.string().min(1, "Name is required").max(255),
  relationship: z.string().max(100),
  phone: phoneSchema,
  email: emailSchema.optional(),
  address: addressSchema.optional(),
})

/**
 * Student Medical Schema
 */
export const studentMedicalSchema = z.object({
  bloodType: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  allergies: z.array(z.string()).optional(),
  medications: z.array(z.string()).optional(),
  conditions: z.array(z.string()).optional(),
  emergencyContact: z.string().min(1, "Emergency contact is required").max(255),
  insuranceProvider: z.string().max(255).optional(),
})

/**
 * Student Class Schema
 */
export const studentClassSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1, "Class name is required").max(255),
  teacher: z.string().max(255),
  room: z.string().max(100).optional(),
  schedule: z.string().max(255).optional(),
  credits: z.number().min(0).max(10),
  grade: z.string().max(10).optional(),
  attendance: z.object({
    present: z.number().int().min(0),
    absent: z.number().int().min(0),
    tardy: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
})

/**
 * Student Performance Data Schema
 */
export const studentPerformanceDataSchema = z.object({
  category: z.string().min(1, "Category is required").max(255),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  trend: z.enum(["up", "down", "stable"]).optional(),
  description: z.string().max(1000).optional(),
})

/**
 * Student Profile Summary Schema
 * Summary student profile for table/list views
 */
export const studentProfileSummarySchema = z.object({
  studentId: uuidSchema,
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  dateOfBirth: isoDateSchema,
  gender: genderSchema,
  grade: gradeLevelSchema,
  section: z.string().max(50).optional(),
  academicYear: z.string().min(1, "Academic year is required"),
  enrollmentDate: isoDateSchema,
  graduationDate: isoDateSchema.optional(),
  status: z.enum(["active", "graduated", "transferred", "suspended"]),
  overallGPA: z.number().min(0).max(4.0),
  address: addressSchema,
  lastUpdated: isoDateSchema,
  createdAt: isoDateSchema,
  updatedBy: uuidSchema,
})

/**
 * Comprehensive Student Profile Schema
 * Complete student profile with all related data
 */
export const comprehensiveStudentProfileSchema = studentProfileSummarySchema.extend({
  // Performance Data
  performanceData: z.array(studentPerformanceDataSchema).optional(),
  
  // Contact Information
  contacts: z.array(studentContactSchema).optional(),
  
  // Academic Details
  classes: z.array(studentClassSchema).optional(),
  extracurriculars: z.array(z.string()).optional(),
  awards: z.array(z.string()).optional(),
  
  // Medical Information
  medical: studentMedicalSchema.optional(),
  
  // Behavioral Analytics
  behavioralAnalytics: studentBehavioralAnalyticsSchema.optional(),
  
  // Special Needs
  specialNeeds: specialNeedsStudentRecordSchema.optional(),
  
  // Grade Summary
  gradeSummary: z.array(gradeSummarySchema).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type StudentContact = z.infer<typeof studentContactSchema>
export type StudentMedical = z.infer<typeof studentMedicalSchema>
export type StudentClass = z.infer<typeof studentClassSchema>
export type StudentPerformanceData = z.infer<typeof studentPerformanceDataSchema>
export type StudentProfileSummary = z.infer<typeof studentProfileSummarySchema>
export type ComprehensiveStudentProfile = z.infer<typeof comprehensiveStudentProfileSchema>


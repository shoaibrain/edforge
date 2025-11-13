/**
 * EdForge EMIS - Comprehensive School Schema
 * 
 * Comprehensive school schema that composes all relevant sub-schemas
 * Aligns with SABER framework and EMIS requirements
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, urlSchema, timezoneSchema, countryCodeSchema } from "../base"
import { addressSchema, contactInfoSchema } from "../base"
import { gradeLevelSchema } from "../base/common-validators"
import { efficiencyMetricSchema, schoolDevelopmentPlanSchema } from "../administrative/administrative-indicators-schema"
import { serviceDeliverySummarySchema } from "../administrative/service-delivery-schema"
import { financialAnalyticsSchema } from "../financial/financial-analytics-schema"
import { ratioAnalyticsSchema } from "../administrative/ratio-schema"

/**
 * School Type Schema
 */
export const schoolTypeSchema = z.enum([
  "elementary",
  "middle",
  "high",
  "k12",
  "alternative",
  "special",
])

/**
 * School Status Schema
 */
export const schoolStatusSchema = z.enum([
  "active",
  "inactive",
  "suspended",
  "closed",
  "planned",
])

/**
 * Grade Range Schema
 */
export const gradeRangeSchema = z.object({
  lowestGrade: gradeLevelSchema,
  highestGrade: gradeLevelSchema,
}).refine((data) => {
  const gradeOrder = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
  const lowestIndex = gradeOrder.indexOf(data.lowestGrade)
  const highestIndex = gradeOrder.indexOf(data.highestGrade)
  return lowestIndex <= highestIndex
}, {
  message: "Highest grade must be greater than or equal to lowest grade",
  path: ["highestGrade"],
})

/**
 * Accreditation Info Schema
 */
export const accreditationInfoSchema = z.object({
  accreditedBy: z.array(z.string().max(255)),
  accreditationExpiry: isoDateSchema.optional(),
})

/**
 * School Profile Summary Schema
 * Summary school profile for list views
 */
export const schoolProfileSummarySchema = z.object({
  schoolId: uuidSchema,
  schoolName: z.string().min(3, "School name must be at least 3 characters").max(255),
  schoolCode: z.string().min(3, "School code must be at least 3 characters").max(50),
  schoolType: schoolTypeSchema,
  status: schoolStatusSchema,
  maxStudentCapacity: z.number().int().min(1).max(50000),
  currentEnrollment: z.number().int().min(0).optional(),
  gradeRange: gradeRangeSchema,
  address: addressSchema,
  contactInfo: contactInfoSchema,
})

/**
 * Comprehensive School Profile Schema
 * Complete school profile with all related data
 */
export const comprehensiveSchoolProfileSchema = schoolProfileSummarySchema.extend({
  // Administrative
  principalUserId: uuidSchema.optional(),
  vicePrincipalUserIds: z.array(uuidSchema).optional(),
  administrativeStaffCount: z.number().int().min(0).optional(),
  
  // Accreditation
  accreditationInfo: accreditationInfoSchema.optional(),
  
  // Metadata
  foundedDate: isoDateSchema.optional(),
  description: z.string().max(1000).optional(),
  motto: z.string().max(255).optional(),
  logoUrl: urlSchema,
  
  // Administrative Indicators
  efficiencyMetrics: z.array(efficiencyMetricSchema).optional(),
  developmentPlans: z.array(schoolDevelopmentPlanSchema).optional(),
  
  // Service Delivery
  serviceDelivery: serviceDeliverySummarySchema.optional(),
  
  // Financial
  financialAnalytics: financialAnalyticsSchema.optional(),
  
  // Ratios
  ratioAnalytics: ratioAnalyticsSchema.optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type SchoolType = z.infer<typeof schoolTypeSchema>
export type SchoolStatus = z.infer<typeof schoolStatusSchema>
export type GradeRange = z.infer<typeof gradeRangeSchema>
export type AccreditationInfo = z.infer<typeof accreditationInfoSchema>
export type SchoolProfileSummary = z.infer<typeof schoolProfileSummarySchema>
export type ComprehensiveSchoolProfile = z.infer<typeof comprehensiveSchoolProfileSchema>


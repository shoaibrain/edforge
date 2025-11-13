/**
 * EdForge EMIS - Contact Information Schema
 * 
 * Contact information schema for entities (schools, staff, students, parents)
 * Supports multiple contact methods with validation
 */

import { z } from "zod"
import { emailSchema, phoneSchema, urlSchema } from "./common-validators"

/**
 * Contact Information Schema
 * Primary contact information with optional secondary methods
 */
export const contactInfoSchema = z.object({
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  secondaryPhone: phoneSchema.optional(),
  website: urlSchema,
  fax: z
    .string()
    .max(20, "Fax number must be no more than 20 characters")
    .optional(),
})

/**
 * Required Contact Information Schema
 * For entities that must have email and phone
 */
export const requiredContactInfoSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  secondaryPhone: phoneSchema.optional(),
  website: urlSchema,
  fax: z
    .string()
    .max(20, "Fax number must be no more than 20 characters")
    .optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type ContactInfo = z.infer<typeof contactInfoSchema>
export type RequiredContactInfo = z.infer<typeof requiredContactInfoSchema>


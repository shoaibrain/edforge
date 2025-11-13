/**
 * EdForge EMIS - Financing Schema
 * 
 * Financing relationships (Stakeholders → Providers)
 * Part of SABER framework accountability features
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema } from "../base"

/**
 * Financing Relationship Schema
 * Financing relationship record
 */
export const financingRelationshipSchema = z.object({
  financingId: uuidSchema,
  stakeholderId: uuidSchema,
  providerId: uuidSchema,
  amount: currencySchema,
  financingType: z.enum([
    "tuition",
    "donation",
    "grant",
    "government_funding",
    "sponsorship",
    "other",
  ]),
  period: z.string().min(1, "Period is required"),
  status: z.enum(["approved", "pending", "disbursed", "cancelled"]),
  disbursementDate: isoDateSchema.optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type FinancingRelationship = z.infer<typeof financingRelationshipSchema>


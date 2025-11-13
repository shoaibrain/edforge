/**
 * EdForge EMIS - Informing Schema
 * 
 * Information dissemination (Providers → Stakeholders)
 * Part of SABER framework accountability features
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema } from "../base"

/**
 * Information Dissemination Schema
 * Information dissemination record
 */
export const informationDisseminationSchema = z.object({
  disseminationId: uuidSchema,
  providerId: uuidSchema,
  stakeholderId: uuidSchema.optional(), // null for public dissemination
  informationType: z.enum([
    "performance_report",
    "financial_report",
    "academic_results",
    "policy_update",
    "announcement",
    "other",
  ]),
  title: z.string().min(1, "Title is required").max(255),
  content: z.string().max(5000).optional(),
  disseminationMethod: z.enum([
    "publication",
    "email",
    "meeting",
    "website",
    "newsletter",
    "other",
  ]),
  disseminationDate: isoDateSchema,
  accessCount: z.number().int().min(0).default(0),
})

/**
 * TypeScript types inferred from schemas
 */
export type InformationDissemination = z.infer<typeof informationDisseminationSchema>


/**
 * EdForge EMIS - Enforcing Schema
 * 
 * Enforcement mechanisms (Stakeholders → Providers)
 * Part of SABER framework accountability features
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema } from "../base"

/**
 * Enforcement Action Schema
 * Enforcement action record
 */
export const enforcementActionSchema = z.object({
  actionId: uuidSchema,
  stakeholderId: uuidSchema,
  providerId: uuidSchema,
  actionType: z.enum([
    "sanction",
    "penalty",
    "requirement",
    "corrective_action",
    "review",
    "other",
  ]),
  reason: z.string().min(1, "Reason is required").max(1000),
  actionDate: isoDateSchema,
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  resolutionDate: isoDateSchema.optional(),
  outcome: z.string().max(1000).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type EnforcementAction = z.infer<typeof enforcementActionSchema>


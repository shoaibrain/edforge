/**
 * EdForge EMIS - Delegating Schema
 * 
 * Delegation tracking (Stakeholders → Providers)
 * Part of SABER framework accountability features
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema } from "../base"

/**
 * Delegation Schema
 * Delegation record from stakeholders to providers
 */
export const delegationSchema = z.object({
  delegationId: uuidSchema,
  stakeholderId: uuidSchema, // Parent, community, student, etc.
  providerId: uuidSchema, // School, teacher, Ministry of Education
  delegationType: z.enum([
    "authority",
    "responsibility",
    "resources",
    "decision_making",
    "other",
  ]),
  delegatedTo: z.string().max(255),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["active", "completed", "revoked", "expired"]),
  description: z.string().max(1000).optional(),
})

/**
 * TypeScript types inferred from schemas
 */
export type Delegation = z.infer<typeof delegationSchema>


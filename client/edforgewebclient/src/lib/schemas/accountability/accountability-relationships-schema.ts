/**
 * EdForge EMIS - Accountability Relationships Schema
 * 
 * Three-way accountability relationships:
 * 1. EMIS/state holds policy makers and education providers accountable
 * 2. Clients hold EMIS accountable
 * 3. Clients hold education providers accountable
 * Part of SABER framework
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, percentageSchema } from "../base"
import { delegationSchema } from "./delegating-schema"
import { financingRelationshipSchema } from "./financing-schema"
import { performanceAccountabilitySchema } from "./performing-schema"
import { informationDisseminationSchema } from "./informing-schema"
import { enforcementActionSchema } from "./enforcing-schema"

/**
 * Accountability Relationship Type Schema
 */
export const accountabilityRelationshipTypeSchema = z.enum([
  "emis_to_providers",
  "clients_to_emis",
  "clients_to_providers",
])

/**
 * Accountability Relationship Schema
 * Comprehensive accountability relationship
 */
export const accountabilityRelationshipSchema = z.object({
  relationshipId: uuidSchema,
  relationshipType: accountabilityRelationshipTypeSchema,
  emisId: uuidSchema.optional(),
  clientId: uuidSchema,
  providerId: uuidSchema,
  delegations: z.array(delegationSchema).optional(),
  financing: z.array(financingRelationshipSchema).optional(),
  performance: z.array(performanceAccountabilitySchema).optional(),
  information: z.array(informationDisseminationSchema).optional(),
  enforcement: z.array(enforcementActionSchema).optional(),
  accountabilityScore: percentageSchema.optional(),
  lastUpdated: isoDateSchema,
})

/**
 * Accountability Analytics Schema
 * Comprehensive accountability analytics
 */
export const accountabilityAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  period: z.string().min(1, "Period is required"),
  overallAccountabilityScore: percentageSchema,
  relationshipScores: z.record(z.string(), percentageSchema),
  delegations: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
  }),
  financing: z.object({
    totalAmount: z.number().min(0),
    disbursedAmount: z.number().min(0),
  }),
  performance: z.object({
    metricsTracked: z.number().int().min(0),
    targetsMet: z.number().int().min(0),
  }),
  information: z.object({
    totalDisseminations: z.number().int().min(0),
    publicAccessCount: z.number().int().min(0),
  }),
  enforcement: z.object({
    totalActions: z.number().int().min(0),
    resolvedActions: z.number().int().min(0),
  }),
})

/**
 * TypeScript types inferred from schemas
 */
export type AccountabilityRelationshipType = z.infer<typeof accountabilityRelationshipTypeSchema>
export type AccountabilityRelationship = z.infer<typeof accountabilityRelationshipSchema>
export type AccountabilityAnalytics = z.infer<typeof accountabilityAnalyticsSchema>


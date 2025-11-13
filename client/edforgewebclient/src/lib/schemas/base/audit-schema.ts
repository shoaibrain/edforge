/**
 * EdForge EMIS - Audit Schema
 * 
 * Audit trail and versioning schema for all entities
 * Supports optimistic locking and change tracking
 */

import { z } from "zod"
import { uuidSchema, isoDateTimeSchema } from "./common-validators"

/**
 * Base Entity Audit Fields
 * Common audit fields for all entities
 */
export const auditFieldsSchema = z.object({
  createdAt: isoDateTimeSchema,
  createdBy: uuidSchema,
  updatedAt: isoDateTimeSchema,
  updatedBy: uuidSchema,
  version: z
    .number()
    .int("Version must be an integer")
    .min(0, "Version must be non-negative"),
})

/**
 * Base Entity Schema
 * Complete base entity with audit fields
 */
export const baseEntitySchema = z.object({
  tenantId: uuidSchema,
  entityId: uuidSchema,
  entityType: z.string().min(1, "Entity type is required"),
  ...auditFieldsSchema.shape,
})

/**
 * TypeScript types inferred from schemas
 */
export type AuditFields = z.infer<typeof auditFieldsSchema>
export type BaseEntity = z.infer<typeof baseEntitySchema>


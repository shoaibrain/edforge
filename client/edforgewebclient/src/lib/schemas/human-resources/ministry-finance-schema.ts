/**
 * EdForge EMIS - Ministry of Finance HR Data Schema
 * 
 * Integration with Ministry of Finance HR data (if applicable)
 * Supports centralized HR management and reporting
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema } from "../base"

/**
 * Ministry Finance HR Record Schema
 * HR data from Ministry of Finance
 */
export const ministryFinanceHRRecordSchema = z.object({
  recordId: uuidSchema,
  staffId: uuidSchema,
  ministryEmployeeId: z.string().max(100).optional(),
  payrollNumber: z.string().max(100).optional(),
  salaryGrade: z.string().max(50).optional(),
  salaryStep: z.string().max(50).optional(),
  ministryBaseSalary: currencySchema.optional(),
  lastSyncDate: isoDateSchema.optional(),
  syncStatus: z.enum(["synced", "pending", "error", "not_applicable"]),
  notes: z.string().max(1000).optional(),
})

/**
 * Ministry Finance HR Sync Schema
 * Synchronization metadata
 */
export const ministryFinanceHRSyncSchema = z.object({
  syncId: uuidSchema,
  syncDate: isoDateSchema,
  recordsSynced: z.number().int().min(0),
  recordsUpdated: z.number().int().min(0),
  recordsCreated: z.number().int().min(0),
  errors: z.array(z.string()).optional(),
  status: z.enum(["success", "partial", "failed"]),
})

/**
 * TypeScript types inferred from schemas
 */
export type MinistryFinanceHRRecord = z.infer<typeof ministryFinanceHRRecordSchema>
export type MinistryFinanceHRSync = z.infer<typeof ministryFinanceHRSyncSchema>


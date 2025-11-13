/**
 * EdForge EMIS - Conditional Cash Transfer Schema
 * 
 * Conditional cash transfer data for staff
 * Supports incentive programs and performance-based compensation
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema } from "../base"

/**
 * Conditional Cash Transfer Schema
 * Individual conditional cash transfer record
 */
export const conditionalCashTransferSchema = z.object({
  transferId: uuidSchema,
  staffId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  programName: z.string().min(1, "Program name is required").max(255),
  transferType: z.enum([
    "performance_bonus",
    "attendance_bonus",
    "retention_bonus",
    "recruitment_bonus",
    "professional_development",
    "other",
  ]),
  amount: currencySchema,
  conditions: z.array(z.object({
    condition: z.string().min(1, "Condition is required"),
    status: z.enum(["met", "not_met", "pending"]),
    verificationDate: isoDateSchema.optional(),
  })),
  paymentDate: isoDateSchema.optional(),
  status: z.enum(["pending", "approved", "paid", "denied", "cancelled"]),
  approvedBy: uuidSchema.optional(),
  approvedDate: isoDateSchema.optional(),
  notes: z.string().max(1000).optional(),
})

/**
 * Conditional Cash Transfer Analytics Schema
 * Comprehensive conditional cash transfer analytics
 */
export const conditionalCashTransferAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalTransfers: currencySchema,
  totalPaid: currencySchema,
  totalPending: currencySchema,
  totalDenied: currencySchema,
  transferCount: z.number().int().min(0),
  averageTransferAmount: currencySchema,
  typeBreakdown: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    totalAmount: currencySchema,
    averageAmount: currencySchema,
  })),
  staffParticipation: z.array(z.object({
    staffId: uuidSchema,
    totalReceived: currencySchema,
    transferCount: z.number().int().min(0),
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalTransfers: currencySchema,
    transferCount: z.number().int().min(0),
    averageAmount: currencySchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type ConditionalCashTransfer = z.infer<typeof conditionalCashTransferSchema>
export type ConditionalCashTransferAnalytics = z.infer<typeof conditionalCashTransferAnalyticsSchema>


/**
 * EdForge EMIS - Fees Schema
 * 
 * School fees structure, collection, and tracking
 * Supports financial accountability and planning
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, percentageSchema, nonNegativeNumberSchema } from "../base"

/**
 * Fee Structure Schema
 * Fee structure definition
 */
export const feeStructureSchema = z.object({
  feeId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  feeName: z.string().min(1, "Fee name is required").max(255),
  feeType: z.enum([
    "tuition",
    "registration",
    "activity",
    "technology",
    "textbook",
    "uniform",
    "transportation",
    "meal",
    "library",
    "laboratory",
    "other",
  ]),
  amount: currencySchema,
  gradeLevel: z.string().optional(), // Specific to grade level
  paymentFrequency: z.enum([
    "one_time",
    "annual",
    "semester",
    "quarterly",
    "monthly",
    "per_term",
  ]),
  dueDate: isoDateSchema.optional(),
  isMandatory: z.boolean().default(true),
  isRefundable: z.boolean().default(false),
  status: z.enum(["active", "inactive", "cancelled"]),
})

/**
 * Fee Payment Schema
 * Individual fee payment record
 */
export const feePaymentSchema = z.object({
  paymentId: uuidSchema,
  studentId: uuidSchema,
  feeId: uuidSchema,
  amount: currencySchema,
  paymentDate: isoDateSchema,
  paymentMethod: z.enum([
    "cash",
    "check",
    "credit_card",
    "debit_card",
    "bank_transfer",
    "online_payment",
    "scholarship",
    "waiver",
    "other",
  ]),
  transactionReference: z.string().max(100).optional(),
  status: z.enum(["pending", "completed", "failed", "refunded", "cancelled"]),
  notes: z.string().max(500).optional(),
  recordedBy: uuidSchema,
})

/**
 * Fee Waiver Schema
 * Fee waiver or scholarship record
 */
export const feeWaiverSchema = z.object({
  waiverId: uuidSchema,
  studentId: uuidSchema,
  feeId: uuidSchema,
  waiverType: z.enum([
    "full_waiver",
    "partial_waiver",
    "scholarship",
    "financial_aid",
    "other",
  ]),
  waivedAmount: currencySchema,
  reason: z.string().max(500).optional(),
  approvedBy: uuidSchema,
  approvedDate: isoDateSchema,
  status: z.enum(["pending", "approved", "denied", "expired"]),
  expiryDate: isoDateSchema.optional(),
})

/**
 * Fee Collection Analytics Schema
 * Comprehensive fee collection analytics
 */
export const feeCollectionAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalFeesDue: currencySchema,
  totalFeesCollected: currencySchema,
  totalFeesOutstanding: currencySchema,
  collectionRate: percentageSchema,
  totalWaivers: currencySchema,
  totalPayments: nonNegativeNumberSchema,
  averagePaymentAmount: currencySchema,
  feeTypeBreakdown: z.record(z.string(), z.object({
    totalDue: currencySchema,
    totalCollected: currencySchema,
    totalOutstanding: currencySchema,
    collectionRate: percentageSchema,
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalDue: currencySchema,
    totalCollected: currencySchema,
    collectionRate: percentageSchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type FeeStructure = z.infer<typeof feeStructureSchema>
export type FeePayment = z.infer<typeof feePaymentSchema>
export type FeeWaiver = z.infer<typeof feeWaiverSchema>
export type FeeCollectionAnalytics = z.infer<typeof feeCollectionAnalyticsSchema>


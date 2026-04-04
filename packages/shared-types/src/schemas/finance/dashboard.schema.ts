/**
 * Dashboard Summary Schema
 *
 * Zod schemas for finance dashboard API responses.
 * Mirrors the DashboardSummary interface in dashboard.service.ts.
 */

import { z } from 'zod';

export const gradeLevelBreakdownSchema = z.object({
  gradeLevel: z.string(),
  invoiceCount: z.number().int(),
  totalInvoiced: z.number(),
  totalCollected: z.number(),
  outstanding: z.number(),
});

export type GradeLevelBreakdown = z.infer<typeof gradeLevelBreakdownSchema>;

export const feeTypeBreakdownSchema = z.object({
  feeType: z.string(),
  invoiceCount: z.number().int(),
  totalAmount: z.number(),
  collectedAmount: z.number(),
});

export type FeeTypeBreakdown = z.infer<typeof feeTypeBreakdownSchema>;

export const agingBucketSchema = z.object({
  label: z.string(),
  minDays: z.number().int(),
  maxDays: z.number().int().nullable(),
  count: z.number().int(),
  amount: z.number(),
});

export type AgingBucket = z.infer<typeof agingBucketSchema>;

export const monthlyCollectionSchema = z.object({
  month: z.string(), // YYYY-MM
  collected: z.number(),
  invoiced: z.number(),
  paymentCount: z.number().int(),
});

export type MonthlyCollection = z.infer<typeof monthlyCollectionSchema>;

export const dashboardSummarySchema = z.object({
  totalInvoiced: z.number(),
  totalCollected: z.number(),
  outstanding: z.number(),
  overdue: z.number(),
  collectionRate: z.number(),
  invoicesByStatus: z.record(z.number()),
  paymentsByGateway: z.record(z.number()),
  byGradeLevel: z.array(gradeLevelBreakdownSchema),
  byFeeType: z.array(feeTypeBreakdownSchema),
  agingReport: z.array(agingBucketSchema),
  monthlyCollections: z.array(monthlyCollectionSchema),
  recentPayments: z.array(z.object({
    id: z.string(),
    amount: z.number(),
    gateway: z.string(),
    status: z.string(),
    receiptNumber: z.string().optional(),
    paidAt: z.string().optional(),
    createdAt: z.string(),
  })),
  recentInvoices: z.array(z.object({
    id: z.string(),
    invoiceNumber: z.string(),
    studentName: z.string(),
    grandTotal: z.number(),
    amountDue: z.number(),
    status: z.string(),
    issuedDate: z.string(),
    createdAt: z.string(),
  })),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const dashboardFiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  academicYear: z.string().optional(),
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

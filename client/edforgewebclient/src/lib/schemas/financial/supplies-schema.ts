/**
 * EdForge EMIS - Supplies Schema
 * 
 * Supply-side items: textbooks, teaching materials, desks, paper, writing instruments
 * Tracks resource availability and utilization
 */

import { z } from "zod"
import { uuidSchema, isoDateSchema, currencySchema, nonNegativeNumberSchema } from "../base"

/**
 * Supply Category Schema
 * Supply item category
 */
export const supplyCategorySchema = z.enum([
  "textbooks",
  "teaching_materials",
  "desks",
  "chairs",
  "paper",
  "writing_instruments",
  "technology_equipment",
  "laboratory_equipment",
  "library_books",
  "sports_equipment",
  "art_supplies",
  "music_equipment",
  "other",
])

/**
 * Supply Item Schema
 * Individual supply item
 */
export const supplyItemSchema = z.object({
  itemId: uuidSchema,
  schoolId: uuidSchema,
  itemName: z.string().min(1, "Item name is required").max(255),
  category: supplyCategorySchema,
  description: z.string().max(1000).optional(),
  unit: z.string().max(50).optional(), // e.g., "each", "box", "set"
  unitCost: currencySchema.optional(),
  quantityOnHand: nonNegativeNumberSchema.default(0),
  quantityRequired: nonNegativeNumberSchema.optional(),
  quantityOrdered: nonNegativeNumberSchema.default(0),
  reorderLevel: nonNegativeNumberSchema.optional(),
  supplier: z.string().max(255).optional(),
  lastOrderDate: isoDateSchema.optional(),
  lastReceivedDate: isoDateSchema.optional(),
  status: z.enum(["available", "low_stock", "out_of_stock", "ordered", "discontinued"]),
})

/**
 * Supply Order Schema
 * Supply order record
 */
export const supplyOrderSchema = z.object({
  orderId: uuidSchema,
  schoolId: uuidSchema,
  orderDate: isoDateSchema,
  expectedDeliveryDate: isoDateSchema.optional(),
  actualDeliveryDate: isoDateSchema.optional(),
  items: z.array(z.object({
    itemId: uuidSchema,
    itemName: z.string(),
    quantity: nonNegativeNumberSchema,
    unitCost: currencySchema,
    totalCost: currencySchema,
  })),
  totalCost: currencySchema,
  supplier: z.string().max(255),
  orderNumber: z.string().max(100).optional(),
  status: z.enum(["pending", "ordered", "in_transit", "received", "cancelled"]),
  receivedBy: uuidSchema.optional(),
  notes: z.string().max(1000).optional(),
})

/**
 * Supply Utilization Schema
 * Tracks how supplies are being used
 */
export const supplyUtilizationSchema = z.object({
  itemId: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  totalAvailable: nonNegativeNumberSchema,
  totalUsed: nonNegativeNumberSchema,
  totalDistributed: nonNegativeNumberSchema,
  utilizationRate: z.number().min(0).max(100), // Percentage
  distributionBreakdown: z.record(z.string(), z.object({
    // Key: grade level, department, or classroom
    quantity: nonNegativeNumberSchema,
    percentage: z.number().min(0).max(100),
  })).optional(),
})

/**
 * Supply Analytics Schema
 * Comprehensive supply analytics
 */
export const supplyAnalyticsSchema = z.object({
  schoolId: uuidSchema.optional(),
  academicYearId: uuidSchema.optional(),
  totalItems: nonNegativeNumberSchema,
  totalValue: currencySchema,
  categoryBreakdown: z.record(z.string(), z.object({
    itemCount: nonNegativeNumberSchema,
    totalValue: currencySchema,
    averageUtilization: z.number().min(0).max(100),
  })),
  lowStockItems: z.array(z.object({
    itemId: uuidSchema,
    itemName: z.string(),
    quantityOnHand: nonNegativeNumberSchema,
    reorderLevel: nonNegativeNumberSchema,
    status: z.enum(["low_stock", "out_of_stock"]),
  })),
  trends: z.array(z.object({
    period: z.string(),
    totalOrders: nonNegativeNumberSchema,
    totalCost: currencySchema,
    averageOrderValue: currencySchema,
  })),
})

/**
 * TypeScript types inferred from schemas
 */
export type SupplyCategory = z.infer<typeof supplyCategorySchema>
export type SupplyItem = z.infer<typeof supplyItemSchema>
export type SupplyOrder = z.infer<typeof supplyOrderSchema>
export type SupplyUtilization = z.infer<typeof supplyUtilizationSchema>
export type SupplyAnalytics = z.infer<typeof supplyAnalyticsSchema>


/**
 * EdForge EMIS - Common Validators
 * 
 * Reusable validation utilities for Zod schemas
 * Provides consistent validation patterns across the application
 */

import { z } from "zod"

/**
 * UUID validation
 */
export const uuidSchema = z.string().uuid("Must be a valid UUID")

/**
 * Email validation
 */
export const emailSchema = z
  .string()
  .email("Must be a valid email address")
  .max(255, "Email must be no more than 255 characters")

/**
 * Phone number validation (E.164 format)
 */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be in E.164 format (e.g., +1-555-0123)")
  .max(20, "Phone number must be no more than 20 characters")

/**
 * ISO Date string validation (YYYY-MM-DD)
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine((date) => {
    const d = new Date(date)
    return !isNaN(d.getTime())
  }, "Date must be a valid date")

/**
 * ISO DateTime string validation
 */
export const isoDateTimeSchema = z
  .string()
  .datetime({ message: "Must be a valid ISO 8601 datetime string" })

/**
 * URL validation
 */
export const urlSchema = z
  .string()
  .url("Must be a valid URL")
  .max(2048, "URL must be no more than 2048 characters")
  .optional()
  .or(z.literal(""))

/**
 * IANA Timezone validation
 */
export const IANA_TIMEZONE_REGEX = /^[A-Za-z_]+\/[A-Za-z_]+$/
export const timezoneSchema = z
  .string()
  .regex(IANA_TIMEZONE_REGEX, "Must be a valid IANA timezone (e.g., America/New_York)")
  .max(100, "Timezone must be no more than 100 characters")

/**
 * Country code validation (ISO 3166-1 alpha-2)
 */
export const countryCodeSchema = z
  .string()
  .length(2, "Country code must be 2 letters")
  .regex(/^[A-Z]{2}$/, "Country code must be uppercase letters (e.g., US, CA, GB)")

/**
 * Percentage validation (0-100)
 */
export const percentageSchema = z
  .number()
  .min(0, "Percentage must be at least 0")
  .max(100, "Percentage must be at most 100")

/**
 * Positive number validation
 */
export const positiveNumberSchema = z
  .number()
  .positive("Must be a positive number")

/**
 * Non-negative number validation
 */
export const nonNegativeNumberSchema = z
  .number()
  .min(0, "Must be a non-negative number")

/**
 * Year validation
 */
export const yearSchema = z
  .number()
  .int("Year must be an integer")
  .min(1900, "Year must be at least 1900")
  .max(2100, "Year must be at most 2100")

/**
 * Grade level validation (K-12)
 */
export const gradeLevelSchema = z.enum([
  "K",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
])

/**
 * Currency amount validation
 */
export const currencySchema = z
  .number()
  .min(0, "Amount must be non-negative")
  .max(999999999.99, "Amount exceeds maximum value")

/**
 * Employee/Student number validation
 */
export const identifierNumberSchema = z
  .string()
  .min(3, "Identifier must be at least 3 characters")
  .max(50, "Identifier must be no more than 50 characters")
  .regex(/^[A-Z0-9-]+$/, "Identifier must contain only uppercase letters, numbers, and hyphens")


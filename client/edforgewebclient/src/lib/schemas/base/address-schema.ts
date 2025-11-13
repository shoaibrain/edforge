/**
 * EdForge EMIS - Address Schema
 * 
 * Comprehensive address schema supporting global deployments
 * Aligns with international address standards
 */

import { z } from "zod"
import { countryCodeSchema, timezoneSchema } from "./common-validators"

/**
 * Address Schema
 * Supports global deployments with optional geocoding
 */
export const addressSchema = z.object({
  street: z
    .string()
    .min(1, "Street address is required")
    .max(200, "Street address must be no more than 200 characters"),
  city: z
    .string()
    .min(1, "City is required")
    .max(100, "City must be no more than 100 characters"),
  state: z
    .string()
    .min(1, "State/Province/Region is required")
    .max(100, "State/Province/Region must be no more than 100 characters"),
  country: countryCodeSchema,
  postalCode: z
    .string()
    .min(1, "Postal code is required")
    .max(20, "Postal code must be no more than 20 characters"),
  latitude: z
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90")
    .optional(),
  longitude: z
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180")
    .optional(),
  timezone: timezoneSchema,
})

/**
 * TypeScript type inferred from schema
 */
export type Address = z.infer<typeof addressSchema>


/**
 * Location Schemas - Identity Service
 *
 * Zod schemas for school location/room management.
 * Ed-Fi: Location represents a physical space within a school
 * (classroom, lab, gym, etc.) that can be assigned to sections.
 *
 * Replaces the Classroom entity in Academics with a canonical
 * Location entity in Identity, enabling cross-service referencing.
 *
 * @see https://api.ed-fi.org/v7.1/docs/swagger/index.html - Location
 */

import { z } from 'zod';
import {
  isoDateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums
// ============================================

/**
 * Location type descriptor
 */
export const locationTypeSchema = z.enum([
  'classroom',
  'lab',
  'gym',
  'auditorium',
  'library',
  'office',
  'cafeteria',
  'other',
]);
export type LocationType = z.infer<typeof locationTypeSchema>;

// ============================================
// Create Location Schema
// ============================================

export const createLocationSchema = z.object({
  // Ed-Fi Core: classroomIdentificationCode
  roomNumber: z.string()
    .min(1, 'Room number is required')
    .max(20, 'Room number must not exceed 20 characters'),

  // Building info
  buildingName: z.string().max(100).optional(),
  floorNumber: z.number().int().optional(),

  // Capacity
  capacity: z.number().int().min(1).max(500).optional(),

  // Classification
  locationType: locationTypeSchema.default('classroom'),

  // Status
  isActive: z.boolean().default(true),

  // Description
  description: z.string().max(255).optional(),
});

export type CreateLocationDto = z.infer<typeof createLocationSchema>;

// ============================================
// Update Location Schema
// ============================================

export const updateLocationSchema = createLocationSchema.partial();

export type UpdateLocationDto = z.infer<typeof updateLocationSchema>;

// ============================================
// Location Response Schema
// ============================================

export const locationResponseSchema = z.object({
  // Identifiers
  locationId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),

  // Ed-Fi Core
  roomNumber: z.string(),

  // Building info
  buildingName: z.string().optional(),
  floorNumber: z.number().int().optional(),

  // Capacity
  capacity: z.number().int().optional(),

  // Classification
  locationType: locationTypeSchema,

  // Status
  isActive: z.boolean(),

  // Description
  description: z.string().optional(),

  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LocationResponseDto = z.infer<typeof locationResponseSchema>;

// ============================================
// Location List Response
// ============================================

export const locationListResponseSchema = createPaginatedResponseSchema(locationResponseSchema);
export type LocationListResponseDto = z.infer<typeof locationListResponseSchema>;

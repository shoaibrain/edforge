/**
 * Location Entity - Identity Service
 *
 * Ed-Fi Location represents a physical space within a school
 * (classroom, lab, gym, etc.) that can be assigned to sections.
 * Canonical school-infrastructure entity in Identity, enabling
 * cross-service referencing from Academics.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#LOCATION#{locationId}
 */

import { BaseEntity } from './base.entity';

// ============================================
// Location Type
// ============================================

export type LocationType =
  | 'classroom'
  | 'lab'
  | 'gym'
  | 'auditorium'
  | 'library'
  | 'office'
  | 'cafeteria'
  | 'other';

// ============================================
// Location Entity Interface
// ============================================

export interface Location extends BaseEntity {
  entityType: 'LOCATION';

  // Identifiers
  locationId: string;
  schoolId: string;

  // Ed-Fi Core
  roomNumber: string;

  // Building info
  buildingName?: string;
  floorNumber?: number;

  // Capacity
  capacity?: number;

  // Classification
  locationType: LocationType;

  // Status
  isActive: boolean;

  // Description
  description?: string;
}

// ============================================
// Entity Key Builders
// ============================================

export const LocationKeyBuilder = {
  /**
   * Location: SCHOOL#{schoolId}#LOCATION#{locationId}
   */
  location: (schoolId: string, locationId: string): string =>
    `SCHOOL#${schoolId}#LOCATION#${locationId}`,

  /**
   * Locations for school (prefix): SCHOOL#{schoolId}#LOCATION#
   */
  locationsPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#LOCATION#`,
};

// ============================================
// Factory Function
// ============================================

export function createLocationEntity(
  tenantId: string,
  schoolId: string,
  locationId: string,
  data: Omit<Location, 'tenantId' | 'entityKey' | 'entityType' | 'locationId' | 'schoolId'>
): Location {
  return {
    tenantId,
    entityKey: LocationKeyBuilder.location(schoolId, locationId),
    entityType: 'LOCATION',
    locationId,
    schoolId,
    ...data,
  };
}

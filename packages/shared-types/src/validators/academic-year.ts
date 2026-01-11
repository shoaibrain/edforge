/**
 * Academic Year Validators
 * 
 * Status transitions and business rule validators for academic years.
 */

import { z } from 'zod';
import { 
  academicYearStatusSchema, 
  type AcademicYearStatus 
} from '../schemas/identity/academic-year.schema';

// Re-export the canonical schema from identity for convenience
export { academicYearStatusSchema } from '../schemas/identity/academic-year.schema';

// ============================================
// Academic Year Status
// ============================================

export const ACADEMIC_YEAR_STATUSES = ['planning', 'active', 'completed', 'archived'] as const;
export type AcademicYearStatusType = AcademicYearStatus;

// ============================================
// Status Transitions
// ============================================

/**
 * Valid status transitions for academic years
 * Key: current status, Value: array of valid next statuses
 */
const VALID_STATUS_TRANSITIONS: Record<AcademicYearStatusType, AcademicYearStatusType[]> = {
  planning: ['active'],
  active: ['completed'],
  completed: ['archived'],
  archived: [],
};

/**
 * Status display names
 */
export const ACADEMIC_YEAR_STATUS_NAMES: Record<AcademicYearStatusType, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

/**
 * Status descriptions
 */
export const ACADEMIC_YEAR_STATUS_DESCRIPTIONS: Record<AcademicYearStatusType, string> = {
  planning: 'Academic year is being configured. Settings can be freely modified.',
  active: 'Academic year is in progress. Some settings are locked.',
  completed: 'Academic year has ended. Data is read-only.',
  archived: 'Academic year is archived. May be hidden from default views.',
};

// ============================================
// Utility Functions
// ============================================

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  from: AcademicYearStatusType,
  to: AcademicYearStatusType
): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the list of valid next statuses from current status
 */
export function getNextValidStatuses(current: AcademicYearStatusType): AcademicYearStatusType[] {
  return VALID_STATUS_TRANSITIONS[current] ?? [];
}

/**
 * Check if settings can be modified in the given status
 */
export function canModifySettings(status: AcademicYearStatusType): boolean {
  return status === 'planning';
}

/**
 * Check if the academic year is currently active (data is being recorded)
 */
export function isYearActive(status: AcademicYearStatusType): boolean {
  return status === 'active';
}

/**
 * Check if the academic year is finalized (completed or archived)
 */
export function isYearFinalized(status: AcademicYearStatusType): boolean {
  return status === 'completed' || status === 'archived';
}

/**
 * Get the display name for a status
 */
export function getStatusDisplayName(status: AcademicYearStatusType): string {
  return ACADEMIC_YEAR_STATUS_NAMES[status];
}

/**
 * Get the description for a status
 */
export function getStatusDescription(status: AcademicYearStatusType): string {
  return ACADEMIC_YEAR_STATUS_DESCRIPTIONS[status];
}

// ============================================
// Temporal Lock Constraint
// ============================================

/**
 * Settings that are locked when academic year is active or completed
 */
export const LOCKED_SETTINGS_WHEN_ACTIVE = [
  'startDate',
  'endDate',
  'gradingPeriods',
  'calendarType',
] as const;

/**
 * Settings that are always modifiable (even when active)
 */
export const ALWAYS_MODIFIABLE_SETTINGS = [
  'name',
  'description',
  'holidays',
] as const;

export type LockedSetting = typeof LOCKED_SETTINGS_WHEN_ACTIVE[number];
export type ModifiableSetting = typeof ALWAYS_MODIFIABLE_SETTINGS[number];

/**
 * Check if a specific setting can be modified given the current status
 */
export function canModifySetting(
  setting: string,
  status: AcademicYearStatusType
): boolean {
  // Archived years cannot be modified at all
  if (status === 'archived') {
    return false;
  }
  
  // Completed years are mostly read-only
  if (status === 'completed') {
    return false;
  }
  
  // Planning status allows all modifications
  if (status === 'planning') {
    return true;
  }
  
  // Active status - check if setting is always modifiable
  if (ALWAYS_MODIFIABLE_SETTINGS.includes(setting as ModifiableSetting)) {
    return true;
  }
  
  // Active status - check if setting is locked
  return !LOCKED_SETTINGS_WHEN_ACTIVE.includes(setting as LockedSetting);
}

// ============================================
// Academic Year Naming
// ============================================

/**
 * Generate a standard academic year name (e.g., "2024-2025")
 */
export function generateAcademicYearName(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

/**
 * Parse an academic year name to get the start year
 */
export function parseAcademicYearName(name: string): number | null {
  const match = name.match(/^(\d{4})-(\d{4})$/);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Validate an academic year name format
 */
export function isValidAcademicYearName(name: string): boolean {
  const match = name.match(/^(\d{4})-(\d{4})$/);
  if (!match) {
    return false;
  }
  const startYear = parseInt(match[1], 10);
  const endYear = parseInt(match[2], 10);
  return endYear === startYear + 1;
}

// ============================================
// Zod Schema with Status Transition Validation
// ============================================

export const statusTransitionSchema = z.object({
  currentStatus: academicYearStatusSchema,
  newStatus: academicYearStatusSchema,
}).refine(
  data => isValidStatusTransition(data.currentStatus, data.newStatus),
  data => ({
    message: `Invalid status transition from "${data.currentStatus}" to "${data.newStatus}". Valid transitions from "${data.currentStatus}": ${getNextValidStatuses(data.currentStatus).join(', ') || 'none'}`,
  })
);

export type StatusTransition = z.infer<typeof statusTransitionSchema>;

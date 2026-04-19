/**
 * Field Governance — Mutability Classification
 *
 * Classifies tenant, school, and configuration fields into three tiers:
 * - Immutable: cannot change after creation
 * - Locked during active year: cannot change while academic year is active
 * - Always editable: can change anytime
 */

// ============================================================================
// FIELD MUTABILITY TIERS
// ============================================================================

export const FIELD_MUTABILITY = {
  /**
   * Fields that can never change after entity creation.
   * - 'schoolCode' — identifies the school in studentNumber prefix; changing
   *   it retroactively would desync parent-facing IDs.
   * - 'archetype' — defines the tenant's governance/reporting contract;
   *   changing it mid-life would orphan IEMIS student IDs, currency data,
   *   and calendar conversions. System-admin override only, with audit.
   */
  immutable: ['schoolCode', 'archetype'] as const,

  /** Fields locked while any academic year has status='active' */
  lockedDuringActiveYear: [
    'academicCalendarType',
    'calendarSystem',
    'gradeRange',
    'gradeLevels',
    'gradingScale',
    'schoolDays',
    'startTime',
    'endTime',
    'periodDuration',
  ] as const,

  /** Fields that can always be edited regardless of academic year status */
  alwaysEditable: [
    'name',
    'shortName',
    'phone',
    'email',
    'website',
    'address',
    'principalName',
    'principalEmail',
    'timezone',
    'locale',
    'logoUrl',
    'features',
    'notificationsEnabled',
    'emailNotifications',
    'smsNotifications',
    'contactInfo',
    'dateFormat',
    'timeFormat',
  ] as const,
} as const;

const ALL_IMMUTABLE = new Set<string>(FIELD_MUTABILITY.immutable);
const ALL_LOCKED = new Set<string>(FIELD_MUTABILITY.lockedDuringActiveYear);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a field is locked given the current state.
 * - Immutable fields are ALWAYS locked (return true regardless of hasActiveYear).
 * - Locked-during-active-year fields are locked only when hasActiveYear is true.
 * - Always-editable fields are never locked.
 */
export function isFieldLocked(field: string, hasActiveAcademicYear: boolean): boolean {
  if (ALL_IMMUTABLE.has(field)) return true;
  if (ALL_LOCKED.has(field) && hasActiveAcademicYear) return true;
  return false;
}

/**
 * Generate a human-readable error message for locked fields.
 */
export function getLockedFieldsMessage(fields: string[]): string {
  const formatted = fields.map(f => `"${f}"`).join(', ');
  return `The following fields cannot be changed during an active academic year: ${formatted}. Complete or archive the current academic year first.`;
}

/**
 * Classify the fields in an update DTO into their mutability tiers.
 */
export function classifyUpdateFields(
  updateDto: Record<string, any>,
): { immutable: string[]; locked: string[]; editable: string[] } {
  const result = { immutable: [] as string[], locked: [] as string[], editable: [] as string[] };

  for (const key of Object.keys(updateDto)) {
    if (updateDto[key] === undefined) continue;
    if (ALL_IMMUTABLE.has(key)) {
      result.immutable.push(key);
    } else if (ALL_LOCKED.has(key)) {
      result.locked.push(key);
    } else {
      result.editable.push(key);
    }
  }

  return result;
}

/**
 * Get the mutability tier for a specific field.
 */
export function getFieldMutability(field: string): 'immutable' | 'locked_during_active_year' | 'always_editable' {
  if (ALL_IMMUTABLE.has(field)) return 'immutable';
  if (ALL_LOCKED.has(field)) return 'locked_during_active_year';
  return 'always_editable';
}

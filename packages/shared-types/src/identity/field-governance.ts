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

// ============================================================================
// WORKSPACE SETTINGS FIELD GOVERNANCE (nested dotted-path)
// ============================================================================
//
// The legacy flat `FIELD_MUTABILITY` above classifies TOP-LEVEL keys of
// school/tenant entities (e.g. `schoolCode`, `archetype`). Workspace
// settings are nested under `regional`, `branding`, and `policies`, so we
// classify them by dotted path so the same governance engine can reason
// about an `UpdateWorkspaceSettingsDto` payload.
//
// Why per-field classification rather than a global `isLocked` flag: the
// old model locked the entire workspace when any school had an active
// academic year. That's overly conservative — display-only preferences
// (locale, date format, number grouping) don't touch stored data, so there's
// no data-integrity reason to lock them mid-year. This classification lets
// admins continue to tune the UI without risking the invoice/calendar
// history of an active year.

export type WorkspaceFieldLockClass =
  | 'immutable'
  | 'lockedDuringActiveYear'
  | 'alwaysEditable';

/**
 * Dotted-path → lock class map for `WorkspaceSettings`.
 *
 * - `lockedDuringActiveYear`: touching these mid-year corrupts stored data
 *   or its interpretation. Currency denominates invoices; calendar system
 *   determines how stored dates are read; timezone anchors attendance
 *   timestamps; week-start anchors attendance-period boundaries.
 * - `alwaysEditable`: pure display preferences. Stored values are ISO
 *   dates, 24h timestamps, numeric amounts. Changing how they render does
 *   not alter them.
 */
export const WORKSPACE_FIELD_LOCK_CLASS: Readonly<Record<string, WorkspaceFieldLockClass>> = {
  // Regional — data-integrity critical
  'regional.defaultCurrency': 'lockedDuringActiveYear',
  'regional.defaultCalendarSystem': 'lockedDuringActiveYear',
  'regional.defaultTimezone': 'lockedDuringActiveYear',
  'regional.defaultWeekStartsOn': 'lockedDuringActiveYear',

  // Regional — display-only, safe to edit any time
  'regional.defaultLocale': 'alwaysEditable',
  'regional.defaultDateFormat': 'alwaysEditable',
  'regional.defaultTimeFormat': 'alwaysEditable',
  'regional.defaultNumberFormat': 'alwaysEditable',
  'regional.enableDualDateDisplay': 'alwaysEditable',

  // Branding — cosmetic, never locked
  'branding.organizationName': 'alwaysEditable',
  'branding.logoUrl': 'alwaysEditable',
  'branding.primaryColor': 'alwaysEditable',
  'branding.accentColor': 'alwaysEditable',

  // Policies — operational, never locked
  'policies.defaultAttendancePolicy': 'alwaysEditable',
} as const;

/**
 * Structured field-level lock violation. Emitted by backend PATCH handlers
 * and consumed by frontend toast / inline-error routing so a reviewer can
 * jump straight to the offending input.
 */
export interface FieldLockViolation {
  /** Dotted path matching `WORKSPACE_FIELD_LOCK_CLASS` key (e.g. `regional.defaultCurrency`). */
  field: string;
  /** Human-readable reason (may include the blocking academic year). */
  reason: string;
  /** The classification that triggered the block. */
  class: 'immutable' | 'locked_during_active_year';
}

/**
 * Resolve a single dotted path's lock state given the current tenant state.
 *
 * Unknown paths return `{ locked: false }` (fail-safe). The authoritative
 * check is server-side; the frontend uses this for the UX hint.
 */
export function isWorkspaceFieldLocked(
  path: string,
  hasActiveAcademicYear: boolean,
): { locked: boolean; reason?: string; class?: FieldLockViolation['class'] } {
  const klass = WORKSPACE_FIELD_LOCK_CLASS[path];
  if (!klass) return { locked: false };
  if (klass === 'immutable') {
    return { locked: true, reason: 'Immutable — set at provisioning', class: 'immutable' };
  }
  if (klass === 'lockedDuringActiveYear' && hasActiveAcademicYear) {
    return {
      locked: true,
      reason: 'Locked during active academic year',
      class: 'locked_during_active_year',
    };
  }
  return { locked: false };
}

/**
 * Walk an `UpdateWorkspaceSettingsDto` payload and return every field that
 * would violate governance. Backend throws if this returns non-empty;
 * frontend uses the same function to preview what will fail.
 *
 * Sections considered: `regional`, `branding`, `policies`. Unknown top-level
 * keys are ignored (Zod already strips them before this runs).
 */
export function classifyWorkspaceUpdate(
  updateDto: Record<string, unknown>,
  hasActiveAcademicYear: boolean,
): FieldLockViolation[] {
  const sections = ['regional', 'branding', 'policies'] as const;
  const violations: FieldLockViolation[] = [];
  for (const section of sections) {
    const sectionData = updateDto[section];
    if (!sectionData || typeof sectionData !== 'object') continue;
    for (const [key, value] of Object.entries(sectionData as Record<string, unknown>)) {
      if (value === undefined) continue;
      const path = `${section}.${key}`;
      const check = isWorkspaceFieldLocked(path, hasActiveAcademicYear);
      if (check.locked && check.reason && check.class) {
        violations.push({ field: path, reason: check.reason, class: check.class });
      }
    }
  }
  return violations;
}

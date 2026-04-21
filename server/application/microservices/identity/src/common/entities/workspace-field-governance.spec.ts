/**
 * Sprint B.0 / B.5 — Unit tests for workspace-level field governance.
 *
 * These tests live in the identity service (not in shared-types) because the
 * shared-types package has no test runner yet. Classification and lock-state
 * math must be well-covered before the backend PATCH handler relies on it.
 */
import {
  WORKSPACE_FIELD_LOCK_CLASS,
  classifyWorkspaceUpdate,
  isWorkspaceFieldLocked,
} from '@aibrains/shared-types';

describe('WORKSPACE_FIELD_LOCK_CLASS map', () => {
  it('classifies data-integrity-critical regional fields as lockedDuringActiveYear', () => {
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultCurrency']).toBe('lockedDuringActiveYear');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultCalendarSystem']).toBe('lockedDuringActiveYear');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultTimezone']).toBe('lockedDuringActiveYear');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultWeekStartsOn']).toBe('lockedDuringActiveYear');
  });

  it('classifies display-only regional fields as alwaysEditable', () => {
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultLocale']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultDateFormat']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultTimeFormat']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.defaultNumberFormat']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['regional.enableDualDateDisplay']).toBe('alwaysEditable');
  });

  it('classifies branding + policies fields as alwaysEditable', () => {
    expect(WORKSPACE_FIELD_LOCK_CLASS['branding.organizationName']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['branding.logoUrl']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['branding.primaryColor']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['branding.accentColor']).toBe('alwaysEditable');
    expect(WORKSPACE_FIELD_LOCK_CLASS['policies.defaultAttendancePolicy']).toBe('alwaysEditable');
  });
});

describe('isWorkspaceFieldLocked', () => {
  it('is unlocked for alwaysEditable fields regardless of active-year state', () => {
    expect(isWorkspaceFieldLocked('regional.defaultLocale', true).locked).toBe(false);
    expect(isWorkspaceFieldLocked('regional.defaultLocale', false).locked).toBe(false);
    expect(isWorkspaceFieldLocked('branding.primaryColor', true).locked).toBe(false);
  });

  it('is unlocked for lockedDuringActiveYear fields when no active year', () => {
    expect(isWorkspaceFieldLocked('regional.defaultCurrency', false).locked).toBe(false);
    expect(isWorkspaceFieldLocked('regional.defaultCalendarSystem', false).locked).toBe(false);
  });

  it('is locked for lockedDuringActiveYear fields when an active year exists', () => {
    const result = isWorkspaceFieldLocked('regional.defaultCurrency', true);
    expect(result.locked).toBe(true);
    expect(result.class).toBe('locked_during_active_year');
    expect(result.reason).toMatch(/active academic year/i);
  });

  it('returns unlocked (fail-safe) for unknown paths', () => {
    expect(isWorkspaceFieldLocked('regional.somethingBrandNew', true).locked).toBe(false);
    expect(isWorkspaceFieldLocked('weird.path', true).locked).toBe(false);
  });
});

describe('classifyWorkspaceUpdate', () => {
  it('returns empty array when nothing is locked', () => {
    expect(
      classifyWorkspaceUpdate(
        { regional: { defaultCurrency: 'NPR' } },
        /* hasActiveYear */ false,
      ),
    ).toEqual([]);
  });

  it('returns violations only for data-integrity fields during active year', () => {
    const violations = classifyWorkspaceUpdate(
      {
        regional: {
          defaultCurrency: 'USD', // critical → violation
          defaultLocale: 'en-US', // display-only → ok
          defaultDateFormat: 'MM/DD/YYYY', // display-only → ok
        },
      },
      /* hasActiveYear */ true,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual(
      expect.objectContaining({
        field: 'regional.defaultCurrency',
        class: 'locked_during_active_year',
      }),
    );
  });

  it('collects multiple violations when multiple critical fields are touched', () => {
    const violations = classifyWorkspaceUpdate(
      {
        regional: {
          defaultCurrency: 'USD',
          defaultCalendarSystem: 'gregorian',
          defaultTimezone: 'America/New_York',
        },
      },
      true,
    );
    expect(violations.map((v) => v.field).sort()).toEqual([
      'regional.defaultCalendarSystem',
      'regional.defaultCurrency',
      'regional.defaultTimezone',
    ]);
  });

  it('does not flag branding or policies even during an active year', () => {
    expect(
      classifyWorkspaceUpdate(
        {
          branding: { organizationName: 'New Name' },
          policies: { defaultAttendancePolicy: 'period' },
        },
        true,
      ),
    ).toEqual([]);
  });

  it('ignores undefined field values (partial PATCH semantics)', () => {
    expect(
      classifyWorkspaceUpdate(
        { regional: { defaultCurrency: undefined, defaultLocale: 'en-US' } },
        true,
      ),
    ).toEqual([]);
  });

  it('ignores unknown top-level sections', () => {
    // Zod strips these before reaching the service, but defend in depth anyway.
    expect(
      classifyWorkspaceUpdate(
        { randomSection: { defaultCurrency: 'USD' } } as Record<string, unknown>,
        true,
      ),
    ).toEqual([]);
  });
});

/**
 * Sprint B refinement — integration-shaped test that covers the
 * `computeEffectiveDiff` → `classifyWorkspaceUpdate` pipeline semantically.
 *
 * The backend computes a diff against current settings BEFORE classifying,
 * so a client that round-trips the full payload (preserving unchanged
 * values) does not trip the lock on every PATCH. We exercise the
 * `classifyWorkspaceUpdate` side here by showing that when only the
 * CHANGED fields are passed, display-only edits pass through cleanly on
 * a locked workspace — which matches the browser contract.
 */
describe('classifyWorkspaceUpdate — no-op field semantics (caller-computed diff)', () => {
  it('accepts a display-only edit when the diff contains ONLY that field', () => {
    // Simulate: caller diffed full DTO against current, and only
    // defaultDateFormat actually changed.
    const diff = { regional: { defaultDateFormat: 'YYYY-MM-DD' } };
    expect(classifyWorkspaceUpdate(diff, /* isLocked */ true)).toEqual([]);
  });

  it('rejects a data-integrity edit even when bundled with display-only edits', () => {
    const diff = {
      regional: {
        defaultDateFormat: 'YYYY-MM-DD', // ok
        defaultCurrency: 'USD', // violation
      },
    };
    const v = classifyWorkspaceUpdate(diff, true);
    expect(v).toHaveLength(1);
    expect(v[0].field).toBe('regional.defaultCurrency');
  });

  it('accepts branding/policies edits regardless of diff content on a locked workspace', () => {
    const diff = {
      branding: { organizationName: 'New Name' },
      policies: { defaultAttendancePolicy: 'period' },
    };
    expect(classifyWorkspaceUpdate(diff, true)).toEqual([]);
  });
});


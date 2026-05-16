/**
 * Pilot-fixtures type definitions — Sprint C1.0.
 *
 * Per invariant 13, the engine knows zero pilots. These types are the
 * generic shape any pilot's metadata.json must conform to. Pilot-specific
 * facts live in the data files under `pilots/<pilot-id>/`, never in code.
 */

import { z } from 'zod';

/**
 * V1 archetype enum. PABSON + GENERIC are runtime-valid. The reserved
 * values exist as type-level placeholders for future archetypes (not yet
 * implementable runtime-wise per CLAUDE.md "Archetype model"). Kept here
 * (rather than imported from @aibrains/shared-types) so the package has
 * minimal cross-package dependencies; a sync test in C1.7 catches drift.
 */
export const ARCHETYPES = ['PABSON', 'GENERIC'] as const;
export type ArchetypeId = (typeof ARCHETYPES)[number];

export const CALENDAR_SYSTEMS = ['gregorian', 'bikram_sambat'] as const;
export type CalendarSystem = (typeof CALENDAR_SYSTEMS)[number];

export const WEEKDAY_TOKENS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekdayToken = (typeof WEEKDAY_TOKENS)[number];

export const PILOT_STATUSES = ['registered', 'rehearsal', 'live', 'archived'] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

/**
 * Zod schema for a pilot's `metadata.json`. Source of truth for what the
 * registry accepts; runtime-validated on every `loadPilot` call so a
 * malformed fixture surfaces immediately rather than producing baffling
 * downstream errors.
 *
 * Fields are documented inline so that adding a new pilot can proceed
 * from this schema alone without round-tripping through the dossier.
 */
export const pilotMetadataSchema = z.object({
  /** Slug identifier — used as the directory name + every cross-reference. */
  pilotId: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case slug required'),

  /** Archetype this pilot operates under. PABSON beats COUNTRY when both apply. */
  archetype: z.enum(ARCHETYPES),

  /** ISO-3166-1 alpha-3 country code (e.g. NPL, USA). */
  country: z.string().length(3),

  /** Calendar system the pilot operates in. PABSON → bikram_sambat. */
  calendarSystem: z.enum(CALENDAR_SYSTEMS),

  /** IANA timezone string for the pilot's primary location. */
  timezone: z.string().min(1),

  /** BCP-47 locale tag (e.g. ne-NP, en-US). */
  locale: z.string().min(2),

  /** ISO-4217 currency code (e.g. NPR, USD). */
  currency: z.string().length(3),

  /** First day of the school week. */
  weekStart: z.enum(WEEKDAY_TOKENS),

  /** Active school days — N entries from WEEKDAY_TOKENS, no duplicates. */
  schoolDays: z.array(z.enum(WEEKDAY_TOKENS)).min(1).max(7),

  /**
   * Logical AY identifier (slug-style, e.g. `bs-2083`). Not a UUID — the
   * pilot's actual yearId is provisioned at C13 launch. Used to cross-link
   * the per-month calendar files to the academic-structure file.
   */
  primaryAcademicYearId: z.string().min(1),

  /**
   * Grading-scale descriptor (e.g. `32-pass` for PABSON's pass-at-32%
   * convention). Currently a free-form string; future expansion may
   * promote to an enum once we have more archetypes.
   */
  gradingScale: z.string().min(1),

  /**
   * Grade levels in scope for this pilot. Strings to allow ECD/PPC labels
   * alongside numeric class strings. Order is the natural progression
   * (lowest → highest).
   */
  gradeLevels: z.array(z.string().min(1)).min(1),

  /**
   * Pilot lifecycle stage:
   *   - `registered`: directory exists; fixture data may be partial
   *   - `rehearsal`: C12 dress-rehearsal in flight; tested but not live
   *   - `live`: C13 production launch complete; in active use
   *   - `archived`: post-pilot wind-down
   */
  status: z.enum(PILOT_STATUSES),
});

export type PilotMetadata = z.infer<typeof pilotMetadataSchema>;

/**
 * Structured error returned by `loadPilot` for an unknown pilotId. Kept
 * as a typed class so consumers can pattern-match on `instanceof` rather
 * than parsing message strings.
 */
export class PilotNotFoundError extends Error {
  readonly code = 'PILOT_NOT_FOUND' as const;
  readonly pilotId: string;
  readonly knownPilotIds: string[];

  constructor(pilotId: string, knownPilotIds: string[]) {
    super(
      `PILOT_NOT_FOUND: '${pilotId}' is not registered. Known: [${knownPilotIds.join(', ') || '(none)'}].`,
    );
    this.name = 'PilotNotFoundError';
    this.pilotId = pilotId;
    this.knownPilotIds = knownPilotIds;
  }
}

/**
 * Structured error returned when a pilot's metadata.json fails schema
 * validation. The full ZodError is attached for diagnostic surface.
 */
export class PilotMetadataInvalidError extends Error {
  readonly code = 'PILOT_METADATA_INVALID' as const;
  readonly pilotId: string;
  readonly issues: z.ZodIssue[];

  constructor(pilotId: string, issues: z.ZodIssue[]) {
    super(
      `PILOT_METADATA_INVALID: '${pilotId}' has ${issues.length} schema violation(s). First: ${
        issues[0]?.path.join('.') || '<root>'
      } - ${issues[0]?.message || 'unknown'}.`,
    );
    this.name = 'PilotMetadataInvalidError';
    this.pilotId = pilotId;
    this.issues = issues;
  }
}

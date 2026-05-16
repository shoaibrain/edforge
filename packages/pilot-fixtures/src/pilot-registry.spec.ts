/**
 * C1.0 — Pilot registry contract.
 *
 * Locks the surface the rest of the C1 sprint depends on:
 *   - `listPilots()` returns the registered pilots (sorted, no duplicates)
 *   - `loadPilot(id)` returns the metadata for a known id
 *   - `loadPilot(unknown)` throws PilotNotFoundError with the unknown id
 *     AND the list of known ids attached for diagnostic surface
 *   - Schema violations in any pilot's metadata.json are detected at
 *     registry-build time, throwing PilotMetadataInvalidError
 *
 * The spec also includes a parametric `describe.each(listPilots())` block
 * that asserts every registered pilot's metadata makes structural sense.
 * Adding a new pilot to `pilots/<id>/metadata.json` is therefore
 * automatically covered by this spec.
 */

import { listPilots, loadPilot, clearRegistryCache } from './pilot-registry';
import {
  PilotNotFoundError,
  PilotMetadataInvalidError,
  pilotMetadataSchema,
} from './types';
import * as fs from 'fs';
import * as path from 'path';

const FIRST_PILOT_ID = 'pabson-saraswati-bs-2083';
const PILOTS_DIR = path.resolve(__dirname, '..', 'pilots');

afterEach(() => {
  // Mid-suite mutations (the negative-path tests below add + remove temp
  // fixtures) require a clean cache for the next test.
  clearRegistryCache();
});

describe('listPilots', () => {
  it('returns at least the first registered pilot', () => {
    const pilots = listPilots();
    expect(pilots.length).toBeGreaterThanOrEqual(1);
    expect(pilots.map((p) => p.pilotId)).toContain(FIRST_PILOT_ID);
  });

  it('returns metadata sorted by pilotId (deterministic test output)', () => {
    const pilots = listPilots();
    const ids = pilots.map((p) => p.pilotId);
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sortedIds);
  });

  it('returns no duplicate pilotIds', () => {
    const ids = listPilots().map((p) => p.pilotId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('loadPilot — happy path', () => {
  it('returns the first pilot by id', () => {
    const pilot = loadPilot(FIRST_PILOT_ID);
    expect(pilot.pilotId).toBe(FIRST_PILOT_ID);
    expect(pilot.archetype).toBe('PABSON');
    expect(pilot.country).toBe('NPL');
    expect(pilot.calendarSystem).toBe('bikram_sambat');
    expect(pilot.gradingScale).toBe('32-pass');
    expect(pilot.status).toBe('registered');
  });

  it('returns metadata that passes its own Zod schema', () => {
    const pilot = loadPilot(FIRST_PILOT_ID);
    // Re-parse the returned object to confirm the registry didn't bypass
    // validation; safeParse should succeed unconditionally.
    expect(pilotMetadataSchema.safeParse(pilot).success).toBe(true);
  });
});

describe('loadPilot — unknown id', () => {
  it('throws PilotNotFoundError with code PILOT_NOT_FOUND', () => {
    expect.assertions(4);
    try {
      loadPilot('definitely-not-a-real-pilot');
    } catch (e) {
      expect(e).toBeInstanceOf(PilotNotFoundError);
      const err = e as PilotNotFoundError;
      expect(err.code).toBe('PILOT_NOT_FOUND');
      expect(err.pilotId).toBe('definitely-not-a-real-pilot');
      expect(err.knownPilotIds).toContain(FIRST_PILOT_ID);
    }
  });
});

describe('parametric — describe.each(listPilots())', () => {
  // This is the discipline that pays off when pilot 2 arrives: every
  // registered pilot's metadata is asserted to be structurally sane,
  // with zero spec changes required when a new pilot is dropped in.
  it.each(listPilots())(
    '$pilotId metadata is internally consistent',
    (pilot) => {
      // Pilot-id slug constraint
      expect(pilot.pilotId).toMatch(/^[a-z0-9][a-z0-9-]*$/);

      // schoolDays is a subset of WEEKDAY_TOKENS, with no duplicates
      expect(new Set(pilot.schoolDays).size).toBe(pilot.schoolDays.length);

      // weekStart is one of the schoolDays OR is a non-school day
      // (e.g., a school could declare weekStart=mon but operate
      // Mon-Fri — weekStart is calendar-week alignment, not school-week)
      // → no assertion needed, just type-check above.

      // gradeLevels has at least 1 entry
      expect(pilot.gradeLevels.length).toBeGreaterThan(0);

      // PABSON-specific sanity: if archetype=PABSON then country should
      // be NPL and calendarSystem should be bikram_sambat per CLAUDE.md
      // "Archetype model" (archetype defaults override country defaults).
      // This is data convention, not code branching — the test asserts
      // the data, not engine behavior.
      if (pilot.archetype === 'PABSON') {
        expect(pilot.country).toBe('NPL');
        expect(pilot.calendarSystem).toBe('bikram_sambat');
        expect(pilot.timezone).toBe('Asia/Kathmandu');
      }
    },
  );
});

describe('schema enforcement at registry-build time', () => {
  /**
   * Drop a temp malformed pilot directory, attempt to listPilots, expect
   * PilotMetadataInvalidError, then clean up. This protects against the
   * common bug where a typo'd metadata.json shadows the correct field
   * silently — instead we want a loud failure on registry construction.
   */
  it('throws PilotMetadataInvalidError when a pilot metadata.json is missing required fields', () => {
    const tempPilotId = 'temp-malformed-pilot-for-test';
    const tempDir = path.join(PILOTS_DIR, tempPilotId);
    const tempMetadata = path.join(tempDir, 'metadata.json');

    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        tempMetadata,
        JSON.stringify({ pilotId: tempPilotId, archetype: 'PABSON' }, null, 2),
      );
      clearRegistryCache();

      expect(() => listPilots()).toThrow(PilotMetadataInvalidError);
    } finally {
      // Cleanup — leave the test repo state as we found it.
      if (fs.existsSync(tempMetadata)) fs.unlinkSync(tempMetadata);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
      clearRegistryCache();
    }
  });

  it('throws PilotMetadataInvalidError when dir name does not match metadata.pilotId', () => {
    const tempPilotId = 'temp-dirname-mismatch-for-test';
    const tempDir = path.join(PILOTS_DIR, tempPilotId);
    const tempMetadata = path.join(tempDir, 'metadata.json');

    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        tempMetadata,
        JSON.stringify(
          {
            pilotId: 'completely-different-id-from-the-dir',
            archetype: 'GENERIC',
            country: 'USA',
            calendarSystem: 'gregorian',
            timezone: 'America/New_York',
            locale: 'en-US',
            currency: 'USD',
            weekStart: 'sun',
            schoolDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
            primaryAcademicYearId: 'ay-2026-27',
            gradingScale: 'percentage',
            gradeLevels: ['K', '1', '2'],
            status: 'registered',
          },
          null,
          2,
        ),
      );
      clearRegistryCache();

      expect(() => listPilots()).toThrow(PilotMetadataInvalidError);
    } finally {
      if (fs.existsSync(tempMetadata)) fs.unlinkSync(tempMetadata);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
      clearRegistryCache();
    }
  });
});

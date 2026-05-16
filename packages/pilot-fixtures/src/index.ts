/**
 * @edforge/pilot-fixtures — public API.
 *
 * Sprint C1 complete. Two entry points:
 *
 *   - `listPilots()` / `loadPilot(pilotId)` — registry-level metadata
 *     (returns PilotMetadata; what's registered).
 *
 *   - `loadPilotFixture(pilotId)` — full fixture bundle (metadata +
 *     calendar + bell + academic-structure + holidays + programs).
 *     Validates every fixture against its schema at load time.
 *
 * The bundle is consumed by the C2 greenlight gate tests and downstream
 * sprints (C5/C6/C7/C9) via the parametric query helpers
 * (`eventsOnDate`, `instructionalDaysInRange`, `shiftProfileForDate`,
 * `expandBlocks`, `expandHolidays`, `expandPrograms`).
 */

export * from './types';
export * from './pilot-registry';
export * from './loader';

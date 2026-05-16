/**
 * Pilot registry — Sprint C1.0.
 *
 * Discovers + loads pilot metadata via fs glob over
 * `<package-root>/pilots/<pilotId>/metadata.json`. Adding a new pilot is
 * therefore a zero-code operation:
 *
 *   1. Create `pilots/<new-pilot-id>/metadata.json`
 *   2. Run the suite — the registry auto-discovers the new pilot
 *
 * The registry caches its scan on first call. Long-running consumers
 * (smoke harnesses, test workers) re-use the cache; tests that mutate
 * the pilots/ directory between assertions should call
 * `clearRegistryCache()` between mutations.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  pilotMetadataSchema,
  PilotMetadata,
  PilotNotFoundError,
  PilotMetadataInvalidError,
} from './types';

/**
 * Resolves to the `pilots/` directory at the package root. Computed from
 * `__dirname` so the registry works regardless of where the consumer
 * invokes it from (test harness, smoke script, or via the published dist).
 *
 * Layout:
 *   __dirname  = packages/pilot-fixtures/src   (source)
 *   ../pilots  = packages/pilot-fixtures/pilots (data)
 *
 * In the compiled `dist/` output, __dirname becomes
 * packages/pilot-fixtures/dist; the `../pilots` walk lands at the same
 * `packages/pilot-fixtures/pilots` path. The data tree is co-published.
 */
const PILOTS_DIR = path.resolve(__dirname, '..', 'pilots');

interface RegistryCache {
  metadataByPilotId: Map<string, PilotMetadata>;
  loadedAt: Date;
}

let cache: RegistryCache | null = null;

/**
 * Walk `pilots/` and build the in-memory registry. Throws
 * `PilotMetadataInvalidError` if any pilot has a malformed metadata.json
 * — the registry is all-or-nothing so a single bad pilot doesn't
 * silently shadow itself.
 */
function buildCache(): RegistryCache {
  const metadataByPilotId = new Map<string, PilotMetadata>();

  if (!fs.existsSync(PILOTS_DIR)) {
    // No pilots/ dir yet. Valid state — the package may exist before any
    // pilot is registered. listPilots() returns []; loadPilot() throws
    // PILOT_NOT_FOUND for any id.
    return { metadataByPilotId, loadedAt: new Date() };
  }

  const dirents = fs.readdirSync(PILOTS_DIR, { withFileTypes: true });
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;

    const pilotId = dirent.name;
    const metadataPath = path.join(PILOTS_DIR, pilotId, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      // A pilot directory exists but no metadata.json yet — skip silently.
      // This is normal during pilot setup when fixture data is being
      // assembled before metadata is finalized.
      continue;
    }

    const raw = fs.readFileSync(metadataPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new PilotMetadataInvalidError(pilotId, [
        {
          code: 'custom',
          message: `metadata.json is not valid JSON: ${(e as Error).message}`,
          path: [],
        },
      ]);
    }

    const result = pilotMetadataSchema.safeParse(parsed);
    if (!result.success) {
      throw new PilotMetadataInvalidError(pilotId, result.error.issues);
    }

    // Cross-check: directory name MUST match metadata.pilotId — catches
    // copy-paste bugs where a new pilot's metadata still carries the
    // template pilotId.
    if (result.data.pilotId !== pilotId) {
      throw new PilotMetadataInvalidError(pilotId, [
        {
          code: 'custom',
          message: `directory name '${pilotId}' does not match metadata.pilotId '${result.data.pilotId}'`,
          path: ['pilotId'],
        },
      ]);
    }

    metadataByPilotId.set(pilotId, result.data);
  }

  return { metadataByPilotId, loadedAt: new Date() };
}

function getCache(): RegistryCache {
  if (cache === null) {
    cache = buildCache();
  }
  return cache;
}

/**
 * Returns metadata for every registered pilot, sorted by pilotId for
 * deterministic test output. Empty array if no pilots are registered yet.
 *
 * Consumers parametrize over this in test suites:
 *   describe.each(listPilots())('per-pilot greenlight gate', (pilot) => { ... })
 */
export function listPilots(): PilotMetadata[] {
  const { metadataByPilotId } = getCache();
  return Array.from(metadataByPilotId.values()).sort((a, b) =>
    a.pilotId.localeCompare(b.pilotId),
  );
}

/**
 * Returns metadata for a specific pilot. Throws `PilotNotFoundError`
 * (with `code: 'PILOT_NOT_FOUND'`) for an unknown id.
 *
 * `loadPilot` is intentionally minimal — it returns metadata only. The
 * full fixture-bundle loader (calendar, holidays, programs, bell
 * schedule) lands in C1.7 as `loadPilotFixture(pilotId)` in `loader.ts`.
 */
export function loadPilot(pilotId: string): PilotMetadata {
  const { metadataByPilotId } = getCache();
  const metadata = metadataByPilotId.get(pilotId);
  if (!metadata) {
    throw new PilotNotFoundError(pilotId, Array.from(metadataByPilotId.keys()).sort());
  }
  return metadata;
}

/**
 * Clears the in-memory cache. Use in tests that mutate the pilots/
 * directory between assertions (e.g., adding a temp fixture mid-suite).
 */
export function clearRegistryCache(): void {
  cache = null;
}

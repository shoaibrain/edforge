/**
 * ArchetypeDefaults Service — Sprint 0.4.4 (V1 Master EPIC Breakdown)
 *
 * Thin loader over the shared-types `ARCHETYPE_DEFAULTS_TABLE` data
 * table. The defaults themselves are static (compiled into the
 * shared-types npm package); this service is the injectable seam that:
 *
 *   - Resolves an archetype string to the typed `ArchetypeDefaults`
 *     record, with cache-on-first-read semantics
 *   - Throws `NotFoundException('ARCHETYPE_NOT_FOUND')` for unknown
 *     archetypes — fail-loud per the shared-types `getArchetypeDefaults`
 *     contract, important so EPIC-D entity creation never silently
 *     substitutes a different archetype's policy
 *   - Logs the supported archetype list at module bootstrap as a
 *     deployment sanity-check (shipped-types bump regression catch)
 *
 * **Why a service layer at all?** The data is in shared-types, so the
 * controller could call `getArchetypeDefaults` directly. The thin
 * service gives us (a) a Nest-DI seam for future per-tenant override
 * extensions without breaking the controller contract, and (b) a
 * single place to add structured logging / metrics if archetype
 * lookups become a hot path.
 */

import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import {
  ARCHETYPE_DEFAULTS_TABLE,
  getArchetypeDefaults,
  type ArchetypeDefaults,
} from '@aibrains/shared-types';

@Injectable()
export class ArchetypeDefaultsService implements OnModuleInit {
  private readonly logger = new Logger(ArchetypeDefaultsService.name);
  private readonly cache = new Map<string, ArchetypeDefaults>();

  /**
   * Boot-time sanity check: ensure the shared-types table is non-empty
   * and emit the supported archetype list to logs. Catches a class of
   * shared-types-publish-regression where the table accidentally ships
   * empty (e.g., tree-shaking misconfiguration); the next deploy then
   * has a visible "supported archetypes: []" log entry instead of
   * mysterious 404s on every lookup.
   */
  onModuleInit(): void {
    const archetypes = Object.keys(ARCHETYPE_DEFAULTS_TABLE);
    if (archetypes.length === 0) {
      // Loud — the shared-types ARCHETYPE_DEFAULTS_TABLE export is the
      // contract; if it's empty something has gone wrong upstream.
      this.logger.error(
        'ARCHETYPE_DEFAULTS_TABLE is empty — shared-types regression?',
      );
      return;
    }
    this.logger.log(
      `ArchetypeDefaults loaded for archetypes: [${archetypes.join(', ')}]`,
    );
  }

  /**
   * Resolve the canonical defaults for an archetype. Case-insensitive
   * (matches the shared-types contract).
   *
   * @throws NotFoundException('ARCHETYPE_NOT_FOUND') when the archetype
   *   is unrecognized. EPIC-D entity creation paths catch this and
   *   surface a 4xx to the caller — silent substitution would create
   *   the kind of cross-archetype data leak that invariant 8 is meant
   *   to prevent.
   */
  getDefaults(archetype: string): ArchetypeDefaults {
    const key = archetype?.toUpperCase?.();
    if (!key) {
      throw new NotFoundException({
        errorCode: 'ARCHETYPE_NOT_FOUND',
        message: 'Archetype parameter is required.',
      });
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const defaults = getArchetypeDefaults(archetype);
      this.cache.set(key, defaults);
      return defaults;
    } catch (err) {
      throw new NotFoundException({
        errorCode: 'ARCHETYPE_NOT_FOUND',
        message: `Archetype '${archetype}' is not supported.`,
        supportedArchetypes: Object.keys(ARCHETYPE_DEFAULTS_TABLE),
      });
    }
  }

  /**
   * Return the list of currently-supported archetypes. Used by
   * AdminWeb's tenant-create form + by integration tests that assert
   * the table is non-empty.
   */
  listArchetypes(): readonly string[] {
    return Object.keys(ARCHETYPE_DEFAULTS_TABLE);
  }
}

/**
 * Archetype Defaults Controller — Sprint 0.4.5 (V1 Master EPIC Breakdown)
 *
 * GET /archetype-defaults?archetype=
 * GET /archetype-defaults                   (lists supported archetypes)
 *
 * Returns the per-archetype academic policy defaults (gradeLadder,
 * boardExams, gpaScale, letterGrades, examPattern, primaryCurriculumRef,
 * complianceForms + locale fields). Backed by the static
 * ARCHETYPE_DEFAULTS_TABLE in shared-types — no DDB call, no per-tenant
 * state. Operator UIs (AdminWeb tenant-create form, EPIC-D entity setup
 * wizards) consume this to render archetype-aware option lists.
 *
 * ABAC: read-only. Any authenticated caller (TenantAdmin, Principal,
 * Teacher) can resolve archetype defaults — these are not tenant-
 * scoped data, just public archetype-level constants. Matches the
 * HolidaySeedController precedent (C3.3): JwtAuthGuard only.
 */

import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import type { ArchetypeDefaults } from '@aibrains/shared-types';
import { ArchetypeDefaultsService } from './archetype-defaults.service';

interface ArchetypeDefaultsResponse {
  archetype: string;
  defaults: ArchetypeDefaults;
}

interface ArchetypeListResponse {
  supportedArchetypes: readonly string[];
}

@Controller('archetype-defaults')
@UseGuards(JwtAuthGuard)
export class ArchetypeDefaultsController {
  constructor(private readonly svc: ArchetypeDefaultsService) {}

  /**
   * Resolve archetype defaults. If `archetype` query param is provided,
   * returns that archetype's defaults; otherwise returns the supported
   * archetype list. (Two-mode handler matches the breakdown spec; the
   * empty-arg variant is useful for AdminWeb dropdowns.)
   *
   * 4xx contract:
   *   - 400 BAD_QUERY — malformed archetype param (non-string)
   *   - 404 ARCHETYPE_NOT_FOUND — archetype unknown (delegated to service)
   */
  @Get()
  resolve(
    @Query('archetype') archetype?: string,
  ): ArchetypeDefaultsResponse | ArchetypeListResponse {
    if (archetype === undefined || archetype === null || archetype === '') {
      return { supportedArchetypes: this.svc.listArchetypes() };
    }

    if (typeof archetype !== 'string') {
      throw new BadRequestException({
        errorCode: 'BAD_QUERY',
        message: '`archetype` query param must be a string.',
      });
    }

    const defaults = this.svc.getDefaults(archetype);
    return {
      archetype: defaults.archetype,
      defaults,
    };
  }
}

/**
 * Holiday Seed Controller — Sprint C3.3
 *
 * GET /holiday-seeds?archetype=&region=&year=
 *
 * Returns a curated archetype + region holiday list for a given BS
 * year. Backed by the static `HOLIDAY_SEEDS` registry shipped in
 * shared-types — no DDB call, no per-tenant state. Used by operator
 * UIs (Calendar setup wizard) and pipeable directly into
 * generate-calendar's `holidays[]` + `breaks[]` payload (C3.6+C3.8).
 *
 * Fallback ladder (encoded in `appliedFallback`):
 *   1. exact (archetype, region, year) match → that seed
 *   2. country-generic (GENERIC, region, year) → that seed
 *   3. else → null seed, `appliedFallback='none'`
 *
 * Year is required (`400 YEAR_REQUIRED` if omitted). The endpoint is
 * `GET`-only with read-only data; the standard JwtAuthGuard suffices.
 */

import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import {
  holidaySeedFilterSchema,
  resolveHolidaySeed,
  type HolidaySeedResponse,
  type HolidaySeed,
} from '@aibrains/shared-types';

@Controller('holiday-seeds')
@UseGuards(JwtAuthGuard)
export class HolidaySeedController {
  /**
   * Resolve the holiday seed for an (archetype, region, year) tuple.
   * All three are query params; `year` (BS) is required.
   */
  @Get()
  resolve(
    @Query('archetype') archetype?: string,
    @Query('region') region?: string,
    @Query('year') yearRaw?: string,
  ): HolidaySeedResponse {
    // Zod-coerce + range-validate the inputs. We keep error reporting
    // narrow + actionable; 400 carries an errorCode the UI can branch on.
    const parsed = holidaySeedFilterSchema.safeParse({
      archetype: archetype || undefined,
      region: region || undefined,
      year: yearRaw,
    });
    if (!parsed.success) {
      throw new BadRequestException({
        errorCode: 'BAD_QUERY',
        message: 'Invalid query parameters for /holiday-seeds.',
        details: parsed.error.flatten(),
      });
    }

    if (parsed.data.year === undefined) {
      throw new BadRequestException({
        errorCode: 'YEAR_REQUIRED',
        message: '`year` (BS, e.g. 2083) is required.',
      });
    }

    const resolved = resolveHolidaySeed(
      parsed.data.archetype ?? null,
      parsed.data.region ?? null,
      parsed.data.year,
    );

    return {
      appliedFallback: resolved.appliedFallback,
      seed: resolved.seed as HolidaySeed | null,
    };
  }
}

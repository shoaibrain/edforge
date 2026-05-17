/**
 * Spec for the C3.3 HolidaySeedController.
 *
 * The controller is a thin wrapper over `resolveHolidaySeed` — no DDB,
 * no DI dependencies beyond the standard guard. Tests exercise the
 * three branches:
 *   - happy path: exact (archetype, region, year) match → 'exact' + seed
 *   - missing year: 400 YEAR_REQUIRED
 *   - bad query: 400 BAD_QUERY (Zod rejection)
 *   - unknown archetype+region: 'none' fallback + null seed
 */

import { BadRequestException } from '@nestjs/common';
import { HolidaySeedController } from './holiday-seed.controller';

describe('HolidaySeedController.resolve', () => {
  let ctrl: HolidaySeedController;

  beforeEach(() => {
    ctrl = new HolidaySeedController();
  });

  it('returns exact match for (PABSON, NPL, 2083)', () => {
    const r = ctrl.resolve('PABSON', 'NPL', '2083');
    expect(r.appliedFallback).toBe('exact');
    expect(r.seed).not.toBeNull();
    expect(r.seed!.archetype).toBe('PABSON');
    expect(r.seed!.bsYear).toBe(2083);
    expect(r.seed!.totals.blocks + r.seed!.totals.singleDay).toBe(19);
  });

  it("is case-insensitive on archetype + region (lower-case input still matches)", () => {
    const r = ctrl.resolve('pabson', 'npl', '2083');
    expect(r.appliedFallback).toBe('exact');
  });

  it('throws 400 YEAR_REQUIRED when year is missing', () => {
    try {
      ctrl.resolve('PABSON', 'NPL', undefined);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = e.getResponse();
      expect(body.errorCode).toBe('YEAR_REQUIRED');
    }
  });

  it('throws 400 BAD_QUERY when year is out of supported range', () => {
    try {
      ctrl.resolve('PABSON', 'NPL', '1900');
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = e.getResponse();
      expect(body.errorCode).toBe('BAD_QUERY');
    }
  });

  it("returns 'none' for an unknown archetype + unknown region", () => {
    const r = ctrl.resolve('CBSE_IN', 'XYZ', '2083');
    expect(r.appliedFallback).toBe('none');
    expect(r.seed).toBeNull();
  });

  it("returns 'none' when no seed exists for a future BS year", () => {
    const r = ctrl.resolve('PABSON', 'NPL', '2085');
    expect(r.appliedFallback).toBe('none');
    expect(r.seed).toBeNull();
  });

  it('accepts year as numeric string and coerces it through the Zod schema', () => {
    expect(ctrl.resolve('PABSON', 'NPL', '2083').seed!.bsYear).toBe(2083);
  });
});

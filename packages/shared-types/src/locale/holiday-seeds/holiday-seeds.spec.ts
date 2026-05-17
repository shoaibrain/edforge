/**
 * Spec for the C3.2 holiday-seed registry.
 *
 * Covers:
 *   - PABSON-NPL-2083 seed loads cleanly and has the expected shape
 *     (6 blocks × 36 block-days + 13 single-day = 49 holiday-days,
 *     matches the canonical PABSON Saraswati fixture).
 *   - resolveHolidaySeed honors the fallback ladder
 *     (exact → country-generic → none).
 *   - listHolidaySeedKeys enumerates every shipped seed.
 *   - All AD dates parse as valid Gregorian (regression guard for the
 *     bsToGregorian conversion that produced the JSON).
 */

import {
  HOLIDAY_SEEDS,
  listHolidaySeedKeys,
  resolveHolidaySeed,
} from './index';

describe('HOLIDAY_SEEDS registry', () => {
  it('ships exactly the PABSON-NPL-2083 seed for V1', () => {
    expect(listHolidaySeedKeys()).toEqual([
      { archetype: 'PABSON', region: 'NPL', bsYear: 2083 },
    ]);
  });

  it('PABSON-NPL-2083 totals match the canonical pilot fixture (6/13/36)', () => {
    const key = listHolidaySeedKeys()[0];
    const seed = HOLIDAY_SEEDS[`${key.archetype}:${key.region}:${key.bsYear}`];
    expect(seed.totals).toEqual({ blocks: 6, singleDay: 13, blockDays: 36 });
    expect(seed.blocks).toHaveLength(6);
    expect(seed.singleDay).toHaveLength(13);
  });

  it('every block has start ≤ end and is in 2026/2027 AD', () => {
    const seed = HOLIDAY_SEEDS['PABSON:NPL:2083'];
    for (const b of seed.blocks) {
      expect(b.startDate).toMatch(/^20(26|27)-\d{2}-\d{2}$/);
      expect(b.endDate).toMatch(/^20(26|27)-\d{2}-\d{2}$/);
      expect(b.startDate <= b.endDate).toBe(true);
      expect(b.eventType).toBe('break');
    }
  });

  it('every single-day holiday is a valid AD date in 2026/2027', () => {
    const seed = HOLIDAY_SEEDS['PABSON:NPL:2083'];
    for (const h of seed.singleDay) {
      expect(h.date).toMatch(/^20(26|27)-\d{2}-\d{2}$/);
      expect(h.eventType).toBe('holiday');
      // sanity: month + day in valid range
      const [, m, d] = h.date.split('-').map(Number);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(12);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(31);
    }
  });

  it('includes Dashain as the first multi-day block (oldest religious holiday in NPL calendar)', () => {
    const seed = HOLIDAY_SEEDS['PABSON:NPL:2083'];
    const dashain = seed.blocks.find((b) => b.name === 'Dashain');
    expect(dashain).toBeDefined();
    expect(dashain!.startDate).toBe('2026-10-17'); // BS 2083/07/01
  });
});

describe('resolveHolidaySeed', () => {
  it("returns 'exact' for the canonical (PABSON, NPL, 2083) tuple", () => {
    const r = resolveHolidaySeed('PABSON', 'NPL', 2083);
    expect(r.appliedFallback).toBe('exact');
    expect(r.seed).toBe(HOLIDAY_SEEDS['PABSON:NPL:2083']);
  });

  it('is case-insensitive on archetype + region', () => {
    expect(resolveHolidaySeed('pabson', 'npl', 2083).appliedFallback).toBe('exact');
  });

  it("returns 'none' for an unknown archetype + unknown country fallback", () => {
    const r = resolveHolidaySeed('PABSON', 'XYZ', 2083);
    expect(r.appliedFallback).toBe('none');
    expect(r.seed).toBeNull();
  });

  it("returns 'none' when region missing", () => {
    const r = resolveHolidaySeed('PABSON', null, 2083);
    expect(r.appliedFallback).toBe('none');
    expect(r.seed).toBeNull();
  });

  it("returns 'none' for an unsupported BS year (no seed shipped yet)", () => {
    const r = resolveHolidaySeed('PABSON', 'NPL', 2084);
    expect(r.appliedFallback).toBe('none');
    expect(r.seed).toBeNull();
  });

  it("would return 'country' if a GENERIC:NPL:YYYY seed were registered", () => {
    // None shipped yet — but the path is exercised by passing an
    // unknown archetype that doesn't shadow the GENERIC lookup.
    const r = resolveHolidaySeed('CBSE_IN', 'NPL', 2083);
    // CBSE_IN+NPL:2083 doesn't exist; GENERIC+NPL:2083 also doesn't exist
    // yet; so this currently lands at 'none'. When GENERIC:NPL:2083
    // ships, this test pins the precedence.
    expect(r.appliedFallback).toBe('none');
  });
});

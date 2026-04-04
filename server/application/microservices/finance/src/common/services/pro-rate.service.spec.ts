/**
 * Pro-Rate Service Unit Tests
 *
 * Tests proportional amount calculations for mid-term enrollment
 * across all fee frequency types and edge cases.
 */

import { ProRateService, ProRateParams } from './pro-rate.service';

describe('ProRateService', () => {
  let service: ProRateService;

  beforeEach(() => {
    service = new ProRateService();
  });

  const baseParams: ProRateParams = {
    fullAmount: 12000,
    termStartDate: '2026-01-01',
    termEndDate: '2026-12-31',
    enrollmentDate: '2026-07-01',
    frequency: 'annual',
    proRateEnabled: true,
  };

  // --------------------------------------------------------------------------
  // one_time: always full amount
  // --------------------------------------------------------------------------

  it('should return full amount for one_time fees regardless of enrollment date', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      frequency: 'one_time',
    });
    expect(result).toBe(12000);
  });

  // --------------------------------------------------------------------------
  // proRateEnabled: false → always full amount
  // --------------------------------------------------------------------------

  it('should return full amount when proRateEnabled is false', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      proRateEnabled: false,
    });
    expect(result).toBe(12000);
  });

  // --------------------------------------------------------------------------
  // monthly: always full month (no partial)
  // --------------------------------------------------------------------------

  it('should return full amount for monthly frequency', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      frequency: 'monthly',
    });
    expect(result).toBe(12000);
  });

  // --------------------------------------------------------------------------
  // annual: pro-rate by remaining days
  // --------------------------------------------------------------------------

  it('should pro-rate annual fee for mid-year enrollment', () => {
    const result = service.calculateProRatedAmount(baseParams);
    // 365 total days, enrolled July 1 → ~184 remaining days
    // 12000 * (184/365) ≈ 6049
    expect(result).toBeGreaterThan(5000);
    expect(result).toBeLessThan(7000);
  });

  it('should return full amount when enrolled on or before term start', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      enrollmentDate: '2026-01-01',
    });
    expect(result).toBe(12000);
  });

  it('should return full amount when enrolled before term start', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      enrollmentDate: '2025-12-15',
    });
    expect(result).toBe(12000);
  });

  it('should return 0 when enrolled on or after term end', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      enrollmentDate: '2026-12-31',
    });
    expect(result).toBe(0);
  });

  it('should return 0 when enrolled after term end', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      enrollmentDate: '2027-01-15',
    });
    expect(result).toBe(0);
  });

  // --------------------------------------------------------------------------
  // quarterly: pro-rate by remaining days
  // --------------------------------------------------------------------------

  it('should pro-rate quarterly fee for mid-quarter enrollment', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      frequency: 'quarterly',
      fullAmount: 3000,
      termStartDate: '2026-04-01',
      termEndDate: '2026-06-30',
      enrollmentDate: '2026-05-15',
    });
    // 91 total days, enrolled May 15 → ~46 remaining days
    // 3000 * (46/91) ≈ 1516
    expect(result).toBeGreaterThan(1000);
    expect(result).toBeLessThan(2000);
  });

  it('should return full quarterly amount when enrolled on term start', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      frequency: 'quarterly',
      fullAmount: 3000,
      termStartDate: '2026-04-01',
      termEndDate: '2026-06-30',
      enrollmentDate: '2026-04-01',
    });
    expect(result).toBe(3000);
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('should return full amount when term end <= term start (invalid range)', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      termStartDate: '2026-12-31',
      termEndDate: '2026-01-01',
    });
    expect(result).toBe(12000);
  });

  it('should enforce minimum 1-day charge', () => {
    // Enroll on the second-to-last day: should get at least 1 day's worth
    const result = service.calculateProRatedAmount({
      ...baseParams,
      enrollmentDate: '2026-12-30',
    });
    expect(result).toBeGreaterThan(0);
    // Minimum is fullAmount / totalDays = 12000 / 365 ≈ 33
    expect(result).toBeGreaterThanOrEqual(Math.round(12000 / 365));
  });

  it('should handle small amounts without going negative', () => {
    const result = service.calculateProRatedAmount({
      ...baseParams,
      fullAmount: 100,
      enrollmentDate: '2026-12-29',
    });
    expect(result).toBeGreaterThan(0);
  });

  it('should round to nearest integer (NPR has no decimals)', () => {
    const result = service.calculateProRatedAmount(baseParams);
    expect(Number.isInteger(result)).toBe(true);
  });
});

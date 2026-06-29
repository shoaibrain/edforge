/**
 * Focused unit tests for `parseSyncThreshold` (PR #341 review F6).
 *
 * Sprint E.3 specifies `BULK_SYNC_THRESHOLD` as the env-tunable sync/async
 * cutoff (default 25). Pre-fix the threshold was hardcoded; this
 * regression-pins the env wiring + the bad-value fallback so an operator
 * misconfig (typo, non-numeric value) can't take the route down.
 */

import { parseSyncThreshold, BULK_SYNC_THRESHOLD_DEFAULT } from './invoices.controller';

describe('parseSyncThreshold (PR #341 F6)', () => {
  const ENV_KEY = 'BULK_SYNC_THRESHOLD';
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    // Silence the bad-value warning during the negative tests so the
    // jest output stays clean.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalValue === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalValue;
    jest.restoreAllMocks();
  });

  it('returns the default 25 when the env var is unset', () => {
    expect(parseSyncThreshold()).toBe(BULK_SYNC_THRESHOLD_DEFAULT);
    expect(BULK_SYNC_THRESHOLD_DEFAULT).toBe(25);
  });

  it('returns the parsed value when env is a positive integer', () => {
    process.env[ENV_KEY] = '50';
    expect(parseSyncThreshold()).toBe(50);
  });

  it('trims whitespace before parsing', () => {
    process.env[ENV_KEY] = '  100  ';
    expect(parseSyncThreshold()).toBe(100);
  });

  it('falls back to default on a non-numeric value (and warns)', () => {
    process.env[ENV_KEY] = 'NaN-this-is-bad';
    expect(parseSyncThreshold()).toBe(BULK_SYNC_THRESHOLD_DEFAULT);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Invalid BULK_SYNC_THRESHOLD/),
    );
  });

  it('falls back to default on zero (must be POSITIVE integer)', () => {
    process.env[ENV_KEY] = '0';
    expect(parseSyncThreshold()).toBe(BULK_SYNC_THRESHOLD_DEFAULT);
  });

  it('falls back to default on a negative value', () => {
    process.env[ENV_KEY] = '-5';
    expect(parseSyncThreshold()).toBe(BULK_SYNC_THRESHOLD_DEFAULT);
  });

  it('falls back to default on empty string', () => {
    process.env[ENV_KEY] = '';
    expect(parseSyncThreshold()).toBe(BULK_SYNC_THRESHOLD_DEFAULT);
  });

  it('is read on every call (operator can change at runtime without a controller redeploy)', () => {
    process.env[ENV_KEY] = '30';
    expect(parseSyncThreshold()).toBe(30);
    process.env[ENV_KEY] = '40';
    expect(parseSyncThreshold()).toBe(40);
  });
});

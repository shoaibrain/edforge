/**
 * Layer 7.2 — adoption thresholds.
 *
 * Constants only, importable for testing. Mirrors the literal table from the
 * sprint plan; if the thresholds change, update here AND re-run the fixture
 * tests that assert PASS/PARTIAL/FAIL against them.
 */

/** Grace period in days from tenant provisionedAt. */
export const GRACE_PERIOD_DAYS = 21;

export interface MetricThreshold {
  /** Steady-state threshold applied after the grace period. */
  steady: number;
  /** Relaxed threshold applied while the tenant is in grace. */
  grace: number;
}

export type AdoptionMetricKey =
  | 'teacherLoginCadence'
  | 'attendanceCoverage'
  | 'gradeSubmissionCadence'
  | 'adminActivity'
  | 'parentPortalReach'
  | 'studentPortalReach';

export const THRESHOLDS: Record<AdoptionMetricKey, MetricThreshold> = {
  teacherLoginCadence:    { steady: 0.6,  grace: 0.3 },
  attendanceCoverage:     { steady: 0.8,  grace: 0.5 },
  gradeSubmissionCadence: { steady: 0.7,  grace: 0.4 },
  adminActivity:          { steady: 1,    grace: 1 },
  parentPortalReach:      { steady: 0.15, grace: 0.05 },
  studentPortalReach:     { steady: 0.25, grace: 0.1 },
};

/** Weekly overall: PASS if ≥ WEEKLY_PASS_THRESHOLD metrics are PASS. */
export const WEEKLY_PASS_THRESHOLD = 4;

/** Quarterly refund gate. */
export const QUARTERLY_FAIL_WEEKS = 7;
export const QUARTERLY_TOTAL_WEEKS = 12;

export type AdoptionStatus = 'PASS' | 'PARTIAL' | 'FAIL';

export function classifyMetric(
  value: number,
  threshold: MetricThreshold,
  inGracePeriod: boolean,
): AdoptionStatus {
  const t = inGracePeriod ? threshold.grace : threshold.steady;
  if (value >= t) return 'PASS';
  if (value >= t * 0.5) return 'PARTIAL';
  return 'FAIL';
}

export function classifyWeekly(
  perMetric: Record<AdoptionMetricKey, AdoptionStatus>,
): AdoptionStatus {
  const passed = Object.values(perMetric).filter((s) => s === 'PASS').length;
  if (passed >= WEEKLY_PASS_THRESHOLD) return 'PASS';
  if (passed >= 2) return 'PARTIAL';
  return 'FAIL';
}

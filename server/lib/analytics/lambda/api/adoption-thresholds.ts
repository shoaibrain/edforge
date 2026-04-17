/**
 * Layer 7.2 — adoption thresholds.
 *
 * Constants + classifier logic only. The shared API contract types
 * (AdoptionMetricKey, AdoptionStatus) come from @aibrains/shared-types
 * so the Lambda and frontend SDK cannot drift.
 *
 * Imports from the package main entry (not the schemas/analytics subpath)
 * because the server tsconfig uses moduleResolution: "node", which does
 * not honor the package's exports map. The main entry re-exports
 * everything from schemas/index.ts including analytics.
 */

import type {
  AdoptionMetricKey,
  AdoptionStatus,
} from '@aibrains/shared-types';

export type { AdoptionMetricKey, AdoptionStatus };

/** Grace period in days from tenant provisionedAt. */
export const GRACE_PERIOD_DAYS = 21;

export interface MetricThreshold {
  /** Steady-state threshold applied after the grace period. */
  steady: number;
  /** Relaxed threshold applied while the tenant is in grace. */
  grace: number;
}

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

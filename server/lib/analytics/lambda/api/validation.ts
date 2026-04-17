/**
 * S1.T5 — query param validation. Pure functions.
 */

import type { Granularity } from './analytics-service';

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_RANGE_DAYS = 365;

export function validateDateRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    throw new ValidationError('from must be yyyy-mm-dd');
  }
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ValidationError('to must be yyyy-mm-dd');
  }
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < start) throw new ValidationError('to cannot be before from');
  if ((end.getTime() - start.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
    throw new ValidationError(`Maximum range is ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}

export function validateGranularity(g: string | undefined): Granularity {
  if (g !== 'day' && g !== 'week' && g !== 'month') {
    throw new ValidationError('granularity must be one of: day, week, month');
  }
  return g;
}

export function validateWeekKey(w: string | undefined): string {
  if (!w || !/^\d{4}-W\d{2}$/.test(w)) {
    throw new ValidationError('week must be in yyyy-Www format');
  }
  return w;
}

export function validateDays(d: string | undefined): number {
  const days = d ? Number.parseInt(d, 10) : 30;
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new ValidationError('days must be an integer between 1 and 365');
  }
  return days;
}

/**
 * GET /analytics/tenants/{tenantId} — time-series response.
 */

import { z } from 'zod';
import { dateSecondarySchema } from './primitives';

export const metricSeriesPointSchema = z.object({
  /** Primary calendar date — yyyy-mm-dd (DAY), yyyy-Www (WEEK), or yyyy-mm (MONTH). Always Gregorian. */
  date: z.string().min(1),
  /** Optional secondary calendar (e.g. BS for Nepal tenants); omitted when tenant has dual-display off. */
  dateSecondary: dateSecondarySchema.optional(),
  /** Total count for this point. */
  value: z.number(),
  /** Optional per-dimension counts (e.g. role=Teacher, school=<id>). */
  breakdown: z.record(z.string(), z.number()).optional(),
});
export type MetricSeriesPoint = z.infer<typeof metricSeriesPointSchema>;

export const metricSeriesSchema = z.object({
  metric: z.string().min(1),
  series: z.array(metricSeriesPointSchema),
});
export type MetricSeries = z.infer<typeof metricSeriesSchema>;

export const tenantTimeSeriesResponseSchema = z.array(metricSeriesSchema);
export type TenantTimeSeriesResponse = z.infer<typeof tenantTimeSeriesResponseSchema>;

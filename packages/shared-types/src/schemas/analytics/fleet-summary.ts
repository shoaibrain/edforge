/**
 * GET /analytics/fleet — fleet summary (SystemAdmin / partner-scoped).
 */

import { z } from 'zod';

export const fleetFeatureCountSchema = z.object({
  metric: z.string().min(1),
  totalCount: z.number().int().min(0),
});
export type FleetFeatureCount = z.infer<typeof fleetFeatureCountSchema>;

export const fleetSummarySchema = z.object({
  active: z.number().int().min(0),
  inactive: z.number().int().min(0),
  dormant: z.number().int().min(0),
  atRisk: z.number().int().min(0),
  topFeatures: z.array(fleetFeatureCountSchema).max(10),
});
export type FleetSummary = z.infer<typeof fleetSummarySchema>;

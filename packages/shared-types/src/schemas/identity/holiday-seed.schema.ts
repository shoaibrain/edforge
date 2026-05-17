/**
 * Holiday Seed Endpoint Schemas — Sprint C3.3
 *
 * Shape of the response from `GET /holiday-seeds`. The seed payload
 * itself is generated from the JSON files under
 * `locale/holiday-seeds/`; this schema is the runtime contract for
 * the HTTP endpoint. Keep it loose — the endpoint is read-only and
 * the client's job is to render or pipe into generate-calendar.
 */

import { z } from 'zod';
import { dateSchema } from '../common';

export const holidaySeedCategorySchema = z.enum([
  'religious',
  'national',
  'school_specific',
]);
export type HolidaySeedCategorySchema = z.infer<typeof holidaySeedCategorySchema>;

export const holidaySeedSingleDaySchema = z.object({
  date: dateSchema,
  name: z.string().min(1).max(120),
  category: holidaySeedCategorySchema,
  source: z.string().max(120),
  eventType: z.literal('holiday'),
});

export const holidaySeedBlockSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  name: z.string().min(1).max(120),
  category: holidaySeedCategorySchema,
  source: z.string().max(120),
  eventType: z.literal('break'),
});

export const holidaySeedSchema = z.object({
  archetype: z.string(),
  region: z.string(),
  academicYearLabel: z.string(),
  bsYear: z.number().int().min(2000).max(2090),
  generatedFrom: z.string(),
  notes: z.string(),
  totals: z.object({
    blocks: z.number().int().min(0),
    singleDay: z.number().int().min(0),
    blockDays: z.number().int().min(0),
  }),
  blocks: z.array(holidaySeedBlockSchema),
  singleDay: z.array(holidaySeedSingleDaySchema),
});

/**
 * Resolution metadata returned alongside the seed. Lets the operator UI
 * surface "Using PABSON curated list" vs. "Using country defaults" vs.
 * "No seed available for this archetype + year".
 */
export const holidaySeedResolutionSchema = z.enum(['exact', 'country', 'none']);

export const holidaySeedResponseSchema = z.object({
  appliedFallback: holidaySeedResolutionSchema,
  seed: holidaySeedSchema.nullable(),
});

export type HolidaySeedResponse = z.infer<typeof holidaySeedResponseSchema>;

/**
 * Filter for the listing endpoint — operators can omit any field to
 * get the full registry; archetype/region narrow the result set. Year
 * (BS) is parsed coerced because it arrives as a query string.
 */
export const holidaySeedFilterSchema = z.object({
  archetype: z.string().min(1).max(40).optional(),
  region: z.string().min(2).max(3).optional(),
  year: z.coerce.number().int().min(2000).max(2090).optional(),
});

export type HolidaySeedFilter = z.infer<typeof holidaySeedFilterSchema>;

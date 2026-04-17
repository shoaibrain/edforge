/**
 * GET /analytics/tenants/{tenantId}/export-csv-url — presigned S3 URL.
 *
 * The CSV itself is written to the analytics export bucket and accessible
 * via this presigned GET URL. URL is single-use in practice (objects auto-
 * expire after 24h via a bucket lifecycle rule).
 */

import { z } from 'zod';

export const exportCsvUrlResponseSchema = z.object({
  url: z.string().url(),
  /** TTL in seconds (typically 600 = 10 minutes). */
  expiresIn: z.number().int().min(1),
});
export type ExportCsvUrlResponse = z.infer<typeof exportCsvUrlResponseSchema>;

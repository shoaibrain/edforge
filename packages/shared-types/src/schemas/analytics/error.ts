/**
 * Standard error response shape for /analytics/* endpoints.
 */

import { z } from 'zod';

export const analyticsErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  message: z.string().min(1),
  error: z.string().optional(),
});
export type AnalyticsErrorResponse = z.infer<typeof analyticsErrorResponseSchema>;

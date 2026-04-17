/**
 * GET /analytics/me/session-history — session history (self-only).
 */

import { z } from 'zod';

export const sessionEventTypeSchema = z.enum([
  'SessionCreated',
  'SessionRevoked',
  'SessionRefreshed',
]);
export type SessionEventType = z.infer<typeof sessionEventTypeSchema>;

export const sessionHistoryEventSchema = z.object({
  ts: z.string().min(1),
  /** Known event types are listed; unknown values pass through as strings (forward-compat). */
  eventType: z.union([sessionEventTypeSchema, z.string().min(1)]),
  ipAddress: z.string().optional(),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});
export type SessionHistoryEvent = z.infer<typeof sessionHistoryEventSchema>;

export const sessionHistoryResponseSchema = z.array(sessionHistoryEventSchema);
export type SessionHistoryResponse = z.infer<typeof sessionHistoryResponseSchema>;

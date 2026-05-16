/**
 * Base envelope schema for every domain event emitted to the SBT
 * EventBridge bus.
 *
 * Sprint C0.c.2 — every concrete event schema in this package extends
 * `baseEventSchema.merge({ eventType: z.literal(...), ... })` so the
 * registry can discriminate on `eventType` at parse time. Field
 * conventions:
 *
 *   - `eventType` is a snake-dotted string (`school.created`) used as the
 *     discriminator. The plan's §C0.c.2 listing is the source of truth
 *     for the V1 universe; new event types require both a schema in this
 *     directory AND an entry in `EVENT_REGISTRY` (taxonomy.ts).
 *   - `timestamp` is an ISO 8601 string. EventBridge converts to a Date
 *     when constructing `PutEventsRequestEntry.Time`.
 *   - `tenantId` is the partition key for tenant isolation. Per CLAUDE.md
 *     "Archetype model", events filter on tenantId in detail, not via
 *     a separate per-tenant bus.
 *   - `eventId` is assigned by EventBridge; optional on emit, populated
 *     on receive. Senders should NOT set it.
 *   - `correlationId` ties related events from a single user action
 *     across services (e.g., school.created → school.activated → ...).
 *     Senders SHOULD set it from the requestId / ABAC context.
 *   - `sourceUserId` identifies the user whose action emitted the event.
 *     Required for audit log reconstruction.
 *
 * Pilot-agnostic per invariant 13.
 */

import { z } from 'zod';

export const baseEventSchema = z.object({
  eventType: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  tenantId: z.string().min(1),
  eventId: z.string().optional(),
  correlationId: z.string().optional(),
  sourceUserId: z.string().optional(),
});

export type BaseEvent = z.infer<typeof baseEventSchema>;

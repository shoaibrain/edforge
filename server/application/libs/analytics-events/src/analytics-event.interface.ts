/**
 * AnalyticsEvent — the V1 BASIC-tier shape for every event published on
 * `source = edforge.analytics`.
 *
 * Cardinal rules (enforced by validator and aggregator):
 * - `schemaVersion: 1` on every analytics event. Unknown versions are DLQ'd.
 * - `userId` is raw on the event but NEVER appears in any aggregate DynamoDB SK.
 * - `role` and `schoolId` are the only dimensions permitted in aggregate keys.
 * - `tenantTier` is fixed at `'BASIC'` for V1; advanced tiers ship in V2.
 */

export type AnalyticsEventRole =
  | 'SystemAdmin'
  | 'TenantAdmin'
  | 'Teacher'
  | 'Parent'
  | 'Student';

export interface AnalyticsEvent {
  schemaVersion: 1;
  eventId: string;
  ts: string;
  tenantId: string;
  tenantTier: 'BASIC';
  userId: string;
  role: AnalyticsEventRole;
  schoolId?: string;
  feature: string;
  action: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Payload shape accepted by `AnalyticsEventsService` helpers. The service
 * generates `eventId`, `ts`, and sets `schemaVersion`/`tenantTier`/`feature`/
 * `action` itself — callers only provide the business context.
 */
export type AnalyticsEventInput = Omit<
  AnalyticsEvent,
  'schemaVersion' | 'eventId' | 'ts' | 'tenantTier' | 'feature' | 'action'
>;

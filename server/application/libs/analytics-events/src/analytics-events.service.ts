/**
 * AnalyticsEventsService — NestJS service that publishes native analytics
 * events on `source = edforge.analytics`.
 *
 * CARDINAL RULES (Layer 1 contract):
 * 1. Non-blocking: every helper swallows errors, never throws or rejects.
 * 2. `ANALYTICS_ENABLED` gate: when false, every helper is a silent no-op
 *    (zero EventBridge calls, zero side effects).
 * 3. Service stamps `schemaVersion: 1`, `tenantTier: 'BASIC'`, `eventId`
 *    (UUID v4), and `ts` (ISO8601) itself. Caller provides the business
 *    context (tenantId, userId, role, optional schoolId/correlationId/metadata).
 * 4. Each helper maps to a specific EventBridge DetailType (LoginSuccess,
 *    SessionCreated, etc.); `feature` and `action` are set by the service,
 *    not by the caller, so the event-metric-map in Layer 5 has stable input.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type {
  AnalyticsEvent,
  AnalyticsEventInput,
} from './analytics-event.interface';

export const ANALYTICS_EVENT_SOURCE = 'edforge.analytics';

export type AnalyticsDetailType =
  | 'LoginSuccess'
  | 'LoginFailure'
  | 'Logout'
  | 'PasswordReset'
  | 'SessionCreated'
  | 'SessionRevoked'
  | 'SessionRefreshed'
  | 'UserCreated'
  | 'UserUpdated'
  | 'UserDisabled'
  | 'FeatureUsage'
  | 'AuditLogged';

interface DetailTypeMapping {
  feature: string;
  action: string;
}

const DETAIL_TYPE_TO_FEATURE_ACTION: Record<AnalyticsDetailType, DetailTypeMapping> = {
  LoginSuccess:     { feature: 'auth',    action: 'login.success' },
  LoginFailure:     { feature: 'auth',    action: 'login.failure' },
  Logout:           { feature: 'auth',    action: 'logout' },
  PasswordReset:    { feature: 'auth',    action: 'password.reset' },
  SessionCreated:   { feature: 'session', action: 'create' },
  SessionRevoked:   { feature: 'session', action: 'revoke' },
  SessionRefreshed: { feature: 'session', action: 'refresh' },
  UserCreated:      { feature: 'user',    action: 'create' },
  UserUpdated:      { feature: 'user',    action: 'update' },
  UserDisabled:     { feature: 'user',    action: 'disable' },
  FeatureUsage:     { feature: 'feature', action: 'usage' },
  AuditLogged:      { feature: 'audit',   action: 'logged' },
};

@Injectable()
export class AnalyticsEventsService {
  private readonly logger = new Logger(AnalyticsEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string | undefined;
  private readonly enabled: boolean;
  readonly eventSource = ANALYTICS_EVENT_SOURCE;

  constructor(@Optional() configService?: ConfigService) {
    const rawEnabled =
      configService?.get<string>('ANALYTICS_ENABLED') ??
      process.env.ANALYTICS_ENABLED ??
      'false';
    this.enabled = rawEnabled === 'true';

    this.eventBusName =
      configService?.get<string>('EVENT_BUS_NAME') ?? process.env.EVENT_BUS_NAME;

    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 3,
      retryMode: 'adaptive',
    });

    this.logger.log(
      `AnalyticsEventsService initialized: enabled=${this.enabled} ` +
        `source=${this.eventSource} busName=${this.eventBusName ?? '(unset)'}`,
    );
  }

  /** Exposed for tests and for services that need to gate their own work. */
  isEnabled(): boolean {
    return this.enabled;
  }

  // --- auth helpers ---
  emitLoginSuccess(input: AnalyticsEventInput): Promise<void> {
    return this.publish('LoginSuccess', input);
  }
  emitLoginFailure(input: AnalyticsEventInput): Promise<void> {
    return this.publish('LoginFailure', input);
  }
  emitLogout(input: AnalyticsEventInput): Promise<void> {
    return this.publish('Logout', input);
  }
  emitPasswordReset(input: AnalyticsEventInput): Promise<void> {
    return this.publish('PasswordReset', input);
  }

  // --- session helpers ---
  emitSessionCreated(input: AnalyticsEventInput): Promise<void> {
    return this.publish('SessionCreated', input);
  }
  emitSessionRevoked(input: AnalyticsEventInput): Promise<void> {
    return this.publish('SessionRevoked', input);
  }
  emitSessionRefreshed(input: AnalyticsEventInput): Promise<void> {
    return this.publish('SessionRefreshed', input);
  }

  // --- user helpers ---
  emitUserCreated(input: AnalyticsEventInput): Promise<void> {
    return this.publish('UserCreated', input);
  }
  emitUserUpdated(input: AnalyticsEventInput): Promise<void> {
    return this.publish('UserUpdated', input);
  }
  emitUserDisabled(input: AnalyticsEventInput): Promise<void> {
    return this.publish('UserDisabled', input);
  }

  // --- generic helpers ---
  emitFeatureUsage(
    input: AnalyticsEventInput & { metadata: { feature: string; action: string } },
  ): Promise<void> {
    return this.publish('FeatureUsage', input);
  }
  emitAuditLogged(input: AnalyticsEventInput): Promise<void> {
    return this.publish('AuditLogged', input);
  }

  /**
   * Internal publisher. Builds the full AnalyticsEvent envelope, calls
   * EventBridge PutEvents, swallows any error. Never throws. Never awaits
   * anything that could propagate to the caller's hot path.
   */
  private async publish(
    detailType: AnalyticsDetailType,
    input: AnalyticsEventInput,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.eventBusName) {
      this.logger.warn(
        `Skipping ${detailType}: EVENT_BUS_NAME not configured (enabled=true)`,
      );
      return;
    }

    const { feature, action } = DETAIL_TYPE_TO_FEATURE_ACTION[detailType];
    const event: AnalyticsEvent = {
      schemaVersion: 1,
      eventId: randomUUID(),
      ts: new Date().toISOString(),
      tenantTier: 'BASIC',
      feature,
      action,
      ...input,
    };

    try {
      const entry: PutEventsRequestEntry = {
        Source: this.eventSource,
        DetailType: detailType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName,
        Time: new Date(event.ts),
      };
      const result = await this.eventBridge.send(
        new PutEventsCommand({ Entries: [entry] }),
      );
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        this.logger.error(
          `Analytics event ${detailType} failed: ${JSON.stringify(result.Entries?.[0])}`,
        );
      }
    } catch (err) {
      // Non-blocking: swallow. Never propagate — would break caller's hot path.
      this.logger.error(
        `Analytics event ${detailType} threw: ${(err as Error).message}`,
      );
    }
  }
}

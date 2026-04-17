/**
 * IdentityAnalyticsEventsService — thin wrapper over `AnalyticsEventsService`
 * for the identity service.
 *
 * Why a wrapper:
 *   1. Keeps call sites in auth/sessions/users/staff short (one method call,
 *      small payload) so they don't bloat.
 *   2. Centralizes the role-coercion logic — Cognito puts `TenantAdmin`,
 *      `TenantUser`, etc. into JWT claims; AnalyticsEvent's `role` enum is
 *      stricter (`SystemAdmin | TenantAdmin | Teacher | Parent | Student`).
 *   3. Every method returns a fire-and-forget Promise. Caller SHOULD NOT
 *      `await` these — use `void svc.emitX(...)` or assign to `_`.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyticsEventsService,
  type AnalyticsEventRole,
} from '@app/analytics-events';

export interface IdentityEventContext {
  tenantId: string;
  userId: string;
  rawRole?: string | null;
  schoolId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IdentityAnalyticsEventsService {
  private readonly logger = new Logger(IdentityAnalyticsEventsService.name);

  constructor(private readonly analytics: AnalyticsEventsService) {}

  emitLoginSuccess(ctx: IdentityEventContext): void {
    this.safeFire('emitLoginSuccess', () =>
      this.analytics.emitLoginSuccess(this.build(ctx)),
    );
  }

  emitLoginFailure(ctx: IdentityEventContext): void {
    this.safeFire('emitLoginFailure', () =>
      this.analytics.emitLoginFailure(this.build(ctx)),
    );
  }

  emitLogout(ctx: IdentityEventContext): void {
    this.safeFire('emitLogout', () =>
      this.analytics.emitLogout(this.build(ctx)),
    );
  }

  emitSessionCreated(ctx: IdentityEventContext): void {
    this.safeFire('emitSessionCreated', () =>
      this.analytics.emitSessionCreated(this.build(ctx)),
    );
  }

  emitSessionRevoked(ctx: IdentityEventContext): void {
    this.safeFire('emitSessionRevoked', () =>
      this.analytics.emitSessionRevoked(this.build(ctx)),
    );
  }

  emitSessionRefreshed(ctx: IdentityEventContext): void {
    this.safeFire('emitSessionRefreshed', () =>
      this.analytics.emitSessionRefreshed(this.build(ctx)),
    );
  }

  emitUserCreated(ctx: IdentityEventContext): void {
    this.safeFire('emitUserCreated', () =>
      this.analytics.emitUserCreated(this.build(ctx)),
    );
  }

  emitUserUpdated(ctx: IdentityEventContext): void {
    this.safeFire('emitUserUpdated', () =>
      this.analytics.emitUserUpdated(this.build(ctx)),
    );
  }

  emitUserDisabled(ctx: IdentityEventContext): void {
    this.safeFire('emitUserDisabled', () =>
      this.analytics.emitUserDisabled(this.build(ctx)),
    );
  }

  private build(ctx: IdentityEventContext) {
    return {
      tenantId: ctx.tenantId || 'unknown',
      userId: ctx.userId || 'unknown',
      role: this.coerceRole(ctx.rawRole),
      ...(ctx.schoolId ? { schoolId: ctx.schoolId } : {}),
      ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
      ...(ctx.metadata ? { metadata: ctx.metadata } : {}),
    };
  }

  /**
   * Map the role string as it appears on a JWT or in a service context onto
   * the AnalyticsEvent role enum. Anything unrecognized falls back to
   * 'TenantAdmin' — the enum has no 'Unknown' member, and analytics dashboards
   * should not silently swallow traffic from odd roles; burning this onto
   * TenantAdmin makes the drift visible.
   */
  private coerceRole(raw: string | null | undefined): AnalyticsEventRole {
    switch (raw) {
      case 'SystemAdmin':
      case 'TenantAdmin':
      case 'Teacher':
      case 'Parent':
      case 'Student':
        return raw;
      default:
        return 'TenantAdmin';
    }
  }

  private safeFire(label: string, fn: () => Promise<void>): void {
    try {
      void fn().catch((err) =>
        this.logger.warn(
          `IdentityAnalyticsEvents.${label} rejected: ${(err as Error).message}`,
        ),
      );
    } catch (err) {
      this.logger.warn(
        `IdentityAnalyticsEvents.${label} threw synchronously: ${(err as Error).message}`,
      );
    }
  }
}

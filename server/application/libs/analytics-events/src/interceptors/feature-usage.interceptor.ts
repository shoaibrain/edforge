/**
 * FeatureUsageInterceptor — Layer 4.7
 *
 * Emits a `FeatureUsage` analytics event for every non-GET HTTP request
 * handled by a microservice that registers this interceptor via
 * `APP_INTERCEPTOR`.
 *
 * Rules:
 *   - GET/OPTIONS/HEAD requests are IGNORED (cardinal rule: writes only).
 *   - The interceptor is a no-op when ANALYTICS_ENABLED=false (the underlying
 *     service already gates PutEvents).
 *   - `feature` is derived from the first path segment (e.g. `/attendance/...`
 *     → `attendance`). `action` is derived from the HTTP method.
 *   - `tenantId`, `userId`, `role` are read from the Nest request; identity
 *     services populate `request.user` via JwtStrategy or equivalent.
 *   - Never throws. Never delays the response. Emission is fire-and-forget
 *     on `tap()` AFTER the response is produced (next handler ran).
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AnalyticsEventsService } from '../analytics-events.service';
import type { AnalyticsEventRole } from '../analytics-event.interface';

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

function coerceRole(raw: unknown): AnalyticsEventRole {
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

function extractFeature(urlOrPath: string | undefined): string {
  if (!urlOrPath) return 'unknown';
  // strip query string, leading slash
  const path = urlOrPath.split('?')[0].replace(/^\/+/, '');
  if (!path) return 'unknown';
  const seg = path.split('/')[0] || 'unknown';
  return seg.toLowerCase();
}

@Injectable()
export class FeatureUsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FeatureUsageInterceptor.name);

  constructor(private readonly analytics: AnalyticsEventsService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    // Non-HTTP contexts (graphql/rpc): just pass through.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      originalUrl?: string;
      path?: string;
      user?: {
        tenantId?: string;
        userId?: string;
        sub?: string;
        globalRole?: string;
        userRole?: string;
        role?: string;
      };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const method = (req?.method || 'GET').toUpperCase();
    const action = METHOD_TO_ACTION[method];
    if (!action) {
      // GET / OPTIONS / HEAD → no event.
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => this.emit(req, method, action),
        // On error we still emit: the write was attempted. Metadata marks it
        // as a failure so dashboards can split success vs failure counts.
        error: () => this.emit(req, method, action, true),
      }),
    );
  }

  private emit(
    req: {
      url?: string;
      originalUrl?: string;
      path?: string;
      user?: {
        tenantId?: string;
        userId?: string;
        sub?: string;
        globalRole?: string;
        userRole?: string;
        role?: string;
      };
      headers?: Record<string, string | string[] | undefined>;
    },
    method: string,
    action: string,
    failed = false,
  ): void {
    try {
      if (!this.analytics.isEnabled()) return;

      const user = req?.user || {};
      const tenantId = user.tenantId;
      const userId = user.userId || user.sub;
      if (!tenantId || !userId) {
        // Anonymous / pre-auth traffic is not instrumented.
        return;
      }

      const rawRole = user.globalRole || user.userRole || user.role;
      const feature = extractFeature(req.url || req.originalUrl || req.path);
      const correlationHeader =
        req.headers?.['x-correlation-id'] ||
        req.headers?.['x-request-id'];
      const correlationId = Array.isArray(correlationHeader)
        ? correlationHeader[0]
        : correlationHeader;

      void this.analytics
        .emitFeatureUsage({
          tenantId,
          userId,
          role: coerceRole(rawRole),
          ...(correlationId ? { correlationId } : {}),
          metadata: {
            feature,
            action,
            httpMethod: method,
            ...(failed ? { failed: true } : {}),
          },
        })
        .catch((err) =>
          this.logger.warn(
            `FeatureUsage emit rejected: ${(err as Error).message}`,
          ),
        );
    } catch (err) {
      this.logger.warn(
        `FeatureUsage emit threw synchronously: ${(err as Error).message}`,
      );
    }
  }
}

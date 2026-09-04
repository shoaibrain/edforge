import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { acquireRunLease, runWindowKey } from '@app/common-utils';
import { FinanceModule } from './finance.module';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { RecurringBillingService } from './common/services/recurring-billing.service';
import { OverdueDetectionService } from './common/services/overdue-detection.service';
import { BillingReconciliationService } from './common/services/billing-reconciliation.service';
import { PaymentSweepService } from './common/services/payment-sweep.service';

/**
 * Cost-redesign C3.3 — the scheduled entry for the finance timers.
 *
 * EventBridge Scheduler invokes this function with `{ job, scheduledTime }`
 * (the time is the `<aws.scheduler.scheduled-time>` context attribute, so
 * every invocation of the same window carries the same value). The handler
 * boots the finance Nest app once per execution environment as an
 * application context — no HTTP adapter, and under EDFORGE_RUNTIME=lambda
 * the services arm no timers — takes the run lease for (job, window) in the
 * finance table, and calls the service's runOnce(). A retry or a duplicate
 * delivery for a window that already ran is a no-op.
 */
export interface ScheduledJobEvent {
  job: string;
  /** ISO time from `<aws.scheduler.scheduled-time>`; falls back to now. */
  scheduledTime?: string;
}

export interface ScheduledJobResult {
  job: string;
  windowKey: string;
  ran: boolean;
  reason?: 'lease-held' | 'unknown-job';
  result?: unknown;
}

type Runnable = { runOnce(): Promise<unknown> };

/** Job name → the service that owns the work and how long the lease outlives a normal run. */
export const SCHEDULED_JOBS: Record<string, { token: abstract new (...args: never[]) => Runnable; leaseTtlSeconds: number }> = {
  'recurring-billing': { token: RecurringBillingService, leaseTtlSeconds: 23 * 60 * 60 },
  'overdue-detection': { token: OverdueDetectionService, leaseTtlSeconds: 55 * 60 },
  'billing-reconciliation': { token: BillingReconciliationService, leaseTtlSeconds: 55 * 60 },
  'payment-sweep': { token: PaymentSweepService, leaseTtlSeconds: 25 * 60 },
};

const FINANCE_KEY = { pk: 'tenantId', sk: 'entityKey' } as const;

export interface ScheduledHandlerDeps {
  getApp: () => Promise<INestApplicationContext>;
  logger?: Logger;
}

export function createScheduledHandler(deps: ScheduledHandlerDeps) {
  const logger = deps.logger ?? new Logger('scheduled');
  return async (event: ScheduledJobEvent): Promise<ScheduledJobResult> => {
    const job = event?.job;
    const windowKey = runWindowKey(event?.scheduledTime ?? new Date());
    const entry = SCHEDULED_JOBS[job];
    if (!entry) {
      logger.error({ action: 'scheduled.unknown_job', job });
      return { job, windowKey, ran: false, reason: 'unknown-job' };
    }
    const app = await deps.getApp();
    const ddb = app.get(DynamoDBClientService, { strict: false });
    const lease = await acquireRunLease(ddb.getSystemClient(), ddb.getTableName(), FINANCE_KEY, job, windowKey, entry.leaseTtlSeconds);
    if (!lease.acquired) {
      logger.log({ action: 'scheduled.lease_held', job, windowKey });
      return { job, windowKey, ran: false, reason: 'lease-held' };
    }
    const started = Date.now();
    const result = await app.get(entry.token as never, { strict: false }).runOnce();
    logger.log({ action: 'scheduled.ran', job, windowKey, durationMs: Date.now() - started, result });
    return { job, windowKey, ran: true, result };
  };
}

let cachedApp: Promise<INestApplicationContext> | undefined;

export async function getApplicationContext(): Promise<INestApplicationContext> {
  cachedApp ??= NestFactory.createApplicationContext(FinanceModule, { logger: ['error', 'warn', 'log'] });
  return cachedApp;
}

export const scheduledHandler = createScheduledHandler({ getApp: getApplicationContext });

import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { acquireRunLease, releaseRunLease, runWindowKey } from '@app/common-utils';
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
  reason?: 'lease-held' | 'unknown-job' | 'disabled';
  result?: unknown;
}

type Runnable = { runOnce(): Promise<unknown> };

/** Job name → the service that owns the work and how long the lease outlives a normal run. */
export const SCHEDULED_JOBS: Record<string, { token: abstract new (...args: never[]) => Runnable; leaseTtlSeconds: number; disableEnv: string }> = {
  'recurring-billing': { token: RecurringBillingService, leaseTtlSeconds: 23 * 60 * 60, disableEnv: 'DISABLE_RECURRING_BILLING' },
  'overdue-detection': { token: OverdueDetectionService, leaseTtlSeconds: 55 * 60, disableEnv: 'DISABLE_OVERDUE_DETECTION' },
  'billing-reconciliation': { token: BillingReconciliationService, leaseTtlSeconds: 55 * 60, disableEnv: 'DISABLE_BILLING_RECONCILIATION' },
  'payment-sweep': { token: PaymentSweepService, leaseTtlSeconds: 25 * 60, disableEnv: 'DISABLE_PAYMENT_SWEEP' },
};

const FINANCE_KEY = { pk: 'tenantId', sk: 'entityKey' } as const;

export interface ScheduledHandlerDeps {
  getApp: () => Promise<INestApplicationContext>;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
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
    // The same kill switch the ECS timer honours: the function inherits the
    // task-definition environment, so DISABLE_<JOB>=true stops the job here too.
    if ((deps.env ?? process.env)[entry.disableEnv] === 'true') {
      logger.log({ action: 'scheduled.disabled', job, gate: entry.disableEnv });
      return { job, windowKey, ran: false, reason: 'disabled' };
    }
    const app = await deps.getApp();
    const ddb = app.get(DynamoDBClientService, { strict: false });
    const client = ddb.getSystemClient();
    const lease = await acquireRunLease(client, ddb.getTableName(), FINANCE_KEY, job, windowKey, entry.leaseTtlSeconds);
    if (!lease.acquired) {
      logger.log({ action: 'scheduled.lease_held', job, windowKey });
      return { job, windowKey, ran: false, reason: 'lease-held' };
    }
    const started = Date.now();
    try {
      const result = await app.get(entry.token as never, { strict: false }).runOnce();
      logger.log({ action: 'scheduled.ran', job, windowKey, durationMs: Date.now() - started, result });
      return { job, windowKey, ran: true, result };
    } catch (err) {
      // Give the window back so Scheduler's retry (up to two) can run it;
      // the errors alarm still fires on this invocation.
      await releaseRunLease(client, ddb.getTableName(), FINANCE_KEY, lease).catch((e: unknown) => logger.warn({ action: 'scheduled.lease_release_failed', job, windowKey, error: (e as Error).message }));
      throw err;
    }
  };
}

let cachedApp: Promise<INestApplicationContext> | undefined;

export async function getApplicationContext(): Promise<INestApplicationContext> {
  cachedApp ??= NestFactory.createApplicationContext(FinanceModule, { logger: ['error', 'warn', 'log'] });
  return cachedApp;
}

export const scheduledHandler = createScheduledHandler({ getApp: getApplicationContext });

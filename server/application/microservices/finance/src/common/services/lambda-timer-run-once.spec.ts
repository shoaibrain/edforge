import { Logger } from '@nestjs/common';
import { RecurringBillingService } from './recurring-billing.service';
import { OverdueDetectionService } from './overdue-detection.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { PaymentSweepService } from './payment-sweep.service';

/**
 * C3.2 — every timer service exposes runOnce(), and the timer path invokes
 * exactly that (so the scheduled Lambda entry and the ECS interval run the
 * same code). Instances are built from the prototype: onModuleInit touches
 * only the logger, the env gates and the timers.
 */
type TimerService = { onModuleInit(): void; onModuleDestroy(): void; runOnce(): Promise<unknown> };
const build = <T extends TimerService>(ctor: { prototype: T }): T => {
  const svc = Object.create(ctor.prototype) as T & { logger: Logger };
  svc.logger = new Logger('test');
  jest.spyOn(svc.logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(svc.logger, 'error').mockImplementation(() => undefined);
  return svc;
};
const GATES = ['DISABLE_RECURRING_BILLING', 'DISABLE_OVERDUE_DETECTION', 'DISABLE_BILLING_RECONCILIATION', 'DISABLE_PAYMENT_SWEEP', 'EDFORGE_RUNTIME'];

describe.each([
  ['RecurringBillingService', RecurringBillingService, 'generateRecurringInvoices', 24 * 60 * 60 * 1000],
  ['OverdueDetectionService', OverdueDetectionService, 'detectOverdue', 60 * 60 * 1000],
  ['BillingReconciliationService', BillingReconciliationService, 'reconcile', 60 * 60 * 1000],
  ['PaymentSweepService', PaymentSweepService, 'sweep', 30 * 60 * 1000],
] as const)('%s (C3.2)', (_name, ctor, method, intervalMs) => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    jest.useFakeTimers();
    for (const g of GATES) { saved[g] = process.env[g]; delete process.env[g]; }
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const g of GATES) { if (saved[g] === undefined) delete process.env[g]; else process.env[g] = saved[g]; }
  });

  it('runOnce() delegates to the run body', async () => {
    const svc = build(ctor as never) as TimerService & Record<string, unknown>;
    const body = jest.fn().mockResolvedValue({ ok: true });
    (svc as Record<string, unknown>)[method] = body;
    await expect(svc.runOnce()).resolves.toEqual({ ok: true });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('the interval invokes runOnce(), and errors are logged rather than thrown', async () => {
    const svc = build(ctor as never) as TimerService & Record<string, unknown>;
    const runOnce = jest.spyOn(svc, 'runOnce').mockRejectedValue(new Error('boom'));
    svc.onModuleInit();
    await jest.advanceTimersByTimeAsync(intervalMs + 5 * 60 * 1000);
    expect(runOnce.mock.calls.length).toBeGreaterThanOrEqual(1);
    svc.onModuleDestroy();
  });

  it('under the Lambda runtime no timer is armed', () => {
    process.env.EDFORGE_RUNTIME = 'lambda';
    const svc = build(ctor as never) as TimerService;
    const runOnce = jest.spyOn(svc, 'runOnce');
    svc.onModuleInit();
    jest.advanceTimersByTime(intervalMs * 2);
    expect(runOnce).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

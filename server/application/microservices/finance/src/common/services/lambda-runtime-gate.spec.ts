import { RecurringBillingService } from './recurring-billing.service';
import { PaymentSweepService } from './payment-sweep.service';
import { OverdueDetectionService } from './overdue-detection.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { FinanceMetricsService } from './finance-metrics.service';
import { StaleFinanceJobSweeper } from '../../bulk-ops/stale-finance-job-sweeper.service';

/**
 * C1.2 — under `EDFORGE_RUNTIME=lambda` no finance service may start a
 * wall-clock timer or run a per-boot scan: the execution environment is
 * frozen between invocations, so the work moves to EventBridge Scheduler
 * (C3.4) and the finance-job-janitor Lambda. In the http runtime nothing
 * changes.
 */
const untouchable = <T>(label: string): T =>
  new Proxy({}, {
    get: (_t, prop) => {
      throw new Error(`${label}.${String(prop)} must not be touched in the Lambda runtime`);
    },
  }) as T;

describe('finance background work under the Lambda runtime (C1.2)', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'EDFORGE_RUNTIME',
    'DISABLE_RECURRING_BILLING',
    'DISABLE_PAYMENT_SWEEP',
    'DISABLE_OVERDUE_DETECTION',
    'DISABLE_BILLING_RECONCILIATION',
    'DISABLE_STALE_JOB_SWEEPER',
  ];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    jest.useFakeTimers();
    jest.spyOn(global, 'setInterval');
    jest.spyOn(global, 'setTimeout');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const timerServices: Array<[string, () => { onModuleInit(): void; onModuleDestroy?(): void }]> = [
    ['RecurringBillingService', () => new RecurringBillingService({} as never, {} as never)],
    ['PaymentSweepService', () => new PaymentSweepService({} as never, {} as never, {} as never)],
    ['OverdueDetectionService', () => new OverdueDetectionService({} as never, {} as never)],
    ['BillingReconciliationService', () => new BillingReconciliationService({} as never)],
    ['FinanceMetricsService', () => new FinanceMetricsService()],
  ];

  describe.each(timerServices)('%s', (_name, build) => {
    it('starts no timer in the Lambda runtime', () => {
      process.env.EDFORGE_RUNTIME = 'lambda';
      build().onModuleInit();
      expect(setInterval).not.toHaveBeenCalled();
      expect(setTimeout).not.toHaveBeenCalled();
    });

    it('still schedules in the http runtime', () => {
      const svc = build();
      svc.onModuleInit();
      expect((setInterval as unknown as jest.Mock).mock.calls.length + (setTimeout as unknown as jest.Mock).mock.calls.length).toBeGreaterThan(0);
      svc.onModuleDestroy?.();
    });
  });

  it('StaleFinanceJobSweeper skips the per-boot scan in the Lambda runtime', async () => {
    process.env.EDFORGE_RUNTIME = 'lambda';
    const sweeper = new StaleFinanceJobSweeper(untouchable('DynamoDBClientService'), undefined);
    await expect(sweeper.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

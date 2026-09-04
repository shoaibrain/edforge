import { FinanceMetricsService } from './finance-metrics.service';

/**
 * C3.10 — under Lambda a datum becomes one Embedded Metric Format line on
 * stdout; nothing is buffered, no PutMetricData is sent, no timer exists.
 */
describe('FinanceMetricsService under Lambda (C3.10)', () => {
  const saved = process.env.EDFORGE_RUNTIME;
  const lines: string[] = [];
  const original = FinanceMetricsService.write;
  beforeEach(() => { process.env.EDFORGE_RUNTIME = 'lambda'; lines.length = 0; FinanceMetricsService.write = (l) => { lines.push(l); }; });
  afterEach(() => { FinanceMetricsService.write = original; if (saved === undefined) delete process.env.EDFORGE_RUNTIME; else process.env.EDFORGE_RUNTIME = saved; });

  it('writes one EMF line per put() with namespace, dimensions, unit and value, and buffers nothing', async () => {
    const svc = new FinanceMetricsService();
    const send = jest.fn();
    (svc as unknown as { client: { send: jest.Mock } }).client = { send };
    svc.put({ namespace: 'EdForge/Finance', metricName: 'SequenceLatencyMs', value: 12.5, unit: 'Milliseconds', dimensions: { tenantId: 't1', schoolId: 's1' } });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed._aws.CloudWatchMetrics).toEqual([{ Namespace: 'EdForge/Finance', Dimensions: [['tenantId', 'schoolId']], Metrics: [{ Name: 'SequenceLatencyMs', Unit: 'Milliseconds' }] }]);
    expect(typeof parsed._aws.Timestamp).toBe('number');
    expect(parsed).toEqual(expect.objectContaining({ tenantId: 't1', schoolId: 's1', SequenceLatencyMs: 12.5 }));
    await svc.flush();
    expect(send).not.toHaveBeenCalled();
    expect((svc as unknown as { buffer: unknown[] }).buffer).toHaveLength(0);
  });

  it('arms no flush timer under Lambda', () => {
    jest.useFakeTimers();
    try {
      const svc = new FinanceMetricsService();
      svc.onModuleInit();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

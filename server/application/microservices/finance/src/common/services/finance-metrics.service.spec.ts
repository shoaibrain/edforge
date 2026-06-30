/**
 * FinanceMetricsService spec (issues #344 + #345).
 *
 * Pin the design rules from the service's file header:
 *   1. Best-effort — never throws even when CW errors.
 *   2. Batched flush — at most 20 datums per PutMetricData call (CW limit).
 *   3. Per-namespace grouping — each PutMetricData call carries one namespace.
 *   4. Eager flush when buffer hits the 20 cap.
 *   5. onModuleDestroy drains the buffer before shutdown.
 */

import { Logger } from '@nestjs/common';
import { FinanceMetricsService } from './finance-metrics.service';

describe('FinanceMetricsService', () => {
  let service: FinanceMetricsService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    service = new FinanceMetricsService();
    // Swap the CW client's `send` with a mock so the spec never hits
    // real AWS. The mock returns a resolved promise by default — the
    // negative cases swap it for a rejection per-test.
    sendMock = jest.fn().mockResolvedValue({});
    (service as any).client = { send: sendMock };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe('put + flush — happy path', () => {
    it('buffers a single datum and emits ONE PutMetricData on flush', async () => {
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveCount',
        value: 600,
        unit: 'Count',
        dimensions: { schoolId: 'sch-1', sequenceType: 'INVOICE#2606' },
      });
      expect(service.bufferLength()).toBe(1);

      await service.flush();

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.Namespace).toBe('Edforge/Finance/Sequence');
      expect(cmd.input.MetricData).toHaveLength(1);
      expect(cmd.input.MetricData[0].MetricName).toBe('BatchReserveCount');
      expect(cmd.input.MetricData[0].Value).toBe(600);
      expect(cmd.input.MetricData[0].Unit).toBe('Count');
      expect(cmd.input.MetricData[0].Dimensions).toEqual([
        { Name: 'schoolId', Value: 'sch-1' },
        { Name: 'sequenceType', Value: 'INVOICE#2606' },
      ]);
      expect(service.bufferLength()).toBe(0);
    });

    it('groups datums by namespace — one PutMetricData call per namespace', async () => {
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveCount',
        value: 100,
        unit: 'Count',
      });
      service.put({
        namespace: 'Edforge/Finance/BulkWorker',
        metricName: 'CheckDupLatencyMs',
        value: 42,
        unit: 'Milliseconds',
      });
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveLatencyMs',
        value: 18,
        unit: 'Milliseconds',
      });

      await service.flush();

      // Two calls expected — one per distinct namespace.
      expect(sendMock).toHaveBeenCalledTimes(2);
      const namespaces = sendMock.mock.calls.map((c) => c[0].input.Namespace).sort();
      expect(namespaces).toEqual([
        'Edforge/Finance/BulkWorker',
        'Edforge/Finance/Sequence',
      ]);
    });

    it('chunks > 20 datums in the same namespace into multiple PutMetricData calls (CW hard limit)', async () => {
      for (let i = 0; i < 45; i++) {
        service.put({
          namespace: 'Edforge/Finance/BulkWorker',
          metricName: 'CheckDupLatencyMs',
          value: i,
          unit: 'Milliseconds',
        });
      }
      // The 20-cap-eager-flush should have fired 2× during the puts.
      // After the puts, 5 datums remain. Drain manually:
      await service.flush();

      // Total CW calls: 2 from eager-flush (at 20, then at 40) + 1
      // for the final 5-datum drain = 3 calls.
      expect(sendMock).toHaveBeenCalledTimes(3);
      const chunkSizes = sendMock.mock.calls.map((c) => c[0].input.MetricData.length);
      expect(chunkSizes).toEqual([20, 20, 5]);
    });

    it('is a no-op on an empty buffer (no CW call)', async () => {
      await service.flush();
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('best-effort error handling — NEVER throws (hot-path safety)', () => {
    it('swallows + warn-logs when PutMetricData rejects (does NOT re-throw to caller)', async () => {
      sendMock.mockRejectedValueOnce(new Error('CW throttled'));
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveCount',
        value: 1,
        unit: 'Count',
      });

      // The contract: flush() must resolve cleanly even when CW errors.
      // Re-throwing here would propagate to the worker's catch-all and
      // potentially short-circuit a successful invoice batch.
      await expect(service.flush()).resolves.toBeUndefined();

      // Buffer drained even though the send failed — we DON'T re-buffer
      // failed datums (avoids unbounded memory growth on a CW outage).
      expect(service.bufferLength()).toBe(0);
    });

    it('continues to next namespace chunk even if one chunk fails', async () => {
      // Per-call rejection on the first namespace's send; the second
      // namespace must still attempt its own send.
      sendMock.mockRejectedValueOnce(new Error('CW throttled'));
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveCount',
        value: 1,
        unit: 'Count',
      });
      service.put({
        namespace: 'Edforge/Finance/BulkWorker',
        metricName: 'GenerateLatencyMs',
        value: 600,
        unit: 'Milliseconds',
      });

      await service.flush();

      // Both namespaces attempted, even though the first one threw.
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('put() never throws even when buffer + flush race', () => {
      // Trigger an eager-flush mid-puts with a rejecting CW client.
      sendMock.mockRejectedValue(new Error('always fails'));
      // 20 puts triggers the eager-flush; 21st put after the failed
      // flush should still succeed.
      for (let i = 0; i < 20; i++) {
        expect(() =>
          service.put({
            namespace: 'Edforge/Finance/Sequence',
            metricName: 'BatchReserveCount',
            value: i,
            unit: 'Count',
          }),
        ).not.toThrow();
      }
      expect(() =>
        service.put({
          namespace: 'Edforge/Finance/Sequence',
          metricName: 'BatchReserveCount',
          value: 21,
          unit: 'Count',
        }),
      ).not.toThrow();
    });
  });

  describe('lifecycle hooks', () => {
    it('onModuleInit registers a flush timer (unref-ed to not block shutdown)', () => {
      service.onModuleInit();
      expect((service as any).flushTimer).toBeDefined();
    });

    it('onModuleDestroy clears the timer AND drains the buffer', async () => {
      service.onModuleInit();
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveCount',
        value: 1,
        unit: 'Count',
      });
      expect(service.bufferLength()).toBe(1);

      await service.onModuleDestroy();

      // Final flush happened on shutdown.
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(service.bufferLength()).toBe(0);
      expect((service as any).flushTimer).toBeUndefined();
    });
  });

  describe('default unit handling', () => {
    it('defaults unit to "None" when not supplied', async () => {
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveAttempts',
        value: 1,
        // no unit specified
      });
      await service.flush();
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.MetricData[0].Unit).toBe('None');
    });

    it('passes empty dimensions array when none supplied', async () => {
      service.put({
        namespace: 'Edforge/Finance/Sequence',
        metricName: 'BatchReserveAttempts',
        value: 1,
        unit: 'Count',
      });
      await service.flush();
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.MetricData[0].Dimensions).toEqual([]);
    });
  });
});

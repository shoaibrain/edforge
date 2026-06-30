/**
 * SequenceService — Sprint E.1a unit tests
 *
 * Pins the batch-reserve + retry-envelope behavior introduced for the
 * async bulk-invoice-generate worker:
 *
 *   1. `incrementSequenceBy(client, tenantId, schoolId, type, n)` issues
 *      EXACTLY ONE `UpdateCommand` with `ADD :n` (`SET ... + :n`); returns
 *      `{ startValue, endValue }` where `endValue - startValue === n`.
 *   2. ProvisionedThroughputExceededException + sibling throttle classes
 *      retry with jittered backoff (mocked first-2-attempts reject, 3rd
 *      succeeds).
 *   3. After 4 total attempts (1 + 3 retries) the call throws with
 *      schoolId + n + cumulative latency in the message.
 *   4. ConditionalCheckFailedException / ValidationException → throw
 *      immediately (not retried).
 *   5. `n <= 0` or `n > 5000` rejects synchronously before any DDB call.
 *
 * Patterns mirror the rest of the finance test suite (jest.fn()
 * collaborators, Logger spy to silence retry warnings).
 */

import { Logger } from '@nestjs/common';
import { SequenceService } from './sequence.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const SEQ_TYPE = 'INVOICE#2606';

function makeClient(sendImpl: jest.Mock): any {
  return { send: sendImpl };
}

/**
 * Mirror of the `sentInputOf` helper in dynamodb-client.service.spec.ts.
 * Different AWS SDK v3 command versions stash the operator-supplied
 * shape under `.input` vs `.params` vs the command instance itself —
 * be tolerant of all three so this spec doesn't drift on a future
 * SDK bump.
 */
function sentInputOf(cmd: unknown): any {
  return (cmd as any)?.input ?? (cmd as any)?.params ?? cmd;
}

describe('SequenceService.incrementSequenceBy — Sprint E.1a', () => {
  let service: SequenceService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SequenceService();
    logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    jest.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 1. Single atomic UpdateCommand
  // ──────────────────────────────────────────────────────────────────────
  it('issues exactly ONE UpdateCommand with ADD :n and returns the contiguous range', async () => {
    // Pre-existing counter at 100; ADD 25 → new value 125; range is
    // [101, 126) — 25 values reserved.
    const send = jest.fn().mockResolvedValue({ Attributes: { currentValue: 125 } });
    const client = makeClient(send);

    const result = await service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 25);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ startValue: 101, endValue: 126 });

    const updateInput = sentInputOf(send.mock.calls[0][0]);
    expect(updateInput.Key).toEqual({ tenantId: TENANT, entityKey: `SEQUENCE#${SCHOOL}#${SEQ_TYPE}` });
    expect(updateInput.ExpressionAttributeValues[':n']).toBe(25);
    expect(updateInput.UpdateExpression).toContain('+ :n');
    expect(updateInput.ReturnValues).toBe('ALL_NEW');
  });

  it('cold sequence row (no prior currentValue) starts at 1', async () => {
    // if_not_exists fallback to :zero=0 + n=10 → 10; range [1, 11).
    const send = jest.fn().mockResolvedValue({ Attributes: { currentValue: 10 } });
    const client = makeClient(send);

    const result = await service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 10);

    expect(result).toEqual({ startValue: 1, endValue: 11 });
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. Retry-on-throttle
  // ──────────────────────────────────────────────────────────────────────
  it('retries on ProvisionedThroughputExceededException up to the cap', async () => {
    const throttle = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    const send = jest
      .fn()
      .mockRejectedValueOnce(throttle)
      .mockRejectedValueOnce(throttle)
      .mockResolvedValueOnce({ Attributes: { currentValue: 50 } });
    const client = makeClient(send);

    // Fake-timer the retry sleeps so the test runs instantly.
    jest.useFakeTimers();
    const promise = service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 50);
    // Drain the retry backoff timers — three calls = two retry intervals.
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(send).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ startValue: 1, endValue: 51 });
  });

  it('also retries ItemCollectionSizeLimitExceededException and ThrottlingException', async () => {
    const itemColl = Object.assign(new Error('item too big'), {
      name: 'ItemCollectionSizeLimitExceededException',
    });
    const throttling = Object.assign(new Error('throttling'), {
      name: 'ThrottlingException',
    });
    const send = jest
      .fn()
      .mockRejectedValueOnce(itemColl)
      .mockRejectedValueOnce(throttling)
      .mockResolvedValueOnce({ Attributes: { currentValue: 7 } });
    const client = makeClient(send);

    jest.useFakeTimers();
    const promise = service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 7);
    await jest.runAllTimersAsync();
    await promise;

    expect(send).toHaveBeenCalledTimes(3);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. Retry exhaustion
  // ──────────────────────────────────────────────────────────────────────
  it('throws after all 4 attempts (1 + 3 retries) with schoolId + n in the message', async () => {
    const throttle = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    const send = jest.fn().mockRejectedValue(throttle);
    const client = makeClient(send);

    jest.useFakeTimers();
    // Attach a no-op .catch immediately to prevent an
    // "unhandled rejection" warning when the promise rejects before
    // we await it (Jest treats those as test failures even when the
    // later expect().rejects assertion would handle the rejection).
    const promise = service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 100);
    promise.catch(() => undefined);

    // Drain the inter-retry sleeps so the loop hits the 4th and final attempt.
    await jest.runAllTimersAsync();

    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toMatch(/gave up after 4 attempts/);
    expect(message).toContain(SCHOOL);
    expect(message).toContain('n=100');
    expect(send).toHaveBeenCalledTimes(4); // 1 original + 3 retries
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. Non-retryable errors throw immediately
  // ──────────────────────────────────────────────────────────────────────
  it('throws immediately on ConditionalCheckFailedException (no retry)', async () => {
    const ccfe = Object.assign(new Error('CCFE'), {
      name: 'ConditionalCheckFailedException',
    });
    const send = jest.fn().mockRejectedValue(ccfe);
    const client = makeClient(send);

    await expect(
      service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 1),
    ).rejects.toBe(ccfe);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on ValidationException (no retry)', async () => {
    const validation = Object.assign(new Error('bad shape'), {
      name: 'ValidationException',
    });
    const send = jest.fn().mockRejectedValue(validation);
    const client = makeClient(send);

    await expect(
      service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 1),
    ).rejects.toBe(validation);

    expect(send).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. Input validation
  // ──────────────────────────────────────────────────────────────────────
  it.each([0, -1, -100, 0.5, NaN, Infinity])(
    'rejects synchronously for invalid n=%p without any DDB call',
    async (n) => {
      const send = jest.fn();
      const client = makeClient(send);

      await expect(
        service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, n as number),
      ).rejects.toThrow(/must be a positive integer/);

      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects synchronously when n > MAX_BATCH_RESERVE (5000)', async () => {
    const send = jest.fn();
    const client = makeClient(send);

    await expect(
      service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 5001),
    ).rejects.toThrow(/exceeds MAX_BATCH_RESERVE/);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('SequenceService.formatInvoiceNumber + getInvoiceSequenceType helpers', () => {
  let service: SequenceService;
  beforeEach(() => {
    service = new SequenceService();
  });

  it('formatInvoiceNumber pads the sequence to 4 digits and uses default schoolId prefix', () => {
    const formatted = service.formatInvoiceNumber(SCHOOL, 42);
    // Default prefix = first 3 chars of SCHOOL uppercased = "222"
    expect(formatted).toMatch(/^INV-222-\d{4}-0042$/);
  });

  it('formatInvoiceNumber honors explicit schoolPrefix', () => {
    const formatted = service.formatInvoiceNumber(SCHOOL, 7, 'ACD');
    expect(formatted).toMatch(/^INV-ACD-\d{4}-0007$/);
  });

  it('getInvoiceSequenceType returns INVOICE#{YYMM}', () => {
    const seqType = service.getInvoiceSequenceType();
    expect(seqType).toMatch(/^INVOICE#\d{4}$/);
  });
});

// ============================================================================
// Issues #344 + #345 — FinanceMetricsService emission contract
//
// SequenceService.incrementSequenceBy MUST emit 3 metrics per successful
// call: BatchReserveCount (=n), BatchReserveLatencyMs (elapsed), and
// BatchReserveAttempts (attempt count). The Edforge/Finance/Sequence
// dashboard widget reads these; the alarm fires on
// BatchReserveLatencyMs.p95 > 500ms. Regression here = silent
// observability gap in prod.
// ============================================================================
describe('SequenceService.incrementSequenceBy — #344 metrics emission', () => {
  let service: SequenceService;
  let metricsPut: jest.Mock;

  beforeEach(() => {
    metricsPut = jest.fn();
    // Construct with a stubbed FinanceMetricsService — just need the
    // `.put()` method since SequenceService's only call surface on it
    // is `put(...)`.
    const fakeMetrics = { put: metricsPut } as any;
    service = new SequenceService(fakeMetrics);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits BatchReserveCount + BatchReserveLatencyMs (dimensioned + no-dim companion) + BatchReserveAttempts on a successful first-attempt call', async () => {
    const send = jest.fn().mockResolvedValue({ Attributes: { currentValue: 100 } });
    const client = makeClient(send);

    await service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 50);

    // 4 emits per logical call: Count, dimensioned Latency,
    // NO-DIMENSION Latency companion (round-2 — alarm reads this
    // because CloudWatch Metric Alarms reject SEARCH expressions),
    // and Attempts.
    expect(metricsPut).toHaveBeenCalledTimes(4);
    const metricsCalled = metricsPut.mock.calls.map((c) => c[0].metricName);
    expect(metricsCalled.sort()).toEqual([
      'BatchReserveAttempts',
      'BatchReserveCount',
      'BatchReserveLatencyMs', // dimensioned
      'BatchReserveLatencyMs', // no-dim companion (alarm reads this)
    ]);

    // Latency emitted TWICE: once with {schoolId, sequenceType}
    // dimensions (dashboard SEARCH), once without (alarm).
    const latencyCalls = metricsPut.mock.calls.filter(
      (c) => c[0].metricName === 'BatchReserveLatencyMs',
    );
    expect(latencyCalls).toHaveLength(2);
    const dimensionedLatency = latencyCalls.find((c) => c[0].dimensions !== undefined);
    const noDimLatency = latencyCalls.find((c) => c[0].dimensions === undefined);
    expect(dimensionedLatency).toBeDefined();
    expect(dimensionedLatency?.[0].dimensions).toEqual({
      schoolId: SCHOOL,
      sequenceType: SEQ_TYPE,
    });
    expect(noDimLatency).toBeDefined();
    // Both carry the same value (same wall-clock measurement).
    expect(dimensionedLatency?.[0].value).toBe(noDimLatency?.[0].value);
    // Both carry namespace + unit, but only the dimensioned one has dimensions.
    expect(noDimLatency?.[0].namespace).toBe('Edforge/Finance/Sequence');
    expect(noDimLatency?.[0].unit).toBe('Milliseconds');

    // Count metric carries the exact `n` from the call — a regression
    // to per-student reservation would show as n=1 instead of n=50.
    const countCall = metricsPut.mock.calls.find(
      (c) => c[0].metricName === 'BatchReserveCount',
    )?.[0];
    expect(countCall).toBeDefined();
    expect(countCall.value).toBe(50);
    expect(countCall.unit).toBe('Count');
    expect(countCall.namespace).toBe('Edforge/Finance/Sequence');
    expect(countCall.dimensions).toEqual({
      schoolId: SCHOOL,
      sequenceType: SEQ_TYPE,
    });

    // Attempts metric on a clean first call = 1 (no retry).
    const attemptsCall = metricsPut.mock.calls.find(
      (c) => c[0].metricName === 'BatchReserveAttempts',
    )?.[0];
    expect(attemptsCall.value).toBe(1);
  });

  it('does NOT emit metrics on retry-then-success (only emits ONCE per logical call, with attempts=N)', async () => {
    // Pre-fix incorrect emit-per-attempt would double/triple-count
    // BatchReserveCount on a single job — the dashboard would over-
    // report invoice counts. This spec pins one-emit-per-logical-call.
    const throttle = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    const send = jest
      .fn()
      .mockRejectedValueOnce(throttle)
      .mockResolvedValueOnce({ Attributes: { currentValue: 100 } });
    const client = makeClient(send);

    jest.useFakeTimers();
    const promise = service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 10);
    await jest.advanceTimersByTimeAsync(500);
    await promise;
    jest.useRealTimers();

    // 4 emits per logical call (Count + 2× Latency + Attempts),
    // not 4 × 2 attempts.
    expect(metricsPut).toHaveBeenCalledTimes(4);
    const attemptsCall = metricsPut.mock.calls.find(
      (c) => c[0].metricName === 'BatchReserveAttempts',
    )?.[0];
    expect(attemptsCall.value).toBe(2); // succeeded on attempt 2
  });

  it('does NOT emit metrics when the call THROWS (no half-truth metrics on real failure)', async () => {
    // 4 throttles → exhausts the retry budget → throws. Emitting
    // metrics on the failure path would mis-attribute the latency to
    // a successful call, polluting the p95.
    const throttle = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    const send = jest.fn().mockRejectedValue(throttle);
    const client = makeClient(send);

    jest.useFakeTimers();
    // Attach the rejects-assertion BEFORE advancing timers so the
    // rejection isn't seen as unhandled. `expect().rejects` returns
    // a promise we await after the timers drain.
    const rejection = expect(
      service.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 7),
    ).rejects.toThrow(/gave up after 4 attempts/);
    await jest.advanceTimersByTimeAsync(20_000);
    await rejection;
    jest.useRealTimers();

    expect(metricsPut).not.toHaveBeenCalled();
  });

  it('still works when constructed WITHOUT a metrics service (back-compat for legacy callers)', async () => {
    // The constructor's metrics arg is optional. Existing specs that
    // do `new SequenceService()` (no DI) must continue to work; the
    // emit calls become no-ops via `this.metrics?.put(...)`.
    const noMetricsService = new SequenceService();
    const send = jest.fn().mockResolvedValue({ Attributes: { currentValue: 50 } });
    const client = makeClient(send);

    await expect(
      noMetricsService.incrementSequenceBy(client, TENANT, SCHOOL, SEQ_TYPE, 10),
    ).resolves.toEqual({ startValue: 41, endValue: 51 });
  });
});

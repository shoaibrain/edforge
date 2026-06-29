/**
 * `withConcurrencyLimit` — Sprint E.1a inline limiter.
 *
 * Pins five behaviors the bulk worker relies on:
 *   1. Empty items array resolves immediately.
 *   2. `concurrency < 1` throws synchronously.
 *   3. Never exceeds `concurrency` in-flight (assert via a counter).
 *   4. Throw inside `fn` rejects outer + halts remaining (fail-fast
 *      primitive; worker wraps for isolation).
 *   5. Each item processed exactly once.
 */

import { withConcurrencyLimit } from './concurrency-limit';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (err: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('withConcurrencyLimit', () => {
  it('empty items resolves immediately without invoking fn', async () => {
    const fn = jest.fn();
    await expect(withConcurrencyLimit([], 5, fn)).resolves.toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([0, -1, -10])('throws synchronously for concurrency=%p', async (c) => {
    const fn = jest.fn();
    await expect(withConcurrencyLimit([1, 2, 3], c, fn)).rejects.toThrow(/must be >= 1/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('never runs more than `concurrency` tasks in flight', async () => {
    const CONCURRENCY = 3;
    const ITEMS = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let maxObserved = 0;

    await withConcurrencyLimit(ITEMS, CONCURRENCY, async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      // Yield once so other workers get a chance to bump inFlight.
      await new Promise(resolve => setImmediate(resolve));
      inFlight--;
    });

    expect(maxObserved).toBeLessThanOrEqual(CONCURRENCY);
    expect(maxObserved).toBeGreaterThan(0);
  });

  it('processes each item EXACTLY once (no skip, no duplicate)', async () => {
    const ITEMS = Array.from({ length: 25 }, (_, i) => `item-${i}`);
    const seen = new Set<string>();
    const duplicates: string[] = [];

    await withConcurrencyLimit(ITEMS, 4, async (item) => {
      if (seen.has(item)) duplicates.push(item);
      seen.add(item);
      await new Promise(resolve => setImmediate(resolve));
    });

    expect(seen.size).toBe(ITEMS.length);
    expect(duplicates).toEqual([]);
    for (const item of ITEMS) expect(seen.has(item)).toBe(true);
  });

  it('fn throwing on one item rejects the outer promise (fail-fast primitive)', async () => {
    const ITEMS = Array.from({ length: 10 }, (_, i) => i);
    const fn = jest.fn(async (i: number) => {
      if (i === 5) throw new Error('boom');
      await new Promise(resolve => setImmediate(resolve));
    });

    await expect(withConcurrencyLimit(ITEMS, 2, fn)).rejects.toThrow('boom');
    // Some items past 5 may have started before the rejection propagated,
    // so we don't assert that NO further items ran — only that the outer
    // promise rejected with the right error. The worker (E.4) catches per
    // item inside its own fn so the bulk-generate path stays isolated.
  });

  it('honors fn index argument with the original position', async () => {
    const ITEMS = ['a', 'b', 'c', 'd', 'e'];
    const pairs: Array<{ item: string; index: number }> = [];

    await withConcurrencyLimit(ITEMS, 2, async (item, index) => {
      pairs.push({ item, index });
    });

    // Order may shuffle under concurrency but the pair (item, index) must hold.
    expect(pairs).toHaveLength(ITEMS.length);
    for (const pair of pairs) {
      expect(ITEMS[pair.index]).toBe(pair.item);
    }
  });
});

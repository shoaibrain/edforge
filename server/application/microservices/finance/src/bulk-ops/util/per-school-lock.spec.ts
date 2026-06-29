/**
 * PerSchoolLock — Sprint E.2 unit tests.
 *
 * Five pinned behaviors:
 *   1. Two acquires for the SAME schoolId serialize.
 *   2. Two acquires for DIFFERENT schoolIds run in parallel.
 *   3. `release()` is idempotent.
 *   4. After all waiters release, the Map entry is cleaned up.
 *   5. A long chain (3+ acquires) serializes in FIFO order.
 */

import { PerSchoolLock } from './per-school-lock';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('PerSchoolLock', () => {
  let lock: PerSchoolLock;

  beforeEach(() => {
    lock = new PerSchoolLock();
  });

  it('two acquires for the same schoolId serialize', async () => {
    const events: string[] = [];

    const first = await lock.acquire(SCHOOL_A);
    events.push('first:acquired');

    // Don't await the second acquire yet — kick it off.
    const secondPromise = lock.acquire(SCHOOL_A).then((h) => {
      events.push('second:acquired');
      return h;
    });

    // Yield to allow secondPromise's async chain to run; it must NOT
    // have acquired yet because we haven't released the first.
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual(['first:acquired']);

    first.release();
    events.push('first:released');

    const second = await secondPromise;
    expect(events).toEqual(['first:acquired', 'first:released', 'second:acquired']);

    second.release();
  });

  it('two acquires for DIFFERENT schoolIds run in parallel', async () => {
    const events: string[] = [];

    // Acquire both. Both should resolve immediately because no contention.
    const [a, b] = await Promise.all([
      lock.acquire(SCHOOL_A).then((h) => { events.push('A'); return h; }),
      lock.acquire(SCHOOL_B).then((h) => { events.push('B'); return h; }),
    ]);

    expect(events.length).toBe(2);
    expect(new Set(events)).toEqual(new Set(['A', 'B']));

    a.release();
    b.release();
  });

  it('release() is idempotent — second + third calls are no-ops', async () => {
    const handle = await lock.acquire(SCHOOL_A);
    handle.release();
    handle.release();
    handle.release();

    // Map should be empty (no waiters).
    expect(lock.size()).toBe(0);

    // A fresh acquire works.
    const fresh = await lock.acquire(SCHOOL_A);
    fresh.release();
    expect(lock.size()).toBe(0);
  });

  it('cleans up the Map entry after last waiter releases', async () => {
    expect(lock.size()).toBe(0);
    const a = await lock.acquire(SCHOOL_A);
    expect(lock.size()).toBe(1);
    a.release();
    expect(lock.size()).toBe(0);

    // After serial reuse — still 0 entries when no holder.
    const b = await lock.acquire(SCHOOL_A);
    const c = await lock.acquire(SCHOOL_B);
    expect(lock.size()).toBe(2);
    b.release();
    c.release();
    expect(lock.size()).toBe(0);
  });

  it('FIFO order for a 3-deep chain on the same schoolId', async () => {
    const events: number[] = [];

    const first = await lock.acquire(SCHOOL_A);
    events.push(1);

    const second = lock.acquire(SCHOOL_A).then((h) => { events.push(2); return h; });
    const third = lock.acquire(SCHOOL_A).then((h) => { events.push(3); return h; });

    // Neither has acquired yet (first is holding).
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual([1]);

    first.release();
    const secondHandle = await second;
    expect(events).toEqual([1, 2]);

    secondHandle.release();
    const thirdHandle = await third;
    expect(events).toEqual([1, 2, 3]);

    thirdHandle.release();
    expect(lock.size()).toBe(0);
  });
});

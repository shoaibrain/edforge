/**
 * Inline concurrency limiter — Sprint E.1a
 *
 * Drain `items` through `fn`, executing at most `concurrency` in flight.
 * No external dependency — finance is the payment-handling service and
 * every dep is a permanent supply-chain commitment (operator decision 4
 * on the Sprint E plan). This is functionally equivalent to the
 * `p-limit` library's queue-then-spawn pattern (Sindre Sorhus, MIT)
 * but kept inline.
 *
 * Errors thrown by `fn` reject this function's returned promise — the
 * shared queue stops draining and remaining items are NOT processed.
 * Callers that want per-item failure isolation MUST catch inside `fn`
 * (the worker wraps individually for this reason; the primitive
 * itself stays fail-fast).
 *
 * Semantics:
 *   - Empty `items` → resolves immediately.
 *   - `concurrency < 1` → throws (programming error).
 *   - Workers count is `min(concurrency, items.length)` — no point
 *     spinning more workers than there is work.
 *   - Each item processed exactly once (workers share a single queue;
 *     `shift()` is atomic in single-threaded JS).
 */

export async function withConcurrencyLimit<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  if (concurrency < 1) {
    throw new Error(`withConcurrencyLimit: concurrency must be >= 1; got ${concurrency}`);
  }

  // Snapshot index alongside the item so callers can refer back to the
  // original position even after the queue has been shifted.
  const queue: Array<{ item: T; index: number }> = items.map((item, index) => ({ item, index }));

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) return;
        await fn(next.item, next.index);
      }
    },
  );

  await Promise.all(workers);
}

/**
 * retryWithJitter — Sprint E.4
 *
 * Small jittered-backoff wrapper for the per-student generate path
 * inside `BulkInvoiceGenerateWorker`. Mirrors the shape of
 * `DynamoDBClientService.batchWriteItems` retry envelope but is
 * lighter-weight (no batched-write semantics, just attempt-and-retry).
 *
 * Two transient classes we want to retry inside the per-student loop:
 *   - `TransactionCanceledException` (TransactWriteItems lost a
 *     condition race — billing-account or invoice version drifted
 *     under us; a re-fetch + retry is the right move).
 *   - `ProvisionedThroughputExceededException` (transient DDB pressure;
 *     the same backoff that `incrementSequenceBy` uses on the
 *     reservation path is appropriate here for the per-row writes).
 *
 * Everything else throws immediately — real errors (NotFoundException,
 * BadRequestException, etc.) MUST surface fast so the worker logs them
 * against the right student and moves on.
 */

export interface RetryOptions {
  attempts: number; // total attempts including the original (so attempts=3 means 1 + 2 retries)
  shouldRetry: (err: unknown) => boolean;
  baseMs?: number;
}

export function isTransactionCanceledOrThroughputExceeded(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  return (
    name === 'TransactionCanceledException' ||
    name === 'ProvisionedThroughputExceededException' ||
    name === 'ItemCollectionSizeLimitExceededException' ||
    name === 'ThrottlingException'
  );
}

/**
 * Predicate for the `FinanceJobsService` read-modify-write retry path
 * (PR #341 review F1). Nest's `ConflictException` is what
 * `DynamoDBClientService.updateItem` raises when a version-guarded
 * UpdateItem loses the conditional-check race — exactly the case the
 * read-modify-write helpers (`appendFailedStudent`, `incrementCounter`)
 * need to refetch + retry. Matches by status code (409) to stay decoupled
 * from the Nest exception import in this util module.
 */
export function isConflictException(err: unknown): boolean {
  const status = (err as { status?: number; getStatus?: () => number })?.status;
  if (status === 409) return true;
  const getStatus = (err as { getStatus?: () => number })?.getStatus;
  if (typeof getStatus === 'function') {
    try {
      return getStatus.call(err) === 409;
    } catch {
      return false;
    }
  }
  return false;
}

export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const baseMs = options.baseMs ?? 50;
  let lastErr: unknown;

  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!options.shouldRetry(err)) throw err;
      if (attempt === options.attempts - 1) break;
      // Jittered exponential: base * 2^attempt ±50% jitter. With
      // base=50: 50, 100, 200, 400 ... (±50%).
      const delay = Math.round(
        baseMs * Math.pow(2, attempt) + Math.random() * baseMs * Math.pow(2, attempt),
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

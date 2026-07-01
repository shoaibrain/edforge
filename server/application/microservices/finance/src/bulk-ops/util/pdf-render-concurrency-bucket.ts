/**
 * PdfRenderConcurrencyBucket — Sprint §5d MVP.5 S5 / Sprint F.3
 *
 * Process-wide singleton semaphore that caps total in-flight PDF
 * renders across ALL concurrent bulk-export jobs running in the same
 * ECS task. Enforces the operator-set `BULK_PDF_CONCURRENCY=40` cap
 * (MVP.2) WITHOUT becoming per-job — two concurrent bulk-export jobs
 * for different schools (PerSchoolLock only serializes same-school)
 * share this bucket.
 *
 * Without this bucket, `withConcurrencyLimit(items, 40, fn)` called
 * twice from two concurrent worker `run()` invocations would spin 80
 * total in-flight renders (40 per job × 2 jobs) — defeating the cap
 * and pushing the task toward OOM (each in-flight render holds a
 * ~20-40KB PDF buffer plus pdfkit's working state).
 *
 * Contract:
 *   - `getLimit()` returns the resolved process-wide cap (env-driven,
 *      Math.min(40, Math.max(1, parsed))).
 *   - `acquire()` returns a release-handle Promise. If a slot is free,
 *      resolves synchronously. Otherwise FIFO-queues until a slot
 *      releases. Callers MUST call the returned release fn (use try/
 *      finally) — failing to release deadlocks future acquires.
 *
 * Same semaphore shape as PerSchoolLock (Sprint E.2) but keyed by a
 * single slot pool instead of per-key. Released via the returned
 * handle so the contract is symmetric with PerSchoolLock and the
 * acquire-then-release try/finally pattern is idiomatic across the
 * bulk-ops module.
 *
 * Nest DI: provided as a singleton at BulkOperationsModule scope. All
 * worker injections receive the SAME instance — that's the source of
 * the "process-wide" property.
 */

import { Injectable, Logger } from '@nestjs/common';

const ENV_NAME = 'BULK_PDF_CONCURRENCY';
const HARD_MAX = 40;
const HARD_MIN = 1;
// P2 (issue #364) — default dropped from 40 → 8. On the current 1-vCPU
// finance ECS task, Node.js runs only one render at a time on the JS
// thread; concurrency > 1 only buys I/O overlap (S3, DDB, identity).
// At 8, an 800-invoice batch completes in ~20s on 1 vCPU while leaving
// the event loop responsive enough for the API GW 29s integration
// timeout on incoming HTTP. Going higher (16, 40) risks the event-loop
// starvation → second-submission 504 documented in issue #364.
// HARD_MAX=40 kept as an operator escape hatch via env override.
const DEFAULT_VALUE = 8;

export interface PdfRenderSlotHandle {
  /** Release the slot. Safe to call multiple times — subsequent calls are no-ops. */
  release(): void;
}

@Injectable()
export class PdfRenderConcurrencyBucket {
  private readonly logger = new Logger(PdfRenderConcurrencyBucket.name);
  private readonly limit: number;
  private available: number;
  /** FIFO queue of waiters; each is a resolver that grants the slot when invoked. */
  private readonly waiters: Array<(handle: PdfRenderSlotHandle) => void> = [];

  constructor() {
    const raw = parseInt(process.env[ENV_NAME] ?? String(DEFAULT_VALUE), 10);
    const parsed = Number.isFinite(raw) ? raw : DEFAULT_VALUE;
    this.limit = Math.min(HARD_MAX, Math.max(HARD_MIN, parsed));
    this.available = this.limit;
    this.logger.log(
      `PdfRenderConcurrencyBucket initialized: limit=${this.limit} ` +
        `(env=${process.env[ENV_NAME] ?? '(unset; default ' + DEFAULT_VALUE + ')'}, ` +
        `hardMax=${HARD_MAX}, hardMin=${HARD_MIN})`,
    );
  }

  /** Resolved process-wide concurrency cap. */
  getLimit(): number {
    return this.limit;
  }

  /** Number of slots currently available (diagnostic; not for runtime decisions). */
  available_(): number {
    return this.available;
  }

  /** FIFO queue depth (diagnostic). */
  waitersCount_(): number {
    return this.waiters.length;
  }

  /**
   * Acquire one slot. Resolves with a handle whose `release()` MUST be
   * called when the caller is done (use try/finally). If a slot is
   * available, resolves synchronously; otherwise FIFO-queues.
   */
  async acquire(): Promise<PdfRenderSlotHandle> {
    if (this.available > 0) {
      this.available--;
      return this.makeHandle();
    }
    return new Promise<PdfRenderSlotHandle>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private makeHandle(): PdfRenderSlotHandle {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (this.waiters.length > 0) {
          // Pop the next waiter and grant it the slot we just released.
          // Don't increment `available` — the slot transfers directly.
          const next = this.waiters.shift()!;
          next(this.makeHandle());
        } else {
          this.available++;
        }
      },
    };
  }
}

/**
 * PerSchoolLock — Sprint E.2
 *
 * In-memory `Map<schoolId, Promise<void>>` lock keyed by school. Two
 * concurrent `acquire(schoolId)` calls for the SAME school serialize
 * (the second's promise resolves only after the first's `release()`).
 * Two acquires for DIFFERENT schools run in parallel.
 *
 * Scope: per ECS task. The lock is in-memory and does NOT survive
 * task restarts or coordinate across multiple ECS tasks. That's by
 * design — V1 pilot scale is single-task; the lock protects against
 * the in-task collision (operator hammers Submit twice before the
 * 202 returns, OR the worker is re-queued mid-run). Cross-task
 * coordination is a future hardening (DDB conditional row or a
 * Redis-class lock); pilot scope is OK with the in-task gate.
 *
 * The lock cleans itself up after the last waiter for a school
 * releases — the map entry is removed so the next acquire for that
 * school starts cold. This keeps the Map size proportional to active
 * concurrent schools, not historical school count.
 *
 * Idempotent release: calling `release()` more than once is a no-op
 * (defensive against finally-block double-release on error paths).
 */

import { Injectable, Logger } from '@nestjs/common';

export interface SchoolLockHandle {
  /**
   * Release the lock. Safe to call multiple times — subsequent calls
   * are no-ops.
   */
  release(): void;
}

@Injectable()
export class PerSchoolLock {
  private readonly logger = new Logger(PerSchoolLock.name);
  /**
   * Map of schoolId → promise that resolves when the most recent
   * holder releases. New acquires chain onto this promise.
   */
  private readonly locks = new Map<string, Promise<void>>();

  /**
   * Acquire the lock for `schoolId`. Resolves to a handle once the
   * caller is the active holder. Returned handle's `release()` MUST
   * be called (use try/finally) — failing to release blocks every
   * future acquire for this schoolId in this task.
   */
  async acquire(schoolId: string): Promise<SchoolLockHandle> {
    const previous = this.locks.get(schoolId);

    let resolveSelf!: () => void;
    const selfPromise = new Promise<void>((resolve) => {
      resolveSelf = resolve;
    });

    // Register our promise as the new tail. The previous tail (if any)
    // is the predecessor we wait for; once we release, the next acquire
    // chains onto US.
    this.locks.set(schoolId, selfPromise);

    if (previous) {
      // Wait for the previous holder to release before we claim the lock.
      await previous;
    }

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        resolveSelf();
        // If WE are still the tail (no later acquire chained on), drop
        // the entry so the next acquire starts cold. If a later acquire
        // has replaced us as the tail, leave the entry — they own it now.
        if (this.locks.get(schoolId) === selfPromise) {
          this.locks.delete(schoolId);
        }
      },
    };
  }

  /**
   * Diagnostic — number of schools with an active lock. Used by tests
   * to assert cleanup; not part of the runtime contract.
   */
  size(): number {
    return this.locks.size;
  }
}

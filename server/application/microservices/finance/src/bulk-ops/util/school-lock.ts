import type { RequestContext } from '../../common/entities/base.entity';

/**
 * Cost-redesign C3.6 — the per-school job lock behind one interface.
 *
 * `PerSchoolLock` (in-memory, one ECS task) and `DdbSchoolLock` (DynamoDB,
 * any number of worker invocations) both implement it; `SCHOOL_LOCK` is
 * resolved by `JOBS_TRANSPORT` in the bulk-ops module, so the workers do not
 * know which one they hold.
 */
export interface SchoolLockAcquireOptions {
  /** The job that will own the lock (DynamoDB: the `owner` attribute; the heartbeat and release are conditioned on it). */
  owner?: string;
  /** Tenant-scoped credentials for the lock row (DynamoDB only). */
  context?: RequestContext;
}

export interface SchoolLockHandle {
  /** Idempotent. `await` it: the DynamoDB release is a network call. */
  release(): void | Promise<void>;
  /** Fencing token (DynamoDB only): every job-row transition after the claim is conditioned on it. */
  readonly fence?: number;
}

export interface SchoolLock {
  acquire(schoolId: string, options?: SchoolLockAcquireOptions): Promise<SchoolLockHandle>;
}

export const SCHOOL_LOCK = Symbol('SCHOOL_LOCK');

/** Another job holds the school's lock and the wait budget ran out. Workers rethrow it: the job is not failed, the message is retried. */
export class SchoolLockBusyError extends Error {
  constructor(public readonly schoolId: string, public readonly holder?: string) {
    super(`school ${schoolId} is locked${holder ? ` by job ${holder}` : ''}`);
    this.name = 'SchoolLockBusyError';
  }
}

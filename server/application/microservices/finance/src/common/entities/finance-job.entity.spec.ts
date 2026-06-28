/**
 * FinanceJob entity helpers — Sprint D.1.
 *
 * Locks down the shape regressions that TypeScript can't catch:
 *   - `createFinanceJobEntity` row layout (PK/SK + entityType discriminator
 *     + counters init) is consumed by both the worker (Sprint E+) and the
 *     polling GET endpoint. A regression here is invisible to `tsc` but
 *     immediately breaks polling.
 *   - `capErrors` cap is the defense against the DDB 400 KB row limit
 *     under a sustained failure mode; if it accidentally passes the full
 *     array through, a runaway job could blow the row size and the
 *     finalizing `markFailed` would itself fail.
 *   - `capFailedStudents` cap + dedupe is what the "Retry failed only"
 *     UX depends on — duplicates would cause the operator's re-submit to
 *     count the same student twice.
 *   - `EntityKeyBuilder.financeJob(jobId)` SK shape is what every
 *     lifecycle method UpdateItem's against; a regression breaks every
 *     transition silently.
 */

import { EntityKeyBuilder } from './base.entity';
import {
  capErrors,
  capFailedStudents,
  createFinanceJobEntity,
  type FinanceJobError,
} from './finance-job.entity';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const OPERATOR = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

describe('finance-job.entity', () => {
  describe('EntityKeyBuilder.financeJob', () => {
    it('returns FINANCE_JOB#{jobId}', () => {
      expect(EntityKeyBuilder.financeJob(JOB_ID)).toBe(`FINANCE_JOB#${JOB_ID}`);
    });
  });

  describe('createFinanceJobEntity', () => {
    it('returns a row in the queued state with counters initialized', () => {
      const entity = createFinanceJobEntity(TENANT, JOB_ID, {
        schoolId: SCHOOL,
        operatorId: OPERATOR,
        jobType: 'bulk_invoice_generate',
        requested: 240,
      });

      expect(entity.tenantId).toBe(TENANT);
      expect(entity.entityKey).toBe(`FINANCE_JOB#${JOB_ID}`);
      expect(entity.entityType).toBe('FINANCE_JOB');
      expect(entity.jobId).toBe(JOB_ID);
      expect(entity.schoolId).toBe(SCHOOL);
      expect(entity.operatorId).toBe(OPERATOR);
      expect(entity.jobType).toBe('bulk_invoice_generate');
      expect(entity.status).toBe('queued');
      expect(entity.counters).toEqual({
        requested: 240,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      expect(entity.outputFormat).toBeNull();
      expect(entity.failedStudentIds).toEqual([]);
      expect(entity.errors).toEqual([]);
      expect(entity.idempotencyKey).toBeUndefined();
      expect(entity.startedAt).toBeUndefined();
      expect(entity.completedAt).toBeUndefined();
      expect(entity.version).toBe(1);
      expect(entity.createdBy).toBe(OPERATOR);
      expect(entity.updatedBy).toBe(OPERATOR);
      // createdAt + updatedAt set to the same instant
      expect(entity.createdAt).toBe(entity.updatedAt);
      // ISO-8601 round-trip
      expect(() => new Date(entity.createdAt).toISOString()).not.toThrow();
    });

    it('plumbs outputFormat through for pdf-export jobs', () => {
      const entity = createFinanceJobEntity(TENANT, JOB_ID, {
        schoolId: SCHOOL,
        operatorId: OPERATOR,
        jobType: 'bulk_invoice_pdf_export',
        requested: 86,
        outputFormat: 'zip',
      });
      expect(entity.outputFormat).toBe('zip');
      expect(entity.jobType).toBe('bulk_invoice_pdf_export');
    });

    it('plumbs idempotencyKey through when supplied', () => {
      const KEY = '99999999-9999-4999-8999-999999999999';
      const entity = createFinanceJobEntity(TENANT, JOB_ID, {
        schoolId: SCHOOL,
        operatorId: OPERATOR,
        jobType: 'bulk_invoice_generate',
        requested: 10,
        idempotencyKey: KEY,
      });
      expect(entity.idempotencyKey).toBe(KEY);
    });
  });

  describe('capErrors', () => {
    function err(i: number): { at: string; message: string } {
      return { at: `2026-06-28T00:00:${String(i).padStart(2, '0')}Z`, message: `e${i}` };
    }

    it('appends a single error to an empty list', () => {
      const out = capErrors(undefined, err(1));
      expect(out).toHaveLength(1);
      expect(out[0].message).toBe('e1');
    });

    it('handles existing list passed as empty array', () => {
      const out = capErrors([], err(1));
      expect(out).toHaveLength(1);
    });

    it('keeps the last 200 entries when over cap', () => {
      // Seed with 300 — capErrors appends ONE per call so seed via reduce.
      let acc: FinanceJobError[] = [];
      for (let i = 1; i <= 300; i++) acc = capErrors(acc, err(i));
      expect(acc).toHaveLength(200);
      // Oldest 100 dropped; first surviving entry is e101
      expect(acc[0].message).toBe('e101');
      expect(acc[199].message).toBe('e300');
    });

    it('truncates a very long error message to 500 chars', () => {
      const longMsg = 'x'.repeat(2000);
      const out = capErrors([], { at: '2026-06-28T00:00:00Z', message: longMsg });
      expect(out[0].message).toHaveLength(500);
    });

    it('preserves order chronologically when below cap', () => {
      let acc: FinanceJobError[] = [];
      for (let i = 1; i <= 5; i++) acc = capErrors(acc, err(i));
      expect(acc.map((e) => e.message)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    });
  });

  describe('capFailedStudents', () => {
    it('appends new IDs to an empty list', () => {
      const out = capFailedStudents(undefined, ['a', 'b']);
      expect(out).toEqual(['a', 'b']);
    });

    it('dedupes IDs that already exist in the list (last-wins ordering)', () => {
      // Existing 'a' → re-fail 'a' → 'a' moves to latest position
      const out = capFailedStudents(['a', 'b'], ['a', 'c']);
      expect(out).toEqual(['b', 'a', 'c']);
    });

    it('caps at 500 keeping the latest entries', () => {
      const seed = Array.from({ length: 400 }, (_, i) => `s${i}`);
      const more = Array.from({ length: 200 }, (_, i) => `s${1000 + i}`);
      const out = capFailedStudents(seed, more);
      expect(out).toHaveLength(500);
      // Total before cap: 400 seed + 200 new = 600. Cap keeps the last
      // 500, so the oldest 100 from the seed are dropped.
      // Surviving layout: s100..s399 (300 items) then s1000..s1199 (200 items).
      expect(out[0]).toBe('s100');
      expect(out[299]).toBe('s399');
      expect(out[300]).toBe('s1000');
      expect(out[499]).toBe('s1199');
    });

    it('handles batch with internal duplicates (last occurrence wins)', () => {
      const out = capFailedStudents([], ['a', 'b', 'a', 'c']);
      // 'a' appears twice — keep last position.
      expect(out).toEqual(['b', 'a', 'c']);
    });

    it('handles empty newIds (no-op + dedupe of existing)', () => {
      const out = capFailedStudents(['a', 'b', 'a'], []);
      // existing has internal dup → dedupe last-wins
      expect(out).toEqual(['b', 'a']);
    });

    it('boundary: exactly 500 — NOT truncated', () => {
      const seed = Array.from({ length: 500 }, (_, i) => `s${i}`);
      const out = capFailedStudents([], seed);
      expect(out).toHaveLength(500);
      expect(out[0]).toBe('s0');
      expect(out[499]).toBe('s499');
    });
  });
});

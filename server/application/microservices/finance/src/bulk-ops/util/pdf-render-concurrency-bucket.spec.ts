/**
 * PdfRenderConcurrencyBucket unit tests — Sprint §5d MVP.5 S5 / F.3.
 *
 * Pinned behaviors:
 *   - env-driven init: parses BULK_PDF_CONCURRENCY, applies floor 1 /
 *     ceiling 40 / default 40 / NaN-safe.
 *   - acquire() resolves synchronously when slots available; queues FIFO
 *     when exhausted; transfers slot directly to queued waiter on release
 *     (no double-increment).
 *   - release() is idempotent (safe to call twice from defensive finally).
 */

import { PdfRenderConcurrencyBucket } from './pdf-render-concurrency-bucket';

describe('PdfRenderConcurrencyBucket', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('env-driven init', () => {
    it('defaults to 40 when env unset', () => {
      delete process.env.BULK_PDF_CONCURRENCY;
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(40);
    });

    it('honors a valid env value within bounds', () => {
      process.env.BULK_PDF_CONCURRENCY = '8';
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(8);
    });

    it('caps to hard max 40 even if env exceeds', () => {
      process.env.BULK_PDF_CONCURRENCY = '1000';
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(40);
    });

    it('floors to hard min 1 if env is 0 or negative', () => {
      process.env.BULK_PDF_CONCURRENCY = '0';
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(1);
      process.env.BULK_PDF_CONCURRENCY = '-5';
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(1);
    });

    it('falls back to default on NaN (e.g., env="abc")', () => {
      process.env.BULK_PDF_CONCURRENCY = 'abc';
      expect(new PdfRenderConcurrencyBucket().getLimit()).toBe(40);
    });
  });

  describe('acquire / release', () => {
    it('grants slots synchronously up to limit; queues after', async () => {
      process.env.BULK_PDF_CONCURRENCY = '3';
      const bucket = new PdfRenderConcurrencyBucket();

      const h1 = await bucket.acquire();
      const h2 = await bucket.acquire();
      const h3 = await bucket.acquire();
      expect(bucket.available_()).toBe(0);

      // 4th acquire MUST queue
      let h4: any = null;
      const h4Promise = bucket.acquire().then((h) => (h4 = h));
      await new Promise((r) => setImmediate(r));
      expect(h4).toBeNull();
      expect(bucket.waitersCount_()).toBe(1);

      // Release one — h4 should now grant
      h1.release();
      await h4Promise;
      expect(h4).not.toBeNull();
      expect(bucket.waitersCount_()).toBe(0);

      // h1 was released, then transferred directly to h4 — available stays 0
      expect(bucket.available_()).toBe(0);

      h2.release();
      h3.release();
      h4.release();
      expect(bucket.available_()).toBe(3);
    });

    it('release is idempotent (double-release is a no-op)', async () => {
      process.env.BULK_PDF_CONCURRENCY = '2';
      const bucket = new PdfRenderConcurrencyBucket();
      const h = await bucket.acquire();
      h.release();
      h.release(); // would double-credit available if not idempotent
      expect(bucket.available_()).toBe(2);
    });

    it('FIFO waiter order', async () => {
      process.env.BULK_PDF_CONCURRENCY = '1';
      const bucket = new PdfRenderConcurrencyBucket();
      const blocker = await bucket.acquire();
      const order: number[] = [];

      const w1 = bucket.acquire().then((h) => {
        order.push(1);
        h.release();
      });
      const w2 = bucket.acquire().then((h) => {
        order.push(2);
        h.release();
      });
      const w3 = bucket.acquire().then((h) => {
        order.push(3);
        h.release();
      });

      blocker.release();
      await Promise.all([w1, w2, w3]);
      expect(order).toEqual([1, 2, 3]);
    });
  });
});

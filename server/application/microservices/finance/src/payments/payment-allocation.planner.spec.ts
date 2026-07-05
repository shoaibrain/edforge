/**
 * planPaymentAllocation — EPIC-FB Sprint FB-4.3 property-style suite.
 *
 * Deterministic seeded generator (no fast-check dependency) sweeps random
 * invoice sets + amounts asserting the planner's four invariants; explicit
 * cases pin the ordering contract, the 20/21 cap boundary, and the
 * explicit-strategy validation matrix.
 */

import { BadRequestException } from '@nestjs/common';
import {
  planPaymentAllocation,
  MAX_PAYMENT_TARGETS,
  type PlannerOpenInvoice,
} from './payment-allocation.planner';
import { FinanceErrors } from '../common/errors/finance-errors';

function inv(
  n: number,
  amountDue: number,
  dueDate: string,
  invoiceNumber = `INV-${String(n).padStart(4, '0')}`,
): PlannerOpenInvoice {
  return {
    invoiceId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    invoiceNumber,
    studentAccountId: `acct-${n % 3}`,
    amountDue,
    dueDate,
  };
}

function errBody(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse();
  }
  throw new Error('expected BadRequestException');
}

/** Small deterministic LCG so failures reproduce byte-identically. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('planPaymentAllocation — oldest_due_first', () => {
  it('orders entries by dueDate asc; amount waterfalls oldest-first', () => {
    const invoices = [
      inv(3, 500, '2026-09-01'),
      inv(1, 1000, '2026-07-01'),
      inv(2, 800, '2026-08-01'),
    ];
    const plan = planPaymentAllocation(2000, invoices, 'oldest_due_first');
    expect(plan).toEqual([
      { targetType: 'invoice', invoiceId: invoices[1].invoiceId, amount: 1000 },
      { targetType: 'invoice', invoiceId: invoices[2].invoiceId, amount: 800 },
      { targetType: 'invoice', invoiceId: invoices[0].invoiceId, amount: 200 },
    ]);
  });

  it('same dueDate → invoiceNumber asc tie-break (deterministic)', () => {
    const a = inv(1, 400, '2026-07-01', 'INV-0200');
    const b = inv(2, 400, '2026-07-01', 'INV-0100');
    const plan = planPaymentAllocation(500, [a, b], 'oldest_due_first');
    expect(plan.map(p => p.invoiceId)).toEqual([b.invoiceId, a.invoiceId]);
    expect(plan.map(p => p.amount)).toEqual([400, 100]);
  });

  it('partial coverage: stops when exhausted; zero-amount entries never emitted', () => {
    const plan = planPaymentAllocation(
      300,
      [inv(1, 300, '2026-07-01'), inv(2, 500, '2026-08-01')],
      'oldest_due_first',
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].amount).toBe(300);
  });

  it('amount > total allocatable → PAYMENT_EXCEEDS_ALLOCATABLE (no credit memo, mirroring the single-target rule)', () => {
    const body = errBody(() =>
      planPaymentAllocation(2001, [inv(1, 1000, '2026-07-01'), inv(2, 1000, '2026-08-01')], 'oldest_due_first'),
    );
    expect(body.code).toBe(FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE);
    expect(body.params.allocatable).toBe(2000);
  });

  it('cap boundary: exactly 20 targets OK; 21st needed → rejected', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => inv(i + 1, 100, `2026-07-${String((i % 28) + 1).padStart(2, '0')}`));
    const plan = planPaymentAllocation(2000, twenty, 'oldest_due_first');
    expect(plan).toHaveLength(MAX_PAYMENT_TARGETS);

    const twentyOne = Array.from({ length: 21 }, (_, i) => inv(i + 1, 100, '2026-07-01'));
    expect(() => planPaymentAllocation(2100, twentyOne, 'oldest_due_first')).toThrow(/at most 20/);
  });

  it('property sweep (seeded): Σ === amount, per-entry ≤ amountDue, canonical order, ≤ 20 entries', () => {
    const rng = makeRng(0xfb43);
    for (let run = 0; run < 200; run++) {
      const count = 1 + Math.floor(rng() * 12);
      const invoices = Array.from({ length: count }, (_, i) =>
        inv(
          i + 1,
          Math.round(rng() * 5000 * 100) / 100 + 1,
          `2026-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}`,
        ),
      );
      const totalDue = invoices.reduce((s, i) => s + i.amountDue, 0);
      const amount = Math.max(0.01, Math.round(rng() * totalDue * 100) / 100);

      const plan = planPaymentAllocation(amount, invoices, 'oldest_due_first');

      const sum = plan.reduce((s, p) => s + p.amount, 0);
      expect(Math.abs(sum - amount)).toBeLessThanOrEqual(0.011);
      expect(plan.length).toBeLessThanOrEqual(MAX_PAYMENT_TARGETS);

      const byId = new Map(invoices.map(i => [i.invoiceId, i]));
      for (const p of plan) {
        expect(p.amount).toBeGreaterThan(0);
        expect(p.amount).toBeLessThanOrEqual(byId.get(p.invoiceId)!.amountDue + 0.011);
      }

      // Canonical order: dueDate asc then invoiceNumber asc.
      for (let i = 1; i < plan.length; i++) {
        const prev = byId.get(plan[i - 1].invoiceId)!;
        const curr = byId.get(plan[i].invoiceId)!;
        const cmp = prev.dueDate === curr.dueDate
          ? prev.invoiceNumber.localeCompare(curr.invoiceNumber)
          : prev.dueDate.localeCompare(curr.dueDate);
        expect(cmp).toBeLessThan(0);
      }
      // Distinct targets.
      expect(new Set(plan.map(p => p.invoiceId)).size).toBe(plan.length);
    }
  });
});

describe('planPaymentAllocation — explicit strategy validation matrix', () => {
  const open = [inv(1, 1000, '2026-08-01'), inv(2, 800, '2026-07-01'), inv(3, 500, '2026-07-01', 'INV-0000')];

  it('valid explicit allocations re-emitted in CANONICAL order (not caller order)', () => {
    const plan = planPaymentAllocation(1500, open, 'explicit', [
      { invoiceId: open[0].invoiceId, amount: 400 },
      { invoiceId: open[1].invoiceId, amount: 600 },
      { invoiceId: open[2].invoiceId, amount: 500 },
    ]);
    // Canonical: INV-0000 (07-01), INV-0002 (07-01), INV-0001 (08-01)
    expect(plan.map(p => p.invoiceId)).toEqual([
      open[2].invoiceId,
      open[1].invoiceId,
      open[0].invoiceId,
    ]);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1500);
  });

  it('unknown target invoice → rejected', () => {
    expect(() =>
      planPaymentAllocation(100, open, 'explicit', [
        { invoiceId: '99999999-9999-4999-8999-999999999999', amount: 100 },
      ]),
    ).toThrow(/not among the open target invoices/);
  });

  it('duplicate target → rejected', () => {
    expect(() =>
      planPaymentAllocation(200, open, 'explicit', [
        { invoiceId: open[0].invoiceId, amount: 100 },
        { invoiceId: open[0].invoiceId, amount: 100 },
      ]),
    ).toThrow(/duplicate allocation/);
  });

  it('non-positive amount → rejected', () => {
    expect(() =>
      planPaymentAllocation(100, open, 'explicit', [{ invoiceId: open[0].invoiceId, amount: 0 }]),
    ).toThrow(/must be > 0/);
  });

  it('allocation exceeding that invoice amountDue → PAYMENT_EXCEEDS_ALLOCATABLE naming the invoice', () => {
    const body = errBody(() =>
      planPaymentAllocation(900, open, 'explicit', [{ invoiceId: open[1].invoiceId, amount: 900 }]),
    );
    expect(body.code).toBe(FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE);
    expect(body.params.invoiceId).toBe(open[1].invoiceId);
  });

  it('Σ(allocations) < amount → rejected (no opening-balance leg for multi-target in V1)', () => {
    const body = errBody(() =>
      planPaymentAllocation(1000, open, 'explicit', [{ invoiceId: open[0].invoiceId, amount: 400 }]),
    );
    expect(body.code).toBe(FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE);
  });

  it('Σ within ±0.01 of amount → accepted (SPEC-14 tolerance)', () => {
    const plan = planPaymentAllocation(1000.004, open, 'explicit', [
      { invoiceId: open[0].invoiceId, amount: 1000 },
    ]);
    expect(plan).toHaveLength(1);
  });

  it('21 explicit targets → rejected at the cap', () => {
    const many = Array.from({ length: 21 }, (_, i) => inv(i + 1, 100, '2026-07-01'));
    expect(() =>
      planPaymentAllocation(
        2100,
        many,
        'explicit',
        many.map(m => ({ invoiceId: m.invoiceId, amount: 100 })),
      ),
    ).toThrow(/at most 20/);
  });

  it('missing explicitAllocations for explicit strategy → rejected', () => {
    expect(() => planPaymentAllocation(100, open, 'explicit')).toThrow(/requires non-empty/);
  });
});

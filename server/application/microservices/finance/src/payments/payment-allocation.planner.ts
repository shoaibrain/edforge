/**
 * Payment allocation planner — EPIC-FB Sprint FB-4.3.
 *
 * Pure function: (amount, open invoices, strategy) → ordered invoice
 * applications for a multi-target family payment. No I/O; the caller
 * (`PaymentsService.recordManualPayment` multi path, FB-4.6 family
 * open-invoices endpoint) owns fetching + freshness of `openInvoices`.
 *
 * Invariants produced (mirror of the FB-4.2 response-schema superRefine):
 *   - entries ordered by dueDate asc, then invoiceNumber asc (deterministic
 *     tie-break — the codified "oldest debt first" ledger ordering)
 *   - each entry's amount ≤ that invoice's amountDue
 *   - Σ(entries.amount) === amount (±0.01 — same SPEC-14 tolerance)
 *   - ≤ 20 entries (DDB transactWrite ceiling, FB-4.2)
 *
 * Remainder policy: an amount that exceeds the total allocatable across
 * `openInvoices` is REJECTED with `PAYMENT_EXCEEDS_ALLOCATABLE` — the same
 * no-credit-memo rule the single-target path applies today (PD.2.3 case 5).
 *
 * Opening balance is deliberately NOT planned here: multi-target payments
 * do not touch opening balance in V1. The single-target path's
 * invoice-then-opening waterfall stays the only opening-balance settlement
 * route; a family cheque that should also clear a carry-forward is recorded
 * as two payments (documented operator workaround, epic §3.4).
 */

import { BadRequestException } from '@nestjs/common';
import { FinanceErrors } from '../common/errors/finance-errors';

export interface PlannerOpenInvoice {
  invoiceId: string;
  invoiceNumber: string;
  studentAccountId: string;
  amountDue: number;
  dueDate: string;
}

export interface PlannedInvoiceApplication {
  targetType: 'invoice';
  invoiceId: string;
  amount: number;
}

export type AllocationStrategy = 'oldest_due_first' | 'explicit';

/** FB-4.2 — DDB transactWrite ceiling (~3 transact items per target). */
export const MAX_PAYMENT_TARGETS = 20;

/** Same ±0.01 tolerance as the response-side sum invariant (SPEC-14). */
const CENT_TOLERANCE = 0.01;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function sortByDueDateThenNumber(invoices: PlannerOpenInvoice[]): PlannerOpenInvoice[] {
  return [...invoices].sort((a, b) =>
    a.dueDate === b.dueDate
      ? a.invoiceNumber.localeCompare(b.invoiceNumber)
      : a.dueDate.localeCompare(b.dueDate),
  );
}

function throwExceedsAllocatable(amount: number, allocatable: number): never {
  throw new BadRequestException({
    code: FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE,
    message:
      `Payment amount (${amount}) exceeds the total allocatable across the `
      + `target invoices (${allocatable}). Multi-target payments do not settle `
      + `opening balances in V1; reduce the payment to at most ${allocatable}.`,
    params: { amount, allocatable },
  });
}

/**
 * Plan the per-invoice allocation of one payment.
 *
 * `'oldest_due_first'` — auto mode: waterfall the amount over
 * `openInvoices` in dueDate-asc / invoiceNumber-asc order, each target
 * capped at its `amountDue`; stops when the amount is exhausted.
 * Zero-amount entries are never emitted.
 *
 * `'explicit'` — operator-edited mode: `explicitAllocations` provides
 * per-invoice amounts; validated against the same rules (targets must be
 * in `openInvoices`, distinct, positive, ≤ amountDue, Σ === amount) and
 * re-emitted in canonical order regardless of caller order.
 */
export function planPaymentAllocation(
  amount: number,
  openInvoices: PlannerOpenInvoice[],
  strategy: AllocationStrategy,
  explicitAllocations?: ReadonlyArray<{ invoiceId: string; amount: number }>,
): PlannedInvoiceApplication[] {
  if (!(amount > 0)) {
    throw new BadRequestException(
      `planPaymentAllocation: amount must be > 0; got ${amount}.`,
    );
  }

  const ordered = sortByDueDateThenNumber(openInvoices);

  if (strategy === 'explicit') {
    if (!explicitAllocations || explicitAllocations.length === 0) {
      throw new BadRequestException(
        `planPaymentAllocation: strategy 'explicit' requires non-empty explicitAllocations.`,
      );
    }
    if (explicitAllocations.length > MAX_PAYMENT_TARGETS) {
      throw new BadRequestException(
        `planPaymentAllocation: at most ${MAX_PAYMENT_TARGETS} invoice targets are `
        + `supported (DDB transactWrite ceiling, FB-4.2); got ${explicitAllocations.length}.`,
      );
    }

    const byId = new Map(ordered.map(inv => [inv.invoiceId, inv]));
    const seen = new Set<string>();
    for (const alloc of explicitAllocations) {
      if (seen.has(alloc.invoiceId)) {
        throw new BadRequestException(
          `planPaymentAllocation: duplicate allocation for invoice ${alloc.invoiceId}.`,
        );
      }
      seen.add(alloc.invoiceId);

      const target = byId.get(alloc.invoiceId);
      if (!target) {
        throw new BadRequestException(
          `planPaymentAllocation: allocation references invoice ${alloc.invoiceId} `
          + `which is not among the open target invoices.`,
        );
      }
      if (!(alloc.amount > 0)) {
        throw new BadRequestException(
          `planPaymentAllocation: allocation for invoice ${target.invoiceNumber} `
          + `must be > 0; got ${alloc.amount}.`,
        );
      }
      if (alloc.amount - target.amountDue > CENT_TOLERANCE) {
        throw new BadRequestException({
          code: FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE,
          message:
            `Allocation (${alloc.amount}) for invoice ${target.invoiceNumber} exceeds `
            + `its amount due (${target.amountDue}).`,
          params: { invoiceId: target.invoiceId, allocated: alloc.amount, amountDue: target.amountDue },
        });
      }
    }

    const allocated = round2(explicitAllocations.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(allocated - amount) > CENT_TOLERANCE) {
      // Under-allocation has nowhere to go (no opening-balance leg in
      // multi-target V1) and over-allocation is always invalid — both are
      // the same "amount doesn't fit the targets" failure.
      throwExceedsAllocatable(amount, allocated < amount ? allocated : round2(
        explicitAllocations.reduce((s, a) => {
          const due = byId.get(a.invoiceId)?.amountDue ?? 0;
          return s + Math.min(a.amount, due);
        }, 0),
      ));
    }

    const amountById = new Map(explicitAllocations.map(a => [a.invoiceId, a.amount]));
    return ordered
      .filter(inv => amountById.has(inv.invoiceId))
      .map(inv => ({
        targetType: 'invoice' as const,
        invoiceId: inv.invoiceId,
        amount: round2(amountById.get(inv.invoiceId)!),
      }));
  }

  // ─── oldest_due_first ─────────────────────────────────────────────
  const plan: PlannedInvoiceApplication[] = [];
  let remaining = round2(amount);
  for (const inv of ordered) {
    if (remaining <= CENT_TOLERANCE) break;
    const slice = round2(Math.min(remaining, Math.max(0, inv.amountDue)));
    if (slice <= 0) continue;
    plan.push({ targetType: 'invoice', invoiceId: inv.invoiceId, amount: slice });
    remaining = round2(remaining - slice);
  }

  if (remaining > CENT_TOLERANCE) {
    throwExceedsAllocatable(amount, round2(amount - remaining));
  }
  if (plan.length > MAX_PAYMENT_TARGETS) {
    throw new BadRequestException(
      `planPaymentAllocation: the amount spans ${plan.length} invoices; at most `
      + `${MAX_PAYMENT_TARGETS} targets are supported per payment (DDB transactWrite `
      + `ceiling, FB-4.2). Record the payment in smaller parts.`,
    );
  }
  return plan;
}

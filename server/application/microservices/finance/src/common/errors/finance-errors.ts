/**
 * Standardized error codes for the Finance service.
 *
 * Frontend can map these codes to i18n translation keys for localized messages.
 * Usage: throw new BadRequestException({ code: FinanceErrors.INVOICE_NOT_PAYABLE, message: '...' })
 */
export const FinanceErrors = {
  // Invoice errors
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_NOT_PAYABLE: 'INVOICE_NOT_PAYABLE',
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  INVOICE_STATUS_TRANSITION: 'INVOICE_STATUS_TRANSITION',

  // Payment errors
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_EXCEEDS_DUE: 'PAYMENT_EXCEEDS_DUE',
  // Pilot PD.2.3 — supersedes PAYMENT_EXCEEDS_DUE for accounts with an
  // active opening balance. Raised when payment.amount exceeds the SUM of
  // invoice.amountDue + (openingBalance − openingBalanceSettled). Carries
  // `{ invoiceDue, openingRemaining }` in params for the UI to render the
  // breakdown ("you can pay up to NPR X against the invoice or NPR Y
  // against previous dues").
  PAYMENT_EXCEEDS_ALLOCATABLE: 'PAYMENT_EXCEEDS_ALLOCATABLE',
  PAYMENT_CURRENCY_MISMATCH: 'PAYMENT_CURRENCY_MISMATCH',
  PAYMENT_VOID_NOT_COMPLETED: 'PAYMENT_VOID_NOT_COMPLETED',
  PAYMENT_REFUND_NOT_ELIGIBLE: 'PAYMENT_REFUND_NOT_ELIGIBLE',
  PAYMENT_REFUND_EXCEEDS_AMOUNT: 'PAYMENT_REFUND_EXCEEDS_AMOUNT',
  // Pilot PD.2 Phase C SPEC-2 fix — split-payment partial refunds
  // require pro-rata math across invoice + opening allocations that
  // is out of V1 scope. V1 supports FULL refunds on split payments
  // (entire payment reversed; both portions returned). For partial,
  // operator workaround: void + re-record at the desired amount.
  PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED: 'PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED',
  // Pilot PD.2 Phase C CORR-2 — defensive guard for the impossible-today
  // case where allocation planning produces zero applications. Surfaces
  // as an early 400 instead of a generic runtime Error from the composite
  // ledger helper.
  NO_ALLOCATABLE_TARGETS: 'NO_ALLOCATABLE_TARGETS',
  // Pilot PD.2 Phase C CONC-7 — payment chronology guard. Rejects manual
  // back-dating that would record a payment BEFORE the account's
  // opening-balance effective date (operator-supplied `openingBalanceAsOf`).
  PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF: 'PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF',
  PAYMENT_SESSION_NOT_FOUND: 'PAYMENT_SESSION_NOT_FOUND',
  // EPIC-FB FB-4.4 — multi-target amountDue coherence. Raised as a 409
  // when a requested per-invoice allocation exceeds that invoice's
  // CURRENT amountDue (the operator's view is stale — someone else paid
  // in between). Carries { invoiceId, invoiceNumber, allocated, amountDue }.
  PAYMENT_APPLICATION_EXCEEDS_DUE: 'PAYMENT_APPLICATION_EXCEEDS_DUE',
  INVALID_PAYMENT_APPLICATIONS: 'INVALID_PAYMENT_APPLICATIONS',
  AGREEMENT_VERSION_TOO_LARGE: 'AGREEMENT_VERSION_TOO_LARGE',
  INVALID_FILTER_COMBINATION: 'INVALID_FILTER_COMBINATION',
  // EPIC-FB FB-4.5 — refunds on multi-target family payments are
  // all-or-nothing in V1 (pro-rata partials across N invoices are V1.5).
  PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED: 'PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED',
  // Review NOTE-B — on a multi-target payment the refund's dto.invoiceId
  // drives studentId attribution (and the credit note); it must be one of
  // THIS payment's target invoiceIds, or the refund silently mis-attributes
  // to an unrelated student.
  INVALID_REFUND_TARGET: 'INVALID_REFUND_TARGET',

  // Family billing — EPIC-FB FB-4.6
  FAMILY_NOT_FOUND: 'FAMILY_NOT_FOUND',
  // The academics member-enumeration API is unavailable (route not yet
  // deployed or academics down). Distinct from FAMILY_NOT_FOUND so the
  // client can tell "no such family" from "can't resolve members".
  FAMILY_MEMBERS_UNAVAILABLE: 'FAMILY_MEMBERS_UNAVAILABLE',

  // Gateway errors
  GATEWAY_NOT_FOUND: 'GATEWAY_NOT_FOUND',
  GATEWAY_NOT_ENABLED: 'GATEWAY_NOT_ENABLED',
  GATEWAY_VERIFICATION_FAILED: 'GATEWAY_VERIFICATION_FAILED',
  GATEWAY_AMOUNT_MISMATCH: 'GATEWAY_AMOUNT_MISMATCH',

  // Fee structure errors
  FEE_STRUCTURE_NOT_FOUND: 'FEE_STRUCTURE_NOT_FOUND',

  // Account errors
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',

  // Billing agreement errors — EPIC-FB Sprint FB-2/FB-3
  AGREEMENT_NOT_FOUND: 'AGREEMENT_NOT_FOUND',
  AGREEMENT_INVALID_TRANSITION: 'AGREEMENT_INVALID_TRANSITION',
  AGREEMENT_STUDENT_NOT_ENROLLED: 'AGREEMENT_STUDENT_NOT_ENROLLED',
  AGREEMENT_STUDENT_NOT_IN_FAMILY: 'AGREEMENT_STUDENT_NOT_IN_FAMILY',
  AGREEMENT_TERM_EXPIRED: 'AGREEMENT_TERM_EXPIRED',
  // Raised (a) advisorily at draft-create when a member student already has
  // a non-terminal agreement with an overlapping window (FB-2.5), and
  // (b) bindingly at activation when a lock conditional put fails (FB-3.5).
  AGREEMENT_OVERLAP: 'AGREEMENT_OVERLAP',
  // Activation found open standard invoices covering the agreement's
  // coveredFeeTypes; operator must acknowledge (FB-3.5 warning-with-listing).
  CONFLICTING_OPEN_INVOICES: 'CONFLICTING_OPEN_INVOICES',
  // FB-3.4 generation-time guard: this agreement already priced an
  // invoice for the student this term. Agreements bill ONCE per term per
  // student (owner decision 2026-07-05, review F4) — ANY live
  // (non-cancelled / non-written-off) invoice carrying the agreementId
  // conflicts, regardless of billingPeriod label. Pass overrideAgreement
  // to bill standard fees anyway (billing:manage).
  AGREEMENT_ACTIVE: 'AGREEMENT_ACTIVE',
  // Review F2 — the per-student GSI2 invoice scan hit the pagination
  // safety cap (25 pages × 100 rows) before exhausting the partition;
  // automated conflict/duplicate checking cannot be trusted, so the
  // operation aborts for manual staff review instead of silently passing.
  INVOICE_SCAN_LIMIT_EXCEEDED: 'INVOICE_SCAN_LIMIT_EXCEEDED',

  // Concurrency
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
} as const;

export type FinanceErrorCode = typeof FinanceErrors[keyof typeof FinanceErrors];

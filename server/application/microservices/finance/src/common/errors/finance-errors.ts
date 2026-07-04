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
  // FB-3.4 generation-time guard: the requested covered fee types are
  // already priced by the student's active agreement (a non-cancelled
  // agreement invoice exists for the same billingPeriod, or at all when
  // the request has no billingPeriod). Pass overrideAgreement to bill
  // standard fees anyway (billing:manage).
  AGREEMENT_ACTIVE: 'AGREEMENT_ACTIVE',

  // Concurrency
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
} as const;

export type FinanceErrorCode = typeof FinanceErrors[keyof typeof FinanceErrors];

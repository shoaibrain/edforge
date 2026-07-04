/**
 * Invoice Schemas
 *
 * Invoices represent bills sent to students/parents.
 * Lifecycle: draft → issued → partially_paid → paid → overdue → cancelled → written_off
 */

import { z } from 'zod';
import { invoiceStatusEnum, currencyEnum, amountOrZeroSchema, taxRateSchema } from './common';
import { uuidSchema, dateSchema } from '../common';

// ============================================================================
// LINE ITEM
// ============================================================================

export const invoiceLineItemSchema = z.object({
  id: uuidSchema,
  feeStructureId: uuidSchema,
  feeStructureVersion: z.number().int().optional(),
  description: z.string(),
  amount: z.number().min(0),
  quantity: z.number().int().min(1).default(1),
  discount: z.number().min(0).default(0),
  discountReason: z.string().optional(),
  taxRate: z.number().min(0).max(100),
  taxType: z.string().optional(),
  taxAmount: z.number().min(0),
  total: z.number(),
  /**
   * Sprint C Phase 1 — distinguishes operator-supplied ad-hoc lines (added
   * via the wizard's Step 2 "Custom line items" section) from fee-structure-
   * derived lines. Synthetic `feeStructureId` UUID is non-resolvable when
   * `isCustom` is true; frontend uses this flag to skip the fee-structure
   * lookup and render the operator-supplied `description` verbatim.
   */
  isCustom: z.boolean().optional(),
  /**
   * EPIC-FB FB-3.2 — agreement provenance, snapshotted at generation time.
   * Present only on lines priced by a BillingAgreement (the line REPLACES
   * the suppressed standard fee structures). Snapshot semantics: a later
   * supersede/cancel of the agreement never orphans the line's provenance.
   */
  agreementId: uuidSchema.optional(),
  /** EPIC-FB FB-3.2 — companion to `agreementId`; pins the agreement version. */
  agreementVersion: z.number().int().optional(),
  /**
   * EPIC-FB FB-3.2 — which standard fee structures this agreement line
   * suppressed (their feeType ∈ the agreement's coveredFeeTypes). Feeds the
   * invoice "why" trace (FB-5.4).
   */
  suppressedFeeStructureIds: z.array(uuidSchema).optional(),
  /**
   * EPIC-FB FB-5.2 — provenance for auto-applied discount lines: the
   * DiscountRule (e.g. the sibling rule) that produced this line's discount.
   * Absent on manual/operator discounts (those carry `discountReason` only).
   */
  discountRuleId: uuidSchema.optional(),
});

export const taxSummaryItemSchema = z.object({
  taxType: z.string(),
  taxableAmount: z.number(),
  taxRate: z.number(),
  taxAmount: z.number(),
});

export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

// ============================================================================
// STATUS HISTORY
// ============================================================================

export const statusHistoryEntrySchema = z.object({
  from: z.string(),
  to: z.string(),
  changedAt: z.string(),
  changedBy: z.string(),
  reason: z.string().optional(),
});

export type StatusHistoryEntry = z.infer<typeof statusHistoryEntrySchema>;

// ============================================================================
// RESPONSE
// ============================================================================

export const invoiceResponseSchema = z.object({
  id: uuidSchema,
  invoiceNumber: z.string(),
  studentAccountId: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  schoolId: uuidSchema,
  schoolName: z.string(),
  academicYear: z.string(),
  billingPeriod: z.string().optional(),
  lineItems: z.array(invoiceLineItemSchema),
  subtotal: z.number(),
  taxTotal: z.number(),
  discountTotal: z.number(),
  grandTotal: z.number(),
  amountPaid: z.number(),
  amountDue: z.number(),
  currency: currencyEnum,
  dueDate: z.string(),
  issuedDate: z.string(),
  status: invoiceStatusEnum,
  notes: z.string().optional(),
  taxSummary: z.array(taxSummaryItemSchema).optional(),
  enrollmentId: uuidSchema.optional(),
  /**
   * Sprint A.1 — snapshot grade level at issue time. Populated from
   * `dto.gradeLevel` (admin override) → `studentInfo.gradeLevel`
   * (default). Survives student promotion so historical accounting
   * filtering stays stable.
   *
   * Undefined when the snapshot resolution failed; consumers can
   * inspect `gradeLevelResolutionStatus` to distinguish "snapshot
   * tried and student had no grade" from "pre-A.1 row with no
   * snapshot attempt."
   */
  gradeLevel: z.string().optional(),
  /**
   * Sprint A.1 — companion to `gradeLevel`.
   *   - `'resolved'`   — gradeLevel snapshot succeeded (dto OR studentInfo)
   *   - `'unresolved'` — both sources empty; gradeLevel undefined; row
   *                      surfaces in the upcoming "Unknown" filter
   *                      bucket (Sprint B.1)
   *   - undefined      — pre-A.1 row; not yet backfilled
   */
  gradeLevelResolutionStatus: z.enum(['resolved', 'unresolved']).optional(),
  /**
   * EPIC-FB FB-3.2 (PR-CA CA.0.2 convention) — how this invoice was priced.
   *   - `'catalog'`   — standard fee-structure pricing
   *   - `'agreement'` — one or more lines priced by a BillingAgreement
   *   - undefined     — pre-agreement row (back-compat; treat as catalog)
   */
  feeOverrideMode: z.enum(['catalog', 'agreement']).optional(),
  /**
   * EPIC-FB FB-3.2 — the BillingAgreement that priced this invoice,
   * snapshotted at generation time (never re-resolved; a later void/
   * supersede of the agreement doesn't orphan the invoice's provenance).
   */
  agreementId: uuidSchema.optional(),
  /** EPIC-FB FB-3.2 — companion to `agreementId`; the agreement version applied. */
  agreementVersion: z.number().int().optional(),
  /**
   * EPIC-FB FB-0.1 — derived read-side flag, NEVER stored. Computed at
   * mapper/list time as `dueDate < today && status ∉ {paid, cancelled,
   * written_off}`, so a past-due `partially_paid` invoice surfaces as
   * overdue WITHOUT the sweep erasing the partial-payment signal from
   * `status` (the sweep is restricted to `issued → overdue`). Sparse:
   * absent on rows serialized before the flag existed.
   */
  isOverdue: z.boolean().optional(),
  statusHistory: z.array(statusHistoryEntrySchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Invoice = z.infer<typeof invoiceResponseSchema>;

// ============================================================================
// GENERATE (CREATE)
// ============================================================================

/**
 * Sprint C Phase 1 — operator-supplied ad-hoc line items appended to every
 * invoice in addition to the fee-structure lines. Capped to keep DDB rows
 * bounded + the operator UI scannable. Both per-student `generate` and
 * `bulkGenerate` accept this — service applies it identically.
 */
export const customLineItemSchema = z.object({
  name: z.string().min(1).max(120),
  amount: z.number().min(0),
});

export type CustomLineItem = z.infer<typeof customLineItemSchema>;

export const generateInvoiceSchema = z.object({
  studentId: uuidSchema,
  academicYear: z.string().min(1).max(20),
  billingPeriod: z.string().max(50).optional(),
  feeStructureIds: z.array(uuidSchema).min(1, 'At least one fee structure required'),
  dueDate: dateSchema,
  notes: z.string().max(500).optional(),
  discounts: z.array(z.object({
    feeStructureId: uuidSchema,
    amount: z.number().positive(),
    reason: z.string().max(200).optional(),
  })).optional(),
  autoIssue: z.boolean().optional(),
  issuedDate: dateSchema.optional(),
  enrollmentId: z.string().optional(),
  gradeLevel: z.string().optional(),
  customLineItems: z.array(customLineItemSchema).max(10).optional(),
});

export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

// ============================================================================
// BULK GENERATE
// ============================================================================

// Bulk Ops Sprint C — three operator-facing modes, ONE z.object schema:
//   - selectionMode 'students' → flat studentIds[]. Existing "By Student".
//   - selectionMode 'grades'   → gradeLevels[] (or ['ALL']) → server-side
//                                 resolution to studentIds via the academics
//                                 API (C.3 helper). New "By Grade" tab.
//   - selectionMode omitted    → legacy flat studentIds[] shape. Service
//                                 normalises to selectionMode='students'.
//
// Why a single z.object + .refine() instead of a 3-way z.union (the original
// C.1 shape): `nestjs-zod`'s `createZodDto()` requires a base type with
// statically known members (TS2509 on union shapes). The .refine() preserves
// the cross-field validation semantics — invalid combos still reject with a
// clear message — without giving up the validation pipe.
const bulkBaseFields = {
  academicYear: z.string().min(1).max(20),
  billingPeriod: z.string().max(50).optional(),
  feeStructureIds: z.array(uuidSchema).min(1),
  dueDate: dateSchema,
  notes: z.string().max(500).optional(),
  /**
   * Sprint C Phase 1 — ad-hoc line items added to EVERY generated invoice
   * in this batch (e.g., "Annual picnic — voluntary"). Capped at 10 per
   * batch; each amount ≥ 0; service rejects via Zod.
   */
  customLineItems: z.array(customLineItemSchema).max(10).optional(),
  /**
   * Sprint C Phase 1 — when true, the bulk worker drops any student whose
   * computed invoice total is exactly 0 (e.g., full-discount edge cases).
   * Skip is counted in the response's `skipped` total (alongside duplicates)
   * so operators see a single skip number.
   */
  skipZeroTotal: z.boolean().optional(),
};

export const bulkGenerateInvoiceSchema = z.object({
  selectionMode: z.enum(['students', 'grades']).optional(),
  studentIds: z.array(uuidSchema).max(5000).optional(),
  /**
   * Either canonical grade codes (e.g. ['4','5']) or the single literal
   * `['ALL']` meaning "every grade level enabled at this school". Resolved
   * at the service boundary (Sprint C.3). Required when selectionMode='grades'.
   */
  gradeLevels: z.array(z.string().min(1).max(20)).optional(),
  ...bulkBaseFields,
}).refine(
  data => {
    if (data.selectionMode === 'grades') {
      return Array.isArray(data.gradeLevels) && data.gradeLevels.length >= 1;
    }
    // 'students' OR legacy (no selectionMode) — studentIds required + non-empty.
    return Array.isArray(data.studentIds) && data.studentIds.length >= 1;
  },
  {
    message:
      "selectionMode='students' (or omitted) requires non-empty studentIds[]; " +
      "selectionMode='grades' requires non-empty gradeLevels[].",
    path: ['selectionMode'],
  },
);

export type BulkGenerateInvoiceDto = z.infer<typeof bulkGenerateInvoiceSchema>;

// ============================================================================
// BULK PDF EXPORT (Sprint F.4)
// ============================================================================

/**
 * Sprint F.4 — `POST /finance/schools/:schoolId/invoices/bulk-pdf-export`
 *
 * Operator-supplied invoice IDs to bundle into a ZIP (or merged PDF in
 * H.3). Worker dispatched via `setImmediate`; controller returns 202 +
 * jobId immediately. Cap (MVP.4 `BULK_EXPORT_CAPS.zip = 2000`) is
 * enforced at the controller boundary as `PayloadTooLargeException`.
 *
 * Format gating:
 *   - `'zip'`         — F.4 (this PR). Supported.
 *   - `'merged_pdf'`  — H.3 (future). Controller returns 501 until then.
 *
 * Dedup: invoiceIds[] is deduped at the schema boundary so the frontend's
 * "select-all" + "row-checkbox" combo can't accidentally pass dups
 * (which would otherwise be wasted render slots).
 *
 * Required `Idempotency-Key` header (Sprint 0.2) is enforced by the
 * `@Idempotent()` interceptor — not by the schema.
 */
/**
 * F.4 PR #360 P2 review fix-up — DELIBERATELY no `.max(2000)` cap.
 *
 * The size cap (`BULK_EXPORT_CAPS.zip = 2000`) is enforced by the
 * controller as `PayloadTooLargeException` with the operator-friendly
 * envelope `{code: 'PAYLOAD_TOO_LARGE', limit, requested}`. If the
 * schema ALSO `.max(2000)`'d, Zod would reject first → Nest would
 * surface its generic 400 ValidationError envelope and the operator
 * would never see the friendly 413 body. The reviewer caught this.
 *
 * Defense-in-depth against absurd inputs (millions of IDs) is handled
 * upstream by Express's body-parser limit (default 100KB JSON, ~3000
 * UUIDs worth) before requests ever reach Zod. The schema's job is
 * shape validation (each id is a UUID), not size enforcement.
 */
export const bulkPdfExportSchema = z.object({
  invoiceIds: z
    .array(uuidSchema)
    .min(1, 'invoiceIds must contain at least 1 invoice')
    .transform((arr) => Array.from(new Set(arr))),
  format: z.enum(['zip', 'merged_pdf']),
});

export type BulkPdfExportDto = z.infer<typeof bulkPdfExportSchema>;

// ============================================================================
// UPDATE
// ============================================================================

export const updateInvoiceSchema = z.object({
  status: invoiceStatusEnum.optional(),
  notes: z.string().max(500).optional(),
  dueDate: dateSchema.optional(),
  discounts: z.array(z.object({
    lineItemId: uuidSchema,
    amount: z.number().positive(),
    reason: z.string().max(200).optional(),
  })).optional(),
});

export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;

// ============================================================================
// FILTER
// ============================================================================

export const invoiceFilterSchema = z.object({
  status: z.union([invoiceStatusEnum, z.array(invoiceStatusEnum)]).optional(),
  studentId: uuidSchema.optional(),
  academicYear: z.string().optional(),
  dueDateFrom: dateSchema.optional(),
  dueDateTo: dateSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type InvoiceFilterDto = z.infer<typeof invoiceFilterSchema>;

/**
 * Billing Agreement Schemas — EPIC-FB Sprint FB-2.1
 *
 * A BillingAgreement records a negotiated deal ("the Adhikari family pays
 * NPR 40,000 total for three children") that REPLACES the standard fee
 * structures for the covered feeTypes over a term. It is the ONE agreement
 * entity (FB-2.0 owner decision): PR-CA's per-student Custom Yearly Fee
 * Agreement is exactly `agreementType: 'per_student'` with a single student
 * and no `familyId` — there is no separate StudentFeeAgreement.
 *
 * Adopted PR-CA conventions (epic §3.0):
 *   - `status` + `isActive` are orthogonal axes; `isActive` is OMITTED from
 *     response DTOs (P1d)
 *   - optimistic-concurrency `version` travels in the PATCH body, not an
 *     If-Match header
 *   - invoices snapshot `agreementId` + `agreementVersion` at generation
 *     time (see invoice.schema.ts), so later supersede/cancel never orphans
 *     invoice provenance
 *
 * Lifecycle: draft → active → expired | cancelled (+ superseded via
 * versioning — financial-term changes on an ACTIVE agreement create a new
 * version and supersede the old, mirroring fee-structure versioning).
 *
 * @see docs/family-billing/family-billing-agreements-epic.md §3.2
 */

import { z } from 'zod';
import { feeTypeEnum, feeFrequencyEnum, currencyEnum } from './common';
import { statusHistoryEntrySchema } from './invoice.schema';
import { uuidSchema, dateSchema } from '../common';

// ============================================================================
// ENUMS
// ============================================================================

export const agreementStatusEnum = z.enum([
  'draft',
  'active',
  'expired',
  'cancelled',
  'superseded',
]);
export type AgreementStatus = z.infer<typeof agreementStatusEnum>;

export const agreementTypeEnum = z.enum(['fixed_total', 'per_student']);
export type AgreementType = z.infer<typeof agreementTypeEnum>;

// ============================================================================
// PAYER
// ============================================================================

/**
 * The negotiating payer — a display snapshot captured at agreement time,
 * NOT a foreign key to an identity User or a guardian record.
 */
export const agreementPayerSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
});

export type AgreementPayer = z.infer<typeof agreementPayerSchema>;

// ============================================================================
// TERMS (discriminated union on agreementType)
// ============================================================================

export const agreementAllocationEntrySchema = z.object({
  studentId: uuidSchema,
  amount: z.number().positive().max(10_000_000),
});

export type AgreementAllocationEntry = z.infer<typeof agreementAllocationEntrySchema>;

/**
 * `fixed_total` — one negotiated family total, split per student. The
 * per-student `allocation` is what invoice generation prices each covered
 * sibling at (invoices stay per-student; agreements change amounts, not
 * structure). Cross-field invariants (allocation sums to totalAmount,
 * allocation students ≡ studentIds) live on the parent schemas — zod v3
 * discriminated-union members must stay plain ZodObjects.
 */
export const fixedTotalTermsSchema = z.object({
  agreementType: z.literal('fixed_total'),
  totalAmount: z.number().positive().max(10_000_000),
  allocation: z.array(agreementAllocationEntrySchema).min(1).max(30),
});

export type FixedTotalTerms = z.infer<typeof fixedTotalTermsSchema>;

export const agreementTermLineSchema = z.object({
  studentId: uuidSchema,
  /** Which standard feeType this line replaces; omit for a lump-sum line. */
  feeType: feeTypeEnum.optional(),
  /** Optional pin to the specific fee structure being overridden. */
  feeStructureId: uuidSchema.optional(),
  amount: z.number().positive().max(10_000_000),
});

export type AgreementTermLine = z.infer<typeof agreementTermLineSchema>;

/**
 * `per_student` — negotiated per-student amounts (PR-CA's shape). A student
 * may carry multiple lines (e.g. tuition + admission negotiated separately),
 * so line studentIds are NOT required to be distinct — only to reference
 * members of `studentIds` (parent-schema invariant).
 */
export const perStudentTermsSchema = z.object({
  agreementType: z.literal('per_student'),
  // 300 = the 30-student cap × the 10-value feeType enum; a valid payload
  // cannot meaningfully exceed it, and it keeps the DDB row bounded (R8).
  lines: z.array(agreementTermLineSchema).min(1).max(300),
});

export type PerStudentTerms = z.infer<typeof perStudentTermsSchema>;

export const agreementTermsSchema = z.discriminatedUnion('agreementType', [
  fixedTotalTermsSchema,
  perStudentTermsSchema,
]);

export type AgreementTerms = z.infer<typeof agreementTermsSchema>;

// ============================================================================
// CROSS-FIELD INVARIANTS (shared by response + create superRefine)
// ============================================================================

const distinct = (values: string[]): boolean => new Set(values).size === values.length;

interface AgreementCrossFields {
  studentIds: string[];
  agreementType: AgreementType;
  terms: AgreementTerms;
}

/**
 * Terms ↔ studentIds invariants:
 *   - `terms.agreementType` must mirror the top-level `agreementType`
 *   - fixed_total: Σ(allocation.amount) === totalAmount (±0.01 — same
 *     tolerance as the payment applications sum, SPEC-14); allocation
 *     studentIds distinct AND set-equal to the top-level studentIds
 *   - per_student: every line's studentId ∈ studentIds
 */
const agreementTermsInvariants = (a: AgreementCrossFields, ctx: z.RefinementCtx): void => {
  if (a.terms.agreementType !== a.agreementType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['terms', 'agreementType'],
      message:
        `terms.agreementType (${a.terms.agreementType}) must match the top-level `
        + `agreementType (${a.agreementType}).`,
    });
    return; // the branch checks below would be against the wrong shape
  }

  const studentIdSet = new Set(a.studentIds);

  if (a.terms.agreementType === 'fixed_total') {
    const allocation = a.terms.allocation;

    const sum = allocation.reduce((s, entry) => s + entry.amount, 0);
    if (Math.abs(sum - a.terms.totalAmount) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terms', 'allocation'],
        message:
          `Sum of allocation[].amount (${sum}) must equal terms.totalAmount `
          + `(${a.terms.totalAmount}). Difference: ${Math.abs(sum - a.terms.totalAmount).toFixed(2)}.`,
      });
    }

    const allocationIds = allocation.map((entry) => entry.studentId);
    if (!distinct(allocationIds)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terms', 'allocation'],
        message: 'allocation[].studentId entries must be distinct (one allocation per student).',
      });
    }

    const allocationIdSet = new Set(allocationIds);
    const unallocated = a.studentIds.filter((id) => !allocationIdSet.has(id));
    const nonMembers = allocationIds.filter((id) => !studentIdSet.has(id));
    if (unallocated.length > 0 || nonMembers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terms', 'allocation'],
        message:
          'allocation[].studentId must cover exactly the top-level studentIds. '
          + (unallocated.length > 0 ? `Missing allocation for: ${unallocated.join(', ')}. ` : '')
          + (nonMembers.length > 0 ? `Not in studentIds: ${nonMembers.join(', ')}.` : ''),
      });
    }
  } else {
    a.terms.lines.forEach((line, index) => {
      if (!studentIdSet.has(line.studentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['terms', 'lines', index, 'studentId'],
          message: `lines[${index}].studentId (${line.studentId}) is not in the top-level studentIds.`,
        });
      }
    });
  }
};

const termDatesInvariant = (
  a: { effectiveFrom: string; effectiveTo: string },
  ctx: z.RefinementCtx,
): void => {
  // YYYY-MM-DD strings compare correctly lexicographically. Strict <:
  // a zero-length term cannot cover any billing date.
  if (a.effectiveFrom >= a.effectiveTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effectiveTo'],
      message: `effectiveFrom (${a.effectiveFrom}) must be strictly before effectiveTo (${a.effectiveTo}).`,
    });
  }
};

// ============================================================================
// SHARED FIELD SCHEMAS
// ============================================================================

/** ≤30 students per agreement — DDB transactWrite ceiling bound (R8). */
const studentIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(30)
  .refine(distinct, { message: 'studentIds must be distinct.' });

/** Which standard feeTypes the agreement REPLACES; others bill normally. */
const coveredFeeTypesSchema = z
  .array(feeTypeEnum)
  .min(1)
  .refine(distinct, { message: 'coveredFeeTypes must be distinct.' });

// ============================================================================
// RESPONSE
// ============================================================================

export const billingAgreementResponseSchema = z
  .object({
    id: uuidSchema,
    schoolId: uuidSchema,
    /** Academics FamilyGroup reference. Absent for standalone per-student deals. */
    familyId: uuidSchema.optional(),
    title: z.string().min(1).max(160),
    payer: agreementPayerSchema,
    /**
     * Snapshot of the covered students. The agreement OWNS this list —
     * later family edits never silently change billing (epic §3.2).
     */
    studentIds: studentIdsSchema,
    agreementType: agreementTypeEnum,
    terms: agreementTermsSchema,
    coveredFeeTypes: coveredFeeTypesSchema,
    billingFrequency: feeFrequencyEnum,
    currency: currencyEnum,
    /** AD ISO YYYY-MM-DD; BS is display-only. */
    effectiveFrom: z.string(),
    effectiveTo: z.string(),
    status: agreementStatusEnum,
    /** Financial-term changes on an ACTIVE agreement create a new version. */
    version: z.number().int().min(1),
    versionParentId: uuidSchema.optional(),
    approvedBy: z.string().optional(),
    notes: z.string().optional(),

    // P1d — `isActive` (soft-delete flag) is intentionally NOT in the
    // response DTO. It stays on the entity + filter schemas; soft-deleted
    // rows are filtered server-side. See CLAUDE.md "Two orthogonal axes".
    statusHistory: z.array(statusHistoryEntrySchema),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((agreement, ctx) => {
    termDatesInvariant(agreement, ctx);
    agreementTermsInvariants(agreement, ctx);
  });

export type BillingAgreement = z.infer<typeof billingAgreementResponseSchema>;

// ============================================================================
// CREATE
// ============================================================================

/**
 * Create-agreement DTO (`POST /finance/schools/{schoolId}/agreements` —
 * schoolId from the route). `status`, `version`, `statusHistory`,
 * `approvedBy`, and `createdBy` are server-assigned (agreements are born
 * `draft`, version 1). Service-layer additionally validates: school exists,
 * currency matches the school's, every studentId enrolled (academics API),
 * and optional familyId membership (FB-2.3).
 */
export const createBillingAgreementSchema = z
  .object({
    familyId: uuidSchema.optional(),
    title: z.string().min(1).max(160),
    payer: agreementPayerSchema,
    studentIds: studentIdsSchema,
    agreementType: agreementTypeEnum,
    terms: agreementTermsSchema,
    coveredFeeTypes: coveredFeeTypesSchema,
    billingFrequency: feeFrequencyEnum,
    currency: currencyEnum.default('NPR'),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema,
    notes: z.string().max(500).optional(),
  })
  .superRefine((dto, ctx) => {
    termDatesInvariant(dto, ctx);
    agreementTermsInvariants(dto, ctx);
  });

export type CreateBillingAgreementDto = z.infer<typeof createBillingAgreementSchema>;

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Partial update (draft edits — FB-2.4; active-agreement changes go through
 * versioning, FB-3.6). Identity fields (`id`, `schoolId`) come from the
 * route, never the body.
 *
 * `version` is REQUIRED — optimistic concurrency travels in the body, not
 * an If-Match header (PR-CA locked convention). Stale version → 409.
 *
 * `agreementType` and `terms` must travel together (either both present or
 * both absent) so a payload can never leave the stored type and terms shape
 * inconsistent. Invariants that span fields absent from a partial payload
 * (e.g. new terms against unchanged studentIds) are re-validated server-side
 * against the merged entity.
 */
export const updateBillingAgreementSchema = z
  .object({
    /** `null` clears the family linkage (standalone agreement). */
    familyId: uuidSchema.nullable().optional(),
    title: z.string().min(1).max(160).optional(),
    payer: agreementPayerSchema.optional(),
    studentIds: studentIdsSchema.optional(),
    agreementType: agreementTypeEnum.optional(),
    terms: agreementTermsSchema.optional(),
    coveredFeeTypes: coveredFeeTypesSchema.optional(),
    billingFrequency: feeFrequencyEnum.optional(),
    currency: currencyEnum.optional(),
    effectiveFrom: dateSchema.optional(),
    effectiveTo: dateSchema.optional(),
    notes: z.string().max(500).optional(),
    version: z.number().int().min(1),
  })
  .superRefine((dto, ctx) => {
    if (dto.effectiveFrom !== undefined && dto.effectiveTo !== undefined) {
      termDatesInvariant({ effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo }, ctx);
    }

    if ((dto.agreementType === undefined) !== (dto.terms === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [dto.terms === undefined ? 'terms' : 'agreementType'],
        message: 'agreementType and terms must be updated together.',
      });
      return;
    }

    if (dto.terms !== undefined && dto.agreementType !== undefined) {
      agreementTermsInvariants(
        {
          // When studentIds is absent from the partial payload, validate the
          // terms-internal invariants only against the terms' own students;
          // the merged-entity check happens server-side.
          studentIds: dto.studentIds
            ?? (dto.terms.agreementType === 'fixed_total'
              ? dto.terms.allocation.map((entry) => entry.studentId)
              : Array.from(new Set(dto.terms.lines.map((line) => line.studentId)))),
          agreementType: dto.agreementType,
          terms: dto.terms,
        },
        ctx,
      );
    }
  });

export type UpdateBillingAgreementDto = z.infer<typeof updateBillingAgreementSchema>;

// ============================================================================
// FILTER
// ============================================================================

export const billingAgreementFilterSchema = z.object({
  status: agreementStatusEnum.optional(),
  studentId: uuidSchema.optional(),
  familyId: uuidSchema.optional(),
});

export type BillingAgreementFilterDto = z.infer<typeof billingAgreementFilterSchema>;

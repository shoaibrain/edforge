/**
 * Zod DTOs for NestJS — Finance Service
 *
 * Uses createZodDto() to wrap Zod schemas for NestJS validation pipes.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  createFeeStructureSchema,
  updateFeeStructureSchema,
  createBillingAgreementSchema,
  updateBillingAgreementSchema,
  generateInvoiceSchema,
  bulkGenerateInvoiceSchema,
  updateInvoiceSchema,
  initiatePaymentSchema,
  recordManualPaymentSchema,
  voidPaymentSchema,
  createRefundSchema,
  saveGatewayConfigSchema,
  createRefundRequestSchema,
  approveRefundSchema,
  rejectRefundSchema,
  createCreditNoteSchema,
  applyCreditNoteSchema,
  createDiscountRuleSchema,
  updateDiscountRuleSchema,
  setOpeningBalanceSchema,
} from '@aibrains/shared-types';

// Fee Structure DTOs
export class CreateFeeStructureDtoZ extends createZodDto(createFeeStructureSchema) {}
export class UpdateFeeStructureDtoZ extends createZodDto(updateFeeStructureSchema) {}

// Invoice DTOs
// EPIC-FB FB-3.4 — `overrideAgreement` is a service-local extension (mirror
// of the lifecycle-action bodies below): shared-types ships the CRUD
// contract; this pricing-bypass flag exists only on this route and is
// gated in-handler on billing:manage when present. `.and()` (intersection)
// instead of `.extend()`: this tsconfig has strictNullChecks off, so
// zod's addQuestionMarks would degrade a re-derived object type to
// all-optional; the intersection keeps the dist-baked required keys.
export class GenerateInvoiceDtoZ extends createZodDto(
  generateInvoiceSchema.and(z.object({ overrideAgreement: z.boolean().optional() })),
) {}
export class BulkGenerateInvoiceDtoZ extends createZodDto(bulkGenerateInvoiceSchema) {}
export class UpdateInvoiceDtoZ extends createZodDto(updateInvoiceSchema) {}

// Payment DTOs
export class InitiatePaymentDtoZ extends createZodDto(initiatePaymentSchema) {}
export class RecordManualPaymentDtoZ extends createZodDto(recordManualPaymentSchema) {}
export class VoidPaymentDtoZ extends createZodDto(voidPaymentSchema) {}
export class CreateRefundDtoZ extends createZodDto(createRefundSchema) {}

// Refund Request DTOs
export class CreateRefundRequestDtoZ extends createZodDto(createRefundRequestSchema) {}
export class ApproveRefundDtoZ extends createZodDto(approveRefundSchema) {}
export class RejectRefundDtoZ extends createZodDto(rejectRefundSchema) {}

// Credit Note DTOs
export class CreateCreditNoteDtoZ extends createZodDto(createCreditNoteSchema) {}
export class ApplyCreditNoteDtoZ extends createZodDto(applyCreditNoteSchema) {}

// Discount Rule DTOs
export class CreateDiscountRuleDtoZ extends createZodDto(createDiscountRuleSchema) {}
export class UpdateDiscountRuleDtoZ extends createZodDto(updateDiscountRuleSchema) {}

// Payment Gateway DTOs
export class SaveGatewayConfigDtoZ extends createZodDto(saveGatewayConfigSchema) {}

// Pilot Onboarding Hardening Sprint PD.1.5 — opening-balance PUT body
export class SetOpeningBalanceDtoZ extends createZodDto(setOpeningBalanceSchema) {}

// ============================================================================
// Billing Agreement DTOs — EPIC-FB Sprint FB-2.6 / FB-3.5
// ============================================================================

export class CreateBillingAgreementDtoZ extends createZodDto(createBillingAgreementSchema) {}
export class UpdateBillingAgreementDtoZ extends createZodDto(updateBillingAgreementSchema) {}

// Lifecycle action bodies are service-local (no cross-codebase consumer —
// AdminWeb/frontend consume via generated clients from the API GW spec, and
// the shared-types package deliberately ships only the CRUD contract).
// `version` = optimistic-concurrency token in the body (PR-CA convention).
const activateAgreementSchema = z.object({
  version: z.number().int().min(1),
  /**
   * FB-3.5 warning-with-listing: activation 409s with the open standard
   * invoices covering the agreement's coveredFeeTypes unless the operator
   * acknowledges having seen the list.
   */
  acknowledgeOpenInvoices: z.boolean().optional(),
});

const cancelAgreementSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});

export class ActivateAgreementDtoZ extends createZodDto(activateAgreementSchema) {}
export class CancelAgreementDtoZ extends createZodDto(cancelAgreementSchema) {}

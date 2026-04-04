/**
 * Zod DTOs for NestJS — Finance Service
 *
 * Uses createZodDto() to wrap Zod schemas for NestJS validation pipes.
 */

import { createZodDto } from 'nestjs-zod';
import {
  createFeeStructureSchema,
  updateFeeStructureSchema,
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
} from '@aibrains/shared-types';

// Fee Structure DTOs
export class CreateFeeStructureDtoZ extends createZodDto(createFeeStructureSchema) {}
export class UpdateFeeStructureDtoZ extends createZodDto(updateFeeStructureSchema) {}

// Invoice DTOs
export class GenerateInvoiceDtoZ extends createZodDto(generateInvoiceSchema) {}
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

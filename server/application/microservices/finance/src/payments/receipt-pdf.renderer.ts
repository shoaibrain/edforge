/**
 * Receipt PDF renderer — Sprint C.1.6.
 *
 * Mirror of `invoice-pdf.renderer.ts` (C.1.5) for the RECEIPT docType.
 * Pure function: `(payment, invoice, branding, urls, templateConfig, locale)
 * → Buffer`. No I/O. Maps finance-side persisted state onto the
 * `<ReceiptPdf>` React component shipped by `@aibrains/pdf-renderer`.
 *
 * **Why payment + invoice both?** Receipts are derived from a completed
 * payment, but the line-item detail + student metadata live on the
 * invoice the payment satisfies. The existing `getReceipt()` JSON
 * endpoint already does this join (payments.service.ts:372-415) — we
 * duplicate the projection here rather than calling `getReceipt()`
 * because:
 *   1. `getReceipt()` returns `Receipt` (JSON-API shape) which is lossy
 *      vs. what the PDF can render (no academicYear / gradeLevel /
 *      billingPeriod).
 *   2. Reuse would pin a service-to-service coupling in the wrong
 *      direction (renderer depending on the JSON DTO shape).
 *
 * **Status mapping** — finance `PaymentEntity.status` enum has
 * `'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' |
 * 'refunded'`. The receipt PDF endpoint only renders for `'completed'`
 * (caller enforces). At render time we always pass `status: 'paid'` —
 * the renderer-side `'voided' | 'refunded'` watermark cases are
 * reserved for future void/refund-receipt flows. V1 covers the
 * happy-path receipt only.
 *
 * **React.createElement vs JSX:** Same `.ts` (no `.tsx`) discipline as
 * C.1.5 — keeps finance webpack pipeline untouched.
 */

import * as React from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import {
  ReceiptPdf,
  type ReceiptTemplateConfig,
  type ReceiptDocumentData,
  type PdfBranding,
  type PdfLocaleSettings,
} from '@aibrains/pdf-renderer';
import type { PaymentEntity } from '../common/entities/payment.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type {
  SchoolBrandingResponse,
  BrandingAssetUrls,
} from '../common/services/identity-client.service';

/**
 * Friendly display names for the payment gateways. Keeping the table
 * local (vs an exported helper in shared-types) because the receipt-PDF
 * specific mapping ("Cash" not "cash"; "Bank transfer" not "bank_transfer")
 * is presentation-layer, not domain-layer.
 */
const GATEWAY_DISPLAY: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  esewa: 'eSewa',
  khalti: 'Khalti',
  stripe: 'Card',
  card: 'Card',
};

function gatewayDisplayName(gateway: string): string {
  return GATEWAY_DISPLAY[gateway] ?? gateway.charAt(0).toUpperCase() + gateway.slice(1);
}

export interface RenderReceiptInput {
  /** Source-of-truth payment (status MUST be `'completed'` — caller enforces). */
  payment: PaymentEntity;
  /** Invoice the payment satisfies — supplies line items + student metadata. */
  invoice: InvoiceEntity;
  /** Identity-side branding sub-document; `null` when school hasn't configured. */
  branding: SchoolBrandingResponse | null;
  /** Short-lived signed S3 URLs for branding assets (10-min TTL). */
  urls: BrandingAssetUrls | undefined;
  /** Receipt template config — from `IdentityClient.getCurrentTemplate('RECEIPT', ...)`. */
  templateConfig: ReceiptTemplateConfig;
  /** BCP-47 locale for `formatCurrency`. */
  locale: string;
  /**
   * Operator-facing school roll number (primary student identifier on the
   * receipt). Sourced from academics via IdentityClient.getStudentInfo —
   * never the internal `studentId` UUID.
   */
  studentNumber?: string;
  /** CEHRD/IEMIS government identifier (secondary — for official reconciliation). */
  emisStudentId?: string;
}

/**
 * Render a payment receipt to a PDF buffer. Pure function.
 *
 * Maps:
 *   - `payment.receiptNumber || synthesized fallback` → ReceiptDocumentData.receiptNumber
 *   - `payment.gateway → gatewayDisplayName(...)` → paymentMethod
 *   - `payment.gatewayTransactionId ?? payment.paymentId` → transactionId
 *   - `payment.paidBy ?? invoice.studentName` → paidBy (fallback to student
 *     name for cash payments where paidBy was not captured at recording)
 *   - `invoice.lineItems` → ReceiptDocumentData.lineItems (project the
 *     subset of fields ReceiptDocumentData needs)
 *   - `invoice` totals → same totals on ReceiptDocumentData
 *   - `payment.amount` → ReceiptDocumentData.paidAmount (DISTINCT from
 *     invoice.grandTotal — supports partial payments where the receipt
 *     reports the actual transferred amount)
 *   - `invoice.{subtotal − discountTotal}` → taxableAmount (the base
 *     against which VAT was applied)
 *   - `invoice.taxTotal` → taxAmount
 *   - `branding` (PAN/VAT/etc.) → PdfBranding (school-level overrides)
 */
/**
 * Pilot Onboarding Hardening Sprint PD.2.4 — build the receipt's
 * `notes` body when a payment carries a per-target allocation split
 * (PD.2.1 `payment.applications`).
 *
 * V1 surfaces the breakdown via the existing `ReceiptDocumentData.notes`
 * field — already rendered on the template at L462 of ReceiptPdf.tsx.
 * Avoids a pdf-renderer package bump for the pilot. V1.5 may extend
 * `ReceiptDocumentData` with a structured `applications` field + a
 * dedicated "Applied to" section.
 *
 * Returns undefined for legacy payments (no `applications`) and for
 * payments with a single invoice-only application — the existing
 * single-invoice layout already carries the full context.
 */
function buildApplicationsNote(
  payment: PaymentEntity,
  invoice: InvoiceEntity,
  formatAmount: (n: number) => string,
): string | undefined {
  if (!payment.applications || payment.applications.length === 0) return undefined;

  // Pure single-invoice payment — the existing receipt body already
  // names the invoice in `invoiceNumber`; no extra note needed.
  if (
    payment.applications.length === 1
    && payment.applications[0].targetType === 'invoice'
  ) {
    return undefined;
  }

  const lines = payment.applications.map(app => {
    if (app.targetType === 'invoice') {
      return `${formatAmount(app.amount)} → invoice ${invoice.invoiceNumber}`;
    }
    return `${formatAmount(app.amount)} → previous balance (carry-forward)`;
  });
  return `Applied: ${lines.join('; ')}.`;
}

export async function renderReceiptToPdfBuffer(input: RenderReceiptInput): Promise<Buffer> {
  const { payment, invoice, branding, urls, templateConfig, locale, studentNumber, emisStudentId } = input;

  const taxableAmount = invoice.subtotal - invoice.discountTotal;

  // PD.2.4 — currency is the same across invoice + payment + opening
  // balance (validated at recordManualPayment). Format with a stable
  // 2-decimal shape for receipt readability — locale-aware grouping
  // pulls from `Intl.NumberFormat`.
  const formatAmount = (n: number): string =>
    `${payment.currency} ${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)}`;

  const applicationsNote = buildApplicationsNote(payment, invoice, formatAmount);

  const data: ReceiptDocumentData = {
    receiptNumber: payment.receiptNumber ?? `RCP-${payment.paymentId.substring(0, 8)}`,
    paidDate: payment.paidAt ?? payment.createdAt,
    invoiceNumber: invoice.invoiceNumber,
    transactionId: payment.gatewayTransactionId ?? payment.paymentId,
    paymentMethod: gatewayDisplayName(payment.gateway),
    // `paidBy` on a cash payment is often the operator who recorded the
    // payment; on a gateway payment it's the cardholder. When absent (older
    // records), fall back to the student name so the receipt still shows
    // *someone* on the "Paid By" line.
    paidBy: payment.paidBy ?? invoice.studentName,
    studentName: invoice.studentName,
    studentNumber,
    emisStudentId,
    gradeLevel: invoice.gradeLevel,
    academicYear: invoice.academicYear,
    billingPeriod: invoice.billingPeriod,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      amount: li.amount,
      taxAmount: li.taxAmount,
      total: li.total,
      // ReceiptLineItem doesn't surface quantity/discount/taxRate to the
      // renderer (the receipt template's LineItemTable shows only 4
      // columns); pass-through anyway since `LineItem` is structurally
      // typed and the renderer ignores fields not in its template config.
      quantity: li.quantity,
      discount: li.discount,
      taxRate: li.taxRate,
    })),
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    discountTotal: invoice.discountTotal,
    grandTotal: invoice.grandTotal,
    // paidAmount is the actual transferred amount — equals grandTotal for
    // full-pay (the typical case) but distinct for partial-pay where a
    // future PR would render a separate `outstandingBalance` line.
    paidAmount: payment.amount,
    currency: payment.currency,
    taxableAmount,
    taxAmount: invoice.taxTotal,
    // PD.2.4 — surface split-allocation breakdown via the existing
    // `notes` field (renders at ReceiptPdf.tsx:462). Single-invoice
    // payments + pre-PD payments produce undefined → notes block hidden.
    ...(applicationsNote ? { notes: applicationsNote } : {}),
    // V1: only `'completed'` payments reach the receipt-PDF endpoint
    // (caller enforces in PaymentsService.getReceiptPdf). The renderer's
    // `'voided' | 'refunded'` watermark cases are reserved for future
    // void/refund-receipt flows.
    status: 'paid',
  };

  const pdfBranding: PdfBranding = {
    schoolName: invoice.schoolName,
    formalName: branding?.formalName,
    addressLines: branding?.addressLines,
    phone: branding?.phone,
    email: branding?.email,
    panNumber: branding?.panNumber,
    vatNumber: branding?.vatNumber,
    tagline: branding?.tagline,
    primaryColor: branding?.colorPalette?.primary,
    accentColor: branding?.colorPalette?.accent,
    logoSrc: urls?.logo,
    principalSignatureSrc: urls?.principalSignature,
    // **V1 letterhead-deferred** (Path E decision 2026-05-27 PM) — mirrors
    // the invoice-pdf.renderer.ts comment. Custom letterhead PNGs are not
    // forwarded to the renderer in V1; <BrandedHeader> + <BrandedFooter>
    // are the canonical chrome. Returns in V1.5 alongside the C.2 Template
    // Editor + live preview.
  };

  const settings: PdfLocaleSettings = {
    defaultLocale: locale,
    defaultCurrency: payment.currency,
    defaultCalendarSystem:
      templateConfig.dateFormat === 'gregorian' ? 'gregorian' : 'bikram_sambat',
  };

  const element = React.createElement(ReceiptPdf, {
    data,
    template: templateConfig,
    branding: pdfBranding,
    settings,
  });

  // Same cast-at-boundary rationale as invoice-pdf.renderer.ts — strict
  // `ReactElement<DocumentProps>` vs the FC-wrapped element type.
  return renderToBuffer(element as unknown as React.ReactElement<DocumentProps>);
}

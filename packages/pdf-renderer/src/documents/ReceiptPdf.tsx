/**
 * `<ReceiptPdf>` — Sprint C.1.2 second document component.
 *
 * Composition exercise mirroring `<InvoicePdf>`: zero new primitives, all
 * structure assembled from C.0.3 primitives (Document + Page + BrandedHeader
 * + BrandedFooter + Watermark) and C.0.3 components (KeyValueTable +
 * LineItemTable + TotalsBlock + SignatureLine).
 *
 * Receipts differ from invoices in three ways that shape this document:
 *   1. Always issued AFTER a completed payment — no due-date concept; line
 *      items list what was charged, totals show what was paid.
 *   2. Carry payment-channel metadata (gateway / transaction ID / paid-by)
 *      that invoices don't have. Rendered in a second `KeyValueTable` block.
 *   3. PABSON tenants require PAN/VAT/taxable-amount/tax-amount disclosure
 *      for VAT compliance — surfaced as a third metadata block when both
 *      `taxBreakdownSection.show*` toggles are on and the values are present
 *      on `branding.panNumber` / `branding.vatNumber`.
 *
 * Watermark is applied for `status: 'voided' | 'refunded'`. The "happy path"
 * status `'paid'` renders without a watermark (a paid receipt is the normal
 * artifact).
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { Document } from '../primitives/Document';
import { Page } from '../primitives/Page';
import { BrandedHeader } from '../primitives/BrandedHeader';
import { BrandedFooter } from '../primitives/BrandedFooter';
import { Watermark } from '../primitives/Watermark';
import { KeyValueTable, type KeyValueEntry } from '../components/KeyValueTable';
import { LineItemTable, type LineItem } from '../components/LineItemTable';
import { TotalsBlock } from '../components/TotalsBlock';
import { SignatureLine } from '../components/SignatureLine';
import { t, type Lang } from '../core/i18n';
import { formatDate, formatNumber, formatCurrency } from '../core/format';
import { pickFontFamily } from '../core/fonts';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import type {
  DocumentComponentProps,
  PdfTemplateConfig,
} from '../descriptors/types';

/**
 * Per-doc-type config for receipts. Extends the shared `PdfTemplateConfig`
 * with receipt-specific toggles: a slimmer set of line-item columns (no
 * quantity/discount/taxRate — receipts don't itemize those the way invoices
 * do), payment-channel detail visibility, and a tax-breakdown section.
 */
export interface ReceiptTemplateConfig extends PdfTemplateConfig {
  /**
   * Receipt line-item table only exposes the four columns relevant to a
   * payment record. `description`, `amount`, and `total` are always shown
   * (enforced at runtime by LineItemTable's REQUIRED_COLUMNS set); only
   * `taxAmount` is operator-configurable.
   */
  lineItemColumns: {
    description: boolean;
    amount: boolean;
    taxAmount: boolean;
    total: boolean;
  };
  totalsSection: {
    showSubtotal: boolean;
    showTaxTotal: boolean;
    showDiscountTotal: boolean;
  };
  paymentDetails: {
    showPaymentMethod: boolean;
    showTransactionId: boolean;
    showPaidBy: boolean;
  };
  taxBreakdownSection: {
    showPanNumber: boolean;
    showVatNumber: boolean;
  };
  footer: PdfTemplateConfig['footer'] & {
    showSignatureLine: boolean;
    showThankYou: boolean;
  };
}

/**
 * Receipt data shape the document component renders.
 *
 * Mirrors the `Receipt` zod schema in `@aibrains/shared-types/finance` but
 * declared locally because (a) the renderer is published as its own npm
 * package and shouldn't take a peer-dep on the consumer's shared-types
 * version, and (b) structural typing lets endpoints pass the full shared
 * shape — extra fields fall through harmlessly.
 */
export interface ReceiptDocumentData {
  receiptNumber: string;
  paidDate: string;
  invoiceNumber: string;
  /** Optional — typically the gateway-side ID for digital payments (eSewa, Khalti, gateway txn refs). */
  transactionId?: string;
  /** Display name for the gateway/method, e.g. 'eSewa', 'Cash', 'Bank transfer'. */
  paymentMethod: string;
  paidBy: string;
  studentName: string;
  studentId?: string;
  gradeLevel?: string;
  academicYear?: string;
  billingPeriod?: string;
  lineItems: LineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  /**
   * Amount captured by this payment. For typical full-pay receipts this
   * equals `grandTotal`; partial-payment flows can show a smaller value
   * here while keeping `grandTotal` as the invoice's full amount.
   */
  paidAmount: number;
  currency: string;
  /**
   * Tax-compliance block. PAN/VAT come from `branding` (school-level); the
   * `taxableAmount` + `taxAmount` are receipt-level. All four are required
   * for the rendered block to appear when the operator has both
   * `taxBreakdownSection.showPanNumber` and `showVatNumber` toggled on.
   */
  taxableAmount?: number;
  taxAmount?: number;
  notes?: string;
  /**
   * V1 supports three lifecycle states. `'paid'` is the normal artifact (no
   * watermark). `'voided'` + `'refunded'` get watermarks to clearly mark the
   * document as no-longer-the-source-of-truth.
   */
  status: 'paid' | 'voided' | 'refunded';
}

const styles = StyleSheet.create({
  metaBlock: {
    marginTop: DEFAULT_SPACING.md,
    marginBottom: DEFAULT_SPACING.sm,
  },
  sectionTitle: {
    fontSize: DEFAULT_FONT_SIZE.md,
    fontWeight: 700,
    color: DEFAULT_COLORS.text,
    marginBottom: DEFAULT_SPACING.xs,
  },
  sectionTitleSecondary: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.textMuted,
    marginBottom: DEFAULT_SPACING.sm,
  },
  subsectionTitle: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    fontWeight: 700,
    color: DEFAULT_COLORS.text,
    marginTop: DEFAULT_SPACING.sm,
    marginBottom: DEFAULT_SPACING.xs,
  },
  notesBlock: {
    marginTop: DEFAULT_SPACING.md,
    padding: DEFAULT_SPACING.sm,
    backgroundColor: '#F8F9FA',
    borderLeftWidth: 3,
    borderLeftColor: DEFAULT_COLORS.border,
  },
  notesText: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
  thankYouBlock: {
    marginTop: DEFAULT_SPACING.lg,
    textAlign: 'center',
  },
  thankYouText: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    fontWeight: 700,
    color: DEFAULT_COLORS.text,
  },
});

function buildPrimary(key: string, langs: readonly Lang[]): string {
  return t('receipt', key, langs[0]);
}

function buildSecondary(key: string, langs: readonly Lang[]): string | undefined {
  return langs.length >= 2 ? t('receipt', key, langs[1]) : undefined;
}

const dualLabelStyles = StyleSheet.create({
  primary: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
  secondary: {
    fontSize: DEFAULT_FONT_SIZE.sm * 0.8,
    color: DEFAULT_COLORS.textMuted,
  },
});

/**
 * Stacked dual-language label primitive — same pattern InvoicePdf uses.
 * Small enough to inline; not worth extracting to its own primitive yet.
 */
const DualLabel: React.FC<{ primary: string; secondary?: string }> = ({ primary, secondary }) => (
  <View>
    <Text style={[dualLabelStyles.primary, { fontFamily: pickFontFamily(primary) }]}>{primary}</Text>
    {secondary && (
      <Text style={[dualLabelStyles.secondary, { fontFamily: pickFontFamily(secondary) }]}>
        {secondary}
      </Text>
    )}
  </View>
);

export const ReceiptPdf: React.FC<DocumentComponentProps<ReceiptDocumentData, ReceiptTemplateConfig>> = ({
  data,
  template,
  branding,
  settings,
}) => {
  const langs = template.labelLanguages;
  const isDualLang = langs.length >= 2;

  const numberGrouping = template.numberFormat === 'auto-from-workspace'
    ? 'western'
    : template.numberFormat;
  const renderNumber = (v: number | undefined): string => formatNumber(v ?? 0, numberGrouping);
  const renderCurrency = (v: number): string =>
    formatCurrency(v, data.currency, {
      locale: settings.defaultLocale,
      showSymbol: template.currencyDisplay === 'symbol',
    });

  const headerConfig = {
    showLogo: template.header.showLogo,
    showSchoolName: template.header.showSchoolName,
    showSchoolAddress: template.header.showSchoolAddress,
    showContact: template.header.showContact,
    tagline: template.header.tagline,
    primaryColor: template.brandingOverrides?.primaryColor,
  };
  const headerBranding = {
    logoSrc: template.brandingOverrides?.logoSrc ?? branding.logoSrc,
    schoolName: branding.schoolName,
    addressLines: template.brandingOverrides?.addressLines ?? branding.addressLines,
    phone: branding.phone,
    email: branding.email,
  };

  // Watermark on voided / refunded receipts (paid is the happy path, no mark).
  const watermarkLabel =
    data.status === 'voided'
      ? t('receipt', 'watermarkVoided', langs[0])
      : data.status === 'refunded'
        ? t('receipt', 'watermarkRefunded', langs[0])
        : undefined;

  // Primary metadata block — receipt-specific keys (no due-date concept).
  const metadataEntries: KeyValueEntry[] = [
    { label: buildPrimary('receiptNumber', langs), value: data.receiptNumber },
    { label: buildPrimary('paymentDate', langs), value: formatDate(data.paidDate, template.dateFormat) },
    { label: buildPrimary('invoiceRef', langs), value: data.invoiceNumber },
    { label: buildPrimary('studentName', langs), value: data.studentName },
    { label: buildPrimary('studentId', langs), value: data.studentId },
    { label: buildPrimary('gradeLevel', langs), value: data.gradeLevel },
    { label: buildPrimary('academicYear', langs), value: data.academicYear },
    { label: buildPrimary('billingPeriod', langs), value: data.billingPeriod },
  ];

  // Payment-channel block — entries collapse to [] when all toggles are off,
  // so an operator who wants a minimal receipt drops the whole sub-section.
  const paymentEntries: KeyValueEntry[] = [];
  if (template.paymentDetails.showPaymentMethod) {
    paymentEntries.push({ label: buildPrimary('paymentMethod', langs), value: data.paymentMethod });
  }
  if (template.paymentDetails.showTransactionId && data.transactionId) {
    paymentEntries.push({ label: buildPrimary('transactionId', langs), value: data.transactionId });
  }
  if (template.paymentDetails.showPaidBy) {
    paymentEntries.push({ label: buildPrimary('paidBy', langs), value: data.paidBy });
  }

  // Tax-breakdown block — PABSON VAT-compliance requirement. PAN/VAT come from
  // branding (school-level); taxableAmount/taxAmount are receipt-level. The
  // entire sub-section is gated by operator toggles: when both showPanNumber
  // AND showVatNumber are off, the operator has opted out of tax disclosure
  // and NO row in this block renders — including the receipt-level amounts.
  // This guards against the case where data carries tax figures but the
  // operator wanted them suppressed (e.g., non-PABSON tenant + GENERIC
  // profile + nonzero data.taxAmount).
  const taxEntries: KeyValueEntry[] = [];
  const taxBreakdownEnabled =
    template.taxBreakdownSection.showPanNumber || template.taxBreakdownSection.showVatNumber;
  if (taxBreakdownEnabled) {
    if (template.taxBreakdownSection.showPanNumber && branding.panNumber) {
      taxEntries.push({ label: buildPrimary('panNumber', langs), value: branding.panNumber });
    }
    if (template.taxBreakdownSection.showVatNumber && branding.vatNumber) {
      taxEntries.push({ label: buildPrimary('vatNumber', langs), value: branding.vatNumber });
    }
    if (data.taxableAmount !== undefined && data.taxableAmount > 0) {
      taxEntries.push({
        label: buildPrimary('taxableAmount', langs),
        value: renderCurrency(data.taxableAmount),
      });
    }
    if (data.taxAmount !== undefined && data.taxAmount > 0) {
      taxEntries.push({
        label: buildPrimary('taxAmountLabel', langs),
        value: renderCurrency(data.taxAmount),
      });
    }
  }

  // LineItemTable requires the full 7-column shape — receipts hardcode the
  // four irrelevant columns to false so they never render, then forward the
  // single configurable column (`taxAmount`) from template config.
  const lineItemColumns = {
    description: true,
    quantity: false,
    amount: true,
    discount: false,
    taxRate: false,
    taxAmount: template.lineItemColumns.taxAmount,
    total: true,
  };

  return (
    <Document title={`Receipt ${data.receiptNumber}`} subject="Payment Receipt">
      <Page
        size={template.pageSize}
        orientation={template.orientation}
        margins={template.margins}
      >
        {watermarkLabel && <Watermark text={watermarkLabel} />}

        <BrandedHeader branding={headerBranding} config={headerConfig} />

        {/* Title — bilingual when dual-lang. */}
        <View style={styles.metaBlock}>
          <Text style={[styles.sectionTitle, { fontFamily: pickFontFamily(buildPrimary('title', langs)) }]}>
            {buildPrimary('title', langs)}
          </Text>
          {isDualLang && (
            <Text
              style={[
                styles.sectionTitleSecondary,
                { fontFamily: pickFontFamily(buildSecondary('title', langs) ?? '') },
              ]}
            >
              {buildSecondary('title', langs)}
            </Text>
          )}
          <KeyValueTable entries={metadataEntries} />
        </View>

        {/* Payment-channel block — only rendered when the operator has at
            least one of the three sub-toggles on AND the corresponding data
            is present. Section title is dual-language for parity with the
            primary metadata block. */}
        {paymentEntries.length > 0 && (
          <View style={styles.metaBlock}>
            <DualLabel
              primary={buildPrimary('paymentDetailsTitle', langs)}
              secondary={buildSecondary('paymentDetailsTitle', langs)}
            />
            <KeyValueTable entries={paymentEntries} />
          </View>
        )}

        {/* Line items — receipt simplifies to description / amount / tax / total. */}
        <LineItemTable
          items={data.lineItems}
          columns={lineItemColumns}
          headers={{
            description: buildPrimary('description', langs),
            quantity: '',
            amount: buildPrimary('amount', langs),
            discount: '',
            taxRate: '',
            taxAmount: buildPrimary('taxAmount', langs),
            total: buildPrimary('total', langs),
          }}
          renderNumber={renderNumber}
        />

        <TotalsBlock
          entries={{
            subtotal: data.subtotal,
            taxTotal: data.taxTotal,
            discountTotal: data.discountTotal,
            grandTotal: data.grandTotal,
            amountPaid: data.paidAmount,
            // amountDue intentionally omitted — by definition a receipt
            // documents an applied payment; there is no "amount due" line.
            amountDue: undefined,
          }}
          visibility={{
            showSubtotal: template.totalsSection.showSubtotal,
            showTaxTotal: template.totalsSection.showTaxTotal,
            showDiscountTotal: template.totalsSection.showDiscountTotal,
            showAmountPaid: true,
            showAmountDue: false,
          }}
          labels={{
            subtotal: buildPrimary('subtotal', langs),
            taxTotal: buildPrimary('totalTax', langs),
            discountTotal: buildPrimary('totalDiscount', langs),
            grandTotal: buildPrimary('grandTotal', langs),
            amountPaid: buildPrimary('paidAmount', langs),
            amountDue: '',
          }}
          renderCurrency={renderCurrency}
        />

        {/* Tax-breakdown — PABSON VAT compliance. Skip when no entries
            resolve (small schools without PAN/VAT registration). */}
        {taxEntries.length > 0 && (
          <View style={styles.metaBlock}>
            <DualLabel
              primary={buildPrimary('taxBreakdownTitle', langs)}
              secondary={buildSecondary('taxBreakdownTitle', langs)}
            />
            <KeyValueTable entries={taxEntries} />
          </View>
        )}

        {data.notes && (
          <View style={styles.notesBlock}>
            <DualLabel
              primary={buildPrimary('notes', langs)}
              secondary={buildSecondary('notes', langs)}
            />
            <Text style={[styles.notesText, { fontFamily: pickFontFamily(data.notes) }]}>
              {data.notes.length > 500 ? `${data.notes.slice(0, 500)}…` : data.notes}
            </Text>
          </View>
        )}

        {template.footer.showThankYou && (
          <View style={styles.thankYouBlock}>
            <Text
              style={[styles.thankYouText, { fontFamily: pickFontFamily(buildPrimary('thankYou', langs)) }]}
            >
              {buildPrimary('thankYou', langs)}
            </Text>
            {isDualLang && (
              <Text
                style={[
                  dualLabelStyles.secondary,
                  { fontFamily: pickFontFamily(buildSecondary('thankYou', langs) ?? '') },
                ]}
              >
                {buildSecondary('thankYou', langs)}
              </Text>
            )}
          </View>
        )}

        {template.footer.showSignatureLine && (
          <SignatureLine
            caption={branding.formalName ?? branding.schoolName ?? ''}
            signatureSrc={branding.principalSignatureSrc}
            align="right"
          />
        )}

        <BrandedFooter
          text={template.footer.text}
          showPageNumbers={template.footer.showPageNumbers}
          lang={langs[0]}
        />
      </Page>
    </Document>
  );
};

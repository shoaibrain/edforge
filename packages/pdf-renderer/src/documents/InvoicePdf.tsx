/**
 * `<InvoicePdf>` — Sprint C.1.1 first document component for the renderer.
 *
 * Composes the C.0 primitives (Document + Page + BrandedHeader + BrandedFooter
 * + Watermark) with the C.0 components (KeyValueTable + LineItemTable +
 * TotalsBlock + SignatureLine). Zero new primitives — this whole document is
 * a composition exercise.
 *
 * Dual-language label rendering: when `template.labelLanguages.length === 2`,
 * each label renders STACKED VERTICALLY (primary in regular size, secondary
 * at 80% size below). PABSON V1 default is `['en', 'ne']`. For single-language
 * templates the secondary line is omitted entirely.
 *
 * Devanagari font selection is automatic via `pickFontFamily(text)` inside the
 * primitive components — no work required by this document.
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
 * Per-doc-type config for invoices. Extends the shared `PdfTemplateConfig`
 * with line-item column visibility + totals-block visibility — both editor-
 * configurable via `invoiceDescriptor.configurableFields`.
 */
export interface InvoiceTemplateConfig extends PdfTemplateConfig {
  lineItemColumns: {
    description: boolean;
    quantity: boolean;
    amount: boolean;
    discount: boolean;
    taxRate: boolean;
    taxAmount: boolean;
    total: boolean;
  };
  totalsSection: {
    showSubtotal: boolean;
    showTaxTotal: boolean;
    showDiscountTotal: boolean;
    showAmountPaid: boolean;
    showAmountDue: boolean;
  };
  footer: PdfTemplateConfig['footer'] & {
    showSignatureLine: boolean;
  };
}

/**
 * Invoice data shape the document component renders. This is the minimum
 * surface the renderer needs — the actual @aibrains/shared-types Invoice
 * has more fields (taxSummary, statusHistory, etc.) that the renderer
 * ignores. Endpoint callers can pass the full Invoice; structural typing
 * lets the extra fields through harmlessly.
 */
export interface InvoiceDocumentData {
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string;
  academicYear?: string;
  billingPeriod?: string;
  studentName: string;
  studentId?: string;
  gradeLevel?: string;
  lineItems: LineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled' | 'written_off';
  notes?: string;
}

const styles = StyleSheet.create({
  metaBlock: {
    marginTop: DEFAULT_SPACING.md,
    marginBottom: DEFAULT_SPACING.md,
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
  notesBlock: {
    marginTop: DEFAULT_SPACING.md,
    padding: DEFAULT_SPACING.sm,
    backgroundColor: '#F8F9FA',
    borderLeftWidth: 3,
    borderLeftColor: DEFAULT_COLORS.border,
  },
  notesLabel: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    fontWeight: 700,
    color: DEFAULT_COLORS.text,
    marginBottom: DEFAULT_SPACING.xs,
  },
  notesText: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
});

/**
 * Build a one-line label per the template's labelLanguages. Returns the
 * primary translation; the caller renders the secondary (if present)
 * separately via `buildSecondary`.
 */
function buildPrimary(key: string, langs: readonly Lang[]): string {
  return t('invoice', key, langs[0]);
}

/**
 * Returns the secondary-language label when the template is dual-language,
 * else undefined. The caller renders it stacked below the primary at 80%
 * size with the same family.
 */
function buildSecondary(key: string, langs: readonly Lang[]): string | undefined {
  return langs.length >= 2 ? t('invoice', key, langs[1]) : undefined;
}

/**
 * Dual-language label for free-form labels (not for the table headers which
 * use a single string and are themselves bilingual via Devanagari font run).
 */
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

/** Stacked dual-language label primitive (small enough to inline here). */
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

export const InvoicePdf: React.FC<DocumentComponentProps<InvoiceDocumentData, InvoiceTemplateConfig>> = ({
  data,
  template,
  branding,
  settings,
}) => {
  const langs = template.labelLanguages;
  const isDualLang = langs.length >= 2;
  // Number + currency formatters bound once per render
  const numberGrouping = template.numberFormat === 'auto-from-workspace'
    ? 'western'
    : template.numberFormat;
  const renderNumber = (v: number | undefined): string => formatNumber(v ?? 0, numberGrouping);
  // Currency display: shared-types `formatCurrency` exposes `showSymbol` only;
  // map V1 `'symbol'` → showSymbol:true and `'iso-code'`/`'name'` → false (the
  // ISO code prefix is added by the shared-types implementation as the
  // fallback shape). When showSymbol is true the symbol/native symbol is used.
  const renderCurrency = (v: number): string =>
    formatCurrency(v, data.currency, {
      locale: settings.defaultLocale,
      showSymbol: template.currencyDisplay === 'symbol',
    });

  // Header label resolution — uses BrandedHeader's own config shape
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

  // Watermark on draft / cancelled invoices
  const watermarkLabel =
    data.status === 'draft'
      ? t('invoice', 'watermarkDraft', langs[0])
      : data.status === 'cancelled'
        ? t('invoice', 'watermarkCancelled', langs[0])
        : undefined;

  // KeyValueTable expects pre-formatted strings; build them with dual-lang
  // labels rendered ABOVE each value would require a custom row primitive,
  // so V1 uses primary-language labels in the metadata table and emits
  // a small bilingual title above it. Acceptable trade-off; the table
  // itself stays in C.0's existing API.
  const metadataEntries: KeyValueEntry[] = [
    { label: buildPrimary('invoiceNumber', langs), value: data.invoiceNumber },
    { label: buildPrimary('issuedDate', langs), value: formatDate(data.issuedDate, template.dateFormat) },
    { label: buildPrimary('dueDate', langs), value: formatDate(data.dueDate, template.dateFormat) },
    { label: buildPrimary('studentName', langs), value: data.studentName },
    { label: buildPrimary('gradeLevel', langs), value: data.gradeLevel },
    { label: buildPrimary('academicYear', langs), value: data.academicYear },
    { label: buildPrimary('billingPeriod', langs), value: data.billingPeriod },
  ];

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} subject="Invoice">
      <Page
        size={template.pageSize}
        orientation={template.orientation}
        margins={template.margins}
      >
        {watermarkLabel && <Watermark text={watermarkLabel} />}

        <BrandedHeader branding={headerBranding} config={headerConfig} />

        {/* Section title — bilingual when dual-lang */}
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

        {/* Line items — table headers use primary-language labels. Devanagari
            shaping kicks in automatically via pickFontFamily inside the table. */}
        <LineItemTable
          items={data.lineItems}
          columns={template.lineItemColumns}
          headers={{
            description: buildPrimary('description', langs),
            quantity: buildPrimary('quantity', langs),
            amount: buildPrimary('amount', langs),
            discount: buildPrimary('discount', langs),
            taxRate: buildPrimary('taxRate', langs),
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
            amountPaid: data.amountPaid,
            amountDue: data.amountDue,
          }}
          visibility={{
            showSubtotal: template.totalsSection.showSubtotal,
            showTaxTotal: template.totalsSection.showTaxTotal,
            showDiscountTotal: template.totalsSection.showDiscountTotal,
            showAmountPaid: template.totalsSection.showAmountPaid,
            showAmountDue: template.totalsSection.showAmountDue,
          }}
          labels={{
            subtotal: buildPrimary('subtotal', langs),
            taxTotal: buildPrimary('totalTax', langs),
            discountTotal: buildPrimary('totalDiscount', langs),
            grandTotal: buildPrimary('grandTotal', langs),
            amountPaid: buildPrimary('amountPaid', langs),
            amountDue: buildPrimary('amountDue', langs),
          }}
          renderCurrency={renderCurrency}
        />

        {data.notes && (
          <View style={styles.notesBlock}>
            <DualLabel
              primary={buildPrimary('notes', langs)}
              secondary={buildSecondary('notes', langs)}
            />
            <Text
              style={[styles.notesText, { fontFamily: pickFontFamily(data.notes) }]}
            >
              {data.notes.length > 500 ? `${data.notes.slice(0, 500)}…` : data.notes}
            </Text>
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

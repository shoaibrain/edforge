/**
 * Type contracts for the TemplateDescriptor registry.
 *
 * A `TemplateDescriptor<TData, TConfig>` is the unit of extensibility in this
 * library. Each future doc type (invoice, receipt, report card, admit card,
 * ID card, certificate, …) ships exactly one descriptor file that registers
 * itself at module load. The editor UI and per-domain render endpoints both
 * look up descriptors by `docType` — neither needs to import the document
 * components directly.
 *
 * Design source of truth: docs/pilot-greenlight/c-epic-pdf-generation-design.md §5.2.
 */

import type * as React from 'react';
import type { ImageSource } from '../core/fonts';
import type { Lang } from '../core/i18n';

/**
 * Document types known to the renderer. Each value corresponds to exactly
 * one descriptor registration. Extend this union when adding a new doc type.
 */
export type DocType =
  | 'INVOICE'
  | 'RECEIPT'
  | 'REPORT_CARD'
  | 'ADMIT_CARD'
  | 'TRANSCRIPT'
  | 'STUDENT_ID_CARD'
  | 'BONAFIDE_CERTIFICATE'
  | 'TRANSFER_CERTIFICATE'
  | 'HALL_TICKET'
  | 'FEE_STATEMENT'
  | 'ATTENDANCE_SHEET'
  | 'MARK_LIST';

/**
 * Tenant archetype the renderer recognizes when computing defaults.
 * Locked here to match `@aibrains/shared-types` Archetype enum. Reserved
 * archetypes (`CBSE_IN`, `NAIS_US`, `GEMS_UAE`) are accepted in the type
 * but a descriptor's `defaults(archetype, …)` SHOULD fall back to the
 * GENERIC profile for any value it doesn't explicitly handle — V1 only
 * exercises `'PABSON'` and `'GENERIC'`.
 */
export type Archetype = 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE';

// `Lang` is canonical in `core/i18n.ts` (where the `t()` resolver lives) and
// is re-exported from the package root via `core/index.ts`. We import it here
// to use in `PdfTemplateConfig.labelLanguages` without re-exporting it from
// descriptors (avoids a duplicate-export collision at the package root).

/**
 * Minimal branding shape consumed by document Components.
 *
 * Templates accept this as `branding` and forward selected fields to the
 * `BrandedHeader` / `SignatureLine` / `Watermark` primitives. Local to the
 * renderer; consumers map `@aibrains/shared-types`'s `SchoolBranding` to
 * this shape at the endpoint boundary (Sprint C.0.5 + C.1).
 *
 * Property order is alphabetical to keep the type readable as it grows.
 */
export interface PdfBranding {
  accentColor?: string;
  addressLines?: string[];
  email?: string;
  formalName?: string;
  letterheadBackgroundSrc?: ImageSource;
  logoSrc?: ImageSource;
  panNumber?: string;
  phone?: string;
  primaryColor?: string;
  principalSignatureSrc?: ImageSource;
  schoolName?: string;
  tagline?: string;
  vatNumber?: string;
}

/**
 * Minimal locale + regional settings consumed by document Components.
 * Sourced from `WorkspaceSettings` + `SchoolConfiguration` in production;
 * the descriptor doesn't care which layer of the precedence chain produced
 * each value.
 */
export interface PdfLocaleSettings {
  /** BCP 47 — e.g., 'en-US', 'ne-NP'. */
  defaultLocale: string;
  /** ISO 4217 — e.g., 'NPR', 'USD', 'INR'. */
  defaultCurrency: string;
  defaultCalendarSystem: 'gregorian' | 'bikram_sambat';
  /** IANA timezone string. */
  defaultTimeZone?: string;
}

/**
 * The shared base config every PDF template has. Per-doc-type config (the
 * `TConfig` generic on `TemplateDescriptor`) extends this with
 * domain-specific options — e.g., an `InvoiceTemplateConfig` adds
 * `lineItemColumns` + `totalsSection`.
 */
export interface PdfTemplateConfig {
  // Page setup
  pageSize: 'A4' | 'A5' | 'LETTER';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };

  // Header / footer toggles
  header: {
    showLogo: boolean;
    showSchoolName: boolean;
    showSchoolAddress: boolean;
    showContact: boolean;
    tagline?: string;
  };
  footer: {
    text?: string;
    showPageNumbers: boolean;
  };

  // Locale (template-level overrides; absent fields inherit from PdfLocaleSettings)
  dateFormat: 'gregorian' | 'bikram_sambat' | 'dual';
  numberFormat: 'south-asian' | 'western' | 'auto-from-workspace';
  currencyDisplay: 'symbol' | 'iso-code' | 'name';
  /**
   * At minimum one entry; two entries enables dual-language label rendering
   * (e.g., `['en', 'ne']` → "Subtotal" + "उप-योग" stacked or inline).
   */
  labelLanguages: readonly Lang[];

  /** Per-template branding overrides — rare; most templates inherit school branding. */
  brandingOverrides?: Partial<PdfBranding>;
}

/**
 * A single configurable form field surfaced in the template editor UI.
 *
 * The editor reads each descriptor's `configurableFields[]` and generates
 * form sections automatically. **Adding a new editable field = appending one
 * entry here; the editor needs no code change.** This is the property that
 * makes the editor work uniformly across all 12+ planned doc types.
 */
export interface ConfigurableField {
  /**
   * Dot path into `TConfig` for this field's value.
   * Example: `'lineItemColumns.discount'`, `'header.tagline'`, `'pageSize'`.
   */
  path: string;
  /** Form-input type. The editor maps each to a primitive from `@edforge/forms`. */
  type:
    | 'text'
    | 'textarea'
    | 'toggle'
    | 'select'
    | 'multiselect'
    | 'color'
    | 'file'
    | 'number';
  /** i18n key for the field label. Resolved per current editor locale. */
  labelKey: string;
  /** i18n key for an optional help/description tooltip. */
  descriptionKey?: string;
  /** Choices for `select` / `multiselect`. */
  options?: readonly string[];
  /** File `accept` attribute for `file` type. Example: `'.png,.jpg,.svg'`. */
  accept?: string;
  /** Max file size in bytes for `file` type. */
  maxSizeBytes?: number;
  /** Minimum items for `multiselect`. */
  minItems?: number;
  /**
   * Conditional display: only render this field when another field's value
   * equals the given value. Useful for toggling sub-sections on/off.
   */
  visibleIf?: { path: string; equals: unknown };
}

/**
 * Props every document Component accepts. Stable across all doc types so the
 * editor and render endpoints don't need per-doc-type adapter code.
 */
export interface DocumentComponentProps<TData, TConfig extends PdfTemplateConfig> {
  data: TData;
  template: TConfig;
  branding: PdfBranding;
  settings: PdfLocaleSettings;
}

/**
 * The contract every doc-type descriptor satisfies.
 *
 * @example
 *   import { registerDescriptor, type TemplateDescriptor } from '@aibrains/pdf-renderer';
 *
 *   const invoiceDescriptor: TemplateDescriptor<Invoice, InvoiceTemplateConfig> = {
 *     docType: 'INVOICE',
 *     i18nNamespace: 'invoice',
 *     Component: InvoicePdf,
 *     defaults: (archetype, locale) => ({ ... }),
 *     sampleData: (archetype, locale) => ({ ... }),
 *     configurableFields: [ ... ],
 *   };
 *
 *   registerDescriptor(invoiceDescriptor);
 */
export interface TemplateDescriptor<TData, TConfig extends PdfTemplateConfig> {
  /** Globally unique discriminator (e.g., `'INVOICE'`, `'REPORT_CARD'`). */
  docType: DocType;
  /**
   * i18n namespace this descriptor's labels live under. Translations are
   * bundled in `src/i18n/{lang}/{namespace}.json` and loaded by the editor
   * + the document component.
   */
  i18nNamespace: string;
  /**
   * The React component that renders the document. Both
   * `renderToBuffer` (Node) and `<PDFViewer>` (browser) invoke this with
   * the standard four props.
   */
  Component: React.ComponentType<DocumentComponentProps<TData, TConfig>>;
  /**
   * Returns the default config for a fresh template, parameterized by
   * archetype + locale. For PABSON tenants this should produce
   * BS+AD dual dates, EN+NE labels, ne-NP locale, NPR, south-asian numbers
   * — sensible defaults so the lazy-seed path produces a usable PDF
   * without any operator action.
   */
  defaults(archetype: Archetype, locale: string): TConfig;
  /**
   * Returns mock data for the editor's live preview when the operator
   * hasn't yet selected a real document to preview against.
   */
  sampleData(archetype: Archetype, locale: string): TData;
  /** Editor-form-rendering metadata. The order is the field order in the UI. */
  configurableFields: readonly ConfigurableField[];
}

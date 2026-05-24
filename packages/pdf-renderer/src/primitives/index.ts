/**
 * Layout primitives — building blocks that compose into document components.
 *
 * Sprint C.0.3:
 *   - Document — wraps RPDF Document, auto-registers fonts
 *   - Page — wraps RPDF Page with template margins + default font + theme
 *   - BrandedHeader — logo + school name + address (driven by branding)
 *   - BrandedFooter — footer text + page numbers
 *   - Watermark — DRAFT/PAID/CANCELLED diagonal overlay
 */

export { Document } from './Document';
export type { DocumentProps } from './Document';

export { Page } from './Page';
export type { PageProps, PageSize, Orientation } from './Page';

export { BrandedHeader } from './BrandedHeader';
export type {
  BrandedHeaderProps,
  BrandedHeaderBranding,
  BrandedHeaderConfig,
} from './BrandedHeader';

export { BrandedFooter } from './BrandedFooter';
export type { BrandedFooterConfig } from './BrandedFooter';

export { Watermark } from './Watermark';
export type { WatermarkProps } from './Watermark';

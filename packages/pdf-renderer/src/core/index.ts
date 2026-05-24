/**
 * Core utilities for @aibrains/pdf-renderer documents.
 *
 * Sprint C.0.2 — exports theme tokens, i18n helper, and format helpers.
 * Subsequent sprints (C.0.3+) add fonts registration, layout primitives,
 * and reusable components on top of these.
 */

export {
  DEFAULT_COLORS,
  DEFAULT_SPACING,
  DEFAULT_FONT_SIZE,
  DEFAULT_MARGINS_MM,
} from './theme';
export type { Colors, Spacing, FontSize, Margins } from './theme';

export { t, tDual } from './i18n';
export type { Lang, Namespace } from './i18n';

export { formatDate, formatNumber, formatCurrency } from './format';
export type { DateFormat, NumberGrouping } from './format';

export {
  registerFonts,
  pickFontFamily,
  FONT_FAMILY_LATIN,
  FONT_FAMILY_DEVANAGARI,
} from './fonts';

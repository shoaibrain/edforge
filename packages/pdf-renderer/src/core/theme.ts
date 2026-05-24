/**
 * Default theme tokens for @aibrains/pdf-renderer documents.
 *
 * These are the defaults applied when a template's `brandingOverrides` does not
 * specify the value. Document components import from here; per-template overrides
 * are layered on top at render time via `template.brandingOverrides`.
 *
 * V1 keeps tokens minimal (8 colors, 5 spacings, 5 font sizes). Future sprints
 * may extend without breaking consumers.
 */

export const DEFAULT_COLORS = {
  /** Default primary accent (EdForge teal). Overridden per template. */
  primary: '#0D9488',
  /** Default accent (used for secondary headings, hover-like states). */
  accent: '#0F766E',
  /** Body text. */
  text: '#1F2937',
  /** Muted text (metadata, captions). */
  textMuted: '#6B7280',
  /** Light border (table dividers). */
  border: '#E5E7EB',
  /** Page background. */
  background: '#FFFFFF',
  /** Failure / NG / overdue highlight. */
  danger: '#DC2626',
  /** Success / paid stamp. */
  success: '#16A34A',
} as const;

export const DEFAULT_SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const DEFAULT_FONT_SIZE = {
  /** Caption / metadata (8pt). */
  xs: 8,
  /** Body text (10pt). */
  sm: 10,
  /** Default (11pt). */
  md: 11,
  /** Section heading (14pt). */
  lg: 14,
  /** Document title (18pt). */
  xl: 18,
} as const;

/** Default page margins in millimetres (A4 conventional). */
export const DEFAULT_MARGINS_MM = {
  top: 15,
  right: 15,
  bottom: 15,
  left: 15,
} as const;

export type Colors = typeof DEFAULT_COLORS;
export type Spacing = typeof DEFAULT_SPACING;
export type FontSize = typeof DEFAULT_FONT_SIZE;
export type Margins = typeof DEFAULT_MARGINS_MM;

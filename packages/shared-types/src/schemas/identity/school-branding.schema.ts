/**
 * School Branding Schema — Identity Service
 *
 * Per-school PDF-rendering metadata: logo, address-as-shown-on-paper, contact
 * info for the letterhead, principal signature, color palette, tax registration
 * numbers, etc. Lives as an optional `branding` sub-document on the existing
 * `School` entity (see `school.entity.ts`).
 *
 * **Coexists with the existing top-level `School.logoUrl` field** (a flat URL
 * for general use — school cards, AdminWeb school list). `branding.logoS3Key`
 * is the PDF-rendering variant — a relative S3 key resolved by the server at
 * render time. PDFs prefer `branding.logoS3Key` when present, fall back to
 * `logoUrl` otherwise. Sprint C.1+ render endpoints implement this cascade.
 *
 * Per Sprint C.0 design (`docs/pilot-greenlight/c-epic-pdf-generation-design.md` §4.3):
 * - All fields are OPTIONAL — schools start with `branding: undefined`
 * - Each field independently overrides the corresponding School-level field
 *   when present (lazy-merge happens at the render endpoint, not in Zod)
 * - Strict shape validation here; tenant-scoping of `s3Key` values is enforced
 *   at the service layer where request-context provides `tenantId`
 *
 * Sprint C.0.5 — schema + School entity extension only. CRUD endpoints +
 * presigned-upload land in C.0.7; consumer rendering lands in C.1+.
 */

import { z } from 'zod';
import { emailSchema } from '../common';

// ============================================
// Color Palette
// ============================================

/**
 * Hex color string (`#RRGGBB`). 6-digit hex only — no shorthand (`#RGB`),
 * no alpha (`#RRGGBBAA`), no named colors. Keeps the PDF renderer's color
 * pipeline single-format and predictable.
 */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hex color in the form #RRGGBB');

export const colorPaletteSchema = z.object({
  /** Primary brand color (school name, headings, accents). */
  primary: hexColorSchema,
  /** Secondary accent color (sub-headings, dividers). */
  accent: hexColorSchema,
});

export type ColorPaletteDto = z.infer<typeof colorPaletteSchema>;

// ============================================
// SchoolBranding
// ============================================

/**
 * S3 key reference for a branding asset. Plain non-empty string — the service
 * layer validates that the key falls under the requesting tenant's prefix
 * (`tenants/{tenantId}/schools/{schoolId}/...`) before persisting. Schema
 * intentionally doesn't enforce that pattern here because the tenantId is not
 * in scope during Zod parsing.
 */
const s3KeySchema = z
  .string()
  .min(1)
  .max(500, 'S3 key must be 500 characters or fewer');

/**
 * Address line as rendered on a printed letterhead. Up to 120 chars per line.
 * Address rendering on PDFs uses up to 4 lines; longer addresses should be
 * abbreviated by the operator at the editor.
 */
const addressLineSchema = z
  .string()
  .min(1)
  .max(120, 'Address line must be 120 characters or fewer');

export const schoolBrandingSchema = z.object({
  /**
   * Long-form school name shown on the letterhead (e.g.,
   * "Saraswati Higher Secondary School, Lalitpur" — vs the operational
   * `School.name` which may be shortened for UI display). When absent, PDFs
   * fall back to `School.name`.
   */
  formalName: z.string().max(200).optional(),

  /**
   * Up to 4 address lines as they should appear on the letterhead.
   * Independent from `School.address` (the structured address used for
   * mapping / form validation) — operators frequently want a specific
   * 2-3-line presentation on PDFs.
   */
  addressLines: z.array(addressLineSchema).max(4).optional(),

  /** Display phone for the letterhead (operator may want a different number than `School.phone`). */
  phone: z.string().max(50).optional(),

  /** Display email for the letterhead. */
  email: emailSchema.optional(),

  /**
   * S3 key for the school logo (PDF rendering). Coexists with `School.logoUrl`
   * (general-purpose URL). The render endpoint resolves this key to a Buffer
   * via S3 GetObject at render time. Stored as a key not a URL because URLs
   * expire (presigned) or leak access (public).
   */
  logoS3Key: s3KeySchema.optional(),

  /** S3 key for the principal's signature image, rendered above the signature line on official docs. */
  principalSignatureS3Key: s3KeySchema.optional(),

  /** S3 key for a full-page letterhead background image (watermark / template). */
  letterheadBackgroundS3Key: s3KeySchema.optional(),

  /** Brand color palette. Both primary and accent must be present if palette is set. */
  colorPalette: colorPaletteSchema.optional(),

  /**
   * Nepal tax registration ("Permanent Account Number") — appears on tax-related
   * documents (invoices, receipts). Loose string validation; format varies
   * across jurisdictions (Nepal PAN is 9 digits; India PAN is 10 chars
   * alphanumeric). Strict per-country validation is V1.5 polish.
   */
  panNumber: z.string().min(1).max(32).optional(),

  /** Nepal VAT registration number, same loose validation as PAN. */
  vatNumber: z.string().min(1).max(32).optional(),

  /** Short tagline / motto shown under the school name on PDFs. */
  tagline: z.string().max(100).optional(),

  /**
   * Opaque UUID that changes whenever ANY branding field is updated. PDF
   * render endpoints capture this on issued documents so a later branding
   * change doesn't visually mutate historical PDFs. Stored as a string in
   * the entity factory (auto-generated server-side); Zod accepts any UUID.
   */
  brandingVersionId: z.string().uuid().optional(),
});

export type SchoolBrandingDto = z.infer<typeof schoolBrandingSchema>;

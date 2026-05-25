/**
 * Types + Zod validators for branding endpoints (C.0.7).
 */

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { schoolBrandingSchema, type SchoolBrandingDto } from '@aibrains/shared-types';

/**
 * The three branding asset slots a school can populate. Adding a new slot
 * here requires extending ASSET_MIME_ALLOWLIST + ASSET_MAX_BYTES below and
 * the corresponding fields in `schoolBrandingSchema`.
 */
export const BRANDING_ASSET_TYPES = ['logo', 'signature', 'letterhead'] as const;
export type BrandingAssetType = (typeof BRANDING_ASSET_TYPES)[number];

/**
 * Per-asset-type MIME allowlist. SVG is logo-only (font-fallback rendering
 * issues in @react-pdf/renderer for signature/letterhead would make SVGs
 * surprising on those slots). PDF is letterhead-only because PDFs as inline
 * letterheads is a common operator request; logo/signature stay raster.
 */
export const ASSET_MIME_ALLOWLIST: Record<BrandingAssetType, readonly string[]> = {
  logo: ['image/png', 'image/jpeg', 'image/svg+xml'],
  signature: ['image/png', 'image/jpeg'],
  letterhead: ['image/png', 'image/jpeg', 'application/pdf'],
};

export const ASSET_MAX_BYTES: Record<BrandingAssetType, number> = {
  logo: 2 * 1024 * 1024,
  signature: 1 * 1024 * 1024,
  letterhead: 5 * 1024 * 1024,
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export function extensionFor(contentType: string): string | undefined {
  return EXT_BY_MIME[contentType];
}

/** Body for `POST /schools/:schoolId/branding/assets/upload-url`. */
export const presignedUploadRequestSchema = z.object({
  assetType: z.enum(BRANDING_ASSET_TYPES),
  contentType: z.string().min(1).max(128),
  contentLength: z.number().int().positive(),
});
export type PresignedUploadRequest = z.infer<typeof presignedUploadRequestSchema>;
export class PresignedUploadRequestDtoZ extends createZodDto(presignedUploadRequestSchema) {}

export interface PresignedUploadResponse {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

/** Body for `PATCH /schools/:schoolId/branding`. Partial of the full branding shape. */
export const updateBrandingRequestSchema = schoolBrandingSchema
  .omit({ brandingVersionId: true })
  .partial();
export type UpdateBrandingRequest = z.infer<typeof updateBrandingRequestSchema>;
export class UpdateBrandingRequestDtoZ extends createZodDto(updateBrandingRequestSchema) {}

/**
 * Per-asset signed GET URLs minted by the server for the three S3-backed
 * branding assets, when the corresponding key is present. Frontends consume
 * these directly to render previews without a second presign hop per asset.
 * TTL = 10 min ({@link DEFAULT_GET_EXPIRY_SECONDS}). Field is absent when
 * `branding` is null OR the asset key is unset.
 *
 * Sprint C.0-followup C.0-fu.2 — additive field; raw S3 keys still live on
 * `branding` for backwards-compat with any consumers built against C.0.7.
 */
export interface BrandingAssetUrls {
  logo?: string;
  principalSignature?: string;
  letterheadBackground?: string;
}

export interface BrandingResponse {
  branding: SchoolBrandingDto | null;
  /** Sprint C.0-followup C.0-fu.2 — present when `branding != null` and ≥1 S3 key is set. */
  urls?: BrandingAssetUrls;
}

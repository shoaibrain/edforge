/**
 * Zod schemas for Ed-Fi descriptor URIs — Sprint 3 (S3.1).
 *
 * These schemas let DTOs validate that a supplied URI actually exists in the
 * corresponding catalog, not just that the string shape is URI-like. Use them
 * instead of `z.string().regex(ED_FI_URI_REGEX)` when you want a hard guarantee
 * that the stored value will resolve via `getDisplayName()` / `resolveDescriptor()`.
 *
 * Behavior:
 *   - `.optional()` — the field may be omitted.
 *   - Provided value MUST match the Ed-Fi URI shape AND exist in the named
 *     catalog, else validation fails with a helpful Zod issue.
 *
 * Why not put this inside `descriptor-types.ts`? The catalogs module depends on
 * every descriptor file loading first (to run load-time validation). Keeping
 * the DTO-facing schemas here avoids a circular import.
 */

import { z } from 'zod';
import { DESCRIPTOR_CATALOGS, type DescriptorType } from './catalogs';
import { ED_FI_URI_REGEX } from './descriptor-types';

function makeDescriptorUriSchema(type: DescriptorType) {
  // Collect the URI set once when the module is first imported. Catalogs are
  // frozen at load time (new entries need a code change + publish), so caching
  // here is safe.
  const validUris = new Set(DESCRIPTOR_CATALOGS[type].entries.map((e) => e.uri));
  return z
    .string()
    .regex(ED_FI_URI_REGEX, {
      message: `must match Ed-Fi URI shape uri://ed-fi.org/${type}#<Code>`,
    })
    .refine((uri) => validUris.has(uri), {
      message: `URI is not in the ${type} catalog — add the entry there first`,
    });
}

export const sexDescriptorUriSchema = makeDescriptorUriSchema('SexDescriptor');
export const languageDescriptorUriSchema = makeDescriptorUriSchema(
  'LanguageDescriptor',
);
export const disabilityDescriptorUriSchema = makeDescriptorUriSchema(
  'DisabilityDescriptor',
);
export const gradeLevelDescriptorUriSchema = makeDescriptorUriSchema(
  'GradeLevelDescriptor',
);
export const exitWithdrawTypeDescriptorUriSchema = makeDescriptorUriSchema(
  'ExitWithdrawTypeDescriptor',
);

/**
 * Generic "any Ed-Fi descriptor URI" — used where the exact catalog isn't
 * fixed at schema-definition time (e.g. the placeholder for future
 * `ethnicityDescriptor`, which Sprint 6 will validate properly once the
 * ethnicity catalog lands).
 *
 * Intentionally weak: only the URI shape is checked. Callers that need
 * catalog existence must layer a targeted `.refine()` on top.
 */
export const anyEdFiDescriptorUriSchema = z.string().regex(ED_FI_URI_REGEX, {
  message: 'must match Ed-Fi URI shape uri://ed-fi.org/<TypeName>#<Code>',
});

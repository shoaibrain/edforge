/**
 * Ed-Fi Descriptor — canonical shape for every descriptor JSON catalog in this
 * directory. One entry per canonical concept; aliases capture the real-world
 * variants (misspellings, translations, IEMIS-specific tokens) we're expected
 * to route to it.
 *
 * Sprint 2 (S2.1) — IEMIS Reporting Middleware.
 *
 * Ed-Fi URIs follow the pattern `uri://ed-fi.org/<TypeName>#<Code>` per the
 * Ed-Fi 5.x Data Standard. We validate that at authoring time via a Zod schema
 * on every catalog JSON so a typo in a new entry fails at load time — not
 * silently ships and misroutes.
 *
 * Notes:
 *   - `code` is Ed-Fi's short code (suffix after the '#' in the URI).
 *   - `codeShort` is the IEMIS / CEHRD short form when it differs from `code`
 *     (e.g. gender "M"/"F" vs Ed-Fi "Male"/"Female"). Omitted when identical.
 *   - `displayName` is locale-indexed; `en` is required, other locales
 *     optional. Sprint 2 ships `en` + `ne-NP` (Nepali — PABSON pilot locale).
 *     Future archetypes (CBSE_IN, NAIS_US, GEMS_UAE) add their own locales
 *     without touching consumers that only read `en`.
 *   - `aliases` are case-insensitive when resolved. Include every variant the
 *     resolver must recognize, including misspellings seen in real tenant data.
 *     Do NOT include `code` itself here — the resolver exact-matches `code`
 *     first and only falls back to aliases.
 */

import { z } from 'zod';

/**
 * Ed-Fi URI format check: `uri://ed-fi.org/<TypeName>#<Code>`.
 *
 * - `<TypeName>` — PascalCase, letters only (e.g. `LanguageDescriptor`).
 * - `<Code>` — one or more non-whitespace, non-`#` characters.
 *
 * Intentionally permissive on `<Code>` because Ed-Fi allows slashes and
 * hyphens (`DD-06`, `ECD/PPC` is NOT valid Ed-Fi — we split it at the resolver
 * level — but `Grade-06` is). Tighten if a real-world abuse appears.
 */
export const ED_FI_URI_REGEX =
  /^uri:\/\/ed-fi\.org\/[A-Z][A-Za-z]+#[^\s#]+$/;

/** Supported locales for descriptor display names. Add as archetypes arrive. */
export type DescriptorLocale = 'en' | 'ne-NP';

export const descriptorLocaleSchema = z.enum(['en', 'ne-NP']);

export const descriptorDisplayNameSchema = z
  .object({
    en: z.string().min(1),
    'ne-NP': z.string().min(1).optional(),
  })
  .strict();

export const edFiDescriptorEntrySchema = z
  .object({
    uri: z.string().regex(ED_FI_URI_REGEX, {
      message: 'URI must match uri://ed-fi.org/<TypeName>#<Code>',
    }),
    code: z.string().min(1),
    codeShort: z.string().min(1).optional(),
    displayName: descriptorDisplayNameSchema,
    aliases: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((entry) => entry.uri.endsWith('#' + entry.code), {
    message: 'uri suffix (after #) must equal code',
    path: ['code'],
  });

export type EdFiDescriptorEntry = z.infer<typeof edFiDescriptorEntrySchema>;

export const descriptorCatalogSchema = z
  .object({
    type: z.string().regex(/^[A-Z][A-Za-z]+Descriptor$/, {
      message: 'type must be PascalCase and end with "Descriptor"',
    }),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, {
      message: 'version must be semver (e.g. 1.0.0)',
    }),
    entries: z.array(edFiDescriptorEntrySchema).min(1),
  })
  .strict()
  .refine(
    (cat) => new Set(cat.entries.map((e) => e.uri)).size === cat.entries.length,
    { message: 'duplicate uri within catalog', path: ['entries'] },
  )
  .refine(
    (cat) => new Set(cat.entries.map((e) => e.code)).size === cat.entries.length,
    { message: 'duplicate code within catalog', path: ['entries'] },
  )
  .refine(
    (cat) => {
      // Alias uniqueness is enforced within a single catalog, normalized to
      // lowercase. Cross-catalog collisions are fine (different types are
      // independent lookup spaces per the resolver contract).
      const seen = new Set<string>();
      for (const e of cat.entries) {
        for (const alias of [e.code, ...e.aliases]) {
          const key = alias.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
        }
      }
      return true;
    },
    { message: 'duplicate alias or alias==code collision within catalog', path: ['entries'] },
  );

export type DescriptorCatalog = z.infer<typeof descriptorCatalogSchema>;

/**
 * Optional resolution context — lets the resolver (and future callers) branch
 * on archetype/country without importing either constant. V1 (PABSON-only)
 * does not switch on this, but accepting it lets Sprint 3+ add archetype-
 * specific aliases without a breaking signature change.
 */
export interface DescriptorContext {
  /** ISO-3166 alpha-3, e.g. `NPL`. */
  country?: string;
  /** Tenant archetype, e.g. `PABSON` | `GENERIC`. */
  archetype?: string;
}

/**
 * Known descriptor type names — the catalog filenames line up with these.
 * zod-canonical (mirrors the active-archetype enum, RFC 0001 §2.4): the schema
 * is the single source; the type is inferred. `EthnicityDescriptor` is added by
 * GB3 together with its catalog — do not list it as required anywhere before
 * then, or GB0.5's "every required descriptor has a registered catalog"
 * cross-check fails.
 */
export const descriptorTypeNameSchema = z.enum([
  'LanguageDescriptor',
  'DisabilityDescriptor',
  'SexDescriptor',
  'GradeLevelDescriptor',
  'ExitWithdrawTypeDescriptor',
]);
export type DescriptorTypeName = z.infer<typeof descriptorTypeNameSchema>;

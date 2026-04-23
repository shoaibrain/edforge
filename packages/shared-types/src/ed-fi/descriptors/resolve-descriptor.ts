/**
 * Ed-Fi descriptor resolver — Sprint 2 (S2.7 + S2.8).
 *
 * Canonical lookup for turning human / IEMIS tokens into Ed-Fi URIs.
 *
 * Matching policy (strict, no fuzzy):
 *   1. Exact match on `code` (case-insensitive)
 *   2. Exact match on any `aliases[]` entry (case-insensitive)
 *   3. `null` (never guesses — an unresolved input is a real signal)
 *
 * Whitespace is trimmed from the input (but not normalized internally) so
 * leading/trailing spaces in copy-pasted CEHRD cells don't cause false
 * misses. Multi-space internal whitespace is NOT collapsed — if "First  Grade"
 * (double space) needs to resolve, add it as an alias.
 *
 * The `context` argument is accepted but not consumed in V1 (PABSON-only).
 * Future archetypes that need archetype-scoped aliases get it for free.
 *
 * `getDisplayName(uri, locale)` falls back: requested locale → `en` → uri.
 * It returns the URI itself (never `null`) so consumers never render empty.
 */

import {
  DESCRIPTOR_CATALOGS,
  type DescriptorType,
} from './catalogs';
import type { DescriptorContext, EdFiDescriptorEntry, DescriptorLocale } from './descriptor-types';

/** Resolve an input value to a canonical Ed-Fi URI; `null` if not recognized. */
export function resolveDescriptor(
  type: DescriptorType,
  input: unknown,
  // Accepted but intentionally unused in V1 — see header notes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  context?: DescriptorContext,
): string | null {
  const entry = resolveDescriptorEntry(type, input, context);
  return entry ? entry.uri : null;
}

/** Same resolution as `resolveDescriptor`, but returns the full catalog entry. */
export function resolveDescriptorEntry(
  type: DescriptorType,
  input: unknown,
  // Accepted but intentionally unused in V1 — see header notes.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  context?: DescriptorContext,
): EdFiDescriptorEntry | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const key = trimmed.toLowerCase();

  const index = getAliasIndex(type);
  return index.get(key) ?? null;
}

/**
 * Return the display name for a URI in the requested locale, falling back to
 * English, then the URI itself. Returns the URI (never `null`) so callers
 * render something consistent instead of an empty string on missing locale
 * translations.
 */
export function getDisplayName(
  uri: string,
  locale: DescriptorLocale = 'en',
): string {
  const entry = getUriIndex().get(uri);
  if (!entry) return uri;
  const names = entry.displayName as Record<string, string | undefined>;
  return names[locale] ?? names.en ?? uri;
}

/**
 * Return the full displayName map for a URI (all seeded locales). Useful when
 * the UI wants to render both scripts side-by-side (e.g. `Nepali / नेपाली`).
 * Returns null if the URI isn't in any catalog.
 */
export function getDescriptorDisplayNames(
  uri: string,
): EdFiDescriptorEntry['displayName'] | null {
  const entry = getUriIndex().get(uri);
  return entry ? entry.displayName : null;
}

/** List every URI in a given descriptor catalog — handy for dropdown seeding. */
export function listDescriptorUris(type: DescriptorType): string[] {
  return DESCRIPTOR_CATALOGS[type].entries.map((e) => e.uri);
}

// ---------------------------------------------------------------------------
// Internal indexes — built lazily, once per process.
// ---------------------------------------------------------------------------

const aliasIndexCache = new Map<DescriptorType, Map<string, EdFiDescriptorEntry>>();
let uriIndexCache: Map<string, EdFiDescriptorEntry> | null = null;

function getAliasIndex(type: DescriptorType): Map<string, EdFiDescriptorEntry> {
  let cached = aliasIndexCache.get(type);
  if (cached) return cached;
  cached = new Map();
  for (const entry of DESCRIPTOR_CATALOGS[type].entries) {
    cached.set(entry.code.toLowerCase(), entry);
    if (entry.codeShort) cached.set(entry.codeShort.toLowerCase(), entry);
    for (const alias of entry.aliases) {
      cached.set(alias.toLowerCase(), entry);
    }
  }
  aliasIndexCache.set(type, cached);
  return cached;
}

function getUriIndex(): Map<string, EdFiDescriptorEntry> {
  if (uriIndexCache) return uriIndexCache;
  const idx = new Map<string, EdFiDescriptorEntry>();
  for (const type of Object.keys(DESCRIPTOR_CATALOGS) as DescriptorType[]) {
    for (const entry of DESCRIPTOR_CATALOGS[type].entries) {
      idx.set(entry.uri, entry);
    }
  }
  uriIndexCache = idx;
  return idx;
}

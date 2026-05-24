/**
 * i18n helper for document labels.
 *
 * Translations live in JSON bundles under `src/i18n/{lang}/{namespace}.json`,
 * loaded statically at module init via `resolveJsonModule`. The bundle ships
 * with the package; consumers never load external translation files.
 *
 * Fallback rules:
 *   - Missing key in target language → fall back to English.
 *   - Missing key in English → return the key itself (visible breadcrumb in
 *     the rendered PDF, surfacing the gap to whoever's reviewing).
 *   - Missing namespace → behaves as missing key.
 *
 * Interpolation: simple `{var}` placeholders. Non-string values are coerced
 * via String(value); undefined/null become empty string.
 *
 * V1 supports two languages (`'en'`, `'ne'`) and one namespace (`'common'`).
 * Doc-type namespaces (`'invoice'`, `'receipt'`, etc.) ship with their
 * documents in Sprint C.1+.
 */

import enCommon from '../i18n/en/common.json';
import neCommon from '../i18n/ne/common.json';

/** Supported document languages in V1. */
export type Lang = 'en' | 'ne';

/** Supported translation namespaces in V1. New doc types append here. */
export type Namespace = 'common';

type Bundle = Record<string, string>;
type LangBundles = Record<Namespace, Bundle>;

const BUNDLES: Record<Lang, LangBundles> = {
  en: { common: enCommon },
  ne: { common: neCommon },
};

/** Default fallback language when target language is missing a key. */
const FALLBACK_LANG: Lang = 'en';

/**
 * Translate a key.
 *
 * @example
 *   t('common', 'subtotal', 'ne')                  // → 'उप-योग'
 *   t('common', 'pageOf', 'en', {page: 1, total: 3}) // → 'Page 1 of 3'
 *   t('common', 'nonexistentKey', 'ne')             // → 'nonexistentKey' (and absent from EN too)
 */
export function t(
  namespace: Namespace,
  key: string,
  lang: Lang,
  vars?: Record<string, string | number | undefined | null>,
): string {
  const raw =
    BUNDLES[lang]?.[namespace]?.[key] ??
    BUNDLES[FALLBACK_LANG]?.[namespace]?.[key] ??
    key;

  if (!vars) return raw;

  return raw.replace(/\{(\w+)\}/g, (match, varName: string) => {
    const value = vars[varName];
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * Render the same key in two languages side-by-side. Used when a template
 * has `labelLanguages: ['en', 'ne']` (dual-language mode).
 *
 * @example
 *   tDual('common', 'subtotal', ['en', 'ne'])  // → { primary: 'Subtotal', secondary: 'उप-योग' }
 */
export function tDual(
  namespace: Namespace,
  key: string,
  langs: [Lang, Lang],
  vars?: Record<string, string | number | undefined | null>,
): { primary: string; secondary: string } {
  return {
    primary: t(namespace, key, langs[0], vars),
    secondary: t(namespace, key, langs[1], vars),
  };
}

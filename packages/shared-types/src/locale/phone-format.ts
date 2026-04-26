/**
 * Phone-format helper for archetype-aware UI input components.
 *
 * Used by:
 *   - <PhoneInput> shared form component (Sprint A.11) — renders dial-code
 *     prefix, sets `maxLength`, validates on submit.
 *   - Any future server-side enrichment that needs to interpret a "raw" phone
 *     string against a tenant's expected archetype.
 *
 * **Orthogonal to `phoneSchema` in `common.ts`.** That schema is intentionally
 * permissive (E.164 with any country code). The helper here narrows by
 * archetype/country to drive UI affordances. Backend validation stays loose;
 * UI validation gets tighter via this helper.
 *
 * --- Why archetype-first, not country-first ----------------------------------
 *
 * Per memory `edforge_archetype_model.md`, EdForge branches on archetype, not
 * country. PABSON archetype implies +977 mobile by default; future archetypes
 * (CBSE_IN, NAIS_US, GEMS_UAE) will each define their own format. If
 * archetype is unknown, the resolver falls back to country code, then to a
 * US default — never throws.
 */

/** Resolved phone-format spec for a single archetype/country combination. */
export interface PhoneFormat {
  /** ITU-T dial-code prefix including the leading `+`, e.g., `'+977'`. */
  readonly dialCode: string;
  /**
   * Regex matching the LOCAL number (digits after the dial code). Inputs are
   * stripped of non-digit characters before testing, so this regex only sees
   * `[0-9]` runs.
   */
  readonly localNumberRegex: RegExp;
  /** UI placeholder showing the expected shape, e.g., `'98XXXXXXXX'`. */
  readonly placeholder: string;
  /** Human-readable label for picker UI, e.g., `'Nepal mobile (+977)'`. */
  readonly label: string;
  /** Number of digits in the local portion. Used for input maxLength. */
  readonly localNumberLength: number;
  /** ISO-3166 alpha-3 country code this format targets, for picker UI. */
  readonly countryCode: string;
}

const PABSON_NEPAL_MOBILE: PhoneFormat = {
  dialCode: '+977',
  // Nepal mobile: 10 digits starting with 9. Operators today (NTC/Ncell/
  // Smart/UTL) all assign the leading 9 prefix. Landlines use 1–2-digit area
  // codes (e.g., 01-XXXXXXX for Kathmandu) and aren't covered here — V1 UI
  // optimizes for the >95% mobile case; landlines fall back to the loose
  // E.164 backend schema.
  localNumberRegex: /^9\d{9}$/,
  placeholder: '98XXXXXXXX',
  label: 'Nepal mobile (+977)',
  localNumberLength: 10,
  countryCode: 'NPL',
} as const;

const DEFAULT_US: PhoneFormat = {
  dialCode: '+1',
  localNumberRegex: /^\d{10}$/,
  placeholder: '(555) 555-5555',
  label: 'US/Canada (+1)',
  localNumberLength: 10,
  countryCode: 'USA',
} as const;

/**
 * Resolve the phone format for a tenant's archetype + country.
 *
 * Resolution order:
 *   1. Archetype-specific (PABSON → Nepal mobile)
 *   2. Country-specific (NPL → Nepal mobile, even on GENERIC archetype —
 *      e.g., a GENERIC tenant operating in Nepal)
 *   3. Default (US-style)
 *
 * Never throws; always returns a `PhoneFormat`.
 */
export function phoneFormatForArchetype(
  archetype: string | undefined | null,
  country: string | undefined | null,
): PhoneFormat {
  // 1. Archetype-first per archetype-model rule
  if (archetype === 'PABSON') {
    return PABSON_NEPAL_MOBILE;
  }

  // 2. Country fallback
  if (country === 'NPL') {
    return PABSON_NEPAL_MOBILE;
  }

  // 3. Default
  return DEFAULT_US;
}

/**
 * Validate a phone string against the format derived from archetype + country.
 *
 * Accepts:
 *   - Pure local digits (`'9812345678'`) — most common UI submission shape.
 *   - With dial-code prefix (`'+9779812345678'`) — accepted defensively.
 *   - With formatting punctuation (`'+977-981-234-5678'`) — stripped.
 *
 * Returns `false` for empty input. Use `phoneSchema` for E.164-only validation
 * at the API boundary; this is the UI/archetype-aware flavor.
 */
export function isValidPhoneForArchetype(
  phone: string,
  archetype: string | undefined | null,
  country: string | undefined | null,
): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  const fmt = phoneFormatForArchetype(archetype, country);
  // Strip the dial-code prefix if user typed it
  let working = phone.trim();
  if (working.startsWith(fmt.dialCode)) {
    working = working.slice(fmt.dialCode.length);
  }
  // Strip all non-digit characters (spaces, dashes, parentheses, dots)
  const digits = working.replace(/\D/g, '');
  return fmt.localNumberRegex.test(digits);
}

/**
 * Strip dial-code prefix + punctuation; return only the local digits.
 *
 * Used by the UI to coerce free-text phone input into the canonical local-
 * digits shape the backend expects after E.164 normalization (the backend
 * schema accepts both `+97798…` and `98…` because of the `+?` in
 * phoneSchema's regex; the UI standardizes on local-digits + an out-of-band
 * dial code).
 */
export function stripPhoneToLocalDigits(
  phone: string,
  archetype: string | undefined | null,
  country: string | undefined | null,
): string {
  if (!phone) return '';
  const fmt = phoneFormatForArchetype(archetype, country);
  let working = phone.trim();
  if (working.startsWith(fmt.dialCode)) {
    working = working.slice(fmt.dialCode.length);
  }
  return working.replace(/\D/g, '');
}

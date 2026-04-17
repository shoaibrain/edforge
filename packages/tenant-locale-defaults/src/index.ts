/**
 * @edforge/tenant-locale-defaults
 *
 * Single source of truth for per-country tenant locale defaults.
 *
 * Adding a new country = add one entry to `COUNTRY_DEFAULTS`. No code
 * changes elsewhere. Consumers:
 *   - AdminWeb tenant-create form (country dropdown + auto-config copy)
 *   - SBT tenant-seeder Lambda (writes initial workspace settings)
 *   - identity service workspace-settings entity (lazy-create defaults)
 *
 * Field meanings — see RegionalSettings JSDoc below.
 */

/** Allowed values for `RegionalSettings.defaultDateFormat`. */
export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';

/** Allowed values for `RegionalSettings.defaultTimeFormat`. */
export type TimeFormat = '12h' | '24h';

/** Allowed values for `RegionalSettings.defaultWeekStartsOn`. */
export type WeekStartsOn = 'sunday' | 'monday' | 'saturday';

/** Allowed values for `RegionalSettings.defaultCalendarSystem`. */
export type CalendarSystem = 'gregorian' | 'bikram_sambat';

/** Allowed values for `RegionalSettings.defaultNumberFormat`. */
export type NumberFormat = 'south_asian' | 'international';

/**
 * Per-tenant regional configuration.
 *
 * Stored on the workspace-settings DDB row at PK=TENANT#<id>, SK=SETTINGS#WORKSPACE.
 * Read by every locale-aware consumer (analytics aggregator, finance fee-structure
 * validation, frontend date/number formatting, etc.).
 */
export interface RegionalSettings {
  /** IANA timezone (e.g., 'Asia/Kathmandu', 'America/New_York'). */
  defaultTimezone: string;
  /** BCP 47 language tag (e.g., 'ne-NP', 'en-US'). */
  defaultLocale: string;
  defaultDateFormat: DateFormat;
  defaultTimeFormat: TimeFormat;
  defaultWeekStartsOn: WeekStartsOn;
  /** ISO 4217 currency code (e.g., 'NPR', 'USD'). */
  defaultCurrency: string;
  defaultCalendarSystem: CalendarSystem;
  /** When true, responses include a secondary calendar (e.g., BS alongside AD). */
  enableDualDateDisplay: boolean;
  defaultNumberFormat: NumberFormat;
}

/** ISO 3166-1 alpha-3 country code → regional defaults. */
export type CountryCode = 'NPL' | 'USA' | 'IND';

/**
 * Country-specific regional defaults.
 *
 * Adding a new country: add one entry. Done. Every consumer auto-supports it.
 */
export const COUNTRY_DEFAULTS: Record<CountryCode, RegionalSettings> = {
  NPL: {
    defaultCurrency: 'NPR',
    defaultTimezone: 'Asia/Kathmandu',
    defaultCalendarSystem: 'bikram_sambat',
    enableDualDateDisplay: true,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'ne-NP',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '24h',
    defaultWeekStartsOn: 'sunday',
  },
  USA: {
    defaultCurrency: 'USD',
    defaultTimezone: 'America/New_York',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'international',
    defaultLocale: 'en-US',
    defaultDateFormat: 'MM/DD/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'sunday',
  },
  IND: {
    defaultCurrency: 'INR',
    defaultTimezone: 'Asia/Kolkata',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'en-IN',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'monday',
  },
};

/**
 * Used as the baseline when no country code is provided or when the provided
 * code is not in `COUNTRY_DEFAULTS`. Country-specific overrides are merged
 * over this.
 */
export const FALLBACK_DEFAULTS: RegionalSettings = COUNTRY_DEFAULTS.USA;

/**
 * Resolve regional defaults for a given (possibly missing or unknown) country.
 *
 * - Known country (case-insensitive) → that country's defaults
 * - Unknown / missing → FALLBACK_DEFAULTS (currently USA)
 *
 * Pure function — safe to call at CDK synth time (the seeder Lambda construct
 * does this to embed values into its inline code) and at runtime.
 */
export function resolveRegionalDefaults(country?: string | null): RegionalSettings {
  if (!country) return { ...FALLBACK_DEFAULTS };
  const code = country.toUpperCase() as CountryCode;
  const overrides = COUNTRY_DEFAULTS[code];
  return overrides ? { ...overrides } : { ...FALLBACK_DEFAULTS };
}

/**
 * Display metadata per country — used by the AdminWeb tenant-create form
 * dropdown. Decoupled from `COUNTRY_DEFAULTS` so a new country can ship the
 * data immediately and the marketing copy can iterate independently.
 *
 * Adding a new country: add an entry here AND in `COUNTRY_DEFAULTS`.
 * Both are required (the form validates against this list, the seeder
 * resolves against the other).
 */
export interface CountryOption {
  /** ISO 3166-1 alpha-3 — must match a key in COUNTRY_DEFAULTS, or 'OTHER'. */
  value: CountryCode | 'OTHER';
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Auto-config preview shown beneath the dropdown after selection. */
  info: string;
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  {
    value: 'NPL',
    label: 'Nepal',
    info: 'NPR currency, Bikram Sambat calendar, Asia/Kathmandu timezone will be auto-configured',
  },
  {
    value: 'USA',
    label: 'United States',
    info: 'USD currency, Gregorian calendar, US Eastern timezone will be auto-configured',
  },
  {
    value: 'IND',
    label: 'India',
    info: 'INR currency, Gregorian calendar, Asia/Kolkata timezone will be auto-configured',
  },
  {
    value: 'OTHER',
    label: 'Other',
    info: 'Default settings (USD, Gregorian) will be applied — customizable later in workspace settings',
  },
] as const;

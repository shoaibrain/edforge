/**
 * Tenant locale defaults — the SOLE home of country + archetype regional
 * constants. Re-exported from `@aibrains/shared-types`.
 *
 * Consumers:
 *   - AdminWeb tenant-create form (archetype + country dropdowns, auto-config copy)
 *   - SBT tenant-seeder Lambda (writes initial workspace settings at synth time)
 *   - identity service workspace-settings entity (hand-duplicated inline — Dockerfile
 *     constraint, see inline comment in that file)
 *   - tenant-settings-resolver (type-only, for RegionalSettings shape)
 *
 * Adding a new country or archetype = edit THIS file, bump shared-types
 * version, `npm publish`. All consumers pick up the new values via the
 * published package.
 *
 * HISTORY: this content used to live in a separate workspace-only package
 * `@edforge/tenant-locale-defaults`. That package was unpublishable
 * (`"private": true`), which silently broke AdminWeb's CodeBuild `npm install`
 * (registry 404) and white-screened the tenant-create form for weeks before
 * being caught during the Midnight Lockin UAT deploy (2026-04-19). Content
 * was moved here and the workspace package retired. See
 * the historical lock-in implementation review and the deploy evidence index
 * marker for the full incident.
 *
 * Field meanings — see RegionalSettings JSDoc below.
 */

import { activeArchetypeSchema, type Archetype, type ActiveArchetype } from '../schemas/identity/tenant.schema';

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

// ============================================================================
// Archetype — governance-body classifications (PABSON private/boarding Nepal,
//             future CBS Nepal public, NGO-run, etc.)
// ============================================================================

/**
 * Archetype is a governance-body classification — the authority a school
 * answers to (PABSON for Nepal private/boarding schools; future Nepal
 * archetypes for CBS public-school governance, NGO-run governance, etc.).
 * Each archetype defines its members' governance, reporting cadence, and
 * calendar contract. Orthogonal to country — two tenants with country='NPL'
 * may have different archetypes (e.g., PABSON private vs future CBS public).
 *
 * V1 only validates PABSON and GENERIC at runtime. The reserved values
 * (CBSE_IN, NAIS_US, GEMS_UAE) are legacy speculative reservations carried
 * in the type union; not on the V1.x roadmap.
 */
// GB0.0 — single canonical source. `Archetype` / `ActiveArchetype` and the
// runtime enum are owned by the zod `archetypeSchema` / `activeArchetypeSchema`
// in `schemas/identity/tenant.schema.ts`. This file re-exports the types and
// DERIVES `ACTIVE_ARCHETYPES` from the schema's `.options`, so the enum can
// never drift from the validator — a value added to the schema is reflected
// here automatically. The governance-profile conformance suite (GB0.4) iterates
// `activeArchetypeSchema.options`.
export type { Archetype, ActiveArchetype };

/** Archetypes accepted by provisioning in V1. Derived from `activeArchetypeSchema`. */
export const ACTIVE_ARCHETYPES = activeArchetypeSchema.options;

/**
 * Archetype-specific regional defaults. Archetype takes precedence over country
 * because an archetype encodes stronger guarantees (PABSON always BS calendar,
 * always NPR, always Sun-Fri school week) than a country code alone.
 */
export const ARCHETYPE_DEFAULTS: Record<ActiveArchetype, RegionalSettings> = {
  PABSON: {
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
  GENERIC: {
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
};

/**
 * Resolve regional defaults honoring archetype precedence over country.
 *
 * - Archetype set & active → archetype defaults
 * - Else → country defaults via `resolveRegionalDefaults`
 *
 * Pure function — safe at CDK synth time and at runtime.
 */
export function resolveArchetypeDefaults(
  archetype?: string | null,
  country?: string | null,
): RegionalSettings {
  if (archetype) {
    const key = archetype.toUpperCase() as ActiveArchetype;
    if (ARCHETYPE_DEFAULTS[key]) return { ...ARCHETYPE_DEFAULTS[key] };
  }
  return resolveRegionalDefaults(country);
}

/** Check if a given string is a valid archetype accepted by V1 provisioning. */
export function isActiveArchetype(value: unknown): value is ActiveArchetype {
  return typeof value === 'string' && (ACTIVE_ARCHETYPES as readonly string[]).includes(value.toUpperCase());
}

/**
 * Display metadata per archetype — used by the AdminWeb tenant-create form.
 */
export interface ArchetypeOption {
  value: ActiveArchetype;
  label: string;
  info: string;
}

export const ARCHETYPE_OPTIONS: readonly ArchetypeOption[] = [
  {
    value: 'PABSON',
    label: 'PABSON (Nepal Private Schools)',
    info: 'NPR, Bikram Sambat calendar, Asia/Kathmandu, Sunday-Friday week, south-asian number format, IEMIS student IDs required',
  },
  {
    value: 'GENERIC',
    label: 'Generic',
    info: 'USD, Gregorian calendar, customizable later in workspace settings',
  },
] as const;

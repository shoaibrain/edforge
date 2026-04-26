/**
 * Nepal administrative divisions — CEHRD-canonical reference data
 *
 * Single source of truth for Nepal's federal-structure administrative divisions
 * (post-2017 federalism: 7 provinces × 77 districts × 4 municipality types).
 *
 * Used by:
 *   - Inbound: pilot xlsx import (Sprint D/E) — district names in xlsx must
 *     resolve to entries here; unmapped values become findings warnings.
 *   - Outbound: CEHRD Flash I/II export (Sprint I/K/L) — Flash .xlsm cells
 *     must use the same `cehrdCode` issued here.
 *   - UI: AddressFieldsNepal component (Sprint A.8) renders the Province +
 *     District selects from these arrays.
 *
 * Why a single source: drift between import-side and export-side district
 * naming would silently corrupt CEHRD round-trips. One canonical list
 * eliminates that drift.
 *
 * --- Data provenance --------------------------------------------------------
 *
 * Source of truth: Centre for Education and Human Resource Development (CEHRD),
 * Government of Nepal. https://cehrd.gov.np/
 *
 * Catalog version: 1.0.0
 * Federal structure baseline: 2017 federalism (7 provinces, 77 districts after
 *   Nawalparasi & Rukum splits).
 * Province codes: 1–7, official Government of Nepal ordinance.
 * District CEHRD codes: 2-digit zero-padded strings, '01'..'77', in CEHRD's
 *   canonical East-to-West ordering grouped by province.
 *
 * V1 data quality note: structure (counts, FK integrity, code uniqueness) is
 * locked by `nepal-administrative-divisions.spec.ts`. English district names
 * are populated. Nepali (Devanagari) names are populated for provinces (high
 * confidence) and left optional on districts where authoritative Devanagari
 * spelling needs cross-verification against a CEHRD-published source artifact
 * — the UI falls back to English when `nameNe` is undefined. To populate the
 * Nepali district names exhaustively, see the CEHRD Flash I/II reference
 * .xlsm artifact (will be ingested in Sprint I.6 — at that point this file
 * gets a sweep-update + version bump).
 *
 * --- Reorganization protocol ------------------------------------------------
 *
 * On CEHRD reorganization (last major: 2017 federal restructuring; previous:
 * 2015 zone-system retirement):
 *   1. Bump `CATALOG_VERSION` to a new major.
 *   2. Add a migration test: every legacy `cehrdCode` must resolve to a
 *      successor district (`replacedBy` field) so historical data stays
 *      queryable.
 *   3. Update `tenant-locale-defaults.ts` if `defaultDistrictCode`-style
 *      defaults change.
 *   4. Bump `@aibrains/shared-types` version (minor for additions, major for
 *      breaking ID changes).
 *
 * --- Update workflow --------------------------------------------------------
 *
 * Adding a Nepali district name (or correcting English spelling):
 *   1. Edit the array entry below.
 *   2. Re-run `npm test` in packages/shared-types — counts/FK/uniqueness must
 *      stay green.
 *   3. Bump shared-types patch version, publish, refresh consumer pins
 *      (per CLAUDE.md publish-gate checklist).
 */

/** Catalog version. Bump major on CEHRD reorganization. */
export const NEPAL_ADMIN_DIVISIONS_CATALOG_VERSION = '1.0.0' as const;

/** Province code: 1 (Koshi) through 7 (Sudurpashchim). */
export type NepalProvinceCode = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A Nepal province record. */
export interface NepalProvince {
  readonly provinceCode: NepalProvinceCode;
  readonly nameEn: string;
  readonly nameNe: string;
}

/** A Nepal district record. */
export interface NepalDistrict {
  /** CEHRD-issued 2-digit zero-padded code, '01'..'77'. */
  readonly cehrdCode: string;
  readonly provinceCode: NepalProvinceCode;
  readonly nameEn: string;
  /**
   * Devanagari name. Optional in V1 — see "data quality note" in the file
   * header. UI falls back to `nameEn` when undefined.
   */
  readonly nameNe?: string;
}

/**
 * Local-government body type. Nepal post-2017 federalism distinguishes four
 * tiers; CEHRD uses the same enum on its school-registration forms.
 *
 *   - `metropolitan`        → e.g., Kathmandu Metropolitan City
 *   - `sub_metropolitan`    → e.g., Pokhara Sub-Metropolitan City
 *   - `municipality`        → standard urban municipality
 *   - `rural_municipality`  → गाउँपालिका (gaunpalika), formerly VDC
 */
export type NepalMunicipalityType =
  | 'metropolitan'
  | 'sub_metropolitan'
  | 'municipality'
  | 'rural_municipality';

export const NEPAL_MUNICIPALITY_TYPES: readonly NepalMunicipalityType[] = [
  'metropolitan',
  'sub_metropolitan',
  'municipality',
  'rural_municipality',
] as const;

/** All 7 provinces of Nepal (post-2017 federalism). */
export const NEPAL_PROVINCES: readonly NepalProvince[] = [
  { provinceCode: 1, nameEn: 'Koshi',         nameNe: 'कोशी' },
  { provinceCode: 2, nameEn: 'Madhesh',       nameNe: 'मधेश' },
  { provinceCode: 3, nameEn: 'Bagmati',       nameNe: 'बागमती' },
  { provinceCode: 4, nameEn: 'Gandaki',       nameNe: 'गण्डकी' },
  { provinceCode: 5, nameEn: 'Lumbini',       nameNe: 'लुम्बिनी' },
  { provinceCode: 6, nameEn: 'Karnali',       nameNe: 'कर्णाली' },
  { provinceCode: 7, nameEn: 'Sudurpashchim', nameNe: 'सुदूरपश्चिम' },
] as const;

/**
 * All 77 districts of Nepal (post-2017 federalism — Nawalparasi split into
 * Nawalpur + Parasi; Rukum split into East + West).
 *
 * Order: CEHRD canonical East-to-West, grouped by province ascending.
 *
 * Province distribution (locked by .spec.ts):
 *   1 Koshi          → 14 districts (codes 01–14)
 *   2 Madhesh        →  8 districts (codes 15–22)
 *   3 Bagmati        → 13 districts (codes 23–35)
 *   4 Gandaki        → 11 districts (codes 36–46)
 *   5 Lumbini        → 12 districts (codes 47–58)
 *   6 Karnali        → 10 districts (codes 59–68)
 *   7 Sudurpashchim  →  9 districts (codes 69–77)
 *                       ───
 *                        77
 */
export const NEPAL_DISTRICTS: readonly NepalDistrict[] = [
  // Province 1 — Koshi (14)
  { cehrdCode: '01', provinceCode: 1, nameEn: 'Taplejung' },
  { cehrdCode: '02', provinceCode: 1, nameEn: 'Panchthar' },
  { cehrdCode: '03', provinceCode: 1, nameEn: 'Ilam' },
  { cehrdCode: '04', provinceCode: 1, nameEn: 'Jhapa' },
  { cehrdCode: '05', provinceCode: 1, nameEn: 'Morang' },
  { cehrdCode: '06', provinceCode: 1, nameEn: 'Sunsari' },
  { cehrdCode: '07', provinceCode: 1, nameEn: 'Dhankuta' },
  { cehrdCode: '08', provinceCode: 1, nameEn: 'Terhathum' },
  { cehrdCode: '09', provinceCode: 1, nameEn: 'Sankhuwasabha' },
  { cehrdCode: '10', provinceCode: 1, nameEn: 'Bhojpur' },
  { cehrdCode: '11', provinceCode: 1, nameEn: 'Solukhumbu' },
  { cehrdCode: '12', provinceCode: 1, nameEn: 'Okhaldhunga' },
  { cehrdCode: '13', provinceCode: 1, nameEn: 'Khotang' },
  { cehrdCode: '14', provinceCode: 1, nameEn: 'Udayapur' },

  // Province 2 — Madhesh (8)
  { cehrdCode: '15', provinceCode: 2, nameEn: 'Saptari' },
  { cehrdCode: '16', provinceCode: 2, nameEn: 'Siraha' },
  { cehrdCode: '17', provinceCode: 2, nameEn: 'Dhanusha' },
  { cehrdCode: '18', provinceCode: 2, nameEn: 'Mahottari' },
  { cehrdCode: '19', provinceCode: 2, nameEn: 'Sarlahi' },
  { cehrdCode: '20', provinceCode: 2, nameEn: 'Rautahat' },
  { cehrdCode: '21', provinceCode: 2, nameEn: 'Bara' },
  { cehrdCode: '22', provinceCode: 2, nameEn: 'Parsa' },

  // Province 3 — Bagmati (13)
  { cehrdCode: '23', provinceCode: 3, nameEn: 'Sindhuli' },
  { cehrdCode: '24', provinceCode: 3, nameEn: 'Ramechhap' },
  { cehrdCode: '25', provinceCode: 3, nameEn: 'Dolakha' },
  { cehrdCode: '26', provinceCode: 3, nameEn: 'Sindhupalchok' },
  { cehrdCode: '27', provinceCode: 3, nameEn: 'Kavrepalanchok' },
  { cehrdCode: '28', provinceCode: 3, nameEn: 'Bhaktapur' },
  { cehrdCode: '29', provinceCode: 3, nameEn: 'Lalitpur',     nameNe: 'ललितपुर' },
  { cehrdCode: '30', provinceCode: 3, nameEn: 'Kathmandu',    nameNe: 'काठमाडौं' },
  { cehrdCode: '31', provinceCode: 3, nameEn: 'Nuwakot' },
  { cehrdCode: '32', provinceCode: 3, nameEn: 'Rasuwa' },
  { cehrdCode: '33', provinceCode: 3, nameEn: 'Dhading' },
  { cehrdCode: '34', provinceCode: 3, nameEn: 'Makwanpur' },
  { cehrdCode: '35', provinceCode: 3, nameEn: 'Chitwan' },

  // Province 4 — Gandaki (11)
  { cehrdCode: '36', provinceCode: 4, nameEn: 'Gorkha' },
  { cehrdCode: '37', provinceCode: 4, nameEn: 'Lamjung' },
  { cehrdCode: '38', provinceCode: 4, nameEn: 'Tanahun' },
  { cehrdCode: '39', provinceCode: 4, nameEn: 'Syangja' },
  { cehrdCode: '40', provinceCode: 4, nameEn: 'Kaski' },
  { cehrdCode: '41', provinceCode: 4, nameEn: 'Manang' },
  { cehrdCode: '42', provinceCode: 4, nameEn: 'Mustang' },
  { cehrdCode: '43', provinceCode: 4, nameEn: 'Myagdi' },
  { cehrdCode: '44', provinceCode: 4, nameEn: 'Parbat' },
  { cehrdCode: '45', provinceCode: 4, nameEn: 'Baglung' },
  { cehrdCode: '46', provinceCode: 4, nameEn: 'Nawalpur' }, // East Nawalparasi (post-2017 split)

  // Province 5 — Lumbini (12)
  { cehrdCode: '47', provinceCode: 5, nameEn: 'Parasi' },   // West Nawalparasi (post-2017 split)
  { cehrdCode: '48', provinceCode: 5, nameEn: 'Rupandehi' },
  { cehrdCode: '49', provinceCode: 5, nameEn: 'Kapilvastu' },
  { cehrdCode: '50', provinceCode: 5, nameEn: 'Arghakhanchi' },
  { cehrdCode: '51', provinceCode: 5, nameEn: 'Palpa' },
  { cehrdCode: '52', provinceCode: 5, nameEn: 'Gulmi' },
  { cehrdCode: '53', provinceCode: 5, nameEn: 'Dang' },
  { cehrdCode: '54', provinceCode: 5, nameEn: 'Pyuthan' },
  { cehrdCode: '55', provinceCode: 5, nameEn: 'Rolpa' },
  { cehrdCode: '56', provinceCode: 5, nameEn: 'Rukum East' }, // post-2017 split (eastern half)
  { cehrdCode: '57', provinceCode: 5, nameEn: 'Banke' },
  { cehrdCode: '58', provinceCode: 5, nameEn: 'Bardiya' },

  // Province 6 — Karnali (10)
  { cehrdCode: '59', provinceCode: 6, nameEn: 'Rukum West' }, // post-2017 split (western half)
  { cehrdCode: '60', provinceCode: 6, nameEn: 'Salyan' },
  { cehrdCode: '61', provinceCode: 6, nameEn: 'Surkhet' },
  { cehrdCode: '62', provinceCode: 6, nameEn: 'Dailekh' },
  { cehrdCode: '63', provinceCode: 6, nameEn: 'Jajarkot' },
  { cehrdCode: '64', provinceCode: 6, nameEn: 'Jumla' },
  { cehrdCode: '65', provinceCode: 6, nameEn: 'Kalikot' },
  { cehrdCode: '66', provinceCode: 6, nameEn: 'Mugu' },
  { cehrdCode: '67', provinceCode: 6, nameEn: 'Humla' },
  { cehrdCode: '68', provinceCode: 6, nameEn: 'Dolpa' },

  // Province 7 — Sudurpashchim (9)
  { cehrdCode: '69', provinceCode: 7, nameEn: 'Bajura' },
  { cehrdCode: '70', provinceCode: 7, nameEn: 'Bajhang' },
  { cehrdCode: '71', provinceCode: 7, nameEn: 'Achham' },
  { cehrdCode: '72', provinceCode: 7, nameEn: 'Doti' },
  { cehrdCode: '73', provinceCode: 7, nameEn: 'Kailali' },
  { cehrdCode: '74', provinceCode: 7, nameEn: 'Kanchanpur' },
  { cehrdCode: '75', provinceCode: 7, nameEn: 'Dadeldhura' },
  { cehrdCode: '76', provinceCode: 7, nameEn: 'Baitadi' },
  { cehrdCode: '77', provinceCode: 7, nameEn: 'Darchula' },
] as const;

// ============================================
// Helpers
// ============================================

/**
 * Look up a province by code. Returns `undefined` if the code is invalid.
 *
 * Use case: form rendering, import-row resolution.
 */
export function findNepalProvince(
  provinceCode: NepalProvinceCode | number,
): NepalProvince | undefined {
  return NEPAL_PROVINCES.find((p) => p.provinceCode === provinceCode);
}

/**
 * Look up a district by CEHRD code. Returns `undefined` if not found.
 *
 * Use case: import-row resolution, Flash export aggregation.
 */
export function findNepalDistrict(cehrdCode: string): NepalDistrict | undefined {
  return NEPAL_DISTRICTS.find((d) => d.cehrdCode === cehrdCode);
}

/**
 * All districts in a given province, in canonical CEHRD order.
 *
 * Use case: cascading District select after Province choice in
 * `<AddressFieldsNepal>` (Sprint A.8).
 */
export function nepalDistrictsForProvince(
  provinceCode: NepalProvinceCode | number,
): readonly NepalDistrict[] {
  return NEPAL_DISTRICTS.filter((d) => d.provinceCode === provinceCode);
}

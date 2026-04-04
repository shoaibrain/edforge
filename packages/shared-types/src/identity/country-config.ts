/**
 * Country Configuration Registry
 *
 * Compile-time constants defining per-country configuration for:
 * - Address schema (fields, labels, validation)
 * - Timezones
 * - Default locale, calendar system, currency
 * - Default school days
 * - Date format, phone format
 *
 * This is the SINGLE SOURCE OF TRUTH for country-specific behavior.
 * UI rendering and backend validation both consume this registry.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface AddressFieldConfig {
  key: string;
  label: string;
  required: boolean;
  maxLength: number;
  placeholder: string;
  type: 'text' | 'select';
  options?: { value: string; label: string }[];
}

export type CalendarSystem = 'gregorian' | 'bikram_sambat';

export interface CountryConfig {
  /** ISO 3166-1 alpha-3 code */
  code: string;
  /** Display name */
  name: string;
  /** ISO 3166-1 alpha-2 code */
  iso2: string;
  /** Available timezones for this country */
  timezones: { value: string; label: string }[];
  /** Default timezone */
  defaultTimezone: string;
  /** Default locale identifier */
  defaultLocale: string;
  /** Default calendar system */
  defaultCalendarSystem: CalendarSystem;
  /** Default currency code */
  defaultCurrency: string;
  /** Default school operating days (0=Sun..6=Sat) */
  defaultSchoolDays: number[];
  /** Date display format */
  dateFormat: string;
  /** Phone number prefix */
  phonePrefix: string;
  /** Phone number validation regex (stored as string for JSON serializability) */
  phonePattern: string;
  /** Address fields rendered in forms */
  addressFields: AddressFieldConfig[];
  /** Default time format */
  defaultTimeFormat: '12h' | '24h';
}

// ============================================================================
// NEPAL GEOGRAPHIC DATA (provinces & districts)
// ============================================================================

export const NEPAL_PROVINCES: { value: string; label: string }[] = [
  { value: 'Koshi', label: 'Koshi Province' },
  { value: 'Madhesh', label: 'Madhesh Province' },
  { value: 'Bagmati', label: 'Bagmati Province' },
  { value: 'Gandaki', label: 'Gandaki Province' },
  { value: 'Lumbini', label: 'Lumbini Province' },
  { value: 'Karnali', label: 'Karnali Province' },
  { value: 'Sudurpashchim', label: 'Sudurpashchim Province' },
];

export const NEPAL_PROVINCE_DISTRICTS: Record<string, string[]> = {
  Koshi: [
    'Bhojpur', 'Dhankuta', 'Ilam', 'Jhapa', 'Khotang', 'Morang',
    'Okhaldhunga', 'Panchthar', 'Sankhuwasabha', 'Solukhumbu',
    'Sunsari', 'Taplejung', 'Terhathum', 'Udayapur',
  ],
  Madhesh: [
    'Bara', 'Dhanusha', 'Mahottari', 'Parsa', 'Rautahat',
    'Saptari', 'Sarlahi', 'Siraha',
  ],
  Bagmati: [
    'Bhaktapur', 'Chitwan', 'Dhading', 'Dolakha', 'Kathmandu',
    'Kavrepalanchok', 'Lalitpur', 'Makwanpur', 'Nuwakot',
    'Ramechhap', 'Rasuwa', 'Sindhuli', 'Sindhupalchok',
  ],
  Gandaki: [
    'Baglung', 'Gorkha', 'Kaski', 'Lamjung', 'Manang',
    'Mustang', 'Myagdi', 'Nawalpur', 'Parbat', 'Syangja', 'Tanahun',
  ],
  Lumbini: [
    'Arghakhanchi', 'Banke', 'Bardiya', 'Dang', 'Eastern Rukum',
    'Gulmi', 'Kapilvastu', 'Nawalparasi West', 'Palpa',
    'Pyuthan', 'Rolpa', 'Rupandehi',
  ],
  Karnali: [
    'Dailekh', 'Dolpa', 'Humla', 'Jajarkot', 'Jumla',
    'Kalikot', 'Mugu', 'Salyan', 'Surkhet', 'Western Rukum',
  ],
  Sudurpashchim: [
    'Achham', 'Baitadi', 'Bajhang', 'Bajura', 'Dadeldhura',
    'Darchula', 'Doti', 'Kailali', 'Kanchanpur',
  ],
};

/** Flat list of all 77 Nepal districts with their province */
export const NEPAL_DISTRICTS: { value: string; label: string; province: string }[] =
  Object.entries(NEPAL_PROVINCE_DISTRICTS).flatMap(([province, districts]) =>
    districts.map(d => ({ value: d, label: d, province }))
  );

// ============================================================================
// US GEOGRAPHIC DATA
// ============================================================================

const US_STATES: { value: string; label: string }[] = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

// ============================================================================
// COUNTRY CONFIGURATIONS
// ============================================================================

const NEPAL_CONFIG: CountryConfig = {
  code: 'NPL',
  name: 'Nepal',
  iso2: 'NP',
  timezones: [
    { value: 'Asia/Kathmandu', label: 'Nepal Time (NPT, UTC+5:45)' },
  ],
  defaultTimezone: 'Asia/Kathmandu',
  defaultLocale: 'ne-NP',
  defaultCalendarSystem: 'bikram_sambat',
  defaultCurrency: 'NPR',
  defaultSchoolDays: [0, 1, 2, 3, 4, 5], // Sun-Fri
  dateFormat: 'YYYY/MM/DD',
  phonePrefix: '+977',
  phonePattern: '^(\\+977)?[0-9]{7,10}$',
  defaultTimeFormat: '24h',
  addressFields: [
    { key: 'street1', label: 'Street / Tole', required: true, maxLength: 200, placeholder: 'Street or Tole name', type: 'text' },
    { key: 'wardNumber', label: 'Ward No.', required: false, maxLength: 10, placeholder: 'e.g., 5', type: 'text' },
    { key: 'municipality', label: 'Municipality / VDC', required: false, maxLength: 100, placeholder: 'e.g., Kathmandu Metropolitan City', type: 'text' },
    { key: 'district', label: 'District', required: true, maxLength: 100, placeholder: 'Select district', type: 'select', options: NEPAL_DISTRICTS.map(d => ({ value: d.value, label: d.label })) },
    { key: 'province', label: 'Province', required: true, maxLength: 100, placeholder: 'Select province', type: 'select', options: NEPAL_PROVINCES },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'Nepal', type: 'text' },
  ],
};

const USA_CONFIG: CountryConfig = {
  code: 'USA',
  name: 'United States',
  iso2: 'US',
  timezones: [
    { value: 'America/New_York', label: 'Eastern (ET)' },
    { value: 'America/Chicago', label: 'Central (CT)' },
    { value: 'America/Denver', label: 'Mountain (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
    { value: 'America/Anchorage', label: 'Alaska (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
  ],
  defaultTimezone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'USD',
  defaultSchoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  dateFormat: 'MM/DD/YYYY',
  phonePrefix: '+1',
  phonePattern: '^(\\+1)?[2-9]\\d{9}$',
  defaultTimeFormat: '12h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: '123 Main Street', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: 'Suite 100, Building A', type: 'text' },
    { key: 'city', label: 'City', required: true, maxLength: 100, placeholder: 'Springfield', type: 'text' },
    { key: 'state', label: 'State', required: true, maxLength: 2, placeholder: 'IL', type: 'select', options: US_STATES },
    { key: 'zipCode', label: 'Zip Code', required: true, maxLength: 20, placeholder: '62701', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'United States', type: 'text' },
  ],
};

const INDIA_CONFIG: CountryConfig = {
  code: 'IND',
  name: 'India',
  iso2: 'IN',
  timezones: [
    { value: 'Asia/Kolkata', label: 'India Standard Time (IST, UTC+5:30)' },
  ],
  defaultTimezone: 'Asia/Kolkata',
  defaultLocale: 'en-IN',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'INR',
  defaultSchoolDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
  dateFormat: 'DD/MM/YYYY',
  phonePrefix: '+91',
  phonePattern: '^(\\+91)?[6-9]\\d{9}$',
  defaultTimeFormat: '12h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: 'Street address', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: 'Landmark, area', type: 'text' },
    { key: 'city', label: 'City', required: true, maxLength: 100, placeholder: 'Mumbai', type: 'text' },
    { key: 'state', label: 'State', required: true, maxLength: 100, placeholder: 'Maharashtra', type: 'text' },
    { key: 'zipCode', label: 'PIN Code', required: true, maxLength: 10, placeholder: '400001', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'India', type: 'text' },
  ],
};

const GBR_CONFIG: CountryConfig = {
  code: 'GBR',
  name: 'United Kingdom',
  iso2: 'GB',
  timezones: [
    { value: 'Europe/London', label: 'Greenwich Mean Time (GMT/BST)' },
  ],
  defaultTimezone: 'Europe/London',
  defaultLocale: 'en-GB',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'GBP',
  defaultSchoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  dateFormat: 'DD/MM/YYYY',
  phonePrefix: '+44',
  phonePattern: '^(\\+44)?[0-9]{10,11}$',
  defaultTimeFormat: '24h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: '10 Downing Street', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: '', type: 'text' },
    { key: 'city', label: 'City / Town', required: true, maxLength: 100, placeholder: 'London', type: 'text' },
    { key: 'region', label: 'County', required: false, maxLength: 100, placeholder: 'Greater London', type: 'text' },
    { key: 'zipCode', label: 'Postcode', required: true, maxLength: 10, placeholder: 'SW1A 2AA', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'United Kingdom', type: 'text' },
  ],
};

const CAN_CONFIG: CountryConfig = {
  code: 'CAN',
  name: 'Canada',
  iso2: 'CA',
  timezones: [
    { value: 'America/Toronto', label: 'Eastern (ET)' },
    { value: 'America/Winnipeg', label: 'Central (CT)' },
    { value: 'America/Edmonton', label: 'Mountain (MT)' },
    { value: 'America/Vancouver', label: 'Pacific (PT)' },
    { value: 'America/Halifax', label: 'Atlantic (AT)' },
    { value: 'America/St_Johns', label: "Newfoundland (NT)" },
  ],
  defaultTimezone: 'America/Toronto',
  defaultLocale: 'en-CA',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'CAD',
  defaultSchoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  dateFormat: 'YYYY-MM-DD',
  phonePrefix: '+1',
  phonePattern: '^(\\+1)?[2-9]\\d{9}$',
  defaultTimeFormat: '12h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: '123 Main Street', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: '', type: 'text' },
    { key: 'city', label: 'City', required: true, maxLength: 100, placeholder: 'Toronto', type: 'text' },
    { key: 'state', label: 'Province', required: true, maxLength: 100, placeholder: 'ON', type: 'text' },
    { key: 'zipCode', label: 'Postal Code', required: true, maxLength: 10, placeholder: 'M5V 2H1', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'Canada', type: 'text' },
  ],
};

const AUS_CONFIG: CountryConfig = {
  code: 'AUS',
  name: 'Australia',
  iso2: 'AU',
  timezones: [
    { value: 'Australia/Sydney', label: 'Eastern (AEST/AEDT)' },
    { value: 'Australia/Adelaide', label: 'Central (ACST/ACDT)' },
    { value: 'Australia/Perth', label: 'Western (AWST)' },
    { value: 'Australia/Brisbane', label: 'Queensland (AEST, no DST)' },
    { value: 'Australia/Darwin', label: 'Northern Territory (ACST, no DST)' },
  ],
  defaultTimezone: 'Australia/Sydney',
  defaultLocale: 'en-AU',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'AUD',
  defaultSchoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  dateFormat: 'DD/MM/YYYY',
  phonePrefix: '+61',
  phonePattern: '^(\\+61)?[0-9]{9,10}$',
  defaultTimeFormat: '12h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: '123 George Street', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: '', type: 'text' },
    { key: 'city', label: 'City / Suburb', required: true, maxLength: 100, placeholder: 'Sydney', type: 'text' },
    { key: 'state', label: 'State / Territory', required: true, maxLength: 10, placeholder: 'NSW', type: 'text' },
    { key: 'zipCode', label: 'Postcode', required: true, maxLength: 10, placeholder: '2000', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'Australia', type: 'text' },
  ],
};

/** Generic fallback for unsupported countries */
const GENERIC_CONFIG: CountryConfig = {
  code: 'OTHER',
  name: 'Other',
  iso2: '',
  timezones: [
    { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  ],
  defaultTimezone: 'UTC',
  defaultLocale: 'en-US',
  defaultCalendarSystem: 'gregorian',
  defaultCurrency: 'USD',
  defaultSchoolDays: [1, 2, 3, 4, 5], // Mon-Fri
  dateFormat: 'YYYY-MM-DD',
  phonePrefix: '+',
  phonePattern: '^\\+?[0-9]{7,15}$',
  defaultTimeFormat: '24h',
  addressFields: [
    { key: 'street1', label: 'Address Line 1', required: true, maxLength: 200, placeholder: 'Street address', type: 'text' },
    { key: 'street2', label: 'Address Line 2', required: false, maxLength: 200, placeholder: '', type: 'text' },
    { key: 'city', label: 'City', required: true, maxLength: 100, placeholder: 'City', type: 'text' },
    { key: 'region', label: 'State / Region', required: false, maxLength: 100, placeholder: 'State or region', type: 'text' },
    { key: 'zipCode', label: 'Postal Code', required: false, maxLength: 20, placeholder: 'Postal code', type: 'text' },
    { key: 'country', label: 'Country', required: true, maxLength: 100, placeholder: 'Country', type: 'text' },
  ],
};

// ============================================================================
// REGISTRY
// ============================================================================

/** Country configuration registry — compile-time constant */
export const COUNTRY_REGISTRY: Record<string, CountryConfig> = {
  NPL: NEPAL_CONFIG,
  USA: USA_CONFIG,
  IND: INDIA_CONFIG,
  GBR: GBR_CONFIG,
  CAN: CAN_CONFIG,
  AUS: AUS_CONFIG,
  OTHER: GENERIC_CONFIG,
};

/**
 * Get configuration for a country by ISO 3166-1 alpha-3 code.
 * Returns generic fallback for unknown country codes.
 */
export function getCountryConfig(code: string): CountryConfig {
  return COUNTRY_REGISTRY[code] || GENERIC_CONFIG;
}

/**
 * Country options for dropdown selects, derived from registry.
 * Replaces hardcoded COUNTRY_OPTIONS.
 */
export const COUNTRY_OPTIONS: { value: string; label: string }[] = Object.values(COUNTRY_REGISTRY).map(c => ({
  value: c.code,
  label: c.name,
}));

/**
 * Get timezone options for a specific country.
 */
export function getTimezoneOptionsForCountry(countryCode: string): { value: string; label: string }[] {
  return getCountryConfig(countryCode).timezones;
}

/**
 * Get locale options for a country.
 * Always includes English as a fallback option.
 */
export function getLocaleOptionsForCountry(countryCode: string): { value: string; label: string }[] {
  const config = getCountryConfig(countryCode);
  const options: { value: string; label: string }[] = [];

  // Add country-specific locale first
  if (config.defaultLocale !== 'en-US') {
    const localeLabels: Record<string, string> = {
      'ne-NP': 'Nepali (नेपाली)',
      'en-IN': 'English (India)',
      'en-GB': 'English (UK)',
      'en-CA': 'English (Canada)',
      'en-AU': 'English (Australia)',
    };
    options.push({
      value: config.defaultLocale,
      label: localeLabels[config.defaultLocale] || config.defaultLocale,
    });
  }

  // Always include en-US
  options.push({ value: 'en-US', label: 'English (US)' });

  return options;
}

/**
 * Get all defaults for a country — used when creating a school.
 */
export function getDefaultsForCountry(countryCode: string): {
  timezone: string;
  locale: string;
  calendarSystem: CalendarSystem;
  schoolDays: number[];
  dateFormat: string;
  timeFormat: '12h' | '24h';
  currency: string;
} {
  const config = getCountryConfig(countryCode);
  return {
    timezone: config.defaultTimezone,
    locale: config.defaultLocale,
    calendarSystem: config.defaultCalendarSystem,
    schoolDays: config.defaultSchoolDays,
    dateFormat: config.dateFormat,
    timeFormat: config.defaultTimeFormat,
    currency: config.defaultCurrency,
  };
}

/**
 * Validate a phone number against a country's pattern.
 * Constructs RegExp at validation time from the stored string pattern.
 */
export function validatePhoneForCountry(phone: string, countryCode: string): boolean {
  const config = getCountryConfig(countryCode);
  try {
    return new RegExp(config.phonePattern).test(phone);
  } catch {
    return true; // If pattern is invalid, don't block
  }
}

/** US state abbreviation → timezone mapping (preserved for backward compat) */
export const STATE_TIMEZONE_MAP: Record<string, string> = {
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York',
  NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  VT: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  DC: 'America/New_York',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago',
  OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', WI: 'America/Chicago', IN: 'America/New_York',
  MI: 'America/New_York',
  AZ: 'America/Denver', CO: 'America/Denver', ID: 'America/Denver',
  MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver',
  WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
};

# EdForge Internationalization, Enterprise School Governance & Finance Architecture — Sprint Plan

> **Goal**: Transform EdForge from a US-centric prototype into an enterprise-grade, internationally-aware EMIS platform. Starting with Nepal (first 100 pilot schools), build the foundational architecture for multi-country support, temporal data governance, and a referential event-driven finance module.

---

## Executive Summary

This plan addresses five interconnected pillars:

1. **Internationalization (i18n) Foundation** — Country registry, timezone, locale, calendar system, currency as first-class tenant/school attributes
2. **Nepal-Specific Support** — Bikram Sambat calendar, NPR currency, Nepal address format, Nepal timezones, Nepali grade levels
3. **Enterprise Address & Geolocation** — Country-adaptive address schemas, geocoding, address validation
4. **Temporal Data Governance** — Immutable school configuration during active academic years, field-level edit policies, audit trails
5. **Enterprise Finance Architecture** — Entity-mapped fees, event-driven billing, versioned fee structures, pro-rating, audit trails

---

## Current State Analysis

### What Exists

| Layer | Component | Status |
|-------|-----------|--------|
| **Shared Types** | `school.schema.ts` — CreateSchool/UpdateSchool Zod schemas | Working, US-centric |
| **Shared Types** | `grade-levels.ts` — ORDERED_GRADES, cross-validation | Working, US-centric (PK-12) |
| **Shared Types** | `fee-structure.schema.ts` — Fee CRUD schemas | Working, NPR hardcoded |
| **Shared Types** | `invoice.schema.ts` — Invoice lifecycle schemas | Working |
| **Shared Types** | `common.ts` (finance) — `currencyEnum: z.enum(['NPR'])` | Hardcoded single currency |
| **Backend** | `schools.service.ts` — Create/update/list schools | Working, no temporal governance |
| **Backend** | `department.entity.ts` — SchoolConfiguration entity, DEFAULT_SCHOOL_CONFIG | Working, US defaults (ET, en-US, Mon-Fri) |
| **Backend** | `academic-years.service.ts` — Academic year CRUD | Working, Gregorian dates only |
| **Backend** | Finance microservice (fee-structures, invoices, payments, student-accounts) | Working for NPR |
| **Frontend** | School wizard (5 steps: BasicInfo, LocationContact, Organization, EdFi, Review) | Working, US-centric |
| **Frontend** | `LocationContactStep.tsx` — Address + Regional Settings | US-only (5 countries, 6 US timezones) |
| **Frontend** | `school-wizard.utils.ts` — COUNTRY_OPTIONS (5), US_TIMEZONE_OPTIONS (6), STATE_TIMEZONE_MAP | Hardcoded US |
| **Frontend** | Finance module (fee structures, invoices, payments, dashboard) | Working for NPR pilot |

### Critical Gaps

| Gap | Impact | Files |
|-----|--------|-------|
| **No Nepal in country list** | First 100 customers can't select their country | `school-wizard.utils.ts:COUNTRY_OPTIONS` |
| **No Nepal timezones** | `Asia/Kathmandu` (UTC+5:45) not available | `school-wizard.utils.ts:US_TIMEZONE_OPTIONS` |
| **No Bikram Sambat calendar** | Academic years show 2026 instead of 2082-2083 BS | `academicCalendarTypeSchema`, all date handling |
| **No Nepal address format** | Nepal uses Ward/Municipality/District/Province, not State/Zip | `schoolAddressSchema`, `LocationContactStep.tsx` |
| **Address state field hardcoded to 2-char** | Nepal provinces are full names (e.g., "Bagmati Province") | `LocationContactStep.tsx:maxLength={2}` |
| **No country-aware timezone auto-detect** | `STATE_TIMEZONE_MAP` only works for US states | `LocationContactStep.tsx` |
| **Locale hardcoded to `en-US`** | No `ne-NP` locale support | `school-wizard.utils.ts`, `DEFAULT_SCHOOL_CONFIG` |
| **School config freely editable** | Schedule, term structure, grading scale can change mid-year | `schools.service.ts:updateSchool()`, config update endpoint |
| **No audit trail on config changes** | No record of who changed what, when, or why | All update endpoints |
| **`academicCalendarType` has no BS option** | Only semester/quarter/trimester — no annual (common in Nepal) | `school.schema.ts` |
| **`DEFAULT_SCHOOL_CONFIG.schoolDays` is Mon-Fri** | Nepal schools operate Sun-Fri (Saturday off) | `department.entity.ts` |
| **Finance `currencyEnum` is `['NPR']` only** | Can't expand to multi-currency without schema change | `finance/common.ts` |
| **Fee structure not linked to academic year entity** | `academicYear` is a freeform string, not a UUID reference | `fee-structure.schema.ts` |
| **No fee-to-enrollment event trigger architecture** | `enrollment-webhook.controller.ts` exists but coupling is ad-hoc | Finance microservice |
| **No versioned fee structures** | Changing a fee amount retroactively affects historical invoices | `fee-structures.service.ts` |
| **No field-level edit governance** | `updateSchool` and config update accept any field anytime | All update endpoints |
| **Principal name asked at creation** | User wants to defer this | `createSchoolSchema`, wizard |

---

## Architecture Decisions

### AD-1: Country Registry as First-Class Entity

Instead of a hardcoded country dropdown, create a **Country Configuration** registry in `shared-types` that defines per-country:
- Address schema (which fields, labels, validation rules)
- Available timezones
- Default locale
- Default calendar system
- Default currency
- Default school days
- Date format
- Phone format/validation

This registry is a compile-time constant (not a database entity) that drives UI rendering and backend validation.

### AD-2: Calendar System Abstraction

Introduce a `calendarSystem` field (`gregorian` | `bikram_sambat` | `nepali_era`) at the school level. All date storage remains ISO 8601 (Gregorian) in DynamoDB. Conversion happens at:
- **Display layer** (frontend): Convert Gregorian → BS for display using a conversion library
- **Input layer** (frontend): Convert BS → Gregorian before sending to API
- **Reporting layer**: Format dates per school's calendar system

This avoids dual-calendar storage complexity while supporting display in any calendar system.

### AD-3: Temporal Governance via School Lifecycle States

School configuration fields are classified into three mutability tiers:

| Tier | Fields | Edit Policy |
|------|--------|-------------|
| **Immutable** | `schoolCode` | Never changes after creation |
| **Locked during active year** | `academicCalendarType`, `gradingScale`, `schoolDays`, `startTime`, `endTime`, `periodDuration`, `gradeRange`, `calendarSystem` | Cannot change while any academic year is in `active` status. Requires year to be `completed` or `archived` to modify. |
| **Always editable** | `name`, `shortName`, `phone`, `email`, `website`, `address`, `principalName`, `timezone`, `locale`, `logoUrl`, `features.*`, `notificationsEnabled` | Can change anytime |

Backend enforces this by checking academic year status before allowing updates to locked fields.

### AD-4: Country-Adaptive Address Schema

Replace the flat US-centric `schoolAddressSchema` with a discriminated union based on country:

```
USA: street1, street2, city, state (2-char), zipCode (5+4), country
Nepal: street1, wardNumber, municipality, district, province, country
Generic: street1, street2, city, region, postalCode, country
```

Backend validates address completeness per the country's schema. Frontend renders the appropriate form fields based on selected country.

### AD-5: Finance Entity Referential Integrity

Fee structures link to:
- `academicYearId` (UUID, not freeform string) — referential integrity to academic year entity
- `gradeLevels` — validated against school's configured grade levels
- `effectiveFrom` / `effectiveTo` — temporal validity window
- `version` — monotonically increasing, creates new version on amount/rate changes instead of mutating

Invoices snapshot the fee structure version at generation time, so retroactive fee changes don't affect issued invoices.

---

## Sprint Plan

---

### Sprint 1: Country Registry & Internationalization Foundation

**Goal**: Build the country configuration registry, expand timezone/locale support, add Nepal as a first-class country. After this sprint, a Nepal school admin can select Nepal, get `Asia/Kathmandu` timezone, `ne-NP` locale option, and Sun-Fri school days as defaults.

**Demoable Outcome**: Create a school → select Nepal → timezone auto-sets to Asia/Kathmandu → school days default to Sun-Fri → locale shows ne-NP option → address form shows Nepal-specific fields (ward, municipality, district, province).

---

#### Ticket 1.1: Create country configuration registry in shared-types

**Files**: `packages/shared-types/src/identity/country-config.ts` (new), export from `packages/shared-types/src/schemas/identity/index.ts`

**Task**:
- Create `CountryConfig` interface:
  ```typescript
  interface CountryConfig {
    code: string;              // ISO 3166-1 alpha-3
    name: string;
    iso2: string;              // ISO 3166-1 alpha-2
    timezones: { value: string; label: string }[];
    defaultTimezone: string;
    defaultLocale: string;
    defaultCalendarSystem: 'gregorian' | 'bikram_sambat';
    defaultCurrency: string;
    defaultSchoolDays: number[];  // 0=Sun..6=Sat
    dateFormat: string;
    phonePrefix: string;
    phonePattern: RegExp;
    addressFields: AddressFieldConfig[];
  }
  ```
- Create `AddressFieldConfig` interface:
  ```typescript
  interface AddressFieldConfig {
    key: string;               // e.g., 'street1', 'wardNumber', 'district'
    label: string;
    required: boolean;
    maxLength: number;
    placeholder: string;
    type: 'text' | 'select';
    options?: { value: string; label: string }[];  // for select fields (e.g., provinces)
  }
  ```
- Define configurations for: `NPL` (Nepal), `USA` (United States), `IND` (India), `GBR` (United Kingdom), `CAN` (Canada), `AUS` (Australia)
- Nepal config:
  - Timezones: `[{ value: 'Asia/Kathmandu', label: 'Nepal Time (NPT, UTC+5:45)' }]`
  - Default locale: `ne-NP`
  - Default calendar: `bikram_sambat`
  - Default currency: `NPR`
  - Default school days: `[0, 1, 2, 3, 4, 5]` (Sun-Fri, Saturday off)
  - Date format: `YYYY/MM/DD` (BS format)
  - Phone prefix: `+977`
  - Phone pattern: `/^(\+977)?[9][6-9]\d{8}$/` (Nepal mobile)
  - Address fields: `street1` (Street/Tole), `wardNumber` (Ward No.), `municipality` (Municipality/VDC), `district` (District - select from 77 districts), `province` (Province - select from 7 provinces)
- USA config: current fields as-is but formalized
- Use `phonePattern: string` (NOT `RegExp`) for JSON serializability; construct RegExp at validation time
- Export `COUNTRY_REGISTRY: Record<string, CountryConfig>` and `getCountryConfig(code: string): CountryConfig`
- Export `COUNTRY_OPTIONS` derived from registry (replaces hardcoded version)
- Also expand `currencyEnum` in `packages/shared-types/src/schemas/finance/common.ts` from `['NPR']` to `['NPR', 'USD', 'INR', 'GBP', 'AUD', 'CAD']` so the finance schema accepts the `defaultCurrency` from the country registry

**Validation**:
- Unit test: `getCountryConfig('NPL')` returns Nepal config with `Asia/Kathmandu` timezone
- Unit test: `getCountryConfig('USA')` returns US config with 6 timezones
- Unit test: `getCountryConfig('UNKNOWN')` returns a sensible generic fallback
- `pnpm build` in shared-types succeeds

---

#### Ticket 1.2: Add `calendarSystem` field to school schema

**Files**: `packages/shared-types/src/schemas/identity/school.schema.ts`

**Task**:
- Add `calendarSystemSchema = z.enum(['gregorian', 'bikram_sambat'])`
- Add `calendarSystem` to `createSchoolSchema` with `.default('gregorian')`
- Add `calendarSystem` to `updateSchoolSchema` as optional
- Add `calendarSystem` to `schoolResponseSchema`
- Add `annual` to `academicCalendarTypeSchema` (Nepal schools commonly use annual calendar)

**Validation**:
- Unit test: `createSchoolSchema.parse({ ..., calendarSystem: 'bikram_sambat' })` succeeds
- Unit test: `createSchoolSchema.parse({ ..., calendarSystem: 'invalid' })` fails
- Unit test: `createSchoolSchema.parse({ ... })` defaults to `gregorian`
- Existing tests still pass

---

#### Ticket 1.3: Expand address schema to support country-adaptive fields

**Files**: `packages/shared-types/src/schemas/identity/school.schema.ts`

**Task**:
- Add Nepal-specific optional fields to `schoolAddressSchema`:
  - `wardNumber: z.string().max(10).optional()`
  - `municipality: z.string().max(100).optional()`
  - `district: z.string().max(100).optional()`
  - `province: z.string().max(100).optional()`
  - `region: z.string().max(100).optional()` (generic fallback for non-US/non-Nepal)
- Keep existing fields (`street1`, `street2`, `city`, `state`, `zipCode`, `country`) but make `state` and `zipCode` optional (not all countries use them)
- **Backward compatibility**: All references to `address.state` and `address.zipCode` across frontend/backend must use null-safe access. Existing schools with `country: undefined` default to `'USA'`.
- Add `.refine()` for country-specific validation:
  - If `country === 'USA'`: require `state` (2-char) + `zipCode`
  - If `country === 'NPL'`: require `district` + `province`
  - Otherwise: no additional requirements beyond `street1`, `city`, `country`
  - Country-specific `.refine()` validators only fire when `country` is explicitly set
- **Note**: `principalName`/`principalEmail` removal from `createSchoolSchema` is handled separately in Ticket 1.8 to keep this ticket focused on address changes only
- Relax `schoolContactInfoSchema.primaryPhone` from `min(10)` to `min(7)` for international support (Nepal landlines can be 7 digits with area code)

**Validation**:
- Unit test: USA address with state+zip → valid
- Unit test: USA address without state → invalid
- Unit test: Nepal address with district+province → valid
- Unit test: Nepal address without district → invalid
- Unit test: Generic address with just street1+city+country → valid
- Unit test: Create school without principalName → valid (was already optional, ensure no regression)
- Existing school creation smoke tests still pass

---

#### Ticket 1.4: Add country-adaptive timezone and locale options to school wizard utils

**Files**: `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts`

**Task**:
- Remove hardcoded `COUNTRY_OPTIONS`, `US_TIMEZONE_OPTIONS`, `STATE_TIMEZONE_MAP`
- Import `COUNTRY_REGISTRY`, `getCountryConfig` from `@aibrains/shared-types`
- Derive `COUNTRY_OPTIONS` from `COUNTRY_REGISTRY`
- Add `getTimezoneOptionsForCountry(countryCode: string)` that returns timezones from the country config
- Add `getLocaleOptionsForCountry(countryCode: string)` — e.g., Nepal returns `[{ value: 'ne-NP', label: 'Nepali' }, { value: 'en-US', label: 'English (US)' }]`
- Add `getDefaultsForCountry(countryCode: string)` that returns `{ timezone, locale, calendarSystem, schoolDays, dateFormat }`

**Validation**:
- Unit test: `getTimezoneOptionsForCountry('NPL')` returns `[{ value: 'Asia/Kathmandu', ... }]`
- Unit test: `getTimezoneOptionsForCountry('USA')` returns 6 US timezones
- Unit test: `getDefaultsForCountry('NPL')` includes `calendarSystem: 'bikram_sambat'`
- Build succeeds

---

#### Ticket 1.5: Make LocationContactStep country-adaptive

**Files**: `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/LocationContactStep.tsx`

**Task**:
- When user selects a country from dropdown, dynamically:
  - Render address fields from `getCountryConfig(country).addressFields`
  - Update timezone dropdown options from `getTimezoneOptionsForCountry(country)`
  - Auto-set timezone to country's default if user hasn't manually chosen one
  - Auto-set locale to country's default
- For Nepal: render Ward Number, Municipality, District (dropdown of 77 districts), Province (dropdown of 7 provinces) instead of State (2-char) + Zip
- For USA: keep current state (2-char) + zip behavior
- Remove `maxLength={2}` hardcoding on state field — make it dynamic per country config
- Add `calendarSystem` display (read-only, auto-set from country, editable in config later)
- Add Academic Calendar Type: include "Annual" option for Nepal schools

**Validation**:
- Manual test: Select Nepal → address fields change to Ward/Municipality/District/Province → timezone shows Asia/Kathmandu → locale shows ne-NP
- Manual test: Select USA → address fields show State (2-char) + Zip → timezone shows US options
- Manual test: Switch from USA to Nepal → address fields clear and re-render Nepal format
- Build succeeds

---

#### Ticket 1.6: Update DEFAULT_SCHOOL_CONFIG to be country-aware

**Files**: `server/application/microservices/identity/src/common/entities/department.entity.ts`, `server/application/microservices/identity/src/schools/schools.service.ts`

**Task**:
- Import `getCountryConfig` from `@aibrains/shared-types`
- In `createSchool()`, determine country from `createDto.address?.country || 'USA'`
- Use country config to set defaults:
  - `schoolDays`: from country config (Sun-Fri for Nepal, Mon-Fri for USA)
  - `dateFormat`: from country config (`YYYY/MM/DD` for Nepal, `MM/DD/YYYY` for USA)
  - `timezone`: from DTO or country default
  - `locale`: from DTO or country default
  - `timeFormat`: `'24h'` for Nepal, `'12h'` for USA
- Keep `DEFAULT_SCHOOL_CONFIG` as generic fallback but add `getDefaultConfigForCountry(countryCode: string)` factory

**Validation**:
- Unit test: Create school with country=NPL → config has `schoolDays: [0,1,2,3,4,5]`, `dateFormat: 'YYYY/MM/DD'`
- Unit test: Create school with country=USA → config has `schoolDays: [1,2,3,4,5]`, `dateFormat: 'MM/DD/YYYY'`
- Smoke test: POST create school with Nepal address → GET config → verify Nepal defaults

---

#### Ticket 1.7: Add "I'll do this later" skip button for optional wizard steps

**Files**: `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/SchoolWizard.tsx`, wizard step components

**Task**:
- In the wizard step config, mark steps as `skippable: true` for: LocationContact, Organization (EdFi step)
- For skippable steps, render a "I'll do this later →" text button alongside the "Continue →" button
- Clicking "I'll do this later" advances to the next step without validation, clearing any partial data in that step
- Track skipped steps in wizard state so the Review step can show "Not provided — can be configured later" for skipped sections
- Ensure BasicInfo step (Step 1) and Review step are NOT skippable

**Validation**:
- Manual test: On LocationContact step, click "I'll do this later" → advances to next step
- Manual test: Review step shows "Not provided" for skipped Location section
- Manual test: BasicInfo step does NOT show skip button
- Manual test: Submit school without Location → school created successfully with null address

---

#### Ticket 1.8: Remove principalName from school creation wizard

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/steps/BasicInfoStep.tsx` or wherever principal fields are rendered
- `edforge-saas-frontend/apps/shell/src/components/settings/school-wizard/school-wizard.utils.ts` (transformWizardDataToDto)

**Task**:
- Remove `principalName` and `principalEmail` input fields from the wizard UI
- Remove these fields from `transformWizardDataToDto()` output
- Keep them in the `updateSchoolSchema` so they can be added later via school settings
- Ensure the school settings/configuration page has a section for adding principal info post-creation

**Validation**:
- Manual test: School creation wizard has no principal fields
- Manual test: School creates successfully without principal data
- API test: POST create school without principalName → 200 OK

---

### Sprint 2: Bikram Sambat Calendar & Nepal Date Handling

**Goal**: Nepal schools can create academic years in Bikram Sambat dates, see dates displayed in BS format throughout the UI, and input dates in BS format. All storage remains Gregorian ISO 8601.

**Demoable Outcome**: Create academic year "2082-2083" with BS date picker → dates stored as Gregorian → displayed as BS throughout attendance, grades, invoices. Finance forms show dates in BS for Nepal schools.

---

#### Ticket 2.1: Add Bikram Sambat date conversion library

**Files**: `packages/shared-types/src/utils/bikram-sambat.ts` (new)

**Task**:
- Implement or wrap a BS↔AD conversion library (e.g., port `nepali-date-converter` logic or use `bikram-sambat-js`)
- Export functions:
  - `gregorianToBs(date: string): { year: number; month: number; day: number }` — ISO date string → BS components
  - `bsToGregorian(year: number, month: number, day: number): string` — BS components → ISO date string
  - `formatBsDate(isoDate: string, format?: string): string` — e.g., `'2026-04-14'` → `'2083/01/01'`
  - `parseBsDate(bsString: string): string` — e.g., `'2083/01/01'` → `'2026-04-14'`
  - `getCurrentBsYear(): number` — returns current BS year (e.g., 2082)
  - `getBsMonthName(month: number): string` — returns Nepali month name (Baishakh, Jestha, etc.)
  - `getBsMonthDays(year: number, month: number): number` — BS months have variable days (29-32)
- Include BS calendar data table for years 2000-2090 BS (sufficient for next 60+ years)
- All functions must handle edge cases: invalid dates return null/throw with descriptive message

**Validation**:
- Unit test: `gregorianToBs('2026-04-14')` → `{ year: 2083, month: 1, day: 1 }` (Baishakh 1)
- Unit test: `bsToGregorian(2082, 1, 1)` → `'2025-04-14'`
- Unit test: `formatBsDate('2026-04-14')` → `'2083/01/01'`
- Unit test: `getCurrentBsYear()` returns 2082 (as of March 2026, we're in BS 2082)
- Unit test: `getBsMonthDays(2082, 1)` → 31 (Baishakh 2082 has 31 days)
- Unit test: Invalid date → throws descriptive error
- 100+ date conversion round-trip tests (AD→BS→AD = original)

---

#### Ticket 2.2: Create BS date picker component

**Files**: `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` (new) or appropriate UI package location

**Task**:
- Create a `BsDatePicker` React component that:
  - Displays a calendar grid in Bikram Sambat (Nepali months/days)
  - Shows BS month names (Baishakh, Jestha, Ashadh, etc.) and BS year
  - Handles variable month lengths (29-32 days)
  - Emits `onChange(isoDate: string)` — always outputs Gregorian ISO date
  - Accepts `value` as Gregorian ISO date, displays as BS
  - Supports `minDate` / `maxDate` constraints (in Gregorian, displayed as BS)
  - Shows both BS and AD date in a small secondary label for clarity
- Create a `DateInput` wrapper component that renders either standard date picker or BS date picker based on school's `calendarSystem` prop

**Validation**:
- Manual test: Open BS date picker → shows current BS month/year → navigate months → select date → emits Gregorian ISO string
- Manual test: Set value to `'2026-04-14'` → displays "Baishakh 1, 2083"
- Unit test: Component renders 31 days for Baishakh 2082
- Unit test: Component renders 32 days for Jestha 2082 (if applicable)

---

#### Ticket 2.3: Add calendar-system-aware date formatting utility

**Files**: `packages/shared-types/src/utils/date-format.ts` (new)

**Task**:
- Create `formatSchoolDate(isoDate: string, calendarSystem: string, format?: string): string`
  - If `gregorian`: use standard date formatting
  - If `bikram_sambat`: use `formatBsDate()`
- Create `parseSchoolDate(dateString: string, calendarSystem: string): string`
  - Inverse of formatSchoolDate, returns ISO
- Create `getAcademicYearLabel(startDate: string, endDate: string, calendarSystem: string): string`
  - Gregorian: `"2025-2026"`
  - BS: `"2082-2083"`
- Export all from shared-types

**Validation**:
- Unit test: `formatSchoolDate('2026-04-14', 'bikram_sambat')` → BS formatted date
- Unit test: `formatSchoolDate('2026-04-14', 'gregorian')` → Gregorian formatted date
- Unit test: `getAcademicYearLabel('2025-04-14', '2026-04-13', 'bikram_sambat')` → `"2082-2083"`

---

#### Ticket 2.4: Wire academic year creation to support BS dates

**Files**:
- `edforge-saas-frontend/apps/shell/src/components/settings/academic-year/` (or equivalent)
- `packages/shared-types/src/schemas/identity/academic-year.schema.ts`

**Task**:
- In the academic year creation form, use `DateInput` component (from 2.2) that renders BS picker for BS-calendar schools
- When user picks BS dates, convert to Gregorian before sending to API
- Display academic year name auto-generated as BS year range for BS schools (e.g., "2082-2083")
- Add `calendarSystem` to `academicYearResponseSchema` (denormalized from school for display convenience)
- Backend stores dates as Gregorian ISO — no changes to storage format

**Validation**:
- Manual test: Nepal school → create academic year → BS date picker shows → select Baishakh 1, 2083 to Chaitra 30, 2083 → API receives Gregorian dates → response shows Gregorian dates → UI displays BS dates
- Smoke test: Create academic year with BS dates → GET returns valid Gregorian dates → frontend displays BS

---

#### Ticket 2.5: Add BS date display throughout frontend

**Files**: Multiple frontend components that display dates

**Task**:
- Create a `useSchoolDateFormat()` hook that reads the current school's `calendarSystem` from context
- Create a `<SchoolDate date={isoDate} />` component that auto-formats dates per school's calendar system
- Replace raw `toLocaleDateString()` and `new Date().toLocaleDateString()` calls with `<SchoolDate>` in:
  - Attendance views
  - Grade/assessment date displays
  - Invoice dates (issued date, due date)
  - Academic year displays
  - Enrollment date displays
- Provide a `formatDate` function from the hook for use in non-JSX contexts (table columns, exports)

**Validation**:
- Manual test: Nepal school → navigate to attendance → dates show in BS format
- Manual test: US school → same views → dates show in Gregorian
- Grep audit: no remaining `toLocaleDateString()` calls in feature components (utility components OK)

---

### Sprint 3: Temporal Data Governance & School Lifecycle

**Goal**: Critical school configuration fields (schedule, term structure, grading scale) are locked during an active academic year. A clear school lifecycle (setup → active → end-of-year) governs what can change when. Full audit trail on all configuration changes.

**Demoable Outcome**: Try to change school hours while academic year is active → get a clear error: "School hours cannot be changed during an active academic year. Complete or archive the current year first." Change school name → succeeds (always-editable). View audit log → see all changes with who/when/why.

---

#### Ticket 3.1: Define field mutability classification in shared-types

**Files**: `packages/shared-types/src/identity/field-governance.ts` (new)

**Task**:
- Define three mutability tiers as a constant:
  ```typescript
  const FIELD_MUTABILITY = {
    immutable: ['schoolCode'],
    lockedDuringActiveYear: [
      'academicCalendarType', 'calendarSystem', 'gradeRange', 'gradeLevels',
      'gradingScale', 'schoolDays', 'startTime', 'endTime', 'periodDuration',
    ],
    alwaysEditable: [
      'name', 'shortName', 'phone', 'email', 'website', 'address',
      'principalName', 'principalEmail', 'timezone', 'locale', 'logoUrl',
      'features', 'notificationsEnabled', 'emailNotifications', 'smsNotifications',
    ],
  } as const;
  ```
- Export `isFieldLocked(field: string, hasActiveAcademicYear: boolean): boolean`
- Export `getLockedFieldsMessage(fields: string[]): string` — human-readable error message
- Export `classifyUpdateFields(updateDto: Record<string, any>): { immutable: string[]; locked: string[]; editable: string[] }`

**Validation**:
- Unit test: `isFieldLocked('schoolDays', true)` → `true`
- Unit test: `isFieldLocked('schoolDays', false)` → `false`
- Unit test: `isFieldLocked('name', true)` → `false`
- Unit test: `isFieldLocked('schoolCode', false)` → `true` (always immutable)
- Unit test: `classifyUpdateFields({ name: 'X', schoolDays: [1,2,3] })` → correct classification

---

#### Ticket 3.2: Enforce field governance in backend school update

**Files**: `server/application/microservices/identity/src/schools/schools.service.ts`

**Task**:
- In `updateSchool()`:
  - Import `classifyUpdateFields`, `isFieldLocked` from shared-types
  - Check if any immutable fields are being updated → throw `BadRequestException('schoolCode cannot be changed after creation')`
  - Check if any locked-during-active-year fields are being updated:
    - Query for active academic years for this school (status = 'active')
    - If any active year exists AND locked fields are in the update → throw `BadRequestException` with specific message listing the locked fields and instruction to complete/archive the academic year first
  - Allow always-editable fields to pass through
  - **Emergency override**: Accept optional `forceOverride: boolean` + `overrideReason: string` parameters (TenantAdmin role only). When force override is used:
    - The locked field IS updated despite active year
    - A HIGH-SEVERITY audit log entry is created with the reason
    - `forceOverride` without `overrideReason` → `BadRequestException('Override reason is required')`
    - This handles real-world scenarios like correcting a grading scale error mid-year
- In `updateSchoolConfiguration()` (config update endpoint):
  - Apply same governance: `gradingScale`, `schoolDays`, `startTime`, `endTime`, `periodDuration`, `academicCalendarType` are locked during active year
  - `timezone`, `locale`, `dateFormat`, `timeFormat`, `features`, `notifications*` are always editable
  - Same emergency override mechanism as school update
- Remove `status` from `UpdateSchoolDto` allowed fields — status transitions should use a dedicated endpoint

**Validation**:
- Unit test: Update `name` with active year → succeeds
- Unit test: Update `schoolDays` with active year → `BadRequestException` with descriptive message
- Unit test: Update `schoolDays` with no active year → succeeds
- Unit test: Update `schoolCode` anytime → `BadRequestException`
- Unit test: Update `gradingScale` via config with active year → `BadRequestException`
- Smoke test: Create school → create active academic year → PATCH school hours → 400 → archive year → PATCH school hours → 200

---

#### Ticket 3.3: Add audit trail for school and configuration changes

**Files**:
- `server/application/microservices/identity/src/common/entities/audit.entity.ts` (new)
- `server/application/microservices/identity/src/schools/schools.service.ts`

**Task**:
- Create `AuditLogEntry` entity:
  ```typescript
  interface AuditLogEntry extends BaseEntity {
    entityType: 'AUDIT_LOG';
    auditId: string;
    schoolId: string;
    targetEntity: string;    // 'SCHOOL' | 'CONFIG' | 'ACADEMIC_YEAR'
    targetEntityId: string;
    action: 'create' | 'update' | 'delete' | 'status_change';
    changes: FieldChange[];
    changedBy: string;       // userId
    changedByName?: string;
    changedAt: string;       // ISO timestamp
    reason?: string;         // optional reason code/text
  }
  interface FieldChange {
    field: string;
    oldValue: any;
    newValue: any;
  }
  ```
- Key structure: `PK: TENANT#{tid}`, `SK: SCHOOL#{schoolId}#AUDIT#{timestamp}#{auditId}`
- In `updateSchool()` and `updateSchoolConfiguration()`:
  - Compute diff between old and new values
  - Write audit log entry with all changed fields
- Create `getAuditLog(schoolId, context, limit?, startDate?)` method

**Validation**:
- Unit test: Update school name → audit log entry created with `oldValue`/`newValue`
- Unit test: Update multiple fields → single audit entry with all changes
- Unit test: No actual changes (same values) → no audit entry
- Smoke test: Update school → GET audit log → entry visible with correct diff

---

#### Ticket 3.4: Add audit log API endpoint

**Files**: `server/application/microservices/identity/src/schools/schools.controller.ts`

**Task**:
- Add `GET /schools/:schoolId/audit-log` endpoint
  - Query params: `limit` (default 50), `startDate`, `endDate`, `action` (filter)
  - Returns paginated list of `AuditLogEntry` items, newest first
  - Requires `TenantAdmin` role
- Add corresponding schema in shared-types: `auditLogResponseSchema`, `auditLogFilterSchema`

**Validation**:
- Smoke test: Update school → GET `/schools/:id/audit-log` → returns the change entry
- Smoke test: Filter by action=update → only update entries returned
- Smoke test: Non-admin user → 403

---

#### Ticket 3.5: Extend existing school status transition with preconditions & audit

**Files**: `server/application/microservices/identity/src/schools/schools.service.ts`, `schools.controller.ts`

**Task**:
- **NOTE**: The existing `transitionStatus()` method in `schools.service.ts` already implements basic transition rules and the controller already has a status endpoint. This ticket EXTENDS it — do NOT rewrite.
- Add preconditions to existing transition rules:
  - `setup → active`: Requires school to have at least one academic year
  - `active → suspended`: Allowed (administrative action)
  - `suspended → active`: Allowed
  - `active → closed`: Requires no active academic year
  - `closed → *`: Not allowed (terminal state)
- Each transition creates an audit log entry
- Publish `SchoolStatusChanged` event

**Validation**:
- Unit test: `setup → active` without academic year → `BadRequestException`
- Unit test: `setup → active` with academic year → succeeds
- Unit test: `active → closed` with active year → `BadRequestException`
- Unit test: `closed → active` → `BadRequestException` (terminal)
- Smoke test: Full lifecycle: setup → active → closed

---

#### Ticket 3.6: Show field governance in frontend configuration page

**Files**: Frontend school configuration page components

**Task**:
- Import `isFieldLocked` from shared-types
- Query for active academic year status
- For locked fields during active year:
  - Render the field as disabled/read-only
  - Show a lock icon with tooltip: "This setting is locked during the active academic year (2082-2083). Archive or complete the year to modify."
- For always-editable fields: render normally
- For immutable fields (schoolCode): show as read-only text, no edit control
- Add an info banner at the top of config page when there's an active year: "Some settings are locked while academic year 2082-2083 is active."

**Validation**:
- Manual test: Active academic year → school hours fields are disabled with lock icon
- Manual test: No active year → all fields editable
- Manual test: Tooltip on lock icon shows clear message

---

### Sprint 4: Enterprise Finance Foundation — Referential Fee Structures & Versioning

**Goal**: Fee structures are linked to academic year entities (not freeform strings), validated against school's configured grade levels, and versioned. Changing a fee amount creates a new version instead of mutating, preserving historical invoice integrity.

**Demoable Outcome**: Create fee structure for "2082-2083" academic year → linked to real academic year entity → assign to grades 1-5 (validated against school's K-12 range) → change amount → old invoices retain original amount, new invoices use new amount → audit log shows the change.

---

#### Ticket 4.1: Add `academicYearId` foreign key to fee structure schema

**Files**: `packages/shared-types/src/schemas/finance/fee-structure.schema.ts`, `packages/shared-types/src/schemas/finance/common.ts`

**Task**:
- Add `academicYearId: uuidSchema` to `createFeeStructureSchema` (required)
- Keep `academicYear: z.string()` as a denormalized display label (auto-populated from academic year entity)
- Add `academicYearId` to `feeStructureResponseSchema`
- Add `schoolId` to `createFeeStructureSchema` if not already required by the API route context
- Add `version: z.number().int().min(1)` to `feeStructureResponseSchema`
- Add `parentFeeStructureId: uuidSchema.optional()` to response (links to original when versioned)
- Expand `currencyEnum` to `z.enum(['NPR', 'USD', 'INR', 'GBP', 'AUD', 'CAD'])` for future multi-currency (but default remains school's country currency)

**Validation**:
- Unit test: Create fee structure without `academicYearId` → validation fails
- Unit test: Create fee structure with valid `academicYearId` → passes
- Unit test: Response schema includes `version` and `parentFeeStructureId`
- Existing finance tests updated and passing

---

#### Ticket 4.2: Validate fee structure grade levels against school's configured grades

**Files**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Task**:
- When creating/updating a fee structure:
  - Fetch the school's `gradeRange` from identity service (or from cached school context)
  - Validate that every grade level in the fee structure's `gradeLevels` array falls within the school's configured grade range
  - If `gradeLevels` includes a grade the school doesn't serve → `BadRequestException('Grade level "10" is not offered by this school (range: K-5)')`
- When fee structure has `gradeLevels: []` or `['All Grades']`, apply to all grades in school's range

**Validation**:
- Unit test: School is K-5 → fee with grade "10" → rejected
- Unit test: School is K-12 → fee with grade "10" → accepted
- Unit test: Fee with empty grades → accepted (applies to all)
- Smoke test: Create fee for grade outside school range via API → 400

---

#### Ticket 4.3: Validate academic year reference in fee structure creation

**Files**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Task**:
- When creating a fee structure with `academicYearId`:
  - Call identity service to verify the academic year exists and belongs to the same school
  - Auto-populate `academicYear` display label from the academic year entity's name
  - Validate `effectiveFrom` and `effectiveTo` fall within the academic year's date range
- If academic year doesn't exist → `BadRequestException('Academic year not found')`
- If dates are outside academic year → `BadRequestException('Effective dates must fall within the academic year date range')`

**Validation**:
- Unit test: Valid academicYearId → fee created with auto-populated label
- Unit test: Invalid academicYearId → 400
- Unit test: effectiveFrom before academic year start → 400
- Smoke test: Full flow — create academic year → create fee structure referencing it → verify label auto-populated

---

#### Ticket 4.4: Implement fee structure versioning

**Files**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`, `server/application/microservices/finance/src/common/services/dynamodb-client.service.ts`

**Task**:
- **Prerequisite**: If `DynamoDBClientService` does not have a `transactWrite` method, add one that wraps DynamoDB `TransactWriteItems` API
- When updating a fee structure's `amount`, `taxRate`, or `taxType`:
  - Instead of mutating the existing record, create a NEW fee structure entity with:
    - New UUID
    - `version: oldVersion + 1`
    - `versionParentId: originalId` (NOT `parentFeeStructureId` — that name is reserved for template inheritance in Ticket 6.5)
    - Updated fields
    - Same `academicYearId`, `name`, `gradeLevels`, etc.
  - **CRITICAL**: Use `DynamoDB TransactWriteItems` to atomically create the new version AND deactivate the old in a single transaction. This prevents a race condition where both versions are active simultaneously if the process crashes between the two operations.
  - The new version becomes `isActive: true`, old becomes `isActive: false`
- When updating non-financial fields (`name`, `description`, `gradeLevels`): mutate in-place (no versioning needed)
- Add `GET /fee-structures/:id/versions` endpoint to retrieve version history
- Invoice generation always uses the latest active version

**Validation**:
- Unit test: Update amount → new version created, old deactivated
- Unit test: Update name → same version, mutated in place
- Unit test: Get versions → returns ordered list
- Smoke test: Create fee → update amount → generate invoice → invoice uses new amount → old invoices unchanged

---

#### Ticket 4.5: Snapshot fee structure version on invoice generation

**Files**: `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Task**:
- When generating an invoice line item from a fee structure:
  - Record `feeStructureId` AND `feeStructureVersion` on the line item
  - Snapshot the `amount`, `taxRate`, `description` at generation time (denormalize into line item)
- This ensures that if the fee structure is later versioned (amount changes), existing invoices are unaffected
- Add `feeStructureVersion: z.number().int().optional()` to `invoiceLineItemSchema`

**Validation**:
- Unit test: Generate invoice → line item has `feeStructureVersion` matching current version
- Unit test: Update fee amount after invoice generation → existing invoice line item amount unchanged
- Smoke test: Create fee ($100) → generate invoice → update fee ($150) → generate new invoice → first invoice shows $100, second shows $150

---

#### Ticket 4.6: Add fee structure audit trail

**Files**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Task**:
- On every fee structure create/update/version/deactivate:
  - Write an audit log entry similar to Ticket 3.3 but for finance entities
  - Include: `changedBy`, `timestamp`, `previousValue`, `newValue`, `reasonCode`
- Add `GET /fee-structures/:id/audit-log` endpoint
- Accept optional `reason` field on update DTO for change justification (e.g., "Annual Board Increase")

**Validation**:
- Unit test: Create fee → audit entry with action=create
- Unit test: Update fee amount → audit entry with old/new values + version change
- Smoke test: Update fee with reason → GET audit log → reason visible

---

### Sprint 5: Event-Driven Billing & Enrollment Integration

**Goal**: When a student enrolls (StudentSchoolAssociation created) or registers for a section (StudentSectionAssociation created), the system automatically generates applicable invoices based on configured fee structures. Pro-rating for mid-term entries.

**Demoable Outcome**: Configure auto-apply fee structure for Grade 5 tuition → enroll a student in Grade 5 → invoice automatically generated → student account shows the charge. Enroll mid-term → invoice shows pro-rated amount.

---

#### Ticket 5.1: Define enrollment billing event types

**Files**: `packages/shared-types/src/events/enrollment-billing.events.ts` (new)

**Task**:
- Define event interfaces:
  ```typescript
  interface StudentEnrolledEvent {
    eventType: 'student.enrolled';
    tenantId: string;
    schoolId: string;
    studentId: string;
    gradeLevel: string;
    enrollmentDate: string;      // ISO date
    academicYearId: string;
    sectionId?: string;
  }
  interface StudentSectionAssignedEvent {
    eventType: 'student.section.assigned';
    tenantId: string;
    schoolId: string;
    studentId: string;
    sectionId: string;
    courseId: string;
    enrollmentDate: string;
    academicYearId: string;
  }
  interface StudentWithdrawnEvent {
    eventType: 'student.withdrawn';
    tenantId: string;
    schoolId: string;
    studentId: string;
    withdrawalDate: string;
    academicYearId: string;
    reason?: string;
  }
  ```
- Export from shared-types events barrel

**Validation**:
- Type check: All event interfaces are valid TypeScript and exported
- Build succeeds

---

#### Ticket 5.2: Refactor and extend existing enrollment webhook for auto-billing

**Files**: `server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts`, `enrollment-billing.service.ts` (new service extracted from existing controller logic)

**Task**:
- **NOTE**: The existing `enrollment-webhook.controller.ts` already handles `enrollment-completed` and `student-withdrawn` events with real logic (auto-invoice generation, student account creation, identity resolution fallback). This ticket REFACTORS the existing controller by extracting billing logic into a dedicated service and EXTENDS it with new capabilities — preserving all existing behavior.
- Extract existing billing logic from `enrollment-webhook.controller.ts` into `EnrollmentBillingService` that:
  - On `student.enrolled` event:
    1. Query active fee structures for this school + academic year where `autoApplyOnEnrollment: true`
    2. Filter by fee structures matching the student's grade level
    3. For each matching fee structure:
       - Check if student already has an invoice for this fee structure + period (prevent duplicates)
       - Calculate pro-rated amount if enrollment is mid-term (see Ticket 5.3)
       - Generate invoice via existing `InvoicesService.generateInvoice()`
    4. Create/update student account with the new charges
  - On `student.section.assigned` event:
    1. Query fee structures linked to the specific course/section (fee type = 'lab', 'custom' with section reference)
    2. Generate section-specific fee invoices
  - On `student.withdrawn` event:
    1. Find unpaid invoices for the student
    2. Cancel draft invoices
    3. For issued but unpaid invoices: flag for review (don't auto-cancel)

**Validation**:
- Unit test: Enroll student → auto-apply fees exist → invoice generated
- Unit test: Enroll student → no auto-apply fees → no invoice
- Unit test: Enroll student → already has invoice for same fee → no duplicate
- Unit test: Withdraw student → draft invoices cancelled, issued invoices flagged
- Smoke test: Full flow — create fee (autoApply=true) → enroll student → verify invoice exists

---

#### Ticket 5.3: Implement pro-rating for mid-term enrollment

**Files**: `server/application/microservices/finance/src/common/pro-rate.service.ts` (new)

**Task**:
- Create `ProRateService` with:
  - `calculateProRatedAmount(params: ProRateParams): number`:
    ```typescript
    interface ProRateParams {
      fullAmount: number;
      termStartDate: string;
      termEndDate: string;
      enrollmentDate: string;
      frequency: FeeFrequency;  // 'annual' | 'monthly' | 'quarterly' | 'one_time'
    }
    ```
  - Logic:
    - `one_time` fees: full amount (no pro-rating)
    - `monthly` fees: full amount for partial month (or configurable per school)
    - `quarterly` / `annual` fees: `fullAmount * (remainingDays / totalDays)`, rounded to nearest integer (NPR has no decimals)
  - Pro-rating is opt-in per fee structure: add `proRateOnMidTermEntry: boolean` field to fee structure schema
  - If fee structure has `proRateOnMidTermEntry: false`, charge full amount regardless of entry date

**Validation**:
- Unit test: Annual fee ₹10,000, term 365 days, enrolled 50% through → ₹5,000
- Unit test: Monthly fee, enrolled mid-month → full month amount
- Unit test: One-time fee → full amount regardless of date
- Unit test: Pro-rate disabled → full amount regardless
- Unit test: Edge case — enrolled on first day → full amount
- Unit test: Edge case — enrolled on last day → near-zero (but minimum 1-day charge)

---

#### Ticket 5.4: Add pro-rate toggle to fee structure form (frontend)

**Files**: Frontend fee structure form component

**Task**:
- Add `proRateOnMidTermEntry` toggle/checkbox to the fee structure creation/edit form
- Default: `false` for `one_time` fees, `true` for `annual`/`quarterly` fees
- Show explanatory text: "When enabled, students enrolling mid-term will be charged a proportional amount based on remaining days in the term."
- Only show this toggle for `annual`, `quarterly`, `monthly` frequencies (hide for `one_time`)

**Validation**:
- Manual test: Create annual fee → pro-rate toggle visible, default ON
- Manual test: Create one-time fee → pro-rate toggle hidden
- Manual test: Toggle pro-rate → saved to API

---

#### Ticket 5.5: Student transfer fee adjustment

**Files**: `server/application/microservices/finance/src/webhooks/enrollment-billing.service.ts`

**Task**:
- On section transfer (student moves from Section A to Section B):
  - Calculate fee difference between old and new section's fee structures
  - If new section has higher fees: generate a supplementary invoice for the difference
  - If new section has lower fees: generate a credit note on the student account
  - Record the transfer event in the student's account ledger
- This handles the scenario where Section A has no lab fee but Section B has a $50 lab fee

**Validation**:
- Unit test: Transfer to more expensive section → supplementary invoice generated
- Unit test: Transfer to cheaper section → credit note generated
- Unit test: Transfer to same-fee section → no financial action
- Smoke test: Full transfer flow with fee difference verification

---

### Sprint 6: Finance Hardening — Sibling Discounts, Scholarships, Tax Compliance & Refund Governance

**Goal**: Handle enterprise edge cases: sibling discounts, scholarship/grant offsets, item-level taxation, and governed refund workflows. All financial operations have approval workflows where needed.

**Demoable Outcome**: Enroll two siblings → second sibling auto-receives 10% tuition discount → invoice shows discount line item. Apply scholarship → credit note created. Initiate refund → goes to admin approval queue → admin approves → refund processed.

---

#### Ticket 6.1: Implement discount rule engine

**Files**:
- `packages/shared-types/src/schemas/finance/discount-rule.schema.ts` (new)
- `server/application/microservices/finance/src/discount-rules/` (new module)

**Task**:
- Create `DiscountRule` entity:
  ```typescript
  interface DiscountRule {
    id: string;
    schoolId: string;
    academicYearId: string;
    name: string;                    // "Sibling Discount", "Staff Child Discount"
    type: 'percentage' | 'fixed';
    value: number;                   // 10 for 10%, or 500 for ₹500
    applicableFeeTypes: FeeType[];   // ['tuition'] or ['tuition', 'transport']
    condition: DiscountCondition;
    priority: number;                // lower = applied first
    isActive: boolean;
    maxDiscountAmount?: number;      // cap for percentage discounts
  }
  type DiscountCondition =
    | { type: 'sibling'; minSiblings: number }      // ≥2 siblings enrolled
    | { type: 'early_payment'; daysBefore: number }  // paid X days before due
    | { type: 'scholarship'; scholarshipId: string }
    | { type: 'staff_child' }
    | { type: 'manual' };                            // admin-applied
  ```
- CRUD endpoints for discount rules
- Discount evaluation service: given a student + fee structure, compute applicable discounts
- **Sibling detection prerequisite**: Verify that a GSI exists for parent/guardian-based student lookups. If not, add one: `GSI4-PK: PARENT#{parentId}`, `GSI4-SK: STUDENT#{studentId}`. Without this index, sibling detection requires a full table scan, which is unacceptable at scale. Alternatively, if students are queryable by school+parentId via existing GSIs, document which GSI to use.
- Sibling detection: query students with same `parentId` / `guardianId` in same school + academic year using the GSI

**Validation**:
- Unit test: Two siblings enrolled → sibling discount rule matches
- Unit test: Single child → sibling discount does NOT match
- Unit test: 10% discount on ₹10,000 tuition → ₹1,000 discount
- Unit test: Fixed ₹500 discount → ₹500 off regardless of amount
- Unit test: Max cap: 10% on ₹50,000 with max ₹3,000 → capped at ₹3,000
- Smoke test: Create sibling discount rule → enroll second sibling → invoice shows discount

---

#### Ticket 6.2: Implement scholarship/grant credit notes

**Files**:
- `packages/shared-types/src/schemas/finance/credit-note.schema.ts` (new)
- `server/application/microservices/finance/src/credit-notes/` (new module)

**Task**:
- Create `CreditNote` entity:
  ```typescript
  interface CreditNote {
    id: string;
    studentAccountId: string;
    studentId: string;
    schoolId: string;
    amount: number;
    currency: Currency;
    type: 'scholarship' | 'grant' | 'refund' | 'adjustment' | 'fee_waiver';
    description: string;
    fundingSource?: string;        // "Title I", "School Endowment", etc.
    referenceInvoiceId?: string;   // if applied against a specific invoice
    appliedToInvoices: { invoiceId: string; amount: number }[];
    status: 'active' | 'applied' | 'expired' | 'cancelled';
    effectiveDate: string;
    expiryDate?: string;
    approvedBy: string;
    createdAt: string;
  }
  ```
- CRUD + apply endpoints:
  - `POST /credit-notes` — create credit note (requires admin approval)
  - `POST /credit-notes/:id/apply` — apply against specific invoice(s)
  - Auto-apply: when generating invoice, check for unapplied credits on student account
- Credit note application reduces `amountDue` on invoice, records in student ledger

**Validation**:
- Unit test: Create ₹5,000 scholarship credit → apply to ₹10,000 invoice → amountDue = ₹5,000
- Unit test: Apply ₹15,000 credit to ₹10,000 invoice → invoice fully paid, ₹5,000 credit remaining
- Unit test: Auto-apply on invoice generation → credit auto-deducted
- Smoke test: Full scholarship flow — create credit → generate invoice → credit auto-applied

---

#### Ticket 6.3: Implement item-level taxation

**Files**: `server/application/microservices/finance/src/invoices/invoices.service.ts`

**Task**:
- Invoice generation already supports per-line-item tax rates (from fee structure)
- Ensure tax calculation:
  - Education fees (tuition, exam) → typically tax-exempt in Nepal (VAT rate = 0%)
  - Non-education fees (uniform, transport) → may have 13% VAT
  - This is driven by `taxType` and `taxRate` on the fee structure, NOT a global school setting
- Add tax summary section to invoice:
  - Group by tax type (PAN, VAT, none)
  - Show subtotal per tax category
  - Show total tax amount
- Add `taxSummary` to `invoiceResponseSchema`:
  ```typescript
  taxSummary: z.array(z.object({
    taxType: taxTypeEnum,
    taxableAmount: z.number(),
    taxRate: z.number(),
    taxAmount: z.number(),
  })).optional()
  ```

**Validation**:
- Unit test: Invoice with tuition (VAT 0%) + uniform (VAT 13%) → tax summary shows two categories
- Unit test: All tax-exempt items → taxTotal = 0
- Unit test: Mixed tax rates → correct per-item calculation
- Smoke test: Generate invoice → verify tax summary in response

---

#### Ticket 6.4: Implement refund governance workflow

**Files**:
- `packages/shared-types/src/schemas/finance/refund.schema.ts` (new)
- `server/application/microservices/finance/src/payments/refund.service.ts` (new)

**Task**:
- Refund lifecycle: `requested → pending_approval → approved → processing → completed | rejected`
- Create `RefundRequest` entity:
  ```typescript
  interface RefundRequest {
    id: string;
    paymentId: string;
    invoiceId: string;
    studentId: string;
    schoolId: string;
    amount: number;
    reason: string;
    requestedBy: string;
    requestedAt: string;
    status: RefundStatus;
    approvedBy?: string;
    approvedAt?: string;
    rejectedReason?: string;
    processedAt?: string;
    gatewayRefundId?: string;
  }
  ```
- Endpoints:
  - `POST /refunds` — request refund (any finance user)
  - `POST /refunds/:id/approve` — approve (requires admin role)
  - `POST /refunds/:id/reject` — reject with reason (requires admin role)
  - `GET /refunds?status=pending_approval` — admin review queue
- Validation:
  - Refund amount cannot exceed original payment amount
  - Cannot refund a payment that's already been fully refunded
  - Partial refunds allowed (track remaining refundable amount)
- On approval: reverse the payment in student ledger, update invoice status
- Audit trail for all refund actions

**Validation**:
- Unit test: Request refund for ₹5,000 on ₹10,000 payment → pending_approval
- Unit test: Request refund for ₹15,000 on ₹10,000 payment → rejected (exceeds amount)
- Unit test: Approve refund → student ledger updated, invoice status recalculated
- Unit test: Double refund attempt → rejected (already refunded)
- Smoke test: Full refund lifecycle → payment → refund request → approval → completion

---

#### Ticket 6.5: Parent-child fee structure templates

**Files**: `server/application/microservices/finance/src/fee-structures/fee-structures.service.ts`

**Task**:
- Allow fee structures to have a `parentFeeStructureId` that creates an inheritance hierarchy:
  - Parent: "General Tuition" (₹50,000, All Grades)
  - Child: "Grade 12 Tuition Override" (₹55,000, Grade 12 only)
- When computing applicable fees for a student:
  - Find most specific fee structure (child overrides parent for matching grade levels)
  - If no child override exists for the student's grade, use parent amount
- Add `isOverride: boolean` and `templateParentId: uuidSchema.optional()` to fee structure (distinct from `versionParentId` used in Ticket 4.4 for versioning)
- Add endpoint: `GET /fee-structures/:id/overrides` — list all child overrides

**Validation**:
- Unit test: Parent ₹50k all grades + Child ₹55k grade 12 → Grade 12 student gets ₹55k, Grade 5 student gets ₹50k
- Unit test: Delete child override → Grade 12 student falls back to parent ₹50k
- Smoke test: Create parent + override → verify billing uses correct amount per grade

---

### Sprint 7: School Hours Enforcement & Scheduling Integration

**Goal**: School hours (start/end time, period duration, school days) from configuration are enforced when creating sections, bell schedules, and class schedules. Scheduling operations that violate school hours are rejected.

**Demoable Outcome**: School hours are 08:00-15:30 with 50-minute periods → create a section schedule for 16:00 → rejected with "Section schedule falls outside school hours (08:00-15:30)." Create a bell schedule → auto-generates periods based on school hours and duration.

---

#### Ticket 7.1: Add school hours validation utility

**Files**: `packages/shared-types/src/utils/school-hours.ts` (new)

**Task**:
- Create utility functions:
  - `isWithinSchoolHours(time: string, startTime: string, endTime: string): boolean`
  - `isSchoolDay(dayOfWeek: number, schoolDays: number[]): boolean`
  - `validateScheduleSlot(params: { startTime: string; endTime: string; dayOfWeek: number; schoolConfig: SchoolHoursConfig }): string | null` — returns error message or null
  - `generateDefaultPeriods(startTime: string, endTime: string, periodDuration: number, breakDuration?: number): Period[]` — auto-generate bell schedule periods
- All time values are `HH:mm` format (24-hour)

**Validation**:
- Unit test: `isWithinSchoolHours('08:30', '08:00', '15:30')` → true
- Unit test: `isWithinSchoolHours('16:00', '08:00', '15:30')` → false
- Unit test: `isSchoolDay(0, [0,1,2,3,4,5])` → true (Sunday, Nepal school days)
- Unit test: `isSchoolDay(6, [0,1,2,3,4,5])` → false (Saturday, off day)
- Unit test: `generateDefaultPeriods('08:00', '15:30', 50, 10)` → generates 7 periods with breaks

---

#### Ticket 7.2: Enforce school hours in section scheduling

**Files**: `server/application/microservices/academics/src/` (sections/scheduling service)

**Task**:
- When creating/updating a section schedule (class meeting time):
  - Fetch school configuration
  - Validate that the schedule's time slots fall within school hours
  - Validate that schedule days are valid school days
  - If period duration doesn't match school's configured period duration: warn (not reject, as some classes are double-period)
- Return descriptive error: "Section 'AP Physics' schedule slot 16:00-16:50 on Monday falls outside school hours (08:00-15:30)"

**Validation**:
- Unit test: Schedule within hours → accepted
- Unit test: Schedule outside hours → rejected with descriptive error
- Unit test: Schedule on Saturday for Nepal school (Sun-Fri) → rejected
- Smoke test: Create section with schedule outside hours → 400

---

#### Ticket 7.3: Enforce school hours in bell schedule

**Files**: `server/application/microservices/identity/src/` (bell schedule service, if exists, or academics)

**Task**:
- When creating/updating a bell schedule:
  - First period cannot start before school `startTime`
  - Last period cannot end after school `endTime`
  - Period duration should align with configured `periodDuration` (warn if different)
- Auto-generate bell schedule: provide a "Generate Default Schedule" button that creates periods based on school hours and period duration
- Bell schedule is per academic year (locked when year is active — follows Sprint 3 governance)

**Validation**:
- Unit test: Bell schedule within school hours → accepted
- Unit test: Bell schedule starting at 07:00 (before 08:00 start) → rejected
- Unit test: Auto-generate → produces correct number of periods
- Smoke test: Generate default bell schedule → verify times are correct

---

### Sprint 8: Nepal Pilot Hardening & MVP Polish

**Goal**: Final hardening for the 10 pilot schools in Nepal. Fix all Nepal-specific edge cases, ensure BS dates work end-to-end, NPR formatting is consistent, and the school creation → configuration → academic year → enrollment → billing flow works seamlessly.

**Demoable Outcome**: Complete end-to-end demo for a Nepal pilot school: Create school (Nepal address, Asia/Kathmandu, BS calendar, Sun-Fri) → configure → create academic year 2082-2083 → set up fee structures → enroll students → auto-generate invoices in NPR → record payment via Khalti → view dashboard in NPR with BS dates.

---

#### Ticket 8.1: Nepal address validation with district/province data

**Files**: `packages/shared-types/src/identity/nepal-geo.ts` (new)

**Task**:
- Create canonical list of Nepal's 7 provinces and 77 districts with correct relationships:
  - Province 1 (Koshi): Bhojpur, Dhankuta, Ilam, Jhapa, Khotang, Morang, Okhaldhunga, Panchthar, Sankhuwasabha, Solukhumbu, Sunsari, Taplejung, Terhathum, Udayapur
  - Province 2 (Madhesh): Bara, Dhanusha, Mahottari, Parsa, Rautahat, Saptari, Sarlahi, Siraha
  - Bagmati Province: Bhaktapur, Chitwan, Dhading, Dolakha, Kathmandu, Kavrepalanchok, Lalitpur, Makwanpur, Nuwakot, Ramechhap, Rasuwa, Sindhuli, Sindhupalchok
  - Gandaki Province: Baglung, Gorkha, Kaski, Lamjung, Manang, Mustang, Myagdi, Nawalpur, Parbat, Syangja, Tanahun
  - Lumbini Province: Arghakhanchi, Banke, Bardiya, Dang, Eastern Rukum, Gulmi, Kapilvastu, Nawalparasi West, Palpa, Pyuthan, Rolpa, Rupandehi
  - Karnali Province: Dailekh, Dolpa, Humla, Jajarkot, Jumla, Kalikot, Mugu, Salyan, Surkhet, Western Rukum
  - Sudurpashchim Province: Achham, Baitadi, Bajhang, Bajura, Dadeldhura, Darchula, Doti, Kailali, Kanchanpur
- Export as `NEPAL_PROVINCES` and `NEPAL_DISTRICTS` with province→district mapping
- Used by address form dropdowns and backend validation

**Validation**:
- Unit test: 7 provinces present
- Unit test: 77 districts total across all provinces
- Unit test: "Kathmandu" maps to "Bagmati Province"
- Build succeeds

---

#### Ticket 8.2: Nepal phone number validation

**Files**: `packages/shared-types/src/schemas/identity/school.schema.ts`, country config

**Task**:
- For Nepal schools, validate phone numbers against Nepal format:
  - Mobile: `9[6-9]XXXXXXXX` (10 digits) or `+977-9[6-9]XXXXXXXX`
  - Landline: `0[1-9]X-XXXXXXX` (area code + 7 digits)
- Update `phoneSchema` to be country-aware or add Nepal-specific validation in the `.refine()` based on address country
- Frontend: show `+977` prefix for Nepal schools

**Validation**:
- Unit test: `9841234567` → valid Nepal mobile
- Unit test: `01-4234567` → valid Kathmandu landline
- Unit test: `555-1234` → invalid for Nepal
- Manual test: Select Nepal → phone field shows +977 prefix

---

#### Ticket 8.3: End-to-end Nepal school smoke test script

**Files**: `scripts/smoke-tests/nepal-school-e2e.sh` (new)

**Task**:
- Create comprehensive smoke test that exercises the full Nepal pilot flow:
  1. Create school with Nepal address (Kathmandu, Bagmati Province)
  2. Verify school config has Nepal defaults (Sun-Fri, Asia/Kathmandu, BS calendar)
  3. Create academic year 2082-2083 (with Gregorian date equivalents)
  4. Create grading periods (terms)
  5. Create fee structures (tuition in NPR, auto-apply on enrollment)
  6. Create student
  7. Enroll student → verify auto-invoice generated in NPR
  8. Record payment → verify student account updated
  9. Verify all dates in responses are valid Gregorian ISO dates
  10. Verify school hours are enforced in scheduling
  11. Verify locked fields cannot change during active academic year
  12. Verify audit log has all changes recorded
- Print PASS/FAIL for each step

**Validation**:
- Run script against local dev environment → all steps PASS
- Script handles cleanup (delete test data after run)

---

#### Ticket 8.4: Consolidate `formatNPR` to single canonical implementation

**Files**: Multiple frontend files (8+ copies per Finance-Module-Production-Sprint-Plan audit)

**Task**:
- Ensure `formatNPR` (or more generically `formatCurrency`) is exported from `@edforge/types` or shared-types
- Replace all 8+ local copies with the canonical import
- The canonical implementation should:
  - Format in Nepali lakh/crore system (1,23,456 not 123,456)
  - Use `रु` or `NPR` prefix based on locale
  - Handle edge cases: 0, negative (for credits), very large amounts
- For future: make this country-aware (`formatCurrency(amount, currency, locale)`)

**Validation**:
- Grep: `formatNPR` only defined in one canonical location
- Unit test: `formatNPR(123456)` → `'रु 1,23,456'`
- Unit test: `formatNPR(0)` → `'रु 0'`
- Build succeeds, all finance pages render correctly

---

#### Ticket 8.5: Fix academic year defaults to Bikram Sambat for Nepal schools

**Files**: Frontend academic year creation form

**Task**:
- When creating academic year for a Nepal school (calendarSystem = bikram_sambat):
  - Default name: `"2082-2083"` (current BS year range)
  - Default dates: Baishakh 1, 2082 to Chaitra end, 2082 (in Gregorian)
  - Date pickers show BS dates
  - Display "2082-2083 BS" in academic year lists and dropdowns
- When creating for a US/Gregorian school:
  - Default name: `"2025-2026"`
  - Standard Gregorian date pickers

**Validation**:
- Manual test: Nepal school → create academic year → defaults to 2082-2083 BS dates
- Manual test: US school → create academic year → defaults to 2025-2026 Gregorian
- Smoke test: Nepal academic year creation → dates are valid Gregorian in API response

---

## Dependency Graph

```
Sprint 1 (i18n Foundation)
  ├── Sprint 2 (Bikram Sambat) — depends on calendarSystem field from 1.2
  ├── Sprint 3 (Temporal Governance) — independent, can parallel with Sprint 2
  │     └── Sprint 7 (School Hours) — depends on governance from 3.2
  └── Sprint 4 (Finance Foundation) — depends on country-aware currency from 1.1
        └── Sprint 5 (Event Billing) — depends on versioned fees from 4.4
              └── Sprint 6 (Finance Hardening) — depends on billing engine from 5.2
                    └── Sprint 8 (Nepal Pilot) — depends on ALL previous sprints
```

**Parallelization opportunities:**
- Sprints 2 and 3 can run in parallel (different engineers)
- Sprints 4 and 3 can overlap if different engineers
- Sprint 7 can start once Sprint 3 is complete
- Sprint 8 is the integration/hardening sprint and must be last

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BS date conversion accuracy | Medium | High | Use well-tested library (bikram-sambat-js), 100+ round-trip tests |
| DynamoDB schema migration for new fields | Low | Medium | New fields are optional with defaults; no migration needed |
| Finance versioning complexity | Medium | Medium | Start with amount-only versioning; expand later |
| Country config registry growing too large | Low | Low | Compile-time constants, tree-shaken; only used countries bundled |
| Temporal governance blocking legitimate changes | Medium | High | Clear UI messaging, admin override with audit trail |
| Enrollment billing event ordering | Medium | High | Idempotent event processing, duplicate invoice detection |

---

## Out of Scope (Future Sprints)

- Full double-entry General Ledger (GL/AP/AR)
- Multi-currency support beyond NPR (architecture supports it, not implemented)
- Payment plan / installment EMI engine
- Automated email/SMS reminders for overdue invoices
- Revenue forecasting / trend analysis
- Address geocoding via Google Maps API (manual entry for MVP)
- Bulk school import for large districts
- Student/Parent portal with self-service payment
- Payroll and expense management
- Ed-Fi ODS data sync/export
- Nepal fiscal year alignment (Shrawan–Ashadh) for government reporting
- Full Nepali language UI translation (l10n for labels, buttons, error messages)
- Nepal government school classification codes (Community, Institutional, Religious)
- Bulk enrollment billing batch endpoint for year-start mass enrollment
- DynamoDB TTL-based audit log retention policy

---

## Independent Review Findings & Resolutions

This plan was reviewed by a senior staff engineer. All critical findings have been incorporated inline. Below is the full review log for traceability.

### MUST FIX (Incorporated)

**M1. Ticket 3.5 must extend existing `transitionStatus()` method, not rewrite it.**
The existing `schools.service.ts` already has a `transitionStatus()` method with valid transition rules. Ticket 3.5 is scoped to *extend* that method with new preconditions (e.g., "setup→active requires academic year") and audit trail — not recreate it.

**M2. Ticket 1.3 split: address schema changes separated from principal field removal.**
Principal field removal is handled by Ticket 1.8 (frontend) and the schema change in 1.3 is limited to address fields only. Ticket 1.3 no longer touches `principalName`/`principalEmail`.

**M3. Ticket 5.2 must refactor existing `enrollment-webhook.controller.ts`, not create parallel code.**
The existing controller already handles `enrollment-completed` and `student-withdrawn` events with real logic (auto-invoice generation, student account creation, identity resolution fallback). Ticket 5.2 refactors and extends this controller — preserving all existing behavior (idempotent account creation, identity resolution, draft invoice cancellation on withdrawal).

**M4. Missing ticket: Backend entity changes for `calendarSystem` field.**
**Added as Ticket 1.2b**: Add `calendarSystem` to the `School` entity interface in `school.entity.ts`, the `createSchoolEntity()` factory function, and the `toSchoolResponse()` mapper. Without this, the backend silently drops the field.

> **Ticket 1.2b: Add calendarSystem to School entity and response mapper**
> **Files**: `server/application/microservices/identity/src/common/entities/school.entity.ts`, `schools.service.ts:toSchoolResponse()`
> **Task**: Add `calendarSystem: string` to School entity interface. Include in `createSchoolEntity()` factory. Map in `toSchoolResponse()`. Default to `'gregorian'` for existing schools (null-safe).
> **Validation**: Unit test: create school with `calendarSystem: 'bikram_sambat'` → GET returns it. Unit test: existing school without field → defaults to `'gregorian'`.

**M5. Race condition in fee structure versioning — use DynamoDB TransactWriteItems.**
Ticket 4.4 updated: The create-new + deactivate-old operation MUST use `DynamoDB TransactWriteItems` to atomically create the new version and deactivate the old in a single transaction. If the `DynamoDBClientService` does not have a `transactWrite` method, add one as a prerequisite sub-task.

**M6. Sibling detection requires a GSI on parentId/guardianId.**
Ticket 6.1 updated: Add prerequisite sub-task to create a GSI for parent/guardian-based lookups. Without this, sibling detection requires a full table scan. The GSI key: `GSI4-PK: PARENT#{parentId}`, `GSI4-SK: STUDENT#{studentId}`. Alternatively, use an application-level lookup via the student entity's `parentId` field if a GSI already exists for student queries.

### SHOULD FIX (Incorporated)

**S1. `formatNPR` canonical implementation may already exist.**
Ticket 8.4 updated: First verify if `packages/shared-types/src/utils/currency.ts` already has a canonical `formatNPR`. If so, scope is reduced to "replace remaining local copies with imports from canonical location."

**S2. Currency enum expansion moved to Sprint 1.**
The `currencyEnum` expansion from `['NPR']` to `['NPR', 'USD', 'INR', 'GBP', 'AUD', 'CAD']` is moved into Ticket 1.1 alongside the country config, since the country registry defines `defaultCurrency` per country but the finance schema must accept it.

**S3. Emergency override mechanism added to Ticket 3.2.**
Added `forceOverride: boolean` + `overrideReason: string` parameters to update endpoints, gated to `TenantAdmin` role only. When force override is used: the locked field is updated, a HIGH-SEVERITY audit log entry is created with the reason, and an admin notification is triggered. This handles the real-world scenario where a school discovers a grading scale error mid-year.

**S4. Backward compatibility for address schema changes.**
Ticket 1.3 updated: All references to `address.state` and `address.zipCode` must use null-safe access. Existing schools with `country: undefined` default to `'USA'`. The country-specific `.refine()` validators only fire when `country` is explicitly set to a non-USA value.

**S5. Ticket 2.2 (BS date picker) split into sub-tasks.**
Now three sub-tickets: (a) `BsCalendarGrid` core component with BS month rendering, (b) `BsDatePicker` with navigation and selection, (c) `DateInput` wrapper that switches based on `calendarSystem`.

**S6. Country config `phonePattern` stored as string, not RegExp.**
Ticket 1.1 updated: Use `phonePattern: string` in the config. Construct `RegExp` at validation time.

**S7. Ticket 4.3 note added for BS/Gregorian date comparison.**
All date comparisons in fee structure validation use Gregorian ISO dates (storage format), regardless of the school's display calendar system. This is correct by design but now explicitly documented.

**S8. `schoolContactInfoSchema` phone constraint relaxed.**
`primaryPhone` min length relaxed from `min(10)` to `min(7)` for international support. Nepal landlines can be as short as 7 digits with area code.

### NICE TO HAVE (Noted for Future)

- N1: Nepal fiscal year awareness (Shrawan–Ashadh) → added to Out of Scope
- N2: Nepali language UI strings → added to Out of Scope
- N3: Nepal government school classifications → added to Out of Scope
- N4: Bulk enrollment billing batch endpoint → added to Out of Scope
- N5: DynamoDB TTL for audit logs → added to Out of Scope
- N6: Timezone default inconsistency (America/Chicago vs America/New_York) → fixed in Ticket 1.6 as part of country-aware defaults
- N7: `parentFeeStructureId` overloaded → Ticket 4.4 uses `versionParentId`, Ticket 6.5 uses `templateParentId` (distinct field names)

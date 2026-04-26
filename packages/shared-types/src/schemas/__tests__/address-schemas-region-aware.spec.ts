/**
 * Address-schemas region-aware extensions — Sprint A.1 + A.2
 *
 * Locks the contract for the Nepal-aware extension fields added to:
 *   - `addressSchema` (common.ts) — used by Student / Family / Guardian
 *   - `staffAddressSchema` (identity/staff.schema.ts)
 *
 * The third address schema, `schoolAddressSchema` (identity/school.schema.ts),
 * already had Nepal fields + NPL-conditional refinements pre-Sprint A — its
 * coverage lives alongside the school schema and is unchanged by this sprint.
 *
 * Critical invariants tested:
 *   1. GENERIC tenants' US-shaped payloads still validate (backwards-compat).
 *   2. PABSON tenants' Nepal-shaped payloads validate.
 *   3. Mixed payloads (Nepal + US fields populated) validate — required by
 *      the divergence policy in `docs/decisions/region-aware-forms-divergence.md`.
 *   4. Empty addresses still validate (all fields optional).
 *   5. The `street1` / `streetNumberName` anchor refinement still fires on
 *      partial Nepal-only addresses.
 */
import { addressSchema } from '../common';
import { staffAddressSchema } from '../identity/staff.schema';

describe('addressSchema (legacy, Student/Family/Guardian) — Sprint A.1 extension', () => {
  describe('Backwards-compatibility (GENERIC archetype tenants)', () => {
    it('validates the existing US-shaped payload unchanged', () => {
      const result = addressSchema.safeParse({
        street1: '6600 McKinney Pkwy',
        city: 'McKinney',
        state: 'TX',
        zipCode: '76909',
        country: 'US',
      });
      expect(result.success).toBe(true);
    });

    it('validates a fully-empty address (all optional)', () => {
      expect(addressSchema.safeParse({}).success).toBe(true);
    });

    it('validates a US-shaped address without optional Nepal fields', () => {
      const result = addressSchema.safeParse({
        street1: '123 Main St',
        country: 'USA',
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-empty address missing street1 (existing refinement)', () => {
      const result = addressSchema.safeParse({
        city: 'McKinney',
        state: 'TX',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Nepal-aware extension (PABSON archetype tenants)', () => {
    it('validates a Nepal-shaped payload with all 4 extension fields', () => {
      const result = addressSchema.safeParse({
        street1: 'Tole-12, Bishal Bazar',
        wardNumber: '12',
        municipality: 'Kathmandu Metropolitan City',
        district: 'Kathmandu',
        province: 'Bagmati',
        country: 'NPL',
      });
      expect(result.success).toBe(true);
    });

    it('validates a partial Nepal address (province + district only) when street1 set', () => {
      const result = addressSchema.safeParse({
        street1: 'Ward office road',
        province: 'Bagmati',
        district: 'Kathmandu',
      });
      expect(result.success).toBe(true);
    });

    it('rejects Nepal-only fields when street1 is missing (refinement extends to Nepal fields)', () => {
      const result = addressSchema.safeParse({
        province: 'Bagmati',
        district: 'Kathmandu',
        municipality: 'Kathmandu Metropolitan',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.street1).toBeTruthy();
      }
    });

    it('caps wardNumber at 10 chars', () => {
      const result = addressSchema.safeParse({
        street1: 'x',
        wardNumber: '12345678901',
      });
      expect(result.success).toBe(false);
    });

    it('caps municipality at 100 chars', () => {
      const result = addressSchema.safeParse({
        street1: 'x',
        municipality: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Mixed shape (per divergence policy A.0)', () => {
    it('validates a payload with both legacy AND Nepal fields populated', () => {
      // The divergence ADR allows existing rehearsal-tenant data with
      // legacy fields to coexist with new Nepal-shaped fields on the same row.
      const result = addressSchema.safeParse({
        street1: 'Tole-12',
        city: 'Kathmandu',         // legacy
        country: 'NPL',
        wardNumber: '12',          // Nepal
        district: 'Kathmandu',     // Nepal
        province: 'Bagmati',       // Nepal
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('staffAddressSchema (Ed-Fi-aligned) — Sprint A.2 extension', () => {
  describe('Backwards-compatibility (GENERIC archetype tenants)', () => {
    it('validates the existing Ed-Fi US-shaped payload unchanged', () => {
      const result = staffAddressSchema.safeParse({
        addressTypeDescriptor: 'home',
        streetNumberName: '6600 McKinney Pkwy',
        city: 'McKinney',
        stateAbbreviationDescriptor: 'TX',
        postalCode: '76909',
        country: 'US',
      });
      expect(result.success).toBe(true);
    });

    it('validates a fully-empty staff address (all optional)', () => {
      expect(staffAddressSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('Nepal-aware extension (PABSON archetype tenants)', () => {
    it('validates a Nepal-shaped staff payload with all 4 extension fields', () => {
      const result = staffAddressSchema.safeParse({
        addressTypeDescriptor: 'home',
        streetNumberName: 'Tole-7, Bauddha',
        wardNumber: '7',
        municipality: 'Kathmandu Metropolitan City',
        district: 'Kathmandu',
        province: 'Bagmati',
        country: 'NPL',
      });
      expect(result.success).toBe(true);
    });

    it('does NOT enforce a streetNumberName anchor (no refinement on staff schema)', () => {
      // Unlike addressSchema, staffAddressSchema has no refinement. Setting
      // only Nepal fields without streetNumberName is legal at the schema
      // level — the UI is responsible for asking the right questions.
      const result = staffAddressSchema.safeParse({
        province: 'Bagmati',
        district: 'Kathmandu',
      });
      expect(result.success).toBe(true);
    });

    it('caps each Nepal field consistently with addressSchema', () => {
      // Lock the cap consistency so future drift between the two schemas
      // (different limits → divergent UX) is caught.
      const oversizedWard = staffAddressSchema.safeParse({
        wardNumber: '12345678901',
      });
      const oversizedMunicipality = staffAddressSchema.safeParse({
        municipality: 'a'.repeat(101),
      });
      const oversizedDistrict = staffAddressSchema.safeParse({
        district: 'a'.repeat(101),
      });
      const oversizedProvince = staffAddressSchema.safeParse({
        province: 'a'.repeat(101),
      });
      expect(oversizedWard.success).toBe(false);
      expect(oversizedMunicipality.success).toBe(false);
      expect(oversizedDistrict.success).toBe(false);
      expect(oversizedProvince.success).toBe(false);
    });
  });

  describe('Mixed shape (per divergence policy A.0)', () => {
    it('validates a payload with both Ed-Fi US AND Nepal fields populated', () => {
      const result = staffAddressSchema.safeParse({
        streetNumberName: 'Tole-12',
        city: 'Kathmandu',                  // Ed-Fi US-style
        stateAbbreviationDescriptor: 'BAG', // Ed-Fi US-style (re-purposed)
        country: 'NPL',
        wardNumber: '12',                   // Nepal
        district: 'Kathmandu',              // Nepal
        province: 'Bagmati',                // Nepal
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Cross-schema consistency (Sprint A.3 audit)', () => {
  // The four Nepal-aware extension fields exist in three places now:
  //   - addressSchema (common.ts)             — Sprint A.1
  //   - staffAddressSchema (staff.schema.ts)  — Sprint A.2
  //   - schoolAddressSchema (school.schema.ts) — pre-existing (canonical)
  //
  // Field NAMES + character caps must stay consistent across all three so a
  // single `<AddressFieldsNepal>` component can write one shape that all
  // three accept. Any future divergence is a UX bug magnet.
  it('Nepal extension field NAMES are identical across addressSchema and staffAddressSchema', () => {
    const ok1 = addressSchema.safeParse({
      street1: 'x',
      wardNumber: '1', municipality: 'M', district: 'D', province: 'P',
    }).success;
    const ok2 = staffAddressSchema.safeParse({
      streetNumberName: 'x',
      wardNumber: '1', municipality: 'M', district: 'D', province: 'P',
    }).success;
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
  });

  it('Nepal extension caps (wardNumber=10, others=100) are identical across the two schemas', () => {
    // wardNumber: 10-char max
    const wardAt10A = addressSchema.safeParse({ street1: 'x', wardNumber: '1234567890' }).success;
    const wardAt10S = staffAddressSchema.safeParse({ wardNumber: '1234567890' }).success;
    expect(wardAt10A).toBe(true);
    expect(wardAt10S).toBe(true);

    // others: 100-char max
    const longA = addressSchema.safeParse({ street1: 'x', province: 'a'.repeat(100) }).success;
    const longS = staffAddressSchema.safeParse({ province: 'a'.repeat(100) }).success;
    expect(longA).toBe(true);
    expect(longS).toBe(true);
  });
});

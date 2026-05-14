/**
 * schoolEntityToDto — regression guard for the entity→DTO contract.
 *
 * Sprint A.22 extracted this mapper from `SchoolsService.toSchoolResponse`
 * (private method) into a module-level pure function so the round-trip can
 * be tested without standing up the full DI graph. The pattern mirrors
 * `staffEntityToDto` (S4.1) and `studentEntityToDto` (post-2026-04-24 hotfix).
 *
 * The School entity already carried all 4 Nepal-aware extension fields
 * (wardNumber, municipality, district, province) pre-Sprint A — see the
 * canonical-pattern doc-comment on `schoolAddressSchema`. This spec locks
 * that those fields round-trip cleanly so a future mapper refactor (e.g.,
 * destructuring address into individual response fields) doesn't silently
 * strip them.
 */

import { schoolEntityToDto } from './schools.service';
import type { School } from '../common/entities/school.entity';

function makeSchool(overrides: Partial<School> = {}): School {
  return {
    tenantId: 't-1',
    entityKey: 'SCHOOL#sc-1',
    entityType: 'SCHOOL',
    schoolId: 'sc-1',
    schoolCode: 'SSEBS',
    name: 'Shree Saraswati English Boarding School',
    schoolType: 'private',
    status: 'active',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'system',
    updatedBy: 'system',
    version: 1,
    ...overrides,
  } as School;
}

describe('schoolEntityToDto — base contract (Sprint A.22 extraction)', () => {
  it('preserves identity and core fields', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        emisSchoolCode: '170840012',
        shortName: 'SSEBS',
        phone: '+9779800000000',
        email: 'office@ssebs.np',
      }),
    ) as any;

    expect(dto.schoolId).toBe('sc-1');
    expect(dto.schoolCode).toBe('SSEBS');
    expect(dto.emisSchoolCode).toBe('170840012');
    expect(dto.name).toBe('Shree Saraswati English Boarding School');
    expect(dto.shortName).toBe('SSEBS');
    expect(dto.schoolType).toBe('private');
    expect(dto.phone).toBe('+9779800000000');
    expect(dto.email).toBe('office@ssebs.np');
    expect(dto.status).toBe('active');
  });

  it('defaults calendarSystem to "gregorian" when missing', () => {
    const dto = schoolEntityToDto(makeSchool()) as any;
    expect(dto.calendarSystem).toBe('gregorian');
  });

  it('preserves explicit calendarSystem (e.g., bikram_sambat)', () => {
    const dto = schoolEntityToDto(
      makeSchool({ calendarSystem: 'bikram_sambat' as any }),
    ) as any;
    expect(dto.calendarSystem).toBe('bikram_sambat');
  });

  // ============================================
  // S0.2 — academicCalendarType is no longer surfaced on School responses.
  // The authoritative source for calendar-shape is AcademicYear.calendarType.
  // Legacy DDB rows may still carry the field; the mapper simply stops
  // emitting it.
  // ============================================
  it('S0.2 — DROPS academicCalendarType from response even if the entity carries it', () => {
    const dto = schoolEntityToDto(
      makeSchool({ academicCalendarType: 'annual' as any }),
    ) as any;
    expect(dto).not.toHaveProperty('academicCalendarType');
  });
});

describe('schoolEntityToDto — Sprint A.22 Nepal address round-trip', () => {
  it('preserves all 4 Nepal extension fields on the school address', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        address: {
          street1: 'Tole-12, Bishal Bazar',
          country: 'NPL',
          wardNumber: '12',
          municipality: 'Kathmandu Metropolitan City',
          district: 'Kathmandu',
          province: 'Bagmati',
        } as any,
      }),
    ) as any;

    expect(dto.address.wardNumber).toBe('12');
    expect(dto.address.municipality).toBe('Kathmandu Metropolitan City');
    expect(dto.address.district).toBe('Kathmandu');
    expect(dto.address.province).toBe('Bagmati');
    expect(dto.address.country).toBe('NPL');
  });

  it('preserves coordinates alongside Nepal fields', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        address: {
          street1: 'Tole-1',
          country: 'NPL',
          wardNumber: '1',
          district: 'Kaski',
          province: 'Gandaki',
          coordinates: { latitude: 28.2096, longitude: 83.9856 },
        } as any,
      }),
    ) as any;

    expect(dto.address.coordinates.latitude).toBeCloseTo(28.2096, 4);
    expect(dto.address.coordinates.longitude).toBeCloseTo(83.9856, 4);
    expect(dto.address.district).toBe('Kaski');
  });

  it('leaves Nepal fields undefined when school address is US-shaped (GENERIC backwards-compat)', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        address: {
          street1: '6600 McKinney Pkwy',
          city: 'McKinney',
          state: 'TX',
          zipCode: '76909',
          country: 'US',
        } as any,
      }),
    ) as any;

    expect(dto.address.city).toBe('McKinney');
    expect(dto.address.state).toBe('TX');
    expect(dto.address.zipCode).toBe('76909');
    expect(dto.address.wardNumber).toBeUndefined();
    expect(dto.address.municipality).toBeUndefined();
    expect(dto.address.district).toBeUndefined();
    expect(dto.address.province).toBeUndefined();
  });

  it('preserves a mixed-shape address (legacy + Nepal) per A.0 divergence policy', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        address: {
          street1: 'Tole-12',
          city: 'Kathmandu',
          country: 'NPL',
          wardNumber: '12',
          district: 'Kathmandu',
          province: 'Bagmati',
        } as any,
      }),
    ) as any;

    expect(dto.address.city).toBe('Kathmandu');     // legacy preserved
    expect(dto.address.wardNumber).toBe('12');       // Nepal preserved
    expect(dto.address.district).toBe('Kathmandu');
    expect(dto.address.province).toBe('Bagmati');
  });

  it('handles a school with no address (defensive — address is optional on entity)', () => {
    const dto = schoolEntityToDto(makeSchool()) as any;
    expect(dto.address).toBeUndefined();
  });
});

describe('schoolEntityToDto — Ed-Fi Education Organization fields', () => {
  it('passes through Ed-Fi descriptor + array fields without dropping', () => {
    const dto = schoolEntityToDto(
      makeSchool({
        localEducationAgencyId: 'lea-1',
        schoolCategories: ['High School'] as any,
        schoolTypeDescriptor: 'uri://ed-fi.org/SchoolTypeDescriptor#Public' as any,
        gradeLevels: ['9', '10', '11', '12'] as any,
        identificationCodes: [{ code: 'X1', system: 'NCES' }] as any,
        institutionTelephones: [{ type: 'Main', number: '+977-1-1234567' }] as any,
      }),
    ) as any;

    expect(dto.localEducationAgencyId).toBe('lea-1');
    expect(dto.schoolCategories).toEqual(['High School']);
    expect(dto.schoolTypeDescriptor).toBe('uri://ed-fi.org/SchoolTypeDescriptor#Public');
    expect(dto.gradeLevels).toEqual(['9', '10', '11', '12']);
    expect(dto.identificationCodes).toHaveLength(1);
    expect(dto.institutionTelephones).toHaveLength(1);
  });
});

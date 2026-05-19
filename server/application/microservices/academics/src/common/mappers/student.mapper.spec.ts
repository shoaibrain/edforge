import { createStudentDtoToEntity, updateStudentDtoToEntity, studentEntityToDto } from './student.mapper';
import type { CreateStudentDto, GuardianDto } from '@aibrains/shared-types';
import type { Student } from '../entities/student.entity';

const baseGuardian = (overrides: Partial<GuardianDto> = {}): GuardianDto => ({
  relationship: 'father',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+9779800000000',
  isPrimary: false,
  hasPortalAccess: false,
  canPickup: true,
  ...overrides,
} as GuardianDto);

const baseDto = (guardians: GuardianDto[]): CreateStudentDto => ({
  firstName: 'Test',
  lastName: 'Student',
  dateOfBirth: '2015-01-01',
  gender: 'male',
  schoolId: 'school-1',
  currentGradeLevel: '1',
  guardians,
} as CreateStudentDto);

describe('student.mapper — guardian ID assignment', () => {
  it('assigns distinct guardianIds to multiple guardians on a single student', () => {
    const dto = baseDto([
      baseGuardian({ firstName: 'Alice' }),
      baseGuardian({ firstName: 'Bob' }),
      baseGuardian({ firstName: 'Carol' }),
    ]);

    const entity = createStudentDtoToEntity(dto);
    const ids = (entity.guardians ?? []).map((g) => g.guardianId);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
  });

  it('generates distinct guardianIds across many synchronous mapper calls', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const entity = createStudentDtoToEntity(baseDto([baseGuardian()]));
      ids.push(entity.guardians![0].guardianId);
    }
    expect(new Set(ids).size).toBe(100);
  });

  it('preserves caller-supplied guardianId when present', () => {
    const dto = baseDto([baseGuardian({ guardianId: 'caller-supplied-id-1' })]);
    const entity = createStudentDtoToEntity(dto);
    expect(entity.guardians![0].guardianId).toBe('caller-supplied-id-1');
  });

  it('assigns unique ids on UpdateStudentDto paths too', () => {
    const updates = updateStudentDtoToEntity({
      guardians: [baseGuardian({ firstName: 'A' }), baseGuardian({ firstName: 'B' })],
    } as any);
    const ids = (updates.guardians ?? []).map((g) => g.guardianId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('studentEntityToDto — Sprint 3 descriptor round-trip', () => {
  // Minimal Student entity shape — only the fields the mapper reads. The
  // entity interface requires more in principle but the mapper only copies
  // specific keys, so this is enough to exercise the regression fix.
  function makeEntity(overrides: Partial<Student> = {}): Student {
    return {
      tenantId: 't-1',
      entityKey: 'STUDENT#s-1',
      entityType: 'STUDENT',
      studentId: 's-1',
      studentNumber: 'TST-2026-00001',
      firstName: 'Test',
      lastName: 'Student',
      dateOfBirth: '2015-01-01',
      gender: 'male',
      primarySchoolId: 'school-1',
      currentGradeLevel: '1',
      status: 'active',
      guardians: [],
      gsi1pk: 'TENANT#t-1#SCHOOL#school-1',
      gsi1sk: 'STUDENT#Student#Test',
      ...overrides,
    } as Student;
  }

  it('copies all 8 Sprint 3 descriptor fields from entity to DTO', () => {
    // Regression guard for the 2026-04-24 bug where PATCH /descriptors
    // wrote to DDB correctly but every response (PATCH, GET /profile, list)
    // stripped the descriptor fields because the mapper didn't copy them.
    const entity = makeEntity({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
      languageDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Nepali',
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
      disabilities: [
        { descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing', notes: 'private' },
      ],
      ethnicityDescriptor: 'uri://ed-fi.org/EthnicityDescriptor#Dalit',
      isTransferred: true,
      belowPovertyLine: true,
      scholarshipCategory: 'Janajati',
    });

    const dto = studentEntityToDto(entity) as any;

    expect(dto.sexDescriptor).toBe('uri://ed-fi.org/SexDescriptor#Male');
    expect(dto.languageDescriptor).toBe('uri://ed-fi.org/LanguageDescriptor#Nepali');
    expect(dto.motherTongueDescriptor).toBe('uri://ed-fi.org/LanguageDescriptor#Maithili');
    expect(dto.disabilities).toEqual([
      { descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing', notes: 'private' },
    ]);
    expect(dto.ethnicityDescriptor).toBe('uri://ed-fi.org/EthnicityDescriptor#Dalit');
    expect(dto.isTransferred).toBe(true);
    expect(dto.belowPovertyLine).toBe(true);
    expect(dto.scholarshipCategory).toBe('Janajati');
  });

  it('leaves descriptor fields undefined when the entity has none (pre-Sprint-3 students)', () => {
    const entity = makeEntity();
    const dto = studentEntityToDto(entity) as any;

    expect(dto.sexDescriptor).toBeUndefined();
    expect(dto.languageDescriptor).toBeUndefined();
    expect(dto.motherTongueDescriptor).toBeUndefined();
    expect(dto.disabilities).toBeUndefined();
    expect(dto.ethnicityDescriptor).toBeUndefined();
    expect(dto.isTransferred).toBeUndefined();
    expect(dto.belowPovertyLine).toBeUndefined();
    expect(dto.scholarshipCategory).toBeUndefined();
  });
});

// ============================================================
// Sprint A.21 — Nepal-aware address fields round-trip
// ============================================================
// The four optional Nepal extension fields (wardNumber, municipality, district,
// province) added to entity Address in Sprint A.1 must round-trip cleanly
// through studentEntityToDto for both the student's own address and the nested
// guardian addresses. The mapper at student.mapper.ts:57 spreads
// `address: entity.address` and at line 238 `address: entity.address` for
// guardians — these tests lock that contract against a future destructure-
// and-rebuild refactor.
describe('studentEntityToDto — Sprint A.21 Nepal address round-trip', () => {
  function makeEntity(overrides: Partial<Student> = {}): Student {
    return {
      tenantId: 't-1',
      entityKey: 'STUDENT#s-1',
      entityType: 'STUDENT',
      studentId: 's-1',
      studentNumber: 'TST-2026-00001',
      firstName: 'Aachal',
      lastName: 'Mandal',
      dateOfBirth: '2015-01-01',
      gender: 'female',
      primarySchoolId: 'school-1',
      currentGradeLevel: '1',
      status: 'active',
      guardians: [],
      gsi1pk: 'TENANT#t-1#SCHOOL#school-1',
      gsi1sk: 'STUDENT#Mandal#Aachal',
      ...overrides,
    } as Student;
  }

  it('preserves all 4 Nepal extension fields on the student\'s own address', () => {
    const entity = makeEntity({
      address: {
        street1: 'Tole-12',
        // Nepal-shaped addresses don't always have legacy city/state/zipCode;
        // the IEMIS xlsx import populates Nepal fields and may leave US fields
        // as empty strings. The runtime never enforces the entity-level
        // required-string typing; cast-through to validate the spread.
        city: '',
        state: '',
        zipCode: '',
        country: 'NPL',
        wardNumber: '12',
        municipality: 'Kathmandu Metropolitan City',
        district: 'Kathmandu',
        province: 'Bagmati',
      } as any,
    });

    const dto = studentEntityToDto(entity) as any;
    const addr = dto.contactInfo.address;

    expect(addr.wardNumber).toBe('12');
    expect(addr.municipality).toBe('Kathmandu Metropolitan City');
    expect(addr.district).toBe('Kathmandu');
    expect(addr.province).toBe('Bagmati');
    expect(addr.country).toBe('NPL');
  });

  it('preserves all 4 Nepal extension fields on each nested Guardian address', () => {
    const entity = makeEntity({
      guardians: [
        {
          guardianId: 'g-1',
          relationship: 'father',
          firstName: 'Ram',
          lastName: 'Mandal',
          phone: '+9779800000001',
          isPrimary: true,
          hasPortalAccess: false,
          canPickup: true,
          address: {
            street1: 'Tole-12',
            city: '', state: '', zipCode: '',
            country: 'NPL',
            wardNumber: '12',
            district: 'Kathmandu',
            province: 'Bagmati',
          } as any,
        },
        {
          guardianId: 'g-2',
          relationship: 'mother',
          firstName: 'Sita',
          lastName: 'Mandal',
          phone: '+9779800000002',
          isPrimary: false,
          hasPortalAccess: false,
          canPickup: true,
          address: {
            street1: 'Tole-7',
            city: '', state: '', zipCode: '',
            country: 'NPL',
            wardNumber: '7',
            district: 'Lalitpur',
            province: 'Bagmati',
          } as any,
        },
      ],
    });

    const dto = studentEntityToDto(entity) as any;

    expect(dto.guardians).toHaveLength(2);
    expect(dto.guardians[0].address.wardNumber).toBe('12');
    expect(dto.guardians[0].address.district).toBe('Kathmandu');
    expect(dto.guardians[0].address.province).toBe('Bagmati');
    expect(dto.guardians[1].address.wardNumber).toBe('7');
    expect(dto.guardians[1].address.district).toBe('Lalitpur');
    expect(dto.guardians[1].address.province).toBe('Bagmati');
  });

  it('leaves Nepal fields undefined when the entity has US-only shape (GENERIC backwards-compat)', () => {
    const entity = makeEntity({
      address: {
        street1: '6600 McKinney Pkwy',
        city: 'McKinney',
        state: 'TX',
        zipCode: '76909',
        country: 'US',
      },
    });

    const dto = studentEntityToDto(entity) as any;
    const addr = dto.contactInfo.address;

    expect(addr.city).toBe('McKinney');
    expect(addr.state).toBe('TX');
    expect(addr.zipCode).toBe('76909');
    expect(addr.wardNumber).toBeUndefined();
    expect(addr.municipality).toBeUndefined();
    expect(addr.district).toBeUndefined();
    expect(addr.province).toBeUndefined();
  });

  it('preserves a mixed-shape address (Nepal + legacy fields populated)', () => {
    // Per the divergence ADR (A.0), existing rehearsal-tenant rows may carry
    // legacy fields alongside Nepal fields once the operator opts in to
    // populate the Nepal-shaped fields without wiping the legacy data.
    const entity = makeEntity({
      address: {
        street1: 'Tole-12',
        city: 'Kathmandu',
        state: '',
        zipCode: '',
        country: 'NPL',
        wardNumber: '12',
        district: 'Kathmandu',
        province: 'Bagmati',
      } as any,
    });

    const dto = studentEntityToDto(entity) as any;
    const addr = dto.contactInfo.address;

    expect(addr.city).toBe('Kathmandu');           // legacy preserved
    expect(addr.country).toBe('NPL');
    expect(addr.wardNumber).toBe('12');            // Nepal preserved
    expect(addr.district).toBe('Kathmandu');
    expect(addr.province).toBe('Bagmati');
  });
});

/**
 * Sprint D0a.4 — DTO→entity descriptor pass-through (the CREATE side).
 *
 * Companion to the Sprint 3 entity→DTO round-trip tests above. The 2026-05-19
 * dev-pabson-primary dress rehearsal exposed that `createStudentDtoToEntity`
 * was projecting only the legacy / contact / family / medical fields and
 * silently dropping every Ed-Fi descriptor — meaning IEMIS-imported students
 * landed in DDB without sex/motherTongue/disabilities/isTransferred even
 * though the D0a.2 transformer populated them on the DTO. Fixed in
 * student.mapper.ts (mapper) + students.service.ts createStudent (explicit
 * service spread). This spec pins the contract.
 */
describe('createStudentDtoToEntity — D0a.4 descriptor pass-through', () => {
  const BASE: CreateStudentDto = {
    firstName: 'Roshani',
    lastName: 'Khatun',
    dateOfBirth: '2015-06-27',
    gender: 'female',
    schoolId: '02331d8d-0102-4e06-a721-9928d971c0c2',
    currentGradeLevel: '2',
  };

  it('passes sexDescriptor through', () => {
    const entity = createStudentDtoToEntity({
      ...BASE,
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
    });
    expect(entity.sexDescriptor).toBe('uri://ed-fi.org/SexDescriptor#Female');
  });

  it('passes motherTongueDescriptor through', () => {
    const entity = createStudentDtoToEntity({
      ...BASE,
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
    });
    expect(entity.motherTongueDescriptor).toBe(
      'uri://ed-fi.org/LanguageDescriptor#Maithili',
    );
  });

  it('passes disabilities array through', () => {
    const entity = createStudentDtoToEntity({
      ...BASE,
      disabilities: [
        { descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Vision' },
      ],
    });
    expect(entity.disabilities).toEqual([
      { descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Vision' },
    ]);
  });

  it('passes isTransferred boolean through', () => {
    const entity = createStudentDtoToEntity({
      ...BASE,
      isTransferred: true,
    });
    expect(entity.isTransferred).toBe(true);
  });

  it('passes the S3.7-aligned descriptor fields through too (consistency)', () => {
    const entity = createStudentDtoToEntity({
      ...BASE,
      languageDescriptor: 'uri://ed-fi.org/LanguageDescriptor#English',
      ethnicityDescriptor: 'uri://edforge.app/EthnicityDescriptor#Tharu',
      belowPovertyLine: true,
      scholarshipCategory: 'OBC',
    });
    expect(entity.languageDescriptor).toBe(
      'uri://ed-fi.org/LanguageDescriptor#English',
    );
    expect(entity.ethnicityDescriptor).toBe(
      'uri://edforge.app/EthnicityDescriptor#Tharu',
    );
    expect(entity.belowPovertyLine).toBe(true);
    expect(entity.scholarshipCategory).toBe('OBC');
  });

  it('leaves descriptor fields undefined when the DTO omits them (pre-Sprint-3 callers)', () => {
    const entity = createStudentDtoToEntity(BASE);
    expect(entity.sexDescriptor).toBeUndefined();
    expect(entity.motherTongueDescriptor).toBeUndefined();
    expect(entity.disabilities).toBeUndefined();
    expect(entity.isTransferred).toBeUndefined();
    expect(entity.languageDescriptor).toBeUndefined();
    expect(entity.ethnicityDescriptor).toBeUndefined();
    expect(entity.belowPovertyLine).toBeUndefined();
    expect(entity.scholarshipCategory).toBeUndefined();
  });
});

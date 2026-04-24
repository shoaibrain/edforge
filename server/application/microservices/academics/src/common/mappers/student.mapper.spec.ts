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

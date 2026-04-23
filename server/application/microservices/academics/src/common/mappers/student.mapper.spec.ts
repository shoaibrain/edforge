import { createStudentDtoToEntity, updateStudentDtoToEntity } from './student.mapper';
import type { CreateStudentDto, GuardianDto } from '@aibrains/shared-types';

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

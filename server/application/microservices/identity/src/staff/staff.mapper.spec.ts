/**
 * staffEntityToDto — regression guard for the entity→DTO contract.
 *
 * Background: on 2026-04-24 the analogous `studentEntityToDto` silently
 * stripped the 8 Sprint-3 descriptor fields because the mapper wasn't
 * updated when they were added to the entity. PATCH writes succeeded
 * (DDB is schemaless) but every response body omitted them, breaking the
 * frontend Demographics tab until hotfix PR #23. This spec exists so the
 * same mistake can't repeat for the Staff IEMIS fields (Sprint 4 S4.1).
 *
 * Whenever the Staff entity gains a field that should be surfaced via
 * StaffResponseDto, add an assertion here to lock the round-trip.
 */

import { staffEntityToDto } from './staff.service';
import type { Staff } from '../common/entities/staff.entity';

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    tenantId: 't-1',
    entityKey: 'STAFF#s-1',
    entityType: 'STAFF',
    staffId: 's-1',
    staffUniqueId: 'EMP-0001',
    firstName: 'Ram',
    lastSurname: 'Shrestha',
    email: 'ram@school.np',
    primarySchoolId: 'school-1',
    schoolAssignments: [],
    role: 'teacher',
    employmentType: 'full_time',
    employmentStatus: 'active',
    hireDate: '2023-01-10',
    status: 'active',
    createdAt: '2023-01-10T00:00:00Z',
    updatedAt: '2023-01-10T00:00:00Z',
    createdBy: 'system',
    updatedBy: 'system',
    version: 1,
    ...overrides,
  } as Staff;
}

describe('staffEntityToDto — Sprint 4 IEMIS fields round-trip', () => {
  it('copies all 5 Sprint 4 IEMIS fields from entity to DTO', () => {
    const entity = makeStaff({
      emisStaffId: '1234567890123456',
      nationality: 'NPL',
      maritalStatus: 'married',
      appointmentType: 'permanent',
      appointmentDate: '2023-01-10',
    });

    const dto = staffEntityToDto(entity) as any;

    expect(dto.emisStaffId).toBe('1234567890123456');
    expect(dto.nationality).toBe('NPL');
    expect(dto.maritalStatus).toBe('married');
    expect(dto.appointmentType).toBe('permanent');
    expect(dto.appointmentDate).toBe('2023-01-10');
  });

  it('leaves IEMIS fields undefined when the entity has none (pre-Sprint-4 staff)', () => {
    const entity = makeStaff();
    const dto = staffEntityToDto(entity) as any;

    expect(dto.emisStaffId).toBeUndefined();
    expect(dto.nationality).toBeUndefined();
    expect(dto.maritalStatus).toBeUndefined();
    expect(dto.appointmentType).toBeUndefined();
    expect(dto.appointmentDate).toBeUndefined();
  });

  it('preserves the base Staff fields (no regression on pre-Sprint-4 shape)', () => {
    const entity = makeStaff({ gender: 'female', hispanicLatinoEthnicity: false });
    const dto = staffEntityToDto(entity) as any;

    expect(dto.staffId).toBe('s-1');
    expect(dto.staffUniqueId).toBe('EMP-0001');
    expect(dto.firstName).toBe('Ram');
    expect(dto.lastSurname).toBe('Shrestha');
    expect(dto.email).toBe('ram@school.np');
    expect(dto.gender).toBe('female');
    expect(dto.hispanicLatinoEthnicity).toBe(false);
    expect(dto.role).toBe('teacher');
    expect(dto.employmentType).toBe('full_time');
    expect(dto.status).toBe('active');
  });

  it('surfaces the primary school name from the schoolAssignments array', () => {
    const entity = makeStaff({
      schoolAssignments: [
        {
          staffAssignmentId: 'a1',
          schoolId: 'school-1',
          schoolName: 'Shree Saraswati',
          role: 'teacher',
          isPrimary: true,
          beginDate: '2023-01-10',
        } as any,
        {
          staffAssignmentId: 'a2',
          schoolId: 'school-2',
          schoolName: 'Other School',
          role: 'teacher',
          isPrimary: false,
          beginDate: '2023-06-01',
        } as any,
      ],
    });

    const dto = staffEntityToDto(entity) as any;
    expect(dto.primarySchoolName).toBe('Shree Saraswati');
    expect(dto.schoolAssignments).toHaveLength(2);
  });
});

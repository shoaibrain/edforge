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

  // ============================================================
  // Sprint A.20 — Nepal-aware address extension round-trip
  // ============================================================
  // The four optional Nepal fields (wardNumber, municipality, district,
  // province) added to StaffAddress in Sprint A.2 must round-trip cleanly
  // through staffEntityToDto. If a future refactor of the mapper inadvertently
  // re-shapes addresses[] (e.g., destructure-and-rebuild), these tests fail.
  describe('Sprint A.20 — Nepal address fields round-trip', () => {
    it('copies all 4 Nepal extension fields on every address entry', () => {
      const entity = makeStaff({
        addresses: [
          {
            addressTypeDescriptor: 'home',
            streetNumberName: 'Tole-7, Bauddha',
            wardNumber: '7',
            municipality: 'Kathmandu Metropolitan City',
            district: 'Kathmandu',
            province: 'Bagmati',
            country: 'NPL',
          },
        ],
      });

      const dto = staffEntityToDto(entity) as any;

      expect(dto.addresses).toHaveLength(1);
      const addr = dto.addresses[0];
      expect(addr.wardNumber).toBe('7');
      expect(addr.municipality).toBe('Kathmandu Metropolitan City');
      expect(addr.district).toBe('Kathmandu');
      expect(addr.province).toBe('Bagmati');
    });

    it('preserves Ed-Fi US-shaped fields alongside Nepal fields (mixed shape per A.0 ADR)', () => {
      const entity = makeStaff({
        addresses: [
          {
            addressTypeDescriptor: 'home',
            streetNumberName: '6600 McKinney Pkwy',
            city: 'McKinney',
            stateAbbreviationDescriptor: 'TX',
            postalCode: '76909',
            country: 'NPL',
            wardNumber: '12',
            district: 'Kathmandu',
            province: 'Bagmati',
          },
        ],
      });

      const dto = staffEntityToDto(entity) as any;
      const addr = dto.addresses[0];

      // Ed-Fi US-shape preserved
      expect(addr.streetNumberName).toBe('6600 McKinney Pkwy');
      expect(addr.city).toBe('McKinney');
      expect(addr.stateAbbreviationDescriptor).toBe('TX');
      expect(addr.postalCode).toBe('76909');
      // Nepal extension preserved
      expect(addr.wardNumber).toBe('12');
      expect(addr.district).toBe('Kathmandu');
      expect(addr.province).toBe('Bagmati');
    });

    it('leaves Nepal fields undefined when entity has US-only shape (GENERIC tenant backwards-compat)', () => {
      const entity = makeStaff({
        addresses: [
          {
            addressTypeDescriptor: 'home',
            streetNumberName: '6600 McKinney Pkwy',
            city: 'McKinney',
            stateAbbreviationDescriptor: 'TX',
            postalCode: '76909',
            country: 'US',
          },
        ],
      });

      const dto = staffEntityToDto(entity) as any;
      const addr = dto.addresses[0];

      expect(addr.wardNumber).toBeUndefined();
      expect(addr.municipality).toBeUndefined();
      expect(addr.district).toBeUndefined();
      expect(addr.province).toBeUndefined();
    });

    it('handles an addresses array with mixed Nepal-shaped and US-shaped entries', () => {
      const entity = makeStaff({
        addresses: [
          {
            addressTypeDescriptor: 'home',
            streetNumberName: 'Tole-7',
            wardNumber: '7',
            district: 'Kathmandu',
            province: 'Bagmati',
            country: 'NPL',
          },
          {
            addressTypeDescriptor: 'mailing',
            streetNumberName: '6600 McKinney Pkwy',
            city: 'McKinney',
            stateAbbreviationDescriptor: 'TX',
            postalCode: '76909',
            country: 'US',
          },
        ],
      });

      const dto = staffEntityToDto(entity) as any;

      expect(dto.addresses).toHaveLength(2);
      // First entry — Nepal shape
      expect(dto.addresses[0].district).toBe('Kathmandu');
      expect(dto.addresses[0].postalCode).toBeUndefined();
      // Second entry — US shape
      expect(dto.addresses[1].postalCode).toBe('76909');
      expect(dto.addresses[1].district).toBeUndefined();
    });
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

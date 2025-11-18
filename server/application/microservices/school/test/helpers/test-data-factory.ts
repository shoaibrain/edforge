import { v4 as uuid } from 'uuid';
import { School, AcademicYear, Department } from '../../src/schools/entities/school.entity.enhanced';

/**
 * Test data factory for School Service
 * Creates test entities with sensible defaults
 */

export function createTestSchool(overrides: Partial<School> = {}): School {
  const schoolId = uuid();
  return {
    tenantId: 'test-tenant-123',
    entityKey: `SCHOOL#${schoolId}`,
    entityType: 'SCHOOL',
    schoolId,
    schoolName: 'Test School',
    address: {
      street: '123 Test St',
      city: 'Test City',
      state: 'TS',
      zipCode: '12345',
      country: 'USA'
    },
    phone: '555-1234',
    email: 'test@school.com',
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: 'test-user',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test-user',
    version: 1,
    ...overrides
  };
}

export function createTestAcademicYear(overrides: Partial<AcademicYear> = {}): AcademicYear {
  const yearId = uuid();
  const schoolId = overrides.schoolId || uuid();
  return {
    tenantId: 'test-tenant-123',
    entityKey: `SCHOOL#${schoolId}#ACADEMIC_YEAR#${yearId}`,
    entityType: 'ACADEMIC_YEAR',
    schoolId,
    academicYearId: yearId,
    yearName: '2024-2025',
    startDate: '2024-09-01',
    endDate: '2025-06-30',
    status: 'active',
    isCurrent: true,
    createdAt: new Date().toISOString(),
    createdBy: 'test-user',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test-user',
    version: 1,
    ...overrides
  };
}

export function createTestDepartment(overrides: Partial<Department> = {}): Department {
  const departmentId = uuid();
  const schoolId = overrides.schoolId || uuid();
  return {
    tenantId: 'test-tenant-123',
    entityKey: `SCHOOL#${schoolId}#DEPARTMENT#${departmentId}`,
    entityType: 'DEPARTMENT',
    schoolId,
    departmentId,
    departmentName: 'Mathematics',
    description: 'Math Department',
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: 'test-user',
    updatedAt: new Date().toISOString(),
    updatedBy: 'test-user',
    version: 1,
    ...overrides
  };
}


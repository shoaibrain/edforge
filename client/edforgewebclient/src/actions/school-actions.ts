"use server";

/**
 * EdForge EMIS - School Server Actions
 * 
 * Server Actions for school, department, and academic year operations.
 * These actions run exclusively on the server and use api-server.ts for API calls.
 * 
 * Enterprise Architecture:
 * - Tokens fetched server-side from JWT (no client-side exposure)
 * - Uses serverApiClient which calls token-service internally
 * - No tokens cached in browser memory
 * - Works identically in localhost and production
 */

import serverApiClient from '@/lib/api-server';
import { getUserFriendlyMessage } from '@/lib/api-errors';
import type {
  School,
  Department,
  AcademicYear,
  GradingPeriod,
  Holiday,
  CreateSchoolRequest,
  CreateAcademicYearRequest,
  UpdateAcademicYearRequest,
  CreateDepartmentRequest,
  CreateGradingPeriodRequest,
  CreateHolidayRequest,
  SchoolListResponse,
  DepartmentListResponse,
  AcademicYearListResponse,
  GradingPeriodListResponse,
  HolidayListResponse,
} from '@edforge/shared-types';

// ============================================
// School Operations
// ============================================

/**
 * Fetch all schools for the tenant
 * Server Action: GET /schools
 */
export async function getSchoolsAction(): Promise<School[]> {
  try {
    const response = await serverApiClient.get<School[] | SchoolListResponse>('/schools');
    
    if (Array.isArray(response)) {
      return response as School[];
    }
    
    return (response as SchoolListResponse).schools || [];
  } catch (error) {
    console.error('[School Actions] Error fetching schools:', error);
    throw error;
  }
}

/**
 * Get primary/active school for tenant
 * Helper action that returns first active school or null
 * Server Action: GET /schools (filtered)
 */
export async function getPrimarySchoolAction(): Promise<School | null> {
  try {
    const schools = await getSchoolsAction();
    // Return first active school, or first school if no active school exists
    return schools.find(s => s.status === 'active') || schools[0] || null;
  } catch (error) {
    console.error('[School Actions] Error fetching primary school:', error);
    throw error;
  }
}

/**
 * Get a specific school by ID
 * Server Action: GET /schools/{schoolId}
 */
export async function getSchoolAction(schoolId: string): Promise<School> {
  try {
    const response = await serverApiClient.get<School>(`/schools/${schoolId}`);
    return response as School;
  } catch (error) {
    console.error('[School Actions] Error fetching school:', error);
    throw error;
  }
}

/**
 * Create a new school
 * Server Action: POST /schools
 * 
 * Uses shared types directly - no manual mapping needed.
 * Types match backend DTOs exactly.
 */
export async function createSchoolAction(schoolData: CreateSchoolRequest): Promise<School> {
  try {
    const response = await serverApiClient.post<School>('/schools', schoolData);
    return response as School;
  } catch (error) {
    console.error('[School Actions] Error creating school:', error);
    throw error;
  }
}

/**
 * Update an existing school
 * Server Action: PUT /schools/{schoolId}
 */
export async function updateSchoolAction(
  schoolId: string,
  schoolData: Partial<CreateSchoolRequest>
): Promise<School> {
  try {
    const response = await serverApiClient.put<School>(`/schools/${schoolId}`, schoolData);
    return response as School;
  } catch (error) {
    console.error('[School Actions] Error updating school:', error);
    throw error;
  }
}

/**
 * Delete a school
 * Server Action: DELETE /schools/{schoolId}
 */
export async function deleteSchoolAction(schoolId: string): Promise<void> {
  try {
    await serverApiClient.delete<void>(`/schools/${schoolId}`);
  } catch (error) {
    console.error('[School Actions] Error deleting school:', error);
    throw error;
  }
}

// ============================================
// Department Operations
// ============================================

/**
 * Get all departments for a school
 * Server Action: GET /schools/{schoolId}/departments
 */
export async function getDepartmentsAction(schoolId: string): Promise<Department[]> {
  try {
    const response = await serverApiClient.get<Department[] | DepartmentListResponse>(
      `/schools/${schoolId}/departments`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as DepartmentListResponse).departments || [];
  } catch (error) {
    console.error('[School Actions] Error fetching departments:', error);
    throw error;
  }
}

/**
 * Get a specific department by ID
 * Server Action: GET /schools/{schoolId}/departments/{departmentId}
 */
export async function getDepartmentAction(
  schoolId: string,
  departmentId: string
): Promise<Department> {
  try {
    const response = await serverApiClient.get<Department>(
      `/schools/${schoolId}/departments/${departmentId}`
    );
    return response as Department;
  } catch (error) {
    console.error('[School Actions] Error fetching department:', error);
    throw error;
  }
}

/**
 * Create a new department
 * Server Action: POST /schools/{schoolId}/departments
 */
export async function createDepartmentAction(
  schoolId: string,
  departmentData: CreateDepartmentRequest
): Promise<Department> {
  try {
    const response = await serverApiClient.post<Department>(
      `/schools/${schoolId}/departments`,
      departmentData
    );
    return response as Department;
  } catch (error) {
    console.error('[School Actions] Error creating department:', error);
    throw error;
  }
}

/**
 * Update an existing department
 * Server Action: PUT /schools/{schoolId}/departments/{departmentId}
 */
export async function updateDepartmentAction(
  schoolId: string,
  departmentId: string,
  departmentData: Partial<CreateDepartmentRequest>
): Promise<Department> {
  try {
    const response = await serverApiClient.put<Department>(
      `/schools/${schoolId}/departments/${departmentId}`,
      departmentData
    );
    return response as Department;
  } catch (error) {
    console.error('[School Actions] Error updating department:', error);
    throw error;
  }
}

/**
 * Delete a department
 * Server Action: DELETE /schools/{schoolId}/departments/{departmentId}
 */
export async function deleteDepartmentAction(
  schoolId: string,
  departmentId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(`/schools/${schoolId}/departments/${departmentId}`);
  } catch (error) {
    console.error('[School Actions] Error deleting department:', error);
    throw error;
  }
}

// ============================================
// Academic Year Operations
// ============================================

/**
 * Get all academic years for a school
 * Server Action: GET /schools/{schoolId}/academic-years
 */
export async function getAcademicYearsAction(schoolId: string): Promise<AcademicYear[]> {
  try {
    const response = await serverApiClient.get<AcademicYear[] | AcademicYearListResponse>(
      `/schools/${schoolId}/academic-years`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AcademicYearListResponse).academicYears || [];
  } catch (error) {
    console.error('[School Actions] Error fetching academic years:', error);
    throw error;
  }
}

/**
 * Get a specific academic year by ID
 * Server Action: GET /schools/{schoolId}/academic-years/{yearId}
 */
export async function getAcademicYearAction(
  schoolId: string,
  academicYearId: string
): Promise<AcademicYear> {
  try {
    const response = await serverApiClient.get<AcademicYear>(
      `/schools/${schoolId}/academic-years/${academicYearId}`
    );
    return response as AcademicYear;
  } catch (error) {
    console.error('[School Actions] Error fetching academic year:', error);
    throw error;
  }
}

/**
 * Create a new academic year
 * Server Action: POST /schools/{schoolId}/academic-years
 */
export async function createAcademicYearAction(
  schoolId: string,
  yearData: CreateAcademicYearRequest
): Promise<AcademicYear> {
  try {
    const response = await serverApiClient.post<AcademicYear>(
      `/schools/${schoolId}/academic-years`,
      yearData
    );
    return response as AcademicYear;
  } catch (error) {
    console.error('[School Actions] Error creating academic year:', error);
    throw error;
  }
}

/**
 * Update an existing academic year
 * Server Action: PUT /schools/{schoolId}/academic-years/{yearId}
 */
export async function updateAcademicYearAction(
  schoolId: string,
  academicYearId: string,
  yearData: UpdateAcademicYearRequest
): Promise<AcademicYear> {
  try {
    const response = await serverApiClient.put<AcademicYear>(
      `/schools/${schoolId}/academic-years/${academicYearId}`,
      yearData
    );
    return response as AcademicYear;
  } catch (error) {
    console.error('[School Actions] Error updating academic year:', error);
    throw error;
  }
}

/**
 * Get current academic year for a school
 * Helper action that filters academic years
 */
export async function getCurrentAcademicYearAction(
  schoolId: string
): Promise<AcademicYear | null> {
  try {
    const years = await getAcademicYearsAction(schoolId);
    return years.find(year => year.isCurrent) || null;
  } catch (error) {
    console.error('[School Actions] Error fetching current academic year:', error);
    throw error;
  }
}

// ============================================
// Grading Period Operations
// ============================================

/**
 * Get all grading periods for an academic year
 * Server Action: GET /schools/{schoolId}/academic-years/{yearId}/grading-periods
 */
export async function getGradingPeriodsAction(
  schoolId: string,
  academicYearId: string
): Promise<GradingPeriod[]> {
  try {
    const response = await serverApiClient.get<GradingPeriod[] | GradingPeriodListResponse>(
      `/schools/${schoolId}/academic-years/${academicYearId}/grading-periods`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradingPeriodListResponse).gradingPeriods || [];
  } catch (error) {
    console.error('[School Actions] Error fetching grading periods:', error);
    throw error;
  }
}

/**
 * Create a new grading period
 * Server Action: POST /schools/{schoolId}/academic-years/{yearId}/grading-periods
 * 
 * Uses shared types directly - no manual mapping needed.
 * Types match backend DTOs exactly.
 */
export async function createGradingPeriodAction(
  schoolId: string,
  academicYearId: string,
  periodData: CreateGradingPeriodRequest
): Promise<GradingPeriod> {
  try {
    const response = await serverApiClient.post<GradingPeriod>(
      `/schools/${schoolId}/academic-years/${academicYearId}/grading-periods`,
      periodData
    );
    return response as GradingPeriod;
  } catch (error) {
    console.error('[School Actions] Error creating grading period:', error);
    throw error;
  }
}

// ============================================
// Holiday Operations
// ============================================

/**
 * Get all holidays for an academic year
 * Server Action: GET /schools/{schoolId}/academic-years/{yearId}/holidays
 */
export async function getHolidaysAction(
  schoolId: string,
  academicYearId: string
): Promise<Holiday[]> {
  try {
    const response = await serverApiClient.get<Holiday[] | HolidayListResponse>(
      `/schools/${schoolId}/academic-years/${academicYearId}/holidays`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as HolidayListResponse).holidays || [];
  } catch (error) {
    console.error('[School Actions] Error fetching holidays:', error);
    throw error;
  }
}

/**
 * Create a new holiday
 * Server Action: POST /schools/{schoolId}/academic-years/{yearId}/holidays
 * 
 * Uses shared types directly - no manual mapping needed.
 * Types match backend DTOs exactly.
 */
export async function createHolidayAction(
  schoolId: string,
  academicYearId: string,
  holidayData: CreateHolidayRequest
): Promise<Holiday> {
  try {
    const response = await serverApiClient.post<Holiday>(
      `/schools/${schoolId}/academic-years/${academicYearId}/holidays`,
      holidayData
    );
    return response as Holiday;
  } catch (error) {
    console.error('[School Actions] Error creating holiday:', error);
    throw error;
  }
}


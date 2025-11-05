/**
 * EdForge EMIS - School Service
 * 
 * Service for school, department, academic year, and related operations
 * API Endpoints: /schools (base path), with nested resources
 * 
 * API Contract Reference: server/lib/tenant-api-prod.json
 */

import { BaseService } from './base-service';
import type {
  School,
  Department,
  AcademicYear,
  GradingPeriod,
  Holiday,
  CreateSchoolRequest,
  CreateAcademicYearRequest,
  CreateDepartmentRequest,
  SchoolListResponse,
  DepartmentListResponse,
  AcademicYearListResponse,
  GradingPeriodListResponse,
  HolidayListResponse,
} from '@edforge/shared-types';

export class SchoolService extends BaseService {
  constructor() {
    super('/schools'); // Fixed: API Gateway uses /schools (plural), not /school
  }

  // ============================================
  // School Operations
  // ============================================

  /**
   * Get all schools for the tenant
   * API: GET /schools
   */
  async getSchools(): Promise<School[]> {
    const response = await this.get(''); // Base path is already /schools
    
    if (Array.isArray(response)) {
      return response as School[];
    }
    
    return (response as SchoolListResponse).schools || [];
  }

  /**
   * Get a specific school by ID
   * API: GET /schools/{schoolId}
   */
  async getSchool(schoolId: string): Promise<School> {
    const response = await this.get(`/${schoolId}`);
    return response as School;
  }

  /**
   * Create a new school
   * API: POST /schools
   */
  async createSchool(schoolData: CreateSchoolRequest): Promise<School> {
    return await this.post<School>('', schoolData);
  }

  /**
   * Update an existing school
   * API: PUT /schools/{schoolId}
   */
  async updateSchool(schoolId: string, schoolData: Partial<CreateSchoolRequest>): Promise<School> {
    return await this.put<School>(`/${schoolId}`, schoolData);
  }

  /**
   * Delete a school
   * API: DELETE /schools/{schoolId}
   */
  async deleteSchool(schoolId: string): Promise<void> {
    await this.delete<void>(`/${schoolId}`);
  }

  // ============================================
  // School Configuration Operations
  // ============================================

  /**
   * Get school configuration
   * API: GET /schools/{schoolId}/configuration
   */
  async getSchoolConfiguration(schoolId: string): Promise<any> {
    return await this.get(`/${schoolId}/configuration`);
  }

  /**
   * Update school configuration
   * API: PUT /schools/{schoolId}/configuration
   */
  async updateSchoolConfiguration(schoolId: string, configData: any): Promise<any> {
    return await this.put(`/${schoolId}/configuration`, configData);
  }

  // ============================================
  // Department Operations
  // ============================================

  /**
   * Get all departments for a school
   * API: GET /schools/{schoolId}/departments
   */
  async getDepartments(schoolId: string): Promise<Department[]> {
    const response = await this.get<DepartmentListResponse | Department[]>(
      `/${schoolId}/departments`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as DepartmentListResponse).departments || [];
  }

  /**
   * Get a specific department by ID
   * API: GET /schools/{schoolId}/departments/{departmentId}
   */
  async getDepartment(schoolId: string, departmentId: string): Promise<Department> {
    return await this.get<Department>(`/${schoolId}/departments/${departmentId}`);
  }

  /**
   * Create a new department
   * API: POST /schools/{schoolId}/departments
   */
  async createDepartment(schoolId: string, departmentData: CreateDepartmentRequest): Promise<Department> {
    return await this.post<Department>(`/${schoolId}/departments`, departmentData);
  }

  /**
   * Update an existing department
   * API: PUT /schools/{schoolId}/departments/{departmentId}
   */
  async updateDepartment(
    schoolId: string,
    departmentId: string,
    departmentData: Partial<CreateDepartmentRequest>
  ): Promise<Department> {
    return await this.put<Department>(
      `/${schoolId}/departments/${departmentId}`,
      departmentData
    );
  }

  /**
   * Delete a department
   * API: DELETE /schools/{schoolId}/departments/{departmentId}
   */
  async deleteDepartment(schoolId: string, departmentId: string): Promise<void> {
    await this.delete<void>(`/${schoolId}/departments/${departmentId}`);
  }

  // ============================================
  // Academic Year Operations
  // ============================================

  /**
   * Get all academic years for a school
   * API: GET /schools/{schoolId}/academic-years
   */
  async getAcademicYears(schoolId: string): Promise<AcademicYear[]> {
    const response = await this.get<AcademicYearListResponse | AcademicYear[]>(
      `/${schoolId}/academic-years`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AcademicYearListResponse).academicYears || [];
  }

  /**
   * Get a specific academic year by ID
   * API: GET /schools/{schoolId}/academic-years/{yearId}
   */
  async getAcademicYear(schoolId: string, academicYearId: string): Promise<AcademicYear> {
    return await this.get<AcademicYear>(
      `/${schoolId}/academic-years/${academicYearId}`
    );
  }

  /**
   * Create a new academic year
   * API: POST /schools/{schoolId}/academic-years
   */
  async createAcademicYear(
    schoolId: string,
    yearData: CreateAcademicYearRequest
  ): Promise<AcademicYear> {
    return await this.post<AcademicYear>(
      `/${schoolId}/academic-years`,
      yearData
    );
  }

  /**
   * Update an existing academic year
   * API: PUT /schools/{schoolId}/academic-years/{yearId}
   */
  async updateAcademicYear(
    schoolId: string,
    academicYearId: string,
    yearData: Partial<CreateAcademicYearRequest>
  ): Promise<AcademicYear> {
    return await this.put<AcademicYear>(
      `/${schoolId}/academic-years/${academicYearId}`,
      yearData
    );
  }

  /**
   * Get current academic year for a school
   */
  async getCurrentAcademicYear(schoolId: string): Promise<AcademicYear | null> {
    const years = await this.getAcademicYears(schoolId);
    return years.find(year => year.isCurrent) || null;
  }

  // ============================================
  // Grading Period Operations
  // ============================================

  /**
   * Get all grading periods for an academic year
   * API: GET /schools/{schoolId}/academic-years/{yearId}/grading-periods
   */
  async getGradingPeriods(schoolId: string, academicYearId: string): Promise<GradingPeriod[]> {
    const response = await this.get<GradingPeriodListResponse | GradingPeriod[]>(
      `/${schoolId}/academic-years/${academicYearId}/grading-periods`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradingPeriodListResponse).gradingPeriods || [];
  }

  /**
   * Get a specific grading period by ID
   * API: GET /schools/{schoolId}/academic-years/{yearId}/grading-periods/{periodId}
   */
  async getGradingPeriod(
    schoolId: string,
    academicYearId: string,
    gradingPeriodId: string
  ): Promise<GradingPeriod> {
    return await this.get<GradingPeriod>(
      `/${schoolId}/academic-years/${academicYearId}/grading-periods/${gradingPeriodId}`
    );
  }

  /**
   * Create a new grading period
   * API: POST /schools/{schoolId}/academic-years/{yearId}/grading-periods
   */
  async createGradingPeriod(
    schoolId: string,
    academicYearId: string,
    periodData: Partial<GradingPeriod>
  ): Promise<GradingPeriod> {
    return await this.post<GradingPeriod>(
      `/${schoolId}/academic-years/${academicYearId}/grading-periods`,
      periodData
    );
  }

  // ============================================
  // Holiday Operations
  // ============================================

  /**
   * Get all holidays for an academic year
   * API: GET /schools/{schoolId}/academic-years/{yearId}/holidays
   */
  async getHolidays(schoolId: string, academicYearId: string): Promise<Holiday[]> {
    const response = await this.get<HolidayListResponse | Holiday[]>(
      `/${schoolId}/academic-years/${academicYearId}/holidays`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as HolidayListResponse).holidays || [];
  }

  /**
   * Get a specific holiday by ID
   * API: GET /schools/{schoolId}/academic-years/{yearId}/holidays/{holidayId}
   */
  async getHoliday(
    schoolId: string,
    academicYearId: string,
    holidayId: string
  ): Promise<Holiday> {
    return await this.get<Holiday>(
      `/${schoolId}/academic-years/${academicYearId}/holidays/${holidayId}`
    );
  }

  /**
   * Create a new holiday
   * API: POST /schools/{schoolId}/academic-years/{yearId}/holidays
   */
  async createHoliday(
    schoolId: string,
    academicYearId: string,
    holidayData: Partial<Holiday>
  ): Promise<Holiday> {
    return await this.post<Holiday>(
      `/${schoolId}/academic-years/${academicYearId}/holidays`,
      holidayData
    );
  }
}

// Export singleton instances
export const schoolService = new SchoolService(); // Client-side
// Server-side service: import { serverSchoolService } from '@/services/school-service-server'


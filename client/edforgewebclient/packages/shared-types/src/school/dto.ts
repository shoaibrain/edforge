/**
 * School Service Request/Response DTOs
 * 
 * These interfaces are extracted from NestJS DTO classes in:
 * server/application/microservices/school/src/schools/dto/school.dto.ts
 * 
 * Validation rules are documented in JSDoc comments.
 * Source of truth: NestJS DTO classes with class-validator decorators.
 */

/**
 * Contact Information Request
 * @validation - primaryEmail: required, valid email format
 * @validation - primaryPhone: required, string (E.164 format: +1-555-0123)
 * @validation - secondaryPhone: optional, string
 * @validation - website: optional, string (validated URL format)
 * @validation - fax: optional, string
 */
export interface ContactInfoRequest {
  primaryEmail: string;
  primaryPhone: string;
  secondaryPhone?: string;
  website?: string;
  fax?: string;
}

/**
 * Address Request
 * @validation - street: required, string (1-200 chars)
 * @validation - city: required, string (1-100 chars)
 * @validation - state: required, string (1-100 chars)
 * @validation - country: required, string (2 chars, ISO 3166-1 alpha-2: US, CA, GB)
 * @validation - postalCode: required, string (1-20 chars)
 * @validation - latitude: optional, number
 * @validation - longitude: optional, number
 * @validation - timezone: required, string (IANA timezone: America/New_York)
 */
export interface AddressRequest {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
}

/**
 * Grade Range Request
 * @validation - lowestGrade: required, string (e.g., "K", "1", "2")
 * @validation - highestGrade: required, string (e.g., "5", "8", "12")
 */
export interface GradeRangeRequest {
  lowestGrade: string;
  highestGrade: string;
}

/**
 * Academic Structure Request
 * @validation - semesterCount: required, number (1-4)
 * @validation - gradingPeriodCount: required, number (1-12)
 * @validation - instructionalDays: required, number (30-365)
 * @validation - schoolDays: required, number (30-365)
 */
export interface AcademicStructureRequest {
  semesterCount: number;
  gradingPeriodCount: number;
  instructionalDays: number;
  schoolDays: number;
}

/**
 * Create School Request
 * @validation - schoolName: required, string (3-255 chars)
 * @validation - schoolCode: required, string (3-50 chars), unique within tenant
 * @validation - schoolType: required, enum ['elementary', 'middle', 'high', 'k12', 'alternative', 'special']
 * @validation - contactInfo: required, ContactInfoRequest
 * @validation - address: required, AddressRequest
 * @validation - maxStudentCapacity: required, number (1-50000)
 * @validation - gradeRange: required, GradeRangeRequest
 * @validation - principalUserId: optional, string
 * @validation - vicePrincipalUserIds: optional, string[]
 * @validation - foundedDate: optional, string (ISO date)
 * @validation - description: optional, string
 * @validation - motto: optional, string
 * @validation - logoUrl: optional, string
 */
export interface CreateSchoolRequest {
  schoolName: string;
  schoolCode: string;
  schoolType: 'elementary' | 'middle' | 'high' | 'k12' | 'alternative' | 'special';
  contactInfo: ContactInfoRequest;
  address: AddressRequest;
  maxStudentCapacity: number;
  gradeRange: GradeRangeRequest;
  principalUserId?: string;
  vicePrincipalUserIds?: string[];
  foundedDate?: string;
  description?: string;
  motto?: string;
  logoUrl?: string;
}

/**
 * Update School Request
 * @validation - All fields optional except version
 * @validation - schoolName: optional, string (3-255 chars)
 * @validation - contactInfo: optional, ContactInfoRequest
 * @validation - address: optional, AddressRequest
 * @validation - maxStudentCapacity: optional, number (1-50000)
 * @validation - principalUserId: optional, string
 * @validation - description: optional, string
 * @validation - status: optional, enum ['active', 'inactive', 'suspended', 'closed']
 * @validation - statusReason: optional, string
 * @validation - version: required, number (for optimistic locking)
 */
export interface UpdateSchoolRequest {
  schoolName?: string;
  contactInfo?: ContactInfoRequest;
  address?: AddressRequest;
  maxStudentCapacity?: number;
  principalUserId?: string;
  description?: string;
  status?: 'active' | 'inactive' | 'suspended' | 'closed';
  statusReason?: string;
  version: number;
}

/**
 * Create Academic Year Request
 * @validation - yearName: required, string (3-100 chars, e.g., "2024-2025")
 * @validation - yearCode: required, string (2-20 chars, e.g., "AY24")
 * @validation - startDate: required, string (ISO date: YYYY-MM-DD)
 * @validation - endDate: required, string (ISO date: YYYY-MM-DD)
 * @validation - isCurrent: optional, boolean
 * @validation - structure: optional, AcademicStructureRequest
 */
export interface CreateAcademicYearRequest {
  yearName: string;
  yearCode: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  structure?: AcademicStructureRequest;
}

/**
 * Update Academic Year Request
 * @validation - All fields optional except version (if provided)
 * @validation - yearName: optional, string (3-100 chars)
 * @validation - yearCode: optional, string (2-20 chars)
 * @validation - startDate: optional, string (ISO date: YYYY-MM-DD)
 * @validation - endDate: optional, string (ISO date: YYYY-MM-DD)
 * @validation - status: optional, enum ['planned', 'active', 'completed', 'archived']
 * @validation - isCurrent: optional, boolean
 * @validation - structure: optional, AcademicStructureRequest
 * @validation - version: optional, number (required for optimistic locking if provided)
 */
export interface UpdateAcademicYearRequest {
  yearName?: string;
  yearCode?: string;
  startDate?: string;
  endDate?: string;
  status?: 'planned' | 'active' | 'completed' | 'archived';
  isCurrent?: boolean;
  structure?: AcademicStructureRequest;
  version?: number;
}

/**
 * Create Grading Period Request
 * @validation - periodName: required, string (e.g., "Fall Semester", "Q1")
 * @validation - periodType: required, enum ['semester', 'quarter', 'trimester', 'custom']
 * @validation - periodNumber: required, number (min: 1)
 * @validation - startDate: required, string (YYYY-MM-DD)
 * @validation - endDate: required, string (YYYY-MM-DD)
 * @validation - isCurrent: optional, boolean
 * @validation - instructionalDays: optional, number
 * @validation - gradesDueDate: optional, string (YYYY-MM-DD)
 * @validation - reportCardDate: optional, string (YYYY-MM-DD)
 */
export interface CreateGradingPeriodRequest {
  periodName: string;
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';
  periodNumber: number;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
  instructionalDays?: number;
  gradesDueDate?: string;
  reportCardDate?: string;
}

/**
 * Create Holiday Request
 * @validation - name: required, string (e.g., "Thanksgiving Break")
 * @validation - type: required, enum ['holiday', 'professional_day', 'weather_closure', 'emergency']
 * @validation - startDate: required, string (YYYY-MM-DD)
 * @validation - endDate: required, string (YYYY-MM-DD)
 * @validation - allDay: optional, boolean
 * @validation - description: optional, string
 * @validation - isRecurring: optional, boolean
 * @validation - affectsAttendance: optional, boolean
 * @validation - affectsPayroll: optional, boolean
 */
export interface CreateHolidayRequest {
  name: string;
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency';
  startDate: string;
  endDate: string;
  allDay?: boolean;
  description?: string;
  isRecurring?: boolean;
  affectsAttendance?: boolean;
  affectsPayroll?: boolean;
}

/**
 * Create Department Request
 * @validation - departmentName: required, string (2-100 chars)
 * @validation - departmentCode: required, string (2-20 chars), unique within school
 * @validation - category: required, enum ['academic', 'administrative', 'support', 'athletic']
 * @validation - headOfDepartmentUserId: optional, string
 * @validation - description: optional, string
 */
export interface CreateDepartmentRequest {
  departmentName: string;
  departmentCode: string;
  category: 'academic' | 'administrative' | 'support' | 'athletic';
  headOfDepartmentUserId?: string;
  description?: string;
}

/** 
 * Update Department Request
 * @validation - All fields optional except version (if provided)
 * @validation - departmentName: optional, string (2-100 chars)
 * @validation - departmentCode: optional, string (2-20 chars)
 * @validation - category: optional, enum ['academic', 'administrative', 'support', 'athletic']
 * @validation - headOfDepartmentUserId: optional, string
 * @validation - description: optional, string
 * @validation - version: optional, number (required for optimistic locking if provided)
 */
export interface UpdateDepartmentRequest {
  departmentName?: string;
  departmentCode?: string;
  category?: 'academic' | 'administrative' | 'support' | 'athletic';
  headOfDepartmentUserId?: string;
  description?: string;
  version?: number;
}  
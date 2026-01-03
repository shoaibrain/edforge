/**
 * Course Entity for Academics Service (Curriculum)
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: COURSE#{schoolId}#{courseId}
 * 
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: COURSE#{departmentId}#{courseName}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';

/**
 * Course entity - represents a course in the curriculum
 */
export interface Course extends BaseEntity {
  entityType: 'COURSE';
  
  // Identity
  courseId: string;
  courseCode: string;  // e.g., 'MATH101'
  courseName: string;
  
  // School reference
  schoolId: string;
  
  // Department
  departmentId?: string;
  departmentName?: string;
  
  // Description
  description?: string;
  objectives?: string[];
  
  // Grade levels this course is offered for
  gradeLevels: string[];
  
  // Credits
  credits: number;
  creditType?: 'academic' | 'elective' | 'honors' | 'ap' | 'ib';
  
  // Subject area
  subjectArea: SubjectArea;
  
  // Course type
  courseType: 'required' | 'elective' | 'enrichment' | 'remedial';
  
  // Prerequisites
  prerequisites?: string[];  // Course IDs
  corequisites?: string[];
  
  // Scheduling
  typicalDuration: 'semester' | 'year' | 'quarter' | 'trimester';
  periodsPerWeek?: number;
  
  // Status
  isActive: boolean;
  academicYearId?: string;  // If course is year-specific
  
  // Standards alignment
  standards?: CourseStandard[];
  
  // Materials
  textbooks?: CourseMaterial[];
  
  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // COURSE#{departmentId}#{courseName}
}

/**
 * Subject area enumeration
 */
export type SubjectArea = 
  | 'mathematics'
  | 'english_language_arts'
  | 'science'
  | 'social_studies'
  | 'world_languages'
  | 'arts'
  | 'physical_education'
  | 'technology'
  | 'business'
  | 'vocational'
  | 'other';

/**
 * Course standard alignment
 */
export interface CourseStandard {
  standardId: string;
  standardCode: string;
  standardName: string;
  framework: string;  // e.g., 'Common Core', 'NGSS', 'State Standard'
}

/**
 * Course material/textbook
 */
export interface CourseMaterial {
  materialId: string;
  type: 'textbook' | 'workbook' | 'digital' | 'other';
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  edition?: string;
  isRequired: boolean;
}

/**
 * Course section - instance of a course with specific teacher and schedule
 */
export interface CourseSection {
  sectionId: string;
  courseId: string;
  schoolId: string;
  academicYearId: string;
  termId?: string;
  
  // Section details
  sectionNumber: string;  // e.g., '001', '002'
  sectionName?: string;
  
  // Teacher
  primaryTeacherId: string;
  coTeacherIds?: string[];
  
  // Schedule
  scheduleId?: string;
  roomId?: string;
  
  // Enrollment
  maxEnrollment: number;
  currentEnrollment: number;
  
  // Status
  isActive: boolean;
}

/**
 * Create a new Course entity with proper keys
 */
export function createCourseEntity(
  tenantId: string,
  courseId: string,
  schoolId: string,
  data: Omit<Course, 'tenantId' | 'entityKey' | 'entityType' | 'courseId' | 'schoolId' | 'gsi1pk' | 'gsi1sk'>
): Course {
  const departmentId = data.departmentId || 'general';
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.course(schoolId, courseId),
    entityType: 'COURSE',
    courseId,
    schoolId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `COURSE#${departmentId}#${data.courseName.toUpperCase()}`,
    ...data,
  };
}


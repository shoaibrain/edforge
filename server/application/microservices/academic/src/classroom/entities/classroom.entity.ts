/*
 * Classroom Entity - Represents a class/course in the academic system
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}
 * 
 * GSI1: schoolId#academicYearId -> List all classrooms in a school/year
 * GSI2: teacherId#academicYearId -> List all classrooms for a teacher
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string;      // Discriminator for entity type
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface Classroom extends BaseEntity {
  entityType: 'CLASSROOM';  // Literal type for type safety
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  
  // Classroom details
  name: string;                    // e.g., "Math 101 - Section A"
  code: string;                    // e.g., "MATH101-A"
  subject: string;                 // e.g., "Mathematics"
  grade: string;                   // e.g., "10th Grade"
  section?: string;                // e.g., "A", "B"
  
  // Teacher and schedule
  teacherId: string;               // Primary teacher
  coTeacherIds?: string[];         // Additional teachers
  room?: string;                   // e.g., "Room 205"
  capacity?: number;               // Max students
  
  // Timing
  schedule: ClassSchedule[];       // When class meets
  
  // Enrollment
  enrolledStudentIds: string[];    // Students in this class
  enrollmentCount: number;
  
  // Status
  status: 'active' | 'inactive' | 'archived';
  
  // GSI keys
  gsi1pk: string;                  // schoolId#academicYearId
  gsi1sk: string;                  // CLASSROOM#{classroomId}
  gsi2pk: string;                  // teacherId#academicYearId
  gsi2sk: string;                  // CLASSROOM#{classroomId}
}

export interface ClassSchedule {
  dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  startTime: string;               // HH:MM format
  endTime: string;                 // HH:MM format
  periodNumber?: number;           // e.g., Period 1, 2, 3
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
}

export class EntityKeyBuilder {
  static classroom(schoolId: string, academicYearId: string, classroomId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}`;
  }
}


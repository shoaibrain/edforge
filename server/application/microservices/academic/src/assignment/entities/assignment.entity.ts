/*
 * Assignment Entity - Represents homework, projects, tasks assigned to students
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}#ASSIGNMENT#{assignmentId}
 * 
 * GSI1: classroomId#academicYearId -> List all assignments for a classroom
 * GSI2: teacherId#academicYearId -> List all assignments created by a teacher
 * GSI3: studentId#academicYearId -> List all assignments for a student (via enrollment)
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

export interface Assignment extends BaseEntity {
  entityType: 'ASSIGNMENT';  // Literal type for type safety
  assignmentId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  
  // Assignment details
  title: string;
  description?: string;
  instructions?: string;
  
  // Type and category
  type: 'homework' | 'project' | 'quiz' | 'test' | 'lab' | 'presentation' | 'other';
  category?: string;                // Custom category
  
  // Dates
  assignedDate: string;              // When assigned
  dueDate: string;                   // When due
  availableFrom?: string;            // Optional: When students can start
  availableUntil?: string;           // Optional: Hard deadline (no late submissions)
  
  // Grading
  maxPoints: number;
  weight?: number;                   // Percentage weight in final grade (0-100)
  passingScore?: number;             // Minimum score to pass
  
  // Settings
  allowLateSubmission: boolean;
  lateSubmissionPenalty?: number;    // Percentage penalty per day
  attachments?: AssignmentAttachment[];
  
  // Status
  status: 'draft' | 'published' | 'archived';
  publishedAt?: string;
  
  // Teacher
  createdByTeacherId: string;
  
  // GSI keys
  gsi1pk: string;                    // classroomId#academicYearId
  gsi1sk: string;                    // ASSIGNMENT#{assignmentId}
  gsi2pk: string;                    // teacherId#academicYearId
  gsi2sk: string;                    // ASSIGNMENT#{assignmentId}
}

export interface AssignmentAttachment {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
}

export class EntityKeyBuilder {
  static assignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#ASSIGNMENT#${assignmentId}`;
  }
}


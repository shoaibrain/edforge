/**
 * EdForge EMIS - Academic Service
 * 
 * Service for academic operations: classrooms, assignments, grades, attendance
 * API Endpoints: /academic/schools/{schoolId}/academic-years/{yearId}/...
 * 
 * API Contract Reference: server/lib/tenant-api-prod.json
 */

import { BaseService } from './base-service';
import type {
  Classroom,
  Assignment,
  Grade,
  Attendance,
  StudentEnrollment,
  CreateClassroomRequest,
  UpdateClassroomRequest,
  CreateAssignmentRequest,
  UpdateAssignmentRequest,
  CreateGradeRequest,
  UpdateGradeRequest,
  MarkAttendanceRequest,
  EnrollStudentRequest,
  ClassroomListResponse,
  AssignmentListResponse,
  GradeListResponse,
  AttendanceListResponse,
  EnrollmentListResponse,
} from '@/types/academic';

export class AcademicService extends BaseService {
  constructor() {
    super('/academic');
  }

  // ============================================
  // Classroom Operations
  // ============================================

  /**
   * Get all classrooms for a school and academic year
   */
  async getClassrooms(schoolId: string, academicYearId: string): Promise<Classroom[]> {
    const response = await this.get(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms`
    );
    
    if (Array.isArray(response)) {
      return response as Classroom[];
    }
    
    return (response as ClassroomListResponse).classrooms || [];
  }

  /**
   * Get a specific classroom by ID
   */
  async getClassroom(
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<Classroom> {
    const response = await this.get(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`
    );
    return response as Classroom;
  }

  /**
   * Create a new classroom
   */
  async createClassroom(
    schoolId: string,
    academicYearId: string,
    classroomData: CreateClassroomRequest
  ): Promise<Classroom> {
    return await this.post<Classroom>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms`,
      classroomData
    );
  }

  /**
   * Update an existing classroom
   */
  async updateClassroom(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    classroomData: UpdateClassroomRequest
  ): Promise<Classroom> {
    return await this.put<Classroom>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`,
      classroomData
    );
  }

  /**
   * Delete a classroom
   */
  async deleteClassroom(
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<void> {
    await this.delete<void>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`
    );
  }

  /**
   * Enroll a student in a classroom
   */
  async enrollStudent(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    enrollmentData: EnrollStudentRequest
  ): Promise<StudentEnrollment> {
    return await this.post<StudentEnrollment>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students`,
      enrollmentData
    );
  }

  /**
   * Remove a student from a classroom
   */
  async removeStudent(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string
  ): Promise<void> {
    await this.delete<void>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students/${studentId}`
    );
  }

  /**
   * Get all enrolled students for a classroom
   */
  async getClassroomEnrollments(
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<StudentEnrollment[]> {
    const response = await this.get<EnrollmentListResponse | StudentEnrollment[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as EnrollmentListResponse).enrollments || [];
  }

  // ============================================
  // Assignment Operations
  // ============================================

  /**
   * Get all assignments for a classroom
   */
  async getAssignments(
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<Assignment[]> {
    const response = await this.get<AssignmentListResponse | Assignment[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AssignmentListResponse).assignments || [];
  }

  /**
   * Get a specific assignment by ID
   */
  async getAssignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string
  ): Promise<Assignment> {
    return await this.get<Assignment>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`
    );
  }

  /**
   * Create a new assignment
   */
  async createAssignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentData: CreateAssignmentRequest
  ): Promise<Assignment> {
    return await this.post<Assignment>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments`,
      assignmentData
    );
  }

  /**
   * Update an existing assignment
   */
  async updateAssignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string,
    assignmentData: UpdateAssignmentRequest
  ): Promise<Assignment> {
    return await this.put<Assignment>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`,
      assignmentData
    );
  }

  /**
   * Delete an assignment
   */
  async deleteAssignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string
  ): Promise<void> {
    await this.delete<void>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`
    );
  }

  // ============================================
  // Grade Operations
  // ============================================

  /**
   * Get all grades for a classroom
   */
  async getGrades(
    schoolId: string,
    academicYearId: string,
    classroomId: string
  ): Promise<Grade[]> {
    const response = await this.get<GradeListResponse | Grade[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradeListResponse).grades || [];
  }

  /**
   * Get grades for a specific student in a classroom
   */
  async getStudentGrades(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string
  ): Promise<Grade[]> {
    const response = await this.get<GradeListResponse | Grade[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades`,
      { studentId }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradeListResponse).grades || [];
  }

  /**
   * Create a new grade entry
   */
  async createGrade(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    gradeData: CreateGradeRequest
  ): Promise<Grade> {
    return await this.post<Grade>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades`,
      gradeData
    );
  }

  /**
   * Update an existing grade
   */
  async updateGrade(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    gradeId: string,
    gradeData: UpdateGradeRequest
  ): Promise<Grade> {
    return await this.put<Grade>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades/${gradeId}`,
      gradeData
    );
  }

  /**
   * Delete a grade entry
   */
  async deleteGrade(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    gradeId: string
  ): Promise<void> {
    await this.delete<void>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades/${gradeId}`
    );
  }

  // ============================================
  // Attendance Operations
  // ============================================

  /**
   * Get all attendance records for a classroom
   */
  async getAttendance(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    date?: string
  ): Promise<Attendance[]> {
    const params = date ? { date } : undefined;
    const response = await this.get<AttendanceListResponse | Attendance[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance`,
      params
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AttendanceListResponse).attendanceRecords || [];
  }

  /**
   * Get attendance for a specific student
   */
  async getStudentAttendance(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    studentId: string
  ): Promise<Attendance[]> {
    const response = await this.get<AttendanceListResponse | Attendance[]>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance`,
      { studentId }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AttendanceListResponse).attendanceRecords || [];
  }

  /**
   * Mark attendance for a student
   */
  async markAttendance(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    attendanceData: MarkAttendanceRequest
  ): Promise<Attendance> {
    return await this.post<Attendance>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance`,
      attendanceData
    );
  }

  /**
   * Update an attendance record
   */
  async updateAttendance(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    attendanceId: string,
    attendanceData: Partial<MarkAttendanceRequest>
  ): Promise<Attendance> {
    return await this.put<Attendance>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance/${attendanceId}`,
      attendanceData
    );
  }

  /**
   * Delete an attendance record
   */
  async deleteAttendance(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    attendanceId: string
  ): Promise<void> {
    await this.delete<void>(
      `/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance/${attendanceId}`
    );
  }
}

// Export singleton instances
export const academicService = new AcademicService(); // Client-side
// Server-side service: import { serverAcademicService } from '@/services/academic-service-server'


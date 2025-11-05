"use server";

/**
 * EdForge EMIS - Academic Server Actions
 * 
 * Server Actions for academic operations: classrooms, assignments, grades, attendance.
 * These actions run exclusively on the server and use api-server.ts for API calls.
 * 
 * Enterprise Architecture:
 * - Tokens fetched server-side from JWT (no client-side exposure)
 * - Uses serverApiClient which calls token-service internally
 * - No tokens cached in browser memory
 * - Works identically in localhost and production
 */

import serverApiClient from '@/lib/api-server';
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

// ============================================
// Classroom Operations
// ============================================

/**
 * Get all classrooms for a school and academic year
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms
 */
export async function getClassroomsAction(
  schoolId: string,
  academicYearId: string
): Promise<Classroom[]> {
  try {
    const response = await serverApiClient.get<Classroom[] | ClassroomListResponse>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms`
    );
    
    if (Array.isArray(response)) {
      return response as Classroom[];
    }
    
    return (response as ClassroomListResponse).classrooms || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching classrooms:', error);
    throw error;
  }
}

/**
 * Get a specific classroom by ID
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}
 */
export async function getClassroomAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string
): Promise<Classroom> {
  try {
    const response = await serverApiClient.get<Classroom>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`
    );
    return response as Classroom;
  } catch (error) {
    console.error('[Academic Actions] Error fetching classroom:', error);
    throw error;
  }
}

/**
 * Create a new classroom
 * Server Action: POST /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms
 */
export async function createClassroomAction(
  schoolId: string,
  academicYearId: string,
  classroomData: CreateClassroomRequest
): Promise<Classroom> {
  try {
    const response = await serverApiClient.post<Classroom>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms`,
      classroomData
    );
    return response as Classroom;
  } catch (error) {
    console.error('[Academic Actions] Error creating classroom:', error);
    throw error;
  }
}

/**
 * Update an existing classroom
 * Server Action: PUT /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}
 */
export async function updateClassroomAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  classroomData: UpdateClassroomRequest
): Promise<Classroom> {
  try {
    const response = await serverApiClient.put<Classroom>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`,
      classroomData
    );
    return response as Classroom;
  } catch (error) {
    console.error('[Academic Actions] Error updating classroom:', error);
    throw error;
  }
}

/**
 * Delete a classroom
 * Server Action: DELETE /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}
 */
export async function deleteClassroomAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}`
    );
  } catch (error) {
    console.error('[Academic Actions] Error deleting classroom:', error);
    throw error;
  }
}

/**
 * Enroll a student in a classroom
 * Server Action: POST /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students
 */
export async function enrollStudentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  enrollmentData: EnrollStudentRequest
): Promise<StudentEnrollment> {
  try {
    const response = await serverApiClient.post<StudentEnrollment>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students`,
      enrollmentData
    );
    return response as StudentEnrollment;
  } catch (error) {
    console.error('[Academic Actions] Error enrolling student:', error);
    throw error;
  }
}

/**
 * Remove a student from a classroom
 * Server Action: DELETE /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students/{studentId}
 */
export async function removeStudentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  studentId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students/${studentId}`
    );
  } catch (error) {
    console.error('[Academic Actions] Error removing student:', error);
    throw error;
  }
}

/**
 * Get all enrolled students for a classroom
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students
 */
export async function getClassroomEnrollmentsAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string
): Promise<StudentEnrollment[]> {
  try {
    const response = await serverApiClient.get<EnrollmentListResponse | StudentEnrollment[]>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/students`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as EnrollmentListResponse).enrollments || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching enrollments:', error);
    throw error;
  }
}

// ============================================
// Assignment Operations
// ============================================

/**
 * Get all assignments for a classroom
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments
 */
export async function getAssignmentsAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string
): Promise<Assignment[]> {
  try {
    const response = await serverApiClient.get<Assignment[] | AssignmentListResponse>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AssignmentListResponse).assignments || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching assignments:', error);
    throw error;
  }
}

/**
 * Get a specific assignment by ID
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}
 */
export async function getAssignmentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  assignmentId: string
): Promise<Assignment> {
  try {
    const response = await serverApiClient.get<Assignment>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`
    );
    return response as Assignment;
  } catch (error) {
    console.error('[Academic Actions] Error fetching assignment:', error);
    throw error;
  }
}

/**
 * Create a new assignment
 * Server Action: POST /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments
 */
export async function createAssignmentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  assignmentData: CreateAssignmentRequest
): Promise<Assignment> {
  try {
    const response = await serverApiClient.post<Assignment>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments`,
      assignmentData
    );
    return response as Assignment;
  } catch (error) {
    console.error('[Academic Actions] Error creating assignment:', error);
    throw error;
  }
}

/**
 * Update an existing assignment
 * Server Action: PUT /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}
 */
export async function updateAssignmentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  assignmentId: string,
  assignmentData: UpdateAssignmentRequest
): Promise<Assignment> {
  try {
    const response = await serverApiClient.put<Assignment>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`,
      assignmentData
    );
    return response as Assignment;
  } catch (error) {
    console.error('[Academic Actions] Error updating assignment:', error);
    throw error;
  }
}

/**
 * Delete an assignment
 * Server Action: DELETE /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}
 */
export async function deleteAssignmentAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  assignmentId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/assignments/${assignmentId}`
    );
  } catch (error) {
    console.error('[Academic Actions] Error deleting assignment:', error);
    throw error;
  }
}

// ============================================
// Grade Operations
// ============================================

/**
 * Get all grades for a classroom
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades
 */
export async function getGradesAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string
): Promise<Grade[]> {
  try {
    const response = await serverApiClient.get<Grade[] | GradeListResponse>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradeListResponse).grades || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching grades:', error);
    throw error;
  }
}

/**
 * Get grades for a specific student in a classroom
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades?studentId={studentId}
 */
export async function getStudentGradesAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  studentId: string
): Promise<Grade[]> {
  try {
    const url = `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades?studentId=${studentId}`;
    const response = await serverApiClient.get<Grade[] | GradeListResponse>(url);
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as GradeListResponse).grades || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching student grades:', error);
    throw error;
  }
}

/**
 * Create a new grade entry
 * Server Action: POST /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades
 */
export async function createGradeAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  gradeData: CreateGradeRequest
): Promise<Grade> {
  try {
    const response = await serverApiClient.post<Grade>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades`,
      gradeData
    );
    return response as Grade;
  } catch (error) {
    console.error('[Academic Actions] Error creating grade:', error);
    throw error;
  }
}

/**
 * Update an existing grade
 * Server Action: PUT /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/{gradeId}
 */
export async function updateGradeAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  gradeId: string,
  gradeData: UpdateGradeRequest
): Promise<Grade> {
  try {
    const response = await serverApiClient.put<Grade>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades/${gradeId}`,
      gradeData
    );
    return response as Grade;
  } catch (error) {
    console.error('[Academic Actions] Error updating grade:', error);
    throw error;
  }
}

/**
 * Delete a grade entry
 * Server Action: DELETE /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/{gradeId}
 */
export async function deleteGradeAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  gradeId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/grades/${gradeId}`
    );
  } catch (error) {
    console.error('[Academic Actions] Error deleting grade:', error);
    throw error;
  }
}

// ============================================
// Attendance Operations
// ============================================

/**
 * Get all attendance records for a classroom
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance
 */
export async function getAttendanceAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  date?: string
): Promise<Attendance[]> {
  try {
    let url = `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance`;
    if (date) {
      url += `?date=${encodeURIComponent(date)}`;
    }
    
    const response = await serverApiClient.get<Attendance[] | AttendanceListResponse>(url);
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AttendanceListResponse).attendanceRecords || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching attendance:', error);
    throw error;
  }
}

/**
 * Get attendance for a specific student
 * Server Action: GET /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance?studentId={studentId}
 */
export async function getStudentAttendanceAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  studentId: string
): Promise<Attendance[]> {
  try {
    const url = `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance?studentId=${studentId}`;
    const response = await serverApiClient.get<Attendance[] | AttendanceListResponse>(url);
    
    if (Array.isArray(response)) {
      return response;
    }
    
    return (response as AttendanceListResponse).attendanceRecords || [];
  } catch (error) {
    console.error('[Academic Actions] Error fetching student attendance:', error);
    throw error;
  }
}

/**
 * Mark attendance for a student
 * Server Action: POST /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance
 */
export async function markAttendanceAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  attendanceData: MarkAttendanceRequest
): Promise<Attendance> {
  try {
    const response = await serverApiClient.post<Attendance>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance`,
      attendanceData
    );
    return response as Attendance;
  } catch (error) {
    console.error('[Academic Actions] Error marking attendance:', error);
    throw error;
  }
}

/**
 * Update an attendance record
 * Server Action: PUT /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/{attendanceId}
 */
export async function updateAttendanceAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  attendanceId: string,
  attendanceData: Partial<MarkAttendanceRequest>
): Promise<Attendance> {
  try {
    const response = await serverApiClient.put<Attendance>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance/${attendanceId}`,
      attendanceData
    );
    return response as Attendance;
  } catch (error) {
    console.error('[Academic Actions] Error updating attendance:', error);
    throw error;
  }
}

/**
 * Delete an attendance record
 * Server Action: DELETE /academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/{attendanceId}
 */
export async function deleteAttendanceAction(
  schoolId: string,
  academicYearId: string,
  classroomId: string,
  attendanceId: string
): Promise<void> {
  try {
    await serverApiClient.delete<void>(
      `/academic/schools/${schoolId}/academic-years/${academicYearId}/classrooms/${classroomId}/attendance/${attendanceId}`
    );
  } catch (error) {
    console.error('[Academic Actions] Error deleting attendance:', error);
    throw error;
  }
}


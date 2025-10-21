# EdForge Academic API Reference

**Version**: 1.0  
**Base URL**: `https://your-api-gateway.execute-api.region.amazonaws.com/prod`  
**Authentication**: Bearer JWT Token (AWS Cognito)

---

## Overview

The Academic API provides comprehensive classroom management, assignment tracking, grading, attendance monitoring, and classroom stream functionality for EdForge EMIS platform.

**Key Features**:
- ✅ Multi-tenant architecture with tenant isolation
- ✅ Optimistic locking for concurrent updates
- ✅ Standardized error codes for client handling
- ✅ Analytics and reporting capabilities
- ✅ RESTful design following best practices

---

## Authentication

All endpoints (except health check) require JWT authentication.

**Header**:
```
Authorization: Bearer <jwt_token>
tenantPath: <tenant_identifier>
```

**Error Response Format**:
```json
{
  "errorCode": "ENROLLMENT_2001",
  "message": "Student xyz is already enrolled in classroom abc",
  "details": {
    "studentId": "xyz",
    "classroomId": "abc"
  },
  "timestamp": "2025-10-21T12:00:00.000Z"
}
```

---

## Classroom Management

### Create Classroom
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms`

Creates a new classroom for an academic year.

**Request Body**:
```json
{
  "code": "MATH-101-A",
  "name": "Algebra I - Period 3",
  "subject": "Mathematics",
  "grade": "9",
  "section": "A",
  "primaryTeacherId": "teacher-uuid-123",
  "coTeacherIds": [],
  "room": "Room 205",
  "capacity": 30,
  "schedule": [
    {
      "dayOfWeek": "Monday",
      "startTime": "09:00",
      "endTime": "10:30",
      "location": "Room 205"
    }
  ],
  "status": "active"
}
```

**Response** (201 Created):
```json
{
  "classroomId": "classroom-uuid",
  "code": "MATH-101-A",
  "name": "Algebra I - Period 3",
  "enrollmentCount": 0,
  "capacity": 30,
  "status": "active",
  "createdAt": "2025-10-21T12:00:00.000Z",
  "version": 1
}
```

**Error Codes**:
- `CLASSROOM_1004` - Classroom code already exists
- `GENERAL_9001` - Validation failed

---

### Get Classrooms
**GET** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms`

List all classrooms for a school/academic year.

**Query Parameters**:
- `status` (optional): Filter by status (active, inactive, archived)
- `teacherId` (optional): Filter by teacher
- `grade` (optional): Filter by grade level

**Response** (200 OK):
```json
[
  {
    "classroomId": "classroom-uuid",
    "code": "MATH-101-A",
    "name": "Algebra I - Period 3",
    "enrollmentCount": 25,
    "capacity": 30,
    "status": "active"
  }
]
```

---

### Get Classroom by ID
**GET** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}`

**Response** (200 OK):
```json
{
  "classroomId": "classroom-uuid",
  "code": "MATH-101-A",
  "name": "Algebra I - Period 3",
  "enrolledStudentIds": ["student-1", "student-2"],
  "enrollmentCount": 2,
  "schedule": [...],
  "version": 3
}
```

**Error Codes**:
- `CLASSROOM_1001` - Classroom not found

---

### Update Classroom
**PUT** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}`

Updates classroom details. Supports optimistic locking via version field.

**Request Body**:
```json
{
  "name": "Algebra I - Period 4",
  "capacity": 35,
  "version": 3
}
```

**Response** (200 OK): Updated classroom object

**Error Codes**:
- `CLASSROOM_1001` - Classroom not found
- `GENERAL_9002` - Concurrent modification (version mismatch)
- `CLASSROOM_1002` - Cannot reduce capacity below enrollment count

---

### Enroll Student
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students`

Enrolls a student in a classroom.

**Request Body**:
```json
{
  "studentId": "student-uuid-123"
}
```

**Response** (200 OK): Updated classroom with new student

**Error Codes**:
- `ENROLLMENT_2001` - Student already enrolled
- `CLASSROOM_1002` - Classroom at capacity
- `CLASSROOM_1005` - Classroom is inactive
- `CLASSROOM_1006` - Classroom is archived

---

### Unenroll Student
**DELETE** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students/{studentId}`

Removes a student from a classroom.

**Response** (200 OK): Updated classroom

**Error Codes**:
- `ENROLLMENT_2002` - Student not enrolled in classroom

---

## Assignment Management

### Create Assignment
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments`

**Request Body**:
```json
{
  "title": "Chapter 3 Homework",
  "description": "Complete exercises 1-20",
  "instructions": "Show all work. Due by end of class.",
  "type": "homework",
  "assignedDate": "2025-10-21",
  "dueDate": "2025-10-25",
  "maxPoints": 100,
  "passingScore": 60,
  "weight": 10,
  "allowLateSubmission": true,
  "lateSubmissionPenalty": 10,
  "attachments": []
}
```

**Response** (201 Created): Assignment object

**Error Codes**:
- `ASSIGNMENT_3003` - Invalid dates (due before assigned)
- `GENERAL_9001` - Validation failed

---

### Publish Assignment
**PUT** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}/publish`

Publishes a draft assignment to students.

**Response** (200 OK): Published assignment

**Error Codes**:
- `ASSIGNMENT_3002` - Assignment already published
- `GENERAL_9001` - Missing required fields for publishing

---

### Archive Assignment
**PUT** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}/archive`

Archives an assignment (removes from active list).

**Response** (200 OK): Archived assignment

---

## Grading

### Create Grade
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades`

Records a grade for a student's assignment.

**Request Body**:
```json
{
  "studentId": "student-uuid",
  "assignmentId": "assignment-uuid",
  "score": 85,
  "maxPoints": 100,
  "feedback": "Good work! Review section 3.4.",
  "status": "published",
  "isFinal": true
}
```

**Response** (201 Created):
```json
{
  "gradeId": "grade-uuid",
  "studentId": "student-uuid",
  "assignmentId": "assignment-uuid",
  "score": 85,
  "maxPoints": 100,
  "percentage": 85,
  "letterGrade": "B",
  "gradePoints": 3.0,
  "feedback": "Good work!",
  "gradedAt": "2025-10-21T12:00:00.000Z",
  "version": 1
}
```

**Error Codes**:
- `GRADE_4002` - Grade already exists for this student/assignment
- `GRADE_4006` - Score exceeds max points
- `GRADE_4005` - Concurrent modification

---

## Attendance

### Record Attendance
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance`

**Request Body**:
```json
{
  "studentId": "student-uuid",
  "date": "2025-10-21",
  "status": "present",
  "checkInTime": "08:30",
  "checkOutTime": "15:00",
  "notes": "On time"
}
```

**Status Values**:
- `present` - Student attended
- `absent` - Student was absent
- `late` - Student was late
- `excused` - Excused absence
- `unexcused_absent` - Unexcused absence

**Response** (201 Created): Attendance record

**Error Codes**:
- `ATTENDANCE_5002` - Attendance already recorded for this date
- `ATTENDANCE_5004` - Cannot record future attendance

---

### Get Student Attendance Summary
**GET** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/students/{studentId}/summary`

Provides comprehensive attendance analytics for a student.

**Query Parameters**:
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

**Response** (200 OK):
```json
{
  "studentId": "student-uuid",
  "academicYearId": "year-uuid",
  "totalDays": 120,
  "presentDays": 110,
  "absentDays": 8,
  "lateDays": 2,
  "excusedDays": 5,
  "unexcusedAbsentDays": 3,
  "attendanceRate": 93.33,
  "latenessRate": 1.67,
  "trend": "stable",
  "riskLevel": "medium",
  "isChronicAbsentee": false,
  "daysAbsentThisMonth": 2,
  "daysAbsentThisYear": 8,
  "recommendations": [
    "Monitor attendance patterns",
    "3 unexcused absences this year - may require disciplinary action"
  ],
  "interventionRequired": false,
  "parentNotificationRequired": true,
  "patternDescription": "Good attendance. 2 present, 0 absent in last 7 days"
}
```

**Risk Levels**:
- `low` - Attendance ≥95% (Excellent)
- `medium` - Attendance 90-94% (Monitor)
- `high` - Attendance 85-89% (Parent conference needed)
- `critical` - Attendance <85% (Immediate intervention)

---

## Classroom Stream

### Create Stream Post
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts`

Creates a post in the classroom stream (like Google Classroom).

**Request Body**:
```json
{
  "content": "Welcome to Algebra I! Please review Chapter 1 before Monday.",
  "postType": "announcement",
  "isPinned": true,
  "attachments": []
}
```

**Post Types**:
- `announcement` - Teacher announcements
- `question` - Student questions
- `material` - Learning materials
- `assignment_created` - Auto-generated when assignment created
- `grade_posted` - Auto-generated when grades released
- `general` - General posts

**Response** (201 Created): Stream post object

---

### Get Stream Posts
**GET** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts`

**Query Parameters**:
- `postType` (optional): Filter by post type
- `isPinned` (optional): Filter pinned posts

**Response** (200 OK): Array of stream posts

---

### Pin/Unpin Post
**PUT** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}/pin`

Toggles pin status for a post (pinned posts appear at top).

**Response** (200 OK): Updated post

---

### Add Comment to Post
**POST** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}/comments`

**Request Body**:
```json
{
  "content": "Can we get an extension on this assignment?"
}
```

**Response** (201 Created): Comment object

---

## Common HTTP Status Codes

| Code | Description | Usage |
|------|-------------|-------|
| 200 | OK | Successful GET/PUT/DELETE |
| 201 | Created | Successful POST |
| 400 | Bad Request | Validation failed |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource or concurrent modification |
| 500 | Internal Server Error | Unexpected server error |

---

## Error Code Reference

### Classroom Errors (1xxx)
- `CLASSROOM_1001` - Classroom not found
- `CLASSROOM_1002` - Classroom at capacity
- `CLASSROOM_1003` - Invalid schedule
- `CLASSROOM_1004` - Classroom code duplicate
- `CLASSROOM_1005` - Classroom inactive
- `CLASSROOM_1006` - Classroom archived

### Enrollment Errors (2xxx)
- `ENROLLMENT_2001` - Student already enrolled
- `ENROLLMENT_2002` - Student not enrolled
- `ENROLLMENT_2003` - Student not found
- `ENROLLMENT_2004` - Capacity exceeded

### Assignment Errors (3xxx)
- `ASSIGNMENT_3001` - Assignment not found
- `ASSIGNMENT_3002` - Assignment already published
- `ASSIGNMENT_3003` - Invalid dates
- `ASSIGNMENT_3004` - File size exceeds limit

### Grading Errors (4xxx)
- `GRADE_4001` - Grade not found
- `GRADE_4002` - Grade already exists
- `GRADE_4003` - Invalid score
- `GRADE_4004` - Grading scale not found
- `GRADE_4005` - Concurrent modification

### Attendance Errors (5xxx)
- `ATTENDANCE_5001` - Attendance not found
- `ATTENDANCE_5002` - Attendance already recorded
- `ATTENDANCE_5003` - Invalid date
- `ATTENDANCE_5004` - Future date not allowed

### General Errors (9xxx)
- `GENERAL_9001` - Validation failed
- `GENERAL_9002` - Concurrent modification
- `GENERAL_9003` - Unauthorized access
- `GENERAL_9999` - Internal error

---

## Best Practices

### 1. Optimistic Locking
For UPDATE operations, always include the `version` field:

```json
{
  "name": "Updated Name",
  "version": 3
}
```

If concurrent modification occurs (HTTP 409), refresh the resource and retry.

### 2. Error Handling
Always check `errorCode` field for programmatic error handling:

```typescript
try {
  await enrollStudent(studentId, classroomId);
} catch (error) {
  if (error.errorCode === 'ENROLLMENT_2001') {
    // Handle already enrolled
  } else if (error.errorCode === 'CLASSROOM_1002') {
    // Handle capacity exceeded
  }
}
```

### 3. Pagination
For large datasets, use query parameters:
- `limit` - Number of results per page (default: 50, max: 100)
- `lastKey` - Token for next page (provided in response)

### 4. Date Formats
Always use ISO 8601 format:
- Dates: `YYYY-MM-DD`
- DateTime: `YYYY-MM-DDTHH:mm:ss.sssZ`
- Time: `HH:MM` (24-hour format)

---

## Rate Limits

**Current Limits** (per tenant):
- 100 requests per second
- 10,000 requests per minute
- Burst capacity: 200 requests

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1634567890
```

---

## Analytics & Reporting

### Attendance Analytics
The attendance summary endpoint provides:
- **Attendance rate** - Percentage of days present
- **Chronic absenteeism detection** - 10%+ absence rate
- **Trend analysis** - Improving/declining/stable
- **Risk assessment** - Low/medium/high/critical
- **Intervention recommendations** - Data-driven suggestions

### GPA Calculations (Coming Soon)
- Unweighted GPA (standard 4.0 scale)
- Weighted GPA (honors/AP courses)
- Term/semester GPA
- Cumulative GPA
- Class rank and percentiles

---

## Support

For API support:
- Email: api-support@edforge.net
- Documentation: https://docs.edforge.net
- Status Page: https://status.edforge.net

---

**Last Updated**: October 2025  
**API Version**: 1.0.0


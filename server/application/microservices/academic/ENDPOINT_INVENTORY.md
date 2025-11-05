# Academic Service Endpoint Inventory

**Generated:** 2025-01-21  
**Total Endpoints:** 36  
**Controllers:** 5 (Classroom, Assignment, Grading, Attendance, Stream)  
**Health Endpoint:** 1 (separate from main controllers)

---

## 1. ClassroomController (7 endpoints)

**Base Path:** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms`

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 1 | POST | `/` | Create a new classroom | ✅ In API Gateway |
| 2 | GET | `/` | Get all classrooms for school/year | ✅ In API Gateway |
| 3 | GET | `/{classroomId}` | Get classroom by ID | ✅ In API Gateway |
| 4 | PUT | `/{classroomId}` | Update classroom | ✅ In API Gateway |
| 5 | POST | `/{classroomId}/students` | Enroll student in classroom | ✅ In API Gateway |
| 6 | DELETE | `/{classroomId}/students/{studentId}` | Unenroll student from classroom | ✅ In API Gateway |
| 7 | GET | `/teachers/{teacherId}` | Get classrooms by teacher | ❌ **MISSING** |

---

## 2. AssignmentController (7 endpoints)

**Base Path:** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments`

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 8 | POST | `/` | Create a new assignment | ✅ In API Gateway |
| 9 | GET | `/` | Get all assignments for classroom | ✅ In API Gateway |
| 10 | GET | `/{assignmentId}` | Get assignment by ID | ❌ **MISSING** |
| 11 | PUT | `/{assignmentId}` | Update assignment | ❌ **MISSING** |
| 12 | PUT | `/{assignmentId}/publish` | Publish assignment | ❌ **MISSING** |
| 13 | PUT | `/{assignmentId}/archive` | Archive assignment | ❌ **MISSING** |
| 14 | GET | `/teachers/{teacherId}` | Get assignments by teacher | ❌ **MISSING** |

---

## 3. GradingController (7 endpoints)

**Base Path:** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades`

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 15 | POST | `/` | Create a new grade | ✅ In API Gateway |
| 16 | GET | `/` | Get all grades for classroom | ✅ In API Gateway |
| 17 | GET | `/students/{studentId}/assignments/{assignmentId}` | Get grade for student/assignment | ❌ **MISSING** |
| 18 | PUT | `/students/{studentId}/assignments/{assignmentId}` | Update grade | ❌ **MISSING** |
| 19 | PUT | `/students/{studentId}/assignments/{assignmentId}/publish` | Publish grade | ❌ **MISSING** |
| 20 | GET | `/students/{studentId}` | Get grades by student | ❌ **MISSING** |
| 21 | GET | `/students/{studentId}/course-grade` | Calculate course grade for student | ❌ **MISSING** |

---

## 4. AttendanceController (7 endpoints)

**Base Path:** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance`

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 22 | POST | `/` | Create attendance record | ✅ In API Gateway |
| 23 | GET | `/dates/{date}` | Get attendance by date | ❌ **MISSING** |
| 24 | GET | `/dates/{date}/students/{studentId}` | Get attendance for student on date | ❌ **MISSING** |
| 25 | PUT | `/dates/{date}/students/{studentId}` | Update attendance for student on date | ❌ **MISSING** |
| 26 | POST | `/bulk` | Create bulk attendance records | ❌ **MISSING** |
| 27 | GET | `/students/{studentId}` | Get attendance by student | ❌ **MISSING** |
| 28 | GET | `/students/{studentId}/summary` | Get attendance summary for student | ❌ **MISSING** |

---

## 5. StreamController (8 endpoints)

**Base Path:** `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream`

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 29 | POST | `/posts` | Create a new stream post | ✅ In API Gateway |
| 30 | GET | `/posts` | Get stream posts for classroom | ✅ In API Gateway |
| 31 | GET | `/posts/{postId}` | Get specific stream post | ✅ In API Gateway |
| 32 | PUT | `/posts/{postId}` | Update stream post | ❌ **MISSING** |
| 33 | DELETE | `/posts/{postId}` | Delete stream post | ❌ **MISSING** |
| 34 | PUT | `/posts/{postId}/pin` | Pin/unpin stream post | ✅ In API Gateway |
| 35 | POST | `/posts/{postId}/comments` | Create comment on post | ✅ In API Gateway |
| 36 | GET | `/posts/{postId}/comments` | Get comments for post | ✅ In API Gateway |

---

## 6. HealthController (1 endpoint)

| # | Method | Path | Description | Status |
|---|--------|------|-------------|--------|
| 37 | GET | `/academic/health` | Health check endpoint | ✅ In API Gateway |

---

## Summary

- **Total Endpoints:** 36 (main controllers) + 1 (health) = 37
- **Endpoints in API Gateway:** 15
- **Missing Endpoints:** 21

### Missing Endpoints by Controller:
- **ClassroomController:** 1 missing
- **AssignmentController:** 5 missing
- **GradingController:** 6 missing
- **AttendanceController:** 6 missing
- **StreamController:** 2 missing

---

## Next Steps

1. Add all 21 missing endpoints to `server/lib/tenant-api-prod.json`
2. Ensure all endpoints have:
   - Proper CORS configuration
   - OPTIONS handler for preflight requests
   - Security definitions (JWT authentication)
   - Correct path parameter mappings
   - Proper integration URI templates


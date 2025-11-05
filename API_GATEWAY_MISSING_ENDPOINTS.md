# API Gateway Missing Endpoints Analysis

**Last Updated**: 2025-11-04  
**Purpose**: Identify missing endpoints in API Gateway configuration compared to microservice controllers

## Summary

This document compares the endpoints available in microservice controllers with the endpoints configured in `tenant-api-prod.json` (API Gateway). It identifies gaps and provides recommendations for implementation.

---

## School Microservice

### Controller Endpoints (`schools.controller.ts`)
- ✅ GET `/schools` - List schools
- ✅ POST `/schools` - Create school
- ✅ GET `/schools/:schoolId` - Get school
- ✅ PUT `/schools/:schoolId` - Update school
- ✅ DELETE `/schools/:schoolId` - Delete school
- ✅ GET `/schools/:schoolId/departments` - List departments
- ✅ POST `/schools/:schoolId/departments` - Create department
- ✅ GET `/schools/:schoolId/academic-years` - List academic years
- ✅ POST `/schools/:schoolId/academic-years` - Create academic year
- ✅ GET `/schools/:schoolId/academic-years/current` - **RECENTLY ADDED** ✅
- ✅ GET `/schools/:schoolId/academic-years/:yearId` - Get academic year
- ✅ PUT `/schools/:schoolId/academic-years/:yearId` - Update academic year
- ✅ GET `/schools/:schoolId/academic-years/:yearId/grading-periods` - **RECENTLY ADDED** ✅
- ✅ POST `/schools/:schoolId/academic-years/:yearId/grading-periods` - **RECENTLY ADDED** ✅
- ✅ GET `/schools/:schoolId/academic-years/:yearId/holidays` - **RECENTLY ADDED** ✅
- ✅ POST `/schools/:schoolId/academic-years/:yearId/holidays` - **RECENTLY ADDED** ✅
- ⚠️ PUT `/schools/:schoolId/academic-years/:yearId/set-current` - Set current academic year (not in API Gateway)
- ⚠️ PUT `/schools/:schoolId/academic-years/:yearId/status` - Update academic year status (not in API Gateway)
- ⚠️ GET `/schools/:schoolId/configuration` - Get school configuration (not in API Gateway)
- ⚠️ POST `/schools/:schoolId/configuration` - Update school configuration (not in API Gateway)
- ⚠️ POST `/schools/:schoolId/reports` - Generate school reports (not in API Gateway)

### Status: **Mostly Complete** ✅
**Priority**: Low - Most critical endpoints are implemented. Configuration and reporting endpoints are not urgent.

---

## User Microservice

### Controller Endpoints (`users.controller.ts`)
- ✅ GET `/users` - List users (in API Gateway)
- ✅ POST `/users` - Create user (in API Gateway)
- ❌ GET `/users/:id` - Get user by ID (NOT in API Gateway)
- ❌ PUT `/users/:id` - Update user (NOT in API Gateway)
- ❌ DELETE `/users/:id` - Delete user (NOT in API Gateway)
- ✅ GET `/users/health` - Health check (in API Gateway)

### Status: **Partially Complete** ⚠️
**Priority**: Medium - Individual user operations (GET, PUT, DELETE by ID) are missing but may not be needed for current frontend features.

**Note**: Frontend has been updated to disable user detail/edit functionality since these endpoints are not available.

---

## Academic Microservice

### Classroom Endpoints (`classroom.controller.ts`)
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms` - List classrooms
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms` - Create classroom
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}` - Get classroom
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}` - Update classroom
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students` - Enroll student
- ✅ DELETE `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/students/{studentId}` - Unenroll student
- ⚠️ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/teachers/{teacherId}` - Get teacher's classrooms (verify in API Gateway)

### Assignment Endpoints (`assignment.controller.ts`)
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments` - List assignments
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments` - Create assignment
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}` - Get assignment
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}` - Update assignment
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}/publish` - Publish assignment
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/{assignmentId}/archive` - Archive assignment
- ⚠️ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/assignments/teachers/{teacherId}` - Get teacher's assignments (verify in API Gateway)

### Grading Endpoints (`grading.controller.ts`)
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades` - Create/update grade
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades` - List grades
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/students/{studentId}/assignments/{assignmentId}` - Get grade
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/students/{studentId}/assignments/{assignmentId}` - Update grade
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/students/{studentId}/assignments/{assignmentId}/publish` - Publish grade
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/students/{studentId}` - Get student's grades
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/grades/students/{studentId}/course-grade` - Get course grade

### Attendance Endpoints (`attendance.controller.ts`)
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance` - Create attendance record
- ✅ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/bulk` - Bulk create attendance
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/dates/{date}` - Get attendance for date
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/dates/{date}/students/{studentId}` - Get student attendance for date
- ✅ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/dates/{date}/students/{studentId}` - Update attendance
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/students/{studentId}/summary` - Get attendance summary
- ✅ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/attendance/students/{studentId}` - Get student attendance history

### Stream Endpoints (`stream.controller.ts`)
- ⚠️ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts` - Create post (verify in API Gateway)
- ⚠️ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts` - List posts (verify in API Gateway)
- ⚠️ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}` - Get post (verify in API Gateway)
- ⚠️ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}` - Update post (verify in API Gateway)
- ⚠️ DELETE `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}` - Delete post (verify in API Gateway)
- ⚠️ PUT `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}/pin` - Pin post (verify in API Gateway)
- ⚠️ POST `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}/comments` - Create comment (verify in API Gateway)
- ⚠️ GET `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}/stream/posts/{postId}/comments` - List comments (verify in API Gateway)

### Health Check
- ✅ GET `/academic/health` - Health check (in API Gateway)

### Status: **Mostly Complete** ✅
**Priority**: Medium - Stream endpoints need verification. Other endpoints appear to be implemented.

---

## Implementation Recommendations

### Priority 1: High Priority (Critical for Frontend Features)
1. **Verify Stream Endpoints** - Check if all stream endpoints are in API Gateway
2. **User GET/PUT/DELETE by ID** - Only if needed for user management features (currently disabled in frontend)

### Priority 2: Medium Priority (Nice to Have)
1. **School Configuration Endpoints** - For grading/attendance settings (currently showing "not implemented" message)
2. **Academic Year Status Management** - Set current year, update status endpoints
3. **Teacher-Scoped Queries** - GET classrooms/assignments by teacherId (verify if in API Gateway)

### Priority 3: Low Priority (Future Enhancements)
1. **School Reports** - POST `/schools/{schoolId}/reports`
2. **Grading Period/Holiday Updates** - PUT/DELETE endpoints for grading periods and holidays (if needed)

---

## Next Steps

1. **Verify Stream Endpoints**: Check `tenant-api-prod.json` for stream endpoints
2. **Test Endpoints**: Verify all endpoints marked as "in API Gateway" are actually accessible
3. **Document Missing Endpoints**: Add missing endpoints to API Gateway if needed for frontend features
4. **Update Frontend**: Enable features once endpoints are available

---

## Notes

- ✅ = Endpoint exists in API Gateway
- ❌ = Endpoint NOT in API Gateway
- ⚠️ = Endpoint needs verification
- **RECENTLY ADDED** = Endpoints added in recent API Gateway update

All endpoints require JWT authentication via Lambda Authorizer and use VPC Link for backend communication.


# 🧪 **EdForge Academic Service - API Testing Guide**

## 📋 **Overview**

This comprehensive testing guide covers all Academic Service APIs with proper payloads, error handling validation, and logical testing sequences for EdForge's multi-tenant Education Management Information System.

**Base URL**: `https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod`

---

## 🔐 **Authentication Setup**

### **Step 1: Get JWT Token**
```bash
# Replace with your actual credentials
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@edforge.com",
    "password": "your-password"
  }'
```

**Expected Response**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### **Step 2: Set Environment Variables**
```bash
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
export TENANT_ID="your-tenant-id"
export SCHOOL_ID="school-123"
export ACADEMIC_YEAR_ID="year-2024"
export CLASSROOM_ID="class-456"
export STUDENT_ID="student-789"
export TEACHER_ID="teacher-101"
```

---

## 🏥 **Health Check Tests**

### **Test 1: Academic Service Health**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/health \
  -H "Content-Type: application/json"
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "classroom": "healthy",
    "assignment": "healthy", 
    "grading": "healthy",
    "attendance": "healthy",
    "stream": "healthy"
  }
}
```

---

## 🏫 **School Service Prerequisites**

### **Test 2: Create School (if not exists)**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/schools \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "EdForge Test School",
    "code": "EFTS-001",
    "address": {
      "street": "123 Education St",
      "city": "Test City",
      "state": "TC",
      "zipCode": "12345",
      "country": "USA"
    },
    "contact": {
      "email": "admin@efts.edu",
      "phone": "+1-555-0123"
    },
    "settings": {
      "timezone": "America/New_York",
      "language": "en",
      "currency": "USD"
    }
  }'
```

### **Test 3: Create Academic Year**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/schools/$SCHOOL_ID/academic-years \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "2024-2025 Academic Year",
    "startDate": "2024-09-01",
    "endDate": "2025-06-30",
    "isActive": true,
    "description": "Main academic year for testing"
  }'
```

---

## 🏛️ **Classroom Module Tests**

### **Test 4: Create Classroom**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "Mathematics 101",
    "code": "MATH-101-A",
    "subject": "Mathematics",
    "grade": "9",
    "section": "A",
    "teacherId": "'$TEACHER_ID'",
    "coTeacherIds": [],
    "room": "Room 201",
    "capacity": 30,
    "schedule": [
      {
        "dayOfWeek": "MON",
        "startTime": "09:00",
        "endTime": "10:00",
        "periodNumber": 1
      },
      {
        "dayOfWeek": "WED",
        "startTime": "09:00", 
        "endTime": "10:00",
        "periodNumber": 1
      },
      {
        "dayOfWeek": "FRI",
        "startTime": "09:00",
        "endTime": "10:00", 
        "periodNumber": 1
      }
    ],
    "status": "active"
  }'
```

**Expected Response**:
```json
{
  "classroomId": "class-456",
  "name": "Mathematics 101",
  "code": "MATH-101-A",
  "subject": "Mathematics",
  "grade": "9",
  "section": "A",
  "teacherId": "teacher-101",
  "coTeacherIds": [],
  "room": "Room 201",
  "capacity": 30,
  "schedule": [...],
  "enrolledStudentIds": [],
  "enrollmentCount": 0,
  "status": "active",
  "createdAt": "2024-01-15T10:30:00Z",
  "createdBy": "teacher-101"
}
```

### **Test 5: Get Classroom**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 6: Update Classroom**
```bash
curl -X PUT https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "Advanced Mathematics 101",
    "room": "Room 301",
    "capacity": 25
  }'
```

### **Test 7: Enroll Student**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/enroll \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "studentId": "'$STUDENT_ID'"
  }'
```

---

## 📝 **Assignment Module Tests**

### **Test 8: Create Assignment**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/assignments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "title": "Algebra Fundamentals Quiz",
    "description": "Test your understanding of basic algebraic concepts",
    "instructions": "Solve all problems showing your work. No calculators allowed.",
    "type": "quiz",
    "category": "Assessment",
    "assignedDate": "2024-01-15",
    "dueDate": "2024-01-22T23:59:59Z",
    "availableFrom": "2024-01-15T00:00:00Z",
    "availableUntil": "2024-01-22T23:59:59Z",
    "maxPoints": 100,
    "weight": 0.15,
    "passingScore": 70,
    "allowLateSubmission": true,
    "lateSubmissionPenalty": 10,
    "attachments": [
      {
        "fileName": "quiz-instructions.pdf",
        "fileUrl": "https://s3.amazonaws.com/edforge-assignments/quiz-instructions.pdf",
        "fileType": "application/pdf",
        "fileSize": 1024000
      }
    ],
    "status": "published"
  }'
```

### **Test 9: Get Assignments by Classroom**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/assignments \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 10: Update Assignment**
```bash
curl -X PUT https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/assignments/{assignmentId} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "title": "Algebra Fundamentals Quiz - Updated",
    "maxPoints": 120,
    "dueDate": "2024-01-25T23:59:59Z"
  }'
```

---

## 📊 **Grading Module Tests**

### **Test 11: Create Grade**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/grades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "assignmentId": "assignment-123",
    "studentId": "'$STUDENT_ID'",
    "termId": "term-semester-1",
    "score": 85,
    "maxPoints": 100,
    "categoryId": "category-homework",
    "categoryName": "Homework",
    "categoryWeight": 0.3,
    "gradedAt": "2024-01-20T14:30:00Z",
    "isLate": false,
    "penaltyApplied": 0,
    "feedback": "Good work! Show more steps in problem solving.",
    "rubricScores": [
      {
        "criteriaName": "Problem Solving",
        "maxPoints": 40,
        "pointsEarned": 35,
        "feedback": "Good approach, minor calculation errors"
      },
      {
        "criteriaName": "Work Shown",
        "maxPoints": 30,
        "pointsEarned": 25,
        "feedback": "Show more intermediate steps"
      }
    ],
    "status": "published",
    "isExcused": false,
    "isFinal": false,
    "canRetake": true,
    "retakeCount": 0
  }'
```

### **Test 12: Get Grades by Classroom**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/grades \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 13: Get Grade by Student**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/grades?studentId=$STUDENT_ID \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 📅 **Attendance Module Tests**

### **Test 14: Create Attendance Record**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/attendance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "studentId": "'$STUDENT_ID'",
    "date": "2024-01-15",
    "status": "present",
    "checkInTime": "2024-01-15T09:00:00Z",
    "checkOutTime": "2024-01-15T10:00:00Z",
    "minutesLate": 0,
    "duration": 60,
    "expectedDuration": 60,
    "periodId": "period-1",
    "periodNumber": 1,
    "recordedByTeacherId": "'$TEACHER_ID'",
    "recordedAt": "2024-01-15T09:05:00Z",
    "notes": "Student arrived on time",
    "parentNotified": false,
    "documentationRequired": false
  }'
```

### **Test 15: Get Attendance by Date**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/attendance?date=2024-01-15 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 16: Update Attendance**
```bash
curl -X PUT https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/attendance/{attendanceId} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "status": "tardy",
    "minutesLate": 15,
    "notes": "Student arrived 15 minutes late due to traffic"
  }'
```

---

## 💬 **Stream Module Tests**

### **Test 17: Create Stream Post**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "content": "Welcome to Mathematics 101! Please review the syllabus and prepare for our first quiz next week.",
    "postType": "announcement",
    "isPinned": true,
    "attachments": [
      {
        "fileName": "syllabus.pdf",
        "fileUrl": "https://s3.amazonaws.com/edforge-stream/syllabus.pdf",
        "fileType": "application/pdf",
        "fileSize": 2048000
      }
    ],
    "allowComments": true,
    "isPublic": true
  }'
```

### **Test 18: Get Stream Posts**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/stream \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 19: Create Comment**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/stream/{postId}/comments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "content": "Thank you for the syllabus! When is the first quiz scheduled?",
    "parentCommentId": null
  }'
```

---

## ❌ **Error Handling Tests**

### **Test 20: Invalid JWT Token**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/health \
  -H "Authorization: Bearer invalid-token"
```

**Expected Response**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### **Test 21: Missing Required Fields**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "name": "Test Classroom"
    // Missing required fields: code, subject, grade, teacherId
  }'
```

**Expected Response**:
```json
{
  "statusCode": 400,
  "message": [
    "code should not be empty",
    "subject should not be empty", 
    "grade should not be empty",
    "teacherId should not be empty"
  ],
  "error": "Bad Request"
}
```

### **Test 22: Invalid Data Types**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/assignments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "title": "Test Assignment",
    "maxPoints": "not-a-number",
    "dueDate": "invalid-date"
  }'
```

### **Test 23: Non-existent Resource**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/non-existent/academic-years/$ACADEMIC_YEAR_ID/classrooms \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response**:
```json
{
  "statusCode": 404,
  "message": "School not found",
  "error": "Not Found"
}
```

---

## 🔄 **Bulk Operations Tests**

### **Test 24: Bulk Grade Creation**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/grades/bulk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "grades": [
      {
        "studentId": "student-001",
        "assignmentId": "assignment-123",
        "score": 85,
        "maxPoints": 100,
        "categoryId": "category-homework"
      },
      {
        "studentId": "student-002", 
        "assignmentId": "assignment-123",
        "score": 92,
        "maxPoints": 100,
        "categoryId": "category-homework"
      }
    ]
  }'
```

### **Test 25: Bulk Attendance Creation**
```bash
curl -X POST https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/attendance/bulk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "date": "2024-01-15",
    "records": [
      {
        "studentId": "student-001",
        "status": "present",
        "checkInTime": "2024-01-15T09:00:00Z"
      },
      {
        "studentId": "student-002",
        "status": "absent",
        "notes": "Sick leave"
      }
    ]
  }'
```

---

## 📈 **Analytics and Reporting Tests**

### **Test 26: Grade Analytics**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/grades/analytics \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### **Test 27: Attendance Analytics**
```bash
curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/schools/$SCHOOL_ID/academic-years/$ACADEMIC_YEAR_ID/classrooms/$CLASSROOM_ID/attendance/analytics \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 🧪 **Load Testing Script**

### **Test 28: Concurrent Requests**
```bash
#!/bin/bash
# Load test script for academic service

for i in {1..10}; do
  curl -X GET https://9ll2h6meg0.execute-api.us-east-1.amazonaws.com/prod/academic/health &
done
wait
```

---

## 📊 **Performance Monitoring**

### **Key Metrics to Monitor**:
1. **Response Time**: < 200ms for health checks, < 500ms for CRUD operations
2. **Error Rate**: < 1% for all endpoints
3. **Throughput**: > 100 requests/second
4. **DynamoDB**: RCU/WCU utilization < 80%

### **CloudWatch Queries**:
```bash
# Check API Gateway metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=TenantAPI \
  --start-time 2024-01-15T00:00:00Z \
  --end-time 2024-01-15T23:59:59Z \
  --period 300 \
  --statistics Sum

# Check DynamoDB metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=school-table-v2-basic \
  --start-time 2024-01-15T00:00:00Z \
  --end-time 2024-01-15T23:59:59Z \
  --period 300 \
  --statistics Sum
```

---

## ✅ **Test Validation Checklist**

### **Functional Tests**:
- [ ] All CRUD operations work correctly
- [ ] Data validation prevents invalid inputs
- [ ] Authentication/authorization works properly
- [ ] Error handling returns appropriate HTTP status codes
- [ ] Bulk operations process multiple records
- [ ] Analytics endpoints return meaningful data

### **Performance Tests**:
- [ ] Response times meet SLA requirements
- [ ] System handles concurrent requests
- [ ] DynamoDB queries are efficient
- [ ] Memory usage stays within limits

### **Security Tests**:
- [ ] JWT tokens are properly validated
- [ ] Tenant isolation is maintained
- [ ] Sensitive data is not exposed
- [ ] Input sanitization prevents injection attacks

### **Integration Tests**:
- [ ] All services communicate correctly
- [ ] Data consistency across modules
- [ ] Event-driven updates work
- [ ] External service integrations function

---

## 🚀 **Deployment Verification**

After running all tests, verify:
1. **All endpoints respond correctly**
2. **Data persists in DynamoDB**
3. **GSIs are being used efficiently**
4. **Logs show proper request/response flow**
5. **Error handling works as expected**

---

## 📝 **Notes**

- Replace placeholder IDs with actual values from your system
- Monitor CloudWatch logs during testing for detailed error information
- Use tools like Postman or Insomnia for easier API testing
- Consider implementing automated testing with tools like Newman or Jest
- Keep test data separate from production data

---

**Happy Testing! 🎉**

# Postman API Collections Guidance for EdForge Services

## Overview

This document provides a comprehensive, step-by-step guide for creating Postman API collections for all EdForge backend microservices. EdForge uses **two separate API Gateways**:

1. **TenantAPI** - Handles tenant-specific operations (Identity Service, Academics Service)
   - Invoke URL: `https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod`
   - Endpoints: `/auth/*`, `/users/*`, `/schools/*`, `/academics/*`, `/tenants/*`

2. **ControlPlane API** - Handles control plane operations (system administration)
   - Invoke URL: (Check your AWS Console or CDK outputs)
   - Endpoints: Control plane specific operations

This guide will walk you through creating collections for both APIs with easy-to-use authentication using username and password.

## Quick Start Summary

**For immediate testing:**

**Option A: Using API Gateway (if service is accessible)**
1. Create environment with `tenant_api_base_url`, `username`, `password`
2. Create "EdForge - TenantAPI" collection
3. **FIRST**: Test health check endpoint (`GET /health`) - if this fails with 503, see troubleshooting below
4. Add login request with test script to auto-save tokens
5. Login → Tokens auto-saved → All other requests work automatically

**Option B: Direct Cognito Authentication (Bypass API Gateway)**
1. Use the provided script: `node scripts/cognito-login.js email@example.com password`
2. Copy the Access Token from output
3. Set `access_token` in Postman environment
4. All requests will automatically use the token
5. **This works even if API Gateway returns 503!**

**Key Points:**
- **TenantAPI**: `https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod`
- **Login**: `POST /auth/login` with `email` and `password` (no auth required)
- **All other endpoints**: Require `Authorization: Bearer <token>` (auto-added)
- **Tokens**: Auto-saved from login response, auto-used in all requests

**⚠️ IMPORTANT - If you get 503 Service Unavailable:**

The 503 error means API Gateway cannot reach your backend service. This is a **connectivity issue**, not an authentication issue.

**Quick Fix Options:**
1. **Test health endpoint first**: `GET {{base_url}}/health` - if this also returns 503, the problem is API Gateway connectivity
2. **Use direct service URL**: Bypass API Gateway and test directly against your service (see "Direct Service Access" in troubleshooting)
3. **Check AWS Console**: Verify VPC Link, NLB, and ECS service are all healthy

**The `/auth/login` endpoint is correct** - it uses direct email/password authentication with Cognito (not the hosted UI). The issue is the API Gateway → Service connection.

---

## Step-by-Step Setup Guide

### Step 1: Create Postman Workspace

1. Open Postman
2. Create a new workspace: **"EdForge API Testing"**
3. This will help organize all your collections

### Step 2: Create Environment Variables

1. Click the **Environments** icon (top left) or press `Ctrl+E` (Windows) / `Cmd+E` (Mac)
2. Click **"+"** to create a new environment
3. Name it: **"EdForge - Production"** (or "EdForge - Development" for local testing)

4. Add the following variables (click **"Add"** for each):

| Variable Name | Initial Value | Current Value | Type |
|--------------|---------------|---------------|------|
| `tenant_api_base_url` | `https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod` | `https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod` | default |
| `control_plane_api_base_url` | `https://fo5y55fkfj.execute-api.us-east-1.amazonaws.com` | `https://fo5y55fkfj.execute-api.us-east-1.amazonaws.com` | default |
| `username` | `your-email@example.com` | `your-email@example.com` | default |
| `password` | `your-password` | `your-password` | secret |
| `access_token` | (leave empty) | (leave empty) | secret |
| `refresh_token` | (leave empty) | (leave empty) | secret |
| `tenant_id` | (leave empty) | (leave empty) | default |
| `user_id` | (leave empty) | (leave empty) | default |
| `school_id` | (leave empty) | (leave empty) | default |
| `academic_year_id` | (leave empty) | (leave empty) | default |
| `student_id` | (leave empty) | (leave empty) | default |

5. Click **"Save"** to save the environment
6. **Select this environment** from the dropdown (top right) to make it active

### Step 3: Create TenantAPI Collection

1. Click **"Collections"** in the left sidebar
2. Click **"+"** to create a new collection
3. Name it: **"EdForge - TenantAPI"**
4. Click the collection name to open it
5. Go to the **"Variables"** tab and add these collection-level variables:

| Variable | Initial Value | Current Value |
|----------|---------------|---------------|
| `base_url` | `{{tenant_api_base_url}}` | `{{tenant_api_base_url}}` |

6. Go to the **"Authorization"** tab:
   - Type: **"Bearer Token"**
   - Token: `{{access_token}}`
   - This will be auto-populated after login

7. Go to the **"Pre-request Script"** tab and add:

```javascript
// Auto-attach Bearer token if available
if (pm.environment.get("access_token")) {
    pm.request.headers.add({
        key: "Authorization",
        value: "Bearer " + pm.environment.get("access_token")
    });
}

// Add tenant context
if (pm.environment.get("tenant_id")) {
    pm.request.headers.add({
        key: "X-Tenant-Id",
        value: pm.environment.get("tenant_id")
    });
}

// Add school context for academics endpoints
if (pm.environment.get("school_id") && pm.request.url.toString().includes("/academics")) {
    pm.request.headers.add({
        key: "X-School-Id",
        value: pm.environment.get("school_id")
    });
}

// Add correlation ID for tracing
pm.request.headers.add({
    key: "X-Correlation-Id",
    value: pm.variables.replaceIn("{{$guid}}")
});
```

8. Click **"Save"** to save the collection

### Step 4: Create ControlPlane API Collection

1. Create another collection: **"EdForge - ControlPlane API"**
2. Set collection variable `base_url` to `{{control_plane_api_base_url}}`
3. Use the same authorization and pre-request script setup as TenantAPI

## Collection Structure

### High-Level Organization

```
EdForge API Collections
├── EdForge - TenantAPI
│   ├── 01. Authentication
│   │   ├── Login (Username/Password)
│   │   ├── Refresh Token
│   │   ├── Logout
│   │   └── Get Current User
│   ├── 02. Users
│   ├── 03. Schools
│   ├── 04. Tenants
│   ├── 05. Roles & Permissions
│   ├── 06. Sessions
│   ├── 07. Academic Years
│   └── 08. Academics
│       ├── Students
│       ├── Enrollments
│       └── Attendance
└── EdForge - ControlPlane API
    └── (Control Plane endpoints)
```

## Authentication Flow - Step by Step

### Understanding EdForge Authentication

EdForge uses **AWS Cognito** for authentication. When you login with username (email) and password:
1. The `/auth/login` endpoint authenticates with Cognito
2. Cognito returns JWT tokens (Access Token and Refresh Token)
3. These tokens are used in the `Authorization: Bearer <token>` header for all subsequent requests
4. The JWT token contains tenant information, user role, and other claims

### Step 5: Verify Service Health (IMPORTANT - Do This First!)

Before attempting login, verify the service is accessible:

1. In the **"EdForge - TenantAPI"** collection, click **"..."** → **"Add Folder"**
2. Name it: **"00. Health Checks"**
3. Inside this folder, create these requests:

#### Health Check Request

1. **Name**: `GET Health Check`
2. **Method**: `GET`
3. **URL**: `{{base_url}}/health`
4. **Authorization**: **"No Auth"**
5. **Tests**:
```javascript
pm.test("Service is healthy", function () {
    pm.response.to.have.status(200);
    const jsonData = pm.response.json();
    pm.expect(jsonData.status).to.equal("ok");
    console.log("✅ Service is healthy and accessible");
});
```

**If this returns 503 or fails:**
- The API Gateway cannot reach your backend service
- Check VPC Link connectivity
- Verify ECS service is running and healthy
- Check Network Load Balancer target group health
- See "Troubleshooting 503 Errors" section below

#### Alternative: Direct Service Access (Bypass API Gateway)

If API Gateway is not working, you can test directly against the service:

1. **Find your service URL**: Check your ECS service or ALB endpoint
2. **Create a new environment variable**: `direct_service_url` (e.g., `http://your-alb-url.us-east-1.elb.amazonaws.com`)
3. **Create requests using**: `{{direct_service_url}}/auth/login` instead of `{{base_url}}/auth/login`

**Note**: Direct service access won't have API Gateway features (authorization, throttling) but is useful for testing.

---

### Step 6: Create Login Request (TenantAPI)

1. In the **"EdForge - TenantAPI"** collection, click **"..."** → **"Add Folder"**
2. Name it: **"01. Authentication"**
3. Inside this folder, click **"Add Request"**
4. Name it: **"Login - Username/Password"**

5. Configure the request:
   - **Method**: `POST`
   - **URL**: `{{base_url}}/auth/login`
   - **Authorization Tab**: Set to **"No Auth"** (login is public)

6. **Headers Tab**: Add:
   - `Content-Type`: `application/json`

7. **Body Tab**:
   - Select **"raw"** and **"JSON"**
   - Enter:
   ```json
   {
     "email": "{{username}}",
     "password": "{{password}}",
     "deviceId": "postman-{{$guid}}"
   }
   ```

8. **Tests Tab** (Important! This auto-saves tokens):
   ```javascript
   // Check if login was successful
   if (pm.response.code === 200) {
       const response = pm.response.json();
       
       // Save tokens to environment
       pm.environment.set("access_token", response.accessToken);
       pm.environment.set("refresh_token", response.refreshToken);
       
       // Save user and tenant info
       if (response.user) {
           pm.environment.set("user_id", response.user.userId);
           pm.environment.set("tenant_id", response.user.tenantId);
           
           // If user has school roles, optionally set first school
           if (response.user.roles && response.user.roles.length > 0) {
               pm.environment.set("school_id", response.user.roles[0].schoolId);
           }
       }
       
       // Show success message
       pm.test("Login successful", function () {
           pm.expect(response.accessToken).to.exist;
           console.log("✅ Login successful! Tokens saved to environment.");
           console.log("User ID:", response.user?.userId);
           console.log("Tenant ID:", response.user?.tenantId);
       });
   } else {
       pm.test("Login failed", function () {
           pm.expect.fail("Login failed with status: " + pm.response.code);
       });
   }
   ```

9. **Save** the request

10. **Test the login**:
    - Make sure your environment is selected (top right)
    - Update `username` and `password` in your environment variables
    - Click **"Send"**
    - Check the **"Test Results"** tab - you should see "✅ Login successful!"
    - Verify tokens are saved: Click the eye icon (👁️) next to environment variables to see `access_token` is populated

### Step 6: Verify Authentication Setup

1. After successful login, check your environment variables:
   - `access_token` should be populated
   - `tenant_id` should be populated
   - `user_id` should be populated

2. All subsequent requests will automatically use these tokens via the collection's pre-request script

### Step 7: Create Additional Authentication Requests

In the **"01. Authentication"** folder, create these additional requests:

#### Refresh Token Request

1. **Name**: `Refresh Token`
2. **Method**: `POST`
3. **URL**: `{{base_url}}/auth/refresh`
4. **Body** (JSON):
   ```json
   {
     "refreshToken": "{{refresh_token}}"
   }
   ```
5. **Tests** (to update access token):
   ```javascript
   if (pm.response.code === 200) {
       const response = pm.response.json();
       pm.environment.set("access_token", response.accessToken);
       pm.environment.set("refresh_token", response.refreshToken);
       console.log("✅ Token refreshed successfully");
   }
   ```

#### Get Current User Request

1. **Name**: `Get Current User`
2. **Method**: `GET`
3. **URL**: `{{base_url}}/auth/me`
4. **Tests**:
   ```javascript
   pm.test("Status code is 200", function () {
       pm.response.to.have.status(200);
   });
   
   pm.test("Response contains user data", function () {
       const jsonData = pm.response.json();
       pm.expect(jsonData).to.have.property('user');
       pm.expect(jsonData.user).to.have.property('email');
   });
   ```

#### Logout Request

1. **Name**: `Logout`
2. **Method**: `POST`
3. **URL**: `{{base_url}}/auth/logout`
4. **Body** (JSON):
   ```json
   {
     "sessionId": "",
     "revokeAll": false
   }
   ```
5. **Tests**:
   ```javascript
   if (pm.response.code === 204) {
       // Optionally clear tokens
       // pm.environment.unset("access_token");
       // pm.environment.unset("refresh_token");
       console.log("✅ Logout successful");
   }
   ```

## Step 8: Create Endpoint Folders and Requests

Now that authentication is set up, let's create organized folders for all endpoints. This makes it easy to find and test specific functionality.

### Creating Folder Structure

For each folder below:
1. Right-click on **"EdForge - TenantAPI"** collection
2. Select **"Add Folder"**
3. Name it as specified
4. Create requests inside each folder

---

## TenantAPI Endpoints Reference

### Folder: 01. Authentication ✅ (Already Created)

All authentication endpoints are in this folder. See Step 5-7 above.

---

### Folder: 02. Users

Create this folder and add the following requests:

#### 2. Refresh Token
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/auth/refresh`
- **Auth**: Bearer Token
- **Body**:
```json
{
  "refreshToken": "{{refresh_token}}"
}
```

#### 3. Logout
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/auth/logout`
- **Auth**: Bearer Token
- **Body**:
```json
{
  "sessionId": "session-123",
  "revokeAll": false
}
```

#### 4. Get Current User (Auth)
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/auth/me`
- **Auth**: Bearer Token

### Users Folder

#### Request: Create User

1. **Name**: `POST User - Create`
2. **Method**: `POST`
3. **URL**: `{{base_url}}/users`
4. **Body** (raw JSON):
```json
{
  "email": "newuser@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890",
  "globalRole": "StandardUser",
  "temporaryPassword": "TempPass123!"
}
```
5. **Tests**:
```javascript
pm.test("Status code is 200 or 201", function () {
    pm.expect([200, 201]).to.include(pm.response.code);
});

if (pm.response.code === 200 || pm.response.code === 201) {
    const response = pm.response.json();
    // Optionally save user_id if you want to use it later
    if (response.userId) {
        pm.environment.set("created_user_id", response.userId);
    }
}
```

#### Request: List Users

1. **Name**: `GET Users - List`
2. **Method**: `GET`
3. **URL**: `{{base_url}}/users`
4. **Params Tab** (Query Parameters):
   - `limit`: `50` (optional)
   - `cursor`: (leave empty, or use `{{lastEvaluatedKey}}` for pagination)
5. **Tests**:
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

const response = pm.response.json();
if (response.lastEvaluatedKey) {
    pm.environment.set("lastEvaluatedKey", response.lastEvaluatedKey);
}
```

#### Request: Get Current User

1. **Name**: `GET User - Current (Me)`
2. **Method**: `GET`
3. **URL**: `{{base_url}}/users/me`
4. **Tests**:
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response contains user data", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('userId');
    pm.expect(jsonData).to.have.property('email');
});
```

#### Request: Get User by ID

1. **Name**: `GET User - By ID`
2. **Method**: `GET`
3. **URL**: `{{base_url}}/users/{{user_id}}`
   - Replace `{{user_id}}` with actual user ID or use environment variable

#### Request: Update User

1. **Name**: `PATCH User - Update`
2. **Method**: `PATCH`
3. **URL**: `{{base_url}}/users/{{user_id}}`
4. **Body** (raw JSON):
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+1987654321",
  "displayName": "Jane Smith",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

#### Request: Delete User

1. **Name**: `DELETE User - Delete`
2. **Method**: `DELETE`
3. **URL**: `{{base_url}}/users/{{user_id}}`
4. **Tests**:
```javascript
pm.test("Status code is 204", function () {
    pm.response.to.have.status(204);
});
```

#### 7. Get User Preferences
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/preferences`

#### 8. Update User Preferences
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/preferences`
- **Body**:
```json
{
  "theme": "dark",
  "language": "en",
  "notifications": {
    "email": true,
    "push": false
  },
  "timezone": "America/New_York"
}
```

### Schools Folder

#### 1. Create School
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/schools`
- **Body**:
```json
{
  "schoolCode": "SCH001",
  "name": "Lincoln High School",
  "shortName": "LHS",
  "schoolType": "high",
  "gradeRange": {
    "min": "9",
    "max": "12"
  },
  "phone": "+1234567890",
  "email": "info@lincoln.edu",
  "website": "https://lincoln.edu",
  "address": {
    "street1": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zipCode": "62701",
    "country": "USA"
  },
  "principalName": "Dr. Jane Principal",
  "principalEmail": "principal@lincoln.edu",
  "timezone": "America/Chicago",
  "locale": "en-US",
  "academicCalendarType": "semester",
  "logoUrl": "https://example.com/logo.png"
}
```

#### 2. List Schools
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools?limit=50`

#### 3. Get School by ID
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}`

#### 4. Update School
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}`
- **Body**:
```json
{
  "name": "Lincoln High School Updated",
  "phone": "+1987654321"
}
```

#### 5. Delete School
- **Method**: `DELETE`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}`

#### 6. Get School Configuration
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/configuration`

#### 7. Update School Configuration
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/configuration`
- **Body**:
```json
{
  "settings": {
    "attendanceTracking": true,
    "gradebookEnabled": true
  }
}
```

### Departments Subfolder (under Schools)

#### 1. List Departments
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/departments?limit=50`

#### 2. Create Department
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/departments`
- **Body**:
```json
{
  "name": "Mathematics",
  "code": "MATH",
  "description": "Mathematics Department",
  "headUserId": "{{user_id}}"
}
```

#### 3. Get Department
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/departments/{{department_id}}`

#### 4. Update Department
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/departments/{{department_id}}`
- **Body**:
```json
{
  "name": "Mathematics & Statistics",
  "description": "Updated description"
}
```

#### 5. Delete Department
- **Method**: `DELETE`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/departments/{{department_id}}`

### Tenants Folder

#### 1. Lookup Tenant (Public)
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/tenants/lookup?subdomain=acme`
- **Auth**: None

#### 2. Get Tenant
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/tenants/{{tenant_id}}`

#### 3. Update Tenant
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/tenants/{{tenant_id}}`
- **Body**:
```json
{
  "name": "Updated Tenant Name",
  "address": {
    "street1": "456 Corporate Blvd",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001"
  }
}
```

### Roles & Permissions Folder

#### 1. Assign Role to User
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles`
- **Body**:
```json
{
  "schoolId": "{{school_id}}",
  "role": "Teacher",
  "permissions": ["students:read", "students:write"],
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```

#### 2. Get User Roles
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles`

#### 3. Get User Role at School
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles/{{school_id}}`

#### 4. Update Role
- **Method**: `PATCH`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles/{{school_id}}`
- **Body**:
```json
{
  "role": "DepartmentHead",
  "permissions": ["students:read", "students:write", "grades:read"]
}
```

#### 5. Deactivate Role
- **Method**: `DELETE`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles/{{school_id}}`
- **Body**:
```json
{
  "endDate": "2024-12-31",
  "reason": "End of school year"
}
```

#### 6. Check Permission
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/users/{{user_id}}/roles/permissions/check`
- **Body**:
```json
{
  "schoolId": "{{school_id}}",
  "resource": "students",
  "action": "write"
}
```

### Sessions Folder

#### 1. List Sessions
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/sessions`

#### 2. Get Session
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/sessions/{{session_id}}`

#### 3. Revoke Session
- **Method**: `DELETE`
- **URL**: `{{identity_base_url}}/sessions/{{session_id}}`

#### 4. Revoke All Sessions
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/sessions/revoke-all`
- **Body**:
```json
{
  "exceptCurrent": true
}
```

#### 5. List User Sessions (Admin)
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/sessions/user/{{user_id}}`

#### 6. Revoke User Sessions (Admin)
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/sessions/user/{{user_id}}/revoke-all`

### Academic Years Folder

#### 1. Create Academic Year
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years`
- **Body**:
```json
{
  "name": "2024-2025",
  "startDate": "2024-08-15",
  "endDate": "2025-06-15",
  "status": "planned",
  "setAsCurrent": true
}
```

#### 2. List Academic Years
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years?limit=20`

#### 3. Get Current Academic Year
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/current`

#### 4. Get Academic Year
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}`

#### 5. Update Academic Year
- **Method**: `PUT`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}`
- **Body**:
```json
{
  "name": "2024-2025 Updated",
  "startDate": "2024-08-20",
  "endDate": "2025-06-20"
}
```

#### 6. Set Current Academic Year
- **Method**: `PUT`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/set-current`

#### 7. Update Academic Year Status
- **Method**: `PUT`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/status`
- **Body**:
```json
{
  "status": "active"
}
```

### Grading Periods Subfolder (under Academic Years)

#### 1. Create Grading Period
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/grading-periods`
- **Body**:
```json
{
  "name": "Fall Semester",
  "startDate": "2024-08-15",
  "endDate": "2024-12-20",
  "type": "semester",
  "weight": 0.5
}
```

#### 2. List Grading Periods
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/grading-periods`

#### 3. Update Grading Period
- **Method**: `PUT`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/grading-periods/{{term_id}}`
- **Body**:
```json
{
  "name": "Fall Semester Updated",
  "endDate": "2024-12-22"
}
```

### Holidays Subfolder (under Academic Years)

#### 1. Create Holiday
- **Method**: `POST`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/holidays`
- **Body**:
```json
{
  "name": "Thanksgiving Break",
  "startDate": "2024-11-28",
  "endDate": "2024-11-29",
  "type": "holiday"
}
```

#### 2. List Holidays
- **Method**: `GET`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/holidays`

#### 3. Delete Holiday
- **Method**: `DELETE`
- **URL**: `{{identity_base_url}}/schools/{{school_id}}/academic-years/{{academic_year_id}}/holidays/{{holiday_id}}`

## Academics Service Endpoints

### Students Folder

#### 1. Create Student
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/students`
- **Body**:
```json
{
  "firstName": "Alice",
  "lastName": "Johnson",
  "middleName": "Marie",
  "preferredName": "Ali",
  "dateOfBirth": "2010-05-15",
  "gender": "female",
  "schoolId": "{{school_id}}",
  "currentGradeLevel": "9",
  "email": "alice.johnson@example.com",
  "phone": "+1234567890",
  "address": {
    "street1": "789 Oak Ave",
    "city": "Springfield",
    "state": "IL",
    "zipCode": "62701",
    "country": "USA"
  },
  "guardians": [
    {
      "relationship": "mother",
      "firstName": "Sarah",
      "lastName": "Johnson",
      "email": "sarah.johnson@example.com",
      "phone": "+1234567891",
      "phoneType": "mobile",
      "isPrimary": true,
      "hasPortalAccess": true
    }
  ],
  "emergencyContact": {
    "name": "John Johnson",
    "relationship": "father",
    "phone": "+1234567892",
    "alternatePhone": "+1234567893"
  },
  "medicalInfo": {
    "allergies": ["peanuts"],
    "medications": [],
    "conditions": [],
    "physicianName": "Dr. Smith",
    "physicianPhone": "+1234567894"
  },
  "specialPrograms": ["gifted"]
}
```

#### 2. List Students
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students?schoolId={{school_id}}&limit=50&cursor={{lastEvaluatedKey}}&gradeLevel=9&status=active&search=Alice`
- **Query Params**:
  - `schoolId` (required)
  - `limit` (optional): Default 50
  - `cursor` (optional): Pagination cursor
  - `gradeLevel` (optional): Filter by grade
  - `status` (optional): active, inactive, graduated, transferred, withdrawn
  - `search` (optional): Search by name

#### 3. Get Student
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}`

#### 4. Get Student Profile
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/profile`

#### 5. Get Student Enrollments
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/enrollments`

#### 6. Get Student Attendance Summary
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/attendance/summary?schoolId={{school_id}}&academicYearId={{academic_year_id}}`

#### 7. Get Student Attendance
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/attendance?startDate=2024-01-01&endDate=2024-12-31`

#### 8. Get Student Grades
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/grades?academicYearId={{academic_year_id}}&termId={{term_id}}`

#### 9. Update Student
- **Method**: `PATCH`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}`
- **Body**:
```json
{
  "preferredName": "Ali J",
  "currentGradeLevel": "10",
  "status": "active",
  "phone": "+1987654321"
}
```

#### 10. Delete Student
- **Method**: `DELETE`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}`

### Enrollments Folder

#### 1. Create Enrollment
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/enrollments`
- **Body**:
```json
{
  "studentId": "{{student_id}}",
  "schoolId": "{{school_id}}",
  "academicYearId": "{{academic_year_id}}",
  "gradeLevel": "9",
  "startDate": "2024-08-15",
  "enrollmentType": "new",
  "sectionId": "section-001",
  "homeroomTeacherId": "{{user_id}}",
  "specialEducation": false,
  "eslStatus": "none",
  "lunchStatus": "free",
  "transportation": "bus",
  "notes": "New student enrollment"
}
```

#### 2. List Enrollments
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/enrollments?limit=50&cursor={{lastEvaluatedKey}}&gradeLevel=9&status=enrolled`
- **Query Params**:
  - `limit` (optional)
  - `cursor` (optional)
  - `gradeLevel` (optional)
  - `status` (optional): enrolled, pending, withdrawn, graduated, transferred

#### 3. Get Enrollment Summary
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/enrollments/summary`

#### 4. Get Student Enrollment History
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/students/{{student_id}}/enrollment`

#### 5. Get Enrollment
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/students/{{student_id}}/enrollment`

#### 6. Update Enrollment
- **Method**: `PATCH`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/students/{{student_id}}/enrollment`
- **Body**:
```json
{
  "status": "enrolled",
  "gradeLevel": "10",
  "sectionId": "section-002",
  "homeroomTeacherId": "{{user_id}}"
}
```

#### 7. Withdraw Student
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/students/{{student_id}}/withdraw`
- **Body**:
```json
{
  "withdrawalDate": "2024-12-15",
  "reason": "Family relocation",
  "destinationSchool": "Other School District"
}
```

#### 8. Transfer Student
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/schools/{{school_id}}/years/{{academic_year_id}}/students/{{student_id}}/transfer`
- **Body**:
```json
{
  "toSchoolId": "school-789",
  "toAcademicYearId": "year-2025",
  "effectiveDate": "2025-01-15",
  "reason": "School transfer"
}
```

### Attendance Folder

#### 1. Record Attendance
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/attendance`
- **Body**:
```json
{
  "studentId": "{{student_id}}",
  "schoolId": "{{school_id}}",
  "academicYearId": "{{academic_year_id}}",
  "date": "2024-09-15",
  "status": "present",
  "checkInTime": "08:00:00",
  "checkOutTime": "15:30:00",
  "note": "On time",
  "periodAttendance": [
    {
      "periodNumber": 1,
      "periodName": "Math",
      "courseId": "course-001",
      "teacherId": "{{user_id}}",
      "status": "present"
    }
  ]
}
```

#### 2. Record Bulk Attendance
- **Method**: `POST`
- **URL**: `{{academics_base_url}}/academics/attendance/bulk`
- **Body**:
```json
{
  "schoolId": "{{school_id}}",
  "academicYearId": "{{academic_year_id}}",
  "date": "2024-09-15",
  "records": [
    {
      "studentId": "{{student_id}}",
      "status": "present",
      "checkInTime": "08:00:00"
    },
    {
      "studentId": "student-002",
      "status": "absent",
      "note": "Sick"
    }
  ]
}
```

#### 3. Get Attendance by Date
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/attendance?schoolId={{school_id}}&date=2024-09-15&limit=100`
- **Query Params**:
  - `schoolId` (required)
  - `date` (required): YYYY-MM-DD format
  - `limit` (optional): Default 100

#### 4. Get Daily Attendance Summary
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/attendance/summary?schoolId={{school_id}}&date=2024-09-15`

#### 5. Get Student Attendance
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/attendance/student/{{student_id}}?startDate=2024-09-01&endDate=2024-09-30`

#### 6. Get Student Attendance Summary
- **Method**: `GET`
- **URL**: `{{academics_base_url}}/academics/attendance/student/{{student_id}}/summary?schoolId={{school_id}}&academicYearId={{academic_year_id}}&startDate=2024-09-01&endDate=2024-09-30`

#### 7. Update Attendance
- **Method**: `PATCH`
- **URL**: `{{academics_base_url}}/academics/attendance/2024-09-15/{{student_id}}`
- **Body**:
```json
{
  "status": "late",
  "checkInTime": "08:15:00",
  "note": "Late arrival - traffic",
  "reason": "Transportation delay"
}
```

## Best Practices

### 1. Request Naming Convention

Use descriptive names:
- `[METHOD] [Resource] - [Action]`
- Examples:
  - `POST User - Create`
  - `GET Students - List by School`
  - `PATCH Enrollment - Update Status`

### 2. Folder Organization

- Group related endpoints in folders
- Use subfolders for nested resources (e.g., Departments under Schools)
- Maintain logical hierarchy matching API structure

### 3. Variable Usage

- Always use environment variables for IDs and tokens
- Use `{{variable_name}}` syntax in URLs and bodies
- Set variables from responses using test scripts

### 4. Test Scripts

Add basic validation tests to each request:

```javascript
// Status code check
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

// Response time check
pm.test("Response time is less than 500ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(500);
});

// Response structure check
pm.test("Response has required fields", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
});
```

### 5. Documentation

- Add descriptions to each request explaining its purpose
- Include example responses in request descriptions
- Document required vs optional parameters

### 6. Collection Runner

Create collection runner scenarios:
- **Authentication Flow**: Login → Get Current User
- **Student Lifecycle**: Create Student → Create Enrollment → Record Attendance
- **School Setup**: Create School → Create Academic Year → Create Departments

## Common Response Patterns

### Success Response (200 OK)
```json
{
  "data": { ... },
  "meta": {
    "total": 100,
    "hasMore": true,
    "lastEvaluatedKey": "cursor-123"
  }
}
```

### Paginated List Response
```json
{
  "items": [ ... ],
  "lastEvaluatedKey": "cursor-123",
  "hasMore": true
}
```

### Error Response (400/401/404/500)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": {
      "email": ["Email is required"]
    },
    "traceId": "trace-123"
  }
}
```

## Environment-Specific Configuration

### Development
```
base_url: http://localhost:3010
```

### Staging
```
base_url: https://staging-api.edforge.example.com
```

### Production
```
base_url: https://api.edforge.example.com
```

## Maintenance

1. **Version Control**: Export collections as JSON and commit to version control
2. **Regular Updates**: Update collections when API changes
3. **Documentation Sync**: Keep Postman descriptions in sync with API documentation
4. **Variable Management**: Document all environment variables and their purposes

## Quick Reference: Required Headers

| Header | Required For | Example Value |
|--------|-------------|---------------|
| `Authorization` | All authenticated endpoints | `Bearer {{access_token}}` |
| `X-Tenant-Id` | All authenticated endpoints | `{{tenant_id}}` |
| `X-School-Id` | Academics service endpoints | `{{school_id}}` |
| `X-Correlation-Id` | All requests (for tracing) | `{{$guid}}` |
| `Content-Type` | POST/PATCH/PUT requests | `application/json` |

## Quick Reference: Common Status Codes

| Code | Meaning | Common Scenarios |
|------|---------|------------------|
| 200 | Success | GET, PATCH, PUT requests |
| 201 | Created | POST requests (some endpoints) |
| 204 | No Content | DELETE requests |
| 400 | Bad Request | Validation errors |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Internal server issues |

---

## Complete Endpoint Quick Reference

### TenantAPI Base URL
```
https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod
```

### Authentication Endpoints (Public - No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/login` | Login with email/password |
| `POST` | `/auth/refresh` | Refresh access token |
| `POST` | `/auth/logout` | Logout and invalidate session |
| `GET` | `/auth/me` | Get current authenticated user |

### Identity Service Endpoints (Require Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users` | List users (with pagination) |
| `POST` | `/users` | Create user |
| `GET` | `/users/me` | Get current user |
| `GET` | `/users/{userId}` | Get user by ID |
| `PATCH` | `/users/{userId}` | Update user |
| `DELETE` | `/users/{userId}` | Delete user |
| `GET` | `/users/{userId}/preferences` | Get user preferences |
| `PATCH` | `/users/{userId}/preferences` | Update user preferences |
| `GET` | `/schools` | List schools |
| `POST` | `/schools` | Create school |
| `GET` | `/schools/{schoolId}` | Get school by ID |
| `PATCH` | `/schools/{schoolId}` | Update school |
| `DELETE` | `/schools/{schoolId}` | Delete school |
| `GET` | `/schools/{schoolId}/configuration` | Get school configuration |
| `PATCH` | `/schools/{schoolId}/configuration` | Update school configuration |
| `GET` | `/schools/{schoolId}/departments` | List departments |
| `POST` | `/schools/{schoolId}/departments` | Create department |
| `GET` | `/schools/{schoolId}/departments/{departmentId}` | Get department |
| `PATCH` | `/schools/{schoolId}/departments/{departmentId}` | Update department |
| `DELETE` | `/schools/{schoolId}/departments/{departmentId}` | Delete department |
| `GET` | `/tenants/lookup?subdomain=xxx` | Lookup tenant (public) |
| `GET` | `/tenants/{tenantId}` | Get tenant |
| `PATCH` | `/tenants/{tenantId}` | Update tenant |
| `POST` | `/users/{userId}/roles` | Assign role to user |
| `GET` | `/users/{userId}/roles` | Get user roles |
| `GET` | `/users/{userId}/roles/{schoolId}` | Get user role at school |
| `PATCH` | `/users/{userId}/roles/{schoolId}` | Update role |
| `DELETE` | `/users/{userId}/roles/{schoolId}` | Deactivate role |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/{sessionId}` | Get session |
| `DELETE` | `/sessions/{sessionId}` | Revoke session |
| `POST` | `/sessions/revoke-all` | Revoke all sessions |
| `POST` | `/schools/{schoolId}/academic-years` | Create academic year |
| `GET` | `/schools/{schoolId}/academic-years` | List academic years |
| `GET` | `/schools/{schoolId}/academic-years/current` | Get current academic year |
| `GET` | `/schools/{schoolId}/academic-years/{yearId}` | Get academic year |
| `PUT` | `/schools/{schoolId}/academic-years/{yearId}` | Update academic year |
| `PUT` | `/schools/{schoolId}/academic-years/{yearId}/set-current` | Set as current |
| `PUT` | `/schools/{schoolId}/academic-years/{yearId}/status` | Update status |
| `POST` | `/schools/{schoolId}/academic-years/{yearId}/grading-periods` | Create grading period |
| `GET` | `/schools/{schoolId}/academic-years/{yearId}/grading-periods` | List grading periods |
| `PUT` | `/schools/{schoolId}/academic-years/{yearId}/grading-periods/{termId}` | Update grading period |
| `POST` | `/schools/{schoolId}/academic-years/{yearId}/holidays` | Create holiday |
| `GET` | `/schools/{schoolId}/academic-years/{yearId}/holidays` | List holidays |
| `DELETE` | `/schools/{schoolId}/academic-years/{yearId}/holidays/{holidayId}` | Delete holiday |

### Academics Service Endpoints (Require Auth + X-School-Id Header)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/academics/students` | Create student |
| `GET` | `/academics/students?schoolId=xxx` | List students |
| `GET` | `/academics/students/{studentId}` | Get student |
| `GET` | `/academics/students/{studentId}/profile` | Get student profile |
| `GET` | `/academics/students/{studentId}/enrollments` | Get student enrollments |
| `GET` | `/academics/students/{studentId}/attendance/summary` | Get attendance summary |
| `GET` | `/academics/students/{studentId}/attendance` | Get attendance records |
| `PATCH` | `/academics/students/{studentId}` | Update student |
| `DELETE` | `/academics/students/{studentId}` | Delete student |
| `POST` | `/academics/enrollments` | Create enrollment |
| `GET` | `/academics/schools/{schoolId}/years/{yearId}/enrollments` | List enrollments |
| `GET` | `/academics/schools/{schoolId}/years/{yearId}/enrollments/summary` | Get enrollment summary |
| `GET` | `/academics/students/{studentId}/enrollment` | Get student enrollment history |
| `GET` | `/academics/schools/{schoolId}/years/{yearId}/students/{studentId}/enrollment` | Get enrollment |
| `PATCH` | `/academics/schools/{schoolId}/years/{yearId}/students/{studentId}/enrollment` | Update enrollment |
| `POST` | `/academics/schools/{schoolId}/years/{yearId}/students/{studentId}/withdraw` | Withdraw student |
| `POST` | `/academics/schools/{schoolId}/years/{yearId}/students/{studentId}/transfer` | Transfer student |
| `POST` | `/academics/attendance` | Record attendance |
| `POST` | `/academics/attendance/bulk` | Record bulk attendance |
| `GET` | `/academics/attendance?schoolId=xxx&date=yyyy-mm-dd` | Get attendance by date |
| `GET` | `/academics/attendance/summary?schoolId=xxx&date=yyyy-mm-dd` | Get daily summary |
| `GET` | `/academics/attendance/student/{studentId}` | Get student attendance |
| `GET` | `/academics/attendance/student/{studentId}/summary` | Get student summary |
| `PATCH` | `/academics/attendance/{date}/{studentId}` | Update attendance |

### ControlPlane API Endpoints

The ControlPlane API handles system administration and control plane operations. To set it up:

1. Create collection: **"EdForge - ControlPlane API"**
2. Set `base_url` to your ControlPlane API Gateway URL (check AWS Console or CDK outputs)
3. Use the same authentication setup as TenantAPI
4. ControlPlane endpoints may require different authentication (check your API Gateway configuration)

**Note**: ControlPlane API endpoints are typically for system administrators and may have different authentication requirements. Consult your infrastructure team for specific endpoint details.

---

## Troubleshooting

### 503 Service Unavailable - Most Common Issue

**Symptoms:**
- Getting `503 Service Temporarily Unavailable` when calling `/auth/login`
- HTML response instead of JSON
- Service appears to be running but API Gateway can't reach it

**Root Causes & Solutions:**

#### 1. API Gateway VPC Link Issue

**Problem**: API Gateway cannot connect to your backend service through VPC Link.

**Check:**
- AWS Console → API Gateway → TenantAPI → VPC Links
- Verify VPC Link status is "Available" (not "Pending" or "Failed")
- Check VPC Link security groups allow traffic from API Gateway

**Solution:**
- Verify VPC Link is properly configured
- Check Network Load Balancer (NLB) is healthy
- Verify NLB target group has healthy targets

#### 2. ECS Service Not Running

**Problem**: The identity service container is not running or unhealthy.

**Check:**
```bash
# Check ECS service status
aws ecs describe-services --cluster <your-cluster> --services identity-service

# Check service health
aws elbv2 describe-target-health --target-group-arn <target-group-arn>
```

**Solution:**
- Ensure ECS service is running: `RUNNING` count > 0
- Check service logs for errors
- Verify service can reach DynamoDB and Cognito

#### 3. Network Load Balancer Issues

**Problem**: NLB cannot route traffic to ECS tasks.

**Check:**
- AWS Console → EC2 → Load Balancers → Find your NLB
- Check target group health: All targets should be "healthy"
- Verify security groups allow traffic on port 80/3010

**Solution:**
- Ensure ECS tasks are registered in target group
- Check security group rules
- Verify health check path (`/health`) is responding

#### 4. Direct Service Access (Workaround)

If API Gateway is the issue, test directly against the service:

1. **Find your ALB/NLB endpoint**:
   - AWS Console → EC2 → Load Balancers
   - Copy the DNS name

2. **Create new environment variable**:
   - `direct_service_url`: `http://your-nlb-dns-name.us-east-1.elb.amazonaws.com`

3. **Update login request URL**:
   - Change from: `{{base_url}}/auth/login`
   - To: `{{direct_service_url}}/auth/login`

4. **Note**: Direct access bypasses API Gateway features but works for testing

#### 5. Verify Service Health Directly

Test if service is accessible:

```bash
# Test health endpoint directly
curl https://f3xlvrqt24.execute-api.us-east-1.amazonaws.com/prod/health

# Or if you have direct service URL
curl http://your-service-url/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "identity-service",
  "timestamp": "2024-01-05T12:00:00.000Z"
}
```

### Alternative Authentication Methods

If `/auth/login` via API Gateway is not working, you have these options:

#### Option 1: Use Cognito Direct Login Script (Recommended)

We've provided a script that authenticates directly with Cognito and outputs tokens:

1. **Run the script**:
```bash
# From project root
node scripts/cognito-login.js your-email@example.com your-password

# Or with explicit User Pool ID
node scripts/cognito-login.js your-email@example.com your-password \
  --user-pool-id us-east-1_XXXXXXXXX \
  --client-id 7931s8p6khga01du6ppmm9hmpm
```

2. **Copy the Access Token** from the output

3. **Set in Postman environment**:
   - Open your environment
   - Set `access_token` = `<paste Access Token>`
   - Set `refresh_token` = `<paste Refresh Token>`

4. **All requests will now work** - tokens are automatically used via pre-request script

**Benefits:**
- ✅ Works even if API Gateway returns 503
- ✅ Bypasses service connectivity issues
- ✅ Gets tokens directly from Cognito
- ✅ Outputs tokens in Postman-ready format
- ✅ Shows user info (Tenant ID, Role, etc.)

**See**: `scripts/COGNITO_LOGIN_README.md` for detailed usage instructions.

#### Option 2: Fix API Gateway Connectivity

The proper solution is to fix the API Gateway → Service connectivity:

1. **Check VPC Link**:
   - AWS Console → API Gateway → TenantAPI → VPC Links
   - Status should be "Available"

2. **Check NLB Health**:
   - AWS Console → EC2 → Load Balancers
   - Find your NLB → Check target group health

3. **Check ECS Service**:
   - AWS Console → ECS → Clusters → Your Cluster → Services
   - Verify identity service is running and tasks are healthy

4. **Check Security Groups**:
   - API Gateway VPC Link security group should allow outbound to NLB
   - NLB security group should allow inbound from VPC Link
   - ECS task security group should allow inbound from NLB

### Other Common Issues

1. **401 Unauthorized**
   - Check if `access_token` is set in environment
   - Verify token hasn't expired (tokens expire after 1 hour)
   - Run "Refresh Token" request or login again
   - Verify credentials are correct

2. **403 Forbidden**
   - User may not have required permissions
   - Check user role and school assignments
   - Verify JWT token contains correct claims

3. **404 Not Found**
   - Verify the endpoint URL is correct
   - Check if resource ID exists (e.g., `school_id`, `user_id`)
   - Ensure API Gateway has the route configured

4. **400 Bad Request**
   - Check request body format (must be valid JSON)
   - Verify required fields are present
   - Check field types match expected format
   - Review validation error details in response

5. **Token Not Auto-Saving**
   - Verify test script is in the "Tests" tab of login request
   - Check environment is selected (top right dropdown)
   - Ensure test script runs successfully (check Test Results tab)
   - Check browser console for JavaScript errors

### Testing Workflow

1. **First Time Setup**:
   ```
   Login → Get Current User → List Schools → (Select School) → List Students
   ```

2. **Daily Testing**:
   ```
   Login (if token expired) → Test specific endpoints
   ```

3. **Full Test Flow**:
   ```
   Login → Create School → Create Academic Year → Create Student → 
   Create Enrollment → Record Attendance → Get Reports
   ```

---

This guidance document provides a complete foundation for creating comprehensive Postman collections for all EdForge services. Follow this structure and patterns to ensure consistency and maintainability across all API collections.


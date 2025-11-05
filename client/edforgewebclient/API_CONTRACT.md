# EdForge EMIS - API Contract Compliance Documentation

**Last Updated**: 2025-11-03  
**API Contract Source**: `server/lib/tenant-api-prod.json`

## Recent Updates (2025-11-03)

### School Microservice - New Endpoints Added

The following endpoints have been added to `tenant-api-prod.json` to fix 403 errors in the Terms and Calendar tabs:

1. **GET/POST `/schools/{schoolId}/academic-years/{yearId}/grading-periods`**
   - **Purpose**: Manage grading periods (Terms)
   - **Status**: ✅ Added to API Gateway
   - **Fixes**: 403 errors on Terms tab
   - **Controller**: `schools.controller.ts:329, 348`

2. **GET/POST `/schools/{schoolId}/academic-years/{yearId}/holidays`**
   - **Purpose**: Manage holidays (Calendar)
   - **Status**: ✅ Added to API Gateway
   - **Fixes**: 403 errors on Calendar tab
   - **Controller**: `schools.controller.ts:369, 388`

3. **GET `/schools/{schoolId}/academic-years/current`**
   - **Purpose**: Get current academic year
   - **Status**: ✅ Added to API Gateway
   - **Controller**: `schools.controller.ts:237`

**Deployment Notes**:
- All endpoints follow the standard API Gateway pattern with VPC Link integration
- CORS headers configured via OPTIONS methods
- JWT authentication via `sharedApigatewayTenantApiAuthorizer`
- Tenant isolation via `tenantPath` header injection

**Next Steps**:
- Deploy updated `tenant-api-prod.json` via CDK: `cdk deploy shared-infra-stack`
- Verify endpoints are accessible after deployment
- Test Terms and Calendar tabs in Next.js application

## Overview

This document tracks the alignment between the NextJS application's API client implementations and the actual API Gateway contract defined in `tenant-api-prod.json`. All API calls must conform to the endpoints and methods defined in the API Gateway specification.

## Architecture

### API Gateway Pattern

- **Single API Gateway**: All microservices are accessed through one API Gateway endpoint (`NEXT_PUBLIC_API_URL`)
- **Lambda Authorizer**: Validates JWT tokens and extracts `tenantId` from `custom:tenantId` claim
- **Automatic Header Injection**: API Gateway automatically adds `tenantPath` header from `context.authorizer.tenantPath`
- **Client Responsibility**: Client only needs to send `Authorization: Bearer <JWT>` header
  - **Critical**: Use ID Token (not Access Token) because it contains custom claims (`custom:tenantId`, `custom:userRole`, `custom:tenantTier`) required by the Lambda authorizer

### Service Architecture

- **Client-side services**: Use `BaseService` → `apiClient` (client-side Axios)
  - Fetches ID token via `/api/auth/id-token` endpoint
  - Caches token in memory (not cookies)
- **Server-side services**: Use `BaseServerService` → `serverApiClient` (server-side Axios)
  - Fetches ID token via `token-service` (server-side only)
  - Both use same base paths and HTTP methods

## Implemented Endpoints

### User Service (`/users`)

| Method | Endpoint | Status | Notes |
|--------|----------|--------|-------|
| GET | `/users` | ✅ Implemented | List all users |
| POST | `/users` | ✅ Implemented | Create new user |
| GET | `/users/{userId}` | ❌ Not Available | Endpoint not in API Gateway contract |
| PUT | `/users/{userId}` | ❌ Not Available | Endpoint not in API Gateway contract |
| DELETE | `/users/{userId}` | ❌ Not Available | Endpoint not in API Gateway contract |

**Current Implementation**:
- `UserService.fetch()` → GET `/users`
- `UserService.create()` → POST `/users`
- User detail and edit pages are disabled (redirect to list)

**User Roles Supported**:
- `TenantAdmin` - Tenant Administrator
- `TenantUser` - Regular User

**Note**: Principal and Teacher roles are not currently supported by the backend API.

### School Service (`/schools`)

| Method | Endpoint | Status | Notes |
|--------|----------|--------|-------|
| GET | `/schools` | ✅ Implemented | List all schools |
| POST | `/schools` | ✅ Implemented | Create school |
| GET | `/schools/{schoolId}` | ✅ Implemented | Get school details |
| PUT | `/schools/{schoolId}` | ✅ Implemented | Update school |
| DELETE | `/schools/{schoolId}` | ✅ Implemented | Delete school |
| GET | `/schools/{schoolId}/departments` | ✅ Implemented | List departments |
| POST | `/schools/{schoolId}/departments` | ✅ Implemented | Create department |
| GET | `/schools/{schoolId}/academic-years` | ✅ Implemented | List academic years |
| POST | `/schools/{schoolId}/academic-years` | ✅ Implemented | Create academic year |
| GET | `/schools/{schoolId}/academic-years/current` | ✅ Added to API Gateway | Get current academic year |
| GET | `/schools/{schoolId}/academic-years/{yearId}` | ✅ Implemented | Get academic year |
| PUT | `/schools/{schoolId}/academic-years/{yearId}` | ✅ Implemented | Update academic year |
| PUT | `/schools/{schoolId}/academic-years/{yearId}/set-current` | ⚠️ Not Implemented | Set current academic year |
| PUT | `/schools/{schoolId}/academic-years/{yearId}/status` | ⚠️ Not Implemented | Update academic year status |
| GET | `/schools/{schoolId}/academic-years/{yearId}/grading-periods` | ✅ Added to API Gateway | List grading periods (Terms) |
| POST | `/schools/{schoolId}/academic-years/{yearId}/grading-periods` | ✅ Added to API Gateway | Create grading period |
| GET | `/schools/{schoolId}/academic-years/{yearId}/holidays` | ✅ Added to API Gateway | List holidays (Calendar) |
| POST | `/schools/{schoolId}/academic-years/{yearId}/holidays` | ✅ Added to API Gateway | Create holiday |
| GET | `/schools/{schoolId}/configuration` | ⚠️ Not Implemented | Get school configuration |
| POST | `/schools/{schoolId}/configuration` | ⚠️ Not Implemented | Update school configuration |
| POST | `/schools/{schoolId}/reports` | ⚠️ Not Implemented | Generate school reports |

**Current Implementation**:
- Base path: `/schools` (fixed from `/school`)
- All basic CRUD operations implemented
- Advanced operations (set-current, status, configuration, reports) not yet implemented

### Academic Service (`/academic/...`)

| Method | Endpoint | Status | Notes |
|--------|----------|--------|-------|
| GET | `/academic/health` | ⚠️ Not Implemented | Health check endpoint |
| GET | `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms` | ✅ Implemented | List classrooms |
| POST | `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms` | ✅ Implemented | Create classroom |
| GET | `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}` | ✅ Implemented | Get classroom |
| PUT | `/academic/schools/{schoolId}/academic-years/{academicYearId}/classrooms/{classroomId}` | ✅ Implemented | Update classroom |
| GET | `/academic/.../classrooms/{classroomId}/assignments` | ✅ Implemented | List assignments |
| POST | `/academic/.../classrooms/{classroomId}/assignments` | ✅ Implemented | Create assignment |
| GET | `/academic/.../classrooms/{classroomId}/grades` | ✅ Implemented | List grades |
| POST | `/academic/.../classrooms/{classroomId}/grades` | ✅ Implemented | Create grade |
| GET | `/academic/.../classrooms/{classroomId}/attendance` | ✅ Implemented | Get attendance |
| POST | `/academic/.../classrooms/{classroomId}/attendance` | ✅ Implemented | Mark attendance |
| POST | `/academic/.../classrooms/{classroomId}/students` | ✅ Implemented | Enroll student |
| DELETE | `/academic/.../classrooms/{classroomId}/students/{studentId}` | ✅ Implemented | Remove student |
| GET | `/academic/.../classrooms/{classroomId}/stream` | ⚠️ Not Implemented | Get classroom stream |
| POST | `/academic/.../classrooms/{classroomId}/stream` | ⚠️ Not Implemented | Create stream post |
| GET | `/academic/.../classrooms/{classroomId}/stream/posts` | ⚠️ Not Implemented | List stream posts |
| POST | `/academic/.../classrooms/{classroomId}/stream/posts` | ⚠️ Not Implemented | Create stream post |
| GET | `/academic/.../classrooms/{classroomId}/stream/posts/{postId}` | ⚠️ Not Implemented | Get stream post |
| PUT | `/academic/.../classrooms/{classroomId}/stream/posts/{postId}` | ⚠️ Not Implemented | Update stream post |
| DELETE | `/academic/.../classrooms/{classroomId}/stream/posts/{postId}` | ⚠️ Not Implemented | Delete stream post |
| PUT | `/academic/.../stream/posts/{postId}/pin` | ⚠️ Not Implemented | Pin/unpin post |
| GET | `/academic/.../stream/posts/{postId}/comments` | ⚠️ Not Implemented | List comments |
| POST | `/academic/.../stream/posts/{postId}/comments` | ⚠️ Not Implemented | Create comment |

**Current Implementation**:
- Base path: `/academic`
- Core classroom, assignment, grade, attendance, and enrollment operations implemented
- Stream/post/comment functionality not yet implemented

## Authentication & Authorization

### Token Usage

- **ID Token**: Required for all API calls
  - Contains custom claims: `custom:tenantId`, `custom:userRole`, `custom:tenantTier`
  - Fetched via `/api/auth/id-token` endpoint (client-side) or `token-service` (server-side)
  - Cached in memory, NOT in cookies (prevents cookie chunking)

- **Access Token**: NOT used for API calls
  - Does not contain custom claims required by Lambda authorizer

### Header Format

All API requests must include:
```
Authorization: Bearer <ID_TOKEN>
```

**DO NOT** manually set `tenantPath` header - API Gateway injects it automatically from JWT claims.

## Known Limitations

### User Management

1. **No Individual User Endpoints**: GET/PUT/DELETE `/users/{userId}` not available
   - Users can only be listed (GET `/users`) and created (POST `/users`)
   - User detail and edit pages are disabled
   - Future: Add these endpoints to API Gateway if needed

2. **Limited Role Support**: Only `TenantAdmin` and `TenantUser` roles supported
   - Principal and Teacher roles not yet available in backend
   - Role selection in create/edit forms restricted to supported roles

### School Management

1. **Recently Added Endpoints** (2025-11-03):
   - ✅ GET `/schools/{schoolId}/academic-years/current` - Get current academic year
   - ✅ GET/POST `/schools/{schoolId}/academic-years/{yearId}/grading-periods` - Manage grading periods
   - ✅ GET/POST `/schools/{schoolId}/academic-years/{yearId}/holidays` - Manage holidays

2. **Missing Advanced Endpoints**:
   - Set current academic year (PUT endpoint exists but not implemented in client)
   - Update academic year status (PUT endpoint exists but not implemented in client)
   - School configuration management
   - Report generation

### Academic Management

1. **Stream/Post/Comments Not Implemented**: Classroom stream functionality exists in API Gateway but not yet implemented in client

## Service Path Alignment

| Service | Base Path | API Gateway Path | Status |
|---------|-----------|------------------|--------|
| UserService | `/users` | `/users` | ✅ Correct |
| SchoolService | `/schools` | `/schools` | ✅ Fixed (was `/school`) |
| AcademicService | `/academic` | `/academic` | ✅ Correct |

## Error Handling

### Common Error Codes

- **401 Unauthorized**: JWT validation failed or token missing
- **403 Forbidden**: Route not found in API Gateway or insufficient permissions
- **404 Not Found**: Resource not found (when endpoint exists but resource doesn't)

### Error Response Format

All errors follow standard API error format:
```typescript
{
  errorCode: string;
  message: string;
  statusCode: number;
  details?: object;
}
```

## Future Enhancements

1. **User Management**: Add GET/PUT/DELETE `/users/{userId}` endpoints to API Gateway
2. **Role Expansion**: Support Principal and Teacher roles in backend and API Gateway
3. **Advanced School Operations**: Implement set-current, status, configuration, and reports endpoints in client
4. **Stream Functionality**: Implement classroom stream, posts, and comments operations
5. **Grading & Attendance Configuration**: Add `/schools/{schoolId}/configuration` endpoints for grading and attendance settings

## Maintenance

When adding new endpoints:
1. Verify endpoint exists in `tenant-api-prod.json`
2. Implement service method with correct base path
3. Add API Gateway path annotation in JSDoc
4. Update this document
5. Test with actual API Gateway (not mocked)

## References

- API Gateway Contract: `server/lib/tenant-api-prod.json`
- Lambda Authorizer: `server/lib/shared-infra/Resources/tenant_authorizer.py`
- Cognito Authorizer: `server/lib/shared-infra/layers/cognito/cognito_authorizer.py`


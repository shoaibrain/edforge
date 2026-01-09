# EdForge Identity Service - Backend API Contract Report

> **Date**: January 8, 2026  
> **Version**: 2.1.0  
> **Frontend**: Shell Module v0.0.1  
> **Status**: Blocked by IAM & CORS (P0 fixes required)

---

## Executive Summary

The frontend Settings module has been aligned with backend expectations. This document specifies the **exact API contracts** required for MVP functionality. All DTO schemas and validation rules must match exactly as specified.

---

## MVP Endpoint Status

| Endpoint | Method | Status | Priority | Notes |
|----------|--------|--------|----------|-------|
| `/users/{id}` | GET | ✅ Working | P0 | |
| `/users/{id}` | PATCH | ❌ 500 IAM Error | P0 | See Issue #5 |
| `/users/{id}/preferences` | GET | ✅ Working | P0 | |
| `/users/{id}/preferences` | PATCH | ❌ CORS Error | P0 | See Issue #7 |
| `/users/{id}/security/change-password` | POST | ⚠️ Error Handling | P1 | See Issue #6 |
| `/tenants/{id}` | GET | ❌ 404 | P1 | See Issue #3 |

### Post-MVP (Disabled in Frontend)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/users/{id}/security/mfa/*` | ❌ Backend Issue | Invalid Access Token error |
| `/users/{id}/security/sessions` | ⏸️ Disabled | UI shows "Coming Soon" |
| `/users/{id}/security/login-history` | ⏸️ Disabled | UI shows "Coming Soon" |

---

## Issue #1: UpdateUserDto Field Alignment

**Severity**: P0 - Blocks profile saves

### Current Error
```
400 BAD_REQUEST: "property phoneCountryCode should not exist"
```

### Resolution
Frontend has removed `phoneCountryCode` from requests. Backend should accept:

```typescript
// PATCH /users/{id}
// Expected UpdateUserDto
interface UpdateUserDto {
  firstName?: string      // max 50 chars, letters/spaces/hyphens only
  lastName?: string       // max 50 chars, letters/spaces/hyphens only
  middleName?: string     // max 50 chars
  displayName?: string    // max 100 chars
  phone?: string          // max 30 chars, include country code (e.g., "+1 555-123-4567")
  avatarUrl?: string      // URL string
  address?: {
    street?: string       // max 100 chars
    street2?: string      // max 100 chars
    city?: string         // max 50 chars
    state?: string        // max 50 chars
    postalCode?: string   // max 20 chars
    country?: string      // max 50 chars
  }
  status?: 'active' | 'inactive' | 'suspended'
}
```

### Action Required
Verify backend `UpdateUserDto` matches exactly. No extra fields should trigger validation errors.

---

## Issue #2: Password Validation Regex Alignment

**Severity**: P1 - User-facing validation mismatch

### Current Error
```
400 BAD_REQUEST: "Password must contain uppercase, lowercase, number, and special character"
```

Password `CoolMint_021021` was rejected despite having underscore `_`.

### Resolution
Frontend now requires these specific special characters:
```
!@#$%^&*(),.?":{}|<>
```

**Underscore `_` is NOT accepted as a special character.**

### Backend Validation (Must Match)
```typescript
// POST /users/{id}/security/change-password
interface ChangePasswordDto {
  currentPassword: string
  newPassword: string  // See rules below
}

// Password Rules:
// - Minimum 8 characters
// - Maximum 128 characters
// - At least one uppercase letter (A-Z)
// - At least one lowercase letter (a-z)
// - At least one digit (0-9)
// - At least one special character from: !@#$%^&*(),.?":{}|<>
// - Underscore (_) is NOT a valid special character

// Regex used:
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,128}$/
```

### Action Required
1. Document this exact regex in backend API docs
2. Return user-friendly error message specifying allowed special characters

---

## Issue #3: Missing Tenant Record

**Severity**: P1 - Shell context fails to load

### Error
```
404 NOT_FOUND: Tenant not found
GET /tenants/6c24289d-2c03-4612-93b2-3a21a6785bcc
```

### Root Cause
Tenant ID exists in Cognito JWT (`custom:tenantId`) but no corresponding record in DynamoDB.

### Action Required
1. **Immediate**: Create missing tenant record in DynamoDB
2. **Long-term**: Fix tenant creation flow during user signup to ensure atomicity

---

## Issue #5: AWS IAM Permission Error on User Update (P0 CRITICAL)

**Severity**: P0 - Blocks all profile updates

### Error
```
500 INTERNAL_SERVER_ERROR: An unexpected error occurred
AccessDeniedException: User: arn:aws:sts::346698404105:assumed-role/tenant-template-stack-bas-identityecsTaskRoleB20B60-ibt1HOQOAZeU/9ddb62f66ef34f7eb4559122b5d70d0c is not authorized to perform: cognito-idp:AdminUpdateUserAttributes on resource: arn:aws:cognito-idp:us-east-1:346698404105:userpool/us-east-1_Ituu6vuqD because no identity-based policy allows the cognito-idp:AdminUpdateUserAttributes action
```

### Root Cause
The ECS Task Role (`tenant-template-stack-bas-identityecsTaskRoleB20B60-ibt1HOQOAZeU`) does not have IAM permission to update Cognito user attributes.

### Stack Trace Location
```
at UsersService.updateUser (/app/dist/microservices/identity/main.js:2608:13)
```

### Action Required (Backend Infrastructure)

**1. Update ECS Task Role IAM Policy**

Add the following permission to the ECS Task Role:

```json
{
  "Effect": "Allow",
  "Action": [
    "cognito-idp:AdminUpdateUserAttributes",
    "cognito-idp:AdminGetUser"
  ],
  "Resource": "arn:aws:cognito-idp:us-east-1:346698404105:userpool/us-east-1_Ituu6vuqD"
}
```

**2. Verify IAM Policy Attachment**

Ensure the policy is attached to:
- Role: `tenant-template-stack-bas-identityecsTaskRoleB20B60-ibt1HOQOAZeU`
- Or the role used by the Identity Service ECS task

**3. Test After Fix**

```bash
# Verify the role has the permission
aws iam get-role-policy \
  --role-name tenant-template-stack-bas-identityecsTaskRoleB20B60-ibt1HOQOAZeU \
  --policy-name CognitoUserManagement
```

---

## Issue #6: Password Change Error Handling (P1)

**Severity**: P1 - Poor user experience

### Error
```
401 UNAUTHORIZED: Current password is incorrect
```

### Current Behavior
- Backend returns generic 401 with message "Current password is incorrect"
- Frontend shows error but doesn't provide clear guidance
- User may be confused if password is actually correct

### Action Required

**1. Backend: Return Specific Error Code**

```typescript
// Instead of generic 401, return:
{
  "statusCode": 400,
  "errorCode": "INVALID_CURRENT_PASSWORD",
  "message": "The current password you entered is incorrect. Please try again.",
  "field": "currentPassword"
}
```

**2. Frontend: Enhanced Error Display**

Frontend will display:
- Clear message: "The current password you entered is incorrect"
- Highlight the current password field
- Provide link to "Forgot password?" if applicable

**3. Security Best Practice**

- Do NOT reveal if user account exists
- Do NOT provide hints about password format
- Rate limit password attempts (already implemented)

---

## Issue #7: CORS Preflight Failure (P0 CRITICAL)

**Severity**: P0 - Blocks all PATCH requests from browser

### Error
```
CORS error: MethodDisallowedByPreflightResponse
Status: CORS error
Request: PATCH /users/{id}/preferences
Initiator: api.ts:205
```

### Root Cause
Backend CORS configuration does not allow `PATCH` method in preflight response.

### Action Required (Backend)

**1. Update CORS Configuration**

Ensure your NestJS CORS configuration allows PATCH:

```typescript
// main.ts
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Correlation-Id'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
});
```

**2. Verify API Gateway CORS (if using)**

If using API Gateway, ensure CORS is configured:
- Allow `PATCH` in Access-Control-Allow-Methods
- Include all required headers in Access-Control-Allow-Headers

**3. Test CORS Preflight**

```bash
curl -X OPTIONS https://your-api.com/users/123/preferences \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: PATCH" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

Expected response headers:
```
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization,X-Tenant-Id,X-Correlation-Id
Access-Control-Allow-Origin: http://localhost:3000
```

---

## Developer DX: CORS Workaround (Development Only)

**⚠️ WARNING: For development only. Do NOT use in production.**

### Option 1: Browser Extension (Quickest)

Install a CORS browser extension:
- **Chrome**: "CORS Unblock" or "Allow CORS: Access-Control-Allow-Origin"
- **Firefox**: "CORS Everywhere"

**Disable immediately after testing.**

### Option 2: Proxy Development Server

Add to `vite.config.ts` or `rsbuild.config.ts`:

```typescript
// rsbuild.config.ts
export default {
  server: {
    proxy: {
      '/api': {
        target: 'https://your-backend-api.com',
        changeOrigin: true,
        secure: true,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      },
    },
  },
};
```

### Option 3: Local Backend CORS Override

**Temporary fix** - Add to backend `main.ts` (remove after proper CORS setup):

```typescript
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Tenant-Id,X-Correlation-Id');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }
  next();
});
```

---

## Issue #4: MFA Backend Requires Access Token (Post-MVP)

**Severity**: Post-MVP (Frontend disabled)

### Error
```
NotAuthorizedException: Invalid Access Token
at SecurityService.initiateMfaSetup
```

### Root Cause
Backend is sending **ID Token** to Cognito MFA APIs, which require **Access Token**.

### Action Required (Post-MVP)
1. Use Access Token (not ID Token) for Cognito MFA operations
2. Ensure token is passed correctly to `AssociateSoftwareToken` API

---

## Preferences API Contract

### GET /users/{id}/preferences

Returns flat notification structure:
```json
{
  "tenantId": "uuid",
  "userId": "uuid",
  "theme": "light" | "dark" | "system",
  "language": "en-US",
  "timezone": "America/New_York",
  "dateFormat": "MM/DD/YYYY",
  "timeFormat": "12h" | "24h",
  "weekStartsOn": "sunday" | "monday",
  "notifications": {
    "email": true,
    "push": true,
    "sms": false,
    "digest": "immediate" | "daily" | "weekly" | "never"
  },
  "defaultSchoolId": "uuid | null",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "version": 1
}
```

### PATCH /users/{id}/preferences

Frontend sends flat structure (aligned with backend):
```json
{
  "theme": "dark",
  "language": "en-US",
  "timezone": "America/Los_Angeles",
  "dateFormat": "YYYY-MM-DD",
  "timeFormat": "24h",
  "weekStartsOn": "monday",
  "notifications": {
    "email": true,
    "push": false,
    "sms": false,
    "digest": "daily"
  }
}
```

---

## Frontend Alignment Summary

| Issue | Frontend Fix Applied | Backend Required |
|-------|---------------------|------------------|
| phoneCountryCode | ✅ Removed from DTO | Verify no extra validation |
| Notifications | ✅ Flatten on PATCH | No change needed |
| Password regex | ✅ Match backend chars | Document allowed chars |
| IAM Permissions | ⏸️ Waiting | Add `cognito-idp:AdminUpdateUserAttributes` |
| CORS | ⏸️ Waiting | Allow PATCH in CORS config |
| Password Error | ⏸️ Waiting | Return `INVALID_CURRENT_PASSWORD` code |
| MFA | ✅ UI disabled | Fix Access Token (Post-MVP) |
| Sessions | ✅ UI disabled | N/A (Post-MVP) |

---

## Testing Checklist

After backend fixes:

### Critical (P0)
- [ ] **IAM Fix**: `PATCH /users/{id}` with `firstName`, `lastName` succeeds (no 500 error)
- [ ] **CORS Fix**: `PATCH /users/{id}/preferences` preflight succeeds (no CORS error)
- [ ] `PATCH /users/{id}` with `phone: "+1 555-123-4567"` succeeds
- [ ] `PATCH /users/{id}` with `address` object succeeds

### High Priority (P1)
- [ ] `POST /users/{id}/security/change-password` with correct current password succeeds
- [ ] `POST /users/{id}/security/change-password` with wrong current password returns `INVALID_CURRENT_PASSWORD` error code
- [ ] `POST /users/{id}/security/change-password` with `NewPass@123!` succeeds
- [ ] `POST /users/{id}/security/change-password` with `NewPass_123` fails (underscore not allowed)
- [ ] `GET /tenants/{id}` returns tenant details (fix 404)

---

## Recommended: OpenAPI Contract Generation

To prevent future misalignment, implement:

1. **Generate OpenAPI spec** from NestJS with `@nestjs/swagger`
2. **Generate TypeScript types** using `openapi-typescript`
3. **Share types package** between backend and frontend
4. **Version APIs** for breaking changes

See separate document: `BACKEND_OPENAPI_SETUP_PROMPT.md` for implementation guide.

---

*Report generated from EdForge Shell Module v0.0.1*

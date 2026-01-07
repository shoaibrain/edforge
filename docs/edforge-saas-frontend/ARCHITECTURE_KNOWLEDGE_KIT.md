# EdForge MFE Architecture Knowledge Kit v2.1

> Technical guide for backend engineers. Focus: Identity Service API contracts for the Shell module.

---

## 1. Architecture Overview

EdForge is a **multi-tenant EMIS** built as a **Micro-Frontend (MFE)** using **Module Federation**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SHELL APPLICATION                               │
│    (Authentication, Routing, Layout, Theme, ABAC, Multi-tenant Context)     │
│                              Port: 3000                                      │
├────────────┬────────────┬────────────┬────────────┬────────────┬────────────┤
│ Academics  │  Finance   │   People   │  Messages  │ Analytics  │  Special   │
│   :3002    │   :3003    │   :3006    │   :3007    │   :3008    │  Programs  │
│            │            │            │            │            │   :3005    │
├────────────┴────────────┴────────────┴────────────┴────────────┴────────────┤
│                            Ed-Fi Remote (:3001)                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Rsbuild + Module Federation |
| Routing | TanStack Router |
| State | Zustand (persisted in cookies) |
| Auth | AWS Cognito (OAuth2/PKCE) |
| API Client | Axios with JWT interceptor |
| Styling | Tailwind CSS |

---

## 2. Authentication Architecture

### 2.1 Flow Overview

The frontend uses **AWS Cognito Hosted UI** with **OAuth2 Authorization Code + PKCE** flow:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User clicks "Sign In with Cognito"                                     │
│         │                                                                   │
│         ▼                                                                   │
│  2. Redirect to Cognito Hosted UI (signInWithRedirect)                     │
│         │                                                                   │
│         ▼                                                                   │
│  3. User authenticates (credentials or SSO)                                │
│         │                                                                   │
│         ▼                                                                   │
│  4. Redirect back with ?code=... (authorization code)                      │
│         │                                                                   │
│         ▼                                                                   │
│  5. Amplify exchanges code for tokens (automatic)                          │
│         │                                                                   │
│         ▼                                                                   │
│  6. ID token payload extracted, mapped to UserIdentity                     │
│         │                                                                   │
│         ▼                                                                   │
│  7. Shell fetches /users/me for school assignments                         │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Cognito Custom Claims (Required)

The backend must configure these **custom attributes** in the Cognito User Pool:

| Claim | Type | Description |
|-------|------|-------------|
| `custom:tenantId` | String | UUID of the tenant |
| `custom:tenantName` | String | Display name for tenant |
| `custom:tenantTier` | String | BASIC, PROFESSIONAL, ENTERPRISE |
| `custom:userRole` | String | GlobalRole: TenantAdmin or StandardUser |

### 2.3 Frontend Token Handling

```typescript
// @edforge/auth package exports
interface CognitoIdTokenPayload {
  sub: string                      // Cognito user ID
  email: string
  name?: string
  'custom:tenantId': string        // Required for X-Tenant-Id header
  'custom:tenantName': string
  'custom:tenantTier': string
  'custom:userRole': string        // GlobalRole
  exp: number                      // Expiration timestamp
}
```

### 2.4 API Request Headers

Every API request includes these headers (set by `lib/api.ts` interceptor):

```
Authorization: Bearer <idToken>
X-Tenant-Id: <extracted from custom:tenantId>
X-Correlation-Id: <uuid>
Content-Type: application/json
```

---

## 3. Identity Service API Contracts

> **Critical for MVP**: These endpoints are actively called by the Shell module.

### 3.1 User Context Endpoints (Shell Initialization)

Called on app load to initialize multi-tenant context:

```bash
# Get authenticated user profile with assignments
GET /users/me → UserProfile

# Get user's school assignments (if not in /users/me)
GET /users/{userId}/assignments → SchoolAssignment[]
```

**UserProfile Response:**
```typescript
interface UserProfile {
  id: string
  email: string
  name?: string
  tenantId: string
  tenantName: string
  globalRole: 'TenantAdmin' | 'StandardUser'
  assignments: SchoolAssignment[]
  createdAt: string
  updatedAt: string
}

interface SchoolAssignment {
  schoolId: string
  schoolName: string
  role: SchoolRole  // Principal | Teacher | Accountant | Staff | Student | Parent
}
```

### 3.2 User Profile Endpoints (Settings → Account)

```bash
# Get user profile for editing
GET /users/{userId} → UserResponseDto

# Update user profile
PATCH /users/{userId} → UserResponseDto
Body: UpdateUserDto

# Avatar management
POST /users/{userId}/avatar/upload-url → AvatarUploadUrlResponse
DELETE /users/{userId}/avatar
```

**UserResponseDto:**
```typescript
interface UserResponseDto {
  userId: string
  email: string                    // Immutable
  firstName: string
  lastName: string
  middleName?: string
  displayName?: string
  phone?: string
  phoneCountryCode?: string
  avatarUrl?: string               // S3 URL
  address?: {
    street: string
    street2?: string
    city: string
    state: string
    postalCode: string
    country: string
  }
  globalRole: 'TenantAdmin' | 'StandardUser'
  status: 'pending' | 'active' | 'inactive' | 'suspended'
  mfaEnabled?: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}
```

**UpdateUserDto (PATCH body):**
```typescript
interface UpdateUserDto {
  firstName?: string
  lastName?: string
  middleName?: string
  displayName?: string
  phone?: string
  phoneCountryCode?: string
  address?: Partial<UserAddress>
  // email, globalRole, status NOT updatable via this endpoint
}
```

### 3.3 Preferences Endpoints (Settings → Preferences/Notifications)

```bash
# Get user preferences
GET /users/{userId}/preferences → UserPreferences

# Update preferences (partial update)
PATCH /users/{userId}/preferences → UserPreferences
Body: UpdatePreferencesDto
```

**UserPreferences:**
```typescript
interface UserPreferences {
  tenantId: string
  userId: string
  theme: 'light' | 'dark' | 'system'
  language: string                 // e.g., 'en-US'
  timezone: string                 // e.g., 'America/New_York'
  dateFormat: string               // 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
  timeFormat: '12h' | '24h'
  weekStartsOn: 'sunday' | 'monday'
  notifications: {
    channels: {
      email: { enabled: boolean, digest: 'immediate' | 'daily' | 'weekly' | 'never' }
      push: { enabled: boolean }
      sms: { enabled: boolean, phone?: string }
    }
    categories: {
      announcements: boolean
      attendance: boolean
      grades: boolean
      messages: boolean
      calendar: boolean
      billing: boolean
      security: boolean           // Always true, not editable
    }
  }
  defaultSchoolId?: string
  createdAt: string
  updatedAt: string
  version: number                  // Optimistic locking
}
```

### 3.4 Security Endpoints (Settings → Security) — Post-MVP

```bash
GET    /users/{userId}/security                     → SecurityOverview
POST   /users/{userId}/security/change-password     → { success, message }
POST   /users/{userId}/security/mfa/setup           → MfaSetupResponse
POST   /users/{userId}/security/mfa/verify          → { success, backupCodes }
POST   /users/{userId}/security/mfa/disable         → { success }
GET    /users/{userId}/security/sessions            → UserSession[]
DELETE /users/{userId}/security/sessions/{sessionId}
POST   /users/{userId}/security/sessions/revoke-all → { success, revokedCount }
GET    /users/{userId}/security/login-history       → LoginHistoryEntry[]
```

### 3.5 Tenant & Schools Endpoints (TenantAdmin Only)

```bash
# Tenant management
GET  /tenants/{tenantId}      → Tenant
PUT  /tenants/{tenantId}      → Tenant

# Schools management
GET    /schools?tenantId=     → School[]
GET    /schools/{schoolId}    → School
POST   /schools               → School
PUT    /schools/{schoolId}    → School
DELETE /schools/{schoolId}    → void (soft delete)

# School years
GET /school-years?tenantId=   → SchoolYear[]
```

---

## 4. MVP Endpoint Priority Matrix

| Priority | Endpoint | Used By | Status |
|----------|----------|---------|--------|
| **P0** | `GET /users/me` | Shell context | Required |
| **P0** | `GET /tenants/{id}` | Shell context | Required |
| **P0** | `GET /schools` | Shell context | Required |
| **P1** | `GET /users/{id}` | Account page | Required |
| **P1** | `PATCH /users/{id}` | Account page | Required |
| **P1** | `GET /users/{id}/preferences` | Preferences page | Required |
| **P1** | `PATCH /users/{id}/preferences` | Preferences page | Required |
| **P2** | `POST /users/{id}/avatar/upload-url` | Account page | Requires S3 |
| **P2** | `DELETE /users/{id}/avatar` | Account page | Requires S3 |
| **P3** | Security endpoints | Security page | Post-MVP |
| **P3** | School CRUD endpoints | Schools settings | Post-MVP |

---

## 5. Multi-Tenancy Model

### 5.1 Tenant Hierarchy

```
Tenant (District/Organization)
 └── Schools[]
      └── SchoolYears[]
           └── Terms[]
      └── Users[] (with school-specific roles via assignments)
```

### 5.2 Frontend Context Resolution

```typescript
// Shell context provides:
interface ShellContext {
  user: UserIdentity              // From auth + /users/me
  tenant: Tenant                  // From /tenants/{tenantId}
  availableSchools: School[]      // From /schools?tenantId=
  activeSchool: School | null     // User-selected school
  activeSchoolYear: SchoolYear    // From /school-years
}
```

### 5.3 School Role Permissions

| Role | Scope | Permissions |
|------|-------|-------------|
| TenantAdmin | All schools | Full access, manage tenant settings |
| Principal | Single school | Full school access, approve workflows |
| Teacher | Single school | Class access, grading |
| Accountant | Cross-school | Finance access only |
| Staff | Single school | Limited operational access |
| Student | Single school | Student portal only |
| Parent | Multi-school | Read-only parent portal |

---

## 6. API Response Standards

### Success Response
```json
{
  "data": { ... }
}
```

### Paginated Response
```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

### Error Response
```json
{
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "firstName": ["Required"],
    "email": ["Invalid format"]
  }
}
```

### HTTP Status Codes

| Code | Scenario |
|------|----------|
| 200 | Success |
| 400 | Validation error |
| 401 | Invalid/expired JWT |
| 403 | Forbidden (wrong tenant) |
| 404 | Resource not found |
| 409 | Conflict (optimistic lock) |

---

## 7. Backend Service Mapping

| Frontend Module | Backend Service | Deployment |
|-----------------|-----------------|------------|
| Shell (Settings) | identity-service | ECS |
| Shell (Tenant/Schools) | tenant-service | Lambda |
| Academics | academics-service | ECS |
| Finance | finance-service | Lambda |
| People | hr-service | Lambda |
| Messages | communications-service | Lambda |
| Analytics | analytics-service | Lambda |
| Special Programs | special-programs-service | Lambda |
| Ed-Fi | edfi-integration-service | Lambda |

---

*Last Updated: January 2026*
*Version: 2.1.0*

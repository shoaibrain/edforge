# EdForge MFE Technical Status Report

> Implementation Status: January 2026

---

## 1. Implementation Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Shell Application | ✅ Complete | Auth, routing, layout, settings |
| Module Federation | ✅ Complete | 7 remote modules configured |
| Authentication | ✅ Complete | AWS Cognito OAuth2/PKCE |
| Settings Module | ✅ Complete | 4 pages with TanStack Query |
| Multi-tenant Context | ✅ Complete | Tenant/school switching |
| Backend Integration | ⚠️ Partial | Waiting for identity-service APIs |

---

## 2. Shell Routes Structure

```
/                           → Auth redirect
/login                      → LoginPage (Cognito redirect)
/auth/callback              → OAuth callback handler

/home                       → HomePage (protected)

/settings                   → SettingsPage
  /account                  → AccountPage
  /preferences              → PreferencesPage
  /notifications            → NotificationsPage
  /security                 → SecurityPage
  /connections              → IntegrationsSettingsPage
  /general                  → PreferencesPage (alias)
  /access                   → PeopleSettingsPage
  /schools                  → SchoolsSettingsPage
  /billing                  → BillingSettingsPage
  /integrations             → IntegrationsSettingsPage
  /import-export            → IntegrationsSettingsPage
  /danger-zone              → DangerZonePage

/academics/$                → AcademicsModule (remote)
/finance/$                  → FinanceModule (remote)
/people/$                   → PeopleModule (remote)
/messages/$                 → MessagesModule (remote)
/analytics/$                → AnalyticsModule (remote)
/edfi/$                     → EdFiModule (remote)
/special-programs/$         → SpecialProgramsModule (remote)

/student-portal             → Placeholder
/parent-portal              → Placeholder
```

---

## 3. Authentication Implementation

### Source Files
- `packages/auth/src/service.ts` - Amplify v6 auth operations
- `packages/auth/src/config.ts` - Cognito configuration
- `apps/shell/src/stores/auth.store.ts` - Zustand auth state
- `apps/shell/src/lib/api.ts` - Axios JWT interceptor

### Auth Flow
1. `signInWithRedirect()` → Cognito Hosted UI
2. OAuth callback → Amplify exchanges code for tokens
3. `getIdTokenPayload()` → Extract custom claims
4. `mapCognitoToUserIdentity()` → Create UserIdentity
5. Shell context fetches `/users/me` for assignments

### Required Environment Variables
```bash
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
VITE_COGNITO_DOMAIN=
VITE_COGNITO_REGION=us-east-1
VITE_REDIRECT_SIGN_IN=http://localhost:3000
VITE_REDIRECT_SIGN_OUT=http://localhost:3000
VITE_API_URL=
```

### Dev Mode
Without Cognito config, mock users are available via `loginAsMock()`:
- tenant-admin, principal, teacher, accountant, student, parent

---

## 4. API Service Layer

### tenant.service.ts — Active Endpoints

| Method | Endpoint | Used In |
|--------|----------|---------|
| `getCurrentUser()` | `GET /users/me` | ShellContext |
| `getUserAssignments()` | `GET /users/{id}/assignments` | ShellContext |
| `getTenant()` | `GET /tenants/{id}` | ShellContext |
| `updateTenant()` | `PUT /tenants/{id}` | — |
| `getSchools()` | `GET /schools?tenantId=` | ShellContext |
| `getSchool()` | `GET /schools/{id}` | — |
| `createSchool()` | `POST /schools` | — |
| `updateSchool()` | `PUT /schools/{id}` | — |
| `deleteSchool()` | `DELETE /schools/{id}` | — |
| `getSchoolYears()` | `GET /school-years?tenantId=` | ShellContext |

### users.service.ts — Active Endpoints

| Method | Endpoint | Used In |
|--------|----------|---------|
| `getUser()` | `GET /users/{id}` | AccountPage |
| `updateUser()` | `PATCH /users/{id}` | AccountPage |
| `getPreferences()` | `GET /users/{id}/preferences` | PreferencesPage, NotificationsPage |
| `updatePreferences()` | `PATCH /users/{id}/preferences` | PreferencesPage, NotificationsPage |
| `getAvatarUploadUrl()` | `POST /users/{id}/avatar/upload-url` | AccountPage |
| `uploadAvatar()` | S3 + PATCH | AccountPage |
| `removeAvatar()` | `DELETE /users/{id}/avatar` | AccountPage |
| `getSecurityOverview()` | `GET /users/{id}/security` | SecurityPage |
| `changePassword()` | `POST /users/{id}/security/change-password` | SecurityPage |
| `initiateMfaSetup()` | `POST /users/{id}/security/mfa/setup` | SecurityPage |
| `verifyAndEnableMfa()` | `POST /users/{id}/security/mfa/verify` | SecurityPage |
| `disableMfa()` | `POST /users/{id}/security/mfa/disable` | SecurityPage |
| `getActiveSessions()` | `GET /users/{id}/security/sessions` | SecurityPage |
| `revokeSession()` | `DELETE /users/{id}/security/sessions/{sessionId}` | SecurityPage |
| `revokeAllSessions()` | `POST /users/{id}/security/sessions/revoke-all` | SecurityPage |
| `getLoginHistory()` | `GET /users/{id}/security/login-history` | SecurityPage |

---

## 5. Settings Module Implementation

### Account Page (`account.tsx`)
- **Query:** `usersService.getUser(userId)`
- **Mutation:** `usersService.updateUser(userId, data)`
- **Avatar:** `uploadAvatar()`, `removeAvatar()`
- **Form:** React Hook Form + Zod validation
- **Fields:** firstName, lastName, middleName, displayName, phone, address

### Preferences Page (`preferences.tsx`)
- **Query:** `usersService.getPreferences(userId)`
- **Mutation:** `usersService.updatePreferences(userId, data)`
- **Fields:** theme, language, timezone, dateFormat, timeFormat, weekStartsOn, defaultSchoolId

### Notifications Page (`notifications.tsx`)
- **Query:** `usersService.getPreferences(userId)`
- **Mutation:** `usersService.updatePreferences(userId, { notifications })`
- **Fields:** channels (email/push/sms), categories (announcements/attendance/grades/etc.)

### Security Page (`security.tsx`)
- **Queries:** `getSecurityOverview`, `getActiveSessions`, `getLoginHistory`
- **Mutations:** `changePassword`, MFA setup/verify/disable, session management
- **Status:** UI complete, backend endpoints not yet implemented

---

## 6. Shell Context (shell-context.tsx)

Provides app-wide state via React Context + TanStack Query:

```typescript
interface ShellContextValue {
  user: UserIdentity              // From auth store
  tenant: Tenant | null           // From /tenants/{tenantId}
  availableSchools: School[]      // From /schools?tenantId=
  activeSchool: School | null     // User-selected
  activeSchoolYear: SchoolYear | null
  setActiveSchool: (school) => void
}
```

**Query Keys:**
- `['user-profile']` → `/users/me`
- `['tenant', tenantId]` → `/tenants/{tenantId}`
- `['schools', tenantId]` → `/schools?tenantId=`
- `['current-school-year', tenantId]` → `/school-years?tenantId=`

---

## 7. Module Federation Configuration

### Remote Modules

| Module | Port | Federation Name | Entry Point |
|--------|------|-----------------|-------------|
| Shell | 3000 | shell | Host only |
| Academics | 3002 | academics | AcademicsModule |
| Finance | 3003 | finance | FinanceModule |
| Ed-Fi | 3001 | edfi | EdFiModule |
| Special Programs | 3005 | special_programs | SpecialProgramsModule |
| People | 3006 | people | PeopleModule |
| Messages | 3007 | messages | MessagesModule |
| Analytics | 3008 | analytics | AnalyticsModule |

### Shared Dependencies (Singletons)
- react, react-dom (^19.0.0)
- @tanstack/react-query, @tanstack/react-router
- zustand, framer-motion
- @edforge/ui, @edforge/abac, @edforge/types, @edforge/theme

---

## 8. Outstanding Backend Requirements

### P0 (MVP Blockers)
- [ ] `GET /users/me` - User profile with assignments
- [ ] `GET /tenants/{tenantId}` - Tenant details
- [ ] `GET /schools?tenantId=` - List schools

### P1 (Settings MVP)
- [ ] `GET /users/{userId}` - User profile
- [ ] `PATCH /users/{userId}` - Update profile
- [ ] `GET /users/{userId}/preferences` - Preferences
- [ ] `PATCH /users/{userId}/preferences` - Update preferences

### P2 (Settings Complete)
- [ ] Avatar upload (S3 presigned URLs)
- [ ] School CRUD endpoints

### P3 (Post-MVP)
- [ ] All security endpoints (password, MFA, sessions)
- [ ] Login history / audit logging

---

## 9. Development Commands

```bash
# Install dependencies
pnpm install

# Start all apps
pnpm dev

# Start shell only
pnpm --filter @edforge/shell dev

# Type check
pnpm turbo run typecheck

# Build
pnpm turbo run build
```

---

*Report Generated: January 2026*
*Version: 2.1.0*

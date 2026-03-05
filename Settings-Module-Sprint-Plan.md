# Settings Module — MVP Fix Sprint Plan

## Context

The Settings module in the Shell application has several critical bugs discovered during UAT testing ahead of MVP pilot school deployment. The issues span the full stack: frontend data normalization bugs, missing backend API endpoints, and data model mismatches between frontend/backend. This plan addresses every issue identified in the UAT feedback document, organized into atomic, commitable tasks across 4 sprints.

### Architecture Summary
- **Frontend**: React SPA (Rspack/Module Federation), TanStack Router/Query, Zustand, Sonner toasts
- **Backend**: NestJS on AWS (Cognito + DynamoDB single-table design)
- **Shared Types**: `@aibrains/shared-types` Zod schemas (single source of truth)
- **API Proxy**: Vercel rewrites `/api/*` → AWS API Gateway → NestJS

### Deployment Order Constraint
Backend must be deployed before frontend for Sprints 1-3. Shared-types package must be rebuilt and published before any consumer (frontend or backend) that depends on schema changes.

---

## Bug Summary (UAT Findings → Root Causes)

| # | Bug | Severity | Root Cause |
|---|-----|----------|------------|
| 1 | Address data dropped on My Account save | HIGH | Backend `User` entity has no `address` field; `updateUser()` ignores it; `toUserResponse()` omits it; `SELF_EDITABLE_FIELDS` missing `'address'` |
| 2 | Notification toggles always show ON | HIGH | `normalizePreferences()` hardcodes all categories to `true`; `flattenPreferencesForBackend()` strips categories; backend flat/nested format inconsistency |
| 3 | Workspace Settings page 403 Forbidden | CRITICAL | Backend has NO endpoint for `GET/PATCH /tenants/:tenantId/settings`; API Gateway has no route mapping |
| 4 | Middle name field should be removed | LOW | Simple UI removal from form, schema, and DTO |
| 5 | MOCK_SCHOOLS used for school names | MEDIUM | `preferences.tsx` uses mock data instead of real user assignments |
| 6 | Academic Calendar in wrong place | MEDIUM | Per Ed-Fi, academic calendars are per-school-per-year, not tenant-level |
| 7 | Notification data model inconsistency | HIGH | `createDefaultPreferences()` stores nested format, `updatePreferencesSchema` accepts flat, causing storage format inconsistency |
| 8 | nginx/rproxy IPv6 resolution failure | MEDIUM | Reverse proxy resolves to IPv6 addresses unreachable in ECS networking |

---

## Sprint 1: Backend Data Persistence Foundations

**Goal**: Fix backend so it can accept, persist, and return all data the frontend sends. Every subsequent sprint depends on this.

**Demo**: After this sprint, `curl` commands against the API successfully persist and return address data, workspace settings, and nested notification preferences.

---

### S1-T1: Add `address` field to User entity and DynamoDB persistence

**Description**: The `User` interface in the backend has no `address` field. The `updateUser()` service method ignores `address` from the DTO, and `toUserResponse()` doesn't return it. The shared-types schema already includes `address` — the backend implementation simply never wired it up.

**Files to modify**:
- `server/application/microservices/identity/src/common/entities/user.entity.ts` — Add `address?: UserAddress` to `User` interface
- `server/application/microservices/identity/src/users/users.service.ts` — Add `address` handling in `updateUser()` (after line 359), add `address` to `toUserResponse()` (lines 948-965)
- `server/application/microservices/identity/src/users/users.controller.ts` — Add `'address'` to `SELF_EDITABLE_FIELDS` array (line 239)

**Changes**:
1. In `user.entity.ts`, add to the `User` interface:
   ```ts
   address?: {
     street?: string;
     street2?: string;
     city?: string;
     state?: string;
     postalCode?: string;
     country?: string;
   };
   ```
2. In `users.service.ts` `updateUser()`, after the `avatarUrl` handling block (~line 359), add:
   ```ts
   if (updateUserDto.address !== undefined) {
     updates.push('address = :address');
     values[':address'] = updateUserDto.address;
   }
   ```
3. In `toUserResponse()`, add `address: user.address` to the return object.
4. In `users.controller.ts`, add `'address'` to `SELF_EDITABLE_FIELDS`.

**Validation**:
- `PATCH /users/:id` with `{ address: { street: "123 Main St", city: "Dallas", state: "TX", postalCode: "75001", country: "US" } }` → response includes `address` object
- Subsequent `GET /users/:id` → returns the persisted address
- Non-admin self-edit includes address → does NOT get 403
- Run `npm test -- --testPathPattern=users.service` — existing tests pass

**Depends on**: Nothing

---

### S1-T2: Add Workspace Settings Zod schema to shared-types

**Description**: Define the data contract for workspace settings in the shared-types package (single source of truth) before implementing the backend endpoint.

**Files to modify**:
- `packages/shared-types/src/schemas/identity/tenant.schema.ts` — Add `workspaceSettingsSchema`, `updateWorkspaceSettingsSchema`
- `packages/shared-types/src/schemas/identity/index.ts` — Re-export new schemas
- `packages/shared-types/src/index.ts` — Re-export from identity index

**Changes**:
```ts
export const regionalSettingsSchema = z.object({
  defaultTimezone: z.string().default('America/New_York'),
  defaultLocale: z.string().default('en-US'),
  defaultDateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).default('MM/DD/YYYY'),
  defaultTimeFormat: z.enum(['12h', '24h']).default('12h'),
  defaultWeekStartsOn: z.enum(['sunday', 'monday']).default('sunday'),
});

export const brandingSettingsSchema = z.object({
  organizationName: z.string().max(200),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const policySettingsSchema = z.object({
  defaultAttendancePolicy: z.enum(['daily', 'period', 'both']).default('daily'),
});

export const workspaceSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  regional: regionalSettingsSchema,
  branding: brandingSettingsSchema,
  policies: policySettingsSchema,
  isLocked: z.boolean().default(false),
  lockReason: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const updateWorkspaceSettingsSchema = z.object({
  regional: regionalSettingsSchema.partial().optional(),
  branding: brandingSettingsSchema.partial().optional(),
  policies: policySettingsSchema.partial().optional(),
});
```

**Validation**:
- `pnpm build` in `packages/shared-types` succeeds
- Types are importable from `@aibrains/shared-types`

**Depends on**: Nothing

---

### S1-T3: Create Workspace Settings backend endpoint (`GET/PATCH /tenants/:tenantId/settings`)

**Description**: Implement the missing backend endpoints that the frontend workspace settings page depends on.

**Files to modify**:
- Create: `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts`
- `server/application/microservices/identity/src/tenants/tenants.controller.ts` — Add `GET :tenantId/settings` and `PATCH :tenantId/settings`
- `server/application/microservices/identity/src/tenants/tenants.service.ts` — Add `getWorkspaceSettings()` and `updateWorkspaceSettings()`
- `server/application/microservices/identity/src/common/dto/zod-dtos.ts` — Add `UpdateWorkspaceSettingsDtoZ`

**Changes**:
1. Define DynamoDB entity: PK `TENANT#{tenantId}`, SK `SETTINGS#WORKSPACE`
2. Create `createDefaultWorkspaceSettings(tenantId, createdBy)` factory
3. Add controller routes with `@RequireGlobalRole('TenantAdmin')` + `@UseGuards(GlobalRoleGuard)`
4. Service: `getWorkspaceSettings()` lazy-creates defaults; `updateWorkspaceSettings()` uses partial DynamoDB SET updates

**Validation**:
- `GET /tenants/{tenantId}/settings` → 200 with defaults on first call
- `PATCH /tenants/{tenantId}/settings` with `{ regional: { defaultTimezone: "America/Chicago" } }` → updated settings
- Non-TenantAdmin → 403
- Unauthenticated → 401

**Depends on**: S1-T2

---

### S1-T4: Register `/tenants/{tenantId}/settings` in API Gateway

**Description**: Verify the AWS API Gateway routes requests for the new path to the identity service. If using explicit route definitions (not catch-all), register the new path.

**Files to modify**:
- API Gateway configuration (CDK stack or AWS Console)

**Validation**:
- `curl` from production/staging: `GET /prod/tenants/{tenantId}/settings` → 200 (not 403 "Invalid key=value pair")

**Depends on**: S1-T3

---

### S1-T5: Fix notification preferences data model — backend normalization

**Description**: Standardize on nested format for storage. Accept flat format for backwards compatibility. Normalize on read.

**Files to modify**:
- `packages/shared-types/src/schemas/identity/user.schema.ts` — Update `updatePreferencesSchema` notifications to accept `z.union([flat, nested])`
- `server/application/microservices/identity/src/users/users.service.ts` — Normalize flat→nested in `updatePreferences()` and `getPreferences()`

**Changes**:
1. Shared-types: `notifications: z.union([flatNotificationsSchema, notificationPreferencesSchema]).optional()`
2. Backend `updatePreferences()`: Detect flat vs nested, convert flat→nested before storing, merge with existing categories
3. Backend `getPreferences()`: If stored data is flat (legacy), convert to nested before returning

**Validation**:
- `PATCH` with flat `{ notifications: { email: false } }` → response has nested `notifications.channels.email.enabled = false`
- `PATCH` with nested format → stored correctly
- `GET` → always returns nested format
- Rebuild shared-types: `pnpm build` succeeds

**Depends on**: S1-T2

---

## Sprint 2: Frontend Bug Fixes (User-Visible)

**Goal**: Fix the UI bugs users see — notification toggles, address form, middle name removal.

**Demo**: After this sprint, users can save addresses, toggle notifications correctly, and see a clean My Account form.

**Prerequisite**: Sprint 1 backend deployed.

---

### S2-T1: Fix notification toggle state initialization and synchronization

**Description**: `normalizePreferences()` hardcodes all categories to `true`. Fix it to use backend data.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/services/users.service.ts` — Fix `normalizePreferences()` (lines 197-249) and `flattenPreferencesForBackend()` (lines 270-296)

**Changes**:
1. Update `normalizePreferences()` to detect nested vs flat and derive categories from actual data
2. Update `flattenPreferencesForBackend()` to include categories in the payload

**Validation**:
- Backend has `categories.attendance = false` → Preferences page → Attendance toggle is OFF
- Toggle Grades OFF → PATCH payload includes `categories.grades = false` → Refresh → still OFF
- `pnpm tsc --noEmit` passes

**Depends on**: S1-T5

---

### S2-T2: Fix preferences page toggle handler payload

**Description**: Verify `handleCategoryToggle` sends correct payload and `useEffect` syncs state.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/preferences.tsx` — Verify/fix `handleCategoryToggle` (lines 300-318)

**Validation**:
- Toggle each of 4 MVP categories → state persists on refresh
- Rapid toggling → no race conditions
- All OFF → Refresh → all OFF

**Depends on**: S2-T1

---

### S2-T3: Remove middle name from My Account page

**Description**: Remove the middle name field from the account form per UAT feedback.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/account.tsx` — Remove middleName from defaults, reset, submit, JSX
- `edforge-saas-frontend/apps/shell/src/schemas/person.schema.ts` — Remove from `userProfileSchema`
- `edforge-saas-frontend/apps/shell/src/services/users.service.ts` — Remove from `UpdateUserDto`

**Validation**:
- No middle name field visible
- PATCH payload excludes `middleName`
- `pnpm tsc --noEmit` passes

**Depends on**: Nothing

---

### S2-T4: Fix address data round-trip on My Account

**Description**: Fix `onSubmit` to always include address object, enabling save and clear.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/account.tsx` — Fix `onSubmit` (lines 446-460)

**Validation**:
- Fill all address fields → Save → Refresh → populated
- Clear one field → Save → Refresh → cleared
- PATCH payload always includes `address` object

**Depends on**: S1-T1

---

## Sprint 3: Workspace Settings End-to-End

**Goal**: Complete Workspace Settings with working backend integration.

**Demo**: TenantAdmin can edit regional, branding, and policy settings and see them persist.

---

### S3-T1: Align frontend WorkspaceSettings type with backend schema

**Description**: Update local type, remove `calendar` and `defaultGradingScale`, match backend entity.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/workspace.tsx`
- `edforge-saas-frontend/apps/shell/src/services/tenant.service.ts`

**Validation**:
- `pnpm tsc --noEmit` passes
- Page loads with backend data

**Depends on**: S1-T3, S1-T4

---

### S3-T2: Remove Academic Calendar section from Workspace Settings UI

**Description**: Per Ed-Fi standards, academic calendars are per-school-per-year. Remove from workspace.

**Files to modify**:
- `edforge-saas-frontend/apps/shell/src/pages/settings/workspace.tsx` — Remove calendar section JSX and related handlers

**Validation**:
- No Academic Calendar section visible
- Save works for remaining sections

**Depends on**: S3-T1

---

### S3-T3: End-to-end workspace settings save/load cycle

**Description**: Verify full round-trip: edit → save → reload → data persists.

**Files to modify**:
- Fix any mapping issues found during testing

**Validation**:
- Edit timezone → Save → toast success → Refresh → persisted
- Edit org name/colors → Save → Refresh → persisted
- Unsaved changes bar works correctly
- Reset button restores original values

**Depends on**: S3-T1, S3-T2

---

### S3-T4: Implement workspace settings lock enforcement on backend

**Description**: Backend should reject updates when `isLocked = true`.

**Files to modify**:
- Backend tenants service `updateWorkspaceSettings()` — Add lock check

**Validation**:
- `isLocked: true` → PATCH → 403 with lock message
- `isLocked: false` → PATCH → 200

**Depends on**: S1-T3

---

## Sprint 4: Polish, Cleanup & Hardening

**Goal**: Remove tech debt, fix minor issues, harden for pilot deployment.

**Demo**: All settings pages are robust with proper error states, real data, and clean UI.

---

### S4-T1: Replace MOCK_SCHOOLS with real school data in preferences

**Files**: `edforge-saas-frontend/apps/shell/src/pages/settings/preferences.tsx`

**Change**: Replace `MOCK_SCHOOLS` import with `user.assignments.map(a => ({ id: a.schoolId, name: a.schoolName }))`

**Validation**: Real school names shown; 0/1/2+ school cases handled correctly

---

### S4-T2: Validate Security page password change flow

**Files**: `edforge-saas-frontend/apps/shell/src/pages/settings/security.tsx`

**Validation**: Wrong password → error; mismatched passwords → validation; valid change → success; Coming soon sections clean

---

### S4-T3: Fix nginx/rproxy IPv6 resolution issue

**Files**: Production nginx config

**Change**: Add `resolver 169.254.169.253 ipv6=off;` or equivalent

**Validation**: No `Network unreachable` errors in rproxy logs; `/users/me` resolves consistently

---

### S4-T4: Add error state handling for Workspace Settings page

**Files**: `edforge-saas-frontend/apps/shell/src/pages/settings/workspace.tsx`

**Change**: Add `isError`/`error` handling with Retry button

**Validation**: API failure → error message + Retry → works on retry

---

### S4-T5: Seed default workspace settings for existing tenants

**Description**: Verify S1-T3's lazy creation works, optionally create migration script.

**Validation**: Existing tenant with no `SETTINGS#WORKSPACE` → `GET` returns defaults (200, not 404); no duplicate creation

---

## Deferred / Parked for Post-MVP

| Item | Reason |
|------|--------|
| MFA (Two-Factor Auth) setup | Marked "Coming soon" — not needed for pilot |
| Session Management | Marked "Coming soon" — not needed for pilot |
| Billing page | Already parked in codebase |
| Integrations page | Already parked in codebase |
| Notification channel granularity (per-category per-channel matrix) | Over-engineering for MVP |
| Workspace settings inheritance to school-level overrides | Future feature |
| `middleName` removal from backend shared-types | Backend schema already has it optional |

---

## End-to-End Verification (After All Sprints)

1. **My Account**: Address saves/loads/clears. Phone persists. No middle name field. Avatar works.
2. **Preferences**: Notification toggles reflect and persist state. Theme works. Real school names.
3. **Workspace Settings**: Loads (no 403). Regional/branding/policy persist. No academic calendar. Error state works.
4. **Security**: Password change works. Coming soon sections clean.
5. **Build**: `pnpm build` (frontend + shared-types) succeeds. `npm test` (backend) passes.
6. **No regressions**: Organization, People, RBAC, School pages unaffected.

# EdForge — Production Readiness Sprint Plan (Final)

## Target: MVP Pilot (50-100 Schools, Year 1)

**Optimization Principle**: Ship the minimum viable hardening to safely serve 50-100 schools. Defer scale-tier features (DAX, X-Ray, GSI 7-12, circuit breakers, Redis) until traffic justifies them. Every sprint produces a demoable, testable increment.

**Revised after architectural review by subagent** — incorporated feedback on sprint ordering (compliance earlier, validation earlier), CI/CD as prerequisite, Redis deferral, staging environment, and pilot-specific gaps (provisioning, CSV import, feature flags).

---

## Architecture Review Summary

### What's Sound
- Single-table DynamoDB with TVM-based tenant isolation (IAM-level segregation)
- RBAC/ABAC with PermissionGuard + DataScopeService
- Module Federation MFE architecture with proper singleton enforcement
- Cognito JWT + Lambda Authorizer + STS flow
- EventBridge domain events with batch support
- Zustand + React Query state architecture with cookie persistence

### Critical Findings by Severity

| Severity | Count | Examples |
|----------|-------|---------|
| **CRITICAL** | 5 | Payment gateway creds in plaintext, CORS hardcoded to localhost, wildcard IAM in provisioning, XSS in EdFiPreview, ABAC not enforced in Academics MFE |
| **HIGH** | 10 | TVM token validation disabled by default, no MFA for admins, single ECS instance, no cross-tab logout, no error tracking, service-to-service auth weak, no CI/CD pipeline |
| **MEDIUM** | 25+ | In-memory cache only, fire-and-forget events, no soft-delete, financial precision (floats), race conditions in payments, session invalidation bug |
| **LOW** | 10+ | Regex parsing fragile, no pagination cursor validation, missing calendar date validation |

---

## Sprint 0: CI/CD Pipeline + Critical Security Fixes

**Goal**: Establish automated build/deploy pipeline AND eliminate all CRITICAL severity issues. Nothing else ships without CI/CD and these security fixes.

**Demo**: Push to `dev` branch → GitHub Actions builds, lints, tests → deploys to staging automatically. Staging shows no CORS leak, no XSS, no plaintext credentials.

### Task 0.0: Create CI/CD Pipeline (GitHub Actions)
- **Files**: `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-prod.yml`
- **What**: Create three workflows:
  - `ci.yml`: On PR to `dev`/`main` — lint, typecheck, build all services + MFEs, run unit tests
  - `deploy-staging.yml`: On merge to `dev` — `cdk deploy --context stage=staging`
  - `deploy-prod.yml`: On merge to `main` — require manual approval gate → `cdk deploy --context stage=production`
- **Validation**: Push PR → CI runs → green check. Merge to `dev` → staging deploys. Check `gh run list` for history.
- **Acceptance**: Every PR is automatically validated. No manual `cdk deploy` required for staging.

### Task 0.1: Provision Staging Environment
- **Files**: CDK context configuration, environment variables
- **What**: Create a `staging` stage with separate VPC, DynamoDB table, Cognito user pool, and API Gateway stage. Use the same CDK stacks with `stage` context variable. Configure environment-specific parameters in SSM.
- **Validation**: `cdk deploy --context stage=staging` succeeds. Staging API responds on a separate URL from production.
- **Acceptance**: Isolated staging environment for all subsequent sprint validation.

### Task 0.2: Fix CORS Hardcoded to Localhost in API Gateway
- **File**: `server/lib/tenant-api-prod.json` + `server/lib/bootstrap-template/control-plane-stack.ts`
- **What**: Replace hardcoded `http://localhost:3000` CORS origin with environment-variable-driven origins. Staging: `https://staging.edforge.app`. Production: `https://edforge.app`. Dev: `http://localhost:3000-3008`.
- **Validation**: Deploy to staging → `curl -H "Origin: http://evil.com" -I <api-url>` → no `Access-Control-Allow-Origin` header returned for unauthorized origins.
- **Acceptance**: Only whitelisted origins receive CORS headers. Smoke test: `scripts/smoke-tests/cors-check.ts`.

### Task 0.3: Encrypt Payment Gateway Credentials at Rest
- **File**: `server/application/microservices/finance/src/payment-gateways/payment-gateways.service.ts`
- **What**: Before storing `dto.credentials` in DynamoDB, encrypt using AWS KMS `Encrypt` API. On read, decrypt via KMS `Decrypt`. Create a shared `KmsEncryptionService` in libs.
- **Validation**: Query DynamoDB directly → credentials field is ciphertext blob, not plaintext JSON.
- **Acceptance**: `credentials` column is always encrypted. Service still reads/writes gateways normally.

### Task 0.4: Scope IAM Permissions in Provisioning Scripts
- **File**: `server/lib/bootstrap-template/core-appplane-stack.ts` (lines 31-37, 63-71)
- **What**: Replace `Action: "*", Resource: "*"` with scoped permissions: `cloudformation:*`, `ecs:*`, `dynamodb:*`, `iam:PassRole`, `cognito-idp:*`, `logs:*` on specific resource ARNs (use CDK `Arn.format()`).
- **Validation**: Deploy stack → verify provisioning Lambda can still create tenants. Run `aws iam simulate-principal-policy` to confirm it can't access S3/SQS/etc.
- **Acceptance**: Provisioning works. `iam:*` and `s3:*` are not in the policy.

### Task 0.5: Fix XSS in EdFiPreview Component
- **File**: `apps/shell/src/components/settings/EdFiPreview.tsx` (lines 29-39)
- **What**: Replace `dangerouslySetInnerHTML` with `<pre>{JSON.stringify(data, null, 2)}</pre>`. If syntax highlighting needed, use a safe library (e.g., `react-json-view`).
- **Validation**: Enter `<script>alert(1)</script>` in any form field → navigate to EdFi preview → script does NOT execute.
- **Acceptance**: No `dangerouslySetInnerHTML` usage in codebase (grep confirms).

### Task 0.6: Fix TVM Security Defaults (Token Validation + JWKS URI)
- **File**: `server/application/libs/auth/src/token-vending-machine.ts` (lines 27, 40)
- **What**: (a) Change `shouldValidateToken: boolean = false` to `true`. (b) Fix `${issuer}.well-known/jwks.json` to `${issuer}/.well-known/jwks.json`. Audit all TVM instantiations.
- **Validation**: Send request with invalid JWT → receive 401. Send with valid JWT → receive 200. JWKS fetch succeeds (check logs).
- **Acceptance**: TVM validates tokens by default. JWKS URI correctly formed.

### Task 0.7a: Enforce ABAC in Academics MFE — Route Guards
- **File**: `apps/academics/src/` — all top-level route components
- **What**: Wrap each route component (Students, Enrollment, Attendance, Grades, Classrooms) with `<RequirePermission resource="..." action="read">`. Unauthorized users see a 403 page.
- **Validation**: Login as Teacher → access grades route → allowed. Login as Parent → access grades route → only own students visible or 403.
- **Acceptance**: Every Academics route checks permissions before rendering.

### Task 0.7b: Enforce ABAC in Academics MFE — Grade API Hooks
- **File**: `apps/academics/src/hooks/useGrades.ts` and related grade hooks
- **What**: Add `can(user, { action: 'read/write', resource: 'grades', schoolId })` guard before API calls. Teachers should only see grades for their assigned sections.
- **Validation**: Login as Teacher → query grades → only own sections returned. Attempt to write grade for another teacher's section → rejected.
- **Acceptance**: Grade API hooks enforce ABAC.

### Task 0.7c: Enforce ABAC in Academics MFE — Attendance & Enrollment Hooks
- **File**: `apps/academics/src/hooks/useAttendance.ts`, `useEnrollment.ts`, `useStudents.ts`
- **What**: Same pattern as 0.7b — add `can()` guards to all data-fetching and mutation hooks.
- **Validation**: Login as Teacher → only see assigned sections' students in attendance. Login as Parent → see only own children's enrollment.
- **Acceptance**: All Academics data hooks enforce ABAC. Smoke test: `scripts/smoke-tests/abac-permissions.ts`.

---

## Sprint 1: Auth & Session Hardening

**Goal**: Make authentication robust for multi-hour teacher sessions across multiple tabs/devices. Fix session bugs that cause stuck login states.

**Demo**: Login → leave browser open 2 hours → token refreshes automatically → logout in Tab A → Tab B also logs out → re-login works without stuck state.

### Task 1.1: Fix Session Invalidation Flag Bug
- **File**: `apps/shell/src/stores/auth.store.ts` (lines 71-77)
- **What**: The `sessionStorage.setItem('session_invalidated', 'true')` flag is set on 401 but never cleared after successful login. Add `sessionStorage.removeItem('session_invalidated')` after successful `initializeAuth()` completion.
- **Validation**: Trigger 401 → redirected to login → login again → app loads normally (not stuck on login).
- **Acceptance**: No user reports of "stuck on login page" after session expiry.

### Task 1.2: Implement Cross-Tab Logout Synchronization
- **File**: `apps/shell/src/stores/auth.store.ts`
- **What**: Add `window.addEventListener('storage', handler)` that listens for auth cookie/token removal. When detected, call `logout()` in the current tab. Use existing `BroadcastChannel` if available, fall back to `storage` event.
- **Validation**: Open 2 tabs → logout in Tab A → Tab B redirects to login within 2 seconds.
- **Acceptance**: Cross-tab logout works in Chrome, Firefox, Safari.

### Task 1.3: Add Token Expiration Monitoring & Re-Auth Prompt
- **File**: `apps/shell/src/stores/auth.store.ts` + new `apps/shell/src/components/auth/SessionExpiryBanner.tsx`
- **What**: Decode JWT `exp` claim on login/refresh. Set a timer for `exp - 120 seconds`. When timer fires, show banner: "Your session expires in 2 minutes. Click to extend." On click, call `fetchAuthSession({ forceRefresh: true })`. If refresh fails, redirect to login.
- **Validation**: Set short token TTL (5 min for test) → banner appears at 3 min → click extend → token refreshes → banner disappears.
- **Acceptance**: Teachers in 2-hour grading sessions never silently lose their session.

### Task 1.4: Enable MFA for TenantAdmin Users
- **File**: `server/lib/tenant-template/identity-provider.ts`
- **What**: Enable Cognito Advanced Security (`StandardThreatProtectionMode.FULL`). Add TOTP MFA as optional for all users, required for TenantAdmin. Update frontend login flow to handle MFA challenge response.
- **Validation**: Login as TenantAdmin → prompted for TOTP code → enter code → access granted. Login as Teacher → no MFA prompt.
- **Acceptance**: TenantAdmin cannot complete login without TOTP.

### Task 1.5: Validate Cookie Format in Zustand Persistence
- **File**: `apps/shell/src/stores/auth.store.ts` (lines 203-225)
- **What**: Wrap cookie deserialization in try-catch. If cookie is malformed, clear the cookie and return default state.
- **Validation**: Manually corrupt `edforge-auth` cookie value → reload page → app redirects to login cleanly (no white screen).
- **Acceptance**: Corrupted cookies never crash the app.

### Task 1.6: Fix Status Desync Between Cognito and DynamoDB
- **File**: `server/application/microservices/identity/src/auth/auth.service.ts` (line 137)
- **What**: Before setting `status: 'active'` in DynamoDB, check Cognito `UserStatus`. If Cognito status is `DISABLED` or `UNCONFIRMED`, sync and deny login.
- **Validation**: Disable user in Cognito console → attempt login → receive 401.
- **Acceptance**: DynamoDB user status always matches Cognito.

### Task 1.7: Design Spike — Replace getSystemClient() in Auth Login Flow
- **File**: `server/application/microservices/identity/src/auth/auth.service.ts` (line 117)
- **What**: Document the bootstrap authentication flow with a sequence diagram. The challenge: login flow needs DynamoDB access before JWT exists. Options: (a) use Lambda Authorizer pre-validated tenant context, (b) use a tenant-scoped bootstrap credential with minimal permissions, (c) keep system client with explicitly minimized IAM policy. Select approach, document, implement.
- **Validation**: Login works end-to-end. Sequence diagram in docs. No privilege escalation possible during bootstrap.
- **Acceptance**: Clear documented decision. If system client kept, IAM policy explicitly limits to user/session tables only.

### Task 1.8: Auth Flow Smoke Test
- **File**: `scripts/smoke-tests/auth-flow.ts`
- **What**: Test: login with valid creds → receive tokens → refresh token → verify new access token → logout → verify refresh token invalidated → attempt API call → receive 401.
- **Validation**: Run test against staging → all assertions pass.
- **Acceptance**: Auth lifecycle fully tested. Runs in CI post-deploy.

---

## Sprint 2: Infrastructure Production Hardening

**Goal**: Make deployment resilient to instance failures, add observability, configure DynamoDB for production retention, set up domain/TLS.

**Demo**: Kill one ECS task → service stays up. View CloudWatch dashboard → see request metrics. DynamoDB table survives `cdk destroy`. HTTPS works on `edforge.app`.

### Task 2.1: Set ECS Desired Count to 2+ and Min Healthy to 100%
- **File**: `server/lib/tenant-template/services.ts` (lines 73, 77)
- **What**: Change `desiredCount: 1` → `desiredCount: 2`. Change `minHealthyPercent: 0` → `minHealthyPercent: 100`.
- **Validation**: Deploy → verify 2 tasks running across different AZs. Trigger rolling deploy → zero-downtime.
- **Acceptance**: `aws ecs describe-services` shows 2 running tasks, `minimumHealthyPercent: 100`.

### Task 2.2: Upgrade ECS Instance Type for Pilot
- **File**: `server/lib/tenant-template/ecs-cluster.ts` (line 87)
- **What**: Change `t3.micro` to `t3.small` (2 vCPU, 2GB RAM).
- **Validation**: Deploy → monitor memory usage with Container Insights → each service uses < 500MB.
- **Acceptance**: No OOM kills in 24-hour soak test.

### Task 2.3: Configure ECS Stop Timeout and ALB Deregistration Delay
- **File**: `server/lib/tenant-template/services.ts`, `server/lib/shared-infra/shared-infra-stack.ts`
- **What**: Set ECS `stopTimeout: 60` seconds. Set ALB target group `deregistration_delay.timeout_seconds: 30`. This ensures in-flight requests complete during rolling deployments.
- **Validation**: Start a long-running request → trigger deploy → request completes successfully.
- **Acceptance**: No dropped requests during deployments.

### Task 2.4: Enable Container Insights
- **File**: `server/lib/tenant-template/ecs-cluster.ts` (line 46)
- **What**: Add `containerInsightsV2: ecs.ContainerInsights.ENABLED` on the ECS cluster.
- **Validation**: Deploy → CloudWatch Container Insights dashboard shows CPU, memory, network metrics per service.
- **Acceptance**: Metrics visible within 5 minutes. Cost: ~$15/month.

### Task 2.5: Change DynamoDB RemovalPolicy to RETAIN
- **File**: `server/lib/tenant-template/ecs-dynamodb.ts`
- **What**: Change `removalPolicy: cdk.RemovalPolicy.DESTROY` to `cdk.RemovalPolicy.RETAIN` for production tables. Keep DESTROY only if `stage === 'dev'`.
- **Validation**: Run `cdk diff` → confirm `DeletionPolicy: Retain` in CloudFormation template.
- **Acceptance**: `cdk destroy` does NOT delete DynamoDB tables.

### Task 2.6: Set CloudWatch Log Retention to 90 Days
- **Files**: `server/lib/tenant-template/services.ts`, `server/lib/shared-infra/api-gateway.ts`
- **What**: Change all `logRetention` from 7 days to 90 days for production log groups.
- **Validation**: Check CloudWatch log group settings → retention = 90 days.
- **Acceptance**: Logs available for 90-day lookback.

### Task 2.7: Add CloudWatch Alarms for Critical Metrics
- **File**: New `server/lib/shared-infra/alarms.ts`
- **What**: Create CloudWatch Alarms for:
  - API Gateway 5xx error rate > 5% over 5 minutes
  - API Gateway P99 latency > 3 seconds
  - DynamoDB `ThrottledRequests` > 0
  - ECS `RunningTaskCount` < `DesiredTaskCount`
  - Lambda Authorizer error rate > 1%
  - All alarms → SNS topic → ops email
- **Validation**: Trigger each alarm condition → email received. Create `edforge-ops` email distribution list.
- **Acceptance**: 5 alarms active, SNS subscriptions confirmed. Escalation path documented.

### Task 2.8: Fix S3 Access Logs Bucket Retention
- **File**: `server/lib/shared-infra/shared-infra-stack.ts` (line 252)
- **What**: Change `autoDeleteObjects: true` + `RemovalPolicy.DESTROY` to `RemovalPolicy.RETAIN`. Add lifecycle rule: transition to Glacier after 90 days, expire after 365 days.
- **Validation**: Check S3 bucket settings → lifecycle policy active.
- **Acceptance**: Access logs retained for 1 year.

### Task 2.9: Add WAF to API Gateway
- **File**: New `server/lib/shared-infra/waf.ts`
- **What**: Create WAFv2 WebACL with AWS Managed Rules: `CommonRuleSet`, `KnownBadInputsRuleSet`, `SQLiRuleSet`. Associate with API Gateway stage. Rate-based rule: 2000 requests per 5 min per IP.
- **Validation**: Send SQL injection payload → blocked. Send 2001 requests in 5 min → rate limited.
- **Acceptance**: WAF metrics visible in CloudWatch. Common OWASP attacks blocked. Cost: ~$6/month.

### Task 2.10: Production Domain & TLS Setup
- **Files**: CDK stacks, Route53, ACM
- **What**: Configure Route53 hosted zone for `edforge.app`. Provision ACM certificate for `*.edforge.app`. Configure custom domain on API Gateway. Set up CloudFront distribution for MFE static assets with HTTPS.
- **Validation**: `https://edforge.app` loads the shell. `https://api.edforge.app` responds with valid TLS.
- **Acceptance**: All traffic is HTTPS. No mixed content warnings.

### Task 2.11: Enable ALB Access Logging
- **File**: `server/lib/shared-infra/shared-infra-stack.ts`
- **What**: Enable access logging on the ALB, pointing to the access logs S3 bucket.
- **Validation**: Make API request → verify log entry in S3 within 5 minutes.
- **Acceptance**: ALB access logs flowing to S3.

### Task 2.12: Basic Feature Flag System
- **File**: New service in Identity or shared lib
- **What**: DynamoDB-backed feature flag service. Key: `TENANT#{tid}:FEATURE#{featureName}`. Check in route guards and controllers. Initial flags: `finance.enabled`, `attendance.enabled`, `grades.enabled`. Admin API to toggle flags per tenant.
- **Validation**: Disable `finance.enabled` for tenant A → Finance API returns 403 for tenant A, 200 for tenant B.
- **Acceptance**: Per-tenant feature control without redeployment.

---

## Sprint 3: Compliance — Soft Delete, Audit & FERPA

**Goal**: Implement FERPA-compliant data retention BEFORE building more features on top. No hard deletes of student records. Full audit trail for grade/attendance changes.

**Demo**: "Delete" a student → student marked inactive, hidden from lists, but grade history preserved. Show audit log of who changed grades and when.

> **Why Sprint 3 (not later)?** Soft delete and audit trails affect the data model. Every subsequent sprint builds on these patterns. Retrofitting is harder and riskier than building correctly from the start.

### Task 3.1: Implement Soft Delete for Students
- **File**: `server/application/microservices/academics/src/students/students.service.ts`
- **What**: Replace hard delete with soft delete: set `status = 'inactive'`, `deletedAt = ISO timestamp`, `deletedBy = userId`. Update all student queries to filter `status != 'inactive'`. Add `includeInactive` query param for admin views.
- **Validation**: Delete student → student disappears from active list. Query with `includeInactive=true` → student appears with `inactive` status. Student's enrollment/grades still queryable.
- **Acceptance**: No student data is ever permanently deleted.

### Task 3.2: Implement Soft Delete for Enrollment Records
- **File**: `server/application/microservices/academics/src/enrollment/enrollment.service.ts`
- **What**: Same pattern as students: soft delete with `deletedAt`, filter in queries.
- **Validation**: Withdraw enrollment → record preserved. Historical enrollment queryable.
- **Acceptance**: No enrollment records permanently deleted.

### Task 3.3: Add Grade Change Audit Trail
- **File**: `server/application/microservices/academics/src/grades/grades.service.ts`
- **What**: On every grade create/update, write an audit entry: `PK=TENANT#{tid}, SK=AUDIT#GRADE#{gradeId}#{timestamp}`. Include `previousValue`, `newValue`, `changedBy`, `changedAt`, `reason` (optional). Append-only (no update/delete).
- **Validation**: Update a grade → query audit trail → see previous and new values with userId.
- **Acceptance**: Complete history of every grade change accessible via API.

### Task 3.4: Add Attendance Change Audit Trail
- **File**: `server/application/microservices/academics/src/attendance/attendance.service.ts`
- **What**: Same pattern as grades: audit entry with `previousStatus`, `newStatus`, `changedBy`, `changedAt`.
- **Validation**: Change attendance status → query audit → see who changed it and when.
- **Acceptance**: Attendance changes have full audit trail.

### Task 3.5: Secure Audit Logs from Modification
- **File**: Audit entity creation logic
- **What**: Audit entries use `ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'` to prevent overwrites. No update or delete endpoints for audit entities.
- **Validation**: Attempt to overwrite audit entry → ConditionalCheckFailedException.
- **Acceptance**: Audit trail is immutable.

### Task 3.6: Implement FERPA Data Retention Policy
- **File**: Configuration + Lambda function
- **What**: Define retention periods: active students = indefinite, inactive = 7 years, audit logs = 7 years, sessions = 30 days. Create monthly Lambda to hard-delete records past retention. Add `retentionExpiresAt` field on soft-delete.
- **Validation**: Set test record retention to 1 day → run Lambda → record deleted.
- **Acceptance**: Retention policy documented and automated.

### Task 3.7: Student CRUD Smoke Test
- **File**: `scripts/smoke-tests/student-crud.ts`
- **What**: Test: create student → read → update → list (verify present) → soft-delete → list (verify absent) → list with includeInactive (verify present).
- **Validation**: Run against staging → all pass.
- **Acceptance**: Student lifecycle with soft-delete tested.

---

## Sprint 4: Input Validation & Data Quality

**Goal**: Ensure all user input is validated at frontend and backend BEFORE pilot schools start entering real data. Prevent garbage data from entering the system.

**Demo**: Submit invalid data in every form → see clear field-level errors. Submit via API directly → receive structured 400 errors.

> **Why Sprint 4 (not later)?** Invalid data entered during pilot is hard to clean up. Validation should be in place before schools start using the system.

### Task 4.1: Add Zod Validation to Identity Service DTOs
- **File**: All DTO files in `server/application/microservices/identity/src/`
- **What**: Add Zod schemas enforcing: string max lengths (name: 100, email: 254), date formats (ISO 8601), enum values (roles, status). Use NestJS `ZodValidationPipe` globally.
- **Validation**: Send oversized name (1000 chars) → 400. Send invalid role → 400.
- **Acceptance**: Every Identity endpoint rejects invalid input with structured errors.

### Task 4.2: Add Zod Validation to Academics Service DTOs
- **File**: All DTO files in `server/application/microservices/academics/src/`
- **What**: Same pattern. Enforce: grade values 0-100, attendance status enum, student number format, birth date not in future.
- **Validation**: Send future birth date → 400. Send grade = -5 → 400.
- **Acceptance**: Every Academics endpoint rejects invalid input.

### Task 4.3: Add Zod Validation to Finance Service DTOs
- **File**: All DTO files in `server/application/microservices/finance/src/`
- **What**: Same pattern. Enforce: amount > 0, tax rate 0-100, discount 0-100, currency format.
- **Validation**: Send negative amount → 400. Send 150% tax → 400.
- **Acceptance**: Every Finance endpoint rejects invalid input.

### Task 4.4: Add Grade Input Validation in Frontend
- **File**: `apps/academics/src/components/grades/GradebookGrid.tsx`
- **What**: Validate grade values on input: must be numeric, within scale range (0-100 for percentage). Show inline error. Prevent NaN submission. Add `inputMode="decimal"` for mobile.
- **Validation**: Enter "abc" → inline error. Enter -5 → error. Enter 95 → accepted.
- **Acceptance**: No NaN or out-of-range values submitted.

### Task 4.5: Add Student Data Validation
- **File**: `server/application/microservices/academics/src/students/students.service.ts`
- **What**: Before creating student: validate birth date not in future, email format, phone format, check for duplicate student number within school, validate grade level enum.
- **Validation**: Create student with future birth date → 400. Duplicate student number → 409.
- **Acceptance**: No invalid student records in DynamoDB.

### Task 4.6: Add Enrollment Date Validation
- **File**: `server/application/microservices/academics/src/enrollment/enrollment.service.ts`
- **What**: Use proper Date object comparison instead of string comparison. Validate entry date within academic year range.
- **Validation**: Enroll with date before year start → 400.
- **Acceptance**: All enrollment dates are valid.

### Task 4.7: Add Pagination Cursor Validation
- **File**: `server/application/microservices/*/src/common/services/dynamodb-client.service.ts`
- **What**: Wrap `decodeCursor()` in try-catch. On malformed cursor, return first page instead of crashing.
- **Validation**: Send garbage base64 as cursor → receive first page (not 500).
- **Acceptance**: Malformed cursors never crash the API.

---

## Sprint 5: Financial Safety & Data Integrity

**Goal**: Eliminate race conditions in payments, enforce financial precision, prevent double-charges.

**Demo**: Duplicate payment submissions rejected. Correct currency precision across invoices. Concurrent modifications handled gracefully.

### Task 5.1: Require Idempotency Keys for All Payment Operations
- **File**: `server/application/microservices/finance/src/payments/payments.service.ts`
- **What**: Make `idempotencyKey` required in `CreatePaymentDto`. On duplicate key, return existing payment. Store key with 24h TTL.
- **Validation**: Submit same key twice → second returns 200 with original. Submit without key → 400.
- **Acceptance**: No double-charge possible from network retries.

### Task 5.2: Fix Financial Precision (Integers for Money)
- **File**: `server/application/microservices/finance/src/invoices/invoices.service.ts` + all finance DTOs
- **What**: Convert all monetary amounts from float to integer cents. `amount: 99.99` → `amountCents: 9999`. Update all calculations to integer arithmetic. Add `Math.round()` only at display boundaries.
- **Sub-tasks**:
  - 5.2a: Write DynamoDB scan script to convert existing float amounts to cents
  - 5.2b: Update Finance service DTOs and calculation logic
  - 5.2c: Update Finance MFE to display cents as dollars
  - 5.2d: Add backward-compatible API field during transition
- **Validation**: Create invoice with `tax: 7.5%` on `subtotal: 33.33` → correct to the cent.
- **Acceptance**: No floating-point precision errors in any financial calculation.

### Task 5.3: Add DynamoDB Condition Expressions to Payment State Transitions
- **File**: `server/application/microservices/finance/src/payments/payments.service.ts`
- **What**: Replace read-then-write with conditional update: `#status = :expected_status`. Prevents race conditions.
- **Validation**: Send 2 concurrent payments for same invoice → one succeeds, one gets "Invoice already being processed."
- **Acceptance**: No race condition in payment processing.

### Task 5.4: Add Payment Amount Validation
- **File**: `server/application/microservices/finance/src/payments/payments.service.ts`
- **What**: Validate: `amount > 0`, `amount <= 999999.99`, `amount` is numeric (not NaN), `amount <= invoice.amountDue`.
- **Validation**: Negative amount → 400. NaN → 400. Amount > due → 400.
- **Acceptance**: Only valid positive amounts processed.

### Task 5.5: Implement Optimistic Lock Retry for DynamoDB
- **File**: New utility `server/application/libs/dynamodb-retry.ts`
- **What**: Create `withOptimisticRetry(fn, maxRetries=2)` wrapper. On `ConditionalCheckFailedException`, re-read, re-apply, retry with exponential backoff (100ms, 400ms).
- **Validation**: Simulate concurrent update → first attempt fails → retry succeeds.
- **Acceptance**: Users see "Save successful" instead of "Conflict error."

### Task 5.6: Add Receipt Number Uniqueness
- **File**: `server/application/microservices/finance/src/payments/`
- **What**: Generate receipt numbers: `RECEIPT#{schoolId}#{YYYYMMDD}#{sequence}`. Conditional write for uniqueness. On collision, increment and retry.
- **Validation**: Create 100 payments rapidly → all unique receipt numbers.
- **Acceptance**: No duplicate receipts.

### Task 5.7: Payment & Invoice Smoke Test
- **File**: `scripts/smoke-tests/payment-invoice.ts`
- **What**: Test: create fee structure → generate invoice → verify amount → submit payment with idempotency key → verify applied → submit duplicate → verify no double-charge → verify invoice paid.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Financial operations tested end-to-end.

---

## Sprint 6: Caching & Performance (In-Memory, No Redis)

**Goal**: Eliminate per-request STS overhead and add client pooling. Reduce median API latency by 40-60% using in-memory caching only (Redis deferred to post-pilot).

**Demo**: P50 latency drops from ~200ms to ~80ms. STS calls reduced by 90%+.

> **Why no Redis?** At 50-100 schools, in-memory cache with 2 ECS tasks provides sufficient coverage. Redis adds $12/month + operational complexity. Defer until cache misses cause user-visible issues.

### Task 6.1: Cache STS Credentials Per Tenant
- **File**: `server/application/libs/auth/src/token-vending-machine.ts`
- **What**: Add in-memory LRU cache (Map with size limit=200) for STS credentials keyed by `tenantId`. TTL = 14 min. On hit, skip `AssumeRole`. On miss/expired, call STS and cache.
- **Validation**: 10 requests for same tenant → 1 STS call (check CloudTrail). Latency drops ~100ms → ~5ms.
- **Acceptance**: STS calls reduced by 90%+ for repeat requests.

### Task 6.2: Pool DynamoDB Clients Per Tenant
- **File**: `server/application/microservices/*/src/common/services/dynamodb-client.service.ts`
- **What**: Maintain pool of DynamoDB clients per tenant. Reuse if credentials haven't expired. Pool max: 100 (LRU eviction).
- **Validation**: 100 requests for same tenant → 1 client created. Memory bounded.
- **Acceptance**: Client creation overhead eliminated.

### Task 6.3: Add HTTP Client Timeouts
- **File**: `server/application/libs/http-client/src/`
- **What**: Set `timeout: 10000` (10s connect), `socketTimeout: 30000` (30s socket). Add timeout logging.
- **Validation**: Simulate slow Identity service → Academics receives timeout error (not hang).
- **Acceptance**: No HTTP client can hang indefinitely.

### Task 6.4: Add Tenant-Level Rate Limiting
- **File**: NestJS `ThrottlerModule` configuration
- **What**: Add `@nestjs/throttler` with in-memory storage. Default: 100 requests/minute per tenant. Configurable per tier (Basic: 100, Advanced: 200, Premium: 500).
- **Validation**: Send 101 requests as tenant A in 1 minute → 429 on request 101. Tenant B unaffected.
- **Acceptance**: Single tenant cannot overload shared resources.

---

## Sprint 7: Frontend Error Handling & Reliability

**Goal**: Every user action provides clear feedback. No silent failures.

**Demo**: Show error toasts for API failures, loading states for all data fetches, error boundaries catching crashes, retry buttons.

### Task 7.1: Add Global Error Boundary to Shell
- **File**: `apps/shell/src/components/error/ErrorBoundary.tsx`
- **What**: Wrap each MFE lazy load in `<ErrorBoundary>` with "Something went wrong" fallback + Retry button.
- **Validation**: Throw error inside Academics MFE → fallback shown → Retry reloads.
- **Acceptance**: No white screen crashes.

### Task 7.2: Add Error Toast Notifications for API Failures
- **File**: `packages/api-client/src/interceptors.ts` + toast component
- **What**: Response interceptor catches non-2xx: 403 → "No permission." 404 → "Not found." 500 → "Something went wrong." Auto-hide 5 seconds.
- **Validation**: Simulate 500 → toast appears → auto-hides.
- **Acceptance**: Every API error shows user-visible notification.

### Task 7.3a: Add Loading States — Student/Enrollment Pages
- **File**: Academics MFE student and enrollment page components
- **What**: For each `useQuery`: `isLoading` → skeleton. `isError` → error + retry. Empty data → "No records."
- **Validation**: Throttle network → skeletons. Block API → error + retry.
- **Acceptance**: No infinite spinners.

### Task 7.3b: Add Loading States — Attendance Pages
- **File**: Academics MFE attendance page components
- **What**: Same pattern as 7.3a.
- **Validation**: Same approach.
- **Acceptance**: No infinite spinners on attendance pages.

### Task 7.3c: Add Loading States — Grades Pages
- **File**: Academics MFE grades page components
- **What**: Same pattern as 7.3a.
- **Validation**: Same approach.
- **Acceptance**: No infinite spinners on grades pages.

### Task 7.4: Fix Attendance Grid Save Error Handling
- **File**: `apps/academics/src/components/attendance/AttendanceGrid.tsx`
- **What**: Wrap `onSave` in try-catch. On error, toast "Failed to save. Changes preserved locally. Try again." Add Retry Save button.
- **Validation**: Block API → save → error toast → unblock → retry → success.
- **Acceptance**: Teachers always know if attendance saved.

### Task 7.5: Add 401/403 Response Interceptor
- **File**: `packages/api-client/src/`
- **What**: 401 → refresh token, retry once. If refresh fails → redirect to login. 403 → forbidden toast, no retry.
- **Validation**: Expire access token → API call → interceptor refreshes → retries → succeeds.
- **Acceptance**: Seamless token refresh.

### Task 7.6: Integrate Error Tracking (Sentry)
- **File**: `apps/shell/src/main.tsx`, `packages/api-client/src/`
- **What**: Install `@sentry/react`. Init in shell with DSN from env config. Wrap router in `BrowserTracing`. Add breadcrumbs to API interceptor.
- **Validation**: Throw test error → appears in Sentry with stack trace, user context, breadcrumbs.
- **Acceptance**: All uncaught frontend errors reported.

### Task 7.7: Add Suspense Timeout for MFE Loading
- **File**: `apps/shell/src/router.tsx`
- **What**: If MFE loading > 10 seconds, show "Taking longer than expected. Check connection." with Retry.
- **Validation**: Delay remote entry by 15s → timeout message appears.
- **Acceptance**: No infinite MFE loading spinners.

---

## Sprint 8: Events, Observability & Notifications

**Goal**: Ensure domain events are never silently lost. Add event replay. Establish operational observability. Set up transactional email.

**Demo**: Event failure → DLQ → retry succeeds. CloudWatch dashboard shows request rates, errors, latency. Password reset emails branded.

### Task 8.1: Add Dead Letter Queue for EventBridge
- **File**: Event infrastructure CDK
- **What**: Create SQS DLQ for each EventBridge rule target. `maxReceiveCount: 3` with retry. CloudWatch alarm on DLQ depth > 0.
- **Validation**: Publish event with failing target → appears in DLQ after retries → alarm fires.
- **Acceptance**: No event silently lost.

### Task 8.2: Replace Fire-and-Forget with Retry Pattern
- **File**: All `*.service.ts` with `this.eventsService.publishEvent(...).catch(...)`
- **What**: Create `publishWithRetry(event, maxRetries=2)` in events base class. Retry with 500ms, 2000ms delays. If all fail, log ERROR with full event payload.
- **Validation**: Simulate EventBridge failure → retry → succeeds.
- **Acceptance**: Event delivery rate > 99.9%.

### Task 8.3: Add Correlation ID to EventBridge Events
- **File**: `server/application/libs/events/src/`
- **What**: Include `X-Correlation-Id` from originating HTTP request in every event payload.
- **Validation**: Make request with correlation ID → check event → same ID present.
- **Acceptance**: Every event traceable to originating request.

### Task 8.4: Create CloudWatch Operations Dashboard
- **File**: CDK construct or manual dashboard
- **What**: Widgets: API Gateway (requests, errors, latency), ECS (CPU/memory per service), DynamoDB (capacity, throttling), Lambda (invocations, errors), EventBridge (published, failed, DLQ depth).
- **Validation**: Dashboard loads → all widgets show data.
- **Acceptance**: Single pane of glass for operational health.

### Task 8.5: Add Structured Logging with Request Context
- **File**: `server/application/libs/logger/src/`
- **What**: Middleware attaches `requestId`, `tenantId`, `userId`, `schoolId` to every log line using AsyncLocalStorage. Logger auto-includes fields.
- **Validation**: Make request → CloudWatch logs → every line has `requestId` and `tenantId`.
- **Acceptance**: Can filter logs by any context field.

### Task 8.6: Configure Transactional Email (SES + Cognito Templates)
- **File**: CDK + Cognito configuration
- **What**: Set up SES with verified domain `noreply@edforge.app`. Brand Cognito password reset email with EdForge logo. Create basic email template for invoice notifications.
- **Validation**: Trigger password reset → branded email received. Generate invoice → notification email sent.
- **Acceptance**: All system emails are branded and delivered.

### Task 8.7: Cross-Service Event Smoke Test
- **File**: `scripts/smoke-tests/event-propagation.ts`
- **What**: Test: create enrollment → verify event fired → verify Finance received → verify student account created. Simulate failure → verify DLQ.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Event-driven flows tested end-to-end.

---

## Sprint 9: Frontend Polish & Accessibility

**Goal**: Make the pilot UI accessible to users with disabilities and provide consistent, polished UX.

**Demo**: Navigate entire app using keyboard only. Screen reader announces state changes. School context transitions cleanly.

### Task 9.1: Add Aria Labels to Attendance Components
- **File**: `apps/academics/src/components/attendance/`
- **What**: `aria-label` on all interactive elements. `aria-live="polite"` region for save status announcements.
- **Validation**: VoiceOver/NVDA → navigate grid → all buttons announced. Save → "Saved" announced.
- **Acceptance**: All attendance interactive elements have meaningful aria labels.

### Task 9.2: Add Aria Labels to Gradebook Components
- **File**: `apps/academics/src/components/grades/`
- **What**: `aria-label` on grade inputs, `aria-describedby` for scale, `aria-live` for save status.
- **Validation**: Screen reader → grade fields announced meaningfully.
- **Acceptance**: Grade entry accessible via screen reader.

### Task 9.3: Fix Keyboard Trap in Modal Dialogs
- **File**: `packages/ui/src/components/Modal.tsx`
- **What**: Focus trap: on open, focus first element. Tab cycles within modal. Escape closes. On close, focus returns to trigger.
- **Validation**: Open modal → Tab → focus stays within → Escape → focus returns.
- **Acceptance**: No keyboard traps.

### Task 9.4: Add Color-Independent Status Indicators
- **File**: `apps/academics/src/components/attendance/` status badges
- **What**: Add text label alongside color: "P" for present, "A" for absent, "T" for tardy.
- **Validation**: View in grayscale → all statuses distinguishable.
- **Acceptance**: Status indicators work without color.

### Task 9.5: Improve School Context Transition UX
- **File**: `apps/shell/src/stores/app.store.ts`, `SchoolTransitionOverlay.tsx`
- **What**: On switch: (1) overlay, (2) cancel in-flight queries, (3) clear stale Zustand data, (4) fetch new data, (5) hide overlay. Auto-hide fallback at 5 seconds.
- **Validation**: Switch schools → overlay → new data → overlay hides. Slow API → auto-hide at 5s.
- **Acceptance**: No stale data visible after school switch.

### Task 9.6: Add Auto-Select for Single-School Users
- **File**: `apps/shell/src/lib/shell-context.tsx`
- **What**: If `availableSchools.length === 1`, auto-select. If 0, show error. If >1, show picker.
- **Validation**: Login with 1 school → dashboard loads directly. Login with 2 → picker shown.
- **Acceptance**: Single-school users skip one click.

### Task 9.7: Add Privacy Policy and Terms of Service Pages
- **File**: `apps/shell/src/pages/Privacy.tsx`, `apps/shell/src/pages/Terms.tsx`
- **What**: Static pages linked from login screen and footer. Content is a legal deliverable (placeholder with structure for now).
- **Validation**: Navigate to `/privacy` and `/terms` → pages render.
- **Acceptance**: Routes exist and are linked from login and footer.

---

## Sprint 10: Pilot Operations & Onboarding

**Goal**: Provide tools for school admin onboarding, data import, and support workflow.

**Demo**: Provision a new school in 15 minutes. Import 200 students via CSV. Admin debug toolkit finds issues by tenant.

### Task 10.1: Tenant Provisioning Automation
- **File**: Admin API or CLI script
- **What**: Create endpoint/script that provisions a new tenant end-to-end: CDK stack deployment, Cognito user pool, DynamoDB seeding (academic year, default roles, default grading scale). Target: onboard new school in < 15 minutes without AWS console.
- **Validation**: Run provisioning → new tenant accessible → default data seeded.
- **Acceptance**: New school onboarding is repeatable and fast.

### Task 10.2: CSV Import for Students
- **File**: New endpoint in Academics service + frontend upload UI
- **What**: Upload CSV → validate rows (name, DOB, grade, student number) → create entities in batch. Return rejection report for invalid rows.
- **Validation**: Upload CSV with 200 students (10 invalid) → 190 created, 10 rejected with reasons.
- **Acceptance**: Schools can bulk-import students.

### Task 10.3: CSV Import for Staff
- **File**: New endpoint in Identity service + frontend upload UI
- **What**: Same pattern as students: CSV upload, validate, batch create, rejection report.
- **Validation**: Upload CSV with 50 staff → created with correct roles.
- **Acceptance**: Schools can bulk-import staff.

### Task 10.4: First-Run Setup Checklist
- **File**: Shell app dashboard or setup page
- **What**: When TenantAdmin logs in and no academic year exists, show setup checklist: Create Academic Year → Create Grading Periods → Create Departments → Create Courses → Import Students. Mark each step complete as it's done.
- **Validation**: New tenant login → checklist shown → complete steps → checklist dismissed.
- **Acceptance**: School admins have guided onboarding.

### Task 10.5: Admin Debug Toolkit
- **File**: Super-admin API endpoints
- **What**: Build API that lists tenants, schools, users, recent error logs for a given tenant. Add CloudWatch Insights saved queries: "all errors for tenant X in last 24h", "all 5xx responses in last hour."
- **Validation**: Query tenant debug endpoint → see tenant data, users, recent errors.
- **Acceptance**: Support can diagnose issues without AWS console.

### Task 10.6: DynamoDB Backup Restore Drill
- **What**: Perform a PITR restore to a test table. Verify data integrity. Document the runbook.
- **Validation**: Restore succeeds. Data verified against source.
- **Acceptance**: Documented runbook for disaster recovery. FERPA-compliant proven recoverability.

---

## Sprint 11: Final Smoke Tests & CI/CD Gating

**Goal**: Comprehensive end-to-end smoke tests that run before and after every deployment. CI/CD gates deployment on test pass.

**Demo**: Run full suite → all green → deploy with confidence. Broken deploy → tests fail → rollback.

### Task 11.1: Enrollment Lifecycle Smoke Test
- **File**: `scripts/smoke-tests/enrollment-lifecycle.ts`
- **What**: Test: create student → enroll → verify active → withdraw → verify status → attempt re-enroll.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Enrollment transitions tested.

### Task 11.2: Attendance Recording Smoke Test
- **File**: `scripts/smoke-tests/attendance-recording.ts`
- **What**: Test: record attendance → verify created → update → verify audit trail → reject future-date → bulk record.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Attendance recording tested.

### Task 11.3: Grade Entry & GPA Smoke Test
- **File**: `scripts/smoke-tests/grades-gpa.ts`
- **What**: Test: create assignment → enter grade → verify → update → verify audit → calculate GPA → reject invalid.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Grading lifecycle tested.

### Task 11.4: ABAC Permission Smoke Test
- **File**: `scripts/smoke-tests/abac-permissions.ts`
- **What**: Test: TenantAdmin access all. Teacher access own sections only. Parent access own students only. Cross-tenant → 403.
- **Validation**: Run against staging → all pass.
- **Acceptance**: Permission boundaries tested.

### Task 11.5: CI/CD Post-Deploy Smoke Test Integration
- **File**: `.github/workflows/deploy-staging.yml`
- **What**: Add post-deployment step running full smoke test suite. On failure, alert + manual rollback trigger.
- **Validation**: Deploy broken feature → smoke test fails → deployment flagged.
- **Acceptance**: No deployment reaches production without passing tests.

### Task 11.6: Load Test for Pilot Scale
- **File**: `scripts/load-tests/pilot-load.ts` (using k6 or Artillery)
- **What**: Simulate: 100 concurrent users, 50 schools, typical workload (attendance marking, grade entry, student lookup). Target: P99 < 3 seconds, 0% error rate.
- **Validation**: Run load test → all metrics within target.
- **Acceptance**: System handles pilot-scale load.

---

## Sprint Dependency Graph (Revised)

```
Sprint 0 (CI/CD + Security) ─────────────────────────────── REQUIRED FIRST
    │
    ├── Sprint 1 (Auth) ────────────── Smoke test: auth-flow.ts
    │       │
    │       └── Sprint 7 (Frontend Errors) → Sprint 9 (Accessibility)
    │
    ├── Sprint 2 (Infrastructure) ──── Staging env, domain, WAF
    │       │
    │       └── Sprint 6 (Caching) ──→ Sprint 8 (Events & Observability)
    │
    ├── Sprint 3 (Compliance/FERPA) ── Soft delete + audit trails
    │       │
    │       └── Sprint 4 (Validation) → Sprint 5 (Financial Safety)
    │
    └── Sprint 10 (Pilot Operations) → Sprint 11 (Final Tests + CI/CD Gating)
```

**Critical Path**: `Sprint 0 → Sprint 1 + Sprint 2 (parallel) → Sprint 3 → Sprint 4 → Sprint 5 → Sprint 10 → Sprint 11`

**Parallelizable**:
- Sprints 1 + 2 (auth hardening + infra hardening)
- Sprints 4 + 6 (validation + caching — different layers)
- Sprints 7 + 8 (frontend errors + backend events)
- Sprints 9 + 10 (accessibility + pilot operations)

---

## Deferred (Post-Pilot, Scale Phase)

These items are NOT required for 50-100 schools. Defer until traffic justifies:

| Item | Why Defer | Trigger to Implement |
|------|-----------|---------------------|
| ElastiCache Redis | In-memory cache sufficient at 50-100 schools; 2 ECS tasks provide warm cache during deploys | When cache misses cause user-visible latency issues |
| DynamoDB DAX | Read load won't justify cost | When read throttling occurs consistently |
| X-Ray distributed tracing | CloudWatch logs + correlation IDs sufficient | When cross-service debugging becomes frequent |
| Circuit breaker (opossum) | 2 ECS tasks + health checks self-heal transient failures | When inter-service failure rate > 1% sustained |
| GSI 7-12 | Current GSIs cover pilot queries | When new access patterns required |
| Blue/green CodeDeploy | Rolling update with minHealthy=100% sufficient | When zero-downtime contractually required |
| CDN for API responses | 50-100 schools won't generate CDN-worthwhile read volume | When same-school reads > 1000/min |
| Bulk Ed-Fi import pipeline | CSV import sufficient for pilot | When schools have 500+ students or Ed-Fi compliance required |
| EventBridge Archive/Replay | DLQ + logging sufficient for debugging | When event replay needed > 1x/month |
| Service-to-service mTLS | Internal API keys + VPC isolation sufficient | When services move to separate VPCs/accounts |
| CSRF tokens | SameSite=Lax + CORS sufficient for pilot | When security audit specifically flags this |

---

## Cost Estimate for Pilot Infrastructure

| Resource | Config | Monthly Cost |
|----------|--------|-------------|
| ECS (2x t3.small) | 2 vCPU, 2GB RAM each | ~$30 |
| ALB + NLB | Always on | ~$32 |
| DynamoDB (on-demand) | ~10GB storage, moderate reads/writes | ~$25 |
| NAT Gateway | Data transfer | ~$35 |
| CloudWatch Logs (90 days) | ~5GB/month | ~$5 |
| WAF | 100K requests/month | ~$6 |
| Cognito | 50-100 MAU (free tier) | $0 |
| S3 (logs, assets) | <10GB | ~$1 |
| EventBridge | <1M events/month | ~$1 |
| Sentry (free tier) | 5K errors/month | $0 |
| **Total** | | **~$135/month** |

---

## Summary

| Sprint | Focus | Tasks | Key Deliverables |
|--------|-------|-------|-----------------|
| 0 | CI/CD + Critical Security | 11 | Pipeline, staging env, CORS, XSS, ABAC, TVM fixes |
| 1 | Auth & Sessions | 8 | Session bugs, MFA, cross-tab logout, auth smoke test |
| 2 | Infrastructure HA | 12 | ECS HA, WAF, alarms, domain/TLS, feature flags |
| 3 | Compliance/FERPA | 7 | Soft delete, audit trails, retention policy |
| 4 | Input Validation | 7 | Zod schemas all services, frontend validation |
| 5 | Financial Safety | 7 | Idempotency, precision, race conditions, payment smoke test |
| 6 | Caching & Performance | 4 | STS cache, client pooling, timeouts, rate limiting |
| 7 | Frontend Reliability | 7 | Error boundaries, toasts, loading states, Sentry |
| 8 | Events & Observability | 7 | DLQ, retry, dashboard, structured logging, email |
| 9 | Frontend Polish & A11y | 7 | Aria labels, keyboard nav, school context, privacy pages |
| 10 | Pilot Operations | 6 | Provisioning, CSV import, setup wizard, debug toolkit |
| 11 | Final Tests & CI/CD | 6 | Smoke tests, load test, CI/CD gating |
| **Total** | | **89 tasks** | |

---

## Reviewer Notes (Incorporated)

The following improvements were incorporated from subagent review:

1. **CI/CD pipeline added as Task 0.0** — every subsequent task depends on deployability
2. **Staging environment provisioning added** — every validation step assumes staging exists
3. **Sprint 3 is now Compliance (was Sprint 9)** — soft delete and audit trails affect data model; retrofitting is harder
4. **Sprint 4 is now Validation (was Sprint 8)** — prevent garbage data before schools start entering data
5. **Redis deferred to post-pilot** — in-memory cache with 2 ECS tasks sufficient at 50-100 schools (~$12/month + 20 hours saved)
6. **Smoke tests distributed across sprints** — not batched at the end
7. **Large tasks broken down** — ABAC enforcement split into 3 sub-tasks, Zod validation split by service, loading states split by domain, financial precision split into 4 sub-tasks
8. **Pilot operations sprint added** — tenant provisioning, CSV import, first-run wizard, debug toolkit
9. **DNS/TLS/domain setup added** — cannot go to production without HTTPS
10. **Graceful shutdown configuration added** — ECS stop timeout + ALB deregistration delay
11. **Tenant-level rate limiting added** — prevent single tenant from overloading shared resources
12. **Transactional email setup added** — password resets need branded templates
13. **Feature flag system added** — per-tenant module rollout control
14. **DynamoDB backup restore drill added** — FERPA requires proven recoverability
15. **Privacy/Terms pages added** — COPPA/FERPA requirement
16. **Critical path corrected** — now includes compliance and financial safety
17. **Load test added** — validate system handles pilot-scale load
18. **Data migration plan added for float-to-cents conversion** — breaking change needs migration script

### Top 3 Risks
1. **76+ tasks without CI/CD** — addressed by making CI/CD Task 0.0
2. **Financial precision migration breaks existing data** — addressed by adding data migration sub-tasks
3. **Scope creep to 89 tasks** — mitigate by timeboxing to 12 weeks for pilot-blocking sprints (0-5, 10-11). Sprints 6-9 can ship incrementally post-initial-pilot.

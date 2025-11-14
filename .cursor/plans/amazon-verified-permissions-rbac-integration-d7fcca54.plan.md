<!-- d7fcca54-15b2-4173-9939-649a38caf774 7c4d4f9a-8e1b-4d2b-926c-8d80c2beb46f -->
# Amazon Verified Permissions RBAC Integration for EdForge

## Executive Summary

Integrate Amazon Verified Permissions (AVP) to enable fine-grained RBAC while preserving existing ABAC infrastructure security. The design uses a shared policy store with tenant-scoped policies, resource:action permission model, and gradual migration strategy starting with school microservice.

## Current Architecture Analysis

### Existing Security Layers (Preserved)

1. **Layer 1: API Gateway Authorization** (`tenant_authorizer.py`)

   - JWT validation via Cognito
   - Role extraction: `custom:userRole` (TenantAdmin, TenantUser)
   - Basic path-based authorization (TenantUser blocked from `/users`)

2. **Layer 2: ABAC Infrastructure** (`ecs-dynamodb.ts`, `token-vending-machine.ts`)

   - Token Vending Machine assumes ABAC role with tenant tags
   - DynamoDB LeadingKeys condition: `${aws:PrincipalTag/tenant}`
   - **CRITICAL**: This layer provides tenant isolation at infrastructure level - MUST BE PRESERVED

3. **Layer 3: Application-Level** (Current Gap)

   - No fine-grained permission checking
   - Hard-coded role checks in services (e.g., `userRole !== 'teacher'`)
   - No tenant-created roles support

### Current Role Storage

- **Cognito Custom Attributes**: `custom:userRole` (TenantAdmin, TenantUser)
- **System Roles**: Defined in `auth_manager.py` (SystemAdmin, CustomerSupport, TenantAdmin, TenantUser)
- **No Permission Storage**: No granular permissions currently stored

## Architecture Design

### 1. Shared Policy Store Strategy

**Decision**: One shared AVP policy store with tenant-scoped policies

**Implementation**:

- Single policy store: `edforge-policy-store-prod`
- Tenant isolation via policy IDs: `{tenantId}::{policyType}::{policyId}`
- Example: `tenant-abc::role::TenantAdmin`, `tenant-abc::custom::DepartmentHead`

**Pros**:

- ✅ Cost-efficient: Single store vs. per-tenant stores ($0.50/store/month + policy evaluation costs)
- ✅ Centralized management: Single point for policy updates, monitoring
- ✅ Simplified infrastructure: One CDK construct, one IAM role
- ✅ Easier compliance: Centralized audit logs
- ✅ Faster tenant onboarding: No infrastructure provisioning per tenant

**Cons**:

- ⚠️ Policy ID namespace management required (tenant prefixes)
- ⚠️ Potential for policy ID collisions (mitigated by naming convention)
- ⚠️ All tenants share same policy store limits (10,000 policies/store - acceptable for 1000 tenants with ~10 policies each)
- ⚠️ Tenant deletion requires policy cleanup (automated via lifecycle hooks)

### 2. Resource:Action Permission Model

**Decision**: Resource:Action format (e.g., `classroom:create`, `student:update`)

**Permission Structure**:

```typescript
// System-defined permissions
enum SystemPermission {
  // School Management
  'school:create',
  'school:read',
  'school:update',
  'school:delete',
  
  // Classroom Management  
  'classroom:create',
  'classroom:read',
  'classroom:update',
  'classroom:delete',
  
  // Student Management
  'student:create',
  'student:read',
  'student:update',
  'student:delete',
  
  // Grade Management
  'grade:create',
  'grade:read',
  'grade:update',
  'grade:delete',
  
  // User Management
  'user:create',
  'user:read',
  'user:update',
  'user:delete',
  
  // Role Management
  'role:create',
  'role:read',
  'role:update',
  'role:delete'
}
```

**Pros**:

- ✅ Intuitive and self-documenting
- ✅ Aligns with REST API patterns (POST=create, GET=read, PUT=update, DELETE=delete)
- ✅ Easy to map to API endpoints
- ✅ Granular control: Different permissions for different actions
- ✅ Extensible: New resources/actions easily added

**Cons**:

- ⚠️ More permissions to manage (4 per resource vs. 1-2 coarse permissions)
- ⚠️ Policy evaluation overhead slightly higher (more granular checks)
- ⚠️ Requires consistent naming convention across services

### 3. Tenant Role Creation Constraints

**Decision**: Tenants can only combine existing system-defined permissions

**Implementation**:

- System defines permission catalog in DynamoDB: `permissions-table`
- Tenant roles reference system permissions only
- No custom permission creation beyond system catalog

**Pros**:

- ✅ Security: Prevents tenants from creating overly permissive custom permissions
- ✅ Compliance: Ensures all permissions are auditable and standardized
- ✅ Simplicity: No need to validate custom permission syntax
- ✅ Predictable: All permissions follow same resource:action pattern
- ✅ Easier migration: System permissions map directly to existing code

**Cons**:

- ⚠️ Limited flexibility: Tenants cannot create domain-specific permissions
- ⚠️ Requires system to anticipate all permission needs upfront
- ⚠️ Permission requests require system updates (mitigated by versioned permission catalog)

### 4. Dual Authorization Strategy

**Decision**: Verified Permissions for application-level, ABAC for infrastructure

**Architecture**:

```
Request Flow:
1. API Gateway → JWT validation (Cognito)
2. API Gateway Authorizer → Extract role, tenant context
3. ECS Service → Verify Permissions check (application logic)
4. Token Vending Machine → Assume ABAC role (infrastructure)
5. DynamoDB → ABAC policy enforcement (tenant isolation)
```

**Pros**:

- ✅ Defense in depth: Two layers of security
- ✅ Infrastructure isolation guaranteed: ABAC prevents cross-tenant data access even if application logic fails
- ✅ Application flexibility: Verified Permissions allows complex business rules
- ✅ Best of both: AVP for fine-grained permissions, ABAC for tenant isolation
- ✅ No breaking changes: Existing ABAC infrastructure remains intact

**Cons**:

- ⚠️ Two authorization checks per request (performance overhead ~10-20ms)
- ⚠️ More complex: Two systems to maintain and monitor
- ⚠️ Potential for inconsistencies if policies drift (mitigated by automated testing)

### 5. Gradual Migration Strategy

**Decision**: Start with school microservice, migrate incrementally

**Migration Phases**:

1. **Phase 1**: Infrastructure setup (non-breaking)
2. **Phase 2**: School microservice APIs (new permission checks)
3. **Phase 3**: Academic microservice APIs
4. **Phase 4**: User microservice APIs
5. **Phase 5**: Complete migration, remove legacy code

**Pros**:

- ✅ Low risk: Test on one service first
- ✅ Learn and iterate: Adjust approach based on Phase 2 results
- ✅ No downtime: Can deploy alongside existing authorization
- ✅ Rollback capability: Easy to revert if issues arise
- ✅ Team velocity: Developers can work on other services in parallel

**Cons**:

- ⚠️ Temporary inconsistency: Some services use AVP, others use legacy checks
- ⚠️ Extended migration period (2-3 months)
- ⚠️ Requires maintaining both systems during transition

## Technical Implementation Plan

### Phase 1: Infrastructure Setup (Week 1-2)

**1.1 Amazon Verified Permissions Policy Store**

- **File**: `server/lib/shared-infra/verified-permissions.ts`
- Create CDK construct for shared policy store
- Configure Cedar schema with EdForge entities
- Set up IAM roles for policy management

**1.2 Permission Catalog**

- **File**: `server/application/libs/rbac/src/permission-catalog.ts`
- Define system permission enum (resource:action format)
- Create DynamoDB table: `permissions-catalog-{tier}`
- Seed initial permissions (school, classroom, student, grade, user, role)

**1.3 Policy Management Service**

- **File**: `server/application/libs/rbac/src/policy-manager.service.ts`
- AVP SDK integration wrapper
- Methods: `createPolicy()`, `updatePolicy()`, `deletePolicy()`, `isAuthorized()`
- Tenant-scoped policy ID generation

**1.4 Authorization Decorator**

- **File**: `server/application/libs/rbac/src/require-permission.decorator.ts`
- NestJS decorator: `@RequirePermission('school:create')`
- Guard: `VerifiedPermissionsGuard`
- Error handling for unauthorized requests

### Phase 2: School Microservice Integration (Week 3-5)

**2.1 System Role Policies**

- **File**: `server/application/libs/rbac/src/policies/system-roles.cedar`
- Create Cedar policies for: TenantAdmin, TenantUser, Principal, Teacher, Student, Parent
- Map to existing `custom:userRole` values

**2.2 School Service Authorization**

- **Files**: 
  - `server/application/microservices/school/src/schools/schools.controller.ts`
  - `server/application/microservices/school/src/classrooms/classrooms.controller.ts`
  - `server/application/microservices/school/src/departments/departments.controller.ts`
- Add `@RequirePermission()` decorators to endpoints
- Update controllers to use VerifiedPermissionsGuard

**2.3 Role Management API**

- **File**: `server/application/microservices/school/src/roles/roles.controller.ts`
- Endpoints: `GET /roles`, `POST /roles`, `PUT /roles/:id`, `DELETE /roles/:id`
- CRUD operations for tenant-created roles
- Validation: Only combine system permissions

**2.4 User-Role Assignment**

- **File**: `server/application/microservices/user/src/users/users.service.ts`
- Add `assignRole()`, `removeRole()` methods
- Store role assignments in DynamoDB: `user-roles-{tier}` table
- Update user creation to support role assignment

### Phase 3: Testing & Validation (Week 6)

**3.1 Unit Tests**

- Policy manager service tests
- Authorization guard tests
- Role management service tests

**3.2 Integration Tests**

- End-to-end authorization flow tests
- Tenant isolation verification
- Permission inheritance tests

**3.3 Performance Testing**

- AVP evaluation latency measurement
- Load testing with concurrent requests
- Cache effectiveness (if implemented)

### Phase 4: Migration to Other Services (Week 7-10)

**4.1 Academic Microservice**

- Apply same pattern as school service
- Grade, attendance, assignment endpoints

**4.2 User Microservice**

- Role management endpoints
- User management with permission checks

**4.3 Frontend Integration**

- Update Next.js client to fetch permissions
- Permission-based UI rendering
- Role management UI

### Phase 5: Cleanup & Optimization (Week 11-12)

**5.1 Remove Legacy Code**

- Remove hard-coded role checks
- Clean up unused authorization code

**5.2 Performance Optimization**

- Implement policy caching
- Batch authorization checks where possible

**5.3 Monitoring & Alerting**

- CloudWatch metrics for AVP evaluation latency
- Authorization failure alerts
- Policy store usage monitoring

## Detailed File Changes

### New Files to Create

1. `server/lib/shared-infra/verified-permissions.ts` - CDK construct for AVP policy store
2. `server/application/libs/rbac/src/permission-catalog.ts` - System permission definitions
3. `server/application/libs/rbac/src/policy-manager.service.ts` - AVP SDK wrapper
4. `server/application/libs/rbac/src/require-permission.decorator.ts` - NestJS decorator
5. `server/application/libs/rbac/src/verified-permissions.guard.ts` - Authorization guard
6. `server/application/microservices/school/src/roles/roles.module.ts` - Role management module
7. `server/application/microservices/school/src/roles/roles.controller.ts` - Role CRUD API
8. `server/application/microservices/school/src/roles/roles.service.ts` - Role business logic
9. `server/application/microservices/school/src/roles/dto/role.dto.ts` - Role DTOs

### Files to Modify

1. `server/lib/shared-infra/shared-infra-stack.ts` - Add AVP policy store
2. `server/application/microservices/school/src/schools/schools.controller.ts` - Add permission decorators
3. `server/application/microservices/school/src/classrooms/classrooms.controller.ts` - Add permission decorators
4. `server/application/microservices/user/src/users/users.service.ts` - Add role assignment methods
5. `server/lib/tenant-template/tenant-template-stack.ts` - Add permission catalog table creation
6. `server/lib/provision-scripts/provision-tenant.sh` - Seed initial system permissions

## Security Considerations

1. **Policy Store Access**: IAM roles with least privilege (only ECS task roles can evaluate)
2. **Policy Validation**: All tenant-created policies validated against system permission catalog
3. **Tenant Isolation**: Policy IDs include tenant prefix, validation ensures tenant context matches
4. **Audit Logging**: All authorization decisions logged to CloudWatch
5. **Rate Limiting**: AVP API calls rate-limited to prevent abuse

## Scalability Considerations

1. **Policy Caching**: Cache evaluated policies in memory (TTL: 5 minutes)
2. **Batch Evaluation**: Where possible, batch multiple authorization checks
3. **Policy Store Limits**: Monitor policy count (10,000 limit per store)
4. **Evaluation Latency**: Target <50ms for authorization checks (including network)

## Migration Risks & Mitigations

| Risk | Impact | Mitigation |

|------|--------|------------|

| AVP evaluation latency | High | Implement caching, batch checks |

| Policy ID collisions | Medium | Enforce naming convention, add validation |

| Tenant policy cleanup on deletion | Medium | Automated cleanup via lifecycle hook |

| Legacy code inconsistencies | Low | Comprehensive testing, gradual migration |

| Performance degradation | Medium | Load testing, optimization, monitoring |

## Success Metrics

1. **Authorization Latency**: <50ms p95 (including network)
2. **Policy Store Usage**: <80% of 10,000 policy limit
3. **Error Rate**: <0.1% authorization failures
4. **Migration Progress**: 100% of school microservice endpoints migrated by Week 5

## Next Steps

1. Review and approve this plan
2. Create detailed implementation tasks
3. Set up development environment with AVP
4. Begin Phase 1 infrastructure setup

### To-dos

- [ ] Analyze current authorization implementation across all microservices to identify all hard-coded role checks and permission requirements
- [ ] Create CDK construct for Amazon Verified Permissions shared policy store with Cedar schema definition
- [ ] Design and implement DynamoDB permission catalog table with system-defined resource:action permissions
- [ ] Implement PolicyManagerService with AVP SDK integration for policy CRUD and authorization checks
- [ ] Create NestJS @RequirePermission decorator and VerifiedPermissionsGuard for endpoint authorization
- [ ] Define and deploy Cedar policies for system roles (TenantAdmin, TenantUser, Principal, Teacher, Student, Parent)
- [ ] Add @RequirePermission decorators to school microservice endpoints (schools, classrooms, departments)
- [ ] Create role management API endpoints (CRUD) for tenant-created roles with system permission validation
- [ ] Implement user role assignment functionality in user service with DynamoDB storage
- [ ] Write comprehensive integration tests for authorization flow, tenant isolation, and permission inheritance
- [ ] Conduct load testing and performance benchmarking for AVP evaluation latency
- [ ] Update provision-tenant.sh to seed initial system permissions in permission catalog
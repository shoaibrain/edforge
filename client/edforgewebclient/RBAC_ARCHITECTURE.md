# EdForge RBAC with AWS Verified Permissions

## Overview

EdForge will use AWS Verified Permissions for fine-grained authorization using the Cedar policy language. This enables:

- System-defined roles (SUPER_ADMIN, TENANT_ADMIN, PRINCIPAL, TEACHER, STUDENT, PARENT)
- Tenant-defined custom roles and permissions
- Fine-grained permissions per resource
- Policy-based access control

## Architecture

### User Microservice Enhancements

The User microservice (`server/application/microservices/user`) will be enhanced with:

1. **Policy Store Integration**: Each tenant gets a Verified Permissions policy store
2. **Role Management API**: CRUD operations for tenant-defined roles
3. **Permission Management API**: CRUD operations for custom permissions
4. **Authorization Middleware**: Check permissions before API operations using Cedar policies

### Client-Side Integration

1. **Permission Context**: Fetch user permissions from API on login
2. **UI Guards**: Show/hide UI elements based on permissions
3. **API Client**: Include authorization context in API calls
4. **Permission Hooks**: React hooks for checking permissions in components

## Cedar Policy Examples

### System-Defined Role Policy

```cedar
permit (
  principal in Role::"TenantAdmin",
  action,
  resource
) when {
  principal.tenantId == resource.tenantId
};
```

### Tenant-Defined Custom Role

```cedar
permit (
  principal,
  action in [Action::"AllowManageStudents"],
  resource
) when {
  principal.customRole == "HeadTeacher" &&
  principal.tenantId == resource.tenantId
};
```

## Implementation Phases

### Phase 1: Core Authentication (Current)
- ✅ NextAuth v4 with AWS Cognito
- ✅ Token-based session management
- ✅ Multi-tenant user context
- ⏸️ RBAC temporarily disabled (all authenticated users have full access)

### Phase 2: AWS Verified Permissions Integration (Future)

1. **Backend Enhancements**
   - Create Policy Store per tenant
   - Implement policy management endpoints
   - Add authorization middleware to API routes
   - Store Cedar policies in DynamoDB

2. **Frontend Enhancements**
   - Permission-based navigation filtering
   - Role-specific UI element visibility
   - Permission-aware API client
   - Custom role/permission management UI

### Phase 3: Advanced Features (Future)
- Custom tenant roles and permissions
- Permission inheritance
- Audit logging for authorization decisions
- Fine-grained resource-level permissions

## Migration Strategy

The current implementation allows all authenticated users full access for POC purposes. When migrating to AWS Verified Permissions:

1. **Keep existing permission types** defined in `src/types/rbac.ts`
2. **Map permissions to Cedar policies** on backend
3. **Fetch policies from API** and cache in frontend
4. **Gradually enable RBAC** by uncommenting permission checks
5. **Add custom role support** for tenants

## Reference

- [AWS Verified Permissions Documentation](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/what-is-avp.html)
- [Cedar Policy Language](https://www.cedar-policy.org/)
- [Cedar GitHub](https://github.com/cedar-policy)

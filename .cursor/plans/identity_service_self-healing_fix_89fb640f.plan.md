---
name: Identity Service Self-Healing Fix
overview: Apply the existing auto-creation pattern from login() to getCurrentUser(), enabling self-healing user sync without new infrastructure. Zero new Lambdas, zero EventBridge complexity - just leverage Cognito JWT claims.
todos:
  - id: update-getCurrentUser
    content: Add self-healing user creation to getCurrentUser() in auth.service.ts
    status: pending
  - id: todo-1767478054342-l3ippxhbg
    content: Add cognitoUsername to RequestContext
    status: pending
  - id: test-auth-me
    content: Test /auth/me endpoint with valid JWT for user not in DynamoDB
    status: pending
  - id: run-identity-tests
    content: Run comprehensive Identity service tests with identity-test.sh
    status: pending
---

# Identity Service Self-Healing User Sync

## Staff Engineer Analysis

### The Insight

The `login()` method in [auth.service.ts](server/application/microservices/identity/src/auth/auth.service.ts) already has the correct pattern (lines 123-151):

```typescript
if (!user) {
  // Create user record in DynamoDB (first login)
  user = { ...extract from Cognito/JWT... };
  await this.dynamoDBClient.putItem(client, user);
  await this.dynamoDBClient.putItem(client, preferences);
}
```

The gap is that `getCurrentUser()` throws 401 instead of applying this same pattern.

### Why This Is The Right Approach

```mermaid
flowchart TB
    subgraph current [Current: Fails]
        A1[User authenticated via Cognito] --> A2[Calls /auth/me]
        A2 --> A3{User in DynamoDB?}
        A3 -->|No| A4[401 User not found]
    end
    
    subgraph fixed [Fixed: Self-Healing]
        B1[User authenticated via Cognito] --> B2[Calls /auth/me]
        B2 --> B3{User in DynamoDB?}
        B3 -->|No| B4[Create from JWT claims]
        B4 --> B5[Return user profile]
        B3 -->|Yes| B5
    end
```

**Benefits**:

- Zero new infrastructure (no Lambda, no EventBridge)
- Self-healing - any authenticated user auto-syncs
- Follows existing pattern already proven in `login()`
- Uses `getSystemClient()` - appropriate for bootstrap operations
- All required data is in JWT claims (already validated by API Gateway Authorizer)

### The JWT Claims Available

From Cognito, the JWT contains everything needed:| JWT Claim | Maps To | Available in RequestContext ||-----------|---------|---------------------------|| `sub` | userId | `context.userId` || `custom:tenantId` | tenantId | `context.tenantId` || `email` | email | `context.email` || `custom:userRole` | globalRole | `context.globalRole` || `cognito:username` | cognitoUsername | Need to add |

### Why NOT Lambda Trigger

| Aspect | Lambda Trigger | Self-Healing in Service ||--------|---------------|------------------------|| Infrastructure | New Lambda + IAM + triggers | None || Cold starts | Yes | No || Failure handling | Complex retry logic | Simple - next request works || Cognito dependency | Tight coupling | Loose coupling || Testing | Requires full stack | Unit testable || sbt-aws alignment | Over-engineering | Follows reference pattern |

## Implementation

### Single File Change

**File**: [server/application/microservices/identity/src/auth/auth.service.ts](server/application/microservices/identity/src/auth/auth.service.ts)**Change**: Update `getCurrentUser()` to create user if not found (same pattern as `login()`):

```typescript
async getCurrentUser(context: RequestContext): Promise<CurrentUserResponseDto> {
  const client = this.dynamoDBClient.getSystemClient();

  // Get user
  let user = await this.dynamoDBClient.getItem<User>(
    client,
    context.tenantId,
    EntityKeyBuilder.user(context.userId)
  );

  // Self-healing: Create user from JWT claims if not in DynamoDB
  if (!user) {
    this.logger.log(`Auto-creating user from JWT: ${context.email} (${context.userId})`);
    
    const now = new Date().toISOString();
    user = {
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.user(context.userId),
      entityType: 'USER',
      userId: context.userId,
      email: context.email,
      cognitoUsername: context.email, // Use email as username identifier
      cognitoSub: context.userId,
      firstName: '', // Will be populated on profile update
      lastName: '',
      globalRole: context.globalRole,
      status: 'active',
      gsi1pk: GSIKeyBuilder.emailLookup(context.email),
      gsi1sk: `TENANT#${context.tenantId}`,
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
      version: 1,
    };
    await this.dynamoDBClient.putItem(client, user);

    // Create default preferences
    const preferences = createDefaultPreferences(context.tenantId, context.userId, context.userId);
    await this.dynamoDBClient.putItem(client, preferences);
  }

  // ... rest of existing method unchanged ...
}
```



### Optional Enhancement: Add `cognitoUsername` to RequestContext

To capture the actual Cognito username (which may differ from email for admin-created users), update the JWT extraction middleware to include `cognito:username` claim.**File**: Wherever JWT claims are extracted to populate RequestContext (likely in a guard or middleware).

## What NOT To Change

- **No new Lambda** - Cognito triggers add complexity
- **No EventBridge events** - Overkill for user sync
- **No provisioning script changes** - Let service handle sync
- **No ABAC policy changes** - Current `getSystemClient()` approach is correct for bootstrap

## Testing

After implementation, the test flow:

1. User authenticates via Cognito (already works)
2. User calls `GET /auth/me` with valid JWT
3. Service creates user in DynamoDB if not exists
4. Returns user profile

The existing [identity-test.sh](scripts/identity-test.sh) can validate this works correctly.

## Alignment with sbt-aws Pattern

The AWS SaaS Reference Solution's user service uses Cognito as the source of truth. EdForge extends this with DynamoDB for richer user profiles. The self-healing pattern:
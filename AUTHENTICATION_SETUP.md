# EdForge Authentication Setup Guide

This document explains how to configure authentication for EdForge Admin Web and Tenant Application.

## Architecture Overview

### Control Plane (Admin Web - edforgeadminweb)
- **User Pool**: Control Plane User Pool (created by SBT CognitoAuth)
- **Purpose**: Platform administrators managing tenants
- **Users**: System admins with roles like "SystemAdmin", "PlatformAdmin"

### Application Plane (Tenant App - edforgewebclient)
- **User Pool**: Basic Tier User Pool (shared pool for all Basic tier tenants)
- **Purpose**: End users (students, teachers, school staff)
- **Users**: Tenant users with `custom:tenantId`, `custom:userRole`, etc.

## Prerequisites

### 1. Deploy Infrastructure

```bash
# From server/ directory
cd /Users/shoaibrain/edforge/server

# Deploy Control Plane stack
npm run cdk deploy -- shared-infra-stack
npm run cdk deploy -- control-plane-stack
npm run cdk deploy -- core-app-plane-stack

# Deploy Basic Tier tenant (this creates the Basic Tier User Pool)
npm run cdk deploy -- tenant-template-stack-basic
```

### 2. Get Configuration Values

#### Admin Web (Control Plane User Pool)

From the Control Plane stack outputs:

```bash
# Get Cognito Client ID
aws cloudformation describe-stacks \
  --stack-name control-plane-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoClientId`].OutputValue' \
  --output text

# Get Well-Known Endpoint URL
aws cloudformation describe-stacks \
  --stack-name control-plane-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoWellKnownUrl`].OutputValue' \
  --output text

# Get Control Plane API URL
aws cloudformation describe-stacks \
  --stack-name control-plane-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ControlPlaneApiUrl`].OutputValue' \
  --output text
```

#### Tenant App (Basic Tier User Pool)

From the Basic Tier tenant stack outputs:

```bash
# Get Basic Tier User Pool ID
aws cloudformation describe-stacks \
  --stack-name tenant-template-stack-basic \
  --query 'Stacks[0].Outputs[?OutputKey==`TenantUserpoolId`].OutputValue' \
  --output text

# Get Basic Tier App Client ID
aws cloudformation describe-stacks \
  --stack-name tenant-template-stack-basic \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text

# Get Tenant API Gateway URL
aws cloudformation describe-stacks \
  --stack-name tenant-template-stack-basic \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
  --output text
```

The Well-Known endpoint URL format is:
```
https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration
```

## Configuration

### Admin Web (edforgeadminweb)

#### Local Development (.env.local)

```bash
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXX/.well-known/openid-configuration
NEXT_PUBLIC_CLIENT_ID=<control-plane-client-id>
NEXT_PUBLIC_API_URL=<control-plane-api-gateway-url>
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3000
```

#### Vercel Deployment

Set the same environment variables in Vercel:
1. Go to Project Settings → Environment Variables
2. Add each variable above
3. Set scope to "Production", "Preview", and "Development"

### Tenant App (edforgewebclient)

#### Local Development (.env.local)

```bash
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXX/.well-known/openid-configuration
NEXT_PUBLIC_CLIENT_ID=<basic-tier-client-id>
NEXT_PUBLIC_API_URL=<tenant-api-gateway-url>
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3001
```

#### Vercel Deployment

Set the same environment variables in Vercel for the tenant app project.

## Configure Cognito Hosted UI

### Control Plane User Pool (Admin Web)

1. AWS Console → Cognito → User Pools → Select Control Plane Pool
2. App Integration → App client list → Select app client
3. Configure Hosted UI:

**Callback URLs:**
```
https://admin.edforge.com/api/auth/callback/cognito
http://localhost:3000/api/auth/callback/cognito
```

**Sign-out URLs:**
```
https://admin.edforge.com
http://localhost:3000
```

**OAuth 2.0 Scopes:**
- ✅ openid
- ✅ email
- ✅ profile
- ✅ Custom scopes: `tenant/tenant_read`, `tenant/tenant_write`, `user/user_read`, `user/user_write`

### Basic Tier User Pool (Tenant App)

1. AWS Console → Cognito → User Pools → Select Basic Tier Pool
2. App Integration → App client list → Select the app client (one per tenant)

For each app client, configure Hosted UI:

**Callback URLs:**
```
https://app.edforge.com/api/auth/callback/cognito
http://localhost:3001/api/auth/callback/cognito
```

**Sign-out URLs:**
```
https://app.edforge.com
http://localhost:3001
```

**OAuth 2.0 Scopes:**
- ✅ openid
- ✅ email
- ✅ profile

## Testing Authentication

### Test Admin Web

```bash
cd client/edforgeadminweb
npm install
npm run dev
```

1. Navigate to http://localhost:3000
2. Click "Sign In"
3. Should redirect to Cognito Hosted UI (Control Plane pool)
4. Login with platform admin credentials
5. Should redirect back with session established

### Test Tenant App

```bash
cd client/edforgewebclient
npm install
npm run dev
```

1. Navigate to http://localhost:3001
2. Click "Sign In"
3. Should redirect to Cognito Hosted UI (Basic Tier pool)
4. Login with tenant user credentials (e.g., student@school.com)
5. Should redirect back with session + tenantId in claims

### Verify JWT Claims

After login, check the `/auth/info` page or use the browser dev tools:

- `tenantId`: Should match the tenant the user belongs to
- `userRole`: Role within the tenant (Student, Teacher, Admin, etc.)
- `tenantTier`: Should be "BASIC" for Basic tier tenants

## Troubleshooting

### "invalid_client" error

- ✅ Check that `NEXT_PUBLIC_CLIENT_ID` is correct
- ✅ Verify the app client exists in Cognito
- ✅ Ensure callback URLs are configured in Cognito

### "Token refresh failed"

- ✅ Check that `NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL` is correct
- ✅ Verify the endpoint is accessible
- ✅ Check browser console for detailed error

### "Invalid token" from backend

- ✅ Verify JWT contains `custom:tenantId` claim
- ✅ Check backend logs for detailed error
- ✅ Ensure tenant ID matches the logged-in user's tenant

### Users can't see their data

- ✅ Verify `custom:tenantId` is correctly set in JWT
- ✅ Check backend services are filtering by tenantId
- ✅ Verify DynamoDB table has data for the correct tenantId

## Security Considerations

### Current Implementation

✅ **Admin Web & Tenant App:**
- OIDC well-known discovery (automatic endpoint discovery)
- PKCE for secure OAuth flows
- Token expiration and automatic refresh
- Secure session management via NextAuth

⚠️ **Backend Services:**
- Go services currently decode JWTs without signature validation (marked with security warning)
- NestJS services have proper JWKS signature validation
- **Recommendation**: Implement proper JWT validation in Go services before production

### Future Enhancements

- [ ] Implement proper JWKS signature validation in Go services
- [ ] Add per-tenant branding via Cognito Managed Login
- [ ] Support custom domains per tenant
- [ ] Add MFA enforcement for security-sensitive roles
- [ ] Implement audit logging for authentication events

## References

- [NextAuth.js Documentation](https://next-auth.js.org)
- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [EdForge Architecture](../README.md)

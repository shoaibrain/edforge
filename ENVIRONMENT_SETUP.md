# Environment Variables Setup Guide

This guide provides step-by-step instructions for setting up environment variables for both NextJS applications.

## Quick Start

### Step 1: Generate NEXTAUTH_SECRET

Generate secrets for both applications:

```bash
# For Admin Web
openssl rand -base64 32

# For SaaS Client (use a different secret)
openssl rand -base64 32
```

### Step 2: Create .env.local Files

#### Admin Web (edforgeadminweb)

Create `client/edforgeadminweb/.env.local`:

```env
# Cognito Configuration (Control Plane User Pool)
NEXT_PUBLIC_CLIENT_ID=2e5s1h0alkmgqv8bro79uckgaa
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_lhufLThrp/.well-known/openid-configuration

# API Configuration
NEXT_PUBLIC_API_URL=https://edxqrry4u8.execute-api.us-east-1.amazonaws.com/

# NextAuth Configuration
NEXTAUTH_SECRET=<paste-your-generated-secret-here>
NEXTAUTH_URL=http://localhost:3000
```

#### SaaS Client (edforgewebclient)

Create `client/edforgewebclient/.env.local`:

```env
# Cognito Configuration (Basic Tier User Pool)
NEXT_PUBLIC_CLIENT_ID=1ptqe4fibq19qcttcdj2p9saug
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XNmCSN3V7/.well-known/openid-configuration

# API Configuration (Tenant API)
# Tenant API Gateway URL from shared-infra-stack deployment
NEXT_PUBLIC_API_URL=https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/

# NextAuth Configuration
NEXTAUTH_SECRET=<paste-your-generated-secret-here>
NEXTAUTH_URL=http://localhost:3001
```

## Tenant API Gateway URL

**Found from deployment:**
```
https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/
```

This is the Tenant API Gateway URL exported from `shared-infra-stack` (Output: `ApiGatewayUrl`).

All Basic tier tenants use this shared API Gateway endpoint. The Lambda Authorizer routes requests to the correct tenant backend based on the JWT `tenantId` claim.

## Cognito User Pool Information

### Admin Web (Control Plane)
- **User Pool ID**: `us-east-1_lhufLThrp`
- **App Client ID**: `2e5s1h0alkmgqv8bro79uckgaa`
- **Well-Known URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_lhufLThrp/.well-known/openid-configuration`

### SaaS Client (Basic Tier)
- **User Pool ID**: `us-east-1_XNmCSN3V7`
- **App Client ID**: `1ptqe4fibq19qcttcdj2p9saug`
- **Well-Known URL**: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XNmCSN3V7/.well-known/openid-configuration`

## Next Steps

After setting up environment variables:

1. **Configure Cognito Callback URLs** - See `auth-architecture-redesign.plan.md`
2. **Create Test Users** - See `auth-architecture-redesign.plan.md`
3. **Test Locally** - Run `npm run dev` in each application directory
4. **Deploy to Vercel** - Configure same environment variables in Vercel dashboard

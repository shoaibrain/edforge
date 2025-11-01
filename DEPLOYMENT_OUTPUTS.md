# Deployment Outputs Reference

This document contains all extracted environment variable values from the successful EdForge SaaS deployment.

## Control Plane Stack (Admin Web - edforgeadminweb)

| Variable | Value | Source |
|----------|-------|--------|
| **CognitoClientId** | `2e5s1h0alkmgqv8bro79uckgaa` | controlplane-stack output |
| **CognitoWellKnownUrl** | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_lhufLThrp/.well-known/openid-configuration` | controlplane-stack output |
| **ControlPlaneApiUrl** | `https://edxqrry4u8.execute-api.us-east-1.amazonaws.com/` | controlplane-stack output |
| **User Pool ID** | `us-east-1_lhufLThrp` | Cognito User Pool |
| **adminSiteUrl** | `https://d2wbfdt89szauf.cloudfront.net` | controlplane-stack output |

## Tenant Stack - Basic Tier (SaaS Client - edforgewebclient)

| Variable | Value | Source |
|----------|-------|--------|
| **UserPoolClientId** | `1ptqe4fibq19qcttcdj2p9saug` | tenant-template-stack-basic output |
| **TenantWellKnownUrl** | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XNmCSN3V7/.well-known/openid-configuration` | tenant-template-stack-basic output |
| **TenantUserpoolId** | `us-east-1_XNmCSN3V7` | tenant-template-stack-basic output |

## Shared Infrastructure Stack

| Variable | Value | Source |
|----------|-------|--------|
| **TenantApiGatewayUrl** | `https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/` | shared-infra-stack output (ApiGatewayUrl) |
| **ALBDnsName** | `internal-shared-sbtec-ytaFSMlonvbw-1483438491.us-east-1.elb.amazonaws.com` | shared-infra-stack output |
| **appSiteUrl** | `https://d1w853i4rahj9y.cloudfront.net` | core-appplane-stack output |

## Environment Variables Summary

### Admin Web Required Variables

```env
NEXT_PUBLIC_CLIENT_ID=2e5s1h0alkmgqv8bro79uckgaa
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_lhufLThrp/.well-known/openid-configuration
NEXT_PUBLIC_API_URL=https://edxqrry4u8.execute-api.us-east-1.amazonaws.com/
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3000
```

### SaaS Client Required Variables

```env
NEXT_PUBLIC_CLIENT_ID=1ptqe4fibq19qcttcdj2p9saug
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XNmCSN3V7/.well-known/openid-configuration
NEXT_PUBLIC_API_URL=https://oi090f8udg.execute-api.us-east-1.amazonaws.com/prod/
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3001
```

## Cognito Callback URLs to Configure

### Admin Web (User Pool: us-east-1_lhufLThrp)

**Allowed callback URLs:**
- `http://localhost:3000/api/auth/callback/cognito`
- `https://<vercel-admin-domain>/api/auth/callback/cognito`

**Allowed sign-out URLs:**
- `http://localhost:3000`
- `https://<vercel-admin-domain>`

### SaaS Client (User Pool: us-east-1_XNmCSN3V7)

**Allowed callback URLs:**
- `http://localhost:3001/api/auth/callback/cognito`
- `https://<vercel-tenant-domain>/api/auth/callback/cognito`

**Allowed sign-out URLs:**
- `http://localhost:3001`
- `https://<vercel-tenant-domain>`

## Next Steps

1. ✅ Environment variables extracted
2. ⏳ Create `.env.local` files (see `ENVIRONMENT_SETUP.md`)
3. ⏳ Generate NEXTAUTH_SECRET for both apps
4. ⏳ Configure Cognito callback URLs
5. ⏳ Create test users in Cognito
6. ⏳ Test authentication flows locally
7. ⏳ Deploy to Vercel and configure production environment variables

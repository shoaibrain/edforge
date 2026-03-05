# Add Missing Network Endpoints to API Gateway + Deployment Plan

## Context

Sprint 6 Task 6.7 added **Network CRUD and Network Member management** endpoints to the NestJS controller (`education-organizations.controller.ts`). The controller now has **24 endpoints**, but the AWS API Gateway spec (`tenant-api-prod.json`) only defines routes through the ESC endpoints — **all 9 network endpoints are missing** from the API Gateway. Without these, network API calls from the frontend will return 403/404 at the gateway level before reaching the backend.

The NGINX reverse proxy already has a catch-all `location ~ ^/education-organizations` rule, so no nginx changes are needed.

## Gap Analysis

| # | Controller Endpoint | In API Gateway? |
|---|---|---|
| 1 | `GET /education-organizations/networks` | **MISSING** |
| 2 | `POST /education-organizations/networks` | **MISSING** |
| 3 | `GET /education-organizations/networks/{networkId}` | **MISSING** |
| 4 | `PATCH /education-organizations/networks/{networkId}` | **MISSING** |
| 5 | `DELETE /education-organizations/networks/{networkId}` | **MISSING** |
| 6 | `GET /education-organizations/networks/{networkId}/members` | **MISSING** |
| 7 | `POST /education-organizations/networks/{networkId}/members` | **MISSING** |
| 8 | `PATCH /education-organizations/networks/{networkId}/members/{memberId}` | **MISSING** |
| 9 | `DELETE /education-organizations/networks/{networkId}/members/{memberId}` | **MISSING** |

All existing endpoints (hierarchy, SEA, LEAs, ESCs) are correctly defined — no gaps there.

## File to Modify

**`server/lib/tenant-api-prod.json`** — Insert 4 new path blocks before the closing `}` of the `"paths"` object (line 10163).

### Insertion Point
After line 10163 (the closing `}` of `/education-organizations/escs/{escId}`), before line 10164 (`},` closing `"paths"`).

### New Path Blocks (4 paths)

Each follows the exact same structure as existing ESC paths:
- `http_proxy` integration with `VPC_LINK`
- `tenantPath` header parameter forwarded via `context.authorizer.tenantPath`
- Path parameters mapped via `integration.request.path.{param}` → `method.request.path.{param}`
- `sharedApigatewayTenantApiAuthorizer` security
- `OPTIONS` mock integration for CORS

**Path 1: `/education-organizations/networks`**
- Methods: `get`, `post`, `options`
- No path parameters
- CORS Allow-Methods: `'GET,POST,OPTIONS'`
- URI: `{{integration_uri}}/education-organizations/networks`

**Path 2: `/education-organizations/networks/{networkId}`**
- Methods: `get`, `patch`, `delete`, `options`
- Path parameter: `networkId` (string, required)
- CORS Allow-Methods: `'GET,PATCH,DELETE,OPTIONS'`
- URI: `{{integration_uri}}/education-organizations/networks/{networkId}`
- Request mapping: `integration.request.path.networkId` → `method.request.path.networkId`

**Path 3: `/education-organizations/networks/{networkId}/members`**
- Methods: `get`, `post`, `options`
- Path parameter: `networkId` (string, required)
- CORS Allow-Methods: `'GET,POST,OPTIONS'`
- URI: `{{integration_uri}}/education-organizations/networks/{networkId}/members`
- Request mapping: `integration.request.path.networkId` → `method.request.path.networkId`

**Path 4: `/education-organizations/networks/{networkId}/members/{memberId}`**
- Methods: `patch`, `delete`, `options`
- Path parameters: `networkId` + `memberId` (both string, required)
- CORS Allow-Methods: `'PATCH,DELETE,OPTIONS'`
- URI: `{{integration_uri}}/education-organizations/networks/{networkId}/members/{memberId}`
- Request mapping: both `networkId` and `memberId`

## No Changes Needed

- **NGINX** (`server/application/reverseproxy/nginx.template`): Already has catch-all `location ~ ^/education-organizations` routing to identity service
- **Controller**: Already has all 9 endpoints implemented
- **CDK stack code**: No changes — it reads from `tenant-api-prod.json` automatically

## Deployment Steps (in order)

Per the AWS CLI Operations Guide:

### Step 1: Deploy `shared-infra-stack` (API Gateway routes changed)
```bash
cd /Users/shoaibrain/edforge/server
AWS_PROFILE=dev npx cdk deploy shared-infra-stack --require-approval=never
```
This updates the API Gateway with the new network route definitions.

### Step 2: Build and push application Docker images
```bash
cd /Users/shoaibrain/edforge/scripts
AWS_PROFILE=dev ./build-application.sh
```
This rebuilds all services (identity, academics, rproxy) with the latest code including the network controller endpoints.

### Step 3: Force redeploy the identity service (handles education-organizations routes)
```bash
AWS_PROFILE=dev aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --force-new-deployment \
  --region us-east-1
```

### Step 4 (optional): Redeploy rproxy if nginx template changed (not needed this time)
```bash
# Not needed — nginx already routes /education-organizations to identity service
```

### Step 5: Verify deployment
```bash
# Check ECS service is stable
AWS_PROFILE=dev aws ecs describe-services \
  --cluster prod-basic \
  --services identitybasic \
  --query 'services[0].deployments' \
  --region us-east-1

# Test a network endpoint through the API Gateway
# (requires valid auth token)
```

## Verification

1. After editing `tenant-api-prod.json`, validate it's valid JSON: `cat server/lib/tenant-api-prod.json | python3 -m json.tool > /dev/null`
2. After CDK deploy, verify the API Gateway in AWS Console shows the new `/education-organizations/networks*` routes
3. After ECS redeploy, test `GET /education-organizations/networks` returns 200 (empty list) with a valid auth token
4. Test `POST /education-organizations/networks` creates a network successfully
5. Test member management: `POST /education-organizations/networks/{id}/members`

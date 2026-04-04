# EdForge V1 Developer & Architecture Document

> **Version**: V1 MVP (Basic Tier Only)
> **Last Updated**: March 30, 2026
> **Branch**: `epic02-infra`

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [CDK Infrastructure Stacks](#3-cdk-infrastructure-stacks)
4. [Microservice Architecture](#4-microservice-architecture)
5. [DynamoDB Data Model](#5-dynamodb-data-model)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [API Gateway & Routing](#7-api-gateway--routing)
8. [Tenant Provisioning Lifecycle](#8-tenant-provisioning-lifecycle)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Deployment & Operations](#10-deployment--operations)
11. [V1 Tier Deferral Strategy](#11-v1-tier-deferral-strategy)
12. [Known Issues & Operational Notes](#12-known-issues--operational-notes)

---

## 1. System Overview

EdForge is a multi-tenant SaaS platform for K-12 school management, built on the **AWS SaaS Builder Toolkit (SBT-AWS)** ECS reference architecture. It provides identity management, academics (students, grades, attendance), and finance (fees, invoices, payments) as NestJS microservices running on ECS Fargate, fronted by API Gateway with per-tenant DynamoDB isolation via ABAC (Attribute-Based Access Control).

### V1 MVP Scope

- **Supported Tier**: Basic only (shared ECS cluster, shared DynamoDB tables with tenant-partitioned access)
- **Deferred Tiers**: Advanced (per-tenant ECS cluster) and Premium (dedicated infrastructure) are code-complete but gated behind `V1_DEFERRED` markers
- **Services**: Identity, Academics, Finance (3 NestJS microservices + 1 NGINX reverse proxy)
- **Frontend**: React AdminWeb (system admin console) + Rspack Module Federation MFE (tenant-facing app)

### Technology Stack

| Layer | Technology |
|-------|-----------|
| IaC | AWS CDK (TypeScript), SBT-AWS constructs |
| Compute | ECS Fargate (ARM64) |
| API | Amazon API Gateway (REST, OpenAPI) |
| Auth | Amazon Cognito (dual pool: admin + per-tenant) |
| Database | Amazon DynamoDB (single-table design, PAY_PER_REQUEST) |
| DNS | ECS Service Connect (AWS Cloud Map) |
| Events | Amazon EventBridge (SBT event bus) |
| CI/Build | AWS CodeBuild (tenant provisioning) |
| CDN | Amazon CloudFront (AdminWeb static hosting) |
| Container Registry | Amazon ECR |
| Frontend | React 18, MUI, Rspack Module Federation |

---

## 2. Architecture Overview

### High-Level Request Flow

```
Browser
  │
  ├─→ CloudFront ──→ S3 (AdminWeb static assets)
  │
  └─→ API Gateway (REST)
        │
        ├─→ Lambda Authorizer (JWT validation + STS credential minting)
        │
        └─→ VPC Link ──→ ALB ──→ NGINX Reverse Proxy (rproxy)
                                    │
                                    ├─→ identity-api.basic.sc:3010
                                    ├─→ academics-api.basic.sc:3010
                                    └─→ finance-api.basic.sc:3010
                                          │
                                          └─→ DynamoDB (tenant-scoped via ABAC)
```

### Network Topology

- **VPC**: 3 Availability Zones, 3 private subnets + 3 public subnets
- **ALB** (Application Load Balancer): Public-facing, routes to NGINX rproxy via `tenantPath` header
- **NLB** (Network Load Balancer): Internal, used by API Gateway VPC Link
- **ECS Service Connect**: CloudMap namespace (`basic.sc`) for inter-service DNS resolution
- **Security Groups**: ECS tasks allow inbound from ALB only; outbound is unrestricted (for ECR pulls, Cognito, DynamoDB, payment gateways)

### Stack Dependency Chain

```
shared-infra-stack ──────────────→ controlplane-stack ──→ core-appplane-stack
       │                                   │
       ├──→ tenant-template-stack-basic    │ (depends on eventBusName)
       └──→ tenant-template-stack-advanced │
```

Defined in `server/bin/ecs-saas-ref-template.ts` (CDK app entry point).

---

## 3. CDK Infrastructure Stacks

### 3.1 SharedInfraStack (`shared-infra-stack`)

**File**: `server/lib/shared-infra/shared-infra-stack.ts`

Creates the foundational networking and API layer shared by all tenants.

| Resource | Purpose |
|----------|---------|
| VPC (3 AZs) | Network isolation, private + public subnets |
| ALB + NLB | Load balancing; NLB used for API Gateway VPC Link |
| API Gateway (REST) | Tenant API with OpenAPI spec from `tenant-api-prod.json` |
| Lambda Authorizer | JWT validation, STS ABAC credential generation |
| TenantMappingTable (DynamoDB) | Maps `tenantId` → stack outputs, Cognito pool IDs, tier info |
| CloudFront + S3 | AdminWeb static site hosting |
| S3 Access Logs Bucket | Centralized access logging |
| API Usage Plans | Basic, Advanced, Premium tier rate limits |
| WAF WebACL | API Gateway protection |

**Key Outputs**:
- `ApiGatewayUrl` — REST API endpoint
- `adminSiteUrl` — CloudFront URL for AdminWeb
- `VpcId`, `PrivateSubnetIds`, `PublicSubnetIds`

### 3.2 ControlPlaneStack (`controlplane-stack`)

**File**: `server/lib/bootstrap-template/control-plane-stack.ts`

Implements the SBT-AWS Control Plane pattern for tenant lifecycle management.

| Resource | Purpose |
|----------|---------|
| `CognitoAuth` (SBT) | System admin Cognito User Pool + app client |
| `ControlPlane` (SBT) | REST API for tenant CRUD, billing integration hooks |
| `EventManager` (SBT) | EventBridge event bus (`sbt-ecs-control-plane-events`) |
| CloudFront Admin Distro | OAC-secured distribution for AdminWeb |

**SBT Constructs Used**:
- `@cdklabs/sbt-aws.CognitoAuth` — Admin authentication
- `@cdklabs/sbt-aws.ControlPlane` — Tenant registration API
- `@cdklabs/sbt-aws.EventManager` — EventBridge lifecycle events

**Key Outputs**:
- `controlPlaneAPIEndpoint` — Control Plane REST API URL
- `CognitoUserPoolId` — Admin pool ID
- `CognitoUserPoolClientId` — Admin app client ID
- `eventBusName` — SBT event bus name

### 3.3 CoreAppPlaneStack (`core-appplane-stack`)

**File**: `server/lib/bootstrap-template/core-appplane-stack.ts`

Wires SBT event-driven provisioning: when a tenant onboarding event fires on EventBridge, it triggers a CodeBuild-based provisioning job.

| Resource | Purpose |
|----------|---------|
| `CoreApplicationPlane` (SBT) | Manages provisioning/deprovisioning jobs |
| `ProvisioningScriptJob` (SBT) | CodeBuild project wrapping `provision-tenant.sh` |
| `DeprovisioningScriptJob` (SBT) | CodeBuild project wrapping `deprovision-tenant.sh` |
| AdminWeb S3 Deployment | Builds and deploys AdminWeb to S3 + CloudFront invalidation |
| TenantSeeder Lambda | Post-provisioning: seeds tenant metadata into DynamoDB |

**Event Flow**:
```
ControlPlane API (POST /tenants)
  → EventBridge: detail-type="Onboarding"
    → Step Functions: ProvisioningScriptJob
      → CodeBuild: provision-tenant.sh
        → CDK deploy tenant-template-stack-{tenantId}
          → EventBridge: sbt_aws_provisionSuccess
            → TenantSeeder Lambda
              → DynamoDB: METADATA, SETTINGS#WORKSPACE records
```

### 3.4 TenantTemplateStack (`tenant-template-stack-{tenantId}`)

**File**: `server/lib/tenant-template/tenant-template-stack.ts`

Per-tier (V1: per-basic) infrastructure template. Creates compute, storage, and IAM for tenant workloads.

| Construct | File | Resources |
|-----------|------|-----------|
| `IdentityProvider` | `identity-provider.ts` | Cognito User Pool (per-tenant), user groups, custom attributes |
| `EcsCluster` | `ecs-cluster.ts` | ECS Cluster, CloudMap namespace, capacity providers |
| `EcsService` (x4) | `ecs-service.ts` | Fargate service, task definition, ALB target group, Service Connect |
| `EcsDynamoDB` (x3) | `ecs-dynamodb.ts` | DynamoDB table + ABAC IAM role per service |
| `TenantUpdateStack` | `tenant-update-stack.ts` | CodePipeline for rolling updates (S3 source → CodeBuild → ECS deploy) |

**V1 Basic Tier Resources**:
- ECS Cluster: `prod-basic` (Fargate, shared by all basic tenants)
- Services: `identitybasic`, `academicsbasic`, `financebasic`, `rproxybasic`
- DynamoDB Tables: `edforge-identity-basic`, `edforge-academics-basic`, `edforge-finance-basic`
- Cognito Pool: `basicUserPool` (per-tenant user management)
- Namespace: `basic.sc` (Service Connect DNS)

---

## 4. Microservice Architecture

### 4.1 Service Map

All microservices are NestJS applications running on port 3010, deployed as ECS Fargate tasks (256 CPU / 512 MiB memory, ARM64).

| Service | ECR Repo | Dockerfile | Port | DynamoDB Table | Service Connect DNS |
|---------|----------|------------|------|---------------|-------------------|
| Identity | `identity` | `Dockerfile.identity` | 3010 | `edforge-identity-basic` | `identity-api.basic.sc:3010` |
| Academics | `academics` | `Dockerfile.academics` | 3010 | `edforge-academics-basic` | `academics-api.basic.sc:3010` |
| Finance | `finance` | `Dockerfile.finance` | 3010 | `edforge-finance-basic` | `finance-api.basic.sc:3010` |
| Reverse Proxy | `rproxy` | `Dockerfile.rproxy` | 80 | N/A | `rproxy.basic.sc:80` |

### 4.2 Shared Types Package

**Path**: `server/application/shared-types/`

TypeScript package (`@edforge/shared-types`) shared across all microservices. Contains:
- `TenantCredentials` interface (STS session credentials from TVM)
- `TokenVendingMachine` class (STS `AssumeRole` + `TagSession` for ABAC)
- `DynamoDBService` base class (tenant-scoped CRUD operations)
- Common DTOs, entity key helpers, error types

Built before Docker images via `npm run build` in `shared-types/`.

### 4.3 Identity Service

**Path**: `server/application/microservices/identity/`

Manages tenant users, schools, workspaces, and authentication against Cognito.

**Modules**:
- `auth/` — Cognito authentication (login, MFA, password management)
- `users/` — CRUD for tenant users (staff, teachers, admins)
- `schools/` — School entity management
- `students/` — Student records (with bulk CSV import)
- `workspaces/` — Tenant workspace settings
- `guardians/` — Guardian/parent records linked to students
- `tenant/` — Tenant metadata and configuration

**Key API Endpoints**:
```
POST   /auth/login
POST   /auth/change-password
POST   /auth/mfa/setup
GET    /users
POST   /users
GET    /users/:id
PUT    /users/:id
DELETE /users/:id
GET    /schools
POST   /schools
GET    /schools/:id
GET    /students
POST   /students
POST   /students/bulk-upload (CSV)
GET    /students/:id
PUT    /students/:id
GET    /guardians
POST   /guardians
GET    /tenant/metadata
PUT    /tenant/settings
```

### 4.4 Academics Service

**Path**: `server/application/microservices/academics/`

Manages academic structure: academic years, terms, grade levels, sections, subjects, bell schedules, attendance, and report cards.

**Modules**:
- `academic-years/` — Academic year definitions
- `terms/` — Term/semester management within academic years
- `grade-levels/` — Grade level hierarchy
- `sections/` — Class sections within grade levels
- `subjects/` — Subject definitions per grade level
- `bell-schedules/` — Period timing and bell schedule templates
- `attendance/` — Daily attendance tracking
- `report-cards/` — Student report card generation

**Key API Endpoints**:
```
GET/POST       /academic-years
GET/PUT/DELETE /academic-years/:id
GET/POST       /academic-years/:yearId/terms
GET/POST       /grade-levels
GET/POST       /grade-levels/:gradeId/sections
GET/POST       /grade-levels/:gradeId/subjects
GET/POST       /bell-schedules
GET/POST       /attendance
GET/POST       /report-cards
```

### 4.5 Finance Service

**Path**: `server/application/microservices/finance/`

Manages fee structures, invoices, payments, and payment gateway integrations (eSewa, Khalti).

**Modules**:
- `fee-structures/` — Fee template definitions per school
- `invoices/` — Invoice generation and tracking
- `payments/` — Payment recording and reconciliation
- `payment-gateways/` — Gateway configuration (eSewa, Khalti)
- `dashboard/` — Financial summary and analytics

**Key API Endpoints**:
```
GET/POST       /finance/schools/:schoolId/fee-structures
GET/POST       /finance/schools/:schoolId/invoices
POST           /finance/schools/:schoolId/invoices/generate
GET/POST       /finance/payments
POST           /finance/payments/initiate
POST           /finance/payments/verify
GET/POST       /finance/schools/:schoolId/payment-gateways/:gateway
GET            /finance/dashboard/summary
```

**External Dependencies**:
- eSewa: `rc-epay.esewa.com.np` (sandbox) / `epay.esewa.com.np` (production)
- Khalti: `dev.khalti.com` (sandbox) / `khalti.com` (production)
- Gateway credentials stored in DynamoDB (admin-configurable per school)

### 4.6 Reverse Proxy (NGINX)

**Path**: `server/application/reverseproxy/`

NGINX configuration template (`nginx.template`) that routes requests to backend services via Service Connect DNS.

```nginx
# Route resolution (envsubst replaces $NAMESPACE at container start)
location /identity { proxy_pass http://identity-api.${NAMESPACE}.sc:3010; }
location /users    { proxy_pass http://identity-api.${NAMESPACE}.sc:3010; }
location /schools  { proxy_pass http://identity-api.${NAMESPACE}.sc:3010; }
location /students { proxy_pass http://identity-api.${NAMESPACE}.sc:3010; }
location /academics { proxy_pass http://academics-api.${NAMESPACE}.sc:3010; }
location /finance   { proxy_pass http://finance-api.${NAMESPACE}.sc:3010; }
```

The `NAMESPACE` environment variable is set to the tenant name (e.g., `basic`) by the ECS task definition, resolving to the Service Connect CloudMap namespace.

### 4.7 Inter-Service Communication

Services communicate via HTTP over Service Connect DNS:

```
Academics Service ──HTTP──→ identity-api.basic.sc:3010  (validate users, get school data)
Finance Service   ──HTTP──→ identity-api.basic.sc:3010  (validate students, get school data)
```

Identity is the "source of truth" service — Academics and Finance call it to resolve tenant context and validate entities.

---

## 5. DynamoDB Data Model

### 5.1 Single-Table Design

Each service has one DynamoDB table using a composite key pattern:

| Attribute | Type | Description |
|-----------|------|-------------|
| `tenantId` (PK) | String | Tenant identifier (e.g., `basic`) — partition key |
| `entityKey` (SK) | String | Composite sort key: `ENTITY_TYPE#ID` |

**Billing Mode**: PAY_PER_REQUEST (on-demand capacity)

### 5.2 Identity Service Entity Keys

Table: `edforge-identity-basic`

| Entity | entityKey Pattern | Example |
|--------|------------------|---------|
| Metadata | `METADATA` | `METADATA` |
| Workspace Settings | `SETTINGS#WORKSPACE` | `SETTINGS#WORKSPACE` |
| School | `SCHOOL#{schoolId}` | `SCHOOL#sch-001` |
| User | `USER#{userId}` | `USER#usr-001` |
| Student | `STUDENT#{studentId}` | `STUDENT#stu-001` |
| Guardian | `GUARDIAN#{guardianId}` | `GUARDIAN#grd-001` |
| Guardian-Student Link | `GUARDIAN_STUDENT#{id}` | `GUARDIAN_STUDENT#gs-001` |

**GSIs (6 indexes)**:
| GSI | PK | SK | Purpose |
|-----|----|----|---------|
| GSI1 | `tenantId` | `gsi1sk` | Query by entity type within tenant |
| GSI2 | `tenantId` | `gsi2sk` | Query by status/role |
| GSI3 | `tenantId` | `gsi3sk` | Query by school affiliation |
| GSI4 | `tenantId` | `gsi4sk` | Query by email/username |
| GSI5 | `tenantId` | `gsi5sk` | Query by guardian-student relationship |
| GSI6 | `tenantId` | `gsi6sk` | Query by grade level |

### 5.3 Academics Service Entity Keys

Table: `edforge-academics-basic`

| Entity | entityKey Pattern |
|--------|------------------|
| Academic Year | `ACADEMIC_YEAR#{yearId}` |
| Term | `TERM#{termId}` |
| Grade Level | `GRADE#{gradeId}` |
| Section | `SECTION#{sectionId}` |
| Subject | `SUBJECT#{subjectId}` |
| Bell Schedule | `BELL_SCHEDULE#{scheduleId}` |
| Attendance Record | `ATTENDANCE#{date}#{studentId}` |
| Report Card | `REPORT_CARD#{studentId}#{termId}` |

### 5.4 Finance Service Entity Keys

Table: `edforge-finance-basic`

| Entity | entityKey Pattern |
|--------|------------------|
| Fee Structure | `FEE_STRUCTURE#{feeId}` |
| Invoice | `INVOICE#{invoiceId}` |
| Payment | `PAYMENT#{paymentId}` |
| Payment Gateway Config | `PAYMENT_GATEWAY#{gateway}#{schoolId}` |
| Dashboard Summary | `DASHBOARD#{schoolId}#{period}` |

### 5.5 TenantMappingTable

Table: `shared-infra-stack-TenantMappingTable*` (created by SharedInfraStack)

Maps tenantId to infrastructure outputs. Used by the Lambda Authorizer to resolve tenant context at request time.

| Attribute | Purpose |
|-----------|---------|
| `tenantId` (PK) | Tenant identifier |
| `tenantName` | Human-readable name |
| `tier` | `basic`, `advanced`, or `premium` |
| `userPoolId` | Tenant Cognito pool ID |
| `appClientId` | Tenant Cognito app client ID |
| `stackName` | CloudFormation stack name |
| `albListenerArn` | ALB listener ARN for routing |

---

## 6. Authentication & Authorization

### 6.1 Dual Cognito Pool Architecture

```
System Admin Pool (controlplane-stack)
  ├── Pool: SaaSControlPlaneUserPool
  ├── Users: Platform admins (super-admin role)
  ├── Client: AdminWeb React app
  └── Used for: Tenant CRUD, platform management

Tenant Pool (tenant-template-stack-basic)
  ├── Pool: basicUserPool
  ├── Users: Tenant admins, teachers, staff
  ├── Custom Attributes: tenantId, tenantTier, userRole
  ├── Groups: TenantAdmin, Teacher, Staff, ReadOnly
  └── Used for: Tenant-scoped API access
```

### 6.2 Lambda Authorizer Flow

**File**: `server/lib/shared-infra/lambda/lambda-authorizer.ts`

```
1. API Gateway receives request with Authorization header (JWT) + x-api-key
2. Lambda Authorizer:
   a. Decodes JWT to extract tenantId from custom claims
   b. Looks up TenantMappingTable to get tenant's userPoolId
   c. Validates JWT signature against tenant's Cognito JWKS
   d. Calls STS AssumeRole with session tags:
      - TenantId = {tenantId}
      - ServiceName = {target service}
   e. Returns IAM policy + context:
      - tenantPath = {tenantName} (for ALB routing)
      - tenantId, tenantTier (for downstream services)
      - STS credentials (for DynamoDB ABAC)
```

### 6.3 Token Vending Machine (TVM) & ABAC

**Files**:
- `server/application/shared-types/src/tvm/` — TVM client
- `server/lib/tenant-template/ecs-dynamodb.ts` — ABAC role definition

The ABAC pattern provides row-level DynamoDB isolation without per-tenant tables:

```
ECS Task Role
  │
  ├── Direct permissions (bootstrap): GetItem, PutItem, Query
  │   (Used for pre-auth operations like health checks)
  │
  └── STS AssumeRole → ABAC Role
      │
      └── DynamoDB policy with condition:
          "dynamodb:LeadingKeys": ["${aws:PrincipalTag/TenantId}"]

          → A task with TenantId=tenant-A can ONLY access rows
            where partitionKey = "tenant-A"
```

**ABAC Role Policy** (from `ecs-dynamodb.ts`):
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
    "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
    "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"
  ],
  "Resource": ["arn:aws:dynamodb:*:*:table/edforge-{service}-{tier}*"],
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["${aws:PrincipalTag/TenantId}"]
    }
  }
}
```

### 6.4 IAM Role Hierarchy

Each service has **two IAM roles**:

| Role | Purpose | Defined In |
|------|---------|-----------|
| `{service}-ecsTaskRole` | ECS task execution + direct permissions (Cognito, SSM, STS AssumeRole) | `tenant-template-stack.ts` via `service-info.json` |
| `{service}-ABACRole` | Tenant-scoped DynamoDB access via STS session tags | `ecs-dynamodb.ts` |

The task role's direct permissions include:
- Identity: Cognito admin operations (`AdminCreateUser`, `AdminDeleteUser`, etc.)
- All services: `sts:AssumeRole` + `sts:TagSession` (to assume ABAC role)
- All services: SSM messages (ECS Exec support)

---

## 7. API Gateway & Routing

### 7.1 OpenAPI Specification

**File**: `server/lib/tenant-api-prod.json`

The API Gateway is configured via an OpenAPI spec with `x-amazon-apigateway-integration` extensions. Each route maps to a VPC Link integration pointing at the NLB, which forwards to the ALB, which routes to the NGINX reverse proxy.

### 7.2 Route Structure

```
API Gateway (REST)
  │
  ├── /identity/*    ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /auth/*         ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /users/*        ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /schools/*      ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /students/*     ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /guardians/*    ──→ VPC Link → ALB → rproxy → identity-api:3010
  ├── /academics/*    ──→ VPC Link → ALB → rproxy → academics-api:3010
  ├── /finance/*      ──→ VPC Link → ALB → rproxy → finance-api:3010
  └── /health         ──→ VPC Link → ALB → rproxy → identity-api:3010
```

All routes use the `sharedApigatewayTenantApiAuthorizer` (Lambda Authorizer). The authorizer injects `tenantPath` into the integration request header, which the ALB uses for listener rule routing.

### 7.3 API Usage Plans

| Tier | Rate Limit | Burst | Throttle |
|------|-----------|-------|----------|
| Basic | 100 req/s | 200 | Per-key |
| Advanced | 500 req/s | 1000 | Per-key |
| Premium | 2000 req/s | 4000 | Per-key |

API keys are stored in SSM Parameter Store (`apiKeyBasicTierValue`, `apiKeyAdvancedTierValue`, `apiKeyPremiumTierValue`).

---

## 8. Tenant Provisioning Lifecycle

### 8.1 Onboarding Flow

```
Admin creates tenant via ControlPlane API (POST /tenants)
  │
  ├─→ SBT writes to TenantDetails + TenantRegistration DynamoDB tables
  │
  ├─→ EventBridge event: detail-type="Onboarding"
  │     │
  │     └─→ Step Functions: ProvisioningScriptJob
  │           │
  │           └─→ CodeBuild: provision-tenant.sh
  │                 │
  │                 ├── V1 TIER GUARD: if tier != "basic", skip CDK deploy
  │                 │   (Advanced/Premium provisioning deferred)
  │                 │
  │                 ├── npx cdk deploy tenant-template-stack-{tenantId}
  │                 │
  │                 ├── Write stack outputs to TenantMappingTable
  │                 │
  │                 └── Emit sbt_aws_provisionSuccess event
  │
  └─→ TenantSeeder Lambda (triggered by provisionSuccess)
        │
        ├── Write METADATA record to edforge-identity-{tier}
        ├── Write SETTINGS#WORKSPACE record with country defaults
        └── Log seeding results
```

### 8.2 Provisioning Scripts

| Script | File | Purpose |
|--------|------|---------|
| `provision-tenant.sh` | `server/lib/provision-scripts/provision-tenant.sh` | CDK deploy + TenantMapping update |
| `deprovision-tenant.sh` | `server/lib/provision-scripts/deprovision-tenant.sh` | CDK destroy + resource cleanup |

### 8.3 TenantSeeder Lambda

**File**: `server/lib/bootstrap-template/tenant-seeder-lambda/`

Post-provisioning Lambda that seeds initial tenant metadata into the service DynamoDB tables. Uses country-specific defaults (e.g., Nepal school settings with Nepali academic calendar).

**Seeded Records**:
- `METADATA` — Tenant name, tier, creation timestamp, config
- `SETTINGS#WORKSPACE` — Country, timezone, academic calendar type, currency, locale

### 8.4 SBT DynamoDB Tables

The SBT framework maintains its own tables (managed by ControlPlane construct):

| Table | Contents |
|-------|----------|
| `TenantDetails` | Tenant metadata: name, email, tier, status, config JSON |
| `TenantRegistration` | Registration lifecycle: status (In Progress → Created → Failed), timestamps |

These are **separate** from the application DynamoDB tables (`edforge-*`).

---

## 9. Frontend Architecture

### 9.1 AdminWeb (System Admin Console)

**Path**: `client/AdminWeb/`
**Stack**: React 18, MUI v5, React Router v6
**Deployment**: S3 + CloudFront (built and deployed by `core-appplane-stack`)

**Pages**:
- `/` — Dashboard (tenant stats, tier distribution, recent activity)
- `/tenants` — Tenant list with search/filter
- `/tenants/create` — Tenant onboarding form
- `/tenants/:id` — Tenant detail view
- `/settings` — Platform settings

**Key Hooks**:
- `useDashboardStats()` — Aggregates tenant data from SBT API
- `useTenants()` — CRUD operations against Control Plane API

**Configuration** (`.env`):
```
REACT_APP_CLIENT_ID=     # Cognito admin app client ID
REACT_APP_ISSUER=        # Cognito issuer URL (well-known endpoint)
REACT_APP_API_URL=       # Control Plane API URL
REACT_APP_API_GATEWAY_URL= # Tenant API Gateway URL
```

### 9.2 EdForge SaaS MFE (Tenant-Facing App)

**Path**: `client/edforge-saas-mfe/`
**Stack**: React 18, Rspack, Module Federation

Microfrontend architecture with a shell app that dynamically loads remote modules:

| App | Port | Remote Name | Exposed Modules |
|-----|------|------------|-----------------|
| Shell | 3000 | `shell` | Layout, routing, auth context |
| Academics | 3002 | `academics` | Academic year, terms, grades, attendance |
| Finance | 3003 | `finance` | Fee structures, invoices, payments |
| People | 3004 | `people` | Users, students, guardians |

**Module Federation Config** (Rspack):
```javascript
// Shell loads remotes at runtime
remotes: {
  academics: 'academics@http://localhost:3002/remoteEntry.js',
  finance: 'finance@http://localhost:3003/remoteEntry.js',
  people: 'people@http://localhost:3004/remoteEntry.js',
}
```

Each remote MFE receives tenant context (tenantId, credentials, API URL) from the shell via React context providers.

---

## 10. Deployment & Operations

### 10.1 Two Deployment Paths

```
APPLICATION CODE (server/application/)         INFRASTRUCTURE (server/lib/)
  1. Build Docker images                         1. CDK synth + deploy
     → scripts/build-application.sh                → npx cdk deploy {stack}
  2. Push to ECR (included in build)             2. CloudFormation updates
  3. Force ECS redeploy                            (IAM, DynamoDB, task defs)
     → aws ecs update-service --force-new-deployment
```

**If your change touches both** (e.g., new DynamoDB action + code that uses it):
1. CDK deploy **first** (IAM policy update)
2. Docker build + push **second**
3. ECS force redeploy **last**

### 10.2 Key Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/install.sh <email>` | Full fresh deployment (bootstrap + CDK deploy all) | First-time setup or post-teardown |
| `scripts/build-application.sh` | Build + push all Docker images to ECR | After application code changes |
| `scripts/fresh-deploy.sh` | Rebuild images + force ECS redeploy (no infra changes) | Quick redeploy of all services |
| `scripts/cleanup/cleanup.sh` | Complete teardown of all AWS resources | Environment reset |
| `scripts/utils/update-provision-source.sh` | Package + upload `source.tar.gz` to S3 | Before deployment (called by install.sh) |

### 10.3 Environment Variables

**CDK Environment** (`server/.env`):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CDK_PARAM_SYSTEM_ADMIN_EMAIL` | Yes | — | Admin receives Cognito temp password |
| `CDK_PARAM_TIER` | Yes | — | Tier being deployed (`basic`) |
| `CDK_PARAM_STAGE` | No | `prod` | Stage name prefix |
| `CDK_PARAM_TENANT_ID` | No | `basic` | Tenant ID for template stack |
| `CDK_PARAM_TENANT_NAME` | No | `basic` | Tenant display name |
| `CDK_ADV_CLUSTER` | No | `INACTIVE` | Advanced cluster state (`ACTIVE`/`INACTIVE`) |
| `CDK_NAG_ENABLED` | No | `false` | Enable CDK Nag security checks |
| `CDK_PARAM_NEXTJS_APP_URL` | No | `https://edforge.app` | Client app URL for CORS |

**Runtime Environment** (ECS task definitions, from `service-info.json`):

| Variable | Service | Value |
|----------|---------|-------|
| `TABLE_NAME` | All | `edforge-{service}-{tier}` |
| `NAMESPACE` | rproxy | Tenant name (e.g., `basic`) |
| `USER_POOL_ID` | identity | Tenant Cognito pool ID |
| `PORT` | All | `3010` |

### 10.4 CDK Nag

CDK Nag (`AwsSolutionsChecks`) is a security linter. It's enabled in `.env` but **blocks deployment** due to pre-existing warnings (managed IAM policies, wildcard resources).

**To deploy, always prefix with**: `CDK_NAG_ENABLED=false`

```bash
CDK_NAG_ENABLED=false AWS_PROFILE=uat npx cdk deploy shared-infra-stack --require-approval=never
```

### 10.5 Docker Build Architecture

All Docker images target `linux/amd64` platform (ECS Fargate). Build context is the monorepo root (`/Users/shoaibrain/edforge/`) because microservices depend on `shared-types`.

```
edforge/                          # Docker build context
├── server/application/
│   ├── shared-types/             # Built first (npm run build)
│   ├── Dockerfile.identity       # FROM node:20-slim, COPY shared-types + identity
│   ├── Dockerfile.academics      # FROM node:20-slim, COPY shared-types + academics
│   ├── Dockerfile.finance        # FROM node:20-slim, COPY shared-types + finance
│   └── Dockerfile.rproxy         # FROM nginx:alpine, COPY nginx.template
```

### 10.6 Monitoring & Observability

| Resource | CloudWatch Log Group | Purpose |
|----------|---------------------|---------|
| Identity Service | `/ecs/identitybasic` | Application logs |
| Academics Service | `/ecs/academicsbasic` | Application logs |
| Finance Service | `/ecs/financebasic` | Application logs |
| Reverse Proxy | `/ecs/rproxybasic` | NGINX access/error logs |
| Lambda Authorizer | `/aws/lambda/shared-infra-stack-*` | Auth failures, token validation |
| Provisioning | `/aws/codebuild/provisioningScript*` | Tenant onboarding logs |
| Deprovisioning | `/aws/codebuild/deprovisioningScript*` | Tenant offboarding logs |
| API Gateway | `shared-infra-stack-ApiGateway*` | Request/response logs |

**Useful Log Queries**:
```bash
# Tail service logs
AWS_PROFILE=uat aws logs tail /ecs/identitybasic --follow --region us-east-2

# Filter for errors
AWS_PROFILE=uat aws logs tail /ecs/academicsbasic --filter-pattern "ERROR" --since 1h

# Check provisioning
AWS_PROFILE=uat aws logs tail /aws/codebuild/provisioningScript --since 30m
```

---

## 11. V1 Tier Deferral Strategy

### 11.1 What Was Deferred

Advanced and Premium tiers are **code-complete** in CDK but gated from production use:

| Component | V1 Status | Guard Mechanism |
|-----------|-----------|----------------|
| `provision-tenant.sh` | Basic only | `if [ "$TIER" != "basic" ]; then echo "V1: only basic"; exit 0; fi` |
| `deprovision-tenant.sh` | Basic only | Same tier guard |
| `tenant-template-stack-advanced` | Deploys but INACTIVE | `advancedCluster: 'INACTIVE'` — no ECS cluster created |
| AdminWeb tenant creation | Basic pre-selected | Tier selector shows Basic as default, Advanced/Premium as "Coming Soon" |
| Dashboard tier display | Labels shown | Advanced/Premium chips show `(Coming Soon)` with reduced opacity |

### 11.2 V1_DEFERRED Comment Convention

All deferred code is marked with `V1_DEFERRED` comments explaining:
1. What is deferred
2. Why (V1 MVP scope)
3. How to re-enable

Example:
```typescript
/**
 * V1_DEFERRED: Advanced Tier Template Stack
 * Only Basic tier is actively used in V1 MVP.
 * To re-enable: Fix CDK Nag suppressions, fix TenantSeeder table naming,
 * test end-to-end Advanced tier provisioning.
 */
```

### 11.3 Re-enabling Advanced/Premium Tiers

1. Fix CDK Nag suppressions in `tenant-template-nag.ts` (reference EdForge service names instead of legacy `orders`, `products`, `users`)
2. Fix TenantSeeder Lambda to resolve table names dynamically per tenant
3. Remove tier guard in `provision-tenant.sh` and `deprovision-tenant.sh`
4. Set `CDK_ADV_CLUSTER='ACTIVE'` and test `npx cdk deploy tenant-template-stack-advanced`
5. Test end-to-end: create Advanced tenant → CodeBuild → per-tenant stack → Cognito pool → data seeding

---

## 12. Known Issues & Operational Notes

### 12.1 ISSUE-008: CodeBuild AccountLimitExceededException

**Severity**: Critical (blocks all tenant provisioning)
**Root Cause**: AWS account had CodeBuild concurrent build quota set to 0
**Impact**: Step Functions catches the exception and marks execution as SUCCEEDED, silently masking the failure. Tenants appear stuck in "In Progress" status.
**Resolution**: Verify quota >= 1 via:
```bash
AWS_PROFILE=uat aws service-quotas get-service-quota \
  --service-code codebuild --quota-code L-2DC20C30 \
  --query 'Quota.Value' --output text
```

### 12.2 Cleanup Script Gaps (Fixed in epic02-infra)

The `scripts/cleanup/cleanup.sh` had 4 gaps fixed during the V1 sprint:
1. **`finance` ECR repo** was missing from the deletion list
2. **SSM parameters** (`apiKey*`) were not cleaned up
3. **CloudWatch log groups** were not cleaned up (~1.5 GB accumulation)
4. **Cognito admin pool** (RETAIN policy) was missed by name/tag matching — now uses pool enumeration

### 12.3 install.sh Typo (Fixed)

`CDK_ADV_CLUSTER='INACTIV'` (missing 'E') was fixed to `'INACTIVE'`. Functionally harmless since code checks for exact string `'ACTIVE'`.

### 12.4 DestroyPolicySetter

**File**: `server/lib/utilities/destroy-policy-setter.ts`

CDK Aspect that applies `RemovalPolicy.DESTROY` to all resources in tenant stacks. This means CloudFormation stack deletion will destroy DynamoDB tables, Cognito pools, S3 buckets, etc. — **no RETAIN protection** in V1.

### 12.5 SBT API Response Format

The SBT Control Plane API returns tenant data in a **flat format** (not nested). The AdminWeb normalizes these responses in API hooks. If SBT API structure changes, update the normalization logic in `client/AdminWeb/src/hooks/`.

### 12.6 AWS Profile Requirement

All AWS CLI operations require `AWS_PROFILE=uat`:
```bash
export AWS_PROFILE=uat
export AWS_REGION=us-east-2
```

---

## Appendix A: File Reference

### CDK Infrastructure
| File | Purpose |
|------|---------|
| `server/bin/ecs-saas-ref-template.ts` | CDK app entry point, stack instantiation |
| `server/lib/shared-infra/shared-infra-stack.ts` | VPC, ALB, API Gateway, TenantMapping |
| `server/lib/shared-infra/lambda/lambda-authorizer.ts` | JWT validation + STS ABAC |
| `server/lib/bootstrap-template/control-plane-stack.ts` | SBT ControlPlane, Cognito, EventBridge |
| `server/lib/bootstrap-template/core-appplane-stack.ts` | Provisioning jobs, AdminWeb deploy, TenantSeeder |
| `server/lib/tenant-template/tenant-template-stack.ts` | ECS cluster, services, DynamoDB, IAM |
| `server/lib/tenant-template/identity-provider.ts` | Cognito tenant pool + custom attributes |
| `server/lib/tenant-template/ecs-cluster.ts` | ECS cluster + CloudMap namespace |
| `server/lib/tenant-template/ecs-service.ts` | Fargate service + ALB target group |
| `server/lib/tenant-template/ecs-dynamodb.ts` | DynamoDB table + ABAC IAM role |
| `server/lib/tenant-template/tenant-update-stack.ts` | CodePipeline for rolling updates |
| `server/lib/provision-scripts/provision-tenant.sh` | Tenant onboarding CodeBuild script |
| `server/lib/provision-scripts/deprovision-tenant.sh` | Tenant offboarding CodeBuild script |
| `server/service-info.txt` | Container definitions template (ports, CPU, memory, IAM) |

### Application Code
| File | Purpose |
|------|---------|
| `server/application/shared-types/` | Shared TypeScript package (TVM, DynamoDB base, DTOs) |
| `server/application/microservices/identity/` | Identity/auth NestJS service |
| `server/application/microservices/academics/` | Academics NestJS service |
| `server/application/microservices/finance/` | Finance NestJS service |
| `server/application/reverseproxy/` | NGINX reverse proxy config |

### Frontend
| File | Purpose |
|------|---------|
| `client/AdminWeb/` | React admin console (MUI, React Router) |
| `client/edforge-saas-mfe/` | Rspack Module Federation tenant app |

### Operations
| File | Purpose |
|------|---------|
| `scripts/install.sh` | Full deployment (bootstrap + CDK deploy all) |
| `scripts/build-application.sh` | Docker build + ECR push |
| `scripts/fresh-deploy.sh` | Rebuild + redeploy without infra changes |
| `scripts/cleanup/cleanup.sh` | Complete environment teardown |
| `docs/AWS_CLI_OPERATIONS_GUIDE.md` | Daily development AWS CLI workflows |

---

## Appendix B: Quick Command Reference

```bash
# === Environment Setup ===
export AWS_PROFILE=uat
export AWS_REGION=us-east-2
export CLUSTER_NAME=prod-basic

# === Full Fresh Install ===
cd scripts && ./install.sh "admin@email.com"

# === Application Code Deploy (no infra changes) ===
cd scripts && ./build-application.sh
aws ecs update-service --cluster prod-basic --service identitybasic --force-new-deployment
aws ecs update-service --cluster prod-basic --service academicsbasic --force-new-deployment
aws ecs update-service --cluster prod-basic --service financebasic --force-new-deployment
aws ecs update-service --cluster prod-basic --service rproxybasic --force-new-deployment

# === Infrastructure Deploy ===
cd server
CDK_NAG_ENABLED=false npx cdk deploy shared-infra-stack --require-approval=never
CDK_NAG_ENABLED=false npx cdk deploy controlplane-stack --require-approval=never
CDK_NAG_ENABLED=false npx cdk deploy core-appplane-stack --require-approval=never
CDK_NAG_ENABLED=false npx cdk deploy tenant-template-stack-basic --require-approval=never

# === Monitoring ===
aws ecs describe-services --cluster prod-basic \
  --services identitybasic academicsbasic financebasic rproxybasic \
  --query 'services[*].{name:serviceName,status:status,running:runningCount}'
aws logs tail /ecs/identitybasic --follow
aws logs tail /ecs/academicsbasic --follow --filter-pattern "ERROR"

# === Complete Teardown ===
cd scripts/cleanup && ./cleanup.sh
```

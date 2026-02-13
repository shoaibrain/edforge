# EdForge - Enterprise Education Management Information System (EMIS)

## Executive Summary

EdForge is a **cloud-native, multi-tenant Education Management Information System (EMIS)** built on AWS, designed to provide K-12 educational institutions with a comprehensive, scalable, and compliant platform for managing all aspects of school operations. Built on the battle-tested AWS ECS SaaS Reference Architecture by AWS SaaS Factory, EdForge extends the foundation with education-specific domain models aligned with **Ed-Fi data standards**.

### Key Value Propositions

- **Enterprise-Grade Multi-Tenancy**: Three-tier isolation model (Basic/Advanced/Premium) supporting schools from small districts to large education organizations
- **Ed-Fi Standards Compliance**: Data models and mappers aligned with Ed-Fi v6.0 for interoperability with state/federal reporting systems
- **FERPA & HIPAA Ready**: Built-in audit logging, data retention policies, and security controls for educational compliance
- **Cost-Optimized Architecture**: From ~$50/month for development to production-ready infrastructure that scales with tenant growth
- **Single Source of Truth**: Zod schema-first design ensures type safety across frontend, backend, and API contracts

---

## Architecture Overview

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONTROL PLANE                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  SBT Control    │  │   Admin Portal  │  │   EventBridge   │              │
│  │  Plane (SaaS    │  │   (System       │  │   (Tenant       │              │
│  │  Builder Toolkit)│  │   Admins)       │  │   Lifecycle)    │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SHARED INFRASTRUCTURE                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ API Gateway │  │     ALB     │  │     NLB     │  │   VPC       │        │
│  │ + Lambda    │  │  (Request   │  │  (VPC Link) │  │ (Multi-AZ)  │        │
│  │ Authorizer  │  │   Routing)  │  │             │  │             │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│   BASIC TIER      │   │  ADVANCED TIER    │   │  PREMIUM TIER     │
│   (Pooled)        │   │  (Hybrid Silo)    │   │  (Full Silo)      │
│                   │   │                   │   │                   │
│ Shared ECS        │   │ Shared Cluster    │   │ Dedicated Cluster │
│ Shared DynamoDB   │   │ Dedicated Services│   │ Dedicated Tables  │
│ Shared Cognito    │   │ Bridge Storage    │   │ Dedicated Cognito │
│                   │   │                   │   │                   │
│ Ideal for:        │   │ Ideal for:        │   │ Ideal for:        │
│ Small schools     │   │ School districts  │   │ Large districts   │
│ Trial accounts    │   │ Growing orgs      │   │ State agencies    │
└───────────────────┘   └───────────────────┘   └───────────────────┘
```

### Core Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Control Plane** | AWS SBT (SaaS Builder Toolkit) | Tenant lifecycle, system admin, billing |
| **Event Bus** | Amazon EventBridge + SBT | Tenant lifecycle events, event-driven integration |
| **API Gateway** | Amazon API Gateway + Lambda | Request routing, authorization, throttling |
| **Compute** | Amazon ECS (Fargate/EC2) | Containerized microservices |
| **Storage** | Amazon DynamoDB | Single-table design per service |
| **Identity** | Amazon Cognito | User authentication, MFA, federation |
| **Frontend** | React + AWS Amplify | Admin portal, school applications |
| **Service Discovery** | AWS Cloud Map + ECS Service Connect | Inter-service communication |
| **Infrastructure as Code** | AWS CDK (TypeScript) | Reproducible deployments |

---

## Microservices Architecture

### Service Overview

EdForge follows a domain-driven microservices architecture with two core services:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IDENTITY SERVICE (Port 3010)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │    Auth     │ │    Users    │ │   Schools   │ │   Tenants   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │    Staff    │ │ Credentials │ │   Leaves    │ │   Roles     │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                           │
│  │ Academic    │ │   School    │ │  Security   │                           │
│  │   Years     │ │   Years     │ │  (MFA/Sess) │                           │
│  └─────────────┘ └─────────────┘ └─────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          ACADEMICS SERVICE (Port 3011)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │  Students   │ │ Enrollments │ │ Attendance  │ │ Classrooms  │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                           │
│  │   Grades    │ │ Assignments │ │  Courses    │ (Future modules)          │
│  └─────────────┘ └─────────────┘ └─────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Identity Service Responsibilities

- **Authentication**: JWT-based auth with Cognito, session management, device tracking
- **User Management**: CRUD operations, preferences, global role assignment
- **School Management**: School configuration, academic calendar, grading periods
- **Staff Management**: Ed-Fi aligned staff profiles, certifications, leave management
- **ABAC (Attribute-Based Access Control)**: Per-school role assignments with permission overrides
- **Security**: MFA, login history, session management, account locking

### Academics Service Responsibilities

- **Student Management**: Comprehensive profiles with guardians, medical info, demographics
- **Enrollment**: Full enrollment lifecycle (new, transfer, withdraw, graduate)
- **Attendance**: Daily/period tracking with excuse workflows and parent notification
- **Grades & Assessments**: Multi-scale grading, rubrics, GPA calculation (in progress)
- **Classrooms**: Section management, scheduling, teacher assignments (in progress)

---

## Data Model (Ed-Fi Aligned)

### DynamoDB Single-Table Design

Each service uses a single-table design with composite keys for efficient queries:

**Identity Service Table Schema:**
```
┌───────────────────────────────────────────────────────────────────────┐
│ PK                    │ SK                              │ Entity      │
├───────────────────────┼─────────────────────────────────┼─────────────┤
│ TENANT#{tenantId}     │ METADATA                        │ Tenant      │
│ TENANT#{tenantId}     │ SCHOOL#{schoolId}               │ School      │
│ TENANT#{tenantId}     │ USER#{userId}                   │ User        │
│ TENANT#{tenantId}     │ STAFF#{staffId}                 │ Staff       │
│ TENANT#{tenantId}     │ SCHOOL#{id}#YEAR#{yearId}       │ AcademicYear│
│ TENANT#{tenantId}     │ ROLE#{userId}#SCHOOL#{schoolId} │ RoleAssign  │
└───────────────────────────────────────────────────────────────────────┘

GSI1: Email lookup (EMAIL#{email} → TENANT#{tenantId})
GSI2: Token/Session lookup (TOKEN#{hash} → expiry)
```

**Academics Service Table Schema:**
```
┌───────────────────────────────────────────────────────────────────────┐
│ PK                    │ SK                              │ Entity      │
├───────────────────────┼─────────────────────────────────┼─────────────┤
│ TENANT#{tenantId}     │ STUDENT#{studentId}             │ Student     │
│ TENANT#{tenantId}     │ ENROLL#{schoolId}#{yearId}#{id} │ Enrollment  │
│ TENANT#{tenantId}     │ ATTEND#{date}#{studentId}       │ Attendance  │
│ TENANT#{tenantId}     │ COURSE#{schoolId}#{courseId}    │ Course      │
│ TENANT#{tenantId}     │ GRADE#{studentId}#{courseId}    │ Grade       │
└───────────────────────────────────────────────────────────────────────┘

GSI1: School scope (TENANT#{tid}#SCHOOL#{sid} → STUDENT#{name})
GSI2: Student-centric (studentId → ENROLLMENT#{yearId})
GSI3: Attendance by date (TENANT#{tid}#SCHOOL#{sid}#DATE#{d})
```

### Ed-Fi Data Standards Compliance

EdForge implements Ed-Fi v6.0 compliant data models with mappers for state reporting:

**Staff Entity (Ed-Fi Aligned):**
```typescript
{
  staffUniqueId: string,        // State/national unique identifier
  lastSurname: string,          // Ed-Fi naming convention
  firstName: string,
  hispanicLatinoEthnicity: boolean,
  highlyQualifiedTeacher: boolean,
  yearsOfPriorTeachingExperience: number,
  fullTimeEquivalency: number,  // FTE tracking
  employmentStatus: 'tenured' | 'probationary' | 'contractual',
  // ... additional Ed-Fi fields
}
```

**Student Entity (EMIS Standard):**
```typescript
{
  studentNumber: string,        // Local school ID
  guardians: Guardian[],        // Max 10, with portal access
  emergencyContacts: Contact[], // Max 5, prioritized
  medicalInfo: {
    allergies: string[],
    medications: string[],
    hasIEP: boolean,            // Individualized Education Program
    has504Plan: boolean,        // Section 504 accommodations
  },
  specialPrograms: string[],    // ESL, gifted, etc.
}
```

---

## Multi-Tenancy Implementation

### Tenant Isolation Strategies

| Aspect | Basic (Pooled) | Advanced (Hybrid) | Premium (Full Silo) |
|--------|----------------|-------------------|---------------------|
| **ECS Cluster** | Shared | Shared | Dedicated |
| **ECS Services** | Shared | Dedicated per tenant | Dedicated |
| **DynamoDB Tables** | Shared (Leading Key) | Bridge model | Dedicated |
| **Cognito User Pool** | Shared | Dedicated | Dedicated |
| **Security Groups** | Shared | Per-tenant | Per-tenant |
| **Pricing Target** | Free/trial | $99-499/mo | $1000+/mo |
| **Max Schools** | 1 | 5 | 100 |
| **Max Students/School** | 500 | 2,000 | 10,000 |

### Tenant Provisioning Flow

```
Control Plane API (SBT)
        │
        ▼
EventBridge (SBT Custom Bus)
        │
        ├── sbt_aws_onboardingRequest → Provisioning ScriptJob
        │                                      │
        │                                      ▼
        │                              provision-tenant.sh
        │                                      │
        │                                      ▼
        └── sbt_aws_provisionSuccess → Tenant Seeder Lambda
                                              │
        ┌─────────────────────────────────────┘
        │
        ├── Basic Tier: Seed tenant metadata to shared DynamoDB
        │
        └── Advanced/Premium:
            ├── Deploy tenant-specific CDK stack
            ├── Create dedicated Cognito user pool
            ├── Deploy ECS services
            ├── Create dedicated DynamoDB tables
            ├── Configure security groups
            └── Register in tenant mapping table
```

### Data Isolation Mechanisms

**Runtime Isolation (Basic Tier):**
```typescript
// Fine-grained access control with IAM policies
{
  "Effect": "Allow",
  "Action": ["dynamodb:*"],
  "Resource": ["arn:aws:dynamodb:*:*:table/edforge-identity-basic"],
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["TENANT#${tenantId}"]
    }
  }
}
```

**Infrastructure Isolation (Premium Tier):**
- Dedicated DynamoDB tables: `edforge-identity-{tenantId}`
- Dedicated ECS cluster with isolated security groups
- Dedicated Cognito user pool with custom domain

---

## Event-Driven Architecture

### EventBridge Integration

EdForge leverages AWS SaaS Builder Toolkit's (SBT) EventBridge for tenant lifecycle management. All events flow through a dedicated SBT custom EventBus, ensuring isolation from AWS default bus and enabling scalable, decoupled event processing.

| Event | Source | Purpose |
|-------|--------|---------|
| `sbt_aws_onboardingRequest` | sbt.control.plane | Triggers tenant provisioning workflow |
| `sbt_aws_provisionSuccess` | sbt.application.plane | Triggers metadata seeding after provisioning |
| `sbt_aws_offboardingRequest` | sbt.control.plane | Triggers tenant deprovisioning workflow |
| `sbt_aws_deprovisionSuccess` | sbt.application.plane | Confirms tenant removal |

### Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SBT CUSTOM EVENTBUS                                  │
│  (controlplanestackcontrolplanesbtEventManagerSbtEventBus...)               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐    ┌────────────────────┐    ┌──────────────────┐  │
│  │ onboardingRequest  │───▶│  Provisioning Job  │───▶│ provisionSuccess │  │
│  │ (Control Plane)    │    │  (CodeBuild+StepFn)│    │ (App Plane)      │  │
│  └────────────────────┘    └────────────────────┘    └────────┬─────────┘  │
│                                                                │            │
│                                                                ▼            │
│                                                      ┌──────────────────┐  │
│                                                      │TenantSeederLambda│  │
│                                                      │ (Seeds DynamoDB) │  │
│                                                      └──────────────────┘  │
│                                                                              │
│  ┌────────────────────┐    ┌────────────────────┐    ┌──────────────────┐  │
│  │offboardingRequest  │───▶│ Deprovisioning Job │───▶│deprovisionSuccess│  │
│  │ (Control Plane)    │    │  (CodeBuild+StepFn)│    │ (App Plane)      │  │
│  └────────────────────┘    └────────────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Enterprise Patterns

1. **Fail-fast configuration** - Services throw errors if `EVENT_BUS_NAME` is not set (no hardcoded fallbacks)
2. **Custom bus isolation** - All EdForge events on SBT custom bus, never default bus
3. **SBT native events** - Leverage built-in lifecycle events (`sbt_aws_provisionSuccess`, etc.)
4. **Audit tooling** - `scripts/audit-eventbridge-rules.sh` verifies correct bus configuration

### Tenant Seeder Lambda

The TenantSeederLambda automatically seeds tenant metadata to DynamoDB when provisioning completes:

```typescript
// Event pattern (listens on SBT custom bus)
{
  source: ['sbt.application.plane'],
  detailType: ['sbt_aws_provisionSuccess'],
}

// Seeds to tier-specific tables
// BASIC → edforge-identity-basic
// PREMIUM → edforge-identity-premium
// ADVANCED → edforge-identity-advanced
```

---

## Authentication & Authorization

### Authentication Flow

```
User Login Request
        │
        ▼
API Gateway → Lambda Authorizer
        │
        ├── Validate JWT with Cognito
        ├── Extract tenant context from claims
        ├── Generate tier-specific API key
        └── Assume role with tenant-scoped IAM policy
        │
        ▼
ECS Service (Identity/Academics)
        │
        ├── @TenantCredentials() decorator extracts context
        ├── @JwtAuthGuard() validates token
        └── Service uses tenant-scoped DynamoDB credentials
```

### Role-Based Access Control (ABAC)

**Global Roles (Tenant-Level):**
- `TenantAdmin`: Full tenant management
- `StandardUser`: Limited access, requires school roles

**School Roles (Per-School):**
- `Principal`, `VicePrincipal`: Full school access
- `Teacher`: Class/student management
- `Counselor`: Student records access
- `Staff`, `Nurse`, `Accountant`: Role-specific access
- `Parent`, `Student`: Portal access

```typescript
// Role assignment stored in DynamoDB
{
  PK: "TENANT#abc123",
  SK: "ROLE#user456#SCHOOL#school789",
  role: "Teacher",
  permissions: ["students:read", "grades:write", "attendance:write"],
  assignedAt: "2024-01-15T10:00:00Z",
  assignedBy: "admin123"
}
```

---

## API Layer

### Request Flow

```
Client → CloudFront → API Gateway → Lambda Authorizer → NLB → ALB → ECS
                                          │
                                          ├── Validate JWT
                                          ├── Extract tenant context
                                          ├── Apply usage plan (throttling)
                                          └── Route to correct tier
```

### API Endpoints

**Identity Service (`/api/identity/*`):**
```
POST   /auth/login              # Authenticate user
POST   /auth/refresh            # Refresh JWT token
POST   /auth/logout             # Invalidate session

GET    /users                   # List users (paginated)
POST   /users                   # Create user
GET    /users/:id               # Get user
PATCH  /users/:id               # Update user

GET    /schools                 # List schools
POST   /schools                 # Create school
GET    /schools/:id             # Get school

GET    /staff                   # List staff
POST   /staff                   # Create staff (Ed-Fi aligned)
GET    /staff/:id/credentials   # Get certifications
POST   /staff/:id/leave         # Request leave

GET    /academic-years          # List academic years
POST   /academic-years          # Create academic year
```

**Academics Service (`/api/academics/*`):**
```
GET    /students?schoolId=X     # List students by school
POST   /students                # Create student
GET    /students/:id            # Get student profile
GET    /students/:id/enrollments# Enrollment history

POST   /enrollments             # Create enrollment
PATCH  /enrollments/:id         # Update enrollment status

POST   /attendance              # Record attendance
GET    /attendance?date=X       # Daily attendance report
```

### API Throttling (Usage Plans)

| Tier | Rate Limit | Burst Limit | Daily Quota |
|------|------------|-------------|-------------|
| Basic | 10 req/s | 10 | 1,000 |
| Advanced | 15 req/s | 15 | 2,000 |
| Premium | 50 req/s | 50 | 5,000 |

---

## Frontend Architecture

### Technology Stack

- **React 18** with TypeScript
- **AWS Amplify** for Cognito authentication
- **Material-UI (MUI)** component library
- **React Router 6** for routing
- **React Hook Form** + Zod for form validation
- **TanStack Query** for API state management

### Shared Types Package (`@aibrains/shared-types`)

Single source of truth for all data validation:

```typescript
// Frontend usage
import { createStudentSchema, type CreateStudentDto } from '@aibrains/shared-types';

const { register, handleSubmit } = useForm<CreateStudentDto>({
  resolver: zodResolver(createStudentSchema),
});

// Backend usage (NestJS)
import { createStudentSchema } from '@aibrains/shared-types';
const CreateStudentDto = createZodDto(createStudentSchema);
```

### Key Frontend Features

- **Multi-school context switching**: Users with roles in multiple schools
- **Role-based UI**: Features/menus based on user permissions
- **Real-time validation**: Zod schemas shared with backend
- **Optimistic updates**: Immediate UI feedback with rollback
- **Tenant-aware routing**: Subdomain-based tenant context

---

## Compliance & Security

### FERPA Compliance

- **Audit Logging**: All data access logged with user, timestamp, action
- **Data Retention**: 2-year TTL for audit logs (configurable)
- **Access Controls**: ABAC ensures minimum necessary access
- **Parental Rights**: Parent portal with controlled student data access

### Security Features

| Feature | Implementation |
|---------|----------------|
| **Authentication** | Cognito with MFA (TOTP, SMS) |
| **Password Policy** | 8+ chars, uppercase, lowercase, digits, symbols |
| **Session Management** | DynamoDB with TTL, device tracking |
| **Account Locking** | After N failed attempts |
| **Network Isolation** | VPC with private subnets (production) |
| **Encryption** | TLS in transit, DynamoDB encryption at rest |
| **Secrets Management** | AWS Secrets Manager (no hardcoded secrets) |

### Production Security Mode

```typescript
// Production VPC configuration
{
  azCount: 2,                    // Multi-AZ for HA
  usePrivateSubnets: true,       // No public internet access
  natGatewayPerAz: true,         // Outbound internet via NAT
  flowLogs: true,                // VPC traffic logging
  encryption: {
    dynamoDB: true,
    s3: true,
    cloudWatch: true
  }
}
```

---

## Cost Management Strategy

### Architecture Decision

EdForge maintains the **original AWS SBT-ECS reference architecture** without development-specific cost optimizations. This decision prioritizes:

1. **Stability**: Production-tested architecture from AWS SaaS Factory
2. **Simplicity**: Single codebase for all environments
3. **Reliability**: No conditional logic that could introduce deployment bugs

### Operational Cost Optimization

Instead of architectural changes, EdForge uses an **operational approach** to cost management:

| Strategy | Action | Savings |
|----------|--------|---------|
| **Full Teardown** | Run `./scripts/cleanup/cleanup.sh` when not developing | ~100% during idle |
| **Quick Deploy** | Run `./scripts/install.sh` (~22 min) when ready to work | N/A |
| **Selective Development** | Use local Docker Compose for service development | ~95% |

### Estimated Costs

| Environment | Monthly Cost | Notes |
|-------------|--------------|-------|
| **Development (Active)** | ~$150-200 | NAT Gateway, ELB, ECS, DynamoDB |
| **Development (Idle)** | ~$0-5 | S3 bucket + minimal storage |
| **Production** | ~$200-500+ | Scales with tenants |

### Production Cost Breakdown (Per Component)

| Component | Basic Tier | Premium Tier |
|-----------|------------|--------------|
| ECS (Fargate) | ~$30/mo shared | ~$100/mo per tenant |
| DynamoDB | ~$3/mo (provisioned) | ~$10/mo per table |
| NAT Gateway | ~$52/mo (shared) | ~$52/mo per VPC |
| Cognito | ~$0.0055/MAU | ~$0.0055/MAU |
| API Gateway | ~$3.50/million requests | ~$3.50/million |

### Cleanup Notes

After running cleanup scripts, some resources may require manual deletion:
- `shared-infra-stack-TenantMappingTable*` (DynamoDB)
- `CognitoAuthUserPool*` (Cognito)

This is expected behavior from the AWS SBT reference architecture.

---

## Deployment & Operations

### Infrastructure as Code (CDK)

```
server/
├── bin/ecs-saas-ref-template.ts    # CDK entry point
├── lib/
│   ├── shared-infra/               # VPC, ALB, API Gateway
│   ├── tenant-template/            # Per-tenant resources
│   ├── bootstrap-template/         # Control plane
│   └── utilities/                  # Helper functions
└── application/
    ├── microservices/
    │   ├── identity/               # NestJS identity service
    │   └── academics/              # NestJS academics service
    └── libs/                       # Shared libraries
```

### Quick Reference Commands

```bash
# Full deployment (~22 minutes)
cd scripts && ./install.sh admin@example.com

# Full cleanup (teardown all stacks)
./scripts/cleanup/cleanup.sh

# Build microservices only
./scripts/build-application.sh

# Deploy specific stack
cdk deploy shared-infra-stack
```

### Deployment Timeline

| Stack | Duration | Key Resources |
|-------|----------|---------------|
| shared-infra-stack | ~5 min | VPC, ALB, NLB, API Gateway, CloudFront |
| controlplane-stack | ~4 min | SBT Control Plane, EventBus, TenantSeeder Lambda |
| tenant-template-stack-advanced | ~4 min | Dedicated ECS Cluster, Cognito User Pool |
| tenant-template-stack-basic | ~7 min | Shared ECS Services, DynamoDB Tables |
| core-appplane-stack | ~2 min | Provisioning ScriptJobs, EventBridge Rules |
| **Total** | **~22 min** | Full multi-tenant SaaS platform |

### Monitoring & Observability

- **CloudWatch Logs**: Structured JSON logging with correlation IDs
- **CloudWatch Metrics**: ECS, DynamoDB, API Gateway metrics
- **X-Ray Tracing**: Distributed tracing across services (configurable)
- **Health Checks**: ALB health checks on `/health` endpoint
- **Alarms**: CloudWatch alarms for error rates, latency

---

## Roadmap & Future Modules

### Completed
- [x] Core identity service (auth, users, schools, roles)
- [x] Core academics service (students, enrollment, attendance)
- [x] Staff management with Ed-Fi alignment
- [x] Multi-tenant infrastructure (3-tier model)
- [x] Admin portal (React + Amplify)
- [x] Shared types package with Zod validation
- [x] Event-driven tenant provisioning with SBT EventBridge
- [x] Tenant Seeder Lambda for automatic metadata sync
- [x] EventBridge audit tooling (`scripts/audit-eventbridge-rules.sh`)

### In Progress
- [ ] Credentials/certification tracking
- [ ] Leave request management
- [ ] Grading and GPA calculation
- [ ] Classroom/section management

### Planned
- [ ] Parent/Student portals
- [ ] Financial management module
- [ ] Curriculum and scheduling
- [ ] Advanced analytics and reporting
- [ ] Ed-Fi API endpoints (ODS sync)
- [ ] Webhook integrations
- [ ] Mobile applications

---

## Project Structure

```
edforge/
├── server/                          # Backend infrastructure
│   ├── bin/                         # CDK entry point
│   ├── lib/                         # CDK stacks
│   ├── application/
│   │   ├── microservices/
│   │   │   ├── identity/            # Identity NestJS service
│   │   │   └── academics/           # Academics NestJS service
│   │   └── libs/                    # Shared NestJS libraries
│   └── cdk.json
├── client/
│   └── AdminWeb/                    # React admin portal
├── packages/
│   ├── shared-types/                # Zod schemas & TypeScript types
│   └── edfi-ts-models/              # Ed-Fi data models
├── docs/                            # Technical documentation
├── scripts/                         # Deployment & utility scripts
├── DEVELOPER_GUIDE.md               # Developer documentation
├── README.md                        # Quick start guide
└── OVERVIEW.md                      # This document
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker Engine
- AWS CLI 2.14+
- AWS CDK CLI (latest)
- Python 3.8+ (for Lambda authorizer)

### Local Development

```bash
# Install dependencies
npm install

# Start local DynamoDB
docker-compose -f docker-compose.local.yml up -d

# Start identity service
cd server/application/microservices/identity
npm run start:dev

# Start academics service
cd server/application/microservices/academics
npm run start:dev

# Start frontend
cd client/AdminWeb
npm run dev
```

### Deploy to AWS

```bash
cd scripts
./build-application.sh
./install.sh your-admin@email.com
```

---

## Contributing

EdForge is currently a solo-founder project. For questions or collaboration:

- **Repository**: Private development
- **Documentation**: See `/docs/` directory
- **Architecture Decisions**: Documented in code comments and ADRs

---

## License

Proprietary - All rights reserved.

---

*Document updated: 2026-01-28*
*Version: 1.2.0*

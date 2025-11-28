# EdForge Infrastructure Architecture - Technical Summary

## Executive Overview

EdForge is a multi-tenant SaaS education management system built on AWS using microservices architecture. The solution is deployed via AWS CDK and consists of 10 core microservices running on ECS Fargate/EC2, communicating through EventBridge for asynchronous operations and HTTP/REST for synchronous operations. The infrastructure follows the AWS SaaS Builder Toolkit (SBT) pattern with a control plane for tenant management and an application plane for tenant-specific resources.

**Key Characteristics:**
- **Architecture Pattern**: Multi-tenant SaaS with infrastructure-level isolation
- **Compute**: AWS ECS (Fargate for Basic/Advanced tiers, EC2 for Premium tier)
- **Event-Driven**: AWS EventBridge for asynchronous communication
- **Data Storage**: DynamoDB (single-table design for most services, dedicated table for finance)
- **Analytics**: S3 Data Lake with Kinesis Firehose, Glue Catalog, and Athena
- **Networking**: VPC with private subnets, ALB, NLB, API Gateway with VPC Link
- **Security**: Cognito for authentication, API Gateway with Lambda authorizer, IAM ABAC for tenant isolation

---

## Deployment Process

### install.sh Execution Flow

The `scripts/install.sh` script orchestrates the complete deployment:

1. **Pre-deployment Setup** (Lines 1-40)
   - Validates system admin email parameter
   - Generates API keys for Basic, Advanced, and Premium tiers (if not provided)
   - Creates S3 bucket for provision source code
   - Creates ECS service-linked role (if missing)

2. **Environment Configuration** (Lines 42-66)
   - Sets CDK environment variables:
     - `CDK_PARAM_TIER='basic'`
     - `CDK_PARAM_STAGE='prod'`
     - `CDK_BASIC_CLUSTER='prod-basic'`
   - Copies `.env.example` to `.env`
   - Processes `service-info.txt` → `service-info.json` (replaces `<REGION>` and `<ACCOUNT_ID>` placeholders)

3. **CDK Bootstrap** (Line 70)
   - Runs `npx cdk bootstrap` to initialize CDK toolkit
   - Creates CDKToolkit stack with:
     - ECR repository for container assets
     - S3 staging bucket
     - IAM roles for deployment

4. **Service Connect Reset** (Lines 72-81)
   - Disables Service Connect for existing ECS services (if any)
   - Prevents conflicts during fresh deployment

5. **CDK Deploy** (Line 102)
   - Executes `npx cdk deploy --all --require-approval=never --concurrency 10 --asset-parallelism true`
   - Deploys all stacks in parallel where possible

6. **Post-deployment** (Lines 104-108)
   - Retrieves CloudFormation outputs:
     - Admin site URL (CloudFront distribution)
     - Application site URL (CloudFront distribution)

### Stack Deployment Order

Based on `server/bin/ecs-saas-ref-template.ts`, stacks are deployed in this order:

1. **SharedInfraStack** (Line 64)
   - Foundation infrastructure: VPC, ALB, NLB, API Gateway, EventBridge, DynamoDB, S3, Firehose
   - Must deploy first (other stacks depend on its outputs)

2. **ControlPlaneStack** (Line 70)
   - SBT Control Plane with Cognito authentication
   - Creates SBT Event Manager (custom EventBridge event bus)
   - Depends on: SharedInfraStack (accessLogsBucket, adminSiteDistro, adminSiteUrl)

3. **CoreAppPlaneStack** (Line 78)
   - Tenant provisioning/deprovisioning scripts
   - Depends on: ControlPlaneStack (eventManager, regApiGatewayUrl, auth), SharedInfraStack

4. **TenantTemplateStack** (Line 91)
   - Tenant-specific infrastructure: ECS cluster, services, DynamoDB tables
   - Depends on: SharedInfraStack (tenantMappingTable, appSiteUrl, nextjsAppUrl)

5. **AdvancedTierTempStack** (Line 107)
   - Advanced tier tenant infrastructure (if applicable)
   - Depends on: SharedInfraStack

**Deployment Time**: Approximately 15-30 minutes for initial deployment (varies by region and resource creation time)

---

## Infrastructure Components

### 1. SharedInfraStack

**Location**: `server/lib/shared-infra/shared-infra-stack.ts`

#### VPC Configuration
- **CIDR**: `10.0.0.0/16`
- **Availability Zones**: 3 (configurable via `azCount` prop)
- **Subnets**:
  - Private subnets: `10.0.{index*64}.0/18` (per AZ)
  - Public subnets: `10.0.{192+index}.0/24` (per AZ)
- **Flow Logs**: Enabled to CloudWatch Logs (all traffic)
- **VPC Exports**: PrivateSubnetIds, AvailabilityZones (for cross-stack references)

#### Load Balancers
- **Application Load Balancer (ALB)**:
  - Internal-facing (private subnets)
  - Port 80 (HTTP)
  - Security group: `alb-sg` (allows traffic from VPC CIDR)
  - Target group: IP-based, HTTP protocol
- **Network Load Balancer (NLB)**:
  - Internal-facing (private subnets)
  - Port 80
  - Cross-zone enabled
  - Targets: ALB listener (NLB → ALB → ECS services)

#### API Gateway
- **Type**: REST API (SpecRestApi from Swagger/OpenAPI)
- **Definition**: `server/lib/tenant-api-prod.json`
- **VPC Link**: Connects to NLB for private ECS service access
- **Authorizer**: Lambda function (`tenant_authorizer.py`) with Python layer
- **API Keys**: Three tiers (Basic, Advanced, Premium) stored in SSM Parameter Store
- **Usage Plans**: Rate limiting per tier
- **Access Logs**: CloudWatch Logs (7-day retention for development)
- **Routes**: Defined in `tenant-api-prod.json` for all microservices:
  - `/schools`, `/enrollments`, `/curriculum`, `/assessment`, `/attendance`, `/finance`, `/staff`, `/parents`, `/analytics`

#### EventBridge Configuration
- **Event Bus Resolution**:
  ```typescript
  const eventBusName = this.node.tryGetContext('eventBusName') || 'default';
  const eventBus = eventBusName === 'default' 
    ? events.EventBus.fromEventBusName(this, 'DefaultEventBus', 'default')
    : events.EventBus.fromEventBusName(this, 'SbtEventBus', eventBusName);
  ```
- **Default Behavior**: Uses AWS default event bus (`'default'`)
- **Custom Bus Option**: Can use SBT event bus via CDK context: `--context eventBusName=<bus-name>`
- **SBT Event Bus**: Created by ControlPlaneStack via `eventManager.busName` (format: `controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]`)

#### EventBridge Rules
**Location**: `server/lib/shared-infra/Resources/eventbridge-rules.ts`

1. **Parent Portal - Grade Published**:
   - Pattern: `source: ['edforge.assessment-service']`, `detailType: ['GradePublished']`
   - Target: Lambda function (`parent-portal-notification-handler`)
   - DLQ: `parent-portal-dlq` (SQS queue)
   - Retries: 3 attempts

2. **Parent Portal - Invoice Generated**:
   - Pattern: `source: ['edforge.finance-service']`, `detailType: ['InvoiceGenerated']`
   - Target: Lambda function (`parent-portal-notification-handler`)
   - DLQ: `parent-portal-dlq`
   - Retries: 3 attempts

3. **Parent Portal - Attendance Recorded**:
   - Pattern: `source: ['edforge.attendance-service']`, `detailType: ['AttendanceRecorded']`
   - Target: Lambda function (`parent-portal-notification-handler`)
   - DLQ: `parent-portal-dlq`
   - Retries: 3 attempts

4. **Analytics - All Events**:
   - Pattern: `source: ['edforge.school-service', 'edforge.enrollment-service', 'edforge.curriculum-service', 'edforge.assessment-service', 'edforge.attendance-service', 'edforge.finance-service', 'edforge.staff-service', 'edforge.parent-portal-service']`
   - Target: Kinesis Firehose stream (`edforge-events-stream`)
   - Note: Firehose handles errors internally via S3 error output prefix

#### Dead Letter Queues (DLQ)
**Location**: `server/lib/shared-infra/Resources/eventbridge-dlq.ts`

- **Parent Portal DLQ**: `parent-portal-dlq`
  - Retention: 14 days
  - Visibility timeout: 30 seconds
  - Encryption: SQS-managed
- **Analytics DLQ**: `analytics-firehose-dlq`
  - Retention: 14 days
  - Encryption: SQS-managed

#### Event Archiving
**Location**: `server/lib/shared-infra/Resources/eventbridge-archive.ts`

- **S3 Bucket**: `edforge-event-archive-{hash}`
- **Lifecycle Rules**:
  - Transition to Glacier after 90 days
  - Transition to Deep Archive after 365 days
- **Note**: Archive rule not yet implemented (bucket created for future use)

#### Kinesis Firehose Stream
**Location**: `server/lib/shared-infra/Resources/kinesis-firehose-stub.ts`

- **Stream Name**: `edforge-events-stream`
- **Destination**: S3 Data Lake bucket
- **Buffer Configuration**:
  - Size: 5 MB
  - Interval: 60 seconds
- **Compression**: GZIP
- **Lambda Transformer**: `firehose-transformer` (extracts service name from event source for partitioning)
- **Partitioning**: `events/year={yyyy}/month={MM}/day={dd}/service={service}/`
- **Error Output**: `errors/year={yyyy}/month={MM}/day={dd}/`
- **CloudWatch Logs**: Enabled (`/aws/kinesisfirehose/edforge-events-stream`)

#### Lambda Functions

1. **Parent Portal Notification Handler**:
   - **Location**: `server/lib/shared-infra/Resources/parent-portal-lambda-stub.ts`
   - **Runtime**: Node.js 18.x
   - **Timeout**: 30 seconds
   - **Memory**: 256 MB
   - **Permissions**: DynamoDB (GetItem, Query), SES (SendEmail), SNS (Publish)
   - **Current Implementation**: Stub (logs events, doesn't send notifications)
   - **Future**: Will call Parent Portal service to fetch parents and send notifications

2. **Firehose Transformer**:
   - **Location**: `server/lib/shared-infra/Resources/firehose-transformer-lambda.ts`
   - **Runtime**: Node.js 18.x
   - **Timeout**: 60 seconds
   - **Memory**: 256 MB
   - **Function**: Extracts service name from EventBridge event source field
   - **Input**: EventBridge event (base64 encoded)
   - **Output**: Event with partition key metadata: `{ service: 'assessment-service' }`

#### S3 Data Lake
**Location**: `server/lib/shared-infra/Resources/s3-data-lake.ts`

- **Bucket Name**: `edforge-data-lake-{hash}`
- **Encryption**: S3-managed (SSE-S3)
- **Lifecycle Rules**:
  - Transition to Glacier after 90 days
  - Transition to Deep Archive after 365 days
- **Access**: Block all public access
- **Purpose**: Stores events from Firehose for Analytics service queries

#### Glue Catalog
**Location**: `server/lib/shared-infra/Resources/glue-tables.ts`

- **Database**: `edforge_analytics`
- **Tables**: One per service (8 tables total)
  - `school_events`, `enrollment_events`, `curriculum_events`, `assessment_events`, `attendance_events`, `finance_events`, `staff_events`, `parent_portal_events`
- **Schema**: EventBridge envelope structure
  - Columns: `id`, `source`, `account`, `time`, `region`, `version`, `detail` (JSON string)
  - Partition keys: `year`, `month`, `day`, `service`
- **Partition Projection**: Enabled (no MSCK REPAIR needed)
- **Format**: JSON (GZIP compressed)
- **SerDe**: `org.openx.data.jsonserde.JsonSerDe`

#### Athena
- **Workgroup**: `edforge-analytics-workgroup`
- **Results Bucket**: `edforge-athena-results-{hash}`
- **Encryption**: SSE-S3
- **Purpose**: Query event data from S3 via Glue tables

#### Glue ETL Jobs
**Location**: `server/lib/shared-infra/Resources/glue-etl-jobs.ts`

- **Jobs**: 3 materialized view ETL jobs
  - `StudentDashboardETL`: Aggregates student performance data
  - `PrincipalDashboardETL`: Aggregates school-level metrics
  - `TeacherDashboardETL`: Aggregates classroom-level metrics
- **Schedule**: Daily at 2 AM UTC (via EventBridge cron rule)
- **Resources**: 2 DPUs per job
- **Timeout**: 60 minutes
- **Output Format**: Parquet
- **Scripts Location**: `server/lib/shared-infra/Resources/glue-scripts/`

#### CloudWatch Monitoring
**Location**: `server/lib/shared-infra/Resources/event-monitoring.ts`

- **DLQ Alarms**:
  - `edforge-parent-portal-dlq-messages`: Threshold 10 messages
  - `edforge-analytics-dlq-messages`: Threshold 10 messages
- **Lambda Alarms** (if handler provided):
  - `edforge-parent-portal-lambda-errors`: Threshold 5 errors (5-minute period)
  - `edforge-parent-portal-lambda-duration`: Threshold 5000ms (average, 5-minute period)
  - `edforge-parent-portal-lambda-no-invocations`: Threshold 1 invocation (1-hour period)

#### DynamoDB Tables
- **Tenant Mapping Table**: `TenantMappingTable`
  - Partition key: `tenantId`
  - Point-in-time recovery: Enabled
  - Purpose: Maps tenant IDs to stack names and configuration

#### Static Site Distributions
- **Admin Site**: CloudFront distribution for AdminWeb UI
- **App Site**: CloudFront distribution for tenant application (legacy, retained for backward compatibility)
- **Access Logs Bucket**: S3 bucket for CloudFront access logs

---

### 2. ControlPlaneStack

**Location**: `server/lib/bootstrap-template/control-plane-stack.ts`

#### SBT Control Plane
- **Framework**: `@cdklabs/sbt-aws`
- **Components**:
  - Cognito Authentication (`CognitoAuth`)
  - Control Plane API Gateway (HTTP API)
  - Event Manager (`eventManager`) - **Creates custom EventBridge event bus**
- **Event Bus**: Created by SBT Event Manager
  - **Name Format**: `controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]`
  - **Purpose**: Handles tenant lifecycle events (onboarding, offboarding)
  - **Note**: Can be used by application services via `EVENT_BUS_NAME` environment variable

#### Cognito User Pool
- **Purpose**: System admin authentication for control plane
- **Features**:
  - Email verification enabled
  - Self-signup: Configurable via `useFederation`
  - Password policy: 8+ chars, uppercase, lowercase, digits, symbols
  - Custom attributes: `tenantId`, `userRole`, `apiKey`, `tenantTier`, `tenantName`

#### AdminWeb Static Site
- **Conditional**: Only deployed if `client/AdminWeb` directory exists
- **Distribution**: Uses CloudFront from SharedInfraStack
- **Configuration**: OIDC with Cognito (client ID, issuer, well-known endpoint)

#### Outputs
- `adminSiteUrl`: CloudFront URL for Admin Web
- `ControlPlaneApiUrl`: Control Plane API Gateway URL
- `CognitoClientId`: Cognito App Client ID
- `CognitoWellKnownUrl`: OIDC well-known endpoint
- `CognitoTokenEndpoint`: OAuth2 token endpoint

---

### 3. CoreAppPlaneStack

**Location**: `server/lib/bootstrap-template/core-appplane-stack.ts`

#### Tenant Lifecycle Management
- **Provisioning Script Job**: `provision-tenant.sh`
  - Environment variables from event: `tenantId`, `tier`, `tenantName`, `email`, `useFederation`, `useEc2`, `useRProxy`
  - Outputs to event: `tenantS3Bucket`, `tenantConfig`, `prices`, `tenantName`, `email`, `registrationStatus`
- **Deprovisioning Script Job**: `deprovision-tenant.sh`
  - Environment variables from event: `tenantId`, `tier`
  - Outputs to event: `registrationStatus`

#### Core Application Plane
- **Framework**: `@cdklabs/sbt-aws` CoreApplicationPlane
- **Purpose**: Orchestrates tenant onboarding/offboarding via Step Functions
- **Integration**: Uses SBT Event Manager for event routing

---

### 4. TenantTemplateStack

**Location**: `server/lib/tenant-template/tenant-template-stack.ts`

#### ECS Cluster
**Location**: `server/lib/tenant-template/ecs-cluster.ts`

- **Cluster Name**:
  - Basic tier: `{stage}-{tenantId}` (e.g., `prod-basic`)
  - Advanced tier: `{stage}-advanced-{accountId}`
- **Container Insights**: Disabled (development cost optimization)
- **EC2 Tier Configuration** (if `useEc2=true`):
  - Instance type: `t3.micro` (development) or configurable for production
  - Auto Scaling Group:
    - Desired capacity: 1 (development)
    - Min capacity: 1
    - Max capacity: 3 (development) or 10+ (production)
  - Capacity provider:
    - Target capacity: 95% (development) or 80-85% (production)
    - Managed scaling: Enabled

#### Service Discovery
- **Namespace**: Cloud Map HTTP namespace
- **Name**: `{tenantName}` (e.g., `basic`)
- **Service Registration**: Each microservice registers with DNS name:
  - Format: `{service-name}-api.{namespace}.sc`
  - Example: `school-api.basic.sc`, `enrollment-api.basic.sc`

#### ECS Services
**Location**: `server/lib/tenant-template/services.ts`

Each service from `service-info.json` is deployed as an ECS service:

- **Task Definition**: Fargate or EC2 (based on tier)
- **Container Resources**:
  - CPU: 256 (0.25 vCPU) - development minimum
  - Memory: 512 MB - development minimum
- **Service Configuration**:
  - Desired count: 1 (development)
  - Min healthy percent: 0 (faster deployment)
  - Max healthy percent: 200
  - Enable execute command: true (for debugging)
- **Service Connect**: Enabled for inter-service communication
- **Health Checks**: Configured per service (if defined in service-info.json)
- **Logging**: CloudWatch Logs with 7-day retention (development)

#### DynamoDB Tables
**Location**: `server/lib/tenant-template/ecs-dynamodb.ts`

- **Table Naming**: `{table-name}-{tier}` (e.g., `school-table-v2-basic`, `finance-table-basic`)
- **Partition Key**: `tenantId` (for tenant isolation)
- **Sort Key**: `entityKey` (service-specific entity identifier)
- **Billing Mode**: Provisioned (5 read/write capacity units per GSI)
- **Point-in-Time Recovery**: Enabled
- **TTL**: Enabled (attribute: `ttl`) for audit log retention (FERPA compliance)

**Global Secondary Indexes (GSI)**:
- **GSI1**: `gsi1pk` / `gsi1sk` - School index
- **GSI2**: `gsi2pk` / `gsi2sk` - Academic year index
- **GSI3**: `gsi3pk` / `gsi3sk` - Assignment index
- **GSI4**: `gsi4pk` / `gsi4sk` - Category index
- **GSI5**: `gsi5pk` / `gsi5sk` - Term index
- **GSI6**: `gsi6pk` / `gsi6sk` - School index (academic data)
- **GSI7-GSI12**: Enrollment service indexes (commented out - deploy incrementally due to AWS limitation)

**ABAC Policy**: 
- Main table queries: `dynamodb:LeadingKeys` condition enforces tenant isolation
- GSI queries: Tenant filtering at application level (GSIs use different partition keys)

#### Identity Provider (Cognito)
**Location**: `server/lib/tenant-template/identity-provider.ts`

- **User Pool**: Per-tenant Cognito User Pool
- **Logical ID**: `{tier}UserPool{tenantId}` (e.g., `basicUserPoolbasic`)
- **Features**:
  - Email verification: Auto-enabled
  - Self-signup: Configurable via `useFederation`
  - Password policy: 8+ chars, uppercase, lowercase, digits, symbols
  - Custom attributes: `tenantId`, `userRole`, `apiKey`, `tenantTier`, `tenantName`
- **Email Templates**:
  - Subject: "Welcome to EdForge - Your Account is Ready"
  - Body: Contains NextJS application URL (`nextjsAppUrl`)
  - SMS: Contains NextJS application URL

#### Reverse Proxy (rproxy)
- **Conditional**: Deployed if `useRProxy=true`
- **Purpose**: Routes API Gateway requests to appropriate microservices
- **Configuration**: Nginx template (`server/application/reverseproxy/nginx.template`)
- **Routes**: Defined per service (e.g., `/schools` → `school-api`, `/enrollments` → `enrollment-api`)

#### IAM Task Roles
- **Task Execution Role**: Pulls images from ECR, writes CloudWatch logs
- **Task Role**: Service-specific permissions (DynamoDB, EventBridge, etc.)
- **ABAC Role**: Assumed by task role with tenant tag condition for DynamoDB access

---

## Microservices Configuration

### Service Definitions
**Source**: `server/service-info.txt` (processed to `server/lib/service-info.json`)

All 10 microservices are configured with:

#### 1. User Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/user`
- **Resources**: 512 MB memory, 256 CPU (0.25 vCPU)
- **Port**: 3010
- **IAM Permissions**: Cognito (user management), SSM (session manager)
- **Database**: None (uses Cognito for user storage)

#### 2. School Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/school`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared with enrollment, curriculum, assessment, attendance, staff, parent-portal)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**:
  - `TABLE_NAME`: `school-table-v2-{tier}`
  - `EVENT_BUS_NAME`: `<EVENT_BUS_NAME>` (replaced at deployment)
  - `AWS_REGION`: `<REGION>`
  - `PORT`: `3010`

#### 3. Enrollment Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/enrollment`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents), DynamoDB TransactWriteItems
- **Environment Variables**: Same as School Service

#### 4. Curriculum Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/curriculum`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**: Same as School Service

#### 5. Assessment Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/assessment`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**: Same as School Service

#### 6. Attendance Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/attendance`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**: Same as School Service

#### 7. Finance Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/finance`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `finance-table-{tier}` (**dedicated** - PCI compliance)
- **IAM Permissions**: DynamoDB (finance-table-*), EventBridge (PutEvents)
- **Environment Variables**:
  - `TABLE_NAME`: `finance-table-{tier}`
  - `EVENT_BUS_NAME`: `<EVENT_BUS_NAME>`
  - `AWS_REGION`: `<REGION>`
  - `PORT`: `3010`

#### 8. Staff Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/staff`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**: Same as School Service

#### 9. Parent Portal Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/parent-portal`
- **Resources**: 512 MB memory, 256 CPU
- **Port**: 3010
- **Database**: `school-table-v2-{tier}` (shared)
- **IAM Permissions**: DynamoDB (school-table-v2-*), EventBridge (PutEvents)
- **Environment Variables**: Same as School Service

#### 10. Analytics Service
- **Image**: `{ACCOUNT_ID}.dkr.ecr.{REGION}.amazonaws.com/analytics`
- **Resources**: 1024 MB memory, 512 CPU (higher resources for query processing)
- **Port**: 3010
- **Database**: None (read-only, queries S3 via Athena)
- **IAM Permissions**:
  - Athena (StartQueryExecution, GetQueryExecution, GetQueryResults, StopQueryExecution)
  - Glue (GetTable, GetPartitions, GetDatabase)
  - S3 (GetObject, PutObject, ListBucket) - data lake and Athena results buckets
  - EventBridge (PutEvents) - for analytics events
- **Environment Variables**:
  - `ATHENA_WORKGROUP`: `<ATHENA_WORKGROUP>` (from SharedInfraStack output)
  - `ATHENA_DATABASE`: `<GLUE_DATABASE>` (from SharedInfraStack output)
  - `ATHENA_RESULTS_BUCKET`: `edforge-athena-results-{tier}`
  - `DATA_LAKE_BUCKET`: `edforge-data-lake-{tier}`
  - `EVENT_BUS_NAME`: `<EVENT_BUS_NAME>`
  - `AWS_REGION`: `<REGION>`
  - `PORT`: `3010`

---

## Event-Driven Architecture

### Event Bus Configuration

#### Default Event Bus (Current MVP Configuration)
- **Name**: `default` (AWS default EventBridge event bus)
- **Configuration**: Set via `EVENT_BUS_NAME` environment variable in `service-info.json`
- **Usage**: All microservices publish to default bus unless custom bus is specified
- **Advantage**: No CDK changes needed, works immediately

#### SBT Event Bus (Optional Production Configuration)
- **Name**: Created by ControlPlaneStack via SBT Event Manager
- **Format**: `controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]`
- **Configuration**: 
  - Option 1: Set CDK context: `--context eventBusName=<bus-name>` in SharedInfraStack
  - Option 2: Export from ControlPlaneStack and import in TenantTemplateStack
  - Option 3: Set `EVENT_BUS_NAME` environment variable in `service-info.json` directly
- **Advantage**: Unified event bus for tenant lifecycle and application events

### Event Publishing

Each microservice publishes events via AWS SDK EventBridge client:

**Event Source Naming Convention**:
- Format: `edforge.{service-name}-service`
- Examples:
  - `edforge.school-service`
  - `edforge.enrollment-service`
  - `edforge.curriculum-service`
  - `edforge.assessment-service`
  - `edforge.attendance-service`
  - `edforge.finance-service`
  - `edforge.staff-service`
  - `edforge.parent-portal-service`

**Event Structure**:
```typescript
{
  Source: 'edforge.{service}-service',
  DetailType: '{EventName}', // e.g., 'SchoolCreated', 'GradePublished'
  Detail: {
    tenantId: string,
    timestamp: string,
    // Service-specific event data
  }
}
```

**Event Bus Name Resolution**:
1. Services read `EVENT_BUS_NAME` from environment variable
2. Defaults to `'default'` if not set
3. EventBridge client uses bus name when publishing:
   ```typescript
   EventBusName: this.eventBusName !== 'default' ? this.eventBusName : undefined
   ```
   (Note: `undefined` means default bus for AWS SDK)

### Event Consumption

#### Parent Portal Lambda Handler
- **Trigger**: EventBridge rules for `GradePublished`, `InvoiceGenerated`, `AttendanceRecorded`
- **Current Implementation**: Stub (logs events, doesn't send notifications)
- **Future Implementation**: 
  - Fetch parents by student ID from DynamoDB
  - Check notification preferences
  - Send email/SMS via SES/SNS

#### Analytics Firehose Ingestion
- **Trigger**: EventBridge rule matching all service events
- **Flow**: EventBridge → Kinesis Firehose → Lambda Transformer → S3 Data Lake
- **Transformation**: Lambda extracts service name from event source for S3 partitioning
- **Partitioning**: `events/year={yyyy}/month={MM}/day={dd}/service={service}/`
- **Format**: JSON (GZIP compressed)

### Event Flow Diagram

```
Microservice (e.g., Assessment Service)
    │
    │ Publishes event: { source: 'edforge.assessment-service', detailType: 'GradePublished' }
    ▼
EventBridge Event Bus (default or SBT bus)
    │
    ├─→ EventBridge Rule: Parent Portal - Grade Published
    │   │
    │   └─→ Lambda: parent-portal-notification-handler
    │       └─→ DLQ: parent-portal-dlq (if Lambda fails)
    │
    └─→ EventBridge Rule: Analytics - All Events
        │
        └─→ Kinesis Firehose: edforge-events-stream
            │
            ├─→ Lambda Transformer: firehose-transformer
            │   └─→ Extracts service name for partitioning
            │
            └─→ S3 Data Lake: edforge-data-lake-{hash}
                │
                └─→ Partitioned: events/year=2025/month=01/day=15/service=assessment-service/
                    │
                    └─→ Glue Table: assessment_events
                        │
                        └─→ Athena Query (via Analytics Service)
```

---

## Data Architecture

### DynamoDB Strategy

#### Single-Table Design
- **Table**: `school-table-v2-{tier}`
- **Services Using**: School, Enrollment, Curriculum, Assessment, Attendance, Staff, Parent Portal
- **Partition Key**: `tenantId` (tenant isolation)
- **Sort Key**: `entityKey` (service-specific, e.g., `SCHOOL#{schoolId}`, `STUDENT#{studentId}`)
- **Entity Type**: Stored in `entityType` attribute (e.g., `'SCHOOL'`, `'STUDENT'`, `'ENROLLMENT'`)

#### Dedicated Finance Table
- **Table**: `finance-table-{tier}`
- **Purpose**: PCI compliance (payment data isolation)
- **Partition Key**: `tenantId`
- **Sort Key**: `entityKey`
- **Services Using**: Finance only

#### Global Secondary Indexes (GSI)

**GSI1**: School Index
- Partition: `gsi1pk` = `SCHOOL#{schoolId}`
- Sort: `gsi1sk` = Entity-specific key
- Use case: Query all entities for a school

**GSI2**: Academic Year Index
- Partition: `gsi2pk` = `ACADEMIC_YEAR#{academicYearId}`
- Sort: `gsi2sk` = Entity-specific key
- Use case: Query all entities for an academic year

**GSI3-GSI6**: Academic Service Indexes
- GSI3: Assignment index
- GSI4: Category index
- GSI5: Term index
- GSI6: School index (academic data)

**GSI7-GSI12**: Enrollment Service Indexes (commented out - deploy incrementally)
- GSI7: Student-centric index
- GSI8: Staff-centric index
- GSI9: Parent-centric index
- GSI10: Invoice status index
- GSI11: Staff by department index
- GSI12: Parent-student relationship index

**Note**: AWS DynamoDB limitation - only one GSI can be created/deleted per update. GSI7-GSI12 must be added incrementally (one per deployment).

### S3 Data Lake

#### Bucket Structure
```
edforge-data-lake-{hash}/
├── events/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=15/
│   │   │   │   ├── service=school-service/
│   │   │   │   │   └── {timestamp}-{hash}.json.gz
│   │   │   │   ├── service=enrollment-service/
│   │   │   │   └── ...
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── errors/
│   └── year={yyyy}/month={MM}/day={dd}/
│       └── {error-files}.json.gz
├── materialized-views/
│   ├── student-dashboards/
│   ├── principal-dashboards/
│   └── teacher-dashboards/
└── glue-scripts/
    ├── student-dashboard-etl.py
    ├── principal-dashboard-etl.py
    └── teacher-dashboard-etl.py
```

#### Partitioning Strategy
- **Time-based**: `year={yyyy}/month={MM}/day={dd}/`
- **Service-based**: `service={service-name}/`
- **Purpose**: Efficient querying with Athena (partition pruning)

#### Data Format
- **Format**: JSON (EventBridge event envelope)
- **Compression**: GZIP
- **Schema**: Defined in Glue tables with partition projection

### Glue Catalog

#### Database
- **Name**: `edforge_analytics`
- **Location**: `s3://edforge-data-lake-{hash}/`

#### Tables
- **Naming**: `{service}_events` (e.g., `school_events`, `enrollment_events`)
- **Schema**: EventBridge envelope structure
- **Partition Projection**: Enabled (no MSCK REPAIR needed)
- **SerDe**: `org.openx.data.jsonserde.JsonSerDe`

#### Materialized Views
- **Tables**: `student_dashboard_view`, `principal_dashboard_view`, `teacher_dashboard_view`
- **Format**: Parquet
- **ETL Jobs**: Run daily at 2 AM UTC
- **Purpose**: Pre-aggregated data for faster dashboard queries

### Athena

#### Workgroup
- **Name**: `edforge-analytics-workgroup`
- **Results Location**: `s3://edforge-athena-results-{hash}/`
- **Encryption**: SSE-S3

#### Query Pattern
```sql
SELECT 
  JSON_EXTRACT_SCALAR(detail, '$.tenantId') as tenant_id,
  JSON_EXTRACT_SCALAR(detail, '$.schoolId') as school_id,
  source,
  "detail-type",
  time
FROM school_events
WHERE year = '2025'
  AND month = '01'
  AND day = '15'
  AND service = 'school-service'
LIMIT 100;
```

---

## Networking & Security

### VPC Architecture

#### Subnet Configuration
- **Private Subnets**: `10.0.{index*64}.0/18` (per AZ)
  - Purpose: ECS services (no direct internet access)
  - NAT Gateway: Required for outbound internet (for ECR, S3, etc.)
- **Public Subnets**: `10.0.{192+index}.0/24` (per AZ)
  - Purpose: NAT Gateway, Load Balancers (if internet-facing)

#### Security Groups
- **ALB Security Group** (`alb-sg`):
  - Ingress: VPC CIDR (10.0.0.0/16) on port 80
  - Egress: All traffic
- **ECS Security Group** (`ecsSG`):
  - Ingress: ALB security group on service ports
  - Egress: All traffic
- **Flow Logs**: Enabled to CloudWatch Logs (all traffic)

### API Gateway VPC Link

- **Type**: VPC Link (private integration)
- **Target**: Network Load Balancer (NLB)
- **Purpose**: Allows API Gateway to access private ECS services
- **Connection**: `{{connection_id}}` in `tenant-api-prod.json` (replaced at deployment)

### Service Discovery

- **Namespace**: Cloud Map HTTP namespace
- **Name**: `{tenantName}` (e.g., `basic`)
- **Service Registration**: Automatic via ECS Service Connect
- **DNS Format**: `{service-name}-api.{namespace}.sc`
- **Example**: `school-api.basic.sc` resolves to school service

### IAM & Security

#### Task Execution Roles
- **Purpose**: Pull images from ECR, write CloudWatch logs
- **Managed Policy**: `AmazonECSTaskExecutionRolePolicy`

#### Task Roles (Service-Specific)
- **Purpose**: Service-specific permissions (DynamoDB, EventBridge, etc.)
- **Configuration**: Defined in `service-info.json` per service
- **ABAC Pattern**: Task role assumes ABAC role with tenant tag condition for DynamoDB

#### API Gateway Authorizer
- **Type**: Lambda authorizer (Python)
- **Location**: `server/lib/shared-infra/Resources/tenant_authorizer.py`
- **Function**: Validates JWT token, extracts tenant context, checks API key tier
- **Output**: Tenant path, tenant ID, user role (passed to backend services)

#### Tenant Isolation
- **DynamoDB**: ABAC policy with `dynamodb:LeadingKeys` condition
- **EventBridge**: Events include `tenantId` in detail (filtering at application level)
- **Cognito**: Per-tenant User Pool
- **ECS**: Tenant-specific clusters (Basic tier) or shared cluster with tenant tags (Advanced tier)

---

## Deployment Expectations

### What to Expect When Running install.sh

#### Phase 1: Pre-deployment (1-2 minutes)
- API key generation (if not provided)
- S3 bucket creation for provision source
- ECS service-linked role check/creation
- Environment variable setup

#### Phase 2: CDK Bootstrap (2-5 minutes)
- CDKToolkit stack creation:
  - ECR repository for container assets
  - S3 staging bucket
  - IAM roles for deployment
- **Note**: Bootstrap is idempotent (skips if already exists)

#### Phase 3: CDK Synthesis (1-3 minutes)
- CDK synthesizes all stacks
- Builds Lambda layers (Python)
- Validates configurations
- **Warnings Expected**:
  - Cognito `advancedSecurityMode` deprecation (safe to ignore)
  - ECS `containerInsights` deprecation (safe to ignore)
  - VPC subnet route table warnings (expected with `fromVpcAttributes`)

#### Phase 4: Stack Deployment (10-25 minutes)
- **SharedInfraStack** (5-10 minutes):
  - VPC creation: ~2 minutes
  - Load balancers: ~3 minutes
  - API Gateway: ~2 minutes
  - EventBridge resources: ~1 minute
  - S3 buckets: ~1 minute
  - Glue/Athena: ~2 minutes
- **ControlPlaneStack** (3-5 minutes):
  - Cognito User Pool: ~2 minutes
  - SBT Control Plane: ~2 minutes
  - AdminWeb static site: ~1 minute (if directory exists)
- **CoreAppPlaneStack** (2-3 minutes):
  - Step Functions state machines: ~2 minutes
- **TenantTemplateStack** (5-10 minutes):
  - ECS cluster: ~1 minute
  - DynamoDB tables: ~2 minutes (GSI creation takes time)
  - ECS services: ~3-5 minutes (container image pull, service registration)
  - Reverse proxy: ~1 minute (if enabled)

#### Phase 5: Post-deployment (30 seconds)
- CloudFormation output retrieval
- URL display (admin site, app site)

**Total Expected Time**: 15-30 minutes for fresh deployment

### Resource Creation Timeline

1. **Minutes 0-5**: VPC, subnets, security groups, load balancers
2. **Minutes 5-10**: API Gateway, EventBridge, S3 buckets
3. **Minutes 10-15**: Cognito, SBT Control Plane, Glue/Athena
4. **Minutes 15-20**: DynamoDB tables (with GSI creation)
5. **Minutes 20-25**: ECS cluster, services, container startup
6. **Minutes 25-30**: Service registration, health checks, routing

### Post-Deployment Verification

#### 1. Check Stack Status
```bash
aws cloudformation describe-stacks --stack-name shared-infra-stack --query 'Stacks[0].StackStatus'
aws cloudformation describe-stacks --stack-name controlplane-stack --query 'Stacks[0].StackStatus'
aws cloudformation describe-stacks --stack-name tenant-template-stack-basic --query 'Stacks[0].StackStatus'
```

Expected: `CREATE_COMPLETE`

#### 2. Verify ECS Services
```bash
aws ecs list-services --cluster prod-basic
aws ecs describe-services --cluster prod-basic --services schoolbasic enrollmentbasic
```

Expected: Services in `ACTIVE` state, desired count = 1, running count = 1

#### 3. Verify API Gateway
```bash
aws apigateway get-rest-apis --query 'items[?name==`TenantAPI`]'
```

Expected: REST API with stage `prod`

#### 4. Verify EventBridge
```bash
aws events list-event-buses
aws events list-rules --event-bus-name default
```

Expected: Default bus exists, rules created (parent-portal-*, analytics-all-events)

#### 5. Verify DynamoDB Tables
```bash
aws dynamodb list-tables --query 'TableNames[?contains(@, `school-table-v2-basic`) || contains(@, `finance-table-basic`)]'
```

Expected: `school-table-v2-basic`, `finance-table-basic` exist

#### 6. Verify S3 Buckets
```bash
aws s3 ls | grep edforge
```

Expected: `edforge-data-lake-*`, `edforge-event-archive-*`, `edforge-athena-results-*`

#### 7. Test API Endpoint
```bash
# Get API Gateway URL
API_URL=$(aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" --output text)

# Test endpoint (requires authentication)
curl -X GET "${API_URL}prod/schools" \
  -H "x-api-key: <API_KEY>" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

Expected: 200 OK or 401 Unauthorized (if credentials invalid)

### Common Issues and Resolutions

#### Issue 1: ECS Services Not Starting
**Symptoms**: Services stuck in `PENDING` or `ACTIVE` but tasks not running
**Causes**:
- Container image not found in ECR
- Task definition resource limits too low
- Security group misconfiguration
**Resolution**:
1. Check ECR: `aws ecr describe-images --repository-name school`
2. Check ECS task logs: `aws logs tail /ecs-container-logs/school --follow`
3. Check task definition: `aws ecs describe-task-definition --task-definition school-TaskDef`

#### Issue 2: API Gateway 502 Bad Gateway
**Symptoms**: API Gateway returns 502 when calling services
**Causes**:
- VPC Link not connected to NLB
- NLB target group unhealthy
- ECS service not registered with Service Connect
**Resolution**:
1. Check VPC Link: `aws apigateway get-vpc-links`
2. Check NLB target health: `aws elbv2 describe-target-health --target-group-arn <tg-arn>`
3. Check Service Connect: `aws ecs describe-services --cluster prod-basic --services schoolbasic --include TAGS`

#### Issue 3: EventBridge Events Not Appearing
**Symptoms**: Events published but not reaching targets
**Causes**:
- Event bus name mismatch
- IAM permissions missing
- Event pattern doesn't match
**Resolution**:
1. Check service logs for event bus name: `aws logs tail /ecs-container-logs/school --follow | grep EVENT_BUS_NAME`
2. Check IAM permissions: `aws iam get-role-policy --role-name <task-role> --policy-name <policy>`
3. Check EventBridge rules: `aws events list-rules --event-bus-name default`

#### Issue 4: DynamoDB Access Denied
**Symptoms**: Services can't read/write DynamoDB
**Causes**:
- ABAC role not assumed correctly
- Tenant tag missing on task role session
- Table name mismatch
**Resolution**:
1. Check task role tags: `aws iam list-role-tags --role-name <task-role>`
2. Check ABAC role trust policy: `aws iam get-role --role-name <abac-role>`
3. Verify table name in environment: `aws ecs describe-task-definition --task-definition school-TaskDef --query 'taskDefinition.containerDefinitions[0].environment'`

---

## Event Bus Configuration Details

### Current MVP Configuration: Default Event Bus

**How It Works**:
1. `SharedInfraStack` references default EventBridge bus:
   ```typescript
   const eventBus = events.EventBus.fromEventBusName(this, 'DefaultEventBus', 'default');
   ```
2. `service-info.json` sets `EVENT_BUS_NAME: "<EVENT_BUS_NAME>"` (placeholder)
3. At deployment, placeholder is replaced with `'default'` (or custom value if specified)
4. Services read `EVENT_BUS_NAME` from environment variable
5. Services publish to default bus (or custom bus if `EVENT_BUS_NAME !== 'default'`)

**Advantages**:
- ✅ No CDK changes needed
- ✅ Works immediately
- ✅ Simple configuration

**Disadvantages**:
- ⚠️ Events separated from SBT tenant lifecycle events
- ⚠️ Need to manage two event buses

### Optional: SBT Event Bus Configuration

**How to Configure**:

1. **Export Event Bus Name from ControlPlaneStack**:
   ```typescript
   // In control-plane-stack.ts, after line 68
   new cdk.CfnOutput(this, 'SbtEventBusName', {
     value: this.eventManager.busName,
     exportName: 'SbtEventBusName',
     description: 'SBT Event Bus name for application services'
   });
   ```

2. **Import in TenantTemplateStack**:
   ```typescript
   // In tenant-template-stack.ts, after parsing service-info.json
   const sbtEventBusName = cdk.Fn.importValue('SbtEventBusName');
   
   // Inject into service environment variables
   containerInfo.forEach((info) => {
     if (info.environment) {
       info.environment.EVENT_BUS_NAME = sbtEventBusName;
     }
   });
   ```

3. **Update SharedInfraStack EventBridge Rules**:
   ```typescript
   // In shared-infra-stack.ts, use imported bus name
   const eventBusName = cdk.Fn.importValue('SbtEventBusName');
   const eventBus = events.EventBus.fromEventBusName(this, 'SbtEventBus', eventBusName);
   ```

**Advantages**:
- ✅ Unified event bus for all events
- ✅ Better observability
- ✅ Consistent with SBT architecture

**Disadvantages**:
- ⚠️ Requires CDK changes
- ⚠️ More complex configuration

### Event Bus Name Resolution Flow

```
1. ControlPlaneStack creates SBT Event Manager
   └─→ eventManager.busName = "controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]"

2. SharedInfraStack reads CDK context or uses default
   └─→ eventBusName = context('eventBusName') || 'default'
   └─→ eventBus = EventBus.fromEventBusName(eventBusName)

3. TenantTemplateStack sets EVENT_BUS_NAME in service-info.json
   └─→ info.environment.EVENT_BUS_NAME = eventBusName (or imported from ControlPlaneStack)

4. ECS Task Definition includes environment variable
   └─→ EVENT_BUS_NAME = 'default' (or custom bus name)

5. Microservice reads environment variable
   └─→ this.eventBusName = process.env.EVENT_BUS_NAME || 'default'

6. Microservice publishes event
   └─→ EventBridge.putEvents({ EventBusName: this.eventBusName, ... })
```

---

## Microservices Inter-Service Communication

### Synchronous Communication (HTTP/REST)

**Pattern**: Direct HTTP calls via Service Connect

**Service Discovery**:
- **Namespace**: Cloud Map HTTP namespace (`{tenantName}`)
- **DNS Format**: `{service-name}-api.{namespace}.sc`
- **Example**: `school-api.basic.sc`, `enrollment-api.basic.sc`

**HTTP Clients**:
- **Library**: `@app/http-client` (Axios-based)
- **Features**:
  - Circuit breaker
  - Retry logic
  - Timeout handling
  - JWT token forwarding
  - Tenant context propagation

**Example**: Enrollment Service calls Curriculum Service
```typescript
// enrollment/src/common/services/curriculum-http-client.service.ts
const url = `/curriculum/classrooms/${classroomId}?schoolId=${schoolId}&academicYearId=${academicYearId}`;
const response = await this.httpClient.get<Classroom>(
  url,
  { baseURL: 'http://curriculum-service:3003' }, // Service Connect DNS
  { tenantId, userId: 'system', jwtToken: undefined }
);
```

### Asynchronous Communication (EventBridge)

**Pattern**: Event-driven via EventBridge

**Event Publishing**:
- **Library**: AWS SDK EventBridge client
- **Event Source**: `edforge.{service-name}-service`
- **Event Bus**: `default` (MVP) or SBT event bus (optional)

**Event Consumption**:
- **Lambda**: Parent Portal notifications
- **Firehose**: Analytics ingestion
- **Future**: Direct service subscriptions (if needed)

---

## Security Architecture

### Authentication

#### Control Plane (Admin)
- **Provider**: Cognito (ControlPlaneStack)
- **Users**: System administrators
- **Flow**: OIDC with Cognito User Pool

#### Application Plane (Tenants)
- **Provider**: Cognito (per-tenant User Pool)
- **Users**: Tenant users (students, teachers, parents, admins)
- **Flow**: JWT tokens with custom claims (tenantId, userRole, tenantTier)

### Authorization

#### API Gateway Authorizer
- **Type**: Lambda authorizer (Python)
- **Function**: `tenant_authorizer.py`
- **Validation**:
  1. Validates JWT token (Cognito)
  2. Extracts tenant context
  3. Validates API key tier
  4. Returns tenant path, tenant ID, user role

#### Tenant Isolation
- **DynamoDB**: ABAC policy with `dynamodb:LeadingKeys` condition
- **EventBridge**: Events include `tenantId` (filtering at application level)
- **Cognito**: Per-tenant User Pool
- **ECS**: Tenant-specific clusters or tenant tags

### Data Encryption

#### At Rest
- **DynamoDB**: Encryption at rest (AWS-managed keys)
- **S3**: SSE-S3 (server-side encryption)
- **CloudWatch Logs**: Encryption at rest (AWS-managed)

#### In Transit
- **API Gateway**: HTTPS (TLS 1.2+)
- **ECS Services**: HTTP (internal VPC, can enable HTTPS if needed)
- **EventBridge**: HTTPS (AWS-managed)

### IAM Policies

#### Service Task Roles
- **DynamoDB**: Scoped to specific tables (e.g., `school-table-v2-*`, `finance-table-*`)
- **EventBridge**: Scoped to specific event bus
- **S3**: Scoped to specific buckets (Analytics service)
- **Athena/Glue**: Scoped to specific workgroup/database (Analytics service)

#### ABAC Pattern
- **Task Role**: Assumes ABAC role with tenant tag condition
- **ABAC Role**: DynamoDB access with `dynamodb:LeadingKeys` condition
- **Tenant Tag**: `aws:PrincipalTag/tenant` must match `tenantId` in DynamoDB key

---

## Monitoring & Observability

### CloudWatch Logs

#### Log Groups
- **ECS Services**: `/ecs-container-logs/{service-name}`
- **Lambda Functions**: `/aws/lambda/{function-name}`
- **API Gateway**: `/aws/apigateway/{api-name}`
- **Firehose**: `/aws/kinesisfirehose/edforge-events-stream`
- **Retention**: 7 days (development), 30+ days (production)

#### Log Format
- **ECS**: JSON structured logs (via NestJS logger)
- **Lambda**: CloudWatch Logs Insights compatible
- **API Gateway**: Access logs with request/response details

### CloudWatch Metrics

#### ECS Service Metrics
- **CPU Utilization**: Per service
- **Memory Utilization**: Per service
- **Task Count**: Running vs desired

#### EventBridge Metrics
- **Invocations**: Per rule
- **Failed Invocations**: Per rule
- **Dead Letter Queue Messages**: Per DLQ

#### Lambda Metrics
- **Invocations**: Per function
- **Errors**: Per function
- **Duration**: Per function

### CloudWatch Alarms

#### Event Processing
- **Parent Portal DLQ**: > 10 messages
- **Analytics DLQ**: > 10 messages
- **Lambda Errors**: > 5 errors (5-minute period)
- **Lambda Duration**: > 5000ms average (5-minute period)
- **Lambda No Invocations**: < 1 invocation (1-hour period)

### X-Ray Integration

**Status**: Not yet implemented
**Planned**: Distributed tracing for service-to-service calls

---

## Cost Optimization (Development)

### Current Optimizations

1. **ECS Fargate**: Minimum resources (256 CPU, 512 MB) per service
2. **EC2 Instances**: `t3.micro` (smallest, cheapest) for EC2 tier
3. **Container Insights**: Disabled (saves ~$15-20/month)
4. **CloudWatch Log Retention**: 7 days (saves ~$5-10/month per service)
5. **Auto Scaling**: Minimal (1 instance, can scale to 0 manually)

### Production Recommendations

1. **ECS Fargate**: Right-size based on CloudWatch metrics (512-1024 CPU, 1024-2048 MB)
2. **EC2 Instances**: `t3.small` or `t3.medium` based on workload
3. **Container Insights**: Enable for production observability
4. **CloudWatch Log Retention**: 30+ days (or export to S3 for long-term)
5. **Auto Scaling**: Configure based on traffic patterns (min: 2, max: 10+)

---

## Architecture Diagrams

### Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└────────────────────────────┬────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │
                    │  (REST API)       │
                    │  + Lambda Auth    │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │    VPC Link       │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Network LB      │
                    │   (Internal)      │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Application LB   │
                    │   (Internal)      │
                    └─────────┬─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼──────┐    ┌─────────▼─────────┐  ┌───────▼──────┐
│   ECS        │    │   ECS Service     │  │   ECS        │
│  Service     │    │   (rproxy)        │  │  Service     │
│  (school)    │    │                    │  │ (enrollment)│
└──────────────┘    └────────────────────┘  └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   DynamoDB        │
                    │  (school-table)    │
                    └────────────────────┘
```

### Event-Driven Architecture Flow

```
┌─────────────────┐
│  Microservice   │
│ (e.g., School)  │
└────────┬────────┘
         │
         │ PutEvents({ source: 'edforge.school-service', ... })
         ▼
┌─────────────────────────────────────┐
│    EventBridge Event Bus            │
│    (default or SBT bus)             │
└────────┬────────────────────────────┘
         │
         ├──────────────────┬──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│ EventBridge  │  │  EventBridge     │  │  EventBridge │
│ Rule: Parent │  │  Rule: Analytics │  │  Rule: ...   │
│ Portal       │  │  (All Events)    │  │              │
└──────┬───────┘  └────────┬─────────┘  └──────────────┘
       │                   │
       ▼                   ▼
┌──────────────┐  ┌──────────────────┐
│ Lambda:      │  │ Kinesis Firehose │
│ parent-portal│  │ edforge-events-   │
│ -notification│  │ stream            │
│ -handler     │  └────────┬──────────┘
└──────┬───────┘           │
       │                   │
       │                   ▼
       │           ┌──────────────────┐
       │           │ Lambda:          │
       │           │ firehose-        │
       │           │ transformer      │
       │           └────────┬─────────┘
       │                   │
       │                   ▼
       │           ┌──────────────────┐
       │           │ S3 Data Lake     │
       │           │ (partitioned)    │
       │           └────────┬─────────┘
       │                   │
       │                   ▼
       │           ┌──────────────────┐
       │           │ Glue Tables      │
       │           │ (edforge_analytics│
       │           │  database)       │
       │           └────────┬─────────┘
       │                   │
       │                   ▼
       │           ┌──────────────────┐
       │           │ Athena Queries   │
       │           │ (via Analytics   │
       │           │  Service)        │
       │           └──────────────────┘
       │
       ▼
┌──────────────┐
│ DLQ:         │
│ parent-portal│
│ -dlq         │
└──────────────┘
```

### Data Flow: Request to Response

```
1. Client Request
   │
   ▼
2. API Gateway (REST API)
   │
   ├─→ Lambda Authorizer (validates JWT, extracts tenant)
   │
   ▼
3. VPC Link → NLB → ALB
   │
   ▼
4. Reverse Proxy (rproxy) [if enabled]
   │
   ├─→ Routes to appropriate service based on path
   │
   ▼
5. ECS Service (e.g., school-api.basic.sc)
   │
   ├─→ Validates tenant context
   ├─→ Queries DynamoDB (with tenant isolation)
   ├─→ Publishes event to EventBridge
   │
   ▼
6. Response
   │
   ├─→ ALB → NLB → VPC Link → API Gateway → Client
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] AWS CLI configured with appropriate credentials
- [ ] Docker installed and running (for CDK asset building)
- [ ] Node.js and npm installed
- [ ] CDK CLI installed (`npm install -g aws-cdk`)
- [ ] All microservice images built and pushed to ECR (via `build-application.sh`)
- [ ] System admin email provided as parameter to `install.sh`

### During Deployment

- [ ] Monitor CloudFormation stack creation progress
- [ ] Check for any stack creation failures
- [ ] Verify CDK bootstrap completes successfully
- [ ] Verify all stacks deploy without errors

### Post-Deployment

- [ ] Verify all CloudFormation stacks are `CREATE_COMPLETE`
- [ ] Verify ECS services are running (desired count = running count)
- [ ] Verify API Gateway is accessible
- [ ] Verify EventBridge rules are created
- [ ] Verify DynamoDB tables exist
- [ ] Verify S3 buckets are created
- [ ] Test API endpoint with authentication
- [ ] Check CloudWatch logs for service startup
- [ ] Verify Service Connect DNS resolution

---

## Key Takeaways

1. **Event Bus**: Currently uses AWS default event bus (`'default'`). Can be configured to use SBT event bus via CDK context or environment variable.

2. **Deployment Order**: SharedInfraStack → ControlPlaneStack → CoreAppPlaneStack → TenantTemplateStack

3. **Multi-Tenancy**: Infrastructure-level isolation via tenant-specific ECS clusters, DynamoDB tables, and Cognito User Pools.

4. **Event-Driven**: All microservices publish events to EventBridge. Events flow to Lambda (Parent Portal) and Firehose (Analytics).

5. **Data Architecture**: Single-table design for most services, dedicated finance table for PCI compliance, S3 data lake for analytics.

6. **Service Discovery**: Cloud Map HTTP namespace with Service Connect for inter-service communication.

7. **Security**: API Gateway Lambda authorizer, Cognito authentication, IAM ABAC for tenant isolation.

---

## References

- **Deployment Script**: `scripts/install.sh`
- **CDK App**: `server/bin/ecs-saas-ref-template.ts`
- **Service Configuration**: `server/service-info.txt`
- **API Gateway Definition**: `server/lib/tenant-api-prod.json`
- **EventBridge Rules**: `server/lib/shared-infra/Resources/eventbridge-rules.ts`
- **Microservices**: `server/application/microservices/`

---

*Document generated based on actual code and configuration files. No assumptions made.*


# Finance Service

**Version:** 1.0.0  
**Status:** Production-Ready  
**Bounded Context:** Finance & Billing

---

## Service Overview

The Finance Service manages financial operations including tuition configuration, invoice generation, payment processing, and billing account management. It operates on a dedicated DynamoDB table for PCI compliance.

### Domain & Bounded Context

**Primary Aggregates:** Invoice, Payment, TuitionConfiguration, BillingAccount

**Business Capabilities:**
- Tuition configuration management (rates, fees, discounts)
- Invoice generation and management
- Payment processing and recording
- Billing account management
- Overdue invoice detection
- Payment plan management

---

## Architecture

### Technology Stack
- **Framework:** NestJS
- **Database:** DynamoDB (dedicated `finance-table-{tier}` for PCI compliance)
- **Authentication:** JWT (Cognito)
- **Events:** AWS EventBridge
- **Scheduler:** Finance scheduler service (for overdue detection)

### Module Structure
```
finance-service/
├── src/
│   ├── finance/
│   │   ├── finance.controller.ts
│   │   ├── finance.service.ts
│   │   ├── finance-scheduler.service.ts
│   │   ├── finance.module.ts
│   │   └── dto/
│   ├── common/
│   │   ├── dynamodb-client.service.ts
│   │   ├── entities/
│   │   │   ├── finance.entities.ts
│   │   │   └── base.entity.ts
│   │   ├── services/
│   │   │   ├── finance-events.service.ts
│   │   │   └── validation.service.ts
│   │   └── utils/
│   └── app.module.ts
```

---

## API Endpoints

### Base Path: `/finance/invoices`, `/finance/payments`

### Tuition Configuration

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/finance/invoices/tuition-config` | Create tuition configuration | ✅ Implemented |
| GET | `/finance/invoices/tuition-config` | Get tuition configuration | ✅ Implemented |

### Invoice Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/finance/invoices/invoices/:invoiceId` | Get invoice by ID | ✅ Implemented |
| GET | `/finance/invoices/invoices/students/:studentId` | Get invoices by student | ✅ Implemented |
| GET | `/finance/invoices/invoices/overdue` | Get overdue invoices | ✅ Implemented |

### Payment Management

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| POST | `/finance/invoices/payments` | Record payment | ✅ Implemented |

### Health Check

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/finance/health` | Service health check | ✅ Implemented |

---

## Data Model

### Entities

#### TuitionConfiguration
```typescript
{
  tenantId: string;              // Partition key
  entityKey: string;             // Sort key: SCHOOL#schoolId#YEAR#yearId#TUITION_CONFIG
  entityType: 'TUITION_CONFIG';
  schoolId: string;
  academicYearId: string;
  tuitionRates: TuitionRate[];   // Per grade level
  fees: Fee[];
  discountPolicies: DiscountPolicy[];
  paymentPlans: PaymentPlan[];
  // ... metadata fields
}
```

#### Invoice
```typescript
{
  tenantId: string;
  entityKey: string;             // SCHOOL#schoolId#YEAR#yearId#STUDENT#studentId#INVOICE#invoiceId
  entityType: 'INVOICE';
  invoiceId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string;
  invoiceDate: string;
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  totalAmount: number;
  amountDue: number;
  amountPaid: number;
  currency: string;
  lineItems: LineItem[];
  payments: Payment[];
  // ... metadata fields
}
```

#### Payment
```typescript
{
  tenantId: string;
  entityKey: string;             // INVOICE#invoiceId#PAYMENT#paymentId
  entityType: 'PAYMENT';
  paymentId: string;
  invoiceId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card';
  transactionId?: string;
  // ... metadata fields
}
```

### DynamoDB Access Patterns

**Primary Access:**
- Get by ID: `PK=tenantId, SK=entityKey`

**GSI7 (Student-scoped queries):**
- Get invoices by student: `GSI7PK=studentId`

**GSI10 (Status-based queries):**
- Get overdue invoices: `GSI10PK=schoolId#STATUS#overdue`

---

## Events Published

All events are published to AWS EventBridge with source: `edforge.finance-service`

### Invoice Events

- **`InvoiceGenerated`** - Published when invoice is generated (consumed by Parent Portal Service)
- **`InvoiceUpdated`** - Published when invoice is updated
- **`InvoiceOverdue`** - Published when invoice becomes overdue

### Payment Events

- **`PaymentReceived`** - Published when payment is received
- **`PaymentRefunded`** - Published when payment is refunded

### Other Events

- **`LateFeeApplied`** - Published when late fee is applied
- **`DiscountApplied`** - Published when discount is applied
- **`ScholarshipAwarded`** - Published when scholarship is awarded

---

## Events Consumed

**None** - Finance Service doesn't consume events (future: may consume `StudentEnrolled` for automatic invoice generation)

---

## Dependencies

### External Services

**None** - Finance Service is independent (Enrollment Service calls Finance Service via HTTP)

### Shared Infrastructure
- **DynamoDB**: Dedicated `finance-table-{tier}` table (PCI compliance)
- **EventBridge**: Custom event bus for publishing events
- **Cognito**: JWT token validation (via API Gateway)

---

## Security Implementation

### Authentication
- **JWT Guard**: All endpoints require JWT authentication
- **Tenant Context**: Extracted from JWT `custom:tenantId` claim
- **User Context**: Extracted from JWT for audit logging

### Authorization
- **Tenant Isolation**: All queries filtered by `tenantId` (partition key)
- **Role-Based**: Finance staff can manage invoices/payments
- **Future**: AWS Verified Permissions for fine-grained authorization

### PCI Compliance
- **Dedicated Table**: Separate DynamoDB table for finance data
- **No Card Storage**: Credit card numbers not stored (use payment processor tokens)
- **Encryption**: All data encrypted at rest and in transit
- **Access Logging**: All financial operations logged

### Data Access
- **Infrastructure-Level**: DynamoDB LeadingKeys condition ensures tenant isolation
- **Application-Level**: All service methods require `tenantId` parameter
- **Audit Logging**: All operations logged with `userId`, `userRole`, `ipAddress`

---

## Implementation Status

### ✅ Implemented

- [x] Tuition configuration CRUD operations
- [x] Invoice generation
- [x] Payment recording
- [x] Invoice queries (by student, overdue)
- [x] Event publishing to EventBridge
- [x] Input validation
- [x] Optimistic locking (version field)
- [x] Audit logging
- [x] Error handling
- [x] Finance scheduler service (overdue detection)

### ⏳ Pending

- [ ] Payment processor integration (Stripe, etc.)
- [ ] Automated invoice generation (on enrollment)
- [ ] Payment plan management
- [ ] Refund processing
- [ ] Financial reports
- [ ] Payment reminders
- [ ] Multi-currency support

### ❌ Missing

- [ ] Payment gateway integration
- [ ] Recurring payment setup
- [ ] Payment dispute management
- [ ] Financial analytics
- [ ] Tax reporting

---

## Testing Status

### Unit Tests
- ⏳ **Pending** - Unit tests for services and validation

### Integration Tests
- ⏳ **Pending** - Integration tests for API endpoints

### E2E Tests
- ⏳ **Pending** - End-to-end finance workflow tests

---

## Deployment Configuration

### Environment Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# DynamoDB (Dedicated Table)
DYNAMODB_TABLE_NAME=finance-table-prod

# EventBridge
EVENT_BUS_NAME=edforge-app-plane
EVENT_SOURCE=edforge.finance-service

# Payment Processor (Future)
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx

# Cognito (for JWT validation)
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxx
COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX
```

### ECS Configuration
- **Service Name**: `finance-service`
- **Task Definition**: `finance-service:latest`
- **CPU**: 256 (0.25 vCPU)
- **Memory**: 512 MB
- **Desired Count**: 3-10 tasks
- **Auto Scaling**: CPU-based (target 70%)

### Health Check
- **Path**: `/finance/health`
- **Interval**: 30 seconds
- **Timeout**: 5 seconds
- **Healthy Threshold**: 2
- **Unhealthy Threshold**: 3

---

## Troubleshooting

### Common Issues

**Issue: Invoice not found**
- **Cause**: Invoice doesn't exist or wrong `invoiceId`
- **Solution**: Verify invoice exists using `GET /finance/invoices/invoices/:invoiceId`

**Issue: Payment amount exceeds due amount**
- **Cause**: Payment amount greater than `amountDue`
- **Solution**: Validate payment amount before processing

**Issue: Overdue invoices not detected**
- **Cause**: Scheduler service not running or incorrect configuration
- **Solution**: Check finance scheduler service logs and configuration

---

## Performance Characteristics

- **Average Latency**: ~200ms (simple queries)
- **Peak Throughput**: 80 req/sec
- **Database Reads**: ~70% of operations
- **Database Writes**: ~30% of operations

---

## Related Documentation

- [Architecture Overview](../ARCHITECTURE.md)

---

**Last Updated:** 2025-01-21  
**Maintained By:** Finance Service Team


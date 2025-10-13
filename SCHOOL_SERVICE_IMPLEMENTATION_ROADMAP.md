# School Service: Implementation Roadmap & Decision Points

## Executive Summary

The School Service is the **foundational layer** of EdForge's multi-tenant education SaaS platform. This document outlines the path from the current basic implementation to a production-ready, enterprise-grade service that enables data-driven decision-making for educational institutions.

---

## Current State Analysis

### ✅ What's Working

1. **Architecture Integration**
   - Successfully integrated with SBT-AWS CDK deployment
   - Tenant isolation via IAM policies working
   - JWT authentication and authorization functional
   - Basic CRUD operations operational

2. **Core Entities Implemented**
   - School (basic fields)
   - Department
   - Academic Year (with semesters)
   - School Configuration
   - School Reports

3. **Infrastructure**
   - DynamoDB single-table design in place
   - ECS deployment functional across all tiers
   - Service discovery via ECS Service Connect
   - Multi-tenant routing working

### ⚠️ Gaps for MVP Production Readiness

1. **Data Model Limitations**
   - Missing critical business entities (Grade Levels, Enrollment Capacity, Facilities)
   - Insufficient validation and business rule enforcement
   - No temporal boundary enforcement for academic years
   - Limited relationship modeling

2. **Compliance & Security**
   - No comprehensive audit logging (FERPA requires 2-year audit trails)
   - Missing data access tracking
   - No data retention/archival strategy
   - Insufficient PII protection

3. **Data Integrity**
   - No optimistic locking for concurrent updates
   - Weak referential integrity checks
   - Missing uniqueness constraints enforcement
   - No transaction support for complex operations

4. **Integration & Coordination**
   - No event-driven architecture
   - No cross-service communication patterns
   - Missing denormalized data synchronization
   - No real-time capacity tracking

5. **Performance & Scale**
   - No caching layer
   - No query optimization
   - Limited pagination support
   - No batch operations

6. **Decision-Making Support**
   - Insufficient data for analytics
   - No reporting infrastructure
   - Missing dashboard metrics
   - Limited capacity planning tools

---

## Strategic Decision Points

### Decision #1: Data Store Selection

**Current:** DynamoDB single-table design (pooled model for Basic tier)

**Recommendation:** ✅ **KEEP DynamoDB** with enhancements

**Rationale:**
- Already working well with tenant isolation
- Scales automatically for multi-tenant workloads
- Fits event-driven architecture perfectly
- Cost-effective for MVP
- Single-table design reduces operational complexity

**Enhancements Needed:**
1. Add Global Secondary Indexes (GSI) for efficient queries
2. Implement TTL for audit logs
3. Add DynamoDB Streams for event sourcing
4. Optimize partition key design for hot partitions

**Alternative Considered:** PostgreSQL with Aurora DSQL
- ❌ More complex tenant isolation
- ❌ Higher operational overhead
- ❌ Doesn't leverage existing DynamoDB expertise
- ✅ Better for complex joins (but we avoid joins in microservices)

---

### Decision #2: Single-Table vs Multi-Table Design

**Current:** Single-table with `entityType` discriminator

**Recommendation:** ✅ **ENHANCE single-table design**

**Rationale:**
- Reduces DynamoDB costs (fewer tables to provision)
- Simplifies tenant provisioning
- Enables transactional writes across entity types
- Better for multi-tenant isolation
- Follows AWS best practices

**Key Pattern:**
```
PK: tenantId
SK: SCHOOL#schoolId | DEPT#deptId | YEAR#yearId | etc.
GSI1-PK: schoolId (for school-centric queries)
GSI2-PK: schoolId#academicYearId (for year-scoped queries)
```

---

### Decision #3: Event-Driven Architecture

**Current:** No events, synchronous only

**Recommendation:** ✅ **IMPLEMENT event-driven with EventBridge**

**Rationale:**
- Essential for cross-service coordination
- Enables real-time data synchronization
- Supports audit logging requirements
- Allows async processing of complex operations
- Decouples services for better scalability

**Events to Publish:**
- SchoolCreated
- SchoolUpdated
- AcademicYearStarted
- AcademicYearEnded
- DepartmentRestructured
- EnrollmentCapacityChanged

**Events to Subscribe:**
- StudentEnrolled (from Student Service) → Update capacity
- StaffAssigned (from Staff Service) → Update dept staffing
- PaymentReceived (from Finance Service) → Update budget

---

### Decision #4: Audit & Compliance Strategy

**Current:** Basic timestamps only

**Recommendation:** ✅ **FULL audit trail with immutable logs**

**Rationale:**
- FERPA compliance requires 2-year audit trail
- Essential for enterprise customers
- Enables security monitoring
- Supports data governance requirements
- Differentiator in education market

**Implementation:**
1. Separate Activity Log entities (time-series)
2. DynamoDB TTL set to 2 years
3. Automatic archival to S3 Glacier
4. Track WHO, WHAT, WHEN, WHERE for every operation
5. IP address and user agent logging

---

### Decision #5: Caching Strategy

**Current:** No caching

**Recommendation:** ✅ **IMPLEMENT Redis/ElastiCache for hot data**

**Rationale:**
- School configuration rarely changes (1-hour TTL)
- Current academic year changes once per year (24-hour TTL)
- Departments moderate change frequency (30-min TTL)
- Reduces DynamoDB read costs
- Improves response times

**Cache Invalidation:**
- Event-driven invalidation on updates
- TTL as safety net
- Cache-aside pattern for resilience

---

### Decision #6: Migration Strategy

**Options:**
1. **Big Bang:** Migrate all at once during maintenance window
2. **Parallel Run:** Keep old code, run new code alongside, switch over
3. **Phased:** Migrate one entity type at a time

**Recommendation:** ✅ **PHASED migration**

**Rationale:**
- Lower risk
- Allows testing in production with small subset
- Can roll back individual phases
- Better for team learning curve

**Migration Phases:**
1. Week 1-2: Core School entity (preserve all existing functionality)
2. Week 3-4: Academic Year & Calendar entities
3. Week 5-6: Department & Budget entities
4. Week 7-8: Facilities & Capacity entities
5. Week 9-10: Audit logs & compliance features
6. Week 11-12: Events & integration

---

## Recommended Implementation Approach

### Option A: Incremental Enhancement (RECOMMENDED)

**Timeline:** 12 weeks
**Risk:** Low
**Team:** 2-3 engineers

**Approach:**
- Enhance existing service incrementally
- Maintain backward compatibility
- Add new entities alongside existing ones
- Gradual rollout of new features
- No service downtime

**Pros:**
- ✅ Continuous value delivery
- ✅ Lower risk
- ✅ Team learns incrementally
- ✅ Customer feedback loop

**Cons:**
- ⚠️ Longer timeline
- ⚠️ Code complexity during transition

---

### Option B: Rewrite from Scratch

**Timeline:** 8 weeks
**Risk:** High
**Team:** 3-4 engineers

**Approach:**
- Build new service in parallel
- Cut over when feature-complete
- Keep old service running during transition

**Pros:**
- ✅ Faster to complete
- ✅ Clean codebase
- ✅ No technical debt

**Cons:**
- ❌ Higher risk of bugs
- ❌ No customer feedback until complete
- ❌ Duplicate effort maintaining two services
- ❌ Big-bang cutover risk

---

## Prioritized Feature Roadmap

### 🚀 Phase 1: Foundation (Weeks 1-2) - CRITICAL FOR MVP

**Goal:** Establish robust core with data integrity

**Features:**
1. Enhanced School entity with structured fields
2. Input validation framework
3. Optimistic locking for concurrent updates
4. Referential integrity checks
5. GSI implementation for efficient queries

**Why Critical:**
- Data corruption prevention
- Foundation for all other features
- Performance baseline

**Success Metrics:**
- 0 data integrity issues
- < 100ms p99 query latency
- 100% validation coverage

---

### 🔒 Phase 2: Audit & Compliance (Week 3) - CRITICAL FOR ENTERPRISE

**Goal:** FERPA compliance and audit trail

**Features:**
1. Immutable activity logs
2. 2-year TTL enforcement
3. Data access tracking
4. Archival to S3 Glacier
5. Compliance reporting

**Why Critical:**
- Legal requirement for education sector
- Enterprise customer requirement
- Security monitoring foundation

**Success Metrics:**
- 100% of mutations logged
- 0 audit log gaps
- < 5 second log write latency

---

### 📅 Phase 3: Academic Structure (Weeks 4-5) - HIGH PRIORITY

**Goal:** Temporal boundaries and academic calendar

**Features:**
1. Academic Year with business rules
2. Grading Periods (semesters, quarters)
3. Holiday/Closure tracking
4. "Current year" enforcement
5. Year-end rollover process

**Why High Priority:**
- Core to education domain
- Enables enrollment and grading
- Required by Student Service
- Required by Academic Service

**Success Metrics:**
- Academic calendar accuracy 100%
- Successful year rollover
- 0 temporal boundary violations

---

### 🏢 Phase 4: Organizational Structure (Weeks 6-7) - MEDIUM PRIORITY

**Goal:** Department and capacity management

**Features:**
1. Enhanced Department entity
2. Department budget tracking
3. Grade Level definitions
4. Enrollment Capacity planning
5. Capacity alerts

**Why Medium Priority:**
- Needed for staff assignments
- Required for budget management
- Enables capacity planning
- Supports decision-making

**Success Metrics:**
- Real-time capacity tracking
- Budget variance < 5%
- Capacity utilization alerts working

---

### 🏫 Phase 5: Facilities (Week 8) - NICE TO HAVE

**Goal:** Campus and room management

**Features:**
1. Campus/Building entities
2. Classroom tracking
3. Facility search
4. Room attributes

**Why Nice to Have:**
- Needed for scheduling (future)
- Not MVP blocker
- Can be added later

**Success Metrics:**
- Room inventory complete
- Facility search < 200ms

---

### 🔄 Phase 6: Events & Integration (Weeks 9-10) - HIGH PRIORITY

**Goal:** Cross-service coordination

**Features:**
1. EventBridge integration
2. Domain event publishing
3. Event subscriptions
4. Denormalized data sync
5. Event replay capability

**Why High Priority:**
- Enables Student Service
- Required for Staff Service
- Real-time data accuracy
- Scalability foundation

**Success Metrics:**
- Event delivery 99.9%
- < 1 second event latency
- 0 data sync issues

---

### ⚡ Phase 7: Performance (Week 11) - MEDIUM PRIORITY

**Goal:** Production-grade performance

**Features:**
1. Redis caching layer
2. Query optimization
3. Batch operations
4. Denormalization
5. Load testing

**Why Medium Priority:**
- Needed for scale
- Reduces costs
- Improves UX

**Success Metrics:**
- 90% cache hit rate
- < 50ms p99 API latency
- Handle 1000 req/sec

---

### 📊 Phase 8: Reporting (Week 12) - NICE TO HAVE

**Goal:** Decision-making dashboards

**Features:**
1. School dashboard
2. Capacity reports
3. Budget reports
4. Compliance reports
5. Analytics APIs

**Why Nice to Have:**
- Great for sales demos
- Value-add for customers
- Not core MVP functionality

**Success Metrics:**
- 10+ dashboard metrics
- Report generation < 5 sec

---

## Resource Requirements

### Team Composition

**Minimum (12-week timeline):**
- 2 Senior Backend Engineers (NestJS/TypeScript)
- 1 DevOps Engineer (AWS CDK, ECS, DynamoDB)
- 1 QA Engineer (part-time)

**Optimal (8-week timeline):**
- 3 Senior Backend Engineers
- 1 DevOps Engineer
- 1 QA Engineer (full-time)
- 1 Product Manager

### Technology Stack

**Already in Place:**
- ✅ NestJS framework
- ✅ TypeScript
- ✅ DynamoDB
- ✅ AWS ECS (Fargate)
- ✅ AWS EventBridge
- ✅ Cognito (authentication)
- ✅ CloudWatch (logging)

**To Add:**
- ElastiCache (Redis) for caching
- S3 Glacier for archival
- AWS X-Ray for tracing (optional)
- Grafana for dashboards (optional)

### Cost Implications

**DynamoDB:**
- Basic tier (pooled): ~$50-100/month for 100 schools
- Advanced tier (dedicated): ~$500-1000/month per tenant
- Premium tier (silo): ~$1000-2000/month per tenant

**ElastiCache (Redis):**
- Single instance: ~$50/month
- Cluster: ~$200/month

**S3 Glacier (archives):**
- ~$1/TB/month (minimal cost)

**EventBridge:**
- $1 per million events (negligible for MVP)

**Total Additional Cost:** ~$100-300/month for MVP

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Data migration issues | Medium | High | Phased approach, rollback plan |
| Performance degradation | Low | Medium | Load testing, caching |
| Event delivery failures | Low | High | Dead letter queues, retry logic |
| Cache inconsistency | Medium | Medium | Event-driven invalidation, TTL |
| DynamoDB hot partitions | Low | Medium | Partition key design, auto-scaling |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Timeline overrun | Medium | Medium | Phased delivery, MVP focus |
| Compliance gaps | Low | High | Legal review, FERPA audit |
| Customer adoption | Medium | Low | Pilot program, training |
| Integration delays | Medium | Medium | API contracts, mocks |

---

## Success Criteria

### Technical KPIs

- ✅ API Latency: p99 < 100ms
- ✅ Availability: 99.9% uptime
- ✅ Data Integrity: 0 corruption incidents
- ✅ Audit Coverage: 100% of mutations logged
- ✅ Event Delivery: 99.9% success rate
- ✅ Cache Hit Rate: > 90% for hot data
- ✅ Throughput: 1000 requests/second sustained

### Business KPIs

- ✅ FERPA Compliance: 100% audit trail coverage
- ✅ Data Accuracy: 99.99% accuracy in capacity tracking
- ✅ Customer Satisfaction: > 4.5/5 rating
- ✅ Adoption Rate: > 80% of customers using new features
- ✅ Support Tickets: < 5 per 100 schools per month

---

## Recommended Next Steps

### Immediate Actions (This Week)

1. **Review & Approve Design**
   - [ ] Technical review with team
   - [ ] Security review
   - [ ] Compliance review (legal)
   - [ ] Cost approval

2. **Set Up Infrastructure**
   - [ ] Create GSI definitions in CDK
   - [ ] Set up ElastiCache (Redis)
   - [ ] Configure EventBridge
   - [ ] Set up S3 Glacier bucket

3. **Team Preparation**
   - [ ] Knowledge transfer session
   - [ ] Code walkthrough
   - [ ] Assign phase 1 tasks

### Week 1-2: Phase 1 Kickoff

1. **Code Implementation**
   - [ ] Update entity interfaces
   - [ ] Implement validation layer
   - [ ] Add optimistic locking
   - [ ] Implement GSI queries

2. **Testing**
   - [ ] Unit tests (>80% coverage)
   - [ ] Integration tests
   - [ ] Load tests

3. **Documentation**
   - [ ] API documentation (OpenAPI)
   - [ ] Runbook for operations
   - [ ] Migration guide

### Ongoing

1. **Weekly Demos**
   - Show progress to stakeholders
   - Get feedback early

2. **Bi-weekly Retrospectives**
   - Adjust timeline as needed
   - Address blockers

3. **Monthly Business Reviews**
   - KPI tracking
   - Budget review
   - Risk assessment

---

## Appendices

### A. Related Documents

- [School Service Database Design](./SCHOOL_SERVICE_DATABASE_DESIGN.md) - Full technical specification
- [School Service Technical Breakdown](./School%20Service_%20Enterprise-Grade%20Technical%20Breakdo.md) - Original requirements
- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - Architecture overview

### B. API Contract Examples

See full API documentation in [SCHOOL_SERVICE_DATABASE_DESIGN.md](./SCHOOL_SERVICE_DATABASE_DESIGN.md#api-documentation)

### C. Data Model ERD

See entity relationships in [SCHOOL_SERVICE_DATABASE_DESIGN.md](./SCHOOL_SERVICE_DATABASE_DESIGN.md#data-model-architecture)

---

## Questions for Stakeholders

1. **Timeline:** Do you prefer 12-week incremental or 8-week rewrite?
2. **MVP Scope:** Can we defer Phase 5 (Facilities) and Phase 8 (Reporting) to post-MVP?
3. **Budget:** Approved for ~$300/month additional infrastructure costs?
4. **Team:** Can we dedicate 2-3 engineers for 12 weeks?
5. **Compliance:** Do we need legal review before implementing audit logging?
6. **Migration:** Can we do phased migration or need big-bang cutover?

---

**Document Version:** 1.0
**Last Updated:** October 10, 2025
**Author:** AI Assistant for EdForge
**Status:** 🟡 Awaiting Approval

---

## Approval Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tech Lead | | | |
| Product Manager | | | |
| Engineering Manager | | | |
| Security/Compliance | | | |



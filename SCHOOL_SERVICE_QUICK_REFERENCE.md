# School Service: Quick Reference Guide

## 📋 TL;DR

**Current Status:** ✅ Basic implementation working, ⚠️ Not production-ready

**Goal:** Transform to enterprise-grade, MVP-ready service in 12 weeks

**Priority:** CRITICAL - Foundation for Student, Staff, and Academic services

---

## 🎯 Critical Decisions Made

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Data Store | ✅ DynamoDB (keep) | Multi-tenant isolation, scales well, cost-effective |
| Table Design | ✅ Single-table enhanced | Simplifies provisioning, enables transactions |
| Events | ✅ EventBridge | Essential for cross-service coordination |
| Caching | ✅ Redis/ElastiCache | Hot data, reduces DynamoDB costs |
| Audit | ✅ Full audit trail | FERPA compliance, enterprise requirement |
| Migration | ✅ Phased approach | Lower risk, continuous delivery |

---

## 🚀 Implementation Phases (12 weeks)

### Phase 1: Foundation (Weeks 1-2) 🔴 CRITICAL
- Enhanced data model with validation
- Optimistic locking
- GSI implementation
- **Blocks:** Everything else

### Phase 2: Audit & Compliance (Week 3) 🔴 CRITICAL  
- Immutable activity logs
- FERPA compliance
- Data access tracking
- **Blocks:** Enterprise sales

### Phase 3: Academic Structure (Weeks 4-5) 🟠 HIGH
- Academic years with business rules
- Grading periods
- Year rollover
- **Blocks:** Student Service, Academic Service

### Phase 4: Organizational (Weeks 6-7) 🟡 MEDIUM
- Departments
- Budgets
- Grade levels
- Enrollment capacity
- **Blocks:** Staff Service, Finance Service

### Phase 5: Facilities (Week 8) 🟢 NICE TO HAVE
- Campus/Building/Classroom
- **Blocks:** Scheduling (future)

### Phase 6: Events (Weeks 9-10) 🟠 HIGH
- EventBridge integration
- Cross-service coordination
- **Blocks:** Real-time data sync

### Phase 7: Performance (Week 11) 🟡 MEDIUM
- Caching
- Query optimization
- Load testing

### Phase 8: Reporting (Week 12) 🟢 NICE TO HAVE
- Dashboards
- Analytics

---

## 🏗️ Database Schema Quick Ref

### Entity Key Patterns

```
School:      tenantId | SCHOOL#schoolId
Dept:        tenantId | SCHOOL#schoolId#DEPT#deptId
AcadYear:    tenantId | SCHOOL#schoolId#YEAR#yearId
Period:      tenantId | SCHOOL#schoolId#YEAR#yearId#PERIOD#periodId
ActivityLog: tenantId | LOG#schoolId#timestamp#activityId
```

### Global Secondary Indexes

```
GSI1: schoolId → All entities for a school
GSI2: schoolId#academicYearId → Year-scoped queries
GSI3: tenantId#entityType → Filter by status
GSI4: schoolId#date → Activity logs (time-series)
```

---

## 🔒 Critical Business Rules

1. **One Current Year**: Only ONE `isCurrent` academic year per school
2. **School Code Unique**: Within tenant scope
3. **Temporal Boundaries**: All dates within academic year bounds
4. **Status Transitions**: Must be validated (e.g., closed → active not allowed)
5. **Capacity Limits**: Cannot exceed without override
6. **Audit Everything**: All mutations logged (FERPA)

---

## 📊 Key Metrics to Track

### Technical
- API Latency: **p99 < 100ms**
- Availability: **99.9% uptime**
- Cache Hit Rate: **> 90%**
- Throughput: **1000 req/sec**

### Business
- Audit Coverage: **100%**
- Data Accuracy: **99.99%**
- Support Tickets: **< 5 per 100 schools/month**

### Compliance
- FERPA Audit Trail: **2-year retention**
- Data Access Logs: **100% coverage**

---

## 🛠️ Tech Stack

### Current
- ✅ NestJS + TypeScript
- ✅ DynamoDB
- ✅ AWS ECS (Fargate)
- ✅ Cognito (auth)
- ✅ CloudWatch

### To Add
- 🆕 ElastiCache (Redis)
- 🆕 EventBridge
- 🆕 S3 Glacier (archives)

**Cost:** ~$100-300/month additional

---

## 📝 Domain Events

### Published (School → Others)
```typescript
SchoolCreated
SchoolUpdated
AcademicYearStarted
AcademicYearEnded
DepartmentRestructured
EnrollmentCapacityChanged
```

### Subscribed (Others → School)
```typescript
StudentEnrolled          → Update enrollment capacity
StudentWithdrew          → Update enrollment capacity
StaffAssigned           → Update dept staffing
StaffTerminated         → Update dept staffing
PaymentReceived         → Update budget
```

---

## 🎯 MVP Scope (Phases 1-4, 6)

### ✅ IN SCOPE
- Core school management
- Academic calendar
- Department structure
- Budget tracking
- Enrollment capacity
- Audit logging (FERPA)
- Event-driven integration
- Performance optimization

### ❌ OUT OF SCOPE (Post-MVP)
- Facilities management (Phase 5)
- Advanced reporting (Phase 8)
- Custom dashboards
- AI/ML features
- Mobile app
- Parent portal

---

## 👥 Team & Timeline

### Minimum Team
- 2 Senior Backend Engineers
- 1 DevOps Engineer
- 1 QA Engineer (part-time)

### Timeline
- **12 weeks** for full MVP implementation
- **8 weeks** if rewrite from scratch (higher risk)

### Recommendation
✅ **12-week phased approach** (lower risk, continuous value)

---

## ⚠️ Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Data migration issues | Phased approach, rollback plan, dry runs |
| Performance problems | Load testing early, caching strategy |
| Event delivery failures | DLQ, retry logic, idempotency |
| Timeline overrun | MVP focus, defer nice-to-have features |
| Compliance gaps | Legal review, FERPA audit checklist |

---

## 📖 Full Documentation

1. [Database Design Spec](./SCHOOL_SERVICE_DATABASE_DESIGN.md) - 200+ page technical design
2. [Implementation Roadmap](./SCHOOL_SERVICE_IMPLEMENTATION_ROADMAP.md) - Detailed plan with decisions
3. [Original Requirements](./School%20Service_%20Enterprise-Grade%20Technical%20Breakdo.md) - SABER framework

---

## 🚦 Next Actions (This Week)

### Day 1-2: Review & Approval
- [ ] Technical team review
- [ ] Security/compliance review
- [ ] Budget approval
- [ ] Timeline approval

### Day 3-4: Infrastructure Setup
- [ ] Update CDK for GSIs
- [ ] Provision ElastiCache
- [ ] Configure EventBridge
- [ ] Set up S3 Glacier

### Day 5: Phase 1 Kickoff
- [ ] Create feature branches
- [ ] Assign tasks
- [ ] Set up CI/CD
- [ ] First sprint planning

---

## 📞 Key Contacts

| Role | Responsibility | Escalation Path |
|------|---------------|-----------------|
| Tech Lead | Technical decisions | Engineering Manager |
| DevOps | Infrastructure | Cloud Architect |
| QA | Testing strategy | QA Manager |
| Product | Scope & priorities | VP Product |
| Security | Compliance | CISO |

---

## 🔗 Quick Links

- [GitHub Repo](https://github.com/your-org/edforge)
- [Jira Board](#)
- [API Docs](#)
- [Confluence](#)
- [Slack Channel](#)

---

## 📈 Success Checkpoints

### Week 2 Checkpoint
- ✅ Phase 1 complete
- ✅ All validations working
- ✅ GSIs deployed
- ✅ Unit tests > 80% coverage

### Week 3 Checkpoint
- ✅ Audit logging operational
- ✅ 100% mutation coverage
- ✅ Compliance review passed

### Week 5 Checkpoint
- ✅ Academic calendar working
- ✅ Year rollover tested
- ✅ Student Service can integrate

### Week 7 Checkpoint
- ✅ Departments fully functional
- ✅ Budget tracking working
- ✅ Capacity planning operational

### Week 10 Checkpoint
- ✅ Events publishing
- ✅ Cross-service integration tested
- ✅ Data sync verified

### Week 12 Checkpoint (MVP DONE)
- ✅ All phases 1-4, 6-7 complete
- ✅ Load testing passed
- ✅ Production deployment ready
- ✅ Documentation complete

---

## 💡 Pro Tips

1. **Start with Phase 1** - Everything depends on it
2. **Don't skip audit logging** - Enterprise blocker
3. **Events are crucial** - Required for Student Service
4. **Cache early** - Performance matters
5. **Test with real data** - Edge cases matter
6. **Monitor everything** - Observability is key
7. **Automate migrations** - Manual = errors
8. **Document decisions** - Future you will thank you

---

**Last Updated:** October 10, 2025
**Version:** 1.0
**Status:** 🟡 Awaiting Approval

---

## ❓ Have Questions?

- Technical: Check [DATABASE_DESIGN.md](./SCHOOL_SERVICE_DATABASE_DESIGN.md)
- Process: Check [IMPLEMENTATION_ROADMAP.md](./SCHOOL_SERVICE_IMPLEMENTATION_ROADMAP.md)
- Architecture: Check [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
- Slack: #edforge-school-service
- Email: tech-lead@edforge.net


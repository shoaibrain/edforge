# ADR — GSI tenant isolation is an application-level invariant

**Date:** 2026-07-02
**Status:** Accepted
**Sprint:** RBAC/ABAC epic — R2.3 (Tenant-isolation hardening)
**Decision-maker:** EdForge engineering (RBAC/ABAC epic)
**Companion:** [gsi-tenant-isolation-audit.md](../alpha-launch/gsi-tenant-isolation-audit.md) (R2.1), [rbac-abac-epic.md](../alpha-launch/rbac-abac-epic.md)

---

## 1. Context

EdForge BASIC tier stores each service's data in a single DynamoDB table
partitioned by `tenantId` (bare UUID) + `entityKey`, with 14 Global Secondary
Indexes (`gsi1pk`/`gsi1sk` … `gsi14pk`/`gsi14sk`). Tenant isolation on the **base
table** is enforced by IAM: the per-tenant ABAC role's policy carries a
`ForAllValues:StringEquals { dynamodb:LeadingKeys: ${aws:PrincipalTag/tenant} }`
condition ([`ecs-dynamodb.ts:324-334`](../../server/lib/tenant-template/ecs-dynamodb.ts#L324)).

The R2.1 audit ([`gsi-tenant-isolation-audit.md`](../alpha-launch/gsi-tenant-isolation-audit.md))
found that this IAM condition covers the base table **only** — the GSI statement
(`.../index/*`, `dynamodb:Query`) carries **no** condition — and that several GSI
partition keys are not tenant-scoped (`EMAIL#`, `TOKEN#`, `{emisSchoolCode}`,
`BLOCK#`, `prior-enrollment#`). R2.2 then found a concrete cross-tenant read:
`getStaffByEmail` resolved `EMAIL#<email>` across tenants (fixed in PR #407).

This ADR answers the R2.3 question: **can the IAM `LeadingKeys` ABAC condition
extend to index queries** — and if not, what is the enforcement model?

## 2. Options considered

### Option 1 — Enforce GSI tenant isolation via IAM `LeadingKeys`
**Rejected — not possible on AWS.** `dynamodb:LeadingKeys` constrains the
**table's** partition key. A GSI has a *different* partition-key attribute
(`gsiNpk`), so the condition cannot reference it; a GSI `Query` is authorized
without any tenant constraint. This is a hard AWS limitation, already noted in the
code: *"GSI queries cannot use LeadingKeys condition because GSIs use different
partition keys… tenant filtering for GSI queries happens at the application level"*
([`ecs-dynamodb.ts:318-320`](../../server/lib/tenant-template/ecs-dynamodb.ts#L318)).

### Option 2 — A dedicated table (or index set) per tenant
**Rejected for V1.** BASIC tier is deliberately a shared, single-table,
shared-Cognito-pool model (see epic §1). Per-tenant tables are the ADVANCED-tier
`V1_DEFERRED` path, not an isolation fix for BASIC.

### Option 3 — GSI tenant isolation as an application-level invariant  ✅ Accepted
Because IAM cannot enforce it, **every GSI read must enforce tenant scope in
application code.** See the decision below.

## 3. Decision

**GSI tenant isolation is an application-level invariant.** Every GSI `Query`
MUST satisfy exactly one of:

- **(a) Tenant-scoped key.** The `gsiNpk` or `gsiNsk` embeds `TENANT#{tenantId}`
  and the query constrains on it. *Example (safe today):* `users.service`
  email lookups query `GSI1` with `gsi1sk = TENANT#{tenantId}`
  ([`users.service.ts:110`](../../server/application/microservices/identity/src/users/users.service.ts#L110)).

- **(b) Tenant `FilterExpression`.** When the key is not tenant-scoped, the query
  adds `tenantId = :tenantId` and MUST NOT use a `Limit` that could truncate
  before the filter runs (DynamoDB applies `Limit` before `FilterExpression`).
  *Example (the R2.2 fix):* `staff.service.getStaffByEmail`
  ([`staff.service.ts`](../../server/application/microservices/identity/src/staff/staff.service.ts), PR #407).

- **(c) Sanctioned cross-tenant read for a global constraint.** A GSI read MAY
  deliberately span tenants **only** to enforce a global uniqueness/lookup
  constraint, and MUST: use `getSystemClient()` explicitly (not the tenant ABAC
  client), disclose only the minimal high-level result to the caller, and never
  return another tenant's data. *Example (sanctioned):* the `emisSchoolCode`
  (GSI8) uniqueness check throws `DUPLICATE_IEMIS_CODE` and explicitly withholds
  the conflicting tenant/school id
  ([`schools.service.ts:298-329`](../../server/application/microservices/identity/src/schools/schools.service.ts#L298)).

Anything else is a defect.

## 4. Enforcement

- The R2.1 audit enumerates every `gsiNpk` writer; it is the reference map for
  reviewing GSI reads against this invariant.
- Any PR adding or changing a GSI `Query` is reviewed against (a)/(b)/(c).
- **Follow-up (R2.2 completion):** a `DynamoDBClientService.queryGSI` wrapper /
  lint that requires either a tenant-scoped key predicate or a `tenantId` filter
  (with an explicit opt-out marker for sanctioned case (c)) would make the
  invariant mechanically enforced rather than review-enforced.

## 5. Consequences

- Tenant isolation on GSIs is a **code-discipline** property, invisible to IAM;
  the audit + review + the (planned) data-layer guard are the safety net.
- The known state after R2.1/R2.2: `users` EMAIL# lookups safe (case a); `staff`
  `getStaffByEmail` fixed (case b); `emisSchoolCode` uniqueness is a documented
  sanctioned exception (case c). UUID/hash-keyed GSIs (`TOKEN#`, `BLOCK#`,
  `prior-enrollment#`) rely on value-uniqueness — acceptable, but a `tenantId`
  filter is the belt-and-suspenders default for any *new* reader.
- The academics `TENANT#`/`tenant#` casing split (R2.1 F3) is a separate
  data-consistency issue whose fix is a key migration, tracked independently.

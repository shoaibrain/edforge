# GSI Tenant-Isolation Audit

> RBAC/ABAC epic **R2.1** ([`rbac-abac-epic.md`](./rbac-abac-epic.md), Sprint R2).
> Read-only audit — no runtime change. Feeds **R2.2** (enforce tenant-scoped GSI
> access) and **R2.3** (ADR: can IAM `LeadingKeys` extend to index queries).

## TL;DR

The single-table design exposes **14 Global Secondary Indexes** (GSI1–GSI14),
and the ECS task's DynamoDB IAM policy **does not — and by its own architecture
note cannot — apply the tenant `LeadingKeys` condition to GSI queries**. Base-table
access is tenant-isolated by IAM; **every GSI query is authorized without any
tenant condition**, so cross-tenant isolation on index reads is **100%
application-level**. That is an intentional, documented design choice, not a
regression — but it means isolation holds only as strongly as the query code that
builds each `gsi{N}pk`.

Enumerating every writer across identity/academics/finance:

- **Only GSI7** is uniformly tenant-prefixed (`TENANT#{tenantId}#EMIS#…`).
- **GSI8/9/10/13** have **no tenant segment at all** in the partition key
  (`{emisSchoolCode}`, `BLOCK#{blockId}`, `prior-enrollment#{id}`, `symbol#{symbolNumber}`).
- **GSI1/2/3** mix tenant-prefixed and non-tenant partitions on the same index.
- **GSI4/5/6/11/12** are **declared but unused** (zero writers).

**No confirmed cross-tenant leak** was found, but two surfaces (`EMAIL#` on the
identity table, `{emisSchoolCode}` on GSI8) rely on the partition value being
globally unique rather than on tenant-scoping and **must be verified to
post-filter by `tenantId`** — that verification is the core of R2.2.

## The IAM finding (the spine)

Each service (identity / academics / finance) gets its own table
(`EcsDynamoDB`, instantiated per service as `${info.name}Storage`) with this same
14-GSI schema. The tenant ABAC policy attached to the per-tenant ABAC role
([`server/lib/tenant-template/ecs-dynamodb.ts:318-343`](../../server/lib/tenant-template/ecs-dynamodb.ts)) has **two** statements:

```ts
// ARCHITECTURE NOTE: GSI queries cannot use LeadingKeys condition because GSIs
// use different partition keys (gsi1pk-gsi12pk) instead of tenantId.
// Tenant filtering for GSI queries happens at the application level.
statements: [
  // 1. Base table — tenant-isolated by IAM
  new PolicyStatement({
    actions: ['GetItem','PutItem','BatchGetItem','BatchWriteItem','UpdateItem','DeleteItem','Query'],
    resources: [this.table.tableArn],
    conditions: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['${aws:PrincipalTag/tenant}'] } },
  }),
  // 2. GSI — NO condition
  new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [`${this.table.tableArn}/index/*`],   // ← no LeadingKeys, no per-index scope
  }),
]
```

**Consequence:** the STS credentials a service assumes are scoped to its tenant on
the *base table* only. A `Query` against **any** GSI (`/index/*`) is permitted with
**no** tenant constraint. Whether tenant A's request can read tenant B's row via a
GSI depends entirely on the `gsi{N}pk` value the application supplies:

- If the value **embeds the tenantId** (`TENANT#{tenantId}#…`) and the tenantId is
  taken from the **server-verified JWT** (`context.tenantId`), a query only matches
  the caller's tenant. Safe — *by convention, not by IAM*.
- If the value is **not** tenant-scoped, the query matches **every** row across
  **all** tenants sharing that partition value. Isolation then rests on the value
  being globally unique (a UUID/hash) or on the handler **post-filtering by
  `tenantId`**.

## Per-GSI enumeration

Writer patterns resolved from every entity factory + key-builder across the three
services. "Tenant-prefixed" = the partition key's literal first segment is
`TENANT#{tenantId}`.

| GSI | Purpose | Partition-key pattern(s) | Tenant-prefixed | Isolation rests on |
|---|---|---|---|---|
| **GSI1** | school/email/misc lookup | `TENANT#{tid}#SCHOOL#{sid}` (most); `TENANT#{tid}#SEA#/#ORG#`; **`EMAIL#{email}`**, `SUBDOMAIN#{sub}`, `SCHOOL#{sid}`, `TRAINTYPE#…`, `CREDTYPE#…`, `ACADYEAR#{id}`; academics **lowercase** `tenant#{tid}#school#{sid}` | Mixed | tenant prefix **or** value-uniqueness |
| **GSI2** | student/token lookup | `TENANT#{tid}#STUDENT#{sid}`, `TENANT#{tid}#SCHOOL#{sid}`; **`TOKEN#{hash}`**, `EMAIL#{email}`, bare `{studentId}`, `term#/exam#/student#/enrollment#{id}`; lowercase `tenant#{tid}#enrollment#{id}` | Mixed | tenant prefix **or** value-uniqueness |
| **GSI3** | attendance-by-date / school | `TENANT#{tid}#SCHOOL#{sid}#DATE#{date}`, `TENANT#{tid}#SCHOOL#{sid}`; `exam#{id}`, `enrollment#{id}` | Mixed | tenant prefix **or** value-uniqueness |
| **GSI4/5/6** | — | *no writers* | — | **unused (declared, empty)** |
| **GSI7** | EMIS student lookup | `TENANT#{tid}#EMIS#{emisStudentId}` (sparse) | **YES (all)** | tenant prefix ✅ |
| **GSI8** | school-by-EMIS-code | **`{emisSchoolCode}`** (bare external code, e.g. `31012345`) | **NO** | value-uniqueness enforced only by a service-layer pre-create check |
| **GSI9** | calendar-block children | **`BLOCK#{blockId}`** (sparse) | **NO** | blockId UUID uniqueness |
| **GSI10** | enrollment carry-forward | **`prior-enrollment#{priorEnrollmentId}`** (sparse) | **NO** | UUID uniqueness |
| **GSI11/12** | dept-staff / parent-student (planned) | *no writers* | — | **unused (declared, empty)** |
| **GSI13** | external-exam symbol lookup | **`symbol#{symbolNumber}`** (sparse) | **NO** | symbol-number uniqueness (**not guaranteed globally**) |
| **GSI14** | invoice/payment by school+grade | `TENANT#{tid}#SCHOOL#{sid}#GRADE#{grade}` (sparse) | **YES** | tenant prefix ✅ |

## Findings (ranked)

**F1 — `{emisSchoolCode}` (GSI8) is a non-tenant partition guarded only by a
write-time check.** School rows set `gsi8pk = emisSchoolCode`
([`schools.service.ts:356`](../../server/application/microservices/identity/src/schools/schools.service.ts)). Cross-tenant uniqueness is enforced by a service-layer pre-create query,
**not** by the key. A race or a bug in that check, or any query that trusts a
client-supplied code, would let a GSI8 read cross tenant boundaries. **Verify the
lookup post-filters by `tenantId`** (R2.2). *Severity: medium.*

**F2 — `EMAIL#{email}` (GSI1/GSI2, identity table) can share a partition across
tenants.** BASIC uses one shared Cognito pool; a person who is a user in two
tenants has the same email → the same `EMAIL#` partition holds **both** tenants'
`User`/`Staff` rows. A by-email lookup that does not post-filter by `tenantId`
returns cross-tenant rows. **Verify every `EMAIL#` GSI query post-filters by
`tenantId`** (R2.2). *Severity: medium (pending verification).*

**F3 — Casing split on GSI1/GSI2 (data-consistency, not isolation).** academics
`exam/result/external-exam/assessment` entities write **lowercase**
`tenant#{tid}#…`, while attendance/finance/identity write **uppercase**
`TENANT#{tid}#…`. DDB keys are case-sensitive, so on one physical index these are
**different partitions** — isolation is preserved (tenantId is still present), but
a query issued in the wrong casing **silently returns nothing**. Latent query-
correctness bug. *Severity: low-medium (correctness).*

**F4 — `symbol#{symbolNumber}` (GSI13) uniqueness is not globally guaranteed.**
Unlike UUID-based non-tenant keys, an exam symbol number is a human/registry value
that could repeat across tenants or years. A GSI13 query by symbol must post-filter
by `tenantId`. *Severity: low-medium — verify.*

**F5 — Isolation-by-uniqueness keys (GSI2 `TOKEN#`, GSI9 `BLOCK#`, GSI10
`prior-enrollment#`, bare `{studentId}`/`student#`/`enrollment#`/`exam#`).** These
partition on hashes/UUIDs; cross-tenant collision is cryptographically implausible,
so isolation holds *by uniqueness*. Acceptable, but it is defense-by-accident:
document the invariant and add a post-filter as belt-and-suspenders. *Severity: low.*

**F6 — Five unused GSIs (GSI4, GSI5, GSI6, GSI11, GSI12).** Declared with zero
writers. DynamoDB caps a table at **20 GSIs**; 14 are declared, so headroom is
already thin, and each provisioned index (GSI11/12 are `readCapacity/writeCapacity
= 5`) carries cost. Reserve or remove. *Severity: low (cost/hygiene).*

## Risk assessment

No confirmed cross-tenant read was found in this static pass. The material risk is
structural: **tenant isolation on GSIs is entirely a code-discipline property**,
invisible to IAM, with **no test** currently asserting it. The two partitions that
do not reduce to UUID-uniqueness — `EMAIL#` (identity) and `{emisSchoolCode}`
(GSI8) — are the ones where a missing `tenantId` post-filter would be an actual
leak, and both should be verified before pilot.

## Recommendations (→ R2.2 / R2.3)

1. **R2.3 ADR — answer the "can `LeadingKeys` cover indexes" question: no.** The
   code already asserts it (different PK attribute). Document that GSI isolation is
   an application invariant and record the chosen enforcement (below) as the ADR.
2. **R2.2 — enforce tenant-scoped GSI access.** Add a data-layer invariant in each
   service's `queryGSI`: require the caller to pass the owning `tenantId` and
   assert the returned rows' `tenantId` matches (fail-closed), OR require the
   `gsi{N}pk` to be tenant-prefixed. Start with a **verification sweep of the
   `EMAIL#` and `{emisSchoolCode}` lookups** (F1/F2) — confirm each already filters
   by `tenantId`; add a regression test that a cross-tenant GSI read returns empty.
3. **Fix the GSI1/GSI2 casing split (F3)** — normalize academics to uppercase
   `TENANT#` (or the reverse) so a single query casing is authoritative.
4. **Reserve or remove GSI4/5/6/11/12 (F6)** to reclaim headroom under the 20-GSI
   cap and stop paying for unused provisioned capacity.

## Method

Static, read-only. GSI declarations from
[`ecs-dynamodb.ts`](../../server/lib/tenant-template/ecs-dynamodb.ts); IAM policy
from the same file (L318-343); `gsi{N}pk` writer patterns resolved from every
`*.entity.ts` factory and key-builder across
`server/application/microservices/{identity,academics,finance}/src`. No runtime or
live-table inspection — a dynamic pass (query the real GSIs cross-tenant) belongs
with the R2.2 regression test and the deferred deploy-validation.

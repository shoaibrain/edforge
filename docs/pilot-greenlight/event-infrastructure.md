# Event Infrastructure — pilot-greenlight reference

> **Purpose:** codify the existing event-emission infrastructure so that **invariant 6** ("every domain action emits an event with a registry schema") can be evaluated against current reality. Written as part of Sprint **C0.c.1**.
>
> **Stance:** the SBT EventBridge bus is the canonical domain event bus. No second bus. No new stack. The remaining gap (Zod runtime validation of payloads) is the scope of **C0.c.2 + C0.c.3**.

---

## 1. The single bus

The platform has **one** EventBridge bus per environment, owned by SBT and created in [`control-plane-stack.ts:107-108`](../../server/lib/bootstrap-template/control-plane-stack.ts#L107-L108):

```ts
this.eventManager = controlPlane.eventManager;
this.eventBusName = controlPlane.eventManager.busName;
```

It is exported as the CloudFormation output `SbtEventBusName` (see [`control-plane-stack.ts:190-194`](../../server/lib/bootstrap-template/control-plane-stack.ts#L190-L194)).

**Per-tenant partitioning is achieved by event attributes, not by bus.** Every event payload carries a `tenantId` field via the `BaseDomainEvent` interface. EventBridge rules and downstream consumers filter on `detail.tenantId`. Creating one bus per tenant would be over-engineering for V1's scale.

## 2. The publisher: `EventServiceBase`

The abstract NestJS service [`server/application/libs/events/src/event-service.base.ts`](../../server/application/libs/events/src/event-service.base.ts) is what every microservice extends to publish domain events:

```
EventServiceBase (libs/events)
├── IdentityEventsService          (microservices/identity)
├── AcademicsEventsService         (microservices/academics)
├── FinanceEventsService           (microservices/finance)
└── IdentityAnalyticsEventsService (microservices/identity — analytics-specific)
```

Each concrete subclass declares an `eventSource` (e.g. `edforge.identity`) and exposes one method per event type (`publishSchoolCreated`, `publishStaffTrainingCreated`, etc.). The base class:

- Reads `EVENT_BUS_NAME` from env on construction; **fails fast** if absent.
- Constructs an `EventBridgeClient` with `maxAttempts: 3, retryMode: 'adaptive'`.
- `publishEvent(event)` — single-event publish; wraps `PutEventsCommand`; calls `handleEventPublishingFailure` on `FailedEntryCount > 0`.
- `publishEvents(events[])` — batched; chunks at 10 per command (EventBridge's hard limit); on a batch send() throw, falls back to per-event publish.
- **Never throws** on EventBridge failure — events are best-effort delivery so a downstream failure doesn't break the main write path.

`EVENT_BUS_NAME` is threaded into every ECS task via [`service-info.txt`](../../server/service-info.txt) → CDK → ECS task env, with the value resolved at deploy time from the SBT bus output.

The contract is locked by the C0.c.1 spec at [`server/application/libs/events/src/event-service.base.spec.ts`](../../server/application/libs/events/src/event-service.base.spec.ts).

## 3. Failure path: DLQ + retry

[`shared-infra/event-dlq-stack.ts`](../../server/lib/shared-infra/event-dlq-stack.ts) creates:

- An SQS DLQ (`EventBridgeDLQ`) for failed events.
- A final DLQ (`EventBridgeFinalDLQ`) for retries that also fail.
- A retry Lambda that pulls from the DLQ and re-publishes to EventBridge.
- IAM grants for EventBridge → SQS and Lambda → EventBridge.

The DLQ is wired against the SBT bus name (`props.eventBusName`).

## 4. Currently-flowing events (as of 2026-05-15)

These event types are already published in prod and observed (per `IdentityEventsService` + memory):

| Domain | Events |
|---|---|
| Schools | `SchoolCreated`, `SchoolUpdated`, `SchoolDeleted`, `SchoolRoleChanged` |
| Users | `UserCreated`, `UserUpdated`, `UserDeleted`, `GlobalRoleChanged`, `RoleAssigned`, `RoleRevoked` |
| Workspace | `WorkspaceSettingsUpdated` |
| Org hierarchy | `SEACreated`, `SEAUpdated`, `LEACreated`, `LEAUpdated`, `LEADeleted`, `ESCCreated`, `ESCUpdated`, `ESCDeleted`, `NetworkCreated`, `NetworkUpdated` |
| Staff training | `staff.training.created`, `staff.training.edited`, `staff.training.deleted` (Sprint B, IEMIS) |
| Auth | `LoginSuccess` (Cognito post-auth trigger; emits to the same SBT bus) |

There are ~40+ event types live. The C0.c.2 taxonomy will land Zod schemas for the **22 events explicitly listed in the sprint plan** (school + AY + term + enrollment + attendance + exam + result + reporting + calendar). Other event types stay loose-typed for now; we narrow them as they're touched.

## 5. The gap C0.c closes — invariant 6 compliance

Invariant 6: *"Every domain action emits an event with a registry schema."*

| Element | Status |
|---|---|
| Events emitted? | ✅ ~40+ event types flowing live in prod via `EventServiceBase` |
| TypeScript interfaces on event shapes? | ✅ defined in each `*-events.service.ts` |
| **Zod runtime schemas?** | ❌ — this is the C0.c.2 + C0.c.3 work |
| Lint rule pairing `auditedWrite()` with `publishEvent()`? | ❌ — C0.c.3 |
| Schema registry queryable? | ✅ via `packages/shared-types/src/events/` once C0.c.2 lands (the Zod taxonomy IS the registry) |
| CloudWatch metrics on bus? | ✅ EventBridge auto-emits `Invocations`, `FailedInvocations`, `MatchedEvents` per bus |
| DLQ for failed publishes? | ✅ deployed in `event-dlq-stack.ts` |

A "registry" in invariant 6 means **a single place where the canonical schema for every event lives** — not necessarily AWS EventBridge Schema Registry (a separate AWS service we don't need). The Zod taxonomy in `packages/shared-types/src/events/` will be that place. `EventServiceBase.publishEvent` will be modified (C0.c.3) to validate the payload against its schema before publishing.

## 6. What C0.c.1 is NOT

- ❌ Not a new EventBridge bus.
- ❌ Not a new CDK stack.
- ❌ Not AWS EventBridge Schema Registry (the AWS service) — duplicative with Zod schemas.
- ❌ Not a per-tenant bus or per-tenant schema partition — events carry `tenantId` in payload; rules filter on it.

This document + the `event-service.base.spec.ts` contract test together complete C0.c.1.

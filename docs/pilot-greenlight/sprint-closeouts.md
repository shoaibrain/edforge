# Pilot Greenlight — Sprint Closeouts

Per [docs/pilot-greenlight/sprint-plan.md](sprint-plan.md) §11 "Definition of Done (per sprint)", each sprint's closeout lives here. Entries are appended chronologically; the most recent sprint is at the top.

---

## Sprint C0.c — Event Emission Foundation

**Shipped:** 2026-05-16
**Goal:** EventBridge bus + schema registry + emitter integration so invariant 6 ("every domain action emits an event with a registry schema") is enforceable. Per the redirect agreed before C0.c.1, **the plan's framing was overstated** — the SBT EventBridge bus and EventServiceBase publisher already existed and were already wired into every microservice. The real gap was runtime Zod validation of event payloads. This sprint closed that gap.
**Outcome:** All three tickets shipped, plus the publish-gate follow-up. Sprint C0.e (compliance declarations) and Sprint C1 (pilot fixture engine) are unblocked.

### Tickets

| Ticket | PR | Status |
|---|---|---|
| C0.c.1 — Verify event bus infrastructure (no new stack) | [#73](https://github.com/shoaibrain/edforge/pull/73) | merged |
| C0.c.2 — Domain event taxonomy — 25 Zod schemas | [#74](https://github.com/shoaibrain/edforge/pull/74) | merged |
| Publish + consumer-pin bumps (`@aibrains/shared-types@0.43.0`) | [#75](https://github.com/shoaibrain/edforge/pull/75) | merged |
| C0.c.3 — Runtime event validation in EventServiceBase | [#76](https://github.com/shoaibrain/edforge/pull/76) | merged |

### Demo

- **C0.c.1** — Locked the EventServiceBase contract with 8 new tests (the class had zero coverage before, despite carrying every domain event in prod). Wrote [docs/pilot-greenlight/event-infrastructure.md](event-infrastructure.md) codifying that the SBT bus is canonical (no second bus, no AWS Schema Registry duplicate) and what C0.c.2 + C0.c.3 close.
- **C0.c.2** — 25 Zod schemas in `packages/shared-types/src/events/` covering the V1 universe (school 4, AY 3, term 3, enrollment 4, attendance 2, exam 3, result 1, reporting 2, calendar.block 3). `EVENT_REGISTRY` + `DomainEvent` discriminated union + `validateEvent()` helper. 56 new tests; 444/444 shared-types regression green. Snake-dotted naming (`school.created`) per the plan; existing ~110 PascalCase publishers stay loose-typed and migrate as their owners are touched.
- **C0.c.3** — `publishValidatedEvent(event: DomainEvent)` typed entry point added; `publishEvent` + `publishEvents` now run `validateBeforeEmit` per event. Three branches: registered+valid → emit, unregistered (legacy PascalCase) → log warning + emit (backward compat), registered+invalid → SKIP emit + DLQ hook. 6 new tests covering every branch × single + batch paths.

### Architecture invariants — preserved

| # | Invariant | C0.c evidence |
|---|---|---|
| 5 | Every write goes through `auditedWrite()` | unchanged; this sprint only touches event emission, not the write path |
| 6 | Every domain action emits an event with a registry schema | **closed by C0.c.2 + C0.c.3** — schemas exist, runtime validation fires for registered events, INVALID_PAYLOAD events are routed to DLQ instead of corrupting the bus |
| 7 | No silent fallbacks | the legacy PascalCase branch logs a structured warning surfacing migration debt — not silent |
| 8 | No archetype branching | event schemas are descriptor-driven; consumers route on `reportType: string` etc., not archetype |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | no descriptors added |
| 13 | No pilot-specific names in code | grep across the 13 new files in C0.c.2 + EventServiceBase changes returns zero hits |

### Backlog surfaced (NOT in scope for C0.c)

- **ESLint rule** — plan's "lint asserts every `auditedWrite()` paired with `emitEvent()`" deferred to a follow-up ticket. A proper AST-walking custom rule + tests is ~200-300 lines on its own; splitting kept C0.c.3 reviewable.
- **Deploy ladder for the new runtime validation** — code is on `main` but no microservice has deployed the new EventServiceBase yet. Activation requires identity ECR push + ECS roll (most events live here), then verify CloudWatch logs for unexpected `INVALID_PAYLOAD` entries, then academics + finance. Operator-authorized step, not engineering-blocked.
- **PascalCase → snake-dotted migration** for the ~110 existing publishers (`IdentityEventsService.publishSchoolCreated` → emit `school.created` etc.). Migrate per-domain as future sprints touch their owners (C5 exam, C7 result, C9 enrollment promotion, etc.). Each migration is a small backwards-compat-safe rename + schema-fixture-rewrite per call site.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (DONE) → C0.e (compliance declarations, can parallel C1) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

Either C0.e or C1 can start now. C0.e has policy / legal lead time; C1 is the critical-path engineering work.

---

## Sprint C0.a — Calendar-Blocking Verifications

**Shipped:** 2026-05-15
**Goal:** Verify prerequisites for calendar fidelity work are already in place. Anything not verified is fixed here.
**Outcome:** All three tickets shipped. Sprint C0.c (event emission foundation) is unblocked per the §7 dependency graph.

### Tickets

| Ticket | PR | Repo | Status |
|---|---|---|---|
| C0.a.1 — Verify S0.2 `School.academicCalendarType` removed | [shoaibrain/edforge#70](https://github.com/shoaibrain/edforge/pull/70) | server | merged |
| C0.a.2 — Verify S0.4 `calendarSystem` in `SchoolConfiguration` response | [shoaibrain/edforge#71](https://github.com/shoaibrain/edforge/pull/71) | server | merged |
| C0.a.3 — D1.4 BS converter dedupe in frontend | [shoaibrain/edforge-saas-frontend#59](https://github.com/shoaibrain/edforge-saas-frontend/pull/59) | frontend | merged |

### Demo

- **C0.a.1 + C0.a.2:** four new cross-service spec files in `server/application/microservices/identity/src/__tests__/c0-a-1-*.spec.ts` + `c0-a-2-*.spec.ts` lock the S0.2 and S0.4 response contracts at the integration level. 9 new tests, all green. Existing 63 schools-service tests still green — no regressions.
- **C0.a.3:** frontend `packages/date-utils/` no longer carries a local BS lookup table. `adToBS` / `bsToAD` / `getDaysInBSMonth` are now thin wrappers around `@aibrains/shared-types`' `gregorianToBs` / `bsToGregorian` / `getBsMonthDays`. The 49-test `converter.test.ts` suite passes byte-equal under the new implementation (including 7 round-trip dates + 9 known AD↔BS pairs + the `getDaysInBSMonth(9999, 1) === 30` silent fallback). Existing consumers (`DateDisplay`, `BSDateInput`, attendance dashboard, calendar layout, header) compile + run unchanged.

### Architecture invariants — preserved

| # | Invariant | C0.a evidence |
|---|---|---|
| 4 | Dated entities accept BS or AD on input | C0.a.3 preserves the local converter's TZ-safety via the `T12:00:00` parse trick around shared-types' canonical converter. |
| 6 | Every domain action emits an event with a registry schema | No new write paths in C0.a; nothing to emit. C0.c will introduce the registry. |
| 8 | No code branches on `tenant.archetype` | C0.a.2's test names use `'PABSON-shaped'` / `'GENERIC-shaped'` as test descriptors; code paths are identical. |
| 11 | Ed-Fi extension namespace `edforge:` is the only place new descriptors land | No descriptors added. |
| 13 | No pilot-specific names in code | Grep across the three new spec files + the frontend converter changes returns zero hits on `saraswati` / `pabson-saraswati`. Generic identifiers (`tenant-c0a1`, `school-c0a2`, etc.) throughout. |

### Backlog surfaced (NOT in scope for C0.a)

- **S0.2 storage-layer residue** — `School` TS entity, `schoolEntitySchema`, `createSchool` write path, `CONFIG_LOCKED_FIELDS`, `field-governance.ts`, AdminWeb workspace-settings field-lock map all still carry `academicCalendarType`. Stripping requires a data migration (separate ticket, P1 timing per the existing schools.service comments).
- **S0.4 read-source refactor** — `getConfiguration()` reads `calendarSystem` from `school.calendarSystem` (denormalized copy), not from `WorkspaceSettings.regional.defaultCalendarSystem` directly. Drift is prevented by provisioning convention + deprecation warning on `updateSchool`. P1 (per Midnight Lockin decision #3) will strip the school-level field; the C0.a.2 spec then becomes the regression guard for whichever read path replaces it.
- **Bundle size verification for C0.a.3** — left as a backlog item: actual production bundle size delta after Vercel rebuild has not been measured. The local 105-line table deletion is the lower-bound; tree-shaking + shared-types co-bundle in other packages may yield a smaller net delta.

### Dependency graph — next up

```
C0.a (DONE) → C0.c (event emission foundation) → C0.e (compliance declarations) → C1 (pilot fixture engine) → C2 (greenlight gate)
```

C0.c.1 (EventBridge bus + schema registry per tenant) is the immediate next ticket.

---

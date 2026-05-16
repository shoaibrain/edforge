# Pilot Greenlight — Deferred Work

Items consciously deferred from the pilot-greenlight critical path. Each entry records *why* it was deferred and *when* it should be picked up. Living document — append + cross-check before declaring any sprint "done."

---

## C0.e — Compliance Policy / Declaration

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.e](sprint-plan.md)

**Scope (from the plan):**
- **C0.e.1** Data-residency commitment doc + per-tenant assertion that the tenant's AWS region matches its declared residency.
- **C0.e.2** Consent capture on user invite — version-hashed policy URL stored alongside the consent record.

**Why deferred:**
- C0.e is "compliance policy / declaration" work — needs legal / operations sign-off on the wording before code changes are meaningful. Long-lead-time on the human side, not the engineering side.
- The plan originally scheduled C0.e to run **in parallel** with C0.a / C0.c / C1 so the legal/ops review wouldn't gate the C12 rehearsal. Since the legal/ops collaboration hasn't started, deferring keeps engineering focused on critical-path work (C1 → C2 → C9 → C12).

**Picked up when:**
- Latest meaningful trigger: **before Sprint C11** (the compliance engineering slice). C11.5 (DR drill) and C11.6 (tenant-cancellation state machine) both depend on the residency commitment being declared, and C11.2 (tenant data export) depends on consent records being captured.
- Practical trigger: as soon as legal / operations is ready to draft the residency commitment doc and the consent capture form. Could land at any time before C11 starts.

**Risk if it slips further:**
- C12 (external greenlight rehearsal) tests both flows — `C12.10` prod-shadow rehearsal validates per-tenant region assertion; tenant export tested in C12.6. If C0.e isn't done by then, those rehearsal steps would fail.
- Pilot go-live (C13) cannot proceed without a published data-residency commitment.

**Not blocking:** any of C0.a (done), C0.c (done), C1, C2, C3, C4, C5, C6, C7, C8, C9, C10.

---

## ESLint pairing rule — `auditedWrite` ↔ `publishEvent`

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.c](sprint-plan.md) — listed under C0.c.3 AC but split out

**Scope:**
- Custom ESLint rule that asserts every `auditedWrite()` call site is paired with a `publishEvent` / `publishValidatedEvent` call within the same function scope.
- Tests for the rule.

**Why deferred:**
- A proper AST-walking custom rule + tests is ~200-300 lines on its own. Splitting kept the C0.c.3 PR (runtime-validation gate) reviewable.

**Picked up when:**
- Latest meaningful trigger: **before Sprint C8** (event-log completion). C8 will reveal any auditedWrite-without-emit gaps when the read-side event log is queried. Catching them at lint time is cheaper than catching them at runtime.
- Realistic timing: any of the Sprints between C1 and C8.

**Not blocking:** any current sprint.

---

## PascalCase → snake-dotted event migration

**Deferred:** 2026-05-16
**Plan reference:** [sprint-plan.md §6 Sprint C0.c](sprint-plan.md) — implicit; not a single ticket

**Scope:**
- The ~110 existing PascalCase publishers on `IdentityEventsService` / `AcademicsEventsService` / `FinanceEventsService` (`publishSchoolCreated` emitting `SchoolCreated`, etc.) emit unregistered eventTypes per the C0.c.2 registry, falling through the legacy backward-compat branch with a warning log per emit.
- Each needs a per-domain migration: rename emitted `eventType` to snake-dotted, add a Zod schema for any not already in the registry, switch the call site to `publishValidatedEvent`.

**Why deferred:**
- Big-bang rename has zero pilot value and substantial coordination cost (downstream consumers — analytics aggregator, EventBridge rules — would need to either accept both or migrate in lockstep).
- The legacy branch is intentional — it preserves backward compat for the 40+ event types currently flowing live.

**Picked up when:**
- **Piecewise** as future sprints touch each domain's emit-site owner:
  - Sprint C5 (exam subsystem) introduces `exam.{created,closed,published}` natively from new code; no migration needed for those.
  - Sprint C9 (cross-year handoff) introduces `enrollment.{promoted,retained,withdrawn}` natively — migrate existing `StudentWithdrawn`/`StudentTransferred` opportunistically.
  - Existing `SchoolCreated` etc. migrate when their service code is otherwise modified (e.g., during a P1 rewrite touching SchoolsService).
- Catch any drift via the C0.c.3 CloudWatch warning logs: if a specific PascalCase event has high volume + clear migration target, it can be promoted to a one-off migration ticket.

**Not blocking:** any current sprint.

---

## Bundle-size verification for C0.a.3

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** Measure the actual production frontend bundle size delta after the C0.a.3 BS converter dedupe (frontend `BS_MONTH_DAYS` table deleted → import from `@aibrains/shared-types`). The local 105-line table deletion is the lower-bound; net delta depends on tree-shaking + co-bundle behavior.

**Picked up when:** opportunistic — any time the frontend bundle size is profiled (e.g., as part of a perf sprint or a Vercel-deploy-size investigation).

**Not blocking:** anything.

---

## S0.2 storage-layer residue strip

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** Strip `academicCalendarType` from:
- `School` TS entity (`server/application/microservices/identity/src/common/entities/school.entity.ts:55`)
- `schoolEntitySchema` accept-on-input (`packages/shared-types/src/schemas/identity/school.schema.ts:169,300`)
- `createSchool` DDB write path (`server/application/microservices/identity/src/schools/schools.service.ts:281,313`)
- `CONFIG_LOCKED_FIELDS` list (`schools.service.ts:1119`)
- `field-governance.ts:39`
- AdminWeb workspace-settings field-lock map

Requires a data migration for legacy DDB rows.

**Picked up when:** P1 cleanup pass on SchoolsService, OR when stripping creates value (e.g., before SchoolConfiguration schema redesign in C11).

**Not blocking:** anything in the pilot-greenlight plan.

---

## S0.4 read-source refactor — `getConfiguration().calendarSystem`

**Deferred:** 2026-05-15 (from C0.a closeout)
**Plan reference:** [sprint-closeouts.md — Sprint C0.a backlog](sprint-closeouts.md)

**Scope:** `SchoolsService.getConfiguration()` currently reads `calendarSystem` from the denormalized `school.calendarSystem` field; should read from `WorkspaceSettings.regional.defaultCalendarSystem` directly. Drift is currently prevented by provisioning convention + a deprecation warning on `updateSchool`.

**Picked up when:** P1 (per Midnight Lockin decision #3, when the school-level regional field is stripped entirely). The C0.a.2 cross-entity spec becomes the regression guard.

**Not blocking:** anything in the pilot-greenlight plan.

---

# Pilot Greenlight — Sprint Closeouts

Per [docs/pilot-greenlight/sprint-plan.md](sprint-plan.md) §11 "Definition of Done (per sprint)", each sprint's closeout lives here. Entries are appended chronologically; the most recent sprint is at the top.

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

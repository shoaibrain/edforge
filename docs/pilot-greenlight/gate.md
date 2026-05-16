# Pilot greenlight gate — C2.7

The internal greenlight verdict for a pilot is "all six smokes pass against the deployed prod-account dev tenant for that pilot." This doc explains what each smoke proves, how to re-run, and how to register a new pilot.

Owner: Shoaib · Status: live as of 2026-05-16 (end of Sprint C2)

---

## 1. What this gate covers — and what it doesn't

**Covered:**

- The calendar/operational domain: instructional days, exam windows, holidays, weekends, vacations, AY boundaries
- The fixture↔backend contract: every dossier-canonical fact about the pilot is observable via the deployed API
- The two backend write-validators that gate operator data entry: `IemisAuditLogger` audit emission (C2.0) and `DATE_NOT_INSTRUCTIONAL` attendance rejection (C2.4)

**Not covered** (deferred to later sprints):

- Cross-year handoff: provisional → confirmed enrollment flip on `resultPublishBsDate`. (Sprint C9)
- Per-period attendance + bell-schedule timing semantics. (Sprint C6)
- Result aggregation: report cards, GPA, grade rollup. (Sprint C7)
- External pilot operator rehearsal. (Sprint C12)

---

## 2. The six smokes

All scripts live in `scripts/smoke-tests/`. Each is invoked the same way:

```bash
AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/<smoke>.ts
```

Each smoke exits **0** on green, **non-zero** on red. The harness `pilot-greenlight.ts` runs all six sequentially and aggregates exit codes.

### C2.0 — `pilot-write-path.ts`

**What it proves:** a single write through the prod API path lands an audit row in DDB.

- POSTs one ephemeral staff training
- Asserts the response carries a `trainingId`
- Waits for audit propagation
- Queries DDB directly for an `AUDIT#IEMIS#…` row carrying `metadata.trainingId === trainingId`
- DELETEs the training (cleanup)

**Why this is the foundation:** it proves the auth chain (Cognito JWT → API Gateway → identity service → DDB) is intact for the operator's tenant before any read tests are meaningful. Event-emission verification is deferred to Sprint C8.4 (read-side event log).

**Env required:** `TENANT_ID`, `SCHOOL_ID`, `STAFF_ID`, fresh JWT at `/private/tmp/c0-c-3-prod-jwt.txt`.

### C2.1 — `pilot-greenlight-c2-1.ts`

**What it proves:** the backend's count of instructional days matches the pilot dossier's count for every term in the AY.

- For each of the 4 terms, expands the BS date range and counts `isInstructionalDay=true` via the fixture's `instructionalDaysInRange()` helper
- HTTP `GET /schools/:id/calendar-dates?isInstructionalDay=true&startDate=&endDate=` and counts the items
- Asserts: fixture count === backend count

**Divergence diagnostic:** prints the symmetric difference (fixture-only-non-instructional + backend-only-non-instructional) when counts diverge. The operator decides whether to update the fixture or re-seed the backend.

**Env required:** `TENANT_ID`, `SCHOOL_ID`, `ACADEMIC_YEAR_ID`.

### C2.2 — `pilot-greenlight-c2-2.ts`

**What it proves:** the backend classifies dates the same way the dossier does.

- Walks every BS date in the AY, classifies via the fixture's `shiftProfileForDate` (5-way: `regular | exam_day | holiday | weekend | vacation`)
- Buckets into `regular`, `exam_day`, and `off`
- Picks N (default 10) per bucket → 30 deterministic samples
- For each: `GET /schools/:id/shift-profile?date=<AD>` and asserts `backend.classification === fixture.classification`

**Requires:** PR-A `/shift-profile` endpoint deployed to identity.

**Env required:** `TENANT_ID`, `SCHOOL_ID`, `ACADEMIC_YEAR_ID`.

### C2.3 — `pilot-greenlight-c2-3.ts`

**What it proves:** the backend's `exam_window` events match the fixture's term-level exam windows, both in containment (every day in the window has the event) and in non-leakage (no other dates carry the event).

- For each of the 4 terminal-exam windows in `academic-structure.json`:
  - Walks every AD date in the window, asserts an `exam_window` event is present
  - Asserts all `sourceTermId`s within a window are identical (no cross-term leakage)
- For each window: samples dates *outside* and asserts no `exam_window` event

**Env required:** `TENANT_ID`, `SCHOOL_ID`, `ACADEMIC_YEAR_ID`.

### C2.4 — `pilot-greenlight-c2-4.ts`

**What it proves:** the backend rejects attendance writes on non-instructional days with a structured error a UI can switch on.

- Samples 3 holidays + 3 weekends + 2 vacations from the fixture
- For each: `POST /academics/attendance` with `status=present`
- Asserts HTTP 400 + `errorCode === 'DATE_NOT_INSTRUCTIONAL'` + `details.reason` matches fixture classification (holiday/weekend/vacation)

Pure rejection test — no data is written, no cleanup needed.

**Requires:** PR-B `DATE_NOT_INSTRUCTIONAL` deployed to academics.

**Env required:** `TENANT_ID`, `SCHOOL_ID`, `STUDENT_ID`.

### C2.5 — `pilot-greenlight-c2-5.ts`

**What it proves:** boundary behavior at AY edges + mid-block dates.

Six edge cases:
1. AY boundary (first day of AY) — expects 200 with the dossier-canonical classification
2. Next-AY day-1 (cross-year `provisionalWindow.startBsDate`) — expects 404 (no CalendarDate row exists outside current AY)
3. Next-AY result-publish day — expects 404
4. Next-AY new-session-begin day — expects 404
5. Mid-vacation day (midpoint of the longest `school_specific` block) — expects `vacation`
6. Day after a multi-day school-specific program (e.g., day after Saraswati Puja) — expects fixture's classification for that day

**Why these specifically:** they probe the silent-failure modes (off-by-one fences, "calendar not generated" UI states, classification bleed between adjacent dates) that bulk-coverage tests can't catch.

**Env required:** `TENANT_ID`, `SCHOOL_ID`.

---

## 3. The harness — `pilot-greenlight.ts`

Runs C2.0 + C2.1-C2.5 as subprocesses with a unified verdict. Skips steps whose required env vars are missing (rather than failing) — convenient for partial runs during incremental hardening.

```bash
export PILOT_ID=pabson-saraswati-bs-2083
export TENANT_ID=<...>
export SCHOOL_ID=<...>
export ACADEMIC_YEAR_ID=<...>
export STAFF_ID=<...>
export STUDENT_ID=<...>

AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/pilot-greenlight.ts
```

If `PILOT_ID` is unset, the harness reads `listPilots()` from `@edforge/pilot-fixtures` and runs the suite for every registered pilot. Today that's just `pabson-saraswati-bs-2083`; the moment a second pilot is registered, it runs twice with no harness change.

Verdict exit codes:
- `0` — all smokes pass for all pilots → internal greenlight ✅
- `1` — at least one smoke failed → not green
- `2` — environment / prerequisites missing

---

## 4. Pre-flight checklist (operator)

Before running the harness against `dev-pabson-primary`:

- [ ] Fresh prod TenantAdmin JWT at `/private/tmp/c0-c-3-prod-jwt.txt` (~1h lifetime; refresh if stale)
- [ ] Both deploy gates landed:
  - PR-A (`/shift-profile`) — identity ECR + ECS roll done
  - PR-B (`DATE_NOT_INSTRUCTIONAL`) — academics ECR + ECS roll done
- [ ] Dev tenant's AY 2083 calendar generated with the pilot fixture's holidays. Run [scripts/pilot-greenlight/seed-pilot-calendar.ts](../../scripts/pilot-greenlight/seed-pilot-calendar.ts) if the C2.1 divergence diagnostic shows fixture-vs-backend disagreement.
- [ ] At least one real `STAFF_ID` and one real `STUDENT_ID` in the dev tenant (smokes need these)

---

## 5. Registering a new pilot

The plan calls this "pilot 2 lands by dropping fixture data" — here's the recipe.

1. **Create the fixture directory:** `packages/pilot-fixtures/pilots/<new-pilot-id>/`
2. **Fill the six required files** (validate against schemas in `packages/pilot-fixtures/src/schema/`):
   - `metadata.json` — archetype, country, calendar system, school days, grade levels
   - `bell-schedule.json` — shift profile + exam-day variant
   - `academic-structure.json` — AY range + 4 terms with exam windows + cross-year markers
   - `holidays-consolidated.json` — block + single-day holidays for the AY
   - `programs.json` — school-specific events
   - `calendar/{baisakh..chait}.json` — 12 monthly per-day calendar views
3. **Update the registry:** add the new `pilotId` to whatever `listPilots()` discovers (currently fs-glob — no manual registry update needed for new directories).
4. **Re-run the spec suite locally:** `npx jest packages/pilot-fixtures` — covers every fixture against schemas + cross-references.
5. **Provision a new dev tenant** named `dev-<new-pilot>-primary` via the prod tenant-provisioning flow.
6. **Run the seed script** to populate the new tenant's calendar with the new fixture's holidays.
7. **Run the harness** with `PILOT_ID=<new-pilot-id>` + the new tenant's env vars.

If the harness exits 0, the new pilot is internally greenlit. Proceed to Sprint C3 (hardening) and Sprint C12 (external rehearsal) for that pilot.

---

## 6. When a smoke fails

The plan's [§5 rollback / abort](c2-execution-plan.md#5-rollback--abort) is canonical. Summary:

| Failure mode | Action |
| --- | --- |
| Smoke reveals a fixture bug | Patch the fixture (small PR to `pilots/<id>/<file>.json`) |
| Smoke reveals a backend bug | Separate backend PR; greenlight verdict deferred until fix re-greens |
| Smoke runs against stale calendar | Re-run [seed-pilot-calendar.ts](../../scripts/pilot-greenlight/seed-pilot-calendar.ts) and retry |
| C2.0 audit query times out | Bump `AUDIT_DELAY_MS` env var; if persistent, identity logs hold the diagnostic |
| Cross-cutting infra issue (auth, network) | Pause + investigate; do NOT silently relax assertions |

---

## 7. Related docs

- [c2-execution-plan.md](c2-execution-plan.md) — the 9-PR plan for getting here
- [sprint-plan.md](sprint-plan.md) — the 14-sprint roadmap end-to-end
- [c0-c-3-deploy-plan.md](c0-c-3-deploy-plan.md) — deploy ladder for backend rolls (canonical)
- [deferred-work.md](deferred-work.md) — items punted from C0/C1 that don't block greenlight
- `packages/pilot-fixtures/README.md` — the fixture workspace's own API reference

# Attendance Domain — Frontend (MFE) Sprint Plan

> **Status:** v1 (post-review) · **Repo:** `edforge-saas-frontend` (academics MFE +
> shell MFE) · **Companion to:** [`attendance-domain-epic.md`](attendance-domain-epic.md)
> (backend/contract epic) and the 5-story Frontend Implementation Guide.
>
> **Baseline:** PR #193 shipped the realigned read/aggregate/export surfaces. This plan
> covers the **remaining** frontend work to satisfy the 5 user stories and iterate the
> design behind a wireframe-review gate. Every ticket is atomic + committable with a test
> or a named validation; every sprint is demoable on Vercel Preview on top of the prior.
>
> **Reviewed:** drafted, then adversarially reviewed by a subagent against the original
> ask (atomic/tested tickets, demoable sprints, exhaustive/technical) — see §6 review log
> for the deltas applied (8/10 → folded all accepted findings).

---

## 0. Grounded current state (post #193 + backend #328 — both live in prod)

These are **verified** contracts, not the implementation guide's illustrative paths
(`POST /sections/{id}/attendance`, `PATCH /schools/{id}/attendance-policy` do **not** exist).

### Live backend contracts

| Concern | Real endpoint | Notes |
|---|---|---|
| Record (bulk, per-section) | `POST /academics/section-attendance/bulk` | `{sectionId, schoolId, date, records:[{studentId,status,notes?,excuseReason?}]}`; **max 500 records** |
| Record correction | `PATCH /academics/section-attendance/:date/:sectionId/:studentId?schoolId=` | single-record edit |
| Section roster | `GET /academics/sections/:sectionId/students?schoolId=` | populates the grid |
| Policy READ | `GET /academics/attendance/policy?schoolId=` | → `{effectiveMode:'daily_presence'\|'per_section_granular', modeSource, countingPolicy, countingSource, archetype}` |
| **Policy WRITE** | `PATCH /schools/:schoolId/configuration` (**identity service**, route literal `$schoolId`) | `attendancePolicy` field; **`@RequireGlobalRole('TenantAdmin')`** (`schools.controller.ts:168`); **no threshold field** |
| Presence-locks READ | `GET /academics/attendance/presence-locks?schoolId=&date=` | → `{locks:[{studentId,lockedBySectionId,lockedBySectionName,status}]}`; **advisory — never write-enforced (backend does not 403 an override)** |
| IEMiS export | `POST /academics/attendance/iemis-export?schoolId=&yearMonth=&academicYearId=` | returns rows (no presigned file) |
| Summary / overview / trend / alerts / student-trends | `GET /academics/attendance/{summary,overview,trend,alerts,student-trends}` | dashboard reads |

- **Status enum** (`attendance.schema.ts:19-28`): `present | absent | tardy | excused | late | early_departure | half_day | remote`. The grid today exposes `present/absent/late/excused/remote` and **defaults rows to `null` (unmarked)**, not Present (`AttendanceGrid.tsx:204`). `half_day`/`early_departure` are in the enum but **not** grid buttons.
- **Threshold** `granularPresenceThresholdPct` exists in `AttendanceCountingPolicy` (`common-policies.ts:69`) but is **archetype-default only (50%)** — absent from `updateSchoolConfigSchema` (`department.schema.ts:118-138`), with no per-school persistence/read path.

### Story-by-story verdict (what #193 left)

| Story | Verdict | Remaining frontend work |
|---|---|---|
| **1 — Teacher records daily attendance** | SHIPPED (grid + bulk-save + toast + offline) | **Absentee-first UX** (grid defaults to *unmarked*, guide wants default-**Present**); **edit** the existing success toast to show present/absent/excused breakdown; reconcile status labels (`late` vs "Tardy") |
| **2 — Cross-section presence lock** | PARTIAL (locks fetched + shown, rows **fully read-only** `AttendanceRow.tsx:194-201`) | Tardy/Excused must stay editable, only Present↔Absent disabled; "recorded in {section}" affordance + menu. **Pure FE rule** (backend advisory) |
| **3 — Per-section recording (no locks)** | SHIPPED (`isDailyPresence` gates lock fetch, `index.tsx:381`) | Test-only: lock fetch is skipped under per_section_granular; grid parity |
| **4 — Admin configures attendance mode** | **NOT BUILT** | Whole settings surface: mode radio + threshold + PATCH save + live cross-MFE reflection. **Threshold has a backend prerequisite.** |
| **5 — Dashboard + IEMiS export** | SHIPPED (dashboard, coverage tile, export panel, CSV) | Student detail is a **90-day** modal (`StudentAttendanceModal.tsx`), **not monthly** and has **no trend indicator** — Story 5 says monthly + trend; principal-set alert threshold; BS month labels on export |

### Decisions the user must make (captured by ticket F1.T0, not assumed)

| # | Decision | Why it matters | Recommended default |
|---|---|---|---|
| **D-A** | Threshold persistence: build backend `granularPresenceThresholdPct` (ticket **B-F1**) **in this epic**, or defer? | Gates whether Story 4's slider is functional vs read-only | Defer B-F1; ship read-only "Archetype default: 50%" now (F1.T5a), wire slider later (F1.T5b) |
| **D-B** | Config-write authorization: keep **TenantAdmin-only**, or let school principals self-serve (backend ABAC change)? | Story 4 actor is "principal or admin"; current route is TenantAdmin-only | Keep TenantAdmin-only; show read-only panel to others. Revisit if principals must self-serve |
| **D-C** | Default-Present scope: both policy modes, or **daily_presence only**? | Story 3 requires "identical UI"; a per-mode default split violates that | Apply default-Present to **both** modes (keeps grids identical); coverage metric reinterpreted accordingly |

---

## 1. FE cross-cutting guardrails (every ticket)

1. **Route → component trace** (CLAUDE.md trap): Story 4 lands in the **shell** MFE at `/settings/organization/schools/$schoolId?tab=…` → `school-detail.tsx`. Trace URL → router → tab → render block before editing; the file header in `school-detail.tsx` is stale (says 4 tabs; the union has 5) — correct it when adding the 6th.
2. **Render-path visual smoke** on `dev:shell` (federated) for every behavior ticket — type-check + vitest do not catch wrong-component edits.
3. **Service-URL guard test** for any new/changed `*.service.ts` method (pin exact URL + params); extend `attendance-realignment-urls.test.ts`.
4. **shared-types pin discipline**: bump `@aibrains/shared-types` + `apps/academics`/`apps/shell` pins in the same PR if a new export is consumed (`^0.X.0` = `>=0.X.0 <0.(X+1).0`).
5. **Design tokens only** (`--state-*`/`--action-*`/`--text-*`); `@edforge/ui` primitives (Card, Tabs `segmented`, RadioGroup `card`, Button, Field); `sonner` toasts.
6. **ABAC gating**: `usePermission(action, resource)` in the **tab/page wrapper** (not the form component — mirror `branding.tsx:47`, not `BrandingForm`); render read-only/forbidden states otherwise.
7. **Status vocab single source**: a `attendanceStatus.ts` map (set + labels + token colors); no inline status literals (grep gate).
8. **Calendar-aware dates** (archetype trap): every operator-facing date in new surfaces uses `TenantDate`/`@edforge/date-utils` BS-aware formatting, never raw `YYYY-MM-DD` — applies to recording, settings, **and** export, not just export.

---

## 2. Sprint plan

Five small sprints. **F0** is the design/foundation gate (user requires wireframes for Stories 1 + 4 before component code). **F1** builds the one genuinely-missing surface (Story 4). **F2** refines recording UX (Stories 1/2/3). **F3** completes analytics/export (Story 5). **F4** hardens.

---

### Sprint F0 — Design gate + minimal shared foundations

**Demo:** approved wireframes/walkthroughs for Stories 1 + 4; a single status-vocab module consumed by the existing #193 surfaces with zero behavior change.

| Ticket | Work | Validation |
|---|---|---|
| **F0.T1a** | **Wireframe gate — Story 1** (recording): absentee-first, both policy modes, lock-overlay (locked + unlocked rows in one roster), saved/empty/loading states. No React. | User sign-off; every screen state enumerated |
| **F0.T1b** | **Wireframe gate — Story 4** (admin config): mode radio, threshold (functional vs read-only fallback), inherited-default badge, save/toast. No React. Independent sign-off from T1a so F1 and F2 unblock separately. | User sign-off |
| **F0.T2** | `attendanceStatus.ts` single source: canonical UI status set (consciously decide to drop `half_day`/`early_departure` or include them), labels (`late`→"Tardy" decision from T1a), severity colors via tokens, status→badge map. Refactor `AttendanceRow`/`StatusBadge`/`DailySummary` to consume it. | unit test on the map; StatusBadge snapshot per status; grep: no inline status literals |

> **Gate:** F0.T1a/T1b sign-off is a hard prerequisite for the matching feature sprint's component code (user's rule). **Cut from the draft:** a wholesale "design-language alignment pass" and a `useAttendancePolicyMode` abstraction — `isDailyPresence` is already a clean one-liner (`index.tsx:376`) and #193 already uses sonner + Card; only re-touch shipped surfaces where the approved wireframes demand a delta (scope-to-ask).

---

### Sprint F1 — Story 4: Admin configures attendance mode (the missing surface)

**Demo:** a TenantAdmin opens Settings → School → *Attendance*, sees the current mode with an "inherited from archetype" badge, switches daily_presence ↔ per_section_granular, saves (toast), and the teacher Daily-Entry tab reflects the new mode **without a refresh**.

> **Backend prerequisite (cross-repo, gates F1.T5b only):** ticket **B-F1** — persist `granularPresenceThresholdPct` on school config (schema + identity entity + `AttendancePolicyResolverService` read + gateway registration). F1.T1–T5a ship without it.

| Ticket | Work | Validation |
|---|---|---|
| **F1.T0** | **Decision capture** (D-A/D-B/D-C above): record answers in the PR/issue before component code. Zero code. | decisions written + linked from F1.T4/T5/F2.T1 |
| **F1.T1** | `updateAttendancePolicy(schoolId, {attendancePolicy})` service → `PATCH /schools/:schoolId/configuration`; typed against `updateSchoolConfigSchema`. | **service-URL guard test** (exact path + body) |
| **F1.T2** | `useUpdateAttendancePolicy()` mutation: on success invalidate `['attendance','policy',schoolId]` **and `['attendance','presence-locks',…]` and the overview/coverage keys** (lock rendering derives from mode) **and** the school-config query. | hook test: mutate → service called + **all** dependent keys invalidated |
| **F1.T3** | New `AttendancePolicyTab` in **shell**: add `'attendance'` to `SchoolTab` union + TABS in `school-detail.tsx` (`$schoolId` route); mount in the parent render block; fix stale 4-tab file header. | render-path smoke at `?tab=attendance`; tab-switch test |
| **F1.T4** | Mode selector: `RadioGroup variant='card'` (daily_presence / per_section_granular) + plain-language copy + **modeSource badge** ("Using archetype default" / "School override"). Dirty-guard (`useFormDirtyGuard`) + Save/Cancel + sonner toast. **ABAC gate in the tab wrapper** (`usePermission('configure','school')` + TenantAdmin per D-B); read-only view otherwise. Mirror `BrandingForm` shape (RHF + Zod + diff-PATCH). | vitest: radio mutual-exclusion, dirty-guard, permission gate, accurate toast copy; render-path smoke |
| **F1.T5a** | **Threshold (ships now):** read-only "Archetype default: 50%" info row when per_section_granular selected; no Slider primitive. **"Threshold preserved when hidden"** (Story 4 AC) = keep the value in RHF state while the control is unmounted in daily_presence mode. | conditional-render test; form-state-preserved-across-toggle test |
| **F1.T5b** | **(gated on B-F1)** Functional threshold: build `@edforge/ui` `Slider` primitive (token-styled `input[type=range]`, a11y label) + number input; example text ("≥50% of classes = present"); send on PATCH. | Slider unit test; a11y (label/aria); save-payload test |
| **F1.T6** | **Live-reflection proof (federated):** changing mode in the shell settings tab updates the academics teacher Daily-Entry lock behavior with no reload. **Smoke MUST run on `dev:shell` with academics loaded as a remote** (shared QueryClient singleton, `mf-shared.ts:34` + `bootstrap.tsx:7`) — it will NOT live-reflect under `dev:academics` standalone. | integration test (mock both surfaces) + **documented federated two-tab smoke** |

---

### Sprint F2 — Stories 1 + 2 + 3: recording UX (absentee-first + lock granularity)

**Demo:** teacher opens a section, everyone defaults to **Present**, marks 2 absentees + 1 excused, saves → toast "68 present, 2 absent, 1 excused"; in daily_presence a second section shows locked rows where Present↔Absent is disabled but **Tardy/Excused still work**, mixed with normal unlocked rows; a per_section_granular school shows the identical grid with no locks.

| Ticket | Work | Validation |
|---|---|---|
| **F2.T1** | **Absentee-first default** (per D-C): `AttendanceGrid` defaults roster to `present`. Decide payload (full roster vs changed-only; 70 ≪ 500 cap). Keep "All Present/All Absent/Clear All". | grid test: all-present on mount; save payload correct; quick-actions intact |
| **F2.T2** | **Edit the existing success toast** (`useAttendance.ts` bulk-save handler) to "✓ recorded for N students (X present, Y absent, Z excused)". | mutation-success test asserts computed counts |
| **F2.T3** | **Status vocab in grid** from F0.T2: Present / Absent / Excused / Tardy (+ Remote where applicable); reason dropdown unchanged. | row test: canonical labels |
| **F2.T4** | **Story 2 lock granularity**: locked rows allow Tardy + Excused, disable Present↔Absent (pure FE; backend advisory). Click locked row → menu (Tardy / Excused / "recorded in {section}"); tooltip copy "recorded in" not "locked by"; keyboard guard respects partial-lock. | row tests: Present/Absent disabled + Tardy/Excused enabled; tooltip copy; **mixed locked+unlocked roster** test |
| **F2.T5** | **Story 3 regression (test-only, zero feature code)**: `usePresenceLocks` not fetched under per_section_granular; grid parity snapshot. | regression test |
| **F2.T6** | Offline/dirty interplay: absentee-first default must NOT mark form dirty until a real edit; offline persist still captures full roster. | offline test: clean-on-mount, dirty-on-edit, persistLocally payload |

---

### Sprint F3 — Story 5: dashboard summary, student detail, IEMiS export

**Demo:** principal sees coverage + rate + low-attendance list (threshold they set), clicks a student → present/absent/excused + rate + trend, opens IEMiS Export, picks a BS month, previews, downloads CSV.

| Ticket | Work | Validation |
|---|---|---|
| **F3.T1** | **Student detail = monthly + trend.** `StudentAttendanceModal` exists but is a 90-day heatmap with no trend indicator. Decide 90-day vs monthly (Story 5 says monthly); add a present/absent/excused-days + rate (X/total school days) summary; wire a trend indicator from the existing `StudentAttendanceTrend` source (`academics.service.ts:1875`). | vitest: counts + rate from fixture; trend renders; opens from alert row |
| **F3.T2** | **Principal-set low-attendance threshold**: control wiring the existing `getAttendanceAlerts(threshold)` param; persist per-session (or school setting if backend adds one). | test: changing threshold refetches alerts with new param |
| **F3.T3** | **IEMiS export polish**: month picker shows **BS labels** (`@aibrains/shared-types` BS converter), validates YYYY-MM, preview columns (name/id/grade/present/absent/excused/total), CSV `IEMiS_<BSmonth>_<year>.csv`. | export-panel test: validation, columns, CSV name/content |
| **F3.T4** | **Coverage vs rate clarity**: tooltips/copy distinguish coverage% (recorded÷enrolled) from attendance rate; "Not taken yet" vs "0%" explicit. | both-states snapshot; token check |
| **F3.T5** | Empty/loading/error states for all Story-5 surfaces (no current AY, no records, 0-row export, export failure). | state tests per surface |

---

### Sprint F4 — Hardening: a11y, responsive, error resilience

**Demo:** full keyboard pass on the roll-call grid + settings; mobile layout for recording; graceful failures (offline retry, export error, permission-denied, 409 on policy save).

| Ticket | Work | Validation |
|---|---|---|
| **F4.T1** | a11y: roll-call grid keyboard model (status shortcuts, arrow nav, locked-row focus), settings radio/slider labels, table semantics, status-pill contrast. | `axe` clean; manual keyboard pass |
| **F4.T2** | Responsive: recording grid stacks <768px (no horizontal scroll, no clipped headers — guide constraint); settings panel reflows. | viewport snapshots; device check |
| **F4.T3** | Error resilience: offline save retry surfaced; export-failure toast; policy-save 409 handling; permission-denied read-only views. | test per failure path |
| **F4.T4** | **Render-path smoke matrix**: every story × both policy modes confirmed on Vercel Preview; checklist attached to the PR (the gate automated tests can't cover). | documented smoke checklist |

---

## 3. Out of scope / deferred (named)

- True per-period timetable recording (multiple periods/day) — V1.5.
- Presigned-file IEMiS export (server-generated) — current export returns rows; CSV is client-side.
- Server-enforced lock rejection (backend stays advisory this epic).
- Per-school counting-policy fields beyond threshold (`excusedTreatment`, `chronicThresholdPct`) — archetype-default only.
- `AlertsTableV2` → `@edforge/ui` `DataTable` migration (epic S6.T2) — separate track; touch here only if F3 forces it.

## 4. Cross-repo backend tickets referenced

| ID | Work | Gates |
|---|---|---|
| **B-F1** | Persist + read `granularPresenceThresholdPct` per-school (schema + entity + resolver + gateway) | F1.T5b (functional threshold slider) |
| **B-F2** (only if D-B = principals self-serve) | School-scoped ABAC for `attendancePolicy` write (relax TenantAdmin-only) | F1.T4 permission model |

## 5. Risks

| Risk | Mitigation |
|---|---|
| Live-reflection under-built | F1.T2 invalidates policy **+ presence-locks + overview**; F1.T6 smoke runs federated (`dev:shell`), not standalone |
| Threshold blocked on backend | F1.T5a read-only ships now; F1.T5b gated on B-F1; no new shared-UI primitive on a deferred-backend critical path |
| Default-Present breaks Story 3 "identical UI" | D-C pins one default across both modes |
| Config write TenantAdmin-only vs "principal" | D-B surfaced; FE gates + read-only view; B-F2 only if chosen |
| Wrong-component edit in shell settings | route→component trace + render-path smoke (F1.T3) |
| Status vocab / date-format drift | F0.T2 single source + grep gate; guardrail 8 (calendar-aware dates) |
| Lock UX implies non-existent server enforcement | copy "recorded in" (ownership), no client assumption of 403 |

## 6. Review log (subagent deltas applied)

Draft scored 8/10; folded all accepted findings:
- **Corrected:** F2.T2 is an *edit* of the existing toast (not new); Story-5 student detail is a 90-day heatmap with no trend (not monthly) → reframed F3.T1; `isDailyPresence` is already clean → dropped the `useAttendancePolicyMode` abstraction + the wholesale design-alignment pass (F0.T3/T4 cut); ABAC gate lives in the page wrapper not the form; `school-detail.tsx` header is stale (5 tabs); route literal is `$schoolId`.
- **Split:** wireframe gate → F0.T1a (Story 1) + F0.T1b (Story 4) for independent sign-off; F1.T5 → T5a (read-only now) + T5b (Slider, gated).
- **Added:** F1.T0 decision-capture; F1.T2 must invalidate presence-locks + overview keys with the federated-runtime caveat; F2.T4 mixed locked/unlocked roster test; guardrail 8 (calendar-aware dates beyond export).
- **Pinned to ACs:** "threshold preserved when hidden" (F1.T5a, client form-state); 90-day-vs-monthly decision (F3.T1); default-Present scope (D-C).

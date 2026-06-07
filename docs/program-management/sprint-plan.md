# Program Management — Roadmap, Tracking & Delivery Governance

**Status:** 📋 DRAFT — parked for later. This is a *meta* sprint plan: it does not
ship product code. It defines how EdForge's product roadmap, epics, sprints, and
delivery tracking get consolidated into a single source of truth and kept honest
over time. Pick it up when we're ready to invest in the project-management /
"scrum-master" discipline (the "cowork" coworker capability).

**Owner:** TBD (see §4 — the Program Steward role).
**Created:** 2026-06-07.
**Supersedes:** nothing yet — this is additive. It will eventually *index* (not
delete) the scattered plans catalogued in the Appendix.

---

## §0 — How to use this document

Read §1 for *why* (the problem), §3 for *the target model*, §5 for *the work to
stand it up*. Everything else is reference. When we resume, the first action is
Sprint **PM.0** (inventory + taxonomy) — nothing downstream is reliable until the
single roadmap exists.

This plan deliberately proposes **index-in-place over big-bang migration**: the
~25 existing sprint plans stay where they are (they carry hard-won history); we
add a thin canonical layer on top, not a reorg that loses provenance.

---

## §1 — Problem statement (current state, grounded)

Planning artifacts are scattered across the repo with no single source of truth
and no consistent tracking. As of 2026-06-07:

- **11 theme folders** under `docs/`, **~108 markdown files**, **~25 distinct
  sprint-plan documents** (see Appendix for the full catalogue).
- **`docs/pilot-greenlight/` alone holds 47 files**, including ~20 separate
  sprint plans (`a2`, `a3`, `a4`, `c0-c-3`, `c2`, `c4-fe`, `c4-ops`, `d2`, `d3`,
  `exam-management-fe`, `result-card-ux`, `classroom-ux`, `routes-stack-split`,
  `cfn-headroom`, …) plus **three overlapping "master" views**
  ([sprint-plan.md](../pilot-greenlight/sprint-plan.md),
  [sprint-plan-update-2026-05-19.md](../pilot-greenlight/sprint-plan-update-2026-05-19.md),
  [v1-master-epic-breakdown.md](../pilot-greenlight/v1-master-epic-breakdown.md)).
- **Three more "roadmap" docs** live elsewhere
  ([operations/iemis-import-post-mortem-and-emis-roadmap.md](../operations/iemis-import-post-mortem-and-emis-roadmap.md),
  [platform-hardening/exams-edfi-gap-and-roadmap.md](../platform-hardening/exams-edfi-gap-and-roadmap.md),
  [archetype-framework/00-north-star.md](../archetype-framework/00-north-star.md)).
- **Inconsistent naming**: `SPRINT-PLAN.md` vs `sprint-plan.md` vs
  `<name>-sprint-plan.md` vs `<name>-plan.md`.
- **Inconsistent status vocabularies**: each plan invents its own
  (✅/🟡/🔲, "DONE/SHIPPED/CLOSED", "merged vs deployed" used interchangeably).
- **Deploy evidence is disconnected from plans**:
  [docs/deploys/INDEX.md](../deploys/INDEX.md) + dated summary logs are the record
  of what's *actually in production*, but nothing links an epic to its deploy
  evidence — so "merged" silently masquerades as "live."

### The concrete failure this causes

The 2026-05-19 pilot plan marks the **Exam / Result subsystems "not started."**
A 2026-06-07 end-to-end code audit found them **~95% built, tested, and CDK-wired**
(result-batch Lambda + EventBridge rule in
[tenant-template-stack.ts](../../server/lib/tenant-template/tenant-template-stack.ts)).
The plan was ~3 weeks stale and no process caught it. Symmetrically, the archetype
audit found GB1/GB2/GB3 **code-merged but prod-unverified** (smoke logs never
committed) — "done" on paper, unproven in reality. **Both directions of drift —
"built but marked not-started" and "merged but not verified" — are invisible
today.** That is the core defect this plan removes.

---

## §2 — Goals & non-goals

**Goals**
1. **One roadmap SSOT** — a single `ROADMAP.md` that answers "where are we?" across
   *every* initiative, reconciled against code + deploy evidence, never stale by
   more than one cadence cycle.
2. **One status vocabulary** — a canonical lifecycle that distinguishes
   **merged ≠ deployed ≠ verified** (the ambiguity that bit us).
3. **One backlog taxonomy** — stable IDs (Initiative → Epic → Sprint → Task) so a
   ticket can be referenced from a PR, a deploy log, and the roadmap unambiguously.
4. **A tracking cadence + a steward** — a recurring ritual (human and/or agent)
   that reconciles the roadmap against merged PRs, CI, and deploy evidence.
5. **Index, don't destroy** — existing plans keep their history; we add a canonical
   header linking each to its roadmap epic.

**Non-goals (for now — revisit in §9)**
- Migrating to an external tool (GitHub Projects / Linear / Jira). Start
  markdown-native; decide tooling in §9 once the taxonomy is stable.
- Rewriting or deleting the ~25 historical plans.
- Changing how product *decisions* are recorded — ADRs in
  [docs/decisions/](../decisions/) stay as the decision log.

---

## §3 — Target operating model

### §3.1 Single source of truth

```
docs/program-management/
  ├── sprint-plan.md          ← this document (how the system works)
  ├── ROADMAP.md              ← THE SSOT: initiatives → epics → status (build in PM.1)
  ├── STATUS-LEDGER.md        ← epic ↔ PRs ↔ deploy evidence ↔ owner (build in PM.1)
  ├── RISKS.md                ← live risk/dependency/blocker log (build in PM.4)
  └── digests/                ← weekly reconciliation digests (PM.4)
```

`ROADMAP.md` is the **only** doc allowed to assert cross-initiative status. Every
other plan defers to it.

### §3.2 Taxonomy & ID scheme

Four levels, stable IDs:

| Level | Meaning | ID form | Example |
|---|---|---|---|
| **Initiative** | Strategic theme (quarters-scale) | `INIT-<SLUG>` | `INIT-PILOT`, `INIT-IEMIS` |
| **Epic** | Shippable capability (weeks-scale) | `<INIT>-E<n>` | `INIT-IEMIS-E2` |
| **Sprint** | Time-boxed slice of an epic | `<EPIC>.S<n>` | `INIT-IEMIS-E2.S1` |
| **Task** | Leaf ticket (1–3 days) | `<SPRINT>.T<n>` | `INIT-IEMIS-E2.S1.T3` |

Proposed initiatives (folds the scatter — full mapping in Appendix):

| Initiative | Owns today | One-line scope |
|---|---|---|
| `INIT-PILOT` | `pilot-greenlight/*` | First PABSON pilot (Saraswati) → production |
| `INIT-IEMIS` | `operations/iemis-*` | CEHRD IEMIS Flash I/II compliance + submission |
| `INIT-ARCH` | `archetype-framework/*` | Archetype model + multi-archetype generalization |
| `INIT-GRADE` | `grade-level-audit/*`, `grade-level-fix/*` | Grade-level correctness (school-first ↔ canonical) |
| `INIT-HARDEN` | `platform-hardening/*` | Cross-cutting hardening + invariants |
| `INIT-INFRA` | `infrastructure-sunset/*`, `dev-tenant-system/*` | Cost, infra sunset, dev-tenant tooling |
| `INIT-OPS` | `operations/saraswati-*` | SLOs, on-call, paging, reliability |
| `INIT-PM` | `program-management/*` | This — roadmap & delivery governance |

Existing epic labels (`A2/A3/A4/C/D/E/F/G/H/I/K`, `GB0–GB4`, `GF0–GF4`, grade
`T1–T9`, `F-*` backlog) become **aliases** mapped to canonical epic IDs in the
ledger — we keep them readable, we just give them a home.

### §3.3 Canonical status vocabulary

One lifecycle, used everywhere. The **merged → deployed → verified** split is the
whole point.

| Status | Means | Evidence required |
|---|---|---|
| 📋 `BACKLOG` | Identified, not started | — |
| 🔨 `IN-PROGRESS` | Being built | branch exists |
| 👀 `IN-REVIEW` | PR open | PR link |
| ✅ `MERGED` | On `main` | merge SHA |
| 🚀 `DEPLOYED` | Running in prod | deploy log in `INDEX.md` |
| ✔️ `VERIFIED` | Proven in prod | committed smoke/evidence |
| 🅿️ `DEFERRED` | Intentionally postponed | reason + revisit-when |
| ❌ `DROPPED` | Won't do | reason |

**Rule:** an epic is not "done" until `VERIFIED`. `MERGED` is a milestone, not a
finish line. This single rule would have flagged GB1/GB2/GB3 and the Exam
subsystem.

### §3.4 The Status Ledger

`STATUS-LEDGER.md` carries one row per epic/sprint (template in §6). It is the
join between **plan**, **code**, and **prod**:

`ID | Title | Status | PRs | Deploy evidence (INDEX anchor) | Owner | Last reconciled`

### §3.5 Doc layout & naming conventions

- New plans: `docs/<initiative-slug>/<epic-id>-sprint-plan.md` (lowercase).
- Completed plans: move to `docs/_archive/<initiative>/…` with a closeout stamp
  (PM.5), leaving a one-line tombstone + roadmap link in place.
- Every plan gets the standard **canonical header** (§6) linking up to its epic.

---

## §4 — The Program Steward role (the "cowork" capability)

A standing role — human, agent, or human+agent — that **owns the SSOT and keeps it
honest.** This is the scrum-master / delivery-manager function the project is
missing.

**Owns:** `ROADMAP.md`, `STATUS-LEDGER.md`, `RISKS.md`, the digest cadence.

**Responsibilities**
1. **Reconcile** (each cycle): scan merged PRs, CI, and `deploys/INDEX.md`; promote
   ledger statuses (`MERGED → DEPLOYED → VERIFIED`); flag any epic stale > 1 cycle.
2. **Detect drift**: surface "built but marked not-started" and "merged but
   unverified" — both directions — and open a reconciliation task.
3. **Groom**: keep the backlog ordered; maintain cross-epic dependencies + the
   critical path in `ROADMAP.md`.
4. **Risk-log**: maintain `RISKS.md` (blockers, liaison-gated items like the IEMIS
   `.xlsm` template, single-points-of-failure like solo on-call).
5. **Digest**: publish a short weekly status digest (template §6) — "shipped /
   in-flight / blocked / next" — to `digests/`.

**Inputs:** GitHub PRs & issues, CI status, `deploys/INDEX.md`, the scattered
plans. **Outputs:** updated roadmap + ledger, weekly digest, risk log, a
"recommended next" call.

**Agent fit:** this maps cleanly onto a recurring agent run — read-only
reconciliation is low-risk and high-leverage. Defer the human/agent split decision
to §9, but design the artifacts (markdown, deterministic IDs, explicit evidence
links) so an agent *can* own the reconciliation loop unattended.

---

## §5 — Sprints to stand this up

Each sprint is small (≤ a few days) and independently valuable. Order matters:
nothing works before PM.0–PM.1.

### PM.0 — Inventory & canonical taxonomy 📋
- **T1** Catalogue every planning doc (start from this doc's Appendix; verify).
- **T2** Assign each an Initiative + Epic ID; record existing-label → canonical-ID
  aliases.
- **T3** Map each existing epic to a §3.3 status, **reconciled against code**
  (not against its own stale prose).
- **Done when:** a complete inventory + ID map is committed; every doc has a home.

### PM.1 — Stand up the SSOT 📋
- **T1** Create `ROADMAP.md` (initiatives → epics → status + critical path).
- **T2** Create `STATUS-LEDGER.md` from PM.0, with PR + deploy-evidence links.
- **T3** Adopt the §3.3 vocabulary; add the legend to both files.
- **Done when:** `ROADMAP.md` answers "where are we?" for all 8 initiatives, and
  the known drifts (Exam = built; GB1/2/3 = merged-not-verified) are corrected.

### PM.2 — Index existing plans in place 📋
- **T1** Prepend the canonical header (§6) to each of the ~25 plans, linking to its
  epic in `ROADMAP.md`. No files move.
- **Done when:** every plan resolves "what is this / where does it fit / is it
  current?" in three header lines.

### PM.3 — Connect deploy evidence 📋
- **T1** Cross-link each `deploys/INDEX.md` entry to its epic in the ledger.
- **T2** Encode the `MERGED → DEPLOYED → VERIFIED` promotion rule + the evidence
  each step requires.
- **Done when:** the ledger shows a real prod state per epic, sourced from
  evidence, not assertion.

### PM.4 — Cadence & the Steward 📋
- **T1** Write the Program Steward runbook (the §4 reconciliation loop, step-by-step).
- **T2** Define cadence (proposed: weekly) + the digest template; publish digest #1.
- **T3** (optional) Script the read-only reconciliation as an agent task.
- **Done when:** the loop is documented and has run once end-to-end.

### PM.5 — Hygiene & archival 📋
- **T1** Archive `VERIFIED`/closed plans to `docs/_archive/` with closeout stamps +
  tombstones.
- **T2** Resolve the three competing pilot "master" docs into `ROADMAP.md`;
  dedupe the three stray "roadmap" docs.
- **Done when:** exactly one live roadmap; history preserved under `_archive/`.

---

## §6 — Templates (copy-paste)

**Canonical doc header** (prepend to every plan in PM.2):
```md
> **Epic:** <INIT>-E<n> "<title>" · **Status:** <📋/🔨/👀/✅/🚀/✔️/🅿️/❌>
> **Roadmap:** docs/program-management/ROADMAP.md#<anchor>
> **This doc:** <design | sprint detail | closeout> — defer cross-epic status to the roadmap.
```

**Status-ledger row:**
```md
| INIT-IEMIS-E2 | .xlsm submission engine | 🅿️ DEFERRED | — | — | TBD | 2026-06-07 (blocked: official CEHRD template) |
```

**Epic block (in ROADMAP.md):**
```md
### INIT-IEMIS-E2 — IEMIS .xlsm submission engine   🅿️ DEFERRED
- Why: CEHRD portal requires macro-bearing .xlsm; we emit CSV.
- Blocked on: official template (liaison). Critical-path for compliance value.
- Sprints: E2.S1 template-injection · E2.S2 round-trip test
- Links: plan ↗ operations/iemis-integration-platform-plan.md · evidence ↗ —
```

**Weekly digest skeleton:**
```md
# Program digest — <date>
**Shipped (→VERIFIED):** …   **In-flight:** …   **Blocked:** …   **Next:** …
**Drift caught:** …          **Risks moved:** …
```

---

## §7 — Cadence & rituals (proposed)

- **Weekly reconciliation** (Steward, ~30 min): promote statuses from evidence,
  catch drift, publish the digest.
- **On-merge hook** (lightweight): a merged PR referencing an epic ID bumps the
  ledger to `MERGED`; the weekly loop promotes it further from deploy evidence.
- **Per-deploy**: every `INDEX.md` entry cites the epic ID it advances → ledger
  promotion to `DEPLOYED`/`VERIFIED` is mechanical.
- **Backlog grooming** (as needed): re-rank, split, defer, drop — reflected in
  `ROADMAP.md`.

---

## §8 — Migration strategy

**Index-in-place, then archive on completion.** No big-bang reorg. Order:
PM.0 (catalogue) → PM.1 (SSOT) → PM.2 (headers, files stay put) → PM.3 (evidence)
→ PM.4 (cadence) → PM.5 (archive the closed, dedupe the masters). At no point do we
lose a historical plan's content; we only add a canonical layer over it.

---

## §9 — Open decisions to revisit (when we resume)

1. **Tooling**: stay markdown-native, or graduate the ledger to **GitHub Projects**
   (issues already exist) / Linear / Jira? Recommend: markdown-native through PM.4,
   re-evaluate once the taxonomy is proven.
2. **ID scheme**: adopt `INIT-…/E…/S…/T…` as proposed, or keep the lettered
   phase labels (`A/B/C…`, `GB…`) as primary? Recommend: canonical IDs primary,
   letters as aliases.
3. **Migrate vs index**: confirm index-in-place (recommended) vs. consolidating
   content into the roadmap.
4. **Cadence**: weekly (recommended) vs. on-demand.
5. **Who runs the Steward**: human, agent, or human-checkpointed agent? (The "cowork"
   question.) Recommend: agent-drafted reconciliation + human approval of status
   promotions, at least until trust is established.
6. **Scope of the roadmap**: V1-pilot only, or all initiatives incl. INFRA/OPS?
   Recommend: all — the cross-initiative view is the missing piece.

---

## §10 — Risks

- **Yet-another-doc risk**: this plan adds a folder. Mitigation: `ROADMAP.md` must
  *replace* the three master docs as the cited SSOT, not sit beside them (PM.5).
- **Reconciliation rots**: if the cadence lapses, drift returns. Mitigation: make
  the loop cheap + agent-runnable (§4).
- **Over-process**: a solo/small team doesn't need Jira ceremony. Mitigation:
  markdown + one weekly digest is the floor; scale up only if it pays for itself.

---

## Appendix — Current planning-doc inventory (2026-06-07)

`docs/`: **11 theme folders, ~108 .md, ~25 sprint plans.** Proposed initiative
mapping (PM.0 verifies + assigns epic IDs):

| Folder (count) | Notable planning docs | → Initiative |
|---|---|---|
| `pilot-greenlight/` (47) | `sprint-plan.md`, `sprint-plan-update-2026-05-19.md`, `v1-master-epic-breakdown.md`, `a2/a3/a4-sprint-plan`, `c0-c-3-deploy-plan`, `c2-execution-plan`, `c4-fe/c4-ops`, `d2/d3-sprint-plan`, `exam-management-fe`, `result-card-ux`, `classroom-ux`, `routes-stack-split`, `cfn-headroom`, `pdf-service-mfe`, `c-epic-pdf-generation-design`, `sprint-closeouts` | `INIT-PILOT` |
| `grade-level-audit/` (16) | `README`, `01`–`08` audit + `08-migration-and-fix-list` | `INIT-GRADE` |
| `infrastructure-sunset/` (10) | `02-execution-plan`, `03-sprint-plan`, `sprint-2-*`, `PROJECT-LOG` | `INIT-INFRA` |
| `dev-tenant-system/` (7) | `SPRINT-PLAN`, `baseline-provision-snapshot`, `ddb-recovery-posture` | `INIT-INFRA` |
| `deploys/` (7) | `INDEX.md` (evidence SSOT), dated deploy summaries | *(evidence → ledger)* |
| `operations/` (6) | `iemis-emis-sprint-plan`, `iemis-integration-platform-plan`, `iemis-import-post-mortem-and-emis-roadmap`, `saraswati-slos`, `saraswati-oncall`, `paging-drill` | `INIT-IEMIS` + `INIT-OPS` |
| `archetype-framework/` (5) | `00-north-star`, `backend-sprint-plan`, `gb2-seeding-design`, `execution-and-orchestration` | `INIT-ARCH` |
| `decisions/` (4) | ADRs (`sprint4-*`, `staff-training-entity-design`, `region-aware-forms-divergence`) | *(ADR log — stays)* |
| `platform-hardening/` (2) | `sprint-plan`, `exams-edfi-gap-and-roadmap` | `INIT-HARDEN` |
| `pilots/` (2) | pilot fixtures/notes | `INIT-PILOT` |
| `grade-level-fix/` (2) | `SPRINT-PLAN`, `backlog/F-PERF-1` | `INIT-GRADE` |

**Three overlapping "master/roadmap" docs to resolve into one `ROADMAP.md` (PM.5):**
`pilot-greenlight/v1-master-epic-breakdown.md`,
`pilot-greenlight/sprint-plan.md` (§0.5 snapshot),
`pilot-greenlight/sprint-plan-update-2026-05-19.md` — plus the stray roadmaps in
`operations/` and `platform-hardening/`.

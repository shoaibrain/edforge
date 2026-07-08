# Execution & Orchestration — Governance-Body Archetype Framework

> **Status:** proposed (2026-06-03). The *roadmap + operating manual* for the
> sprint plans in this directory. Read after [`00-north-star.md`](./00-north-star.md),
> [`backend-sprint-plan.md`](./backend-sprint-plan.md), and the frontend plan.
>
> The sprint plans decompose the work **logically** (GB0→GB4, GF0→GF5). This doc
> sequences it **by customer value** and tells you how to run it across two repos
> with agents — without falling into the analysis-paralysis trap of building the
> extensibility machinery before a second governance body exists.

---

## 0. Status dashboard [updated 2026-06-05]

Legend: ✅ shipped (merged + prod-verified, evidence committed) · 🟢 merged on `main`, prod-deploy evidence NOT in-repo (reconcile w/ deploy operator) · 🟡 partial / in flight · ⬜ not started · ⏸ deferred (gated)

> **Reconciled 2026-06-05 against commit + runbook + deploy evidence** (three subagent audits: backend GB, frontend GF, curriculum). Earlier revisions of this dashboard **overstated prod status** — see the **Evidence-traceability gaps** callout below the tables. Convention: *"merged"* = verifiable in git history; *"prod-verified"* = private deploy evidence exists and a sanitized `docs/deploys/INDEX.md` note records the outcome. Where a Mac-side deploy was reported but no sanitized note exists, the row is 🟢 (not ✅).

### Archetype framework (waves)

| Item | Status | Note |
|---|---|---|
| **GF0 / GF1 — FE archetype registry + identifier resolver** | 🟡 | **Thin, not full.** Shipped + green (66 tests, `@edforge/archetype`): registry + `getArchetypeProfile` (NPL tiebreak, prototype-safe), pure `resolveIdentifier`/`serializeIdentifier`, `EntityIdDisplay`/`UuidBadge`, MF singleton (GF0.3), conformance + en/ne i18n gate (GF0.8, #112). **Open:** `useArchetypeProfile()` hook + first-paint skeleton (GF0.9) — never built; UUID→name layer `UserDisplay`/`configureIdentifierResolver`/`usePaidByUser` (GF1.3) — never built; `/dev/identifiers-demo` route — absent; `phoneFormat` profile slot (GF0.4/0.5) — absent; profiles hardcode literals instead of sourcing `resolveAddressVariant`/`phoneFormatForArchetype`; GF0.1 `region-aware-forms-divergence.md` + GF0.10 README — never written; GF0.6 CBSE/NAIS/GEMS stubs — only via degrade-to-GENERIC tests. (NB: `packages/identifier-resolver` named in the plan was folded into `@edforge/archetype`; never a separate package.) |
| **GF2 — thin-slice + cross-MFE UUID sweep** | 🟡 | **Mostly shipped, two tails open.** PABSON Student Profile EMIS (GF2.1), on-screen receipt identifiers (GF2.2, #106), academics+finance list sweep, and the `no-id-slice-in-jsx` ESLint CI rule (GF2.5) are real + wired. **Open:** GF2.3 CSV parity — `serializeIdentifier` is exported but has **zero consumers** (CSV-matches-screen unmet); GF2.4 — `apps/people` + `apps/shell` have **no** identifier-component migration (academics+finance only). |
| GB0 — governance-profile aggregator + conformance harness | ✅ | **Fully done.** GB0.0–GB0.7 merged w/ tests: `getGovernanceProfile()`, `governance-profile.conformance.spec.ts` (completeness GB0.4 + cross-checks GB0.5 + drift-guard GB0.6), `complianceRequiredDescriptors` (GB0.2b), `schoolConfigDefaults` (GB1.2b), RFC 0001. |
| GB1 — country→archetype calendar + regional cluster + country-branch lint | 🟢 | **Code merged on `main`** (GB1.1/1.2a/1.2b/1.4/1.5/1.6; GB1.3 deferred-non-premature, identical output for PABSON-in-NPL). #245 added the country-branch CI lint (`archetype-invariants.yml`). **PROD NOT VERIFIED in-repo:** the historical INDEX entry carried GB1 as **🔴 prod smoke FAILED 2026-06-04** — PABSON with omitted `calendarSystem` returned `gregorian` (a pre-existing `createSchoolSchema.default('gregorian')` masking bug GB1.1 inherited via the global ZodValidationPipe). Fix coded in 0.68.0 (`.optional()` + regression specs, #243), but no sanitized green re-smoke note exists. **Reconcile w/ deploy operator.** |
| GB2 — board-exam/curriculum/exam-pattern seeding | 🟡 | **Partial + prod-unverified.** Merged: GB2.1–2.5 (`getOrSeedBoardExams` idempotent + concurrency-safe, `GET /board-exams` seed-on-empty, archetype curriculum-ref default, `GET /exams/exam-pattern`). **Not built:** GB2.6 re-seed CloudWatch alarm, GB2.9 `seed-missing-board-exams.ts` backfill (both deferred in the runbook). **PROD NOT VERIFIED in-repo:** historical deploy prompt was an unexecuted template; no sanitized GB2 deploy summary / smoke outcome exists. The "7/7" has no public backing artifact. **Reconcile w/ deploy operator.** |
| GB3 — ethnicity/caste descriptor + import | 🟡 | **Half shipped (was ⬜ — that was WRONG).** Merged (`bf547e4`, `5196a91`): GB3.1 `EthnicityDescriptor` catalog (registered in `catalogs.ts` + `DescriptorType`), GB3.3 catalog-backed `transforms.ts` (replaced the hardcoded regex), GB3.5 `EthnicityDescriptor` in PABSON `complianceRequiredDescriptors` (now enforced by the GB0.5 conformance cross-check). **Open:** GB3.2 fixture caste coverage; **GB3.4 caste import wiring — liaison-blocked** (the IEMIS caste column header must be confirmed vs the Flash CSV schema; do not guess); GB3.6 publish; GB3.7 analytics+academics deploy + Flash I smoke. |
| GF3 — feature matrix + archetype-gated dropdowns + governance panel | ✅ | **Fully done + visual-smoked on live Saraswati.** GF3.1 `ArchetypeFeatureMatrix`, GF3.2 NPR-only workspace dropdowns (`constrainOptionsByArchetype`), GF3.3 matrix-driven `emisSchoolCode` required, GF3.4 `GovernanceProfileCard`, GF3.5 en/ne i18n — all merged, route-bound in `WorkspaceSettingsPage`, test-green. |
| GF4.1 — receipt identifiers (school No. + EMIS + "Recorded By") | ✅ | BE #238 + FE #106 merged; receipt rows + relabel live (BE-led server-side resolution — see §2.1). |
| GF4.1b / GF4.2 / GF4.3 — registry convergence, PDF e2e, a11y/perf/telemetry/Playwright | ⬜ | Not started. GF4.1b low-urgency (before Wave 4); GF4.2/4.3 hardening (no Playwright identifier spec, no `fallback_used` telemetry, no axe-core). |
| GB4 (CBS skeleton) + GF5 (CBS UI) | ⏸ | **Correctly deferred in full** — gated on a funded CBS pilot. No CBS data rows in either archetype table, no `assert-archetype-data-only.sh` gate, no "adding-a-governance-body" runbook; prod active enum stays `['PABSON','GENERIC']`. |

### Platform hardening (Sprints A–D) — companion epic

| Item | Status | Note |
|---|---|---|
| A.1 school-first / archetype framing | ✅ | `76429e1` (PR #233) |
| A.2 archetype JSDoc → governance-body | ✅ | `7bc6dae` (PR #234) |
| A.3 `schoolGradeToCanonical` in Flash I/II | ✅ | `5181100` (PR #235) |
| A.4 emisSchoolCode PABSON guard | ✅ | Verified complete: the guard ([`schools.service.ts:266`](../../server/application/microservices/identity/src/schools/schools.service.ts#L266)) is the **only** school-write path (tenant-seeder writes METADATA/SETTINGS only, never schools), so it isn't partial. Spec already covered reject/accept/GENERIC-allows/fail-open; added a normalization-pin test (lower-case `pabson` row still trips the gate, guarding the load-bearing `.toUpperCase()`). |
| A.5 defaultTimeFormat drift | ✅ | shipped in #258 (`0d0f6f1`) |
| A.7 analytics-stack deploy + Flash smoke | ⬜ | needs an analytics deploy + live Flash dry-run (Mac/AWS); A.6 publish+pins partly absorbed by `shared-types@0.65.0` |
| B GradingPolicy seed | 🟢 | **Merged** — B.2/B.3 list-path seed-on-empty + concurrency-safe conditional write (#258, `b1c4be3`/`3084be0`). Prod per relayed Mac report (#258 "grading-seed auto-heal verified"); sanitized deploy note pending. |
| C bell-schedule archetype defaults + activation gate | 🟢 | **Merged** — BE C.3/C.4 seed-at-create + tightened activation predicate w/ grandfather (#259, `c9661fa`); FE C.5 placeholder chip → one-click default mgmt + archetype-relevant templates + setup/manage modes (#110/#111). FE live via Vercel; BE prod per relayed Mac report (#259 "grandfather verified"); sanitized deploy note pending. Saraswati grandfathered. |
| D Midnight Lockin P1 (remove school-level regional fields) | ⬜ | gated on the 7-day prod deprecation-warning audit (D.0). |

### ⚠️ Evidence-traceability gaps [surfaced by the 2026-06-05 audit]

The code is on `main`; the **deploy ladder's mandated evidence is not present as sanitized in-repo status**. None of this means a deploy *didn't* happen — Mac-side deploys can produce private runbooks/logs that must stay out of git — but per the golden-shape ladder, a sprint is only "prod-verified" when private evidence exists and a sanitized `docs/deploys/INDEX.md` note records the outcome. Open items to reconcile with the deploy operator:

| Gap | Evidence | Action |
|---|---|---|
| **GB1 prod re-verification** | `INDEX.md` GB1 entry still 🔴 (smoke FAILED 2026-06-04, `gregorian` vs `bikram_sambat`); 0.68.0 fix merged but re-smoke never recorded; no sanitized green note exists | Either add a sanitized green re-smoke note to INDEX from private evidence, or run the prod re-deploy + `gb1-calendar-derivation.ts` smoke now |
| **GB2 prod deploy** | Historical deploy prompt was an unexecuted template (placeholder SHA); no sanitized summary / smoke outcome; "7/7" unbacked | Confirm whether GB2 (academics roll) shipped to prod; add a sanitized INDEX note from private evidence, or execute the deploy |
| **GB2.6 alarm + GB2.9 backfill** | not built (deferred in the runbook) | Build before declaring GB2 sprint-complete (alarm = re-seed-loop guard; backfill = upgrade already-provisioned PABSON schools) |
| **Mandated deploy summaries absent** | GB1/GB2/GB3 private evidence may exist, but sanitized public notes do not | Backfill sanitized INDEX notes from private evidence |
| **Sprint B/C sanitized notes missing** | merged + Mac-reported deployed (#258/#259), but no sanitized INDEX note | Keep raw deploy summaries/smoke logs private and add only sanitized notes |
| **5 closeout memory files** | `memory/project_governance_framework_gb{0..4}.md` all missing | Write the closeouts as each sprint's prod evidence lands |

### Archetype-resolution hardening (closes the 2026-06-04 GB2 silent-degradation class)

| Item | Status | Note |
|---|---|---|
| #253 academics task-role `dynamodb:GetItem` on identity table | ✅ | merged + prod IAM deploy — un-degrades archetype reads (smoke 7/7) |
| #254 honest-degradation contract (`getArchetype`: missing→undefined, infra→throw) + immutable cache | ✅ | merged; academics roll ships the four hardened callers |
| #255 deploy-runbook empty-diff false-clear gate | ✅ | merged — cross-service DDB read now requires a matching IAM grant in the diff |
| grading-policy (5th caller) aligned + 4-caller de-dup helper | ✅ | **#256 merged + prod-deployed 2026-06-05** — closes the last silent-degradation hole; one shared `resolveArchetypeOrDegrade` helper. Prod canary (ERROR `resolveTenantArchetype`) armed + silent; GB2 smoke 7/7 post-roll. |
| ESLint toolchain (backend gate, errors-only + ratchet warnings) | 🟡 | **#257 open** — flat config + CI `lint` workflow; the previously-documented `npm run lint` gate had no toolchain at all. 0 errors / ~813 ratchet warnings. Green + reviewed; awaiting merge. |

> **Live package versions:** `@aibrains/shared-types@0.69.0`, `@aibrains/pdf-renderer@0.9.0`.
> Keep this dashboard current as PRs merge — it's the single track record across both epics + both repos.

### Live-pilot data / correctness debt (surfaced in the GB1 prod deploy, 2026-06-04)

Not in the original GB sprints — discovered against live Saraswati/dev data. Tracked here because the orchestrator is the single cross-cutting record.

| Item | Status | Note |
|---|---|---|
| AY `calendarType` data heal (5 PABSON AYs `semester→annual`) | ✅ | Healed via `scripts/heal-pabson-academic-year-calendar-type.ts` (#247). Post-heal audit: 0 misclassified. |
| **TERM reconciliation under healed AYs** | ✅ resolved (no action) | **Investigated 2026-06-04 (read-only).** `calendarType` and TERM rows are **orthogonal**: no backend code derives terms from `calendarType`, nothing validates term-count against it, and the IEMIS/analytics Lambda never reads it (zero refs in `server/lib/analytics/**`). Terms are operator-created via `createSession`→auto-paired `GradingPeriod` (driven by `termDescriptor`); `calendarType` is a surfaced calendar-shape label only. Saraswati's `annual` year + semester-shaped terms is **correct** (Nepal annual-promotion years run multiple terminal exams). No restructure needed. **Residual (display-only, FE repo, low):** if the operator UI labels term structure from `calendarType`, glance for a cosmetic mismatch next time in `edforge-saas-frontend`. |
| AcademicYears DELETE route | ⬜ | Controller exposes POST/GET/PUT, no DELETE → smoke cleanup 403s at API GW; no operator way to scrub a planning-state AY. Three-way route registration + ECS roll. |
| Orphan AY `961ddd30…` (dev-pabson-primary) | ⬜ | Smoke artifact; parent school deleted. `calendarType` already correct. Needs T5-pattern temp `DeleteItem` policy OR the DELETE route above. |
| Heal-script `healed++` counter (CodeRabbit, #247) | ⬜ | Increments before the `await UpdateItem`; a failed write would inflate the apply summary. Fold into next file-touch: move after success + add a `failed` counter. |
| GB1 smoke proves only the explicit-config path | ⬜ | `gb1-calendar-derivation.ts:95` hardcodes `academicCalendarType:'annual'`; omitting it would exercise the country-default-derived inheritance path too. |
| Runbook + INDEX still reference UAT ladder | 🟡 | Historical repeatable app-code deploy prompt was prod-only/PR-first (+ empty-diff IAM gate, #255). Remaining: reconcile GB1 INDEX entries with sanitized private deploy evidence. |

---

## 1. Product lens — what actually ships PABSON (read this first)

The first 20 customers are all **PABSON / Nepal**. The job is to make PABSON
correct, compliant, and pleasant — *not* to perfect the abstraction. Traced
ticket-by-ticket against *"does a PABSON school need this to onboard and operate?"*:

| Work | PABSON value | When |
|---|---|---|
| **GF1–GF2** identifier display (emisStudentId, kill UUIDs) | Operators see government-correct IDs **daily**; visible compliance/trust | **Ship first** |
| **GB3** ethnicity/caste descriptor | Required for a *compliant CEHRD Flash I* | Before **first Flash I submission** (≈ end of pilot cycle), not day-1 |
| **GB2** board-exam/curriculum seeding | Removes manual setup during onboarding | Onboarding polish |
| **GB1.1** country→archetype calendar bug | PABSON tenants are all `country=NPL` today → they **already** get Bikram Sambat. Bug only bites PABSON-in-non-NPL or CBS-in-NPL — neither exists yet | Cheap insurance; **not blocking** |
| **GB0** `GovernanceProfile` *aggregator* | Needed by **zero** PABSON-shipping tickets (they call existing `getArchetypeDefaults`/`resolveArchetypeDefaults` directly) | Right-size (see §1.1) |
| **GB4 / GF5** add-CBS skeleton + extensibility proof | **Zero** value until a CBS pilot is funded | **Defer** |

### 1.1 Right-size GB0 / GF0 (avoid premature abstraction)

CLAUDE.md: *"don't design for hypothetical future requirements; three similar
lines beats a premature abstraction."* Apply it here:

- **Keep now (cheap insurance):** the **conformance *test*** — a spec asserting
  PABSON is fully wired across the *existing* tables. It earns its keep at one
  archetype as a regression fence (GB0.4/GB0.5 reduced to "assert PABSON+GENERIC
  complete," no new aggregator object required).
- **Build lazily (when a consumer wants one import):** the `GovernanceProfile`
  **aggregator object** (GB0.2/GB0.3/GB0.6). The first real consumer is GB1.2b /
  GB2; introduce the object when they land, not before.
- **Defer entirely (until CBS is funded):** GB4, GF5, and the full "prove zero
  call-site edits" machinery (GB4.3 / GF5.3). The CI script is trivial to add
  *when* CBS is real; writing CBS data now is speculative inventory.

> **Net effect:** the architecturally-elegant Sprint GB0/GF0 is **not** Sprint 0.
> The bug fix + the customer-visible identifier work + the compliance descriptor
> go first. The framework spine grows underneath as it earns its keep.

---

## 2. The value-ordered roadmap (waves, not a big-bang)

Each wave is independently shippable and demoable. Waves replace the
"do GB0 then GB1 then…" reading of the plans.

```
WAVE 1 — visible PABSON value            [highest ROI, start immediately]
  ├─ BE: GB1.1  country→archetype calendar fix     (cheap, warm-up, lands solo)
  ├─ FE: GF0-thin (registry + PABSON/GENERIC + MF singleton, NO cbs stubs/matrix)
  │       → GF1 (identifier-resolver, PR#95 S0–S2)
  │       → GF2 (thin-slice + sweep, PR#95 S3–S5)
  └─ BE: GB3   ethnicity/caste descriptor + import  (compliance, parallel to FE)
  DEMO: PABSON Student Profile shows EMIS ID; Flash I dry-run emits caste band.

WAVE 2 — onboarding polish               [reduce friction as 20 schools land]
  ├─ BE: GB2 (+GB2.9 backfill)  board-exam/curriculum seeding
  └─ FE: GF3   feature matrix + NPR-only dropdowns
  DEMO: fresh PABSON school auto-seeds board exams; currency dropdown = NPR only.

WAVE 3 — regression insurance            [as-you-go, low urgency]
  ├─ BE: GB0-thin conformance test; GB1.2/1.4/1.5 refactor + country-branch lint
  ├─ FE: GF0 conformance + i18n-coverage gate
  └─ GF4.1 receipt identifiers SHIPPED EARLY, BE-led (#238 ✓ merged+deployed;
      #106 FE ✓ merged+deployed) → remaining: GF4.1b registry convergence; GF4 hardening
  DEMO: conformance suites green in CI; on-screen and PDF identifiers agree.

WAVE 4 — GATED on a funded CBS pilot     [DO NOT START EARLY]
  ├─ BE: GB0 full aggregator object; GB4 CBS skeleton + zero-edit CI gate
  └─ FE: GF5 CBS UI profile
  DEMO: CBS dev tenant seeds contextual defaults; data-only diff proven.
```

**Trigger for Wave 4:** a signed CBS (or NGO-run) pilot on the roadmap. Until
then, the *only* CBS artifact is a one-paragraph entry in the backlog. This is
the explicit guard against analysis paralysis.

---

## 2.1 Status — receipt identifier display shipped ahead of Wave 3 (BE-led) [2026-06-04]

The customer-facing **receipt** identifier work (GF4.1 territory) shipped early,
pulled forward by the 2026-06-03 PABSON receipt review (Saraswati), not by the
wave schedule:

- **Backend — PR #238 (`edforge`), merged + deployed.** `@aibrains/pdf-renderer`
  `ReceiptPdf` renders the school roll number (primary) + `emisStudentId`
  (secondary) and never the internal `studentId` UUID; `payments.service`
  resolves both via `IdentityClient.getStudentInfo`, and the recorder UUID via a
  new `GET /users/:id/display-name`, relabeling the line "Paid By" → "Recorded
  By". Published `@aibrains/shared-types@0.65.0` + `@aibrains/pdf-renderer@0.9.0`;
  shared-infra + identity + finance + controlplane all green. **Verified in prod:**
  the PDF shows `Student No.` + `EMIS ID` + a human `Recorded By`.
- **Frontend — PR #106 (`edforge-saas-frontend`), open.** Adds the
  `studentNumber` / `emisStudentId` rows to the on-screen receipt + the label
  relabel. Additive, truthiness-gated (graceful no-op pre-backend). Gated on a
  visual smoke, then ships via Vercel on merge.

**Design note — this is BE-led, and we keep it (supersedes GF4.1's FE-pre-computed
payload).** GF4.1 originally sketched the FE pre-computing `displayIdentifiers`
from the GF0/`@edforge/archetype` registry and passing them in the PDF request.
We shipped **server-side resolution** instead, intentionally: a receipt is a
**legal/financial document**, so the *server* owns its content — for integrity
(a client can't dictate what prints on a receipt) and because V1.5 server-
initiated generation (emailed / bulk / parent-portal receipts) has no browser to
pre-compute. The §4.6 "PDF identifier payload (GF4.1)" FE→BE handshake is retired.

**Follow-up — GF4.1b (low urgency; do before Wave 4 / CBS).** The BE today
resolves the identifier *selection* (PABSON → studentNumber + EMIS) independently
of the FE `@edforge/archetype` registry — two implementations of one rule. At a
single archetype the drift risk is ~zero, but north-star's *"compose existing
tables, never duplicate / zero call-site edits to add a body"* requires **one**
source. Converge by extracting the pure, React-free core of `@edforge/archetype`
(`registry.ts` / `resolveIdentifier.ts` / `types.ts`) into a published package
(or folding the selection rules into `@aibrains/shared-types`, already a backend
consumer) so the BE receipt resolver and the FE on-screen path read the same
registry. **Acceptance:** adding a governance body edits the registry only; both
PDF and screen update with no BE PDF-generator change.

> Shared-types is now at **0.69.0** (GB1 cluster: 0.67.0 GB1.1 base → 0.68.0
> calendarSystem `.optional()` → 0.69.0 timezone/locale/academicCalendarType
> `.optional()` + AY calendarType inheritance) and pdf-renderer at **0.9.0**;
> the next `@aibrains/shared-types` bump starts from 0.69.0. Sprint A.6's
> "publish + pin-bump" is partially absorbed — A.5 (`defaultTimeFormat`) can ride
> the next publish rather than redoing pins.

---

## 3. Edge-case hardening (block PRs on these)

Found in the staff-engineer review; fold into the named tickets before they ship.

| Ticket | Edge case | Required handling |
|---|---|---|
| **GB2.2** | Board exams are grade-anchored (BLE@8, SEE@10). | Seed only exams whose `gradeLevel` ∈ the school's `enabledGradeLevels`. Don't seed SEE for a school that stops at grade 5. Add a test for a grade-5-max school. |
| **GB2.2** | Operator deletes one of four seeded exams. | Seed-on-empty checks `count === 0` only → partial sets are operator-owned, never re-seeded. Document this as intended (no "top-up" behavior). |
| **GB2.4** | Curriculum default must apply on **both** UI course-create and bulk-import paths. | Test both entry points. |
| **GB1.1 / GB1.4** | ISO-2 vs ISO-3 (`'NP'` vs `'NPL'`). | Fix + lint must catch both spellings; grep both. |
| **GB1.4** | Lint false-positives on legitimate country use (address, phone, locale-fallback tables). | Scope the rule to service **business-logic** dirs; allow-list entities/locale tables; ship with positive+negative fixtures. |
| **GB1.1** | Existing PABSON schools. | **No backfill needed** — they're `country=NPL` so already on Bikram Sambat. The fix is forward-looking. State this so nobody builds a needless migration. |
| **GB1.1** | PABSON international-stream school legitimately wanting Gregorian. | Explicit DTO override wins (already the design) — confirm the test covers it. |
| **GB0.0** | Circular import unifying the two `ActiveArchetype` symbols (`tenant.schema.ts` ↔ `tenant-locale-defaults.ts`). | Make the zod schema canonical; locale re-exports it; assert no import cycle (madge or a build check). |
| **GB3.1** | Caste long tail — 6 CEHRD bands won't cover all Nepal castes. | Robust alias map + `Other` band + **unmapped-value warning telemetry** so the liaison extends it. Import **warns, never blocks**. |
| **GB3.4** | Caste is sensitive PII. | Audit the write as PII; FE already masks (GF2.1 S3-T0). Confirm the audit event classifies it. |
| **GF0.9** | First-paint `archetype=null` flicker (default→archetype). | Skeleton state, not GENERIC fallback (already ticketed) — keep it; it's load-bearing for every migrated surface. |
| **GF1 (PR#95 S2-T7)** | N+1 user resolution on a 100-row payments table. | **Cross-repo dependency:** needs a bulk `POST /users/lookup` (backend) OR an enforced per-page fetch budget with `<UuidBadge>` fallback over budget. Decide before GF2.3 ships the finance lists. |
| **GF1 (PR#95)** | `emisStudentId` missing for new admissions / the 54 `ECD/PPC` students. | Fallback to `studentNumber` + `fallbackUsed` telemetry (already designed) — verify the telemetry tile exists so the liaison sees unregistered students. |
| **GF3** | PABSON school handling foreign-currency fees (currency locked to NPR). | `OTHER` escape hatch; acceptable to defer real multi-currency to post-V1 — document the limitation. |

---

## 4. Orchestrating two repos with agents — operating manual

Two independent git remotes (`shoaibrain/edforge`, `shoaibrain/edforge-saas-frontend`),
nested on disk but **not** a submodule. The unit of agent work is **one ticket =
one branch = one commit = one PR** — which is exactly how the plans are written,
so agents map 1:1 to tickets.

### 4.1 Roles

- **Conductor (you, or a long-running orchestrator session):** holds the
  dependency graph + the wave order, spawns ticket-agents, gates the shared-types
  publishes, merges in order. Does **not** write feature code itself.
- **Ticket-agent (one per ticket):** implements exactly one ticket on its own
  branch, writes the test from the ticket's `Validation:` line, runs local gates,
  opens a PR. Stateless beyond its ticket.
- **Review-agent (the `code-review` / `review` skill):** reviews each PR diff;
  the conductor reads its findings before merge.

### 4.2 Branch & isolation model

- Branch name: `feat/<ticket-id>-<slug>` (e.g. `feat/gb1.1-archetype-calendar`,
  `feat/gf1-identifier-resolver-s1`), based off `main` of the **correct repo**.
- Run parallel same-repo agents in **isolated git worktrees** (the Agent
  `isolation: "worktree"` option) so concurrent ticket-agents never clobber each
  other's working tree.
- **Two-repo git hygiene (non-negotiable, CLAUDE.md):** every agent's every git
  command starts with an explicit `cd <repo-root>` in the same invocation. Tell
  each agent which repo it owns in its prompt; never let one agent touch both.

### 4.3 The serialization hazard — `@aibrains/shared-types`

This is the **#1 cross-repo footgun.** Any ticket that bumps `@aibrains/shared-types`
(GB0.7, GB1.6, GB2.7, GB3.6, GB4.7) must:

1. Run **solo** — never in parallel with another shared-types bump.
2. Bump **all** consumer pins in the **same PR** (`server/application/package.json`,
   `server/package.json`, root `package-lock.json`) — npm `^0.X.0` does not pick
   up `0.(X+1).0` (CLAUDE.md caret-pin rule).
3. For anything AdminWeb consumes: pass the **jsdom bundle-sim** before the
   controlplane redeploy (zod `~3.24.4` white-screen fence).

The conductor treats every shared-types publish as a **barrier**: drain in-flight
PRs that touch shared-types, publish, bump pins, *then* release the next wave's
agents. The frontend `@edforge/archetype` package has its **own** publish cadence
and is **never** imported by AdminWeb.

### 4.4 CI gates are what make agents safe to run semi-autonomously

An agent's work is only trustworthy because a broken ticket **fails loudly**, not
silently. The guardrails (already in the plans) that gate every merge:

- conformance suites (GB0 / GF0), `module-wiring.spec.ts`, `check-route-drift.ts`,
  the country-branch lint (GB1.4), the `no-id-slice-in-jsx` AST rule (GF2.5),
  i18n-coverage (GF0.8), and the `assert-archetype-data-only.sh` gate (Wave 4).
- **No merge on red.** The conductor never overrides a failing gate to "keep moving."

### 4.5 Step-by-step per wave

```
FOR each wave:
  1. Conductor lists the wave's tickets and draws the intra-wave dependency edges
     (e.g. GF0-thin → GF1 → GF2;  GB3.1 → GB3.3/GB3.4).
  2. Spawn ticket-agents IN PARALLEL for all tickets with no unmet dependency
     (independent across repos too: a GB3 agent and a GF1 agent run concurrently).
     - Each agent prompt states: repo, branch name, the ticket text verbatim,
       its Validation line, and "run the local gates before opening the PR."
     - Same-repo parallel agents use worktree isolation.
  3. As each PR lands, run the review-agent on its diff; conductor reads findings.
  4. Merge in dependency order. A dependent ticket's agent rebases after its
     parent merges (TanStack/route traps: re-trace URL→component after rebase).
  5. If the wave includes a shared-types bump, hit the §4.3 barrier:
     drain → publish → pin-bump PR → resume.
  6. Wave demo: run the demo from the sprint plan (test suite / dev route /
     provisioned dev tenant). Capture evidence. Only then start the next wave.
  7. Watch merged PRs with subscribe_pr_activity; autofix CI per the PR-activity
     protocol; stop when MERGED.
```

### 4.6 Cross-repo dependency handshakes (the conductor's checklist)

| Handshake | Direction | Gate |
|---|---|---|
| `emisStudentId` field | shared-types → FE | **Already present** — FE identifier work (GF1) is **not** blocked on backend. |
| Bulk user lookup (`POST /users/lookup`) | BE → FE GF1 N+1 | Decide build-vs-budget **before** GF2.3 (finance lists) ships. |
| Ethnicity catalog (GB3.1) | shared-types → FE caste display | FE surfaces caste only after GB3.6 publishes. |
| ~~PDF identifier payload (GF4.1, FE→BE)~~ → **BE-led, shipped #238** | BE resolves server-side | **Retired** — receipt identifiers resolve on the server (legal-doc integrity). Converge FE + BE onto one published registry via **GF4.1b** before Wave 4. See §2.1. |
| CBS data (GB4) + CBS UI (GF5) | two publishes, same window | **Wave 4 only.** Land together with matching pin bumps; `@aibrains/shared-types` (BE) and `@edforge/archetype` (FE) are separate publishes. |

### 4.7 Don't-do list (paralysis guards)

- **Don't** start Wave 4 (CBS) without a funded pilot. The enum stays
  `['PABSON','GENERIC']` in production.
- **Don't** build the `GovernanceProfile` aggregator object before GB1.2b/GB2
  need it — ship the conformance *test* only.
- **Don't** parallelize two shared-types bumps.
- **Don't** let an agent edit both repos in one session.
- **Don't** override a red CI gate to "keep velocity."

---

## 5. One-screen summary

1. **Ship PABSON value first:** identifier display (GF1–GF2) + compliance
   descriptor (GB3) + the cheap calendar bug fix (GB1.1).
2. **Then onboarding polish:** seeding (GB2) + gated dropdowns (GF3).
3. **Then regression insurance as-you-go:** thin conformance tests, the lint, PDF.
4. **Only when CBS is funded:** the aggregator object + the CBS extensibility proof.
5. **Run it** as one-ticket-one-agent, parallel within a wave, serialized at every
   shared-types publish, every merge gated by CI, two-repo `cd` hygiene throughout.

The framework remains the north star. We just stop paying its full extensibility
tax until the 21st-customer governance body actually exists.

---

*Generated 2026-06-03. Staff-engineer / product-lead pass over the sprint plans:
value-ordered the roadmap, hardened the edge cases, and specified the two-repo
agent orchestration. Companion to the sprint plans in this directory.*

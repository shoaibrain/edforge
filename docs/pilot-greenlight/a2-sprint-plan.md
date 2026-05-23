# Sprint A.2 — Course Extension + CDC Curriculum Foundation: Sprint Plan

> **Drafted:** 2026-05-22
> **Status:** 🟡 Draft — awaiting sign-off before branch cut
> **Master-plan section:** `v1-master-epic-breakdown.md` §3 Sprint A.2 (lines 535–581)
> **Research artifact:** [`a2-subject-vs-course-decision.md`](./a2-subject-vs-course-decision.md) — A.2.0 RESOLVED 2026-05-22 → Option B (extend Course)
> **Companion plan precedents:** [`c4-fe-sprint-plan.md`](./c4-fe-sprint-plan.md), [`c4-ops-sprint-plan.md`](./c4-ops-sprint-plan.md), [`c0-c-3-deploy-plan.md`](./c0-c-3-deploy-plan.md)

---

## 1. Why this sprint, why now

### Critical-path argument

A.2 is the keystone unblocking ~28 V1 tickets across 4 sprints:

```
A.2.1 (Course + academicSubject + curriculumRef)
   ├── A.3.3 ExamCourse.courseId       → A.4.2 ResultCard.courseScores[]
   │                                       → C.4.2 Report Card render
   │                                       → D.2.5 promotion eval reads ResultCard
   ├── D.3.0 RubricCategory.academicSubject
   │   └── D.3.1 ExternalExamRegistration.courses[]
   │       └── D.4 BLE / D.5 SEE / D.6 NEB-11/12 (24 tickets)
   └── A.2.4 PABSON Course catalog seed feeds D.4.2 CDC rubric
```

Skipping A.2 to ship D.2 first would produce a PromotionRule entity with nothing to promote against. D.4/D.5/D.6 are triple-gated by D.3 + A.4 + D.2 — none of which exist without A.2 first.

### Adoption-arc alignment

Per `v1-master-epic-breakdown.md` §1.2: school-adoption order is `0 → A → C → D → E`. We've shipped 0.4 + jumped to E.0 + E.1 + D.1 because of research unblocks. Returning to EPIC-A is the correct sequencing recovery.

### Per §0 philosophy (CEO 2026-05-22)

Product completeness, not pilot calendar, drives V1. A.2 closes a completeness gap in the Operate pipeline; A.1 daily-use polish does not.

---

## 1.5 Architecture principle — Core Ed-Fi V6 + Edges by archetype

**This is the load-bearing design discipline for the entire sprint.** Every implementation decision below MUST be evaluated against it.

### Statement

EdForge's data model is **Ed-Fi V6 at the Core** (canonical, archetype-blind entities, descriptors, validators, engines) with **archetype-specific Edges at the boundary** (seeds, catalogs, defaults, mappers — never inside service code). The two layers communicate through descriptor values + reference tables, never through `tenant.archetype` branching in domain logic.

**Why it matters here:** A.2 is the first sprint that lands an Ed-Fi V6 *descriptor* (`AcademicSubjectDescriptor`) and the first *curriculum-specific edge catalog* (`PABSON_COURSE_CATALOG`). Getting the boundary right now sets the pattern every D.x and E.x sprint will follow. Getting it wrong (e.g. branching on `archetype === 'PABSON'` in `courses.service.ts`) compounds across 28 downstream tickets.

### Layer mapping for A.2

| Layer | Lives in | Archetype-aware? | A.2 contributions |
|---|---|---|---|
| **Core — Ed-Fi V6 canonical** | `packages/shared-types/src/descriptors/`, `packages/shared-types/src/schemas/academics/`, `server/application/microservices/academics/src/courses/` | NO — must pass invariant-12 grep clean | A.2.1 entity + descriptor + curriculumRef enum; A.2.2 validation; A.2.3 dual-write mapper |
| **Edge — Archetype boundary** | `packages/shared-types/src/archetype/` | YES — by definition, archetype-scoped | A.2.4 PABSON CDC NCF 2076 catalog |
| **Edge — Operator tooling** | `scripts/` | YES — accepts `--tenant-id`/`--school-id` parameters (NOT hardcoded; invariant 13 clean) | A.2.5 backfill script |
| **Service runtime** | `server/application/microservices/academics/src/` | NO — treats every write identically; never reads `tenant.archetype` | A.2.2 + A.2.3 (changes go here) |

### Concrete invariants this principle enforces for A.2 implementation

1. **`AcademicSubjectDescriptor` values are Ed-Fi V6 canonical**, not PABSON-specific. The descriptor enum (`mathematics | science | english | nepali | …`) is a flat, archetype-blind taxonomy. PABSON's "C. Mathematics" + Cambridge IGCSE's "Core Mathematics" + US "Algebra I" all map to `mathematics`. Per research artifact §2.1 + §5.2.
2. **`curriculumRef` is the edge marker on a Core entity.** Two Course rows can share `academicSubject:'mathematics'` but differ in `curriculumRef:'CDC_NCF_2076'` vs `'CAMBRIDGE_IGCSE'`. This is how Core models archetype multiplicity without branching. Per research §5.2 + master plan §0.3.
3. **`stateSubjectCode` is an Edge-supplied annotation, optional in Core.** CDC's `004` for English, NEB's subject codes — these are archetype-specific labels attached to Core rows, not Core fields. Optional in schema by design.
4. **`PABSON_COURSE_CATALOG` lives only in `packages/shared-types/src/archetype/`** — never in academics service code, never in descriptors/, never in schemas/. It is reference data for tooling (A.2.5 backfill) + future seeders, not domain logic.
5. **`courses.service.ts` must remain `grep 'archetype' → 0 hits` after A.2.** Validation enforces enum membership; auto-derive uses pure mapping; no `if (tenant.archetype === 'PABSON')` anywhere.
6. **`subjectArea ↔ academicSubject` mapper is pure + archetype-blind.** Same function across all tenants; PABSON-specific defaulting happens at the Edge (catalog already has the mapping baked in), not in the service.

### Anti-pattern guardrails (rejected at PR review per CLAUDE.md house rules)

- `if (tenant.archetype === 'PABSON') course.curriculumRef = 'CDC_NCF_2076'` in service code → reject
- `PABSON_DEFAULT_SUBJECTS = [...]` imported into academics src → reject (must come from `@aibrains/shared-types/archetype` only via boundary modules, never directly)
- Hardcoded school name in backfill script → reject (invariant 13)
- New Course-related branching keyed on `country === 'NPL'` → reject (per memory `edforge_archetype_model`: branch on archetype, never country)

### Forward implication (post-A.2 sprints)

A.3 (Exam) + A.4 (Result) + D.3 (ExternalAssessment family) will all rely on `Course.academicSubject` for downstream aggregation. The descriptor enum landed in A.2.1 is the contract; D.3.0's `RubricCategory.academicSubject` references it; D.3.4's `ExternalExamResult.courseResults[].academicSubject` denormalizes it. Every one of those references is a Core-on-Core link. The PABSON-specific BLE rubric weights (50% internal CAS / 50% external) land separately in `archetype/ble-cdc-rubric.ts` (D.4.2) — same Core+Edge split.

---

## 2. Scope

### In-scope

| Ticket | Summary | Sized |
|---|---|---|
| A.2.1 | Course entity extension: `academicSubject` + `stateSubjectCode?` + `curriculumRef`; `AcademicSubjectDescriptor` enum | M |
| A.2.2 | Course CREATE/PATCH validation against new descriptor + curriculumRef enums | S |
| A.2.3 | `subjectArea` ↔ `academicSubject` dual-write (auto-derive on PATCH/POST) | S |
| A.2.4 | PABSON CDC NCF 2076 Course catalog seed (Grades 4-10, best-guess) | M |
| A.2.5 | dev-pabson-primary Course backfill script (dry-run + apply) | M |

### Out-of-scope (deferred, with reason)

| Item | Why |
|---|---|
| GSI on `Course.curriculumRef` | Not pilot-scale: per-school partition scan with filter handles ≤100 courses/school. Add post-pilot-2 if multi-tenant aggregate queries demand it. |
| Grades 11-12 in catalog | NEB Grade 11/12 is Sprint D.6 scope; Saraswati doesn't operate Grade 11-12 in V1. |
| Grades 1-3 in catalog | V1.5 — integrated/thematic curriculum via Ed-Fi `LearningStandardGrade` per A.2.0 §1.1. |
| stateSubjectCode CDC values | Best-guess placeholders ONLY; field marked optional. Operators populate authoritative values when CDC source doc is in hand. Iterate. |
| Backfill against prod Saraswati | **Per user 2026-05-22:** prod Saraswati has NO Course data yet. A.2.5 targets `dev-pabson-primary` only. |
| Full audited-write migration (Sprint 0.3) | A.2.2/A.2.3 use existing `courses.service.ts` audit/event pattern (same as D.1 took). Sprint 0.3 ports academics to `auditedWrite()` later. |

### Already-shipped foundation (verified 2026-05-22)

- `curriculumRefSchema` with `CDC_NCF_2076` enum exists at `packages/shared-types/src/schemas/archetype-defaults.schema.ts:122` and is exported from the package index. **A.2.1 reuses this, does NOT recreate.**
- `PABSON.primaryCurriculumRef = 'CDC_NCF_2076'` at `packages/shared-types/src/archetype/archetype-defaults.ts:116`.
- Existing `Course` entity carries: `gradeLevels[]`, `credits`, `subjectArea` (SubjectArea enum), `courseType`, `prerequisites?`. NEW fields are additive.
- Existing `Section → Course → CourseOffering` relationships and `Grade.courseId` mark-entry path. No API surface change needed for marks.

---

## 3. PR cadence — 3 phases

### Phase 1 — Shared-types: schema + descriptor + PABSON seed (1 PR)

**Tickets:** A.2.1 + A.2.4 (both shared-types only; group to share single npm publish)

**Files:**
- `packages/shared-types/src/descriptors/academic-subject.ts` (NEW) — `AcademicSubjectDescriptor` Zod enum + TS type
- `packages/shared-types/src/descriptors/index.ts` (NEW) — barrel export
- `packages/shared-types/src/index.ts` (modified) — re-export descriptor
- `packages/shared-types/src/schemas/academics/course.schema.ts` (modified) — add `academicSubject`, `stateSubjectCode?`, `curriculumRef?` (optional for back-compat with legacy rows; validation enforced server-side in Phase 2)
- `packages/shared-types/src/archetype/pabson-courses.ts` (NEW) — Course catalog seed (21 templates)
- `packages/shared-types/src/archetype/index.ts` (modified) — export `PABSON_COURSE_CATALOG`
- `packages/shared-types/package.json` (modified) — bump 0.55.0 → 0.56.0
- `packages/shared-types/src/archetype/pabson-courses.spec.ts` (NEW) — seed-shape validation
- `packages/shared-types/src/descriptors/academic-subject.spec.ts` (NEW) — enum coverage

**Deploy:** publish 0.56.0 to npm → refresh root lockfile → AdminWeb jsdom sim → controlplane-stack redeploy (rebuilds AdminWeb pipeline) → Vercel auto-deploys saas-frontend on merge to main.

**Caret-pin bumps required in same PR:**
- `server/application/package.json`: `@aibrains/shared-types: ^0.55.0` → `^0.56.0`
- `server/package.json`: same
- (Per memory `edforge_shared_types_caret_pin` + R39 — `^0.X.0` does NOT auto-pick up `0.(X+1).0` in Docker builds)

### Phase 2 — Academics service: validation + dual-write (1 PR)

**Tickets:** A.2.2 + A.2.3

**Files:**
- `server/application/microservices/academics/src/common/entities/course.entity.ts` (modified) — add 3 fields to entity; mapper round-trips
- `server/application/microservices/academics/src/courses/courses.service.ts` (modified) — `createCourse` + `updateCourse` validate new fields + auto-derive `subjectArea` from `academicSubject` when needed (A.2.3 dual-write)
- `server/application/microservices/academics/src/courses/subject-area-mapper.ts` (NEW) — explicit `AcademicSubjectDescriptor → SubjectArea` mapping table
- `server/application/microservices/academics/src/courses/subject-area-mapper.spec.ts` (NEW)
- `server/application/microservices/academics/src/courses/courses.service.spec.ts` (modified) — validation negatives + dual-write positives
- `server/application/microservices/academics/src/__tests__/module-wiring.spec.ts` — no change expected (no new module), but verify post-build

**Deploy:** academics ECR build + push + rolling update on prod ECS service `academicsbasic` in `prod-basic` cluster (region `ap-south-1`).

**Smoke (live):**
- `POST /courses` with `{academicSubject:'mathematics', curriculumRef:'CDC_NCF_2076', ...}` → 2xx; GET returns populated fields + auto-derived `subjectArea='Math'`
- `POST /courses` with invalid `curriculumRef='INVALID'` → 400 `INVALID_CURRICULUM_REF`
- `PATCH /courses/:legacyId` adding `academicSubject` → 2xx; GET round-trips
- Legacy course (subjectArea-only) GET → 2xx, no required-field error

### Phase 3 — dev-pabson-primary Course backfill (1 PR)

**Tickets:** A.2.5

**Files:**
- `scripts/backfill-pabson-courses.ts` (NEW)
- `scripts/backfill-pabson-courses.spec.ts` (NEW) — unit covers diff logic + idempotency

**Script behavior:**
1. Args: `--tenant-id <uuid> --school-id <uuid> [--dry-run|--apply]`. Default: `--dry-run`.
2. Reads existing `Course` rows for the target school (via `GET /courses?schoolId=...` authenticated).
3. Diffs against `PABSON_COURSE_CATALOG` from shared-types.
4. For each (gradeLevel, academicSubject, curriculumRef) tuple in the seed not present in school's Courses → prepare a CREATE.
5. For each existing Course whose `subjectArea` maps to a seed `academicSubject` and lacks the new fields → prepare a PATCH.
6. `--dry-run` (default): prints `+CREATE` / `~PATCH` / `=SKIP` diff per row.
7. `--apply`: writes via authenticated POST/PATCH; tees log to `docs/deploys/dev-pabson-backfill-courses-<ts>-<sha>.log`.
8. Idempotent on re-run (re-running after `--apply` produces all-`=SKIP`).

**Auth:** uses a fresh `/tmp/dev-jwt.txt` Cognito id-token (per memory `feedback_just_ask_for_a_prod_token` — never inline JWT into heredoc; use Write tool → file).

**Deploy:** no infra change. Script execution only. Will request prod token from user when ready to run `--apply`.

---

## 4. Per-ticket detail (with §1.1 atomic conventions)

### A.2.1 — Course entity field extension (Ed-Fi alignment)

**Files** (additive to Phase 1 above):
- 3 NEW files (descriptor enum + index + spec)
- 2 NEW shared-types files (catalog seed + spec — folded with A.2.4)
- 1 modified schema + 1 modified entity (Phase 2)

**Validation:**
- Entity factory unit: `createCourseEntity({...minimal, academicSubject:'mathematics', curriculumRef:'CDC_NCF_2076'})` returns valid
- Contract test: entity-vs-schema mapper round-trips all 3 new fields
- Backward-compat: factory with NO new fields (legacy shape) still succeeds; mapper does not require them on read

**AC:**
- Factory + contract green; existing 133 academics tests stay green
- shared-types minor bump (0.56.0) + npm publish + AdminWeb jsdom sim per CLAUDE.md (jsdom sim is the bug-fence after the 2026-04-19 incident)
- Route-drift lint clean (no new routes)
- Module-wiring spec unchanged (no new module)
- AcademicSubjectDescriptor enum covers: `mathematics | science | english | nepali | social_studies | environment_population_health | health_physical_creative_arts | local_subject | optional_mathematics | optional_computer_science | optional_economics | accounting | physics | chemistry | biology` (15 values per master plan §0.3)

**Deps:** Sprint 0.4 ✅ (ArchetypeDefaults shipped); `curriculumRefSchema` already exists.

**Risks:**
- R-A2.1 — shared-types caret-pin trap (R39): mitigation = bump server/application + server pins SAME PR.
- R-A2.2 — AdminWeb silent bundle break (zod-style): mitigation = jsdom sim mandatory before merging.
- R-A2.3 — descriptor enum drift between shared-types + master-plan §0.3: pin to master-plan values exactly.

### A.2.2 — Course CREATE/PATCH validation update

**Files:** Phase 2 (above).

**Validation (jest integration):**
- POST valid → 2xx, persists all 3 new fields
- POST `curriculumRef:'INVALID'` → 400 `INVALID_CURRICULUM_REF`
- POST `academicSubject:'astrology'` (not in enum) → 400 `INVALID_ACADEMIC_SUBJECT`
- PATCH legacy course (no new fields originally) → 2xx, populates the new fields
- POST without new fields → 2xx (back-compat; not required at the API layer for V1)

**AC:**
- Validation enforced on writes; reads unaffected for legacy rows
- Audit + event per write per existing courses.service pattern (no migration to auditedWrite yet — Sprint 0.3 work)
- Error codes follow project errorCode schema (no free-text 400s)

**Deps:** A.2.1.

### A.2.3 — `subjectArea` denormalization keeper + dual-write

**Files:** Phase 2 (above).

**Mapping table (`subject-area-mapper.ts`):**

| academicSubject (NEW) | subjectArea (legacy) |
|---|---|
| `mathematics` | `Math` |
| `science` | `Science` |
| `english` | `English` |
| `nepali` | `World Languages` |
| `social_studies` | `Social Studies` |
| `environment_population_health` | `Health` |
| `health_physical_creative_arts` | `Health` |
| `optional_mathematics` | `Math` |
| `optional_computer_science` | `Technology` |
| `optional_economics` | `Business` |
| `accounting` | `Business` |
| `physics` | `Science` |
| `chemistry` | `Science` |
| `biology` | `Science` |
| `local_subject` | `Other` |

(Values for the legacy `SubjectArea` enum need verification against the existing TypeScript enum during implementation. If a target value doesn't exist in `SubjectArea`, default to `'Other'` and log audit warning rather than 4xx — soft-fail keeps legacy writes flowing.)

**Validation:**
- Integration: legacy course (subjectArea='Math', no academicSubject) reads OK
- Integration: PATCH on legacy course with `academicSubject:'mathematics'` → response has both fields, subjectArea preserved as 'Math'
- Integration: POST new course with `academicSubject:'mathematics'` only → response has `subjectArea='Math'` auto-derived
- Integration: POST with both fields explicitly → both preserved as written (operator override wins)

**AC:**
- Dual-write maintained; `subjectArea` enum NOT removed (V1.5 cleanup tracked in §17.2)
- Mapper covers all 15 AcademicSubjectDescriptor values
- Unknown mapping defaults to `'Other'` + audit warning (no 5xx)

**Deps:** A.2.1 + A.2.2.

### A.2.4 — PABSON archetype Course catalog seed (best-guess)

**Files:** Phase 1 (above).

**Seed content — 21 Course templates** (best-guess per user direction; `stateSubjectCode` left undefined for V1; operators populate later):

```typescript
export const PABSON_COURSE_CATALOG: ReadonlyArray<PabsonCourseTemplate> = [
  // Grades 4-5 (Basic Level, Subject-Based) — 6 compulsory
  { code: 'NCF-ENG-G45',  name: 'English',         gradeLevels: ['4','5'],   academicSubject: 'english',                       isCompulsory: true,  isCore: true },
  { code: 'NCF-NEP-G45',  name: 'Nepali',          gradeLevels: ['4','5'],   academicSubject: 'nepali',                        isCompulsory: true,  isCore: true },
  { code: 'NCF-MATH-G45', name: 'Mathematics',     gradeLevels: ['4','5'],   academicSubject: 'mathematics',                   isCompulsory: true,  isCore: true },
  { code: 'NCF-SCI-G45',  name: 'Science',         gradeLevels: ['4','5'],   academicSubject: 'science',                       isCompulsory: true,  isCore: true },
  { code: 'NCF-SOC-G45',  name: 'Social Studies',  gradeLevels: ['4','5'],   academicSubject: 'social_studies',                isCompulsory: true,  isCore: true },
  { code: 'NCF-EPH-G45',  name: 'Environment, Population & Health', gradeLevels: ['4','5'], academicSubject: 'environment_population_health', isCompulsory: true, isCore: true },

  // Grades 6-8 (Basic Level → BLE) — 6 compulsory + 1 optional
  { code: 'NCF-ENG-G68',  name: 'English',         gradeLevels: ['6','7','8'], academicSubject: 'english',                     isCompulsory: true,  isCore: true },
  { code: 'NCF-NEP-G68',  name: 'Nepali',          gradeLevels: ['6','7','8'], academicSubject: 'nepali',                      isCompulsory: true,  isCore: true },
  { code: 'NCF-MATH-G68', name: 'C. Mathematics',  gradeLevels: ['6','7','8'], academicSubject: 'mathematics',                 isCompulsory: true,  isCore: true },
  { code: 'NCF-SCI-G68',  name: 'Science',         gradeLevels: ['6','7','8'], academicSubject: 'science',                     isCompulsory: true,  isCore: true },
  { code: 'NCF-SOC-G68',  name: 'Social Studies',  gradeLevels: ['6','7','8'], academicSubject: 'social_studies',              isCompulsory: true,  isCore: true },
  { code: 'NCF-EPH-G68',  name: 'EPH',             gradeLevels: ['6','7','8'], academicSubject: 'environment_population_health', isCompulsory: true, isCore: true },
  { code: 'NCF-OCS-G68',  name: 'Opt. Computer Science', gradeLevels: ['6','7','8'], academicSubject: 'optional_computer_science', isCompulsory: false, isCore: false },

  // Grades 9-10 (Secondary Level → SEE) — 6 compulsory + 2 optional
  { code: 'NCF-ENG-G910', name: 'C. English',      gradeLevels: ['9','10'],  academicSubject: 'english',                       isCompulsory: true,  isCore: true },
  { code: 'NCF-NEP-G910', name: 'C. Nepali',       gradeLevels: ['9','10'],  academicSubject: 'nepali',                        isCompulsory: true,  isCore: true },
  { code: 'NCF-MATH-G910', name: 'C. Mathematics', gradeLevels: ['9','10'],  academicSubject: 'mathematics',                   isCompulsory: true,  isCore: true },
  { code: 'NCF-SCI-G910', name: 'Science',         gradeLevels: ['9','10'],  academicSubject: 'science',                       isCompulsory: true,  isCore: true },
  { code: 'NCF-SOC-G910', name: 'Social Studies',  gradeLevels: ['9','10'],  academicSubject: 'social_studies',                isCompulsory: true,  isCore: true },
  { code: 'NCF-HPE-G910', name: 'Health, Physical & Creative Arts', gradeLevels: ['9','10'], academicSubject: 'health_physical_creative_arts', isCompulsory: true, isCore: true },
  { code: 'NCF-OPMATH-G910', name: 'Opt. Mathematics', gradeLevels: ['9','10'], academicSubject: 'optional_mathematics',       isCompulsory: false, isCore: false },
  { code: 'NCF-OCS-G910', name: 'Opt. Computer Science', gradeLevels: ['9','10'], academicSubject: 'optional_computer_science', isCompulsory: false, isCore: false },
];
```

All rows carry `curriculumRef: 'CDC_NCF_2076'` (constant for V1). `stateSubjectCode` undefined.

**Sources for seed:** A.2.0 research artifact §1 (CDC NCF 2076 subject structure) + §4 (PABSON practice; "C. Mathematics", "Science", "Social Studies", "EPH" naming standard) + §6 (NEB code `004` example for English G12 — held for V1.5 when full CDC code table is in hand).

**Validation:**
- jest seed-shape: every row passes Course schema (from A.2.1)
- Code uniqueness: no two templates share `code`
- Grade-band coverage: every grade 4-10 has ≥6 compulsory courses

**AC:**
- `PABSON_COURSE_CATALOG` exported from `@aibrains/shared-types`
- 21 rows, all `curriculumRef:'CDC_NCF_2076'`
- Schema compliance verified by spec
- Comment block at top of file documents: "Best-guess catalog per A.2.0 research; iterate as CDC source doc surfaces. See `docs/pilot-greenlight/a2-sprint-plan.md` §4 A.2.4."

**Deps:** A.2.1.

### A.2.5 — dev-pabson-primary Course extension backfill

**Files:** Phase 3 (above).

**Diff logic (pseudocode):**

```ts
const existing = await fetchExistingCourses(tenantId, schoolId);  // GET /courses
const planned = PABSON_COURSE_CATALOG;

for (const seed of planned) {
  const match = existing.find(c =>
    c.gradeLevels.some(g => seed.gradeLevels.includes(g)) &&
    deriveAcademicSubjectFromSubjectArea(c.subjectArea) === seed.academicSubject
  );
  if (!match) {
    plan.creates.push(seed);
  } else if (!match.academicSubject || !match.curriculumRef) {
    plan.patches.push({ courseId: match.courseId, fields: { academicSubject: seed.academicSubject, curriculumRef: 'CDC_NCF_2076' } });
  } else {
    plan.skips.push(match.courseId);
  }
}
```

**Validation:**
- Dry-run prints `+CREATE/~PATCH/=SKIP` summary
- User reviews dry-run output
- `--apply` writes via authenticated POST/PATCH; tees full log
- Post-apply GET asserts every dev-pabson-primary course carries `academicSubject` + `curriculumRef`
- Re-run after `--apply` produces all-`=SKIP` (idempotent)

**AC:**
- dev-pabson-primary courses all extended (new + existing populated)
- Log archived under `docs/deploys/dev-pabson-backfill-courses-<ts>-<sha>.log`
- Idempotent on re-run
- Script accepts `--tenant-id` + `--school-id` args (parameterized, not hardcoded — invariant 13)

**Deps:** A.2.1 + A.2.2 + A.2.4 + Phase 2 ECS roll (script writes via API, needs validation logic live).

**Risk:**
- R-A2.4 — JWT TTL (Cognito 1h): mitigation = capture fresh token just before `--apply` run, per memory `feedback_just_ask_for_a_prod_token`.

---

## 5. Risks & mitigations (sprint-level)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-A2.1 | Shared-types caret-pin trap (npm `^0.55.0` doesn't auto-resolve `0.56.0` in Docker) | H if forgotten | H | Bump `server/application/package.json` + `server/package.json` pins SAME PR as the publish. Refresh `package-lock.json` at repo root. Per memory `edforge_shared_types_caret_pin`. |
| R-A2.2 | AdminWeb silent bundle break on shared-types upgrade (zod-style incident) | L | H | Mandatory jsdom sim per CLAUDE.md before merging Phase 1. Block deploy if sim fails. |
| R-A2.3 | AcademicSubjectDescriptor drift between shared-types + master-plan §0.3 | L | M | Pin enum values exactly to master-plan §0.3 list; reference in code comment. Sprint plan's enum table is the canonical list for review. |
| R-A2.4 | dev-pabson-primary already has Course rows from prior C-phase smokes → backfill double-creates | M | M | A.2.5 dry-run prints diff first; user reviews before `--apply`. Diff logic matches existing rows by (gradeLevel ∩ academicSubject-derived) — won't duplicate. |
| R-A2.5 | `SubjectArea` legacy enum doesn't contain the target value for a mapping (e.g. no `'Health'`) | M | L | A.2.3 mapper defaults to `'Other'` + audit warning on unknown mapping. Soft-fail; doesn't block write. Verify actual SubjectArea enum during Phase 2 implementation; adjust table. |
| R-A2.6 | Phase 1 PR merges but caret-pin bumps forgotten in `server/`; Phase 2 academics Docker build fails TS2305 | M | H | Pre-merge checklist on Phase 1 PR: every `package.json` that imports `@aibrains/shared-types` bumped. Per memory: incident hit S0.6 (2026-05-14). |
| R-A2.7 | A.2.4 seed names ('C. Mathematics') diverge from school's printed curriculum book | M | L (V1) | Best-guess scope per user direction. Seed is iterable — operators can rename via UI post-backfill. Plan's §4 A.2.4 comment block notes the convention. |
| R-A2.8 | Sprint 0.3 audited-write infra not shipped; A.2.2/A.2.3 use legacy audit pattern | (accepted) | L | Follow same precedent as D.1 (PR #146/#147 shipped without auditedWrite). Sprint 0.3 ports academics later; A.2 writes get migrated as part of 0.3.5. |

---

## 6. Invariant gate (per `v1-master-epic-breakdown.md` §1.4)

| Invariant | A.2 disposition |
|---|---|
| Audit + event paired (Sprint 0.2.7 lint) | YES — use existing `courses.service` audit/event pattern; verify event fires on writes with new fields. |
| Three-way route handoff (Nest + tenant-api-prod.json + nginx.template) | N/A — no new routes. Extension is data-shape only. |
| Shared-types changed → minor bump + npm publish + AdminWeb jsdom sim | YES — Phase 1 follows CLAUDE.md per-sprint publish checklist end to end. |
| New NestJS module → module-wiring.spec.ts SAME PR | N/A — extending existing courses module; no new module. Per memory `feedback_module_wiring_invariant` (D.1 retraced this trap). |
| New GSI → gsi-inventory.md BEFORE CDK deploy | N/A — GSI on curriculumRef DEFERRED (see §2 out-of-scope). |
| Invariant 13 (no pilot names in code) | A.2.5 script accepts `--tenant-id`/`--school-id` args, not hardcoded. PABSON catalog is in `archetype/` (allowed pattern, archetype-scoped not pilot-scoped). |
| Invariant 12 (no `tenant.archetype` reads in academics src) | A.2 doesn't read tenant.archetype anywhere in academics src. PABSON catalog lookup happens in the BACKFILL SCRIPT, not in academics service code. Grep stays clean. |
| `as any` cast smell | None expected. |

---

## 7. Deploy ladder (per CLAUDE.md + memory `feedback_pr_first_no_more_uat`)

```
Phase 1 PR (shared-types + caret-pin bumps)
  ├── (CI green: typecheck, lint, jest, AdminWeb build)
  ├── (Reviewer approval — Shoaib)
  ├── npm publish @aibrains/shared-types@0.56.0
  ├── npm view @aibrains/shared-types version  (verify registry; 30s propagation)
  ├── npm install (root, refresh lockfile)  ← commit lockfile change in PR
  ├── Local AdminWeb rebuild: rm -rf node_modules/.cache build && npm run build
  ├── jsdom bundle sim (per CLAUDE.md one-liner)  ← BLOCKING if fails
  ├── Merge PR to main
  └── controlplane-stack redeploy (CodePipeline rebuilds AdminWeb)
       └── Sanity curl AdminWeb bundle for AcademicSubjectDescriptor presence

Phase 2 PR (academics service: validation + dual-write)
  ├── (CI green)
  ├── (Reviewer approval)
  ├── Merge PR to main
  ├── scripts/build-application.sh academics  (single-service ECR build, tee'd to log)
  ├── aws ecs update-service --force-new-deployment academicsbasic (ap-south-1)
  ├── Wait for services-stable
  └── Live smoke: 4 curl assertions per §3 Phase 2 (POST valid / POST invalid / PATCH legacy / GET legacy)

Phase 3 PR (backfill script)
  ├── (CI green; spec covers diff logic + idempotency)
  ├── (Reviewer approval — script only; no merge gate on prod write)
  ├── Merge PR to main
  ├── Request fresh Cognito JWT from user → /tmp/dev-jwt.txt (via Write tool, not heredoc)
  ├── ts-node scripts/backfill-pabson-courses.ts --tenant-id <dev-pabson> --school-id <school> --dry-run
  ├── (User reviews diff)
  ├── --apply  (tees log to docs/deploys/dev-pabson-backfill-courses-<ts>-<sha>.log)
  └── Re-run --dry-run → all-=SKIP (idempotency proof)
```

**No UAT.** Per memory: UAT environment is sunset; PR-first to prod via per-step authorization (AskUserQuestion gates each prod-touching action).

---

## 8. Open decisions (need sign-off before branch cut)

1. **Phase grouping:** Ship A.2 as 3 PRs (1+4, 2+3, 5) as proposed? Or strict atomic 5 PRs? *Recommendation: 3 PRs — matches D.1/E.1 ship cadence; cleaner deploy boundaries.*
2. **Best-guess catalog (A.2.4):** Approve the 21-row catalog in §4 A.2.4? Iterate later with operator input.
3. **GSI on curriculumRef:** Defer to post-pilot-2? *Recommendation: yes, defer.*
4. **A.2.5 target:** dev-pabson-primary only, per user 2026-05-22? *Confirmed; no prod Saraswati Course data exists.*
5. **Phase 3 timing:** Run A.2.5 `--apply` in the same session as Phase 3 merge, or hold until separate operator-led session? *Recommendation: same session, with user-in-the-loop approval at dry-run review step.*

---

## 9. Definition of Done (Sprint A.2)

- [ ] All 5 tickets meet §1.1 per-ticket DoD (Files + Validation + AC + Deps + Risk).
- [ ] All 3 PRs merged to main (one in each repo if frontend touched — A.2 likely backend-only).
- [ ] Phase 1 deploy log: `docs/deploys/prod-controlplane-stack-<ts>-<sha>.log`.
- [ ] Phase 2 deploy log: `docs/deploys/prod-build-application-academics-<ts>-<sha>.log` + `docs/deploys/prod-ecs-roll-academicsbasic-<ts>-<sha>.log`.
- [ ] Phase 3 backfill log: `docs/deploys/dev-pabson-backfill-courses-<ts>-<sha>.log`.
- [ ] Phase 2 live-smoke evidence captured (4 curl assertions).
- [ ] Phase 3 idempotency proof captured (second `--dry-run` shows all-`=SKIP`).
- [ ] Closeout entry added to `docs/pilot-greenlight/sprint-closeouts.md`.
- [ ] Status table in `v1-master-epic-breakdown.md` §0.4 updated: `A.2 🟢 shipped <date>` + PRs/logs.
- [ ] Memory written: `project_sprint_a2_shipped_prod.md` (pattern: project_sprint_e1_flash_i_ii_shipped_prod).
- [ ] Risk register §11.2 updated if new R-A2.* surface in implementation.
- [ ] No regressions in E.1 / D.1 / E.0 / 0.4 smokes (regression bundle re-run pre-merge of Phase 2).

---

## 10. What this plan deliberately does NOT include

- Frontend AdminWeb UI for creating Courses with the new fields (operator currently creates via API; UI extension is post-A.2 follow-up if needed)
- saas-frontend academics MFE consuming the new fields in Course list / detail views (separate frontend PR; bumps `@aibrains/shared-types` pin, Vercel auto-deploys)
- A.3 (Exam subsystem) — unblocked by A.2 but not in this sprint
- D.3 (ExternalAssessment family) — unblocked by A.2 but not in this sprint
- Operator-facing "seed-from-archetype" endpoint — backfill script suffices for V1 pilot count; post-V1 if multi-tenant onboarding needs it

---

## Sign-off requested

Open decisions in §8 above are the gates. Once signed off:
1. Cut feature branches: `sprint/a2-course-extension` in both `edforge` (server) and (if needed) `edforge-saas-frontend`. Per memory `edforge_two_git_repos` + `feedback_explicit_cd_per_git`: every git op starts with explicit `cd <repo-root>` in the same invocation.
2. Begin Phase 1 implementation.

# EdForge V1 Master Framework — Building for Nepal, Learning from the Structured World

> **Drafted:** 2026-05-20 (v0.2 — revised per CEO feedback)
> **Status:** 🟡 Draft — strategic framework, complements (does not replace) the tactical v2 sprint plan
> **Companion docs:**
> - Tactical: [`sprint-plan-update-2026-05-19.md`](./sprint-plan-update-2026-05-19.md) — v2 sprint plan (D0a → K, 21-item risk register)
> - Tactical: [`c4-ops-sprint-plan.md`](./c4-ops-sprint-plan.md) — ENG-1/ENG-2 IEMIS fast-follows
> - Tactical: [`daily-use-coverage-audit-2026-05-19.md`](./daily-use-coverage-audit-2026-05-19.md) — ~55% daily-use coverage baseline
> - Foundational: [`sprint-plan.md`](./sprint-plan.md) — v1 plan (§4 invariants, §10/§11 DoDs remain authoritative)
> - Pilot dossier: [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md)
> - IEMIS post-mortem: [`docs/pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md`](../pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md)

> **Framing correction (CEO, 2026-05-20):** EdForge is being built FOR Nepal schools. We are NOT building for Allen ISD. We are looking at Allen ISD's structured K-12 framework to LEARN how a developed-nation district operates, so we architect, design, and implement a better, more scalable product for Nepal schools. Allen ISD is a reference, not a target. This v0.2 strips all "Allen ISD as build target" language.

---

## 0. Status — Where we are

| Dimension | Status | Confidence |
|---|---|---|
| Foundation (Phases A→C in v1 plan) | ✅ Shipped + in prod | High |
| Saraswati activated through UI 2026-05-18 | ✅ Live | High |
| 206/779 students imported (5/14 grades) | 🟡 In progress; daily uploads | High |
| Operator-feedback engineering gaps surfaced | 🟡 Two known: ENG-1, ENG-2 in flight | High |
| In-person classes start | ⏳ ≤2 weeks | Medium |
| Daily-use coverage (audit baseline) | 🟡 ~55% | High |
| Nepal national exam workflows (BLE, SEE, NEB-11/12) | 🔴 0% in code (entities missing) | High |
| Document rendering / school branding | 🔴 0% (only `School.logoUrl` field exists) | High |
| CEHRD compliance scorecard | 🟡 Partial — IEMIS import scaffolded; submission MVP not yet shipped | Medium |
| Master sprint plan (v2 tactical) | 🟡 Drafted, awaiting sign-off | High |
| Master framework (this doc) | 🟡 v0.2 drafting | Medium |
| **Overall: Yellow → Green readiness** | 🟡 **Yellow** | High |

**Why Yellow, not Green:**
1. Saraswati operator-feedback (ENG-1, ENG-2) not fully shipped; principal uploading daily compounds backfill scope.
2. Phase D backend (Exam → Result → ReportCard) not started.
3. Nepal national exam workflows (BLE, SEE-internal-assessment, NEB-11/12) have no entity backing in code.
4. Phase F (cross-year handoff + IEMIS submission MVP) not started.
5. Document rendering infrastructure (V1 needs PDFs of Invoice, Intimation Bill, Admit Card, Report Card) does not exist at all.
6. School-level branding (logo, signature, address, policy text per school) — only one field (`School.logoUrl`) exists today.
7. We have NOT done an on-site visit at Saraswati. The operator-led activation gave us telemetry; we have not observed daily ops yet.

---

## 1. The Problem — and the Architectural Commitment That Resolves It

### 1.1 The structured-vs-unstructured asymmetry (why we look at Allen ISD)

Developed-nation school districts (Allen ISD is one example; the structure is similar across many US districts) operate inside an explicit, documented, machine-actionable framework:

- A published 800-line **Academic Planning Guide** per grade band
- A canonical course-code system (e.g. `LA1D7A`)
- A standardized state assessment hard-wired to promotion
- A formal grading policy as data, not memory
- A multi-year personal graduation plan per student
- An explicit master schedule (period × room × teacher × section grid)
- A documented promotion rule (% in core + % attendance)

**This is not the Nepal reality** — and not by neglect. PABSON private boarding schools are run by deeply experienced principals and accountants whose operational instincts are precise. But the structure is in operator memory + paper register + locally-built Excel. It is not data the school can query or share with a parent.

The user's framing (paraphrased): *Nepal schools want to deliver structured education. They lack the structured framework around them. EdForge's mission is to provide that framework natively, so adopting EdForge IS the framework — not a binder of policy first.*

**The learning from Allen ISD is structural, not literal.** EdForge does NOT need Endorsements, Distinguished Achievement, ARD committees, GEMS, or 12 CTE clusters. EdForge DOES need to absorb the structural discipline these things represent: machine-actionable curriculum, machine-actionable promotion rules, machine-actionable assessment data, all archetype-defaulted and Ed-Fi-mapped.

### 1.2 The architectural commitment: Ed-Fi V6 + Archetype-Agnostic Service Layer

Every Nepal-specific concept EdForge models (BLE registration, SEE internal-assessment marks, NEB Grade 11/12 result import, PABSON pre-board exam, CDC subject taxonomy, bikram-sambat dates, NPR currency, IEMIS export) has an Ed-Fi V6 home (Assessment, StudentAssessment, AcademicRecord, GradingPolicy, etc.) or a clear `edforge:` extension namespace path.

The service + DB layer stays archetype-agnostic. PABSON-specific behavior comes from the `archetypeDefaults` table, NOT from code branches. The table seeds:

- `gradeLadder` = `[ECD, PPC, KG, 1, 2, ..., 10]` for Saraswati's grade range; `[..., 11, 12]` for HS-equipped PABSON schools
- `boardExams` = `[BLE@Grade8 (municipal), SEE@Grade10 (NEB), NEB-11@Grade11 (NEB), NEB-12@Grade12 (NEB)]`
- `gpaScale` = `4.0 with letters A+/A/B+/B/C+/C/D+/D/E` per CEHRD/NEB standard
- `examPattern` = `[unit_test, terminal, send_up, pre_board, final]` with PABSON-only pre_board as opt-in
- `complianceForms` = `[IEMIS_FLASH_I, IEMIS_FLASH_II]` (Form-7, Form-19 added as soft requirements per CEO 2026-05-20)
- `internalAssessmentWeight` = per-exam-type: BLE=`0.50` (per CDC), SEE=`0.25`, NEB-11/12=`0.25`
- `language` = `[en-NP, ne-NP]`; `currency` = `NPR`; `calendarSystem` = `bikram_sambat`; `weekStart` = `sunday`

When (much later, post-V1) we want to onboard a non-PABSON archetype, we drop a new `archetypeDefaults` profile + boundary import drivers. We do not touch service code.

---

## 2. The Framework — What V1 Must Ship

The v2 sprint plan (`sprint-plan-update-2026-05-19.md`) defines **the operational layer** EdForge needs for Saraswati to run a full AY (D0a → D3 → F1 → F2 → H → I → K). That is necessary. This section adds **the structured-framework layer** — what V1 ships to be credible as a complete EMIS, not a beta tool.

### 2.1 V1 Tracks (6 tracks; combines v2 tactical + structured layer)

The minimum set of complete, end-to-end-working features that lets Saraswati say "we can run the school on this for AY 2083 / 2084":

**Track A — Operate (already in v2 plan; non-negotiable)**
- A1. Period attendance with audit + event + holiday-aware rollup [v2 D1 / J]
- A2. Exam subsystem — schedule, mark entry, close [v2 D2]
- A3. Result subsystem — Result entity, conduct + remark, publication [v2 D3]
- A4. Cross-year handoff — provisional → final, retention path [v2 F1]
- A5. IEMIS submission MVP — Flash I, Flash II via template engine; **defaults to whatever pilot schools provide in their own existing export** (per CEO 2026-05-20: iterate to perfect this; MVP only for now) [v2 F2]

**Track B — Communicate (must close; partly in v2)**
- B1. Per-student in-app inbox (parent + student already log in; portals exist) — replaces messages-MFE mock data with real backend [scoped, not in v2 detail]
- B2. Event-driven notification fan-out — `attendance.recorded(absent)` → absence msg; `invoice.issued` → bill msg; `result.published` → result-available msg; `notice.published` → broadcast [scoped]
- B3. SES email fallback for guardians not active in portal — provider abstraction; **no SMS in V1** per CEO direction (provider-dependency cost-benefit not worth it; adapter interface defined so future drop-in is one file)
- B4. Notice / announcement entity + publish flow

**Track C — Distribute (must close; missing from v2 detail)**
- C1. **Document Rendering Service** — Lambda + Puppeteer + Handlebars (see §11 for the cost + architecture analysis). ONE service for all printables. ~$2/month at Saraswati's volume; ~$15-20/month at 100-school scale.
- C2. Four V1 templates: Invoice, Intimation Bill, Admit Card, Report Card — packaged in shared-types as `.hbs` files, archetype-defaulted (PABSON variant ships first)
- C3. **School branding entity + asset upload UI** — per-school logo, principal signature, address, color palette, fee-policy text, exam-rules text. S3 asset storage in ap-south-1 per residency commitment.
- C4. Operator "preview + print + share" UI hooks; PDFs land in parent + student in-app inbox + SES email

**Track D — Plan (Nepal-grade structured framework; learning from developed-world structure, applied to Nepal)**

These are the entity-level additions that close the structured-framework gap — driven by Nepal national exam workflows, not by Allen ISD specifics:

- D1. **`Subject` entity** (canonical, separate from `Course`) — today `Course.subjectArea` is an enum mixing subject + course-type. A real `Subject` entity (CDC-aligned for PABSON: Nepali, English, Mathematics, Science, Social Studies, Health/Physical/Creative Arts, Computer Sci, optional subjects) decouples subject-of-study from course-instance, enables curriculum sequencing, and is required for BLE/SEE/NEB internal-assessment mark entry per subject.
- D2. **`GradingPolicy` pluggability** — `gpaScale` enum (4.0 / 5.0); `letterGrades` array driven by `archetypeDefaults`; remove hardcoded A-F from `base.entity.ts`; seed PABSON 4-point profile (A+, A, B+, B, C+, C, D+, D, E with CEHRD/NEB percentage bands). Today the GradeLetter enum is US A-F hardcoded (per Agent 3 audit, `base.entity.ts:273`).
- D3. **`PromotionRule` entity + batch promotion workflow** — captures Nepal-PABSON rule (typically: pass terminal exam by archetype-defaulted threshold + meet attendance min); archetype-defaulted; evaluated post-result-publish; flagged for operator review pre-decision. (Allen ISD's "70% Math AND English + 90% attendance" is structurally analogous, but our rule data comes from CEHRD/PABSON, not TEA.)
- D4. **`ExternalAssessment` family — Nepal-specific national exams** (see §3 for the full workflow):
  - `ExternalExamRegistration` — student-level registration to BLE / SEE / NEB-11 / NEB-12
  - `ExternalExamAdmitCard` — admit card metadata + S3 PDF pointer (school issues for BLE; school distributes NEB-issued for NEB)
  - `InternalAssessment` — per student × subject × external exam: school-graded internal marks (BLE 50%, SEE 25%, NEB-11/12 25%)
  - `ExternalExamResult` — per student × external exam: per-subject GPA + cumulative GPA (NEB only) + letter grade + status
  - `ExternalExamRetake` — Grade Increment (NEB) eligibility tracking
- D5. **`StudentAcademicTrack` entity (PABSON-simplified for V1)** — per-student grade-level progression + which board exam they will sit at end of basic education (BLE@G8), end of secondary (SEE@G10), and HS (NEB-11, NEB-12) if applicable. Allen ISD's `GraduationPlan` is structurally similar; we use it for the Nepal flow.

Note: **endorsements / endorsement-options / pathways / performance-acknowledgements are explicitly NOT in V1.** They were referenced in the Allen ISD example only to illustrate "developed-nation school districts model multi-year plans as data, not memory." Nepal schools do not use endorsements; we ship the data-driven multi-year plan in D5 without their complexity.

**Track E — Comply (CEHRD + Nepal MoE; partly in v2)** — updated per CEO 2026-05-20:
- E1. **Flash I export template + scheduler** (MVP only; iterate based on real CEHRD format; defaults to what pilot school's existing export looks like) [v2 F2 covers]
- E2. **Flash II export template + scheduler** (same MVP-first approach) [v2 F2 covers]
- E3. **Discipline / IEMIS Form-19 entity + minimal CRUD** — **SOFT requirement per CEO 2026-05-20** (was Q10 in v2 plan; can ship minimal but not blocker)
- E4. **Data residency commitment per tenant** — **Mumbai AWS (`ap-south-1`) confirmed acceptable per CEO 2026-05-20** [v2 G.1]
- E5. **Parental consent capture at user invite** [v2 G.2]
- E6. **Tenant data export endpoint** [v2 G.3]
- E7. **Scholarship-quota compliance check** — nice-to-have if easy hanging fruit per CEO 2026-05-20 (10%/12%/15% by enrollment band per CEHRD policy; FeeStructure entity already supports it)

**Track F — Generalize (validates the framework)**
- F1. Two-pilot smoke matrix — every parametric test runs against Saraswati + `dev-pabson-primary` [v2 covers]
- F2. **Synthetic GENERIC archetype validation** (non-NPR, non-BS, non-PABSON) — proves engine accepts a non-PABSON archetype with no code change; finance accepts USD; calendar Gregorian. [v2 K.4b covers]
- F3. ~~Synthetic US_K12_TX archetype validation~~ — **REMOVED per CEO 2026-05-20**. We are not building for Allen ISD. Generalization is proven by GENERIC archetype + pilot-2 PABSON school; no Allen-ISD-shape validation is in V1.

### 2.2 What V1.5 ships (post-Saraswati validation, before second PABSON school)

- V1.5-Plan: full per-period attendance + Timetable + Substitute (v2 Phase J)
- V1.5-Comply: DSAR + DR drill + cancellation state machine [v2 G.4-G.6]
- V1.5-Distribute: master schedule auto-generator (period × room × teacher × section grid); today is manual
- V1.5-Operate: NEB Grade 11/12 in-person operation (if pilot 2 operates HS; Saraswati only goes to Grade 10)
- V1.5-Communicate: parent-portal-side document inbox (parents already log in; surfaces issued documents in their portal)
- V1.5-Plan: Curriculum requirements matrix per grade — `{gradeLevel, subjectArea, minSubjects, archetypeId}` — dashboard says "Grade 10 student X is short on Science." V1 PABSON doesn't need this (all subjects compulsory at basic level per CDC); V1.5 unlocks elective tracking.

### 2.3 What V2 ships (mobile + advanced; explicitly deferred per CEO)

- V2-Mobile: native parent + student mobile apps (per CEO: end of roadmap)
- V2-Communicate: SMS provider integration (one-file drop-in via existing adapter interface defined in V1)
- V2-Plan: full IEP / accommodation workflow; intervention courses
- V2-Operate: biometric attendance integration
- V2-Distribute: school-website / advertising integration
- V2-Comply: real-time IEMIS portal API integration (V1 stays at CSV export)

### 2.4 Out of scope (permanently or until clear demand)

- LMS-style lesson plans, in-app classroom content delivery (this is not what EdForge is)
- HR / payroll subsystem (school's existing accountant software handles this)
- Transport route management
- Boarding/hostel residence management beyond basic capacity tracking
- Public APIs for 3rd-party integrations (V2.5+)
- Allen-ISD-style structures with no Nepal analogue (Endorsements, Distinguished Achievement, AP/IB testing infrastructure, GT identification, ARD/IEP, dual-credit transcripts)

---

## 3. Nepal National Exam Workflows — The Three Critical Flows V1 Must Support

The user explicitly flagged that V1 needs to support BLE (Grade 8) and NEB Grade 11/12 in addition to SEE (Grade 10). Below is the evidence-based summary from primary-source web research (full citations in §10).

### 3.1 BLE / BEE — Basic Level Examination (Grade 8)

**Authority:** Municipality / Metropolitan City Education Department (NOT CEHRD, NOT NEB). Operates under CDC Basic Level Curriculum standards.

**Frequency:** Annual, March (Chaitra)

**Internal / External weight:** **50% internal / 50% external** per CDC curriculum (different from SEE's 25/75 — important entity-level configuration).

**School's V1 operational role:**
1. Register Grade 8 students with the municipality (paper-based today; some municipalities have portal)
2. Conduct internal assessment per CDC rubric (attendance + presentation of learning outcomes 50% + subject activities 50%)
3. Submit internal marks to IEMIS portal (`emis.cehrd.gov.np`) by end of Falgun (mid-March)
4. Issue admit cards to students (school-issued, downloaded from municipality)
5. Students sit external exam at municipal exam center
6. Receive results from municipality 3-4 weeks post-exam via IEMIS
7. Promote students to Grade 9 (BLE pass NOT a legal gate; NG students still promote with remedial support)

**EdForge V1 entities needed:**
- `ExternalExamRegistration` (studentId, examType=BLE, municipalityCode, registrationDate, status)
- `InternalAssessment` (studentId, examType=BLE, subjectId, rubricCategoryId, score, maxScore, enteredBy, enteredAt) — CDC rubric ships in shared-types
- `ExternalExamAdmitCard` (studentId, examType=BLE, rollNumber, examCenterName, examDates[], pdfS3Url)
- `ExternalExamResult` (studentId, examType=BLE, subjectId, letterGrade, gpaPoints, status=passed|NG)

**Saraswati priority:** **HIGH — Saraswati operates Grade 8 (gradeRange PK→10 per dossier).** BLE is on Saraswati's actual roadmap for Spring 2027.

**Open questions (needs on-site confirmation at Saraswati):**
- Exact registration data format (paper, IEMIS portal upload, or both?)
- Admit card template specifics (QR codes? Per-municipality variants?)
- Internal assessment IEMIS schema (the CDC 50/50 rubric — how exactly does the school submit?)

### 3.2 SEE — Secondary Education Examination (Grade 10)

**Authority:** National Examination Board (NEB), under MoEST

**Frequency:** Annual, April (Baisakh)

**Internal / External weight:** **25% internal / 75% external**

**School's V1 operational role:**
- Same registration / internal-assessment / admit-card / result-import pattern as BLE
- 25% internal marks submitted to NEB (not municipality)
- Pre-board exam: see §3.4 (PABSON pre-board, opt-in)
- Result determines eligibility for Grade 11

**EdForge V1 entities needed:** Same `ExternalExamRegistration` / `InternalAssessment` / `ExternalExamAdmitCard` / `ExternalExamResult` shape — different exam type enum, different authority, different weight defaults.

**Saraswati priority:** **HIGH** — students will sit SEE end of Spring 2027.

### 3.3 NEB Grade 11 / Grade 12 — Higher Secondary

**Authority:** National Examination Board (NEB)

**Frequency:** Annual, April-May (Baisakh-Jestha)

**Internal / External weight:** **25% internal / 75% external** per subject; minimum 35% in theory + 40% in practical/internal per subject (threshold check needed in result entity)

**School's V1 operational role:**
1. Register Grade 11/12 students with NEB (deadline ~Mangsir 7, late November); submission includes SEE mark sheets
2. Internal assessment per subject (labs, assignments, school-based eval)
3. Distribute NEB-issued admit cards (delivered by end of Chaitra, mid-April)
4. Students sit external exam at NEB-designated centers
5. Practical exams (Science, Computer Science, etc.) at designated centers; school may host
6. Result via NEB portal `exam.neb.gov.np` ~5-6 weeks post-exam
7. Track Grade Increment (re-attempt) eligibility for students with NG ≤1 or D+ in all-except-2

**Streams:** Post-2025 curriculum eliminated rigid stream-based structures; subjects are now chosen across categories. Grade 11 compulsory: English, Nepali, Social Studies. Grade 12 compulsory: English, Nepali, Life Skill. Stream switch Grade 11→12: **needs on-site confirmation**.

**EdForge V1 entities needed:** Same `ExternalExamRegistration` / `InternalAssessment` / `ExternalExamAdmitCard` / `ExternalExamResult` shape + new `ExternalExamRetake` entity for Grade Increment.

**Saraswati priority:** **MEDIUM (architect for it, don't ship in-person flow yet)**. Saraswati operates Grade range PK→10 per dossier — does NOT operate Grade 11/12 in-person. But the V1 architecture must support NEB-11/12 because the next PABSON pilot school likely operates HS; segregating BLE-only vs NEB-only data models would be costly to refactor later.

### 3.4 PABSON Pre-Board — Opt-In Diagnostic Exam

**Authority:** PABSON (private-school umbrella organization, NOT a regulator)

**Frequency:** Annual, ~1 month before SEE (Magh 22-29 for 2082; ~Feb 5-12)

**Internal / External weight:** N/A — pre-board is a diagnostic / preparation exam, marks are school-managed.

**Organizational pattern (per Agent 2 research):** **Central + Regional Hybrid.** PABSON centrally sets schedule, but **regional district committees distribute question paper sets** (Kathmandu Set A/B/C/D ≠ Lalitpur ≠ Kaski). Marking is school-local. **Participation is opt-in** for PABSON member schools.

**Same pattern exists for Pre-BLE (Grade 8) — also PABSON-organized, also opt-in.**

**School's V1 operational role:**
1. Decide whether to participate (opt-in)
2. Receive question papers from PABSON regional district committee
3. Administer exam at the school
4. Mark and record per-student per-subject results
5. Optionally include in school's internal Term-N computation (school's decision)

**EdForge V1 entity scope:**
- `Exam.examType` enum extended with `pre_board` value (alongside `unit_test`, `terminal`, `final`)
- No separate `ExternalExamRegistration` row needed; pre-board marks live in the existing `Exam` + `ExamScore` entities (v2 D2 work)
- Result aggregation decision configurable per school: `gradingPolicy.includePreBoardInTermGrade: boolean`

**Saraswati participation status:** **Needs on-site confirmation.** Saraswati is PABSON-affiliated; likely participates, but operational pattern (do pre-board marks contribute to internal Grade 10 result?) is school-specific.

---

## 4. Document Rendering & School Branding Architecture

This section answers the user's explicit question: *"Four V1 templates: Invoice, Intimation Bill, Admit Card, Report Card. To properly do this, EdForge also needs to support School Org Branding / Identity on these cards. What technology to use? We are very cost sensitive."*

### 4.1 Evidence — what EdForge has today (per Agent 3 audit)

| Component | Current state |
|---|---|
| Per-school branding fields on entity | Only `School.logoUrl` (`packages/shared-types/src/schemas/identity/school.schema.ts:171`) — single URL, no signature, no address-as-branding, no color palette, no policy text |
| Tenant-level branding | `tenantBrandingSchema` exists (`tenant.schema.ts:75-81`) with `logoUrl, faviconUrl, primaryColor, secondaryColor, customDomain` — but this is tenant-wide (EdForge-level), NOT per-school |
| Per-tenant S3 asset bucket | Not provisioned in CDK; `tenantS3Bucket` referenced in `core-appplane-stack.ts:56` but no asset upload flow exists |
| PDF / Puppeteer / html-to-pdf code | None in `server/`. `jsPDF` installed in shell but unused. `Handlebars` is a transitive dep, not used for templates |
| Document templates (.hbs or otherwise) | None exist in `packages/shared-types/src/document-templates/` or any other location |
| AdminWeb upload UI for school branding | None |
| Field-governance for `logoUrl` | Marked `alwaysEditable` (`packages/shared-types/src/identity/field-governance.ts`) — permission model already permits school-level editing of branding |

**Gap summary:** EdForge has skeletal branding (logoUrl only) and zero infrastructure for rendering, asset storage, or template management. The product builds this entirely in V1 Track C.

### 4.2 Technology recommendation: AWS Lambda + Puppeteer + Handlebars

Per Agent 3's full cost analysis, **AWS Lambda + Puppeteer (via `@sparticuz/chromium` layer) + Handlebars templates** is the right V1 choice. Detailed comparison:

| Option | Per-PDF cost | Saraswati 2000/mo | 100-school 200K/mo | Design flexibility | AWS-residency | Verdict |
|---|---|---|---|---|---|---|
| **A. Lambda + Puppeteer + Handlebars** | ~$0.000043 | **~$1.50–$2/month** | **~$14–$20/month** | High (designers iterate `.hbs` in git) | ✅ ap-south-1 | ✅ **Recommended** |
| B. Lambda + pdfkit/pdf-lib (no headless browser) | ~$0.0000083 | ~$0.70–$1/month | ~$7–$10/month | Low (hand-coded SVG/PDF calls; non-designers cannot iterate) | ✅ | ❌ Design-iteration too slow |
| C. Hosted SaaS (DocRaptor/PDFMonkey) | ~$0.07–$0.10 | **~$150/month** | **~$15,000/month** | Medium | ❌ Data leaves AWS | ❌ Cost-prohibitive at scale; data residency fails |
| D. Client-side jsPDF (browser print) | $0 | $0 | $0 | High (browser dev) | n/a | ❌ No audit trail, no shareability via inbox, no historical archive |

**Decision:** Option A. Cost is rounding-error at Saraswati scale (~$2/month) and remains modest at 100-school scale (~$20/month). Data stays in ap-south-1 (residency requirement satisfied). Design iteration is fast (templates in git, designers own Figma → `.hbs` pipeline). Lambda cold-start latency (1-2s for chromium) is acceptable for per-student on-demand renders; bulk operations (end-of-month invoice run for all students) batch via EventBridge → SQS for full throughput.

### 4.3 Per-tenant branding architecture

**Asset storage (new):**

```
s3://edforge-tenant-assets-prod/
  {tenantId}/
    {schoolId}/
      branding/
        logo.png            (max 2MB, CloudFront-cached)
        principal-signature.png  (max 1MB)
        letterhead-background.pdf  (optional, max 5MB)
      invoices/             (rendered PDFs, lifecycle expire 90d)
      report-cards/         (rendered PDFs, lifecycle expire ~365d for transcript history)
      admit-cards/          (rendered PDFs, lifecycle expire 90d post-exam)
```

CDK addition to `tenant-template-stack-basic`:

```typescript
const tenantAssetsBucket = new s3.Bucket(this, 'TenantAssetsBucket', {
  versioned: true,
  enforceSSL: true,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [
    { prefix: 'invoices/', expiration: cdk.Duration.days(90) },
    { prefix: 'admit-cards/', expiration: cdk.Duration.days(90) },
    // report-cards retained for transcript reasons; archived to Glacier after 1y
  ],
  cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: [corsAllowedOrigins] }],
});
```

**New `SchoolBranding` schema (or extension of `School`):**

```typescript
// packages/shared-types/src/schemas/identity/school-branding.schema.ts (NEW)
export const schoolBrandingSchema = z.object({
  formalName: z.string().max(200),           // "Shree Saraswati Secondary English Boarding School"
  shortName: z.string().max(50).optional(),  // "SSSEB"
  address: schoolAddressSchema.optional(),
  contactEmail: emailSchema.optional(),
  logoUrl: urlSchema.optional(),
  principalSignatureUrl: urlSchema.optional(),
  letterheadBackgroundUrl: urlSchema.optional(),
  colorPalette: z.object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  }).optional(),
  feePolicyText: z.string().max(1000).optional(),
  examRulesText: z.string().max(1000).optional(),
  reportCardFooterText: z.string().max(500).optional(),
  brandingVersionId: z.string().uuid().optional(),  // for historical re-renders
  brandingVersionedAt: isoDateSchema.optional(),
});
```

**Upload endpoints:**
- `POST /schools/:schoolId/branding/assets` (multipart/form-data; ABAC: TenantAdmin + Principal write)
- `GET /schools/:schoolId/branding` (returns asset URLs + colors + policies)

**Template engine — Handlebars templates packaged in shared-types:**

```
packages/shared-types/src/document-templates/
  invoice.hbs
  intimation-bill.hbs
  admit-card.hbs
  report-card.hbs
  archetypes/
    pabson-default/
      invoice.hbs           (PABSON-style layout if PABSON-default differs from base)
      report-card.hbs       (CEHRD-compliant GPA + letter grade table)
      admit-card.hbs        (PABSON pre-board variant + BLE/SEE variant)
```

Each template accepts a render context:

```typescript
interface InvoiceRenderContext {
  school: { formalName, logoUrl?, address?, contactEmail?, colorPalette? };
  invoice: InvoiceDto;
  locale: 'en-US' | 'ne-NP';
  signature: { principalName, imageUrl? };
}
```

**Operator preview UI (AdminWeb or operator-side):**
- Upload logo + signature (multipart to `/schools/:id/branding/assets`)
- Text editors for fee policy, exam rules, report-card footer
- Color picker for palette
- Live preview of each of the 4 templates (rendered inline via iframe to dev rendering Lambda)
- Save (PATCH `/schools/:id/branding`)

**Versioning strategy:**
- When branding is updated, capture `brandingVersionId = uuid()` and `brandingVersionedAt = now()` on the School entity
- Each generated PDF stores `brandingVersionId` at render time
- Historical PDFs stay in S3 with the branding baked in; no need to re-render unless explicitly requested
- If operator says "regenerate last year's report card with current branding," that's an explicit operation; default is to preserve historical PDF as-issued

### 4.4 V1 rendering flow

```
[Operator clicks "Generate Invoice for Student"]
        ↓
POST /finance/invoices/:id/render
        ↓
Finance service:
  - Fetches Invoice + Student + Enrollment + School branding from DDB
  - Constructs render context
  - Invokes DocumentRendererLambda (direct SDK call, NOT EventBridge for synchronous case)
        ↓
DocumentRendererLambda:
  1. Load handlebars template (invoice.hbs) from packaged layer
  2. Render HTML with render context
  3. Boot chromium (cold start: ~1-2s; warm: ~100ms)
  4. PDF print HTML → buffer
  5. Upload buffer to s3://edforge-tenant-assets/{tenantId}/{schoolId}/invoices/{invoiceId}.pdf
  6. Generate signed URL (15-min TTL for operator download; longer-TTL inbox link via separate endpoint)
  7. Return { pdfS3Key, signedUrl, brandingVersionId } to caller
        ↓
Finance service:
  - Persists invoice.pdfS3Key + invoice.brandingVersionId
  - Emits invoice.rendered event
  - Returns signed URL in response to operator
        ↓
Operator downloads / prints / shares via inbox.
Parent gets in-app notification (Track B) → opens inbox → clicks invoice → fresh signed URL generated.
```

**Bulk operations (end-of-month):**
```
EventBridge scheduled rule (1st of month, 00:00 Kathmandu local)
        ↓
Bulk-render-orchestrator Lambda
        ↓
For each active enrolment:
  - Push render-job message to SQS (FIFO; per-school message group)
        ↓
DocumentRendererLambda consumes from SQS at Lambda concurrency limit
        ↓
Renders each invoice; uploads to S3; emits invoice.rendered event per PDF
        ↓
Failures land in DLQ with CloudWatch alarm on depth ≥ 1
```

---

## 5. Architecture Anchors (recap; non-negotiable for V1)

These are the bright lines from CLAUDE.md + sprint-plan.md §4 invariants:

1. **Service + DB layer archetype-agnostic.** `grep -rn 'archetype' server/application/microservices/*/src/` returns zero hits outside the boundary-driver registry. Invariant 12 amended to: *"zero hits in service code, excluding files explicitly listed in the boundary-driver registry"* — current registry: `iemis-transform.ts`.
2. **Ed-Fi V6 as the data foundation.** Every new entity maps to an Ed-Fi resource. New entities NOT in Ed-Fi V6 core (PromotionRule, ArchetypeDefaults, ReportCard, SchoolBranding) land under the `edforge:` extension namespace (invariant 11).
3. **`archetypeDefaults` is the only place archetype-specific data lives in the runtime.** PABSON profile, future GENERIC profile — all data, no code.
4. **Two-pilot parametric smoke matrix from D0 onward.** Every test runs against Saraswati AND `dev-pabson-primary`. K adds synthetic GENERIC.
5. **Three-way route handoff** (Nest controller + tenant-api-prod.json + nginx.template) for every new endpoint.
6. **Module-wiring spec invariant** — every new NestJS module updates `module-wiring.spec.ts` in the same PR. Academics needs one (currently missing per daily-use audit gap #8).
7. **Shared-types pin discipline** — minor bumps in lockstep across `server/package.json` + `server/application/package.json` + lockfile in the same PR.
8. **Audit + event emission pairing** — every write through `auditedWrite()` + emits a registered Zod-validated event. Academics service is missing the `AuditedWriteService` infrastructure (Risk R17 in v2 plan); blocking debt for K.5 multi-school.
9. **No pilot-specific names in code.** Pilot names live in fixtures + dossiers only.
10. **Operator stamp is the V1 acceptance gate**, not engineering's claim.

---

## 6. The Bridge — What We LEARN from Allen ISD vs What We BUILD for Nepal

Re-framed per CEO 2026-05-20: Allen ISD is a learning reference; the build is for Nepal. This table maps lessons → Nepal application → V1 build.

| Structural principle we LEARN from Allen ISD | How Nepal/PABSON schools handle it today | What EdForge V1 BUILDS for Nepal |
|---|---|---|
| Documented mission + graduate profile per district | Verbal — "we focus on character + academics" | Optional `mission` + `graduateProfile[]` on `School`; archetype-defaulted templates (PABSON-default ships) — minor V1 task |
| Canonical course code system | Free-text course names | Structured `Course.code` validated per `archetypeDefaults.courseCodeFormat` (CDC subject code + grade + section); `Course.localCourseCode` retains operator-friendly free text |
| Subject decoupled from Course (subject ≠ course-instance) | Implicit — "Math is what the Math teacher teaches" | NEW `Subject` entity, CDC-aligned for PABSON (Nepali, English, Mathematics, Science, Social Studies, Health/Physical/Creative Arts, Computer Sci, optionals) |
| Course level / variant | Almost none — informal "Advanced Math" in the teacher's head | `Course.level` enum (Regular, Honors); minimal V1; expand later only if pilot demand |
| Prerequisites enforced at enrollment | None | `Course.prerequisites[]` enforced at section-enrollment time (V1.5 if not blocker for Saraswati) |
| Standardized assessment hard-wired to promotion | SEE@G10 results determine Grade 9-10 transition; BLE@G8 nominally determines G8→G9 (but not legally gating) | NEW `ExternalAssessment` family + `PromotionRule` references it; SEE result import determines Grade-10 promotion eligibility |
| Documented promotion rule as data | Per-school discretion + paper register | NEW `PromotionRule` entity; archetype-defaulted; batch evaluation post-term-result-publish |
| Multi-year personal academic plan | None | NEW `StudentAcademicTrack` entity; tracks grade-level + which board exam ahead (BLE@G8, SEE@G10, NEB@G11/12) |
| Master schedule as data | Manual Excel | V1: existing `Section.classPeriodId` + `Section.locationId`; auto-generator in V1.5 |
| Per-archetype graduation/track requirements | None formal | V1.5 `CurriculumRequirement` (optional electives mainly; PABSON basic-level is mostly compulsory subjects) |
| Document branding + canonical printable artifacts | Excel + Word doc per school | NEW Document Rendering Service + per-school `SchoolBranding` + 4 templates (§4 above) |

**Things we explicitly do NOT build** (Allen ISD has them; Nepal doesn't need them in V1, and may never need them):

| Allen ISD concept | V1 status | Rationale |
|---|---|---|
| Endorsements (5 pathways) + Options + Pathways | NOT in V1 | Saraswati and most PABSON schools don't operate endorsement model |
| Distinguished Level of Achievement | NOT in V1 | Equivalent honor concept ("SEE distinction") is just `ExternalExamResult.distinction: boolean` |
| Performance Acknowledgements (5 categories) | NOT in V1 | Nepal schools track 1-2 informally (scholarship, SEE distinction); ship as boolean flag if needed |
| GT identification + GEMS courses | NOT in V1 | No equivalent program in PABSON schools |
| ARD / IEP / IDEA workflow | NOT in V1 | Special-needs accommodation is informal; out of scope until V2 |
| Emergent Bilingual (Sheltered) variants | NOT in V1 | English-medium default; no formal ESL pathway |
| 12 CTE clusters + pathways | NOT in V1 | CDC tracks NEB-Grade-11/12 are simpler stream structure (now mostly abolished post-2025) |
| Six-year personal graduation plan | V1 simplified | We ship `StudentAcademicTrack` (D5); single-track per student per archetype rule |
| Texas-Virtual-School-Network style cross-district enrolment | Permanent NO | Not a Nepal-relevant concept |
| No-Pass-No-Play eligibility rule engine | NOT in V1 | Coach-discretion in Nepal; could ship in V1.5 if pilot demand |
| State-test (STAAR/EOC) integration | NOT in V1 | Nepal equivalents are BLE/SEE/NEB; handled separately via `ExternalAssessment` family |

**Net:** Allen ISD's 22-concept framework gives us ~10 structural lessons that directly apply to Nepal. The other 12 are skipped — they're cultural / regulatory artifacts of Texas + USA K-12, not transferable.

---

## 7. CEHRD / Nepal MoE Compliance Scorecard (updated per CEO 2026-05-20)

### 7.1 Must-have (V1 blocking)

1. **IEMIS submission MVP** — Flash I (intake/enrollment) + Flash II (output/retention) [v2 F2 covers]
   - **CEO direction:** MVP only; iterate to perfect; default templates to what pilot schools provide in their own existing export
2. **Mandatory student records maintained** — admission, attendance, marks, fees, transfers [✅ all maintained in current data model]
3. **4-point CEHRD GPA scale** — A+ through NG with documented percentage bands [⚠️ today hardcoded to US A-F; Track D-Plan D2]
4. **Bikram Sambat date support on input + storage of Gregorian** [✅ shipped]
5. **Government-approved fee structure** — 14 permitted fee categories [⚠️ FeeStructure entity supports it; scholarship enforcement = nice-to-have]
6. **Language-of-instruction declaration** [N/A — DEFER per CEO 2026-05-20]
7. **Mandatory parental/guardian consent for minor data** [v2 G.2]
8. **Data residency commitment** — **Mumbai AWS confirmed acceptable per CEO 2026-05-20** [v2 G.1]

### 7.2 Should-have (V1 strongly recommended; expanded per CEO 2026-05-20)

1. **BLE workflow** — Grade 8 registration + internal assessment + admit card + result import (Saraswati Spring 2027) [§3.1; Track D-Plan D4]
2. **SEE workflow** — same pattern for Grade 10 (Saraswati Spring 2027) [§3.2; Track D-Plan D4]
3. **NEB Grade 11/12 workflow** — **moved from V1.5 to V1 per CEO 2026-05-20.** Saraswati doesn't operate HS, but V1 must architect to support it [§3.3; Track D-Plan D4]
4. **PABSON pre-board exam type** — `pre_board` exam type, opt-in [§3.4; Track D-Plan as part of v2 D2 Exam Subsystem]
5. **Discipline / IEMIS Form-19 incident tracking** — **SOFT requirement per CEO 2026-05-20** (was Q10 in v2 plan)
6. **Cross-school EMIS ID handling** (transferred-in students keep prior EMIS ID per IEMIS allowance) [⚠️ surfaced in IEMIS import-review; warning fires but no policy enforcement]

### 7.3 Nice-to-have (V1.5+)

1. **Scholarship-quota compliance check** — easy-hanging-fruit per CEO 2026-05-20 if cheap to ship
2. Real-time IEMIS portal API integration (V1 stays at CSV export; portal upload is operator action)
3. Multi-language UI (Nepali + English)
4. Mother-tongue medium instruction policy for Grades 1-3 (CDC requirement; not enforced by V1)

### 7.4 Open research questions (resolved 2026-05-20 + remaining)

✅ **Resolved by CEO 2026-05-20:**
- CEHRD submission deadline timing — flexible
- Form-19 disciplinary requirement — SOFT
- Flash I + Flash II exact column schemas — **MVP only; default to what pilot schools provide as their existing export; iterate over multiple cycles**
- Scholarship enforcement audit — nice-to-have, easy-hanging-fruit
- Data residency Mumbai AWS — YES acceptable
- Language-medium declaration — N/A, deferred

✅ **Resolved by Agent research 2026-05-20:**
- BLE authority — Municipality / Metropolitan City (NOT CEHRD); 50% internal / 50% external
- NEB Grade 11/12 — 25% internal / 75% external; annual April-May; results via `exam.neb.gov.np`
- PABSON pre-board — central paper / regional distribution / opt-in / school-managed marks

🔴 **Still open — needs on-site confirmation at Saraswati (per agent research):**
- BLE registration exact data format (paper, IEMIS portal upload, or both?)
- BLE admit card template specifics (per-municipality variants?)
- Internal assessment IEMIS schema (CDC 50/50 rubric submission format)
- Saraswati's actual PABSON pre-board participation + whether pre-board marks feed term grade
- Saraswati's co-teaching practice (v2 Q9)
- Specific operational gaps from Saraswati's first 2 weeks of in-person operation

---

## 8. Remaining Research Before Master Sprint Can Be Greenlit

After this v0.2 framework + the v2 sprint plan + the 3-agent research, three categories remain:

### 8.1 On-site ground truth (HIGH priority; user already approved)

1. **Saraswati 1-2 day on-site observation** — shadow principal, accountant, class teacher, subject teacher in actual daily ops. Capture screens touched, paper-printed, parent-communication channels, adoption barriers since 2026-05-18.
2. **Resolves the remaining 🔴 questions in §7.4** — BLE registration format, IEMIS internal-assessment submission format, Saraswati pre-board participation.
3. **Second PABSON school discovery** — once a candidate signed, 0.5-day call to validate archetype-level vs school-specific patterns. Pre-flight that prevents v2 K.2 invariant-13 grep from surfacing late drift.

### 8.2 CEHRD primary-source confirmations (MEDIUM priority; can run in parallel)

1. Flash I + Flash II official column schemas — defer to pilot-schools-provide approach per CEO
2. Form-19 disciplinary-incident definition — confirmed SOFT, so non-blocking
3. PABSON regional structure validation — confirmed central paper / regional sets (Kathmandu/Lalitpur/Kaski distinct)
4. Scholarship-quota audit posture — nice-to-have

### 8.3 Internal architectural decisions (HIGH priority; tactical for v2 plan)

1. **Academics `AuditedWriteService` infrastructure** — Risk R17 in v2 plan. Port the identity-service pattern before K.5 (multi-school).
2. **PascalCase event migration timing** — already absorbed into v2 E.8; confirm before D2 ships.
3. **`archetypeDefaults` table schema + initial seeding** — today implicit in code; needs explicit entity + loader before Track D-Plan tickets can land cleanly. Schema sketch in §1.2.
4. **Module-wiring spec for academics** — Risk R19 in v2 plan; ship in D1.
5. **Track D-Plan V1 carve-out decision** — D1 (Subject) and D2 (GradingPolicy pluggability) and D3 (PromotionRule) are V1-blocking; D4 (ExternalAssessment family for BLE/SEE/NEB) is the new big-ticket V1 item per §3 work; D5 (StudentAcademicTrack) can be V1.5 if needed.

### 8.4 Product / business decisions (MEDIUM priority)

1. **Pricing model** — when does Saraswati transition from design partner to paying customer?
2. **Pilot 2 candidate identification** — Risk R15 in v2.
3. **Hypercare on-call rotation** — Risk R7 in v2.
4. **Legal/operations point-of-contact** — v2 Q3.
5. **Adoption signal definition** — telemetry threshold for "adopted."

---

## 9. Definition of Green (Pilot-Adoption Greenlight)

V1 is "Green" when ALL five gates hold:

### 9.1 Engineering Green
- v2 D0a → D3 + F1 + F2 + G + H closed
- Track D-Plan D1-D3 minimum shipped; D4 (ExternalAssessment family) shipped for BLE + SEE + NEB-11/12 architectural support
- Track B-Communicate MVP (in-app inbox + SES + notice) live
- Track C-Distribute MVP (Document Rendering Service + 4 templates + School branding entity + asset upload UI) live
- Two-pilot parametric smoke matrix green (Saraswati + `dev-pabson-primary`)
- Synthetic GENERIC archetype smokes green
- Cross-tenant 500 → 403 fix landed
- Academics `auditedWrite` + module-wiring shipped
- All v2 risk register P0/P1 risks closed or accepted

### 9.2 Operator Green (the decisive gate)
- Saraswati accountant runs full monthly billing cycle (auto-generate → render PDF with school branding → distribute via in-app inbox + SES → track → reconcile) without escalation for 30 consecutive days
- Saraswati class teacher walks Term-1 end-to-end (exam schedule → marks → result → branded report card PDF → distribute → parent acknowledged) without escalation
- Saraswati principal sends 5+ targeted parent messages + 3+ school-wide notices in a month
- Saraswati operator says in their own words: "we can run our school on this now"

### 9.3 Compliance Green
- Flash I + Flash II generated, operator-reviewed, CEHRD-submission-ready (MVP only per CEO)
- Tenant data export tested on Saraswati (G.3)
- Parental consent captured for all minor user invites
- Data residency commitment documented (G.1)
- Discipline tracking minimal CRUD shipped (soft requirement)

### 9.4 Adoption Green (quantitative)
- ≥5 daily-active operators on Saraswati
- ≥1 write/day per persona (principal, class teacher, accountant)
- Parent portal opens ≥60% in week-1 of monthly bill cycle (with branded invoice PDFs)
- Zero P0/P1 incidents in 30-day hypercare
- 7 consecutive days of CloudWatch: zero `INVALID_PAYLOAD`, zero unhandled 5xx, p95 < 1.5s

### 9.5 Generalization Green (the framework-proof gate)
- Pilot 2 (second PABSON school) provisioned via data-only drop; reaches activation via UI without engine code change
- Synthetic GENERIC archetype smoke passes
- `grep -rn 'archetype' server/application/microservices/*/src/` returns zero hits outside boundary-driver registry

When all five Green gates hold, EdForge is V1 GA. Until then, EdForge is V1-pilot. Saraswati is operator-stamped; EdForge revenue path opens with Pilot 2.

---

## 10. Primary Source Citations

### BLE / BEE (Grade 8)
- [Basic Level Examination (Nepal) — Wikipedia](https://en.wikipedia.org/wiki/Basic_Level_Examination)
- [Kathmandu Metropolitan City Grade 8 BLE — EducateNepal](https://blog.educatenepal.com/2025/04/kmc-grade-8-basic-level-examination-ble.html)
- [Curriculum Development Center Nepal](https://moecdc.gov.np/en/curriculum)
- [BLE Grading System (CDC scale)](https://nebgpacalculator.com/ble-grading-system-nepal/)
- [BLE Pass Marks Policy](https://nebgpacalculator.com/ble-pass-marks-nepal/)

### NEB Grade 11 / 12
- [National Examination Board — Wikipedia](https://en.wikipedia.org/wiki/National_Examination_Board_(Nepal))
- [NEB Class 12 Exam Routine 2083 — Union Nepal](https://www.unionnepal.com/neb-class-12-exam-routine)
- [Grade 11 and 12 New Curriculum (post-2025) — Edusanjal](https://edusanjal.com/news/grade-11-12-new-curriculum/)
- [NEB Grade 11 Enrollment Criteria — Edusanjal](https://edusanjal.com/blog/enrollment-criteria-neb-grade-11/)
- [NEB Grade Increment (Supplementary) Exam Routine — Edusanjal](https://edusanjal.com/news/grade-11-supplementary-grade-increment-examination-routine-neb/)
- [NEB Login Portal](https://exam.neb.gov.np/)

### PABSON pre-board
- [PABSON SEE Pre-Board Exam Routine 2082 — EducateNepal](https://www.educatenepal.com/news/detail/pabson-see-pre-board-exam-routine)
- [PABSON SEE Pre-Board Reschedules — Edusanjal](https://edusanjal.com/news/pabson-reschedules-see-pre-board-exams/)
- [PABSON Send-Up Examination — Readersnepal](https://www.readersnepal.com/pabson-send-up-examination-question-of-all-subjects)
- [Pre-BLE Exam Schedule 2082 — Edusanjal](https://edusanjal.com/news/pre-basic-education-exam-schedule-pabson/)

### IEMIS
- [IEMIS Portal](https://emis.cehrd.gov.np/)

---

## 11. How This Document Relates to Existing Plans

| Document | Layer | Status |
|---|---|---|
| `sprint-plan.md` (v1) | Phase A/B/C ticket detail + invariants (§4) + DoDs (§10/§11) + pilot dossier contract (§13) | ✅ Authoritative for Phase A/B/C |
| `sprint-plan-update-2026-05-19.md` (v2) | Tactical sprint plan D0a → K with 21-item risk register | 🟡 Draft pending sign-off; this framework extends |
| `c4-ops-sprint-plan.md` | ENG-1 + ENG-2 IEMIS fast-follows | 🟡 In flight; folded into v2 D0a |
| `daily-use-coverage-audit-2026-05-19.md` | ~55% coverage baseline | ✅ Drove v2 plan revisions |
| `iemis-import-review-2026-05-19.md` | Saraswati post-mortem | ✅ Reference for D0a |
| `deferred-work.md` | Items consciously deferred from critical path | ✅ Living document |
| **`v1-master-framework.md` (this doc, v0.2)** | **Strategic framework: structural learnings → Nepal application; Track D-Plan + BLE/NEB workflows + Document Rendering architecture; Yellow → Green criteria** | 🟡 v0.2 drafted (post-CEO feedback) |

**Action when signed off:**
1. v2 plan absorbs Track D-Plan D1-D4 minimum + Track C (Document Rendering) as new sub-sprints (between D3 and E in v2 timeline).
2. v2 plan §10 risk register adds:
   - R22: Track D-Plan ExternalAssessment family late
   - R23: Document Rendering Lambda cold-start budget breach
   - R24: `archetypeDefaults` entity not built yet, blocks D-Plan
   - R25: School branding asset bucket per-tenant scope mismatch with tenant-template-stack-basic
3. v2 plan §11 open questions:
   - ✅ Q9 (co-teaching) — needs Saraswati on-site
   - ✅ Q10 (Form-19) — resolved SOFT
   - Add Q12 (Track D-Plan V1 vs V1.5 carve-out): D1+D2+D3+D4 V1; D5 V1.5
   - Add Q13 (Pricing model)
4. v1 plan §0.5 status snapshot updates Yellow → Green criteria pointing at §9 here.

---

## 12. What This Document Deliberately Does NOT Do

- Does not propose any code change
- Does not replace the v2 tactical sprint plan
- Does not re-scope Saraswati's already-shipped Phase A/B/C work
- Does not commit anything
- Does not propose a specific date for pilot-adoption greenlight — operator-stamp gated
- Does not address pricing — business decision outside engineering scope
- Does not propose mobile app delivery (V2)
- Does not propose SMS V1 (explicitly deprioritized by CEO)
- Does not propose Allen-ISD-shape entities (Endorsements, ARD/IEP, GT, CTE clusters, Performance Acknowledgements, Distinguished Achievement) — these are Allen-ISD-as-target framing, explicitly out of V1 per CEO 2026-05-20
- Does not synthesize US_K12_TX archetype validation — removed per CEO 2026-05-20

---

## 13. One-Page Summary

**Where we are:** Yellow. Saraswati activated through UI 2026-05-18; ~55% daily-use coverage; ENG-1/ENG-2 in flight; Phase D not started.

**What's been built:** Phase A (foundation), Phase B (calendar fidelity), Phase C (event taxonomy + hardening + pilot fixtures + Saraswati activation). Architecture is archetype-agnostic at service+DB layer with one known exception (IEMIS import driver, acceptable boundary).

**What's missing for V1 (6 Tracks):**
1. **Operate**: Exam → Result → ReportCard pipeline (v2 D2-D3)
2. **Communicate**: in-app inbox backend + SES + notice (Track B)
3. **Distribute**: Document Rendering Service + School Branding + 4 templates (Track C) — Lambda + Puppeteer + Handlebars, ~$2/month Saraswati, ~$20/month at 100-school scale
4. **Plan**: Subject + GradingPolicy pluggability + PromotionRule + **ExternalAssessment family for BLE + SEE + NEB-11/12** + StudentAcademicTrack (Track D)
5. **Comply**: Flash I/II MVP + discipline soft + residency Mumbai + consent (Track E partial in v2 F2/G)
6. **Generalize**: second pilot + synthetic GENERIC (Track F + v2 K)

**Remaining research:**
1. Saraswati on-site (1-2 day visit) — resolves operator Qs + BLE/SEE registration format + Saraswati pre-board participation
2. CEHRD primary-source MVP confirmations — defer to pilot-schools-provide approach
3. Internal: `archetypeDefaults` entity, academics audit infra, academics module-wiring, Track D-Plan V1 carve-out
4. Product: pilot-2 candidate, pricing model, hypercare on-call

**Definition of Green:** 5 gates — Engineering / Operator / Compliance / Adoption / Generalization. All five hold = V1 GA.

**Allen ISD's role:** Learning reference for structural discipline. We absorb the structural lessons (data-driven curriculum, machine-actionable promotion, multi-year plan-as-data, document branding) and apply them to Nepal-specific entities (BLE, SEE, NEB, CDC subjects, CEHRD GPA scale, IEMIS export). We do NOT build Allen-ISD-specific concepts (Endorsements, ARD/IEP, GT, CTE clusters, Distinguished Achievement, Performance Acknowledgements, dual-credit, AP/IB infrastructure).

**Revenue path:** Saraswati operator stamp opens credible referral to Pilot 2. Pilot 2 onboarding via data-only drop proves the framework. With two PABSON schools running, EdForge has a credible "structured EMIS for Nepal" sales story. Pricing model + sales motion stands up alongside Pilot 2 hypercare.

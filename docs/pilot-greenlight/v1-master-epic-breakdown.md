# EdForge V1 Master EPIC Breakdown

> **Drafted:** 2026-05-20
> **Revised:** 2026-05-22 (v3.4 — research-resolved concrete decisions land; 3 of 4 🔬 blockers resolved)
> **Status:** 🟡 Draft — atomic-ticket plan, ready for execution
> **Companion docs:**
> - Strategic: [`v1-master-framework.md`](./v1-master-framework.md) — the 6-track framework this breakdown executes
> - Tactical predecessor: [`sprint-plan-update-2026-05-19.md`](./sprint-plan-update-2026-05-19.md) — v2 sprint plan; this doc is the v3 reorganization
> - Foundational: [`sprint-plan.md`](./sprint-plan.md) §4 invariants + §10/§11 DoDs remain authoritative
> - Field guide: [`edforge-champion-nepal-discovery-brief.md`](./edforge-champion-nepal-discovery-brief.md)
> - Pilot dossier: [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md)
> - **Research artifacts (v3.4 inputs):**
>   - [`a2-subject-vs-course-decision.md`](./a2-subject-vs-course-decision.md) — Subject-vs-Course architectural decision
>   - [`d4-ble-design.md`](./d4-ble-design.md) — BLE Grade 8 workflow design + entity shapes
>   - [`e1-flash-csv-schema.md`](./e1-flash-csv-schema.md) — CEHRD Flash I/II column-by-column schemas
>   - [`research-prompts.md`](./research-prompts.md) — the prompts that drove the artifacts

---

## 0. Philosophy (v3.3, 2026-05-22)

EdForge is building a **complete Nepal-archetype EMIS product**. Our work is not paced by any single pilot school's calendar or adoption rate. Specifically:

1. **We do not chase the school's term dates.** Saraswati's AY 2083 is already in session in Nepal; that does not influence our master-plan priorities or velocity.
2. **We do not measure adoption on a half-baked product.** Adoption metrics are noise until the product is feature-complete for Nepal-archetype private schools. We finish the product first; adoption follows naturally.
3. **We do not wait for on-site visits as a precondition for design.** Field trips are slow and not a sustainable bottleneck. We design from **primary sources** (CEHRD / NEB / CDC published docs), **our existing codebase**, the **Allen ISD reference framework** (already studied), and **prior agent research** (URLs we've already collected). Iterate; ship; observe; refine.
4. **Agile + agentic, not waterfall.** No stakeholder hands us a fully-specified RFC. We build, test thoroughly, gate behind invariants, ship; if the design proves wrong, we refactor in the next sprint.
5. **The goal is product completeness, then natural adoption, then revenue, in that order.**

Schools (Saraswati and others) are users of what we build, not designers of it. Their feedback is welcome and useful, but it is a refinement signal — never a blocker for V1 completion.

---

## 0.3 v3.4 Research-Resolved Concrete Decisions (Quick Reference for Engineers)

Three of the four V1 🔬 research blockers were closed via internal research on 2026-05-22 (artifacts under `docs/pilot-greenlight/`). The decisions below now drive ticket-level work; the older 🔬 markers on these sprints are resolved.

### A.2.0 — Subject vs Course Architecture → **Decision: Option (B): Extend `Course`. NO separate `Subject` entity.**

| Aspect | v3.3 assumption | v3.4 decision (from [`a2-subject-vs-course-decision.md`](./a2-subject-vs-course-decision.md)) |
|---|---|---|
| Subject as entity | Plausibly a new `Subject` entity (separate CRUD, FK from Course) | **Rejected.** Ed-Fi V6 treats subject as `AcademicSubjectDescriptor` *on the Course*; no separate `Subject` resource exists in core Ed-Fi |
| Multi-track (CDC + Cambridge) | Implicit | Two `Course` rows sharing same `academicSubject` descriptor but distinct `curriculumRef` |
| Mark entry path | Through Subject FK | Through `Section → Course → academicSubject` aggregation; matches existing `Grade.courseId` pattern |
| Grades 1-3 (Integrated curriculum, K-3 thematic) | Not addressed | **Open follow-up — V1.5 deferred.** Ed-Fi `LearningStandardGrade` is the canonical path; not pilot-blocking (Saraswati Term-1 runs Grades 4-10 BLE-prep) |

**Concrete schema added to existing `Course` entity:**
```typescript
academicSubject: string;           // descriptor: "mathematics" | "science" | "english" | …
stateSubjectCode?: string;         // NEB/CDC code (e.g., "004" for English)
curriculumRef: 'CDC_NCF_2076' | 'CAMBRIDGE_IGCSE' | 'IB_MYP';
```

### D.4.0 — BLE (Grade 8) Workflow → **Decision: 3 entities + CSV-only IEMIS strategy + per-school MunicipalityConfig.**

From [`d4-ble-design.md`](./d4-ble-design.md):

- **Authority + flow:** Municipality-run; registration → 50/50 CAS+external → IEMIS portal-published ledger result. NO IEMIS API exists (confirmed across all three research artifacts). V1 = CSV/Excel export/import only.
- **Entity shapes** (now concrete on `ExternalAssessment` family, Sprint D.3): `BleRegistration` (status: DRAFT|SUBMITTED_TO_IEMIS|SYMBOL_ASSIGNED), `BleInternalAssessment` (CAS breakdown: unitTests/projectWork/participation/totalInternal/50), `BleResult` (externalMark/50, letterGrade A+/A/B+/B/C+/C/D/NG, gradePoint 4.0 scale, isSupplementary boolean).
- **Per-municipality variation:** ONE schema; configurable export headers/logos via `municipalityConfig` on **SchoolConfiguration** (per audit: Tenant is wrong scope — multi-school tenants → multi-municipality; School is correct scope). New ticket E.0.2.
- **Supplementary (Grade Increment) flow:** Required. NG ≤3 subjects → re-exam window opens Baishakh 6-12 (~2 weeks post main result). NEW ticket D.4.7.
- **Admit-card distribution:** Municipality generates official symbol numbers; school prints + distributes. EdForge generates the PDF artifact via Document Rendering Service (EPIC-C); fields list landed concrete (research §11.5).

### E.1.0 — Flash I/II CSV Schemas → **Decision: Concrete column schemas + csv-stringify + S3-versioned templates + pre-flight validation.**

From [`e1-flash-csv-schema.md`](./e1-flash-csv-schema.md):

- **No IEMIS API:** Confirmed independently. V1 = CSV/Excel manual upload via emis.cehrd.gov.np.
- **Flash I (intake/Jestha mid-June):** 13 columns at student-row level — `school_iemis_code, academic_year_bs, student_iemis_id, first_name, last_name, dob_bs, gender, caste_ethnicity, mother_tongue, disability_type, grade_level, stream, enrollment_type, has_eced_exp`.
- **Flash II (outcomes/Chaitra mid-March):** 10 columns at student-row level — `school_iemis_code, academic_year_bs, student_iemis_id, grade_level, total_attendance_days, scholarship_type, scholarship_amount, exam_total_marks, exam_gpa, academic_status (Passed | Passed_Transfer | Repeated | Repeated_Transfer | Dropout)`.
- **Engine choice:** `csv-stringify` stream-based (NOT Handlebars — Handlebars risks memory bloat for 2000-row CSV in Lambda).
- **Schema versioning:** Template column mappings stored as JSON config in S3 (NOT hardcoded in Lambda) — lets CEHRD header-rename hotfixes ship without backend redeploy. NEW ticket E.1.2 reframed.
- **Pre-flight validation:** UI surfaces row-level errors (e.g. "15 students missing IEMIS ID in Grade 8") BEFORE allowing CSV download. IEMIS rejects entire Excel upload on row-level validation fail; pre-flight prevents wasted operator round-trips. NEW ticket E.1.5.
- **Forms 7 / 2 / 19:** Research found these are NOT modern CEHRD forms (absent from public sources). Likely legacy district-era. **Removed from EPIC-E scope.**

### Cross-cutting findings from all three artifacts

1. **NO IEMIS / NEB / Municipality REST API** — confirmed three times independently. V1 IEMIS strategy locked: CSV/Excel export/import only. Future API integration is V2+ scope.
2. **9-digit IEMIS School Code** — confirmed canonical national identifier. Already on Tenant/School; cross-referenced in BLE registration + Flash I/II + admit cards.
3. **Student.emisStudentId** is the cross-school tracking ID assigned by IEMIS on first entry. Already on Student entity (per existing schema audit). Research called this `stateId`; same field.
4. **Missing demographic field gap (Flash I requires):** `Student.hasEcedExperience` (boolean for Grade 1 entrants) — NEW ticket E.0.1. All other Flash I/II fields (motherTongueDescriptor, ethnicityDescriptor, disabilities, scholarshipCategory, sexDescriptor, isTransferred, previousSchool, emisStudentId) are already on the Student entity (per audit).
5. **MunicipalityConfig location decision:** Belongs on **SchoolConfiguration**, not Tenant or WorkspaceSettings. Reason: a tenant can hold multiple schools across municipalities; per-school is the right scope. NEW ticket E.0.2.
6. **Letter Grade scale extends to `NG`:** GradingPolicy must accept `NG` (Not Graded) as a valid terminal grade for BLE/SEE. Confirm Sprint D.1 GradingPolicy schema accepts it.
7. **Allen ISD reference confirmed structurally analogous:** STAAR (Texas) → BLE/SEE (Nepal) workflow shape maps 1:1. PEIMS (Texas) → Flash I/II (Nepal) baseline-then-outcomes split confirmed. Architecture stays archetype-agnostic at the engine layer, archetype-specific at the boundary (templates, CSV export schemas, admit-card layouts).
8. **One open gap (V1.5 deferral):** Grades 1-3 integrated/thematic curriculum modeling. Saraswati's BLE-prep cohort (Grades 4-10) is V1; K-3 integrated grading lands V1.5 via Ed-Fi `LearningStandardGrade`.

The full synthesis with cascading risk + dependency impact is in §17 below.

---

## 0.4 Sprint Status (rolling) — what's shipped to prod

> **Updated:** 2026-05-27 PM (post-letterhead-revert) — **EPIC-C C.1 + branding (M2 + M3) all 🟢 shipped to prod**, with **custom letterhead upload V1.5-deferred** per Path E decision after C.1.8/C.1.9 prod testing showed that operator-uploaded letterhead PNGs (regardless of `objectFit` strategy) produce unprofessional rendering for the typical school-operator-designed source. C.1 backend stacked deploy shipped 2026-05-26 (commit `d2cf929`). C.1.6 frontend stack (23 PRs across M0/M1/M1.5-FU) shipped 2026-05-26 to Vercel. M2 Branding read (PR #88) + M3 phase 1 (PR #89) shipped 2026-05-26. M3 phase 2 asset uploads (FE PR #90 + server hotfixes #209 + #210) shipped 2026-05-27 morning. **C.1.8 letterhead rendering** (PR #211, `@aibrains/pdf-renderer@0.7.0`) shipped 2026-05-27 PM; **C.1.9 letterhead-aware document chrome** (PR #213, `@aibrains/pdf-renderer@0.8.0`) shipped same day. Both technical implementations are live + valid, but 2026-05-27 PM testing surfaced an unfixable operator-content problem (see C.1.10 below): no `objectFit` strategy makes a non-A4-portrait letterhead PNG with center watermark + custom header bands render cleanly on an A4-portrait page. **C.1.10 (Path E revert)** removes the letterhead upload from the frontend form + stops the finance projection from forwarding the URL to the renderer; `<BrandedHeader>` + `<BrandedFooter>` are the canonical chrome for V1. The S3 bucket + presign endpoint + upload allowlist stay live for V1.5. Live e2e baseline: real invoice `INV-420-2605-0192.pdf` (15,321B) + real receipt `RCP-420-2605-0008.pdf` (17,034B) downloadable via UI from dev-pabson-primary tenant `21aea5da-…` school `4209e3d8-…`.
> **Marker semantics:** 🟢 = shipped to prod + validated · 🟡 = shipped with documented followup · ⏳ = next up · 🔲 = not started · ✅ (in §16 / §12) = research-resolved (distinct from ship status).
> **Source of truth:** this table over individual sprint sections. Per-sprint sections also carry a one-line **Status:** marker matching this table.

| EPIC | Sprint | Status | Key PRs / Logs | Notes |
|---|---|---|---|---|
| EPIC-0 | 0.1 Op-Feedback Compounding | 🟡 4/5 tickets shipped pre-v3.4 | per memory `project_sprint_0_1_closed` | 0.1.3 **reclassified** as deferred 206-row IEMIS historical-debt; remedy folded into Sprint E.1.5 per §17.6 |
| EPIC-0 | 0.2 Op-Feedback Non-Compounding | 🔲 not started | — | Parallel-eligible with 0.1 — pending |
| EPIC-0 | 0.3 Academics Audit + Module-Wiring | 🔲 not started | — | Hard prereq for K.5 (multi-school); deferred for now |
| EPIC-0 | 0.4 ArchetypeDefaults | 🟢 shipped 2026-05-22 | PRs from Sprint 0.4 Phase 2 + Phase 7 closeout; `analytics-prod-…-0.4-…` deploy logs; memory `project_sprint_e_0_shipped_prod` | All 6 tickets live; `GET /archetype-defaults` reachable on prod API GW (`/archetype-defaults?archetype=PABSON` returns full profile); invariant-12 lint active with 29→35-file allowlist |
| EPIC-A | A.1 Daily-Use Coverage | 🔲 not started | — | Audit at `daily-use-coverage-audit-2026-05-19.md` lists candidate fixes |
| EPIC-A | A.2 Course Extension (research ✅) | 🟢 shipped 2026-05-22 | PRs [#152](https://github.com/shoaibrain/edforge/pull/152) (Phase 1: shared-types + PABSON catalog) + [#153](https://github.com/shoaibrain/edforge/pull/153) (Phase 2: academics validation + mapper) + [#154](https://github.com/shoaibrain/edforge/pull/154) (Phase 3: backfill script + smoke); sprint plan `docs/pilot-greenlight/a2-sprint-plan.md`; memory `project_sprint_a2_shipped_prod` | All 5 tickets live. shared-types 0.56.0 published; academics ECS image `sha256:5982b8…` rolloutState COMPLETED; A.2.5 backfill executed on dev-pabson-primary school `4209e3d8-…` (17 CREATE + 4 PATCH, idempotent re-run = 19 SKIP + 2 documented WARN). Core Ed-Fi V6 descriptor `AcademicSubjectDescriptor` (15 values) + Edge `PABSON_COURSE_CATALOG` (21 Grades 4-10 templates) + `subject-area-mapper` one-way derive shipped. Unblocks A.3 + A.4 + D.3 + D.4-D.6 (~28 downstream tickets). |
| EPIC-A | A.3 Exam Subsystem | 🟢 shipped 2026-05-22 | PRs [#156](https://github.com/shoaibrain/edforge/pull/156) (Phase 1: shared-types schemas + A.3.1 audit) + [#157](https://github.com/shoaibrain/edforge/pull/157) (Phase 2: entities + state machine + services + controllers + bulk) + [#158](https://github.com/shoaibrain/edforge/pull/158) (Phase 3: pilot-exam-flow smoke) + [#159](https://github.com/shoaibrain/edforge/pull/159) (smoke fixes); sprint plan `docs/pilot-greenlight/a3-sprint-plan.md`; memory `project_sprint_a3_shipped_prod` | All 11 tickets live. shared-types 0.57.0 published; academics ECS image `sha256:1bdb67f0…` rolloutState COMPLETED + `ExamsModule` DI verified post-deploy; **`shared-infra-stack` redeployed** to add 8 new API GW paths (gap caught + fixed mid-Phase-3). A.3.11 smoke 11/11 green on dev-pabson-primary school `4209e3d8-…` (exam `fbfb9811-…`); state machine + bulk idempotency + invalid-transition rejection all verified end-to-end. **Unblocks A.4 (Result Subsystem) + D.3 (ExternalAssessment family) → D.4/D.5/D.6 BLE/SEE/NEB.** |
| EPIC-A | A.4 Result Subsystem | 🟢 **shipped 2026-05-23** (Phases 1-4 + 2 hotfixes + 16/16 smoke green) | PRs [#161](https://github.com/shoaibrain/edforge/pull/161) Phase 1 shared-types + [#162](https://github.com/shoaibrain/edforge/pull/162) Phase 2 academics + [#163](https://github.com/shoaibrain/edforge/pull/163) hotfix-1 (ResultsModule DI) + [#165](https://github.com/shoaibrain/edforge/pull/165) Phase 3 Lambda+EventBridge + [#166](https://github.com/shoaibrain/edforge/pull/166) Phase 4 smoke + [#167](https://github.com/shoaibrain/edforge/pull/167) hotfix-2 (defensive filters); sprint plan + Phase 3 plan + Phase 4 plan + foundation audit all under `docs/pilot-greenlight/`; memories `project_a4_phase2_incident` + `project_sprint_a4_shipped_prod` | All 7 master-plan tickets (A.4.1–A.4.7) live. shared-types 0.58.0 published; academics image `sha256:2c9fd8b8…` running on `prod-basic/academicsbasic`; `shared-infra-stack` carries 5 new `/academics/result-cards/*` API GW paths; `tenant-template-stack-basic` carries result-batch Lambda + EventBridge rule (`detail.toStatus=closed`) + per-Lambda DLQ + 2 CW alarms. **Phase 4 smoke 16/16 green** on dev-pabson-primary: Lambda fired @ 3s post-close; 20 ResultCards generated for 10 enrollments (see R44 idempotency-defect below); R42 mitigation verified (no studentId='unknown' on cards); isTerminalExam=true verified for examType='final'; PATCH conduct/remark/publish all 200; re-publish → 409 RESULT_ALREADY_PUBLISHED; PATCH conduct on published → 409 RESULT_LOCKED. **5 ship-cycle lessons captured (L9 + L10 + L11, plus L12+L13 inline below). R42 closed; R43 resolved (academics wiring-spec landed); R44 NEW (cardId non-deterministic).** |
| EPIC-A | A.5 Period Attendance | 🔲 V1.5 deferred | — | Per CEO 2026-05-19 |
| EPIC-B | B.1 – B.6 Messaging stack | 🔲 V1.5 deferred | — | Per CEO 2026-05-22 |
| EPIC-C | C.0 PDF Foundation + Branding | 🟢 **shipped 2026-05-25 — closed** (C.0-followup closed the 2 HIGH gaps end-to-end as of 2026-05-25 PM) | PRs [#181](https://github.com/shoaibrain/edforge/pull/181) (design), [#182](https://github.com/shoaibrain/edforge/pull/182)–[#185](https://github.com/shoaibrain/edforge/pull/185) (pdf-renderer 0.1→0.4), [#187](https://github.com/shoaibrain/edforge/pull/187) (shared-types 0.61.0), [#188](https://github.com/shoaibrain/edforge/pull/188) (S3 buckets), [#189](https://github.com/shoaibrain/edforge/pull/189) (branding endpoints) + hotfixes [#190](https://github.com/shoaibrain/edforge/pull/190) (JwtAuthGuard) + [#191](https://github.com/shoaibrain/edforge/pull/191) (TVM cred case) + docs [#192](https://github.com/shoaibrain/edforge/pull/192) + **closure [PR #195](https://github.com/shoaibrain/edforge/pull/195) C.0-followup**; deploy logs `prod-build-application-identity-…-2ce4a26` + `analytics-prod-…-e533ac9` + `prod-smoke-c-0-7-branding-…-2ce4a26` + `prod-smoke-c-0-followup-…-f518351` | All 7 C.0 tickets + 3 C.0-followup tickets live. `@aibrains/pdf-renderer@0.4.0` + `@aibrains/shared-types@0.61.0` live on npm. PDF S3 buckets `edforge-pdfs-*` (tag-lifecycle 7d, TagFilter `lifecycle=pdf-jobs`) + `edforge-pdf-assets-*` (versioned) live in prod ap-south-1. Identity image `sha256:f4f4b447…` (commit `f518351`, post-C.0-followup) running on prod-basic. ABAC role: `s3:Get/PutObject` on `tenants/${aws:PrincipalTag/tenant}/*` (no DeleteObject per CodeRabbit). 5/5 smoke green on dev-pabson-primary in both C.0.7 and C.0-followup runs (latter with explicit `urls.logo` C.0-fu.2 assertion). **2 HIGH gaps from the 2026-05-25 audit are now CLOSED** by C.0-followup: (a) `branding:configure` permission key added + Principal granted via `DEFAULT_ROLE_PERMISSIONS`; BrandingController switched to `PermissionGuard` + `@RequirePermission`; (b) `BrandingResponse.urls?: BrandingAssetUrls` field returns signed GET URLs alongside raw keys (additive). **1 MEDIUM gap closed:** BrandingService + S3PresignerService now have 22 unit specs (incl. regression guards for PRs #190 + #191 + CodeRabbit per-asset graceful-degradation). Both hotfix-class typos retros captured in memory `project_sprint_c0_7_shipped_prod`; the closure work captured in `project_sprint_c0_followup_shipped_prod`. |
| EPIC-C | **C.0-followup-2 (M3 phase 2 unblock — server-side fixes, 2026-05-27)** | 🟢 **shipped to prod 2026-05-27** | [PR #209](https://github.com/shoaibrain/edforge/pull/209) (S3Client `requestChecksumCalculation: 'WHEN_REQUIRED'` opt-out of AWS SDK v3.730+ default) + [PR #210](https://github.com/shoaibrain/edforge/pull/210) (CDK `CorsRule` on PdfAssetsBucket); deploy logs `prod-build-application-identity-20260527-054726-785a1fc.log` + `prod-ecs-roll-identitybasic-20260527-054826-785a1fc.log` + `analytics-prod-analytics-stack-20260527-011646-1071a3c.log` (PdfAssetsBucket UPDATE_COMPLETE in 23s) | Two pre-existing C.0.6/C.0.7 defects that lay dormant until M3 phase 2 (FE PR #90) attempted browser-direct S3 PUT against PdfAssetsBucket. **#209:** AWS SDK v3 introduced `requestChecksumCalculation: 'WHEN_SUPPORTED'` as the DEFAULT in v3.730 (Jan 2025); server installs v3.1053.0 (well past that threshold). Every `PutObjectCommand` presigned URL embedded `x-amz-sdk-checksum-algorithm=CRC32` + `x-amz-checksum-crc32=AAAAAA==` (empty-payload CRC) into the SIGNED query string. When browser PUTs a non-empty file, S3 verifies the signed empty-CRC against the actual body and rejects with signature/CRC32 mismatch. GET presigns unaffected. Fix: `requestChecksumCalculation: 'WHEN_REQUIRED'` on `S3Client` constructor in [s3-presigner.service.ts:87](server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L87). +2 regression-guard specs (one asserting the `WHEN_REQUIRED` opt-out, one defense-in-depth asserting NO `ChecksumAlgorithm` on the PutObjectCommand input). **#210:** C.0.6 created PdfAssetsBucket via CDK without a `cors:` property. After #209 unblocked the checksum mismatch, browser PUT next failed CORS preflight with `NoSuchCORSConfiguration`. Fix: CDK `CorsRule` on the bucket in `analytics-stack.ts` — `AllowedMethods: [PUT, GET, HEAD]`; 3 origins (`https://edforge.app`, `https://www.edforge.app`, `https://edforge-saas-frontend-*.vercel.app`); `AllowedHeaders: ['*']`; `ExposedHeaders: ['ETag', 'x-amz-version-id']`; `maxAge: 3000` (CDK property name = `maxAge`, NOT `maxAgeSeconds`). Regression spec on `analytics-stack.spec.ts` asserts the full CORS shape. Verified live via `aws s3api get-bucket-cors`. **Both fixes hold open the M3 phase 2 surface in prod 2026-05-27**: all 3 asset slots upload successfully on dev-pabson-primary, with saved branding propagating to next invoice/receipt PDF download. Lessons captured for B0.1: (L25) review AWS SDK semantic-stable defaults on every major-version bump (browser flow is the canary, not server-side); (L26) buckets that ever receive browser-direct PUT need a CORS rule at creation, not as a retrofit. |
| EPIC-C | C.0-followup (audit-driven 2026-05-25) | 🟢 **shipped 2026-05-25 PM** | [PR #195](https://github.com/shoaibrain/edforge/pull/195) + CodeRabbit fix `4c9439a` (graceful degradation); deploy logs `prod-build-application-identity-…-f518351` + `analytics-prod-tenant-template-stack-basic-…` + `prod-ecs-roll-identitybasic-…-f518351` + `prod-smoke-c-0-followup-20260525-102741-f518351` | All 3 followup tickets closed end-to-end: C.0-fu.1 added `branding:configure` permission key + granted to Principal in `DEFAULT_ROLE_PERMISSIONS`; BrandingController switched from `@RequireGlobalRole('TenantAdmin')` → `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission({resource: 'branding', action: 'configure'})`. C.0-fu.2 `BrandingService.getBranding()` now returns additive `urls?: BrandingAssetUrls` field with signed GET URLs (10-min TTL) for each present S3-backed asset; raw S3 keys preserved on `branding` for back-compat. C.0-fu.3 `branding.service.spec.ts` (14 specs incl. CodeRabbit graceful-degradation tests for per-asset presign failures) + `s3-presigner.service.spec.ts` (8 specs incl. PR #191 TVM credential-casing regression guard) — 106/106 identity tests pass. Identity image `sha256:f4f4b447…` (commit `f518351`) running on prod-basic. Live smoke 5/5 green on dev-pabson-primary with explicit `urls.logo` assertion in step 5. |
| EPIC-C | C.1.1 InvoicePdf component | 🟢 **shipped 2026-05-25 PM** | [PR #196](https://github.com/shoaibrain/edforge/pull/196); `@aibrains/pdf-renderer@0.5.0` live on npm (verified via `npm view`) | First concrete document component using C.0.4 descriptor registry. `<InvoicePdf>` composes C.0.3 primitives + components (Document + Page + BrandedHeader/Footer + Watermark + KeyValueTable + LineItemTable + TotalsBlock + SignatureLine). New `InvoiceTemplateConfig` extends `PdfTemplateConfig` with line-item column toggles + totals visibility + `showSignatureLine`. Invoice descriptor self-registers via side-effect import; 13 `configurableFields[]` for the C.2.4 editor surface (5 header toggles + 4 lineItem column toggles + 3 totals visibility + 1 dateFormat select). PABSON/GENERIC archetype-aware defaults; reserved archetypes (CBSE_IN/NAIS_US/GEMS_UAE) fall through to GENERIC profile. 82/82 pdf-renderer specs pass (was 72; +10 new invoice-pdf specs covering 4 render canaries + 6 descriptor assertions). No backend code or AWS deploy; no consumer pin bumps yet (lockstep bumps land in C.1.5 finance per `edforge_workspace_only_packages_docker_trap`). |
| EPIC-C | C.1.2 ReceiptPdf component | 🟢 **merged 2026-05-25** (npm-only) | [PR #198](https://github.com/shoaibrain/edforge/pull/198); `@aibrains/pdf-renderer@0.6.0` live on npm | `<ReceiptPdf>` + receipt descriptor (17 `configurableFields[]`: +2 payment-detail + 2 tax-breakdown + 2 footer toggles vs invoice's 13). Composition exercise on C.0.3 primitives; zero new primitives. `paid \| voided \| refunded` lifecycle (watermark on latter two). 93/93 pdf-renderer specs (+11 new receipt-pdf canaries). CodeRabbit fix (`b45f8e2`) gates tax-breakdown amounts on operator toggles. No backend code / no AWS deploy. |
| EPIC-C | C.1.3 PdfTemplatesService (identity) | 🟢 **shipped to prod 2026-05-26** | [PR #199](https://github.com/shoaibrain/edforge/pull/199) + CodeRabbit fix `9369244`; identity image `sha256:a1cff3f7…` on prod-basic/identitybasic TaskDef:4; live smoke 200 OK on `GET /schools/{sid}/pdf-templates/INVOICE/current` + RECEIPT/current — both return full PABSON config with `source:'default'` proving lazy-default + descriptor self-registration | Read-only `GET /schools/:id/pdf-templates/:docType/current` on identity; lazy-default returns `descriptor.defaults()` on persisted miss (NO DDB write). Adds `PDF_TEMPLATE_CURRENT` + `PDF_TEMPLATE_VERSION` entity types + EntityKeyBuilder helpers + `pdf-templates:view` permission (granted to Principal). Lockstep dep pin `@aibrains/pdf-renderer@^0.6.0` on server/application + server pkg. New `server/application/webpack.config.js` externalizes `@react-pdf/*` + `yoga-layout` (yoga ships raw `.ts` in node_modules → webpack parse error). CodeRabbit fix: hardened bearer-token extraction (`/^\s*Bearer\s+/i`) + corrected `@throws` JSDoc. 111/111 specs. **shared-infra-stack CDK redeploy required** for the new API GW route. |
| EPIC-C | C.1.4 IdentityClient.getCurrentTemplate + 60s LRU | 🟢 **shipped to prod 2026-05-26** (in finance image) | [PR #200](https://github.com/shoaibrain/edforge/pull/200) + CodeRabbit fix `1ad0d33`; finance image `sha256:9ca3a211…` ships the cache helper; consumed by C.1.5 invoice PDF + C.1.6 receipt PDF endpoints | Lockstep helper on academics + finance IdentityClient. Per-process LRU cache (60s TTL, 100-entry cap), 5xx fallback → `descriptor.defaults(fallbackArchetype)`, 4xx propagates. CodeRabbit fixes: single-flight dedup via `pendingPdfTemplateRequests` Map (stampede guard), LRU refresh-order fix (`delete+set` for MRU), `encodeURIComponent` on path segments. 27/27 specs. Lesson L23: use `.then(cleanup, cleanup)` not `.finally()` on unawaited cleanup chains. **No deploy in isolation** — helper unreachable until C.1.5 consumes it. |
| EPIC-C | C.1.5 finance GET /invoices/:id/pdf — **first user-visible PDF in prod** 🟢 | 🟢 **shipped to prod 2026-05-26** | [PR #201](https://github.com/shoaibrain/edforge/pull/201) + CodeRabbit fix `758928a`; finance image `sha256:9ca3a211…` on prod-basic/financebasic TaskDef:2; **live smoke PASS** on dev-pabson-primary: real invoice `INV-420-2605-0192` rendered to 15,321-byte PDF with `Content-Type: application/pdf` + `Content-Disposition: inline; filename="INV-420-2605-0192.pdf"` + `Cache-Control: private, no-store`. **First user-visible PDF endpoint live in EdForge prod.** Saved to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-smoke-c1-pdf-endpoints-…-d2cf929.log` | THE PR. New `invoice-pdf.renderer.ts` pure projection + `InvoicesService.getPdf` + `@Get(':id/pdf')` with `billing:view` + ownership + binary response (Content-Type: application/pdf, inline disposition, Cache-Control: private,no-store). Branding fetch error degrades to `null` branding; template 5xx falls through to C.1.4 PABSON default. Audit = CloudWatch structured `pdf_generated` log (NOT DDB — cross-service writes to identity's AuditLog not in V1 architecture). Explicit `react@^18.3.1` + `@react-pdf/renderer@^3.4.5` deps on server/application/package.json (finance ACTUALLY renders at runtime; identity only uses descriptor.defaults() JSON). CodeRabbit fix: defensive `resolvePrimaryLocale(unknown)` helper guards against malformed `labelLanguages` at JSON boundary. PDFs self-contained post-render (react-pdf inlines image bytes; 10-min S3 logo URL TTL irrelevant). 35/35 specs across 4 suites. **shared-infra-stack CDK redeploy + finance ECR push + ECS roll required.** B0.1: controller + service both fetch invoice (2× DDB GetItem; same partition, ~5ms). |
| EPIC-C | C.1.6 finance GET /payments/:id/receipt/pdf (backend) | 🟢 **shipped to prod 2026-05-26 — closes C.1 phase backend-side** | [PR #202](https://github.com/shoaibrain/edforge/pull/202) + CodeRabbit fix `193e0cf` (schoolId query param); **live smoke PASS** on dev-pabson-primary: real payment `RCP-420-2605-0008` rendered to 17,034-byte PDF with full headers identical to invoice PDF | Mirror of C.1.5 for RECEIPT docType. New `receipt-pdf.renderer.ts` (Payment + Invoice → ReceiptDocumentData projection, with gateway display name table) + `PaymentsService.getReceiptPdf` (loads Payment entity directly; 400 if status !== 'completed'; parallel branding + template + invoice fetch) + `@Get('payments/:paymentId/receipt/pdf')`. Sparse-payment fallbacks: null `receiptNumber` → synthesized `RCP-<8-char>`; null `paidBy` → `invoice.studentName`. 28/28 specs (13 new C.1.6 + 15 regression). **shared-infra-stack CDK redeploy + finance ECS roll required** (route bundles with C.1.5). |
| EPIC-C | C.1.6 frontend (`edforge-saas-frontend`) — retire jspdf | 🟢 **shipped to prod 2026-05-26 — closed via 23-PR series across M1 + M1.5-FU** | edforge-saas-frontend PRs #65 + #66 + #67 + #68 + #69 + #70 + #71 + #72 + #73 + #74 + #75 + #76 + #77 + #78 + #79 + #80 + #81 + #82 + #83 + #84 + #85 + #86 (final cleanup); detailed log in [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md) §0.2-shipped Slice 1+2+3 | All C.1.6 sub-bullets shipped: (a) `useDownloadReceiptPdf` + `useDownloadInvoicePdf` hooks live in `@edforge/finance-services` (with `usePdfErrorToast` + `trackPdfDownload*` telemetry auto-wired); (b) `apps/shell/src/components/payments/PaymentReceipt.tsx` jspdf path removed, then relocated into Finance MFE at `apps/finance/src/routes/billing/payments/$paymentId/receipt.tsx` (M1.5-FU.2 architectural fix — receipt page belongs in Finance not Shell); (c) Download PDF button on Invoice detail + per-row Download on both Invoice list AND Payments list; (d) `jspdf` + `html2canvas` dropped from `apps/shell/package.json` (M1.8). Plus 18 ancillary improvements: M0.5 `MfeNotFoundBoundary`, M0.7 ESLint MFE-nav rule, M1.10 telemetry, M1.11 canonical error-toast, M1.5-FU four-bug architectural fix (page move + schoolId plumbing + Return-routing). **Live e2e validated 2026-05-26 on dev-pabson-primary in prod:** real Invoice + Receipt PDFs download with PABSON branding + Devanagari fonts via the new UI surfaces. 5 receipt-flow defects (#18-#22) surfaced post-test, scoped as M1.5-FU.7 — paused per 2026-05-26 PM decision pending narrower breadcrumb fix design. |
| EPIC-C | **C.1.7-followup — M2 Branding read (Shell)** | 🟢 **shipped to prod 2026-05-26** | edforge-saas-frontend PR #88 (`cae00fd` + review-fix `25fad59`); detailed log in [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md) §4 + §0.2-shipped Slice 4 | NEW workspace package `@edforge/identity-services` (sibling of `@edforge/finance-services`; stateless → NOT MF-singleton; cache shared via TanStack Query singleton). Read-only `/settings/branding` page with `BrandingDisplay` (logo + colors + formal name + PAN/VAT + address + signature thumbnail). ABAC: `branding` resource + `view`/`configure` actions added to `packages/abac/src/permissions.ts`; Principal granted `['view', 'configure']`; TenantAdmin bypass via globalRole. M0.9 type promotion deferred — `BrandingResponse` + sibling types live inline in `@edforge/identity-services/src/types.ts` (additive future work, doesn't block consumers). i18n parity in `branding` namespace (en + ne). 54/54 specs. |
| EPIC-C | **C.1.7-followup — M3 Branding write (Shell, two phases)** | 🟢 **shipped to prod 2026-05-27 across 5 PRs (3 frontend + 2 server hotfixes)** | edforge-saas-frontend PR #89 (M3 phase 1 text + colors) + PR #90 (M3 phase 2 asset uploads); server PRs #209 (`requestChecksumCalculation: 'WHEN_REQUIRED'`) + #210 (PdfAssetsBucket CORS via CDK). Server deploy logs: `prod-build-application-identity-20260527-054726-785a1fc.log`, `prod-ecs-roll-identitybasic-20260527-054826-785a1fc.log`, `analytics-prod-analytics-stack-20260527-011646-1071a3c.log` | **M3 phase 1 (text + colors, PR #89):** RHF `BrandingForm` (489 LOC) + `BrandingColorPicker` (146 LOC) wired with diff-based PATCH, dirty-guard via existing `useFormDirtyGuard`, edit-toggle on `usePermission('configure', 'branding')`. RHF imports consolidated through `@edforge/forms` re-exports; fail-fast on undefined `schoolId`. 81/81 specs. **M3 phase 2 (asset uploads, PR #90):** `BrandingFileField` × 3 (327 LOC NEW) + `usePresignedAssetUpload` hook (116 LOC NEW) + per-asset MIME allowlist + size caps (logo 2MB / signature 1MB / letterhead 5MB). Raw `fetch` for S3 PUT (avoids axios leaking Authorization to S3 CDN). **Server unblocks discovered during prod test:** (1) **PR #209** — AWS SDK v3.730+ default `WHEN_SUPPORTED` checksum embedded `x-amz-checksum-crc32=AAAAAA==` into every signed PUT URL → S3 rejected every non-empty browser upload. Fix: `requestChecksumCalculation: 'WHEN_REQUIRED'` on `S3Client` constructor at [s3-presigner.service.ts:87](server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L87). +2 regression-guard specs. (2) **PR #210** — `NoSuchCORSConfiguration` on PdfAssetsBucket blocked browser preflight after #209. CDK `CorsRule` on [analytics-stack.ts](server/lib/analytics/analytics-stack.ts) added: PUT/GET/HEAD on `edforge.app` + `www.edforge.app` + `edforge-saas-frontend-*.vercel.app`; `ExposedHeaders: ['ETag', 'x-amz-version-id']`; `maxAge: 3000` (CDK property name = `maxAge`, NOT `maxAgeSeconds`). Regression spec on `analytics-stack.spec.ts`. Live e2e verified 2026-05-27 on dev-pabson-primary: all 3 asset slots upload successfully; saved branding propagates to next invoice/receipt PDF download (**logo + signature visible in PDF; letterhead PDF persists in S3 + signed URL valid but does NOT render in PDF output — pre-existing pdf-renderer feature gap, see C.1.8 below**). |
| EPIC-C | **C.1.8 — Letterhead background PDF rendering gap (`<Image fixed>` at full page bounds)** | 🟡 **shipped 2026-05-27 PM; superseded by C.1.10 Path E revert later same day** | [PR #211](https://github.com/shoaibrain/edforge/pull/211); `@aibrains/pdf-renderer@0.7.0` on npm; finance + identity images deployed but the renderer code path is unreachable in prod after C.1.10 stopped the projection forwarding | **The fix that shipped:** `<Page>` primitive gained optional `letterheadBackgroundSrc` rendering absolutely-positioned `<Image fixed>` at full bounds; `<InvoicePdf>` + `<ReceiptPdf>` threaded the URL; `isPdfLetterheadKey` projection guard dropped `.pdf`-keyed letterheads at the finance boundary. **Why superseded:** prod testing surfaced that `objectFit: 'cover'` cropped operator letterhead text on aspect mismatch. C.1.9 attempted to fix via `'contain'` + chrome-suppression, which exposed deeper operator-content problems (see C.1.9 + C.1.10 below). **What remains live in code:** the Page primitive's `letterheadBackgroundSrc` prop + the `<Image fixed>` rendering path are still in `@aibrains/pdf-renderer@^0.8.0` — they just aren't reached because finance no longer forwards the URL. The library is forward-compat for V1.5 when custom letterheads return alongside the C.2 Template Editor + live preview. **Lessons L27 + L28 still apply** (descriptor type → consumer contract; MIME allowlist ↔ renderer capability). |
| EPIC-C | **C.1.9 — Letterhead-aware document chrome (suppress BrandedHeader/Footer when letterhead set)** | 🟡 **shipped 2026-05-27 PM; superseded by C.1.10 Path E revert hours later** | [PR #213](https://github.com/shoaibrain/edforge/pull/213); `@aibrains/pdf-renderer@0.8.0` on npm; finance `sha256:6592e013…` + identity `sha256:caeb827a…` images deployed (still running on prod-basic at the time of writing); deploy logs `prod-build-application-{finance,identity}-20260527-103657-7f7a1b5.log` + `prod-ecs-roll-{finance,identity}basic-20260527-103837-7f7a1b5.log` | **The fix that shipped:** when `branding.letterheadBackgroundSrc` is truthy, `<InvoicePdf>` + `<ReceiptPdf>` skip their own `<BrandedHeader>` + `<BrandedFooter>` (letterhead IS the chrome) and bump margins to safe-area (+40mm top, +20mm bottom of operator base). `<Watermark>` (legal status) kept. New `letterheadFit?: 'contain' \| 'cover'` prop with `'contain'` default (preserve operator design, letterbox on aspect mismatch). +8 specs (2 letterheadFit render-smoke + 3 InvoicePdf suppression + 3 ReceiptPdf suppression via react-test-renderer). **Why superseded:** prod testing with the same Gemini-generated letterhead surfaced the operator-content problem the renderer couldn't fix — operator letterheads are landscape-ish, so `'contain'` centered the letterhead's header band at vertical-center of the page (not the top); content + letterhead-watermark + receipt-data table all collided. Receipts overflowed to a 2nd orphan page. **What remains live in code:** the C.1.9 conditional chrome-suppression branches + safe-area margin math + `letterheadFit` prop are still in `@aibrains/pdf-renderer@^0.8.0`. They become reachable again in V1.5 when the C.2 Template Editor ships a live-preview workflow that catches operator-content mismatches before save. **Lesson L29:** *operator-uploaded design assets need either a strict template + validation pipeline OR a preview-before-save UX. Neither is on the V1 critical path. Shipping a feature without one of them is shipping operator-design-skill as a hidden dependency.* |
| EPIC-C | **C.1.10 — Custom letterhead V1.5-deferred (Path E revert)** | 🟢 **shipped to prod 2026-05-27 PM** | server [PR #214](https://github.com/shoaibrain/edforge/pull/214) (commit `f247e40`); frontend [PR #92](https://github.com/shoaibrain/edforge-saas-frontend/pull/92) (commit `a2b0151`); finance ECR image `sha256:72fd83493641f345ade9b2739bdb27309170f04679332c72fb53cf2c05b53308` tag `693e603-20260527163959` running on prod-basic/financebasic; identity untouched; **no `@aibrains/pdf-renderer` version bump** (library API + Page primitive prop both stay forward-compat at 0.8.0); deploy logs `prod-build-application-finance-20260527-113950-9b35472.log` + `prod-ecs-roll-financebasic-20260527-114100-693e603.log` + `prod-ecs-wait-financebasic-…-693e603.log`. Frontend Vercel auto-deploy on PR #92 merge. **Operator UI re-verify GREEN on Vercel preview**: internal-dev `Espresso English Academy` tenant — invoice + receipt PDFs both render single-page with clean `<BrandedHeader>` + `<BrandedFooter>`, no letterhead overlay, no orphan page; branding settings UI shows 2-column Assets grid (Logo + Principal Signature) — letterhead slot is gone from both edit form + read-only viewer. | **The decision:** custom letterhead uploads return in V1.5 alongside C.2 Template Editor + live preview. For V1 pilot, operators get the EdForge-rendered `<BrandedHeader>` + `<BrandedFooter>` driven by 6 existing knobs (logo, signature, primary+accent colors, formalName, tagline, addressLines/phone/email/PAN/VAT). **The minimum-scope change:** server-side stops forwarding `letterheadBackgroundSrc` in the finance projection — `<InvoicePdf>` + `<ReceiptPdf>` then take the `!hasLetterhead` branch unconditionally → unconditional `<BrandedHeader>` + `<BrandedFooter>` + base template.margins. Frontend removes the letterhead `<BrandingFileField>` from the form + the letterhead-specific helper text. Saved `letterheadBackgroundS3Key` rows persist in identity DDB (data not destroyed; the renderer just ignores them; V1.5 brings them back). S3 bucket + presign endpoint + upload allowlist + ABAC policy all stay. **isPdfLetterheadKey + its 7 unit specs removed** as dead code. Frontend test suite: 27/27 branding specs green (5 test assertions inverted as regression guards against accidentally re-adding the slot). en/ne i18n parity: 51/51 keys each side. **Decision rationale documented in the AskUserQuestion log 2026-05-27 PM:** the operator effort required to produce a letterhead PNG that renders cleanly on A4 portrait without overlapping content is non-trivial; expecting Saraswati operators to do that work is shipping a footgun. **Lesson L29:** operator-uploaded design assets need either strict template + validation pipeline OR preview-before-save UX. Neither is on V1 critical path. |
| EPIC-C | C.2 Template Editor (Shell) | 🔲 **not started — backend not shipped; UNBLOCKS the next operator-facing PDF surface** | sprint plan: [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md) §6; frontend integration plan: [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md) §7 (Sprint M5) | Tenant-facing Shell editor at `/settings/pdf-templates`. TenantAdmin manages all doc-type templates from one place; reads `descriptor.configurableFields[]` per registered doc type (INVOICE = 13 fields, RECEIPT = 17 fields) and renders form sections automatically. **Backend writes (`POST/PATCH/POST publish/POST republish/GET versions`) are the gating prereq — not yet shipped.** Frontend Sprint M5 (in PDF MFE plan) is fully scoped and ready once backend lands. Bumps `pdf-templates` permission to `view + configure`. New permission grant for Principal. |
| EPIC-C | C.3 ReportCard render (academics) | 🔲 not started — backend not shipped (frontend Sprint M7 ready) | `pdf-service-mfe-integration-plan.md` §9 (Sprint M7) | `<ReportCardPdf>` document + report-card descriptor + academics `GET /result-cards/:id/pdf`. Mirrors C.1.5 pattern with REPORT_CARD docType. Hard deps: A.4 (✅) + C.0.4 (✅) + C.1.4 (✅). Frontend Sprint M7 (download button on result-card detail + per-row Download on list) is fully scoped — ~4 hours of FE work once backend lands. |
| EPIC-C | C.4 Batch Lambda (`PdfJobRequested` consumer) | 🔲 not started — backend not shipped (frontend Sprint M8 ready) | `pdf-service-mfe-integration-plan.md` §10 (Sprint M8) | Future async batch path for end-of-term report-card runs. Consumes `pdf.job.requested` from EventBridge, renders via the same `@aibrains/pdf-renderer` library, uploads to `edforge-pdfs-*` S3, emits `pdf.job.completed`. Uses ScriptJob-style Lambda not ECS (concurrency ramps to 1000 in ap-south-1). Frontend Sprint M8 (multi-select + bulk-action + progress modal + zip download via blob anchor) ready once backend lands. |
| EPIC-C | C.5 AdmitCard data-shape | 🔲 not started — gated on D.4 + D.5 (BLE/SEE entities) | `pdf-service-mfe-integration-plan.md` §11 (Sprint M9) | `<AdmitCardPdf>` document + admit-card descriptor — once data-shape is locked, ship in mirror of C.1.5. Per master plan, locks the operator-facing surface for the Saraswati municipal-exam pilot use case. Frontend Sprint M9 (admit-card download + bulk for BLE Grade 8 / SEE Grade 10) ready after C.5 + D.4 + D.5 backend. |
| EPIC-D | D.1 GradingPolicy Pluggability | 🟡 shipped 2026-05-22 | PRs #146 (Phase 1) + #147 (Phase 2) + #148 (shared-types 0.55.0 publish-gate hotfix) + #149 (inline TenantMetadataReader hotfix); deploy and smoke evidence retained privately with sanitized status summarized in `docs/deploys/INDEX.md` | All 5 tickets shipped + lazy-seed verified working on dev-pabson Saraswati school (existing policy round-trip). **D.1.3 implemented as lazy-seed at first GET (not tenant-seeder Lambda — design Q2 lock-in)**. Open followup: D.1.1 mapper serializer omits `gpaScale` + entry-level `isPassing`/`isTerminalFail?`/`displayName?` from response DTO (R38). E.1 regression smoke 11/11 green |
| EPIC-D | D.2 PromotionRule | 🟢 **shipped 2026-05-24** | memory `project_sprint_d2_shipped_prod`; deploy logs `prod-*-d2-*`; mid-deploy hotfix [PR #177](https://github.com/shoaibrain/edforge/pull/177) for API GW sibling-variable conflict | All tickets live. GSI10 sparse on academics + 5 new `/promotion-rules/*` routes; 7/7 D.2 smoke green on dev-pabson-primary. Lessons L14 (cdk-diff of API GW `fromAsset` hides route-level conflicts), L15 (API GW path variable names layer-local), L16 (GET-after-soft-delete returns 200+`isActive=false`). Unblocks D.4/D.5/D.6 promotion-decision audit trail. |
| EPIC-D | D.3 ExternalAssessment family | 🟢 **shipped 2026-05-24** | memory `project_sprint_d3_shipped_prod`; academics ECR `sha256:57052f03…` (tag `33b600b-20260524190049`); deploy `cdk deploy tenant-template-stack-basic --exclusively` (45s); GSI13 ACTIVE across identity + academics + finance | All tickets live. 6 entity types + 2 uniqueness-lock types in DDB (`PROMOTION_RULE_LOCK` + `EXTERNAL_EXAM_REGISTRATION_LOCK` + `EXTERNAL_EXAM_SYMBOL_LOCK`); 8 new `EntityKeyBuilder` methods; GSI13 sparse on all 3 per-tenant tables; `ExternalExamsModule` shell registered on academics (D.4 controllers will wire into it); 4-state lifecycle validator (16-cell matrix). **162 D.3 assertions green across 4 spec suites; Nest bootstrap verified via CloudWatch.** 5 lessons captured (L17–L21). **Unblocks ~25 downstream tickets** (D.4 + D.5 + D.6 + C.4 + E.2). Side-note: L17 surfaced potential GSI8 `emisSchoolCode` uniqueness flaw mirroring the same DDB-doesn't-enforce-GSI-uniqueness pattern — flagged as audit item in `ecs-dynamodb.ts` comment; not blocking. |
| EPIC-D | D.4 BLE Workflow (research ✅) | 🔲 not started | — | D.4.0 research-resolved (9-ticket sprint locked); hard deps: D.1 (now ✅) + D.3 |
| EPIC-D | D.5 SEE Workflow | 🔲 not started | — | |
| EPIC-D | D.6 NEB Grade 11/12 | 🔲 not started | — | |
| EPIC-D | D.7 StudentAcademicTrack | 🔲 V1.5 deferred | — | |
| EPIC-E | E.0 Schema Extensions (NEW v3.4) | 🟢 shipped 2026-05-22 | Sprint E.0 Phase-7 closeout; memory `project_sprint_e_0_shipped_prod` | 3 tickets live: `Student.hasEcedExperience` + `SchoolConfiguration.municipalityConfig` + `Student.scholarshipAmountNpr`; PABSON profile verified live (NG + Forms 7/2/19 excluded + BLE-supplementary); `PATCH /schools/{id}/configuration` `municipalityConfig` round-trip confirmed |
| EPIC-E | E.1 Flash I/II MVP (research ✅) | 🟢 shipped 2026-05-22 | PRs #140 (Phase 1) + #141 (Phase 2) + #142 (Phase 3) + #143 (0.54.0 publish-gate) + #144 (Lambda DDB-key bare-UUID fix); `prod-smoke-e1-flash-i-ii-…log` 11/11 assertions | Full pipeline operator API → EventBridge → Lambda → DDB state machine + S3 staging working e2e. Lambda processed **249 enrollments in 1.4s** on dev-pabson Saraswati. 1 orphan ReportingSnapshot (`5351f942-…`) stuck in `generating` from pre-#144 smoke — non-blocking data debt; deployer IAM cannot mutate; awaits V1.5 AdminWeb UI |
| EPIC-E | E.2 – E.6 Compliance | 🔲 not started | — | E.2 (Discipline soft) + E.3 (Residency assertion) + E.4 (Consent capture) + E.5 (Tenant export) + E.6 (Scholarship quota); easy-wins candidates |
| EPIC-F | F.1 – F.3 Generalize | 🔲 not started | — | |
| EPIC-G | G.1 – G.3 Operator Feedback | 🔲 V1.5 optional | — | Per CEO 2026-05-22 — refinement signal, not V1 gate |
| EPIC-H | H.1 Real-Operational Evidence | 🟡 **partial / opportunistic** | Saraswati school activated in prod 2026-05-18 (memory `project_saraswati_prod_activation`); pre-E.1 + pre-D.1 baseline | De-facto early entry to H.1 (operator-led setup completed through UI on `34f49822-…`); formal H.1.x ticket completion gated on EPIC-A/D shipping |
| EPIC-H | H.2 Greenlight Gate | 🔲 not started | — | |
| EPIC-H | H.3 30-Day Hypercare | 🔲 not started | — | Gate-on-product-completeness per v3.3 philosophy |

### Net V1 progress

- **Sprints fully shipped + validated to prod (🟢):** **10 backend + the full EPIC-C frontend stack** — 0.4, A.2, A.3, A.4, **D.2**, **D.3**, E.0, E.1, **C.0** + C.0-followup, **C.1 backend** (5 PRs), **C.1.6 frontend** (23 PRs across M0 + M1 + M1.5-FU), **C.1.7-followup M2 Branding read** (PR #88), **C.1.7-followup M3 Branding write phase 1 + phase 2** (FE PR #89 + #90 + server hotfixes #209 + #210). Live e2e proven on dev-pabson-primary in prod for every surface.
- **Sprints partially shipped (🟡, with documented gaps):** 2 — 0.1 (0.1.3 reclassified to E.1.5 per §17.6), D.1 (R38 mapper serializer followup).
- **Newly-merged 2026-05-26 → 2026-05-27 (the EPIC-C frontend closeout window):**
  - **2026-05-26 morning:** stacked C.1 backend deploy (5 PRs) + frontend Slices 1+2 of the PDF MFE integration plan (16 PRs in `edforge-saas-frontend`: M0.1/0.5/0.7 + M1.1-M1.11).
  - **2026-05-26 afternoon:** receipt-page architectural correction (M1.5-FU.1-.6, 5 PRs) → in-MFE nav, schoolId plumbed, Return-to-Invoices fix. Paused M1.5-FU.7 (FU.7.1 breadcrumb predicate too broad, cancelled PR #87).
  - **2026-05-26 evening:** M2 Branding read (PR #88) — NEW workspace package `@edforge/identity-services` + ABAC `branding` resource + `/settings/branding` page.
  - **2026-05-27 morning:** M3 phase 1 (PR #89) text+colors write + M3 phase 2 (PR #90) asset uploads, plus server PRs #209 + #210 (AWS SDK v3 checksum opt-out + PdfAssetsBucket CORS) to unblock browser-direct S3 PUT.
  - **Total EPIC-C cycle output 2026-05-25 → 2026-05-27:** 35 PRs across backend (C.0, C.0-followup, C.1.1-C.1.6, #205/#209/#210) + frontend (M0 through M3 phase 2). Every PR with CodeRabbit findings + fixes in-PR. All shipped to prod.
- **Sprints with research resolved + ready-to-execute next:**
  - **D.4 BLE Workflow** — all prereqs ✅ (D.1 + D.2 + D.3 + A.2 + E.0.2); 9-ticket sprint locked.
  - **C.2 Template Editor backend (PATCH + publish + republish + versions)** — frontend Sprint M5 is fully scoped in [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md) §7 awaiting this.
  - **C.3 (ReportCard render endpoint), C.4 (Batch Lambda), C.5 (AdmitCard data-shape)** — all backend-gated; frontend Sprints M7/M8/M9 scoped + ready.
- **Critical-path next moves (in order, post-C.1.10 ship 2026-05-27 PM — EPIC-C now closed for V1 pilot):**
  1. **D.4 BLE Workflow** — research-resolved, dependency-clear, pilot-critical (BLE prep Spring 2027 per master plan §1.2). All prereqs ✅ (D.1 + D.2 + D.3 + A.2 + E.0.2); 9-ticket sprint locked. No PDF dependency. **Natural next critical-path move.**
  2. **C.3 ReportCard backend + Sprint M7 frontend** — term-end pilot-critical for Saraswati. Mirrors C.1.5 pattern; ~1 day backend + ~half-day frontend. Could run in parallel with D.4.
  3. **C.2 Template Editor backend + Sprint M5 frontend** — operator-facing template editing (flip `source:'default'` → `'persisted'` via UI). Backend not yet started; M5 frontend fully scoped. Operator-polish, not pilot-blocking.
  4. **C.4 Batch Lambda + Sprint M8 frontend** — bulk PDF generation. Lower V1 priority — operators rarely need 50-PDF zips in V1 pilot.
  5. **C.5 AdmitCard data-shape + Sprint M9 frontend** — BLE/SEE prep Spring 2027; gated on D.4 + D.5.
  6. **C.1.10-follow-on (V1.5)** — custom letterhead returns alongside C.2 Template Editor + live preview. Reactivation: re-enable the finance projection forwarding + the BrandingForm letterhead slot + add the UI preview pipeline. All upstream infra (S3 bucket, presign, allowlist, BRANDING_ASSET_TYPES, letterheadFit prop in pdf-renderer 0.8.0) is intact.
- **V1.5 deferred per CEO calls:** EPIC-B (Messaging, 19 tickets), A.5 (Period Attendance, 10 tickets), EPIC-G (Operator Feedback, 9 tickets), D.7 (StudentAcademicTrack, 3 tickets)

---

## 0.5 How to read this document

This breakdown organizes V1 work by **EPIC** (the 6 tracks from the master framework plus 2 wrap-arounds), each EPIC containing **Sprints**, each Sprint containing atomic **Tickets**. No timeline. Sequencing is encoded in the dependency graph (§12) and the per-sprint "depends on" lines.

**Naming convention:**
- EPIC: `EPIC-{ID}` where ID is one of `0, A, B, C, D, E, F, G, H` (matches §1.2 table)
- Sprint: `{EPIC-ID}.{N}` (e.g., `A.2`, `D.4`)
- Ticket: `{EPIC-ID}.{Sprint-N}.{Ticket-N}` (e.g., `A.2.3` — EPIC-A, Sprint 2, Ticket 3); for atomic split tickets, append a/b/c (e.g., `A.3.4a`)

**Status icons:**
- 🟢 Done · 🟡 In flight · ⏳ Next · 🔲 Pending · 🔴 Blocked

This is an executable plan, not a road-map sketch. Every ticket below MUST be reviewable in 30-60 minutes, MUST land in one PR, and MUST close one DoD-checked acceptance criterion.

---

## 1. Conventions

### 1.1 Atomic ticket — every ticket carries

- **Files:** what changes, with absolute paths
- **Validation:** test path or concrete check (jest unit / integration / e2e / smoke / manual-verification-procedure with expected output)
- **AC:** reviewer-checkable acceptance criteria (no "tested locally")
- **Deps:** explicit list of prior tickets/sprints required
- **Risk flags:** if any invariant is at risk, called out

### 1.2 The 8 EPICs — ordered by **linear school-adoption arc** (v3.2, 2026-05-22)

A real school doesn't onboard and start using all features Day-1. The adoption arc is: signup → training/demos → daily-use basics (attendance, classwork, grades) → first term-end (exam → result → report card → printed PDFs) → external exam workflows → cross-year transition → compliance reporting. Each EPIC ships when the school's adoption is ready to consume it.

| Order | EPIC | Track | When the school uses it | One-line goal |
|---|---|---|---|---|
| 1 | **EPIC-0** | Foundation hardening | Pre-adoption (engineering only) | Close operator-feedback + foundational debt (ENG-1/ENG-2 + academics audit infra + ArchetypeDefaults) |
| 2 | **EPIC-G** (G.1 + G.2 start) | Operator validation begins | Pre-adoption + continuous | Champion field trip → ground-truth research before designing EPIC-D/E details; weekly operator sync starts |
| 3 | **EPIC-A** (excluding A.5) | Operate | Months 1-2 of adoption | Dashboard daily-activity + Subject + Exam + Result + ReportCard pipeline |
| 4 | **EPIC-C** | Distribute | Month 2-3 (in lockstep with A.4 result publish) | Document Rendering Service + School Branding + 4 V1 templates (Invoice, Bill, Admit Card, Report Card) |
| 5 | **EPIC-D** | Plan (Nepal-specific) | Month 3-4 (BLE/SEE prep Spring 2027) + Month 11+ (cross-year) | GradingPolicy pluggability + PromotionRule + ExternalAssessment family + BLE/SEE/NEB workflows + cross-year handoff |
| 6 | **EPIC-E** | Comply | Month 4+ (CEHRD compliance cycle) | Flash I/II MVP + Discipline soft + residency + consent + tenant export |
| 7 | **EPIC-G.3** | Adoption telemetry | Continuous from Month 2 | **EXTEND existing partial telemetry** (already scaffolded — do NOT reinvent) |
| 8 | **EPIC-F** | Generalize | Pre-pilot-2 (after Saraswati is operationally stable) | Two-pilot smoke matrix + synthetic GENERIC archetype + Pilot 2 onboarding |
| 9 | **EPIC-H** | Greenlight + hypercare | Saraswati Month 6+ | Real-operator evidence + Five Green stamps + 30-day hypercare |
| **DEFERRED V1.5** | **EPIC-B** | **Communicate** | **Post-Greenlight / V1.5** | Messaging microservice + parent inbox real-wiring + SES + notice subsystem. **Deferred per CEO 2026-05-22 — parents + students already log in via portals; WhatsApp / school-diary handles current parent communication; building messaging too early is premature optimization. EventBridge bus + DLQ + Messages MFE frontend (mock data) are already scaffolded; wiring waits until adoption arc demands.** |

**EPIC-A.5** (period attendance + Timetable + Substitute) remains V1.5 per CEO 2026-05-19 (daily-use audit decision).

### 1.3 Sprint-level DoD (per `sprint-plan.md` §11, extended)

A sprint is "Done" when:
- [ ] Every ticket meets per-ticket DoD (§1.1 above + invariants check)
- [ ] Sprint demo recorded or run live against a pilot dev tenant or Saraswati
- [ ] Private deploy evidence summarized in `docs/deploys/INDEX.md` for any prod-touching action
- [ ] No regressions in prior sprints' smokes (regression bundle re-run)
- [ ] Closeout note added to `docs/pilot-greenlight/sprint-closeouts.md`

### 1.4 Per-ticket invariant gate (run BEFORE merge)

Lifted from `sprint-plan.md` §10:

- [ ] Audit + event emission paired (Sprint 0.2.7 ESLint rule enforces post-merge)
- [ ] Three-way route registration verified (Nest + tenant-api-prod.json + nginx.template if new prefix)
- [ ] If shared-types changed: minor bump + npm publish + AdminWeb jsdom sim per CLAUDE.md "Per-sprint shared-types publish checklist"
- [ ] If new NestJS module: `module-wiring.spec.ts` updated in same PR
- [ ] If new GSI: `docs/pilot-greenlight/gsi-inventory.md` updated before CDK deploy
- [ ] Invariant 13 grep (no pilot-specific names in code) returns zero hits

### 1.5 Implicit Files: contract (avoids per-ticket repetition; enforced at PR review)

To keep ticket Files: lines focused on the substantive change, the following files are **implicitly part of the Files: list** for every ticket of the matching category and MUST be present in the PR diff:

- **Any new-route ticket** (any `@Get`/`@Post`/`@Patch`/`@Delete` decorator added at a new path):
  - Implicit: `server/lib/tenant-api-prod.json` (always)
  - Implicit: `server/application/reverseproxy/nginx.template` (only if new top-level prefix; sub-paths under existing `/academics`, `/schools`, `/users`, `/tenants`, `/finance` prefixes do NOT need nginx changes)
- **Any new NestJS module ticket** (any new `*.module.ts`): `microservices/<svc>/src/__tests__/module-wiring.spec.ts`
- **Any new entity ticket**: matching Zod schema in `packages/shared-types/src/schemas/<domain>/<entity>.schema.ts`
- **Any new GSI ticket**: `docs/pilot-greenlight/gsi-inventory.md`
- **Any shared-types schema change**: `packages/shared-types/package.json` (version bump); AC adds "AdminWeb jsdom bundle sim green per CLAUDE.md"
- **Any CDK change** (new Lambda, new bucket, new EventBridge rule, new SQS queue): `server/lib/tenant-template/tenant-template-stack.ts` OR `server/lib/shared-infra/shared-infra-stack.ts` (whichever scope) — explicit in the Files: line

A reviewer who sees a new-route ticket without `tenant-api-prod.json` in the PR diff **rejects without further comment**.

### 1.6 Sequencing rationale — Nepal-archetype product completeness (v3.3, 2026-05-22)

EPICs are sequenced by **product-completeness dependency**, not by any school's calendar. The reasoning:

- **The product must be complete for the Nepal PABSON archetype before we say "ready for adoption."** Each EPIC closes a specific gap in that completeness.
- **Earlier EPICs unblock later EPICs technically**, not because some school is "ready to consume" them. E.g., ArchetypeDefaults (0.4) is foundational because every Track-D entity reads from it; not because the school is asking for it.
- **Communication (EPIC-B) is deferred V1.5 because the product is functionally complete without it.** Parents + students already log in to portals; PDFs reach parents through existing school channels (WhatsApp, diary, school-managed distribution). Messaging is an enhancement, not a completeness gap.
- **Operator validation (EPIC-G)** is reframed: continuous iterative feedback is welcome, but NOT a critical-path blocker. The product is designed from primary-source evidence we already have. Field-trip validation is enrichment, not gating.
- **Premature optimization is rejected** anywhere it shows up. If a feature isn't a completeness gap, it goes to V1.5.

### 1.7 Build on existing scaffolding — DO NOT REINVENT

Per CEO 2026-05-22: a substantial amount of EdForge's foundation is already shipped. Every EPIC below MUST start with a "Foundation in place" inventory of what scaffolding exists; ticket Files: lines target **extensions**, not greenfield rewrites. The cross-EPIC inventory:

| Area | What's already shipped | EPIC that extends it |
|---|---|---|
| Identity service | Schools, staff, students, guardians, tenant settings, workspace settings, locale defaults, IEMIS import driver, Cognito roles (TenantAdmin / Principal / Teacher / Parent / Student) | EPIC-0 (audit infra), EPIC-D (Subject + grading + external-exam), EPIC-E (consent + export) |
| Academics service | Courses, sections, schedules, enrollment, attendance (day + section), classwork, grades, grading-policy, dashboard, calendar-blocks, bell-schedules, students.iemis-import | EPIC-A (dashboard polish + Subject + exam + result), EPIC-D (external exams + cross-year), EPIC-E (discipline) |
| Finance service | Invoices, payments (manual + eSewa + Khalti), ledger, fee-structure (versioned), credit-notes, refunds, discount-rules, payment-gateways, finance-dashboard, atomic Payment+Invoice+Ledger+BillingAccount | EPIC-C (PDF render hooks), EPIC-E (scholarship audit) |
| EventBridge + Zod taxonomy | Bus deployed; DLQ stack; 25 domain event schemas; runtime payload validation in `EventServiceBase` | EPIC-C (invoice events), EPIC-D (exam + result + external-exam events), **EPIC-B (notification events — DEFERRED V1.5)** |
| Frontend MFEs | AdminWeb (system-admin) + Shell + Academics MFE + People MFE + Finance MFE + Analytics MFE + Parent Portal (5 pages) + Student Portal (4 pages) + Messages MFE (mock data) | EPIC-A (frontend cards), EPIC-C (operator branding UI), **EPIC-B (Messages MFE real wiring — DEFERRED V1.5)** |
| Pilot fixtures | `@edforge/pilot-fixtures` workspace + Saraswati registered fixture (calendar, bell, structure, holidays, programs); loader utility | EPIC-D (archetype defaults extension), EPIC-F (pilot 2 + GENERIC) |
| Calendar | BS/AD converter (BS 2000-2090); calendar generator with weekend rules + holidays + vacations; multi-day blocks; shift-profile endpoint; DATE_NOT_INSTRUCTIONAL validation | EPIC-A (event-aware rollup in A.5 V1.5) |
| CDK + ECS | tenant-template-stack-basic deployed; per-tenant DDB tables; shared-infra; per-tenant Cognito; ABAC roles; CodeBuild provisioning | EPIC-B (messaging svc — V1.5), EPIC-C (rendering Lambda + tenant-assets bucket), EPIC-D (result-gen Lambda) |
| Telemetry | **Partially shipped** — emit-site instrumentation exists in some services; CloudWatch metrics in place for ECS / Lambda / DDB; some adoption-relevant events emit but no aggregation/dashboard | EPIC-G.3 — **EXTEND, do not reinvent** |
| Audit / events ESLint pairing rule | Pending v2 plan D0b.7 (delivered in Sprint 0.2.7 here) | EPIC-0 |
| AuditedWriteService | Exists in identity; missing in academics (Risk R17) | EPIC-0.3 (port) |
| `@aibrains/pdf-renderer` shared package | **NEW in EPIC-C.0 — does not yet exist.** Will be net-new npm-published workspace package modeled on `@aibrains/shared-types` (publish-gate rules same: caret-pin trap, AdminWeb jsdom sim). Built on `@react-pdf/renderer` (NOT Puppeteer+Handlebars — see EPIC-C revised plan §5). | EPIC-C (Phase 0 foundation); reused by finance / academics / identity / batch Lambda / Shell live preview |
| Shell-level settings pages (`/settings/workspace`, `/settings/school-configuration`) | Exist in `apps/shell/src/pages/settings/` with `SettingsShared` primitives | EPIC-C (new `/settings/pdf-templates` page mirrors pattern — TenantAdmin manages templates from one place across all doc types) |

**Rule: every ticket's `Files:` line must edit or extend existing files where applicable. NEW files only when no existing target exists. If a ticket appears to require a NEW microservice, NEW entity, or NEW Lambda but the engineer suspects an existing one could be extended, the ticket auto-becomes a 🔬 pre-execution research ticket (§1.8) before coding.**

### 1.8 🔬 Pre-execution INTERNAL research markers (v3.3, 2026-05-22)

Where a ticket's design has open assumptions, **the FIRST task at execution time is to do internal research + design + update the ticket spec — not jump to coding**. **The research is internal**, sourced from:

- **CEHRD / NEB / CDC / MoEST published documents** (publicly available; prior agent research already collected URLs in `v1-master-framework.md` §10)
- **Our existing codebase** (audit what's already shipped before proposing NEW)
- **Allen ISD reference framework** (the structured analog, already studied in `Copy of Middle School 2025-2026 APG- Official.md`)
- **Prior agent research output** (the BLE/SEE/NEB/PABSON pre-board research already in the conversation log → folded into framework §3)

**NOT** sourced from on-site visits, operator interviews, or "wait for champion to confirm." Field-trip evidence is a refinement signal that arrives after V1 ships, not a precondition.

Marker syntax:

- **🔬 marker prefix** on any ticket whose design needs internal research first
- **Pre-execution task** spelled out: review the specific primary sources + existing code + reference docs; output a 1-2 page decision artifact; update ticket Files/AC/Deps based on the artifact; THEN code.
- **Output artifact** (a `.md` decision doc) is the gate — engineers either ship the artifact + updated spec OR don't get review.

A reviewer who sees a 🔬 ticket land as code without the artifact + updated spec in the PR description **rejects without further comment**.

The 🔬 tickets in this plan are flagged inline below; the §16 summary table at the bottom enumerates them with their primary-source inputs.

---

## 2. EPIC-0 — Foundation Hardening

**Goal:** Close operator-feedback compounding gaps, ship the `archetypeDefaults` entity + academics `auditedWrite` infrastructure that EPICs A–F all depend on, and resolve the v2 D0a/D0b backlog. This is the prerequisite plumbing for everything else.

### Sprint 0.1 — Operator-Feedback Compounding (Saraswati-blocking the moment uploads resume)
**Status:** 🟡 **4/5 tickets shipped pre-v3.4** (per memory `project_sprint_0_1_closed`). **0.1.3 reclassified** as deferred 206-row IEMIS historical-debt (motherTongue / disabilities / isTransferred missing on pre-0.1.2a Saraswati rows; XLSX not stored + import skips duplicates). Remedy folded into Sprint E.1.5 pre-flight surfacing per §17.6 matrix; first real Saraswati Flash I export will surface the gap with `suggestedRemedy='Sprint-0.1-deferred-debt-see-§17.6'`.


**Source:** v2 plan D0a + c4-ops-sprint-plan.md. Saraswati's principal uploads daily; gaps compound row-by-row. Ship in lock-order BEFORE next upload.

**Demo:** Live curl on Saraswati's `/iemis/jobs` returns ≥5 historical jobs; next principal upload populates `motherTongueDescriptor` + `sexDescriptor`; backfill log shows 206/206 rows updated; injected stuck job → 5 min later janitor marks `failed`, SNS fires.

#### Tickets

- **0.1.1** — IEMIS jobs LIST endpoint (ENG-1). **Lock-ordered FIRST**; 0.1.3 depends.
  - Files: `microservices/academics/src/students/students.controller.ts` (`@Get('students/import/iemis/jobs')`); `students.service.ts` (`listIemisImportJobs(schoolId, opts, ctx)`); `server/lib/tenant-api-prod.json`; spec.
  - Validation: jest integration; live curl on Saraswati: returns ≥5 historical jobs sorted `createdAt desc`; ≥1 has `findings[].length > 0`.
  - AC: `GET /academics/students/import/iemis/jobs?schoolId=&since=&limit=&cursor=` returns paginated list; ABAC-scoped per tenant; route-drift lint green; no PII in finding text.
  - Deps: none.

- **0.1.2a** — IEMIS transformer field extension (ENG-2 part 1).
  - Files: `iemis-transform.ts` (lines 240-258 extended to populate `motherTongueDescriptor`, `isTransferred`, `disabilities`, `sexDescriptor`); spec (+4 derivation tests for `deriveSexDescriptor`).
  - Validation: jest unit; live next IEMIS upload lands with `sexDescriptor` populated.
  - AC: All 4 target fields populated when source XLSX provides them; existing 133 academics tests stay green; entity-vs-schema contract test extended for Student.
  - Deps: none.

- **0.1.2b** — IEMIS descriptor lookup tables (ENG-2 part 2).
  - Files: `iemis-transform.ts` — `mapMotherTongueToEdFi`, `mapDisabilityToEdFi` lookup tables (Ed-Fi `LanguageDescriptor` + `DisabilityDescriptor` namespaces); spec (+12 mapper tests: known/unknown/mixed-case/empty per mapper).
  - Validation: jest unit; unknown values emit warning to `IemisImportJob.findings[]`, not rejection.
  - AC: Lookup tables reviewed against Ed-Fi spec; unknowns warned not rejected; CEHRD-Nepal-specific values resolved (Maithili, Bhojpuri, Tharu, Newari, etc.); audit trail on every lookup hit.
  - Deps: 0.1.2a.

- **0.1.3** — IEMIS backfill script for Saraswati's 206 historical rows. ⚠️ **RECLASSIFIED 2026-05-22 → deferred data-debt; NOT executed as engineering.** See [sprint-closeouts.md Sprint 0.1](sprint-closeouts.md#sprint-01--operator-feedback-compounding-v1-master-epic--first-execution-sprint) + §17.6 below for full reasoning.
  - **Original spec (no longer applicable):** Files: `scripts/backfill-iemis-derived-fields-saraswati.ts` (NEW); reads jobs via 0.1.1; re-reads original XLSX from S3; computes derived fields via 0.1.2; PATCHes each Student.
  - **Why deferred:** Two audits (2026-05-22) revealed (a) the IEMIS import endpoint does NOT store the source XLSX (parsed JSON rows, in-memory only, discarded post-import — no S3 stash); (b) the import endpoint hard-codes SKIP on duplicate `emisStudentId` (no upsert mode). Of the 4 missing descriptor fields, only `sexDescriptor` is recoverable from existing `Student.gender`; `motherTongueDescriptor`, `disabilities`, and `isTransferred` are unrecoverable without operator XLSX re-upload AND new `mode='upsert'` engineering on the import endpoint.
  - **Resolution path:** Debt is bounded (Saraswati only; 206 rows; not compounding now that 0.1.2a forward-path works). Surfaces naturally at Sprint **E.1.5** (Flash I/II pre-flight validation): operator gets a "206 students missing X" warning; chooses remedy then (upsert mode, sexDescriptor-only script, manual UI, or submit-with-gaps + amend). Engineering decision deferred to E.1 sprint kickoff with real operator context.
  - Deps: n/a (deferred).

- **0.1.4** — IEMIS Job Janitor Lambda (BL-1; mirrors rollup-janitor pattern).
  - Files: `server/lib/analytics/lambda/iemis-job-janitor/janitor-lambda.ts` (existing dir; verify NEW vs replace existing); `server/lib/tenant-template/tenant-template-stack.ts` (CDK wiring); EventBridge Scheduler `cron(*/5 * * * ? *)`.
  - Validation: unit on marker logic; integration: inject stuck row → next cron run marks `failed` + SNS notify.
  - AC: Cron schedule visible in EventBridge Scheduler console (not Lambda Triggers tab); SNS subscription captures alerts; no false-positives on legitimate <30min jobs.
  - Deps: none.

- **0.1.5** — XLSX strict-header validation (BL-2).
  - Files: `iemis-transform.ts` — `validateIemisHeaders(headers: string[])`; required columns from `IemisRow` enforced; unknown columns warn; missing required columns reject 400 `IEMIS_HEADERS_INVALID`.
  - Validation: jest unit; integration: upload XLSX missing `Gender` → 400 with structured detail listing missing headers.
  - AC: Header-rename detection before row processing; warnings vs rejections differentiated; CEHRD-source files pass cleanly.
  - Deps: 0.1.2a.

### Sprint 0.2 — Operator-Feedback Non-Compounding (parallel with 0.1)
**Source:** v2 plan D0b. Resolve gaps that don't compound with operator activity.

**Demo:** Cross-tenant 403; Bug 2 spike report committed (or "not-repro" verdict); NO_CURRENT_AY UI CTA shows; PATCH session date → paired GP updated; pilot-greenlight harness 7/7 with seed-pilot-terms.ts removed; ESLint rule catches deliberately-mismatched commit.

#### Tickets

- **0.2.1** — `AccessDeniedException` → 403 with `CROSS_TENANT_FORBIDDEN`.
  - Files: `microservices/identity/src/common/services/dynamodb-client.service.ts` (wrap `getItem`/`query`/`putItem`/`updateItem`/`deleteItem`/`batchWrite`); integration test.
  - Validation: jest integration negative: JWT-tenant-A → request tenant-B → expect 403, not 500.
  - AC: 403 + structured `errorCode` per invariant 7; `details` carries requested-vs-session tenant IDs (PII redacted); same-tenant calls unaffected.
  - Deps: none.

- **0.2.2** — Bug 2 spike: `/finance/invoices` cross-tenant settings request.
  - Files: None initially (spike). Outputs `docs/pilot-greenlight/d0b-bug2-spike.md` + follow-up ticket if reproducible.
  - Validation: repro documented; or "not-repro" verdict closes.
  - AC: Either a `0.2.2-fix` ticket lands in next sprint review, or 0.2.2 closes "not-repro" with operator-side localStorage hygiene as workaround.
  - Deps: none.

- **0.2.3** — `NO_CURRENT_AY` UX (frontend CTA).
  - Files: `edforge-saas-frontend/.../useCurrentAcademicYear()`; CTA component.
  - Validation: manual: AY with `status=active, isCurrent=false` → UI shows "Set a current AY" CTA pointing at AY list with "Set current" button.
  - AC: Operator self-recovers without engineer involvement.
  - Deps: none.

- **0.2.4** — `updateSession` syncs dates to paired GradingPeriod.
  - Files: `microservices/identity/src/schools/academic-session.service.ts` (`updateSession` path); spec extension.
  - Validation: jest unit: PATCH session dates → paired GP dates updated. Smoke: PATCH `dev-pabson-primary` session date → GP updated.
  - AC: Session date PATCH propagates; failure non-fatal (consistent with PR #129 auto-pair); audit row per change.
  - Deps: none.

- **0.2.5** — `deleteSession` cascade + DELETE `/grading-periods/:termId`.
  - Files: `academic-session.service.ts` (`deleteSession` cascade); `academic-years.service.ts` (NEW `deleteGradingPeriod`); `academic-years.controller.ts` (NEW `@Delete('grading-periods/:termId')`); routes three-way.
  - Validation: jest integration; live: clean up smoke artifact `PR129-SMOKE-DELETEME` GP in `dev-pabson-primary`.
  - AC: DELETE session cascades to paired GP; new GP DELETE route works standalone; transactional (TransactWriteItems if same table); route-drift lint green.
  - Deps: none.

- **0.2.6** — Retire `seed-pilot-terms.ts`.
  - Files: delete `scripts/pilot-greenlight/seed-pilot-terms.ts`; update `scripts/smoke-tests/pilot-greenlight.ts` to drop SETUP step.
  - Validation: re-run harness against `dev-pabson-primary` → still 7/7 (sessions auto-pair GPs at create-time via PR #129).
  - AC: Script removed; harness still 7/7; no regression.
  - Deps: 0.2.4 + 0.2.5.

- **0.2.7** — ESLint rule: `auditedWrite` ↔ `publishValidatedEvent` pairing.
  - Files: `eslint-rules/audited-write-event-pair.js` (NEW; AST walk); CI integration; tests.
  - Validation: CI fails on a deliberately mismatched commit.
  - AC: Lint catches missing-emit-after-audited-write.
  - Deps: none.

- **0.2.8** — BS date picker hygiene PR.
  - Files: `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` (branded types R1; error handling R3; boundary tests R4; dual AD/BS validation R5).
  - Validation: frontend unit + Playwright on each BS-date entry surface.
  - AC: Per audit follow-up doc; no behavior change observable from outside the picker.
  - Deps: none.

- **0.2.9** — Identity `workspace-settings.entity.ts` `COUNTRY_DEFAULTS` sync-guard test.
  - Files: `server/application/microservices/identity/src/common/entities/__tests__/workspace-settings-country-defaults.sync.spec.ts` (NEW); asserts hardcoded `COUNTRY_DEFAULTS` at `workspace-settings.entity.ts:121` matches canonical export at `packages/shared-types/src/locale/tenant-locale-defaults.ts:74`.
  - Validation: CI test fails if identity-side copy drifts from shared-types.
  - AC: Drift detection at CI time; addresses CLAUDE.md-noted duplication.
  - Deps: none.

- **0.2.10** — Entity-vs-schema contract test pattern extended.
  - Files: Contract test for Staff, Student, AcademicYear, Term, BellSchedule, CalendarBlock entities (mirroring `calendar-date.contract.spec.ts`).
  - Validation: each contract test asserts entity factory output exactly matches Zod schema parsed output.
  - AC: 6 new contract specs; CI gates.
  - Deps: none.

- **0.2.11** — Grading-period markers on calendar grid (frontend).
  - Files: `edforge-saas-frontend/apps/shell/src/components/calendar/MonthGrid.tsx` — visual decorators showing term boundaries.
  - Validation: Playwright e2e against `dev-pabson-primary` 4-term layout.
  - AC: Term boundaries visible; matches PABSON 4-quarter structure; no regression on existing block overlay.
  - Deps: none.

- **0.2.12** — Playwright E2E auth setup → CI integration.
  - Files: `edforge-saas-frontend/e2e/auth-setup/cognito-storage-state.ts` (NEW); GH Actions wiring; `EDFORGE_PROD_JWT` env removed.
  - Validation: existing `calendar-blocks.spec.ts` runs against `dev-pabson-primary` from CI.
  - AC: Playwright suite runs unattended in CI; no manual JWT-paste.
  - Deps: none.

- **0.2.13** — Finance widen to tenant-currency.
  - Files: `credit-note.entity.ts`, `fee-structure.entity.ts`, `refund-request.entity.ts` — replace NPR literal with `string` sourced from `SchoolConfiguration.currency`; shared-types schemas widened.
  - Validation: existing NPR data continues to validate; integration with synthetic GENERIC fixture shows USD passes.
  - AC: Three entities no longer carry NPR literal; existing Saraswati finance rows unaffected.
  - Deps: none.

- **0.2.14** — `dev-pabson-primary` SchoolConfiguration cleanup audit.
  - Files: none — read-only audit.
  - Validation: `GET /schools/:id/configuration` against every school in `dev-pabson-primary`; assert PABSON defaults (NPR, Asia/Kathmandu, bikram_sambat).
  - AC: Tenant clean; or cleanup ticket scoped before EPIC-A starts.
  - Deps: none.

### Sprint 0.3 — Academics Audit + Module-Wiring Infrastructure
**Source:** v2 plan Risk R17 + R19. Academics service is missing `auditedWrite` infrastructure (identity has it) AND `module-wiring.spec.ts`. Block for K.5 multi-school.

**Demo:** Academics module-wiring spec fails on a deliberate "forgot import" mutation; passes on main. Direct DDB writes in academics replaced with `auditedWrite` calls; audit-row count matches write count post-Sprint-0.3.

#### Tickets

- **0.3.1** — Port `AuditedWriteService` from identity to academics.
  - Files: `microservices/academics/src/common/services/audited-write.service.ts` (NEW; mirrors identity); `academics.module.ts` registers.
  - Validation: unit on service; integration on an existing academics write path that uses it.
  - AC: Service exists; module-wired; one example consumer in academics calls it.
  - Deps: none.

- **0.3.2** — Academics `module-wiring.spec.ts`.
  - Files: `microservices/academics/src/__tests__/module-wiring.spec.ts` (NEW; mirrors identity's).
  - Validation: spec fails on deliberate "forgot import" mutation; passes on main.
  - AC: ~150 LOC; CI gates.
  - Deps: none.

- **0.3.3** — Migrate Grades writes to `auditedWrite`.
  - Files: `microservices/academics/src/grades/grades.service.ts` — every `dynamoDb.putItem/updateItem/deleteItem` → `auditedWrite`.
  - Validation: integration — write 10 grades → 10 audit rows visible via audit API.
  - AC: All Grade writes audited; existing tests stay green.
  - Deps: 0.3.1.

- **0.3.4** — Migrate Attendance writes to `auditedWrite`.
  - Files: `microservices/academics/src/attendance/attendance.service.ts` + `section-attendance.service.ts`.
  - Validation: integration — write attendance → audit rows.
  - AC: All attendance writes audited.
  - Deps: 0.3.1.

- **0.3.5** — Migrate Sections + Courses + CourseOffering + Classwork writes to `auditedWrite`.
  - Files: respective service files in academics.
  - Validation: integration per module.
  - AC: All writes audited.
  - Deps: 0.3.1.

- **0.3.6** — CourseOffering event emission gap close (invariant 6).
  - Files: `course-offering.service.ts` adds `publishCourseOfferingCreated/Updated/Deleted` via `eventsService`. Legacy PascalCase OK pre-Sprint-B.2.
  - Validation: 3 emission tests.
  - AC: Every CourseOffering write emits one event.
  - Deps: 0.3.1.

- **0.3.7** — Academics 404 → structured `errorCode` hardening.
  - Files: Classwork/Grades/Sections/Courses — replace `NotFoundException` with structured `errorCode` per `NO_CURRENT_AY` pattern.
  - Validation: integration negative per module (404 returns `{ statusCode, errorCode, message, details }`).
  - AC: 4 modules hardened.
  - Deps: none.

### Sprint 0.4 — `ArchetypeDefaults` Entity
**Status:** 🟢 **shipped to prod 2026-05-22** (per memory `project_sprint_e_0_shipped_prod` — Sprint E.0 + 0.4 closed together at Phase 7). All 6 tickets live: shared-types schema + PABSON + GENERIC profiles + loader service + `GET /archetype-defaults?archetype=` endpoint (live on prod API GW) + invariant-12 lint with B/D/F/T-tagged allowlist (29 files at ship; grew to 35 post-D.1.3 additions).

**Foundation for everything in EPIC-D (Plan).** Today archetype defaults are implicit in code; EPIC-D entities need explicit lookup.

**Demo:** `GET /archetype-defaults?archetype=PABSON` returns canonical PABSON profile (gradeLadder, boardExams, gpaScale, examPattern, complianceForms, internalAssessmentWeights, language, currency, calendarSystem, weekStart). Synthetic `GENERIC` profile also resolvable.

#### Tickets

- **0.4.1** — `ArchetypeDefaults` schema + entity.
  - Files: `packages/shared-types/src/schemas/archetype-defaults.schema.ts` (NEW); `microservices/identity/src/common/entities/archetype-defaults.entity.ts` (NEW). Schema covers: `archetype` (enum), `gradeLadder[]`, `boardExams[]` (with `{examType, grade, authority, internalWeight, externalWeight}`), `gpaScale` (4.0 default), `letterGrades[]` (with bands), `examPattern[]` (e.g., `[unit_test, terminal, send_up, pre_board]`), `complianceForms[]`, `language[]`, `currency`, `calendarSystem`, `weekStart`, `defaultMission?`, `defaultExamRulesText?`.
  - Validation: schema unit; entity-vs-schema contract test.
  - AC: Schema covers all known archetype-shaped fields; contract test green; module-wiring updated.
  - Deps: none.

- **0.4.2** — `ArchetypeDefaults` PABSON profile seed.
  - Files: `packages/shared-types/src/archetype-defaults/pabson.ts` (NEW). PABSON profile: gradeLadder=[ECD,PPC,KG,1..10], boardExams=[BLE@8 (municipal, 0.5/0.5), SEE@10 (NEB, 0.25/0.75), NEB-11@11 (NEB, 0.25/0.75), NEB-12@12 (NEB, 0.25/0.75)], gpaScale=4.0, letterGrades=[A+/A/B+/B/C+/C/D+/D/E with CEHRD bands], examPattern=[unit_test, terminal, send_up, pre_board, final], complianceForms=[IEMIS_FLASH_I, IEMIS_FLASH_II, FORM_19_SOFT], language=[en-NP,ne-NP], currency=NPR, calendarSystem=bikram_sambat, weekStart=sunday.
  - Validation: jest schema-validation; PABSON-specific tests.
  - AC: Profile passes schema; importable from `@aibrains/shared-types`.
  - Deps: 0.4.1.

- **0.4.3** — `ArchetypeDefaults` GENERIC profile seed (for EPIC-F generalization).
  - Files: `packages/shared-types/src/archetype-defaults/generic.ts` (NEW). GENERIC: gradeLadder=[K,1..12], boardExams=[], gpaScale=4.0, letterGrades=[A/B/C/D/F], examPattern=[unit_test, terminal, final], complianceForms=[], language=[en-US], currency=USD, calendarSystem=gregorian, weekStart=monday.
  - Validation: jest schema-validation.
  - AC: Profile passes schema; used in EPIC-F synthetic smoke.
  - Deps: 0.4.1.

- **0.4.4** — `ArchetypeDefaults` loader service.
  - Files: `microservices/identity/src/archetype-defaults/archetype-defaults.service.ts` (NEW); module-wired.
  - Validation: unit: `getDefaults('PABSON')` → PABSON profile; `getDefaults('GENERIC')` → GENERIC; `getDefaults('UNKNOWN')` → 404 `ARCHETYPE_NOT_FOUND`.
  - AC: Cached at module init (read once); thread-safe; module-wiring updated.
  - Deps: 0.4.2 + 0.4.3.

- **0.4.5** — `GET /archetype-defaults?archetype=` endpoint.
  - Files: `archetype-defaults.controller.ts` (NEW); routes three-way (`/archetype-defaults` new prefix → new nginx block).
  - Validation: integration; route-drift lint.
  - AC: Endpoint returns archetype defaults; ABAC: TenantAdmin read-only.
  - Deps: 0.4.4.

- **0.4.6** — Invariant 12 amendment + lint regression spec.
  - Files: `scripts/lint/check-invariant-12.sh` (NEW); allowlist for boundary drivers (`iemis-transform.ts`, future SES adapter, etc.); CI gate.
  - Validation: lint runs against `server/application/microservices/*/src/`; allowlisted files excluded; other files with `archetype` literals fail.
  - AC: CI enforces; failures structured.
  - Deps: 0.4.4.

---

## 3. EPIC-A — Operate (Exam → Result → ReportCard pipeline + daily-use)

**Goal:** Saraswati's full term-end workflow runs end-to-end on EdForge: operator defines exam schedule → teachers enter marks → system computes result → report card rendered + distributed.

### Sprint A.1 — Daily-Use Coverage Improvements (audit-driven)
**Source:** v2 plan D1 rescoped per daily-use audit. Per-period attendance moved to A.5 (post-Greenlight).

**Demo:** Principal sees 3 new cards on dashboard above-the-fold (recent classwork, grades yesterday, sections-attendance-taken). Co-teacher UI ships in SectionForm if Saraswati operator confirms. Inter-section transfer endpoint atomic.

#### Tickets

- **A.1.1** — Dashboard daily-activity surfaces.
  - Files: `microservices/academics/src/dashboard/dashboard.service.ts` extends `getOverview` with `recentClassworkCount`, `recentGradeCount`, `sectionsWithAttendanceTaken`; DTO updated; AdminWeb cards.
  - Validation: integration: seeded classwork + grades + attendance → counts match; manual: principal sees cards.
  - AC: 3 new fields on overview DTO; cards visible on dashboard.
  - Deps: 0.3.1 (uses `auditedWrite` audit-row counts for some queries).

- **A.1.2** — Co-teacher UI in SectionForm. **(De-blocked v3.3: backend already supports it; ship the UI unconditionally.)**
  - Files: `edforge-saas-frontend/apps/academics/src/components/scheduling/SectionForm.tsx` — multi-select `coTeacherIds` (backend field `coTeacherIds[]` already exists on Section entity per `course.entity.ts:149`).
  - Validation: Playwright e2e: create section with primary + 2 co-teachers → backend persists; GET returns all 3.
  - AC: UI exposes multi-select; schools that don't co-teach simply leave it empty. No operator confirmation needed; if the backend supports it, the UI ships.
  - Deps: 0.3.5 (Sections migrate to `auditedWrite`).

- **A.1.3** — Within-school inter-section transfer endpoint.
  - Files: `microservices/academics/src/sections/sections.controller.ts` (`@Post(':id/transfer')`); service implements atomic TransactWriteItems drop+add; emits `StudentTransferredBetweenSections`; three-way handoff.
  - Validation: integration: transfer 3 students from 8A to 8B → both sections updated atomically; partial failure rolls back.
  - AC: Single-call atomic transfer; audit + event per transfer.
  - Deps: 0.3.1.

### Sprint A.2 — Course Extension + CDC Curriculum Foundation (v3.4 — A.2.0 resolved)
**Source:** Framework Track D-Plan D1. Existing `Course.subjectArea` is an enum mixing subject + course-type; we extend it with structured Ed-Fi-aligned fields.

**Foundation in place:** `Course` entity with `subjectArea` (enum) + `gradeLevels[]` (string[]) + `credits` + `courseType` + `prerequisites[]` already exists at `microservices/academics/src/common/entities/course.entity.ts`. Section-Course-Enrollment relationship already in place.

**✅ A.2.0 RESEARCH RESOLVED (2026-05-22) — Option (B) chosen.** Artifact: [`a2-subject-vs-course-decision.md`](./a2-subject-vs-course-decision.md). Summary:
- **No separate `Subject` entity.** Ed-Fi V6 treats academic subject as `AcademicSubjectDescriptor` *on the Course* (no standalone `Subject` resource in core Ed-Fi).
- **Extend `Course` with three new fields**: `academicSubject` (descriptor enum), `stateSubjectCode?` (NEB/CDC code, e.g. `004` for English), `curriculumRef` (`CDC_NCF_2076` | `CAMBRIDGE_IGCSE` | `IB_MYP`).
- **Multi-track handling (CDC + Cambridge):** two Course rows sharing same `academicSubject` descriptor but distinct `curriculumRef`. Filtering at frontend uses `curriculumRef`; aggregation at dashboard uses `academicSubject`.
- **DynamoDB cost:** zero new JOINs/BatchGetItem; descriptor on Course is a single-row lookup. GSI on `curriculumRef` added for tenant-level filtering.
- **Backward compat:** existing `subjectArea` enum kept as denormalization (not removed); new fields are additive.
- **Grades 1-3 integrated curriculum (K-3 thematic) → V1.5 deferred** via Ed-Fi `LearningStandardGrade` path. Saraswati's Grade 4-10 cohort runs the standard course-based gradebook in V1.

**Demo:** `GET /courses?schoolId=…&curriculumRef=CDC_NCF_2076&grade=8` returns Saraswati's Grade 8 CDC courses with concrete `academicSubject` + `stateSubjectCode` fields populated. Mark entry routes through existing `Grade.courseId` pattern (no API surface change).

#### Tickets

- **A.2.1** — Course entity field extension (Ed-Fi alignment).
  - Files: `microservices/academics/src/common/entities/course.entity.ts` extended (+3 fields: `academicSubject` enum, `stateSubjectCode?`, `curriculumRef` enum); `packages/shared-types/src/schemas/academics/course.schema.ts` schema updated; `packages/shared-types/src/descriptors/academic-subject.ts` (NEW descriptor enum source-of-truth: `mathematics | science | english | nepali | social_studies | environment_population_health | health_physical_creative_arts | local_subject | optional_mathematics | optional_computer_science | optional_economics | accounting | physics | chemistry | biology`); `gsi-inventory.md` (GSI on `curriculumRef`).
  - Validation: entity unit; contract test asserts new fields optional on read (back-compat) + required on new POST; `gsi-casing-contract.spec.ts` extended for new GSI.
  - AC: Factory + contract green; shared-types minor bump + npm publish + AdminWeb jsdom sim per CLAUDE.md; existing 133 academics tests stay green; route-drift lint clean (no new routes — extension is data-shape only).
  - Deps: 0.4.1.

- **A.2.2** — Course CREATE/PATCH validation update (no new endpoints).
  - Files: `microservices/academics/src/courses/courses.service.ts` `createCourse()` + `updateCourse()` validate new fields against `AcademicSubjectDescriptor` enum + `CurriculumType` enum; backward-compat: existing courses without new fields readable, but PATCH enforces them.
  - Validation: integration: POST new course with `academicSubject='mathematics'` + `curriculumRef='CDC_NCF_2076'` succeeds; POST with `academicSubject='biology'` + `curriculumRef='INVALID'` returns 400 `INVALID_CURRICULUM_REF`; PATCH adding new fields to a legacy course succeeds.
  - AC: Validation enforced on writes; reads unaffected for legacy rows; audit + event per write per existing pattern.
  - Deps: A.2.1 + 0.3.1.

- **A.2.3** — `subjectArea` denormalization keeper + dual-write.
  - Files: `courses.service.ts` `createCourse()` / `updateCourse()` extended: if `academicSubject` provided but `subjectArea` not, auto-derive `subjectArea` from descriptor mapping (e.g. `'mathematics'` → `'Math'`); existing courses with `subjectArea` but no `academicSubject` continue to work for reads but show a deprecation warning in audit log.
  - Validation: integration: legacy course (subjectArea='Math', no academicSubject) reads OK; PATCH on legacy course populates `academicSubject='mathematics'` derived from `subjectArea`; new course creation populates both fields.
  - AC: Dual-write maintained for V1; `subjectArea` enum schema MUST NOT be removed in V1 (post-V1.5 cleanup ticket noted in §17 §V1.5 backlog).
  - Deps: A.2.1.

- **A.2.4** — PABSON archetype Course catalog seed (CDC subject taxonomy).
  - Files: `packages/shared-types/src/archetype-defaults/pabson-courses.ts` (NEW); per CDC NCF 2076 grade-band table — Grades 1-3 (placeholders, NOT seeded in V1 per V1.5 deferral), Grades 4-5 (Compulsory English/Nepali/Math/Science/Social Studies/EPH), Grades 6-8 (above + optional Math/Computer Science), Grades 9-10 (SEE-prep core 6 + 2 optionals), Grades 11-12 (NEB core 3 + 3 electives per NCF 2076 reform); each row carries `code, name, gradeLevels[], academicSubject, stateSubjectCode?, curriculumRef='CDC_NCF_2076', isCore, isCompulsory`; tenant-seeder Lambda loads this on PABSON tenant provisioning.
  - Validation: jest seed-shape; tenant-seeder Lambda local-test loads catalog into a synthetic PABSON tenant; bs-2083 round-trip.
  - AC: PABSON tenant on provision has Course catalog seeded for Grades 4-10; CDC subject codes accurate (cross-checked against NCF 2076); pilot-fixture loader gets updated registry.
  - Deps: A.2.1 + 0.4.2.

- **A.2.5** — Saraswati Course extension backfill script.
  - Files: `scripts/backfill-saraswati-course-extension.ts` (NEW); reads each existing Course row for Saraswati; populates `academicSubject` (derived from `subjectArea`), `curriculumRef='CDC_NCF_2076'`, `stateSubjectCode` (from A.2.4 archetype seed lookup); `--dry-run` (default) prints diff; `--apply` writes via authenticated PATCH.
  - Validation: dry-run prints all course-row diffs; user approves; `--apply` writes; post-apply GET asserts populated fields.
  - AC: All existing Saraswati courses extended; PATCH log archived to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-backfill-saraswati-course-extension-<ts>-<sha>.log`; idempotent on re-run.
  - Deps: A.2.4.

### Sprint A.3 — Exam Subsystem Backend
**Source:** v2 plan D2. First-class `Exam` + `ExamSubject` + `ExamScore`.

**Demo:** Operator creates Term-1 exam on `dev-pabson-primary`, adds 5 subjects, enters scores for 10 enrollments (single + bulk), closes exam. Audit + events captured. Saraswati Term-1 follows when its exam window opens.

#### Tickets

- **A.3.1** — Curriculum / Course extension readiness audit (doc).
  - Files: `docs/pilot-greenlight/a3-curriculum-readiness-audit.md` (NEW).
  - Validation: confirms A.2 (Course extension) shipped + Saraswati courses backfilled with `academicSubject` + `curriculumRef` populated.
  - AC: Audit committed; readiness confirmed OR follow-up scoped.
  - Deps: A.2.1–A.2.5.

- **A.3.2** — `Exam` entity.
  - Files: `microservices/academics/src/common/entities/exam.entity.ts` (NEW). Fields: `examId`, `examName`, `termId`, `examType` (from ArchetypeDefaults.examPattern enum), `startDate`, `endDate`, `status` (draft/scheduled/in_progress/closed/published); GSIs by `termId`, by `status`; lowercase attribute names per S3.2.
  - Validation: entity unit + contract test; `gsi-casing-contract.spec.ts` extended.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: A.2.1 + 0.3.1 + 0.4.4.

- **A.3.3** — `ExamCourse` entity (renamed from `ExamSubject` per v3.4 A.2.0 decision; Course is the per-instance unit, no separate Subject entity).
  - Files: `exam-course.entity.ts` (NEW; filename renamed from earlier `exam-subject.entity.ts`). Fields: `examCourseId`, `examId`, `courseId` (FK to Course; replaces older `subjectId`), `maxMarks`, `passingMarks` (defaults from SchoolConfiguration), `creditHours`.
  - Validation: entity tests; FK validation on create (against Course `courseId` — the Course carries `academicSubject` descriptor for downstream aggregation).
  - AC: FK validation against `courseId`; module-wiring updated; entity-vs-schema contract test for `ExamCourse`.
  - Deps: A.2.1 + A.3.2.

- **A.3.4** — `ExamScore` entity (keyed by `enrollmentId` per invariant 3).
  - Files: `exam-score.entity.ts` (NEW). Fields: `examScoreId`, `examId`, `examCourseId` (refs `ExamCourse.examCourseId` per v3.4 rename), `enrollmentId`, `rawScore`, `status` (entered/locked), `enteredBy`, `enteredAt`.
  - Validation: entity tests + cross-AY query via GSI2.
  - AC: References `enrollmentId` not `(studentId, examId)`; references `examCourseId` (not legacy `examSubjectId`); cross-year aggregation works.
  - Deps: A.3.3.

- **A.3.5** — Exam CRUD endpoints.
  - Files: `exams.controller.ts` (NEW); POST/GET/LIST `/exams`; three-way handoff (new prefix `/exams` → new nginx block).
  - Validation: jest integration; live curl through API GW + nginx + Nest post-deploy.
  - AC: 2xx validated; audit + event emit; route registered all 3 places.
  - Deps: A.3.2.

- **A.3.6** — ExamCourse CRUD endpoints (renamed from `ExamSubject` per v3.4 A.2.0 decision).
  - Files: `exams.controller.ts` extended or `exam-courses.controller.ts`; POST/GET/LIST `/exams/:examId/courses`; course-add validates against existing Course rows for the school + grade.
  - Validation: integration; FK rejection negative test (invalid `courseId` returns 404).
  - AC: Validates against Course; 4xx on invalid `courseId`; downstream queries can aggregate by `Course.academicSubject` for the dashboard.
  - Deps: A.3.3 + A.3.5.

- **A.3.7** — ExamScore CRUD endpoints.
  - Files: `exam-scores.controller.ts` (NEW); POST `/exams/:examId/scores` (single); GET; LIST with filter.
  - Validation: integration.
  - AC: Validates `0 ≤ rawScore ≤ maxMarks`; 409 if `exam.status === 'closed'`; 404 on missing FKs.
  - Deps: A.3.4 + A.3.5.

- **A.3.8** — Exam state machine.
  - Files: `exams.controller.ts` (PATCH `/exams/:examId/status`); state-machine util.
  - Validation: integration: every valid transition + every invalid transition returns 409 `EXAM_STATE_INVALID_TRANSITION`.
  - AC: Transitions audited + events; idempotent re-call returns 200 not 409.
  - Deps: A.3.5.

- **A.3.9** — Bulk score entry chunked at 100.
  - Files: `exam-scores.service.ts` chunked TransactWriteItems; idempotency via correlation ID. POST `/exams/:examId/scores/bulk`.
  - Validation: integration with 250-score payload; retry idempotent.
  - AC: Atomic per chunk; failure rolls back chunk not whole bulk; ONE `exam.scores_recorded` event per chunk with `count` in payload.
  - Deps: A.3.7.

- **A.3.10** — Score validation Zod schema.
  - Files: `packages/shared-types/src/schemas/academics/exam-score.schema.ts` (NEW).
  - Validation: schema unit + integration negatives.
  - AC: 4xx errors structured per project errorCode schema.
  - Deps: A.3.4.

- **A.3.11** — Pilot exam smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-exam-flow.ts` (NEW); accepts `PILOT_ID`.
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Full exam lifecycle complete; audit + events at every step.
  - Deps: A.3.1–A.3.10.

### Sprint A.4 — Result Subsystem Backend
**Source:** v2 plan D3. After `exam.closed`, generate per-student per-term `ResultCard` rows.

**Demo:** Close Term-1 exam on `dev-pabson-primary`. 10 ResultCards generated by Lambda within 30s. Add conduct + remark on 5 cards. Publish all 10. `result.published` events appear on bus + event-log.

#### Tickets

- **A.4.1** — Term-aggregation rules engine (pure function, archetype-blind).
  - Files: `microservices/academics/src/results/term-aggregation.service.ts` (NEW); reads `gradingScale` from `SchoolConfiguration` (via `archetypeDefaults` lookup); per-term weighted GPA.
  - Validation: unit tests with PABSON 32-pass gradingScale + synthetic; property test (monotonic raw → monotonic GPA); **explicit archetype-grep assertion: `grep -rn 'archetype' microservices/academics/src/results/` returns zero hits**.
  - AC: Engine fully data-driven; zero `tenant.archetype` reads; archetype-grep CI check passes.
  - Deps: 0.4.4 + A.3.2.

- **A.4.2** — `ResultCard` entity.
  - Files: `result-card.entity.ts` (NEW). Fields: `cardId`, `enrollmentId`, `termId`, `examId`, `courseScores: [{courseId, academicSubject, score, grade, gpa}]` (per v3.4 A.2.0 rename — `subjectScores` → `courseScores`; embeds `academicSubject` descriptor for ReportCard render aggregation), `totalScore`, `termGpa`, `classRank`, `sectionRank`, `conduct`, `classTeacherRemark`, `publishedAt`, `publishedBy`, `status` (draft/published).
  - Validation: entity tests; keyed by `enrollmentId`; entity-vs-schema contract test.
  - AC: Factory + contract green; module-wiring updated; `courseScores[]` denormalizes `academicSubject` so renderer doesn't need extra Course lookups per row.
  - Deps: A.3.4.

- **A.4.3** — Batch result generation Lambda.
  - Files: `server/lib/result-generation/result-batch-lambda.ts` (NEW); CDK wiring in `tenant-template-stack-basic`; EventBridge rule on `exam.closed`.
  - Validation: Lambda unit + integration via EventBridge.
  - AC: 200 enrollments → 200 cards in <30s p50 / <90s p95; DLQ catches Lambda failures; CloudWatch alarm on DLQ depth ≥1; cold-start latency budgeted ≤45s.
  - Deps: A.4.1 + A.4.2.

- **A.4.4** — Conduct + class-teacher-remark endpoints.
  - Files: `conduct.controller.ts` (NEW); PATCH `/result-cards/:id/conduct`; three-way (new `/result-cards` prefix → new nginx block).
  - Validation: integration; audit per write.
  - AC: Field updates; audit + event per write.
  - Deps: A.4.2.

- **A.4.5** — Publication state machine.
  - Files: `result-cards.service.ts`; draft→published writes `publishedAt`, `publishedBy`; emits `result.published`.
  - Validation: integration + unit: cannot un-publish; cannot publish twice (409 `RESULT_ALREADY_PUBLISHED`).
  - AC: State transition audited + event.
  - Deps: A.4.2.

- **A.4.6** — Cross-year publication regression test (invariant 3 guard).
  - Files: integration spec.
  - Validation: scenario — prior-AY Term-1 result published after next-AY created. Assert card has `enrollmentId` referencing prior-AY enrollment; cross-year aggregation via GSI2 returns both.
  - AC: Cards stay coupled to correct AY; no enrollment-id mismatches.
  - Deps: A.4.2 + A.4.5.

- **A.4.7** — Pilot result smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-result-card-publish.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Full result lifecycle; events on bus.
  - Deps: A.4.1–A.4.6.

### Sprint A.5 — Period Attendance + Timetable (V1.5 candidate)
**Source:** v2 plan Phase J. Per-period attendance + Timetable + Substitute. Daily-use audit found this as #1 gap, but Saraswati's class-teacher daily-attendance model works for Term-1; defer to post-Greenlight.

**Demo:** Teacher marks per-period attendance for Grade 10 section A for a week including holiday-block + exam-day. Grid shows correct states. Rollup respects holidays. Substitute teacher day-assignment.

#### Tickets

- **A.5.1** — `Timetable` entity (identity service).
  - Files: `microservices/identity/src/common/entities/timetable.entity.ts` (NEW). Key shape `SCHOOL#schoolId#TIMETABLE#{ayId}#{termId}#{dayOfWeek}#{periodId}` → `{sectionId, primaryTeacherId, locationId}`.
  - Validation: entity unit; contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.3.1.

- **A.5.2** — Timetable CRUD endpoints.
  - Files: `timetable.controller.ts` (NEW); three-way handoff (new prefix `/schools/:id/timetable` → new nginx block).
  - Validation: integration.
  - AC: CRUD + audit + event.
  - Deps: A.5.1.

- **A.5.3** — Timetable UI grid (frontend).
  - Files: `edforge-saas-frontend/.../Timetable/Grid.tsx` (NEW). Weekly grid drag-section into period×day.
  - Validation: Playwright e2e on `dev-pabson-primary`.
  - AC: Grid functional; "my day" teacher view derives from grid.
  - Deps: A.5.2.

- **A.5.4** — Period-attendance validation: in-bell-schedule + academic-scope.
  - Files: `attendance.service.ts` `recordPeriodAttendance` validates `classPeriodId` exists in active bell schedule + parent shift has `scope === 'academic'`.
  - Validation: 3 integration negatives — invalid period (400 `PERIOD_NOT_IN_BELL_SCHEDULE`); non-academic shift period (400 `PERIOD_NOT_ACADEMIC`); exam-day variant resolution.
  - AC: Both errorCodes distinct; exam-day variant correct.
  - Deps: A.5.1.

- **A.5.5** — Day-rollup engine (pure function).
  - Files: `attendance-rollup.service.ts` (NEW); unit tests.
  - Validation: table-driven jest; ≥90% line coverage.
  - AC: Deterministic; pure; no DDB reads in rollup fn.
  - Deps: A.5.4.

- **A.5.6** — Holiday-aware day-rollup.
  - Files: `attendance-rollup.service.ts` extended; reads CalendarDate by date.
  - Validation: integration with each of Saraswati's 6 multi-day blocks + weekends + 13 holidays + 9 programs.
  - AC: Rollup correct for all calendar event types.
  - Deps: A.5.5.

- **A.5.7** — Per-period grid UI.
  - Files: `edforge-saas-frontend/apps/academics/src/Attendance/PerPeriodGrid.tsx` (NEW); `e2e/per-period-attendance.spec.ts`.
  - Validation: Playwright e2e + manual smoke when in-person classes start.
  - AC: Per-period state via UI; rollup updates live; handles 8 PABSON Shift-2 periods + exam-day 4-block; Shift-1 non-academic hidden; mobile-responsive.
  - Deps: A.5.4–A.5.6.

- **A.5.8** — Per-period analytics aggregation.
  - Files: `microservices/academics/src/dashboard/per-period-analytics.service.ts` (NEW); `GET /analytics/per-period?schoolId=&termId=`; three-way.
  - Validation: integration with seeded period-attendance.
  - AC: 5-min cache per CLAUDE.md analytics convention; p95 <500ms.
  - Deps: A.5.4.

- **A.5.9** — Substitute-teacher day assignment.
  - Files: `microservices/identity/src/schools/substitute-assignment.controller.ts` (NEW); POST `/schools/:id/timetable/substitutes`; resolver prefers sub over base timetable for the day; three-way.
  - Validation: integration: assign sub → attendance on that period attributed to sub.
  - AC: Sub assignment audited + event.
  - Deps: A.5.1.

- **A.5.10** — Pilot real-data attendance smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-attendance-week.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; both exit 0.
  - AC: Per-period writes correct; rollups correct; p95 <500ms; audit clean.
  - Deps: A.5.4–A.5.9.

---

## 4. EPIC-B — Communicate — **DEFERRED to V1.5 / post-Greenlight per CEO 2026-05-22**

> **Decision rationale:** Parents + students already log in to dedicated portals (5-page parent portal + 4-page student portal live on Vercel since Phase A/B/C). Saraswati's existing parent communication runs on WhatsApp + diary + phone — channels the school already trusts. Building a full messaging microservice + EventBridge fanout + SES adapter + notice subsystem before the adoption arc demands it is **premature optimization at the expense of greenlight-critical work** (exam pipeline, PDF rendering, external-exam workflows, compliance).
>
> **Foundation in place** (relevant when EPIC-B unfreezes): EventBridge bus + DLQ stack + 25 Zod event schemas live since C0.c. Messages MFE (Inbox / Announcements / Meetings UI) exists in frontend with mock data. Parent + Student Cognito roles + portal MFEs shipped. `User.notificationPreferences` schema field exists in identity (`user.entity.ts:68-102`).
>
> **When to unfreeze EPIC-B:**
> 1. Saraswati operator stamp (H.2.2) signals "we now want push to parents"
> 2. Pilot 2 (F.3) onboards with explicit messaging demand
> 3. Or the V1 → V1.5 transition (post-30-day-hypercare retro decides)
>
> **All EPIC-B sprints + tickets remain documented below for V1.5 readiness, but DO NOT execute as part of V1 GA.** Ticket-count summary (§15) reflects V1.5 deferral.

**Goal (when unfrozen):** Saraswati's parents and students receive in-app notifications + optional email for: child absent, invoice due, result published, school notice. SMS deferred to V2.

### Sprint B.1 — Messaging Microservice Foundation
**Demo:** New `messaging` microservice deployed; entity tests pass; `GET /messaging/health` returns 200; module-wiring spec green; placeholder routes registered three-way.

#### Tickets

- **B.1.1** — New `messaging` microservice scaffold.
  - Files: `server/application/microservices/messaging/` (NEW directory); `Dockerfile.messaging`; `messaging.module.ts`; `messaging.controller.ts` (placeholder `@Get('health')`); `tenant-template-stack-basic` adds messaging ECS service; nginx new prefix `/messaging`.
  - Validation: `nest build messaging` green; health endpoint live post-deploy.
  - AC: Service scaffolded; deployed to dev tenant; module-wiring spec exists from day-1 (`microservices/messaging/src/__tests__/module-wiring.spec.ts`).
  - Deps: 0.3.2 (academics pattern for module-wiring).

- **B.1.2** — `Message` entity (inbox).
  - Files: `messaging/src/common/entities/message.entity.ts` (NEW). Fields: `messageId`, `recipientUserId`, `senderUserId?`, `tenantId`, `schoolId?`, `category` (announcement/attendance/grades/messages/billing/security per `user.entity.ts:68-102` taxonomy), `subject`, `body`, `payloadJson?`, `status` (queued/delivered/read), `deliveredAt?`, `readAt?`, `createdAt`. GSI1 by recipient (`USER#userId / MESSAGE#status#createdAt`).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green.
  - Deps: B.1.1.

- **B.1.3** — `Conversation` entity (thread, V1 minimal).
  - Files: `conversation.entity.ts` (NEW). Fields: `conversationId`, `tenantId`, `participantUserIds[]`, `category`, `lastMessageAt`, `lastMessageId`. V1 supports 1:1 only; group threads V2.
  - Validation: entity unit.
  - AC: Factory; messages reference `conversationId`.
  - Deps: B.1.2.

- **B.1.4** — Read receipts.
  - Files: `messages.service.ts` `markAsRead(messageId, userId)`; updates `readAt`; emits `message.read`.
  - Validation: integration: mark read → readAt set + event emitted.
  - AC: Idempotent re-mark returns 200.
  - Deps: B.1.2.

- **B.1.5** — Messaging audit infrastructure.
  - Files: `messaging/src/common/services/audited-write.service.ts` (mirrors academics A.3.1).
  - Validation: integration: write message → audit row.
  - AC: All Message writes audited.
  - Deps: B.1.2 + 0.3.1 (pattern reference).

### Sprint B.2 — Notification Event Taxonomy Extension
**Demo:** Six new event schemas in registry; `EventServiceBase` validates them; lint catches unregistered emission.

#### Tickets

- **B.2.1** — Notification event schemas.
  - Files: `packages/shared-types/src/events/notification/notification.ts` (NEW; 6 schemas: `notification.queued`, `notification.delivered`, `notification.failed`, `message.created`, `message.read`, `notice.published`).
  - Validation: jest schema unit.
  - AC: Schemas added to taxonomy registry; `EVENT_REGISTRY` size grows from 25 → 31.
  - Deps: B.1.1.

- **B.2.2** — Academics PascalCase → snake-dotted migration (deferred from C0.c).
  - Files: `microservices/academics/src/common/services/academics-events.service.ts` — switch `AttendanceRecorded` etc to `attendance.recorded`. Backward-compat alias retained 1 sprint then removed in B.2.3.
  - Validation: integration: event-log sees `attendance.recorded` shape; legacy `AttendanceRecorded` no longer emitted by new code.
  - AC: All ~30 academics emit-sites migrated.
  - Deps: B.2.1.

- **B.2.3** — Delete backward-compat aliases.
  - Files: `academics-events.service.ts` cleanup.
  - Validation: CI scan: zero `AttendanceRecorded` / `GradeRecorded` etc. in emit-call sites.
  - AC: Aliases removed; legacy event names deprecated.
  - Deps: B.2.2 (one sprint later).

### Sprint B.3 — EventBridge Rules + Notification Fan-out
**Demo:** Domain event `attendance.recorded(absent)` fires → EventBridge rule routes to `messaging-fanout` Lambda → Lambda creates Message in inbox + emits `notification.queued`.

#### Tickets

- **B.3.1** — `messaging-fanout` Lambda.
  - Files: `server/lib/messaging-fanout/fanout-lambda.ts` (NEW); CDK wiring; subscribes to `attendance.recorded`, `invoice.issued`, `invoice.due_date_approaching`, `result.published`, `notice.published`.
  - Validation: integration: emit domain event → Lambda triggers → Message row written.
  - AC: Lambda processes within 5s of event; idempotent on retry; DLQ on failure.
  - Deps: B.1.2 + B.2.1.

- **B.3.2** — EventBridge rule: absence → message.
  - Files: rule defined in `tenant-template-stack-basic`; rule pattern matches `attendance.recorded` where `status=absent`.
  - Validation: integration: write absent attendance → Lambda invoked.
  - AC: Rule active in dev tenant; SNS DLQ catches retry failures.
  - Deps: B.3.1.

- **B.3.3** — EventBridge rule: invoice.issued → message.
  - Files: rule definition.
  - Validation: integration.
  - AC: Rule active.
  - Deps: B.3.1.

- **B.3.4** — EventBridge rule: invoice.due_date_approaching → reminder.
  - Files: scheduled rule (EventBridge cron) checks invoices; emits `invoice.due_date_approaching` per matching invoice; B.3.1 Lambda consumes.
  - Validation: integration: invoice T-7 → reminder fires; T-3 → second reminder; T-0 → third; T+3 → escalation.
  - AC: Dunning cadence configurable per archetypeDefaults.
  - Deps: B.3.1 + 0.4.4.

- **B.3.5** — EventBridge rule: result.published → message.
  - Files: rule.
  - Validation: integration.
  - AC: Rule active.
  - Deps: B.3.1.

- **B.3.6** — EventBridge rule: notice.published → fan-out to audience.
  - Files: rule; Lambda resolves audience (school-wide / per-grade / per-section / per-student).
  - Validation: integration: notice published with `audienceScope=school-wide` → all parents + students receive message.
  - AC: Audience resolution correct; bulk-chunked at 100 per TransactWriteItems.
  - Deps: B.3.1.

### Sprint B.4 — In-App Inbox UI (replace mock data)
**Demo:** Parent + student log into respective portals → see real inbox with category filters → mark messages read → backend reflects.

#### Tickets

- **B.4.1** — Inbox API endpoints.
  - Files: `messaging.controller.ts` extends: `GET /messaging/inbox?cursor=&category=`; `GET /messaging/messages/:id`; `PATCH /messaging/messages/:id/read`; three-way handoff.
  - Validation: integration; route-drift lint.
  - AC: Endpoints work; pagination cursor-based; ABAC: user can only see own messages.
  - Deps: B.1.2 + B.1.4.

- **B.4.2** — Replace mock data in Messages MFE.
  - Files: `edforge-saas-frontend/apps/messages/src/InboxPage.tsx` etc — replace `MOCK_CONVERSATIONS` with API calls.
  - Validation: Playwright e2e: send a message via backend test endpoint → appears in inbox UI.
  - AC: All 4 Messages pages (Inbox, Announcements, Meetings, stub for Notifications) consume real API.
  - Deps: B.4.1.

- **B.4.3** — Parent/student portal inbox surface.
  - Files: `edforge-saas-frontend/apps/shell/src/pages/parent-portal/InboxBadge.tsx` + `student-portal/InboxBadge.tsx`; surfaces unread count in nav.
  - Validation: Playwright e2e: new message → badge increments.
  - AC: Badge visible on parent + student portal home.
  - Deps: B.4.1.

- **B.4.4** — Notification preferences (consume schema-only fields).
  - Files: `microservices/identity/src/users/users.controller.ts` `GET/PATCH /me/notification-preferences`; messaging-fanout Lambda respects preferences.
  - Validation: integration: set parent prefs `attendance=off` → no absence msg created.
  - AC: Per-category opt-out works; defaults to all-on for parents.
  - Deps: B.3.1.

### Sprint B.5 — SES Email Adapter
**Demo:** Parent without portal login receives email via SES on absence event; email contains link to invoice PDF (signed S3 URL).

#### Tickets

- **B.5.1** — SES integration in `tenant-template-stack-basic`.
  - Files: CDK; verified sender domain; SES rate limits documented.
  - Validation: test send via SES sandbox.
  - AC: SES enabled; sender domain verified; CloudWatch metrics emit.
  - Deps: none.

- **B.5.2** — `EmailAdapter` service in messaging.
  - Files: `messaging/src/adapters/email-adapter.service.ts` (NEW); `sendEmail(recipient, subject, body, attachments?)`.
  - Validation: unit test mocks SES; integration sends to verified test address.
  - AC: Provider abstraction: `EmailAdapter` interface + SES impl; SMS adapter interface stubbed (`SmsAdapter` returns NotImplementedException — V2 will swap).
  - Deps: B.5.1 + B.1.1.

- **B.5.3** — Messaging fanout uses email adapter as fallback.
  - Files: `fanout-lambda.ts` extended: if recipient `notificationPreferences.email=true`, also call EmailAdapter.
  - Validation: integration: parent with email-on receives both in-app + email; with email-off receives only in-app.
  - AC: Dual-channel works; email failures logged but don't block in-app.
  - Deps: B.3.1 + B.5.2.

- **B.5.4** — Bounce/complaint handling.
  - Files: SES bounce SNS → bounce-handler Lambda updates `User.notificationPreferences.email=false` on hard bounce.
  - Validation: integration: synthetic bounce → user prefs updated.
  - AC: No email retry on hard-bounced address.
  - Deps: B.5.1.

### Sprint B.6 — Notice / Announcement Subsystem
**Demo:** Principal publishes school-wide notice → all parents + students receive (in-app + email fallback) → operator sees delivery stats.

#### Tickets

- **B.6.1** — `Notice` entity.
  - Files: `messaging/src/common/entities/notice.entity.ts` (NEW). Fields: `noticeId`, `schoolId`, `tenantId`, `authorUserId`, `title`, `body`, `audienceScope` (school-wide/per-grade/per-section/per-student), `audienceFilter` (gradeId/sectionId/studentIds[]), `publishedAt`, `status` (draft/published/archived).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green.
  - Deps: B.1.1.

- **B.6.2** — Notice CRUD + publish endpoints.
  - Files: `notices.controller.ts` (NEW); POST/GET/LIST/PATCH/DELETE; POST `/notices/:id/publish` emits `notice.published`; three-way handoff (`/notices` new prefix).
  - Validation: integration; route-drift lint.
  - AC: CRUD + publish works; audit + event per write.
  - Deps: B.6.1.

- **B.6.3** — Notice publication UI (principal-facing).
  - Files: `edforge-saas-frontend/apps/shell/src/pages/notices/NoticeComposer.tsx` (NEW); audience selector.
  - Validation: Playwright e2e: create + publish notice → recipients receive.
  - AC: UI usable on phone + laptop.
  - Deps: B.6.2.

- **B.6.4** — Notice delivery stats endpoint.
  - Files: `GET /notices/:id/stats` returns delivered/read counts.
  - Validation: integration after fan-out.
  - AC: Stats accurate; cached 1min.
  - Deps: B.6.1 + B.3.6.

---

## 5. EPIC-C — Distribute (PDF Generation Service + School Branding + Templates)

> **Status snapshot 2026-05-27 PM (EPIC-C closed for V1 pilot):** C.0 + C.0-followup + C.0-followup-2 + C.1.1–C.1.6 backend + C.1.7 frontend M2/M3 + housekeeping FU.7.2-.7.5 + C.1.8 + C.1.9 + **C.1.10 Path E revert** all 🟢 shipped to prod. The custom letterhead upload (C.1.8/C.1.9) is intentionally V1.5-deferred per C.1.10 after operator-content design constraints proved unworkable without a preview-before-save UX. **V1 PDF rendering baseline:** `<BrandedHeader>` + `<BrandedFooter>` driven by 6 operator knobs (logo, signature, primary+accent colors, formalName, tagline, addressLines/phone/email/PAN/VAT). **Two open EPIC-C work items remain — both V1.5 priority, neither pilot-blocking:** (a) **C.2 backend** Template Editor write endpoints + Sprint M5 frontend UI; (b) **C.3 backend** ReportCard render endpoint + Sprint M7 frontend download buttons. C.4 (Batch Lambda) + C.5 (AdmitCard) are V1.5 with their own dependency gates (C.5 gated on D.4 + D.5). **Frontend Sprints M5/M7/M8/M9/M10 fully scoped + ready** in [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md), each gated on its backend prereq. **Natural next critical-path move per §0.4: D.4 BLE Workflow** (research-resolved, no PDF dependency).

> **Plan revised 2026-05-24.** This section replaces the v3.4 EPIC-C draft. Full design rationale + sign-off context in [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md). Key decisions:
>
> 1. **Platform-capability framing.** PDF generation serves ALL future doc types (invoice, receipt, report card, transcript, admit card, ID card, certificates) — not a finance-specific bolt-on. Templates live in identity DDB (platform metadata, alongside WorkspaceSettings). Each domain (finance/academics/identity) owns its render endpoints; ALL share `@aibrains/pdf-renderer`.
> 2. **Renderer library:** `@react-pdf/renderer` (NOT Puppeteer+Handlebars). No Chromium layer. Sync endpoints render in-container (NestJS); batch endpoint renders in a Lambda. Same JSX, same renderer, two execution paths. **Risk R23 (Lambda cold-start) closed by this choice.**
> 3. **Lazy-seed pattern.** No backfill. Template defaults are pure functions of `(archetype, locale)` baked into descriptors in `@aibrains/pdf-renderer`. DDB row only materializes when admin customizes + saves. Same pattern as D.1.3 lazy-seed of GradingPolicy.
> 4. **Editor location:** tenant-facing **Shell** (`/settings/pdf-templates`), NOT AdminWeb. TenantAdmin (system-admin equivalent at the tenant level) manages every doc type's template from one settings page.
> 5. **Per-school template storage with future tenant-level inheritance.** DDB key `SCHOOL#{schoolId}#PDF_TEMPLATE#{docType}#CURRENT`. Adding tenant-level inheritance later = additive change, no migration.
> 6. **Document immutability** via frozen `pdfTemplateRef: {docType, templateId, version}` on issued documents (invoice, receipt, report card). Reprinting an old document uses the frozen version even after the template is edited.
> 7. **Localization:** EN + NE (Nepali) labels per template, single-or-dual mode; Devanagari font (`Noto Sans Devanagari`) bundled in `@aibrains/pdf-renderer` and registered at boot.
> 8. **Concurrency:** Mumbai prod = 1000 unreserved Lambda concurrency (verified per CEO 2026-05-24 AWS console reading). Reserve 50 for `edforge-pdf-batch` Lambda; ample headroom for everything else.

**Goal:** Every printable artifact Saraswati and future PABSON pilots need (Invoice, Receipt, Report Card V1; Admit Card V1 via D.4/D.5 integration; Transcript / Student ID Card / Certificates V1.5+) is rendered via ONE shared library, branded per school, with a single tenant-facing template editor — all without Chromium.

### Sprint C.0 — `@aibrains/pdf-renderer` Foundation + `SchoolBranding` Entity
**Status:** 🟢 **shipped 2026-05-25 — C.0 closed end-to-end including the audit-driven C.0-followup**. All 7 C.0 tickets + 3 C.0-followup tickets live; foundation library + branding read/write path proven end-to-end via 5/5 prod smoke on dev-pabson-primary (with explicit C.0-fu.2 signed-URL assertion in step 5). **The `<InvoicePdf>` component named in the original "Demo (library)" line ships in C.1.1** (also live as of 2026-05-25 PM — `@aibrains/pdf-renderer@0.5.0` on npm).
**Actual shipped (library):** `npm view @aibrains/pdf-renderer version` returns 0.4.0. Library exposes core utilities (theme/i18n/format), primitives (Document/Page/BrandedHeader/Footer/Watermark), components (KeyValueTable/LineItemTable/TotalsBlock/SignatureLine), descriptor registry framework (`TemplateDescriptor<T>`, `registerDescriptor`, `getDescriptor`). 72 specs green including R45 Devanagari canary. **No document components or descriptors registered yet** — first one is `<InvoicePdf>` in C.1.1.
**Actual shipped (branding):** `GET /schools/:id/branding` returns the persisted `SchoolBrandingDto` (raw S3 keys, NOT signed URLs — see C.0-followup gap). `POST /schools/:id/branding/assets/upload-url` mints presigned PUT URL with 300s TTL, IAM-scoped to `tenants/${aws:PrincipalTag/tenant}/*`. `PATCH /schools/:id/branding` upserts the branding sub-document with server-managed `brandingVersionId`. Live smoke 5/5 green: GET→null → POST upload-url → PUT to S3 → PATCH with logoS3Key+formalName+colorPalette → follow-up GET reflects all fields.

#### Tickets

- **C.0.1** — Workspace package `@aibrains/pdf-renderer` skeleton + first publish.
  - Files: `packages/pdf-renderer/package.json` (NEW); `packages/pdf-renderer/tsconfig.json` (NEW); `packages/pdf-renderer/src/index.ts` (NEW); `pnpm-workspace.yaml` (add the package).
  - Validation: `pnpm install` from root; `pnpm --filter @aibrains/pdf-renderer build` produces `dist/index.js`; `npm publish` to npm registry; `npm view @aibrains/pdf-renderer version` returns 0.1.0.
  - AC: Package builds; published; AdminWeb jsdom bundle sim per CLAUDE.md "Per-sprint shared-types publish checklist" green.
  - Deps: none.
  - **🟢 As-shipped (2026-05-24, PR [#182](https://github.com/shoaibrain/edforge/pull/182)):** Skeleton merged. Repo uses **npm workspaces**, NOT pnpm — the ticket text's `pnpm-workspace.yaml` reference was incorrect at write-time. 0.1.0 was reserved on npm but content shipped in C.0.2 (absorbed publish).

- **C.0.2** — Renderer core (fonts + theme + i18n + format helpers).
  - Files: `packages/pdf-renderer/src/core/fonts.ts` (NEW; registers `Noto Sans` + `Noto Sans Devanagari` from bundled `.ttf` files); `core/theme.ts` (NEW; color/spacing tokens); `core/i18n.ts` (NEW; `t(key, ns, lang)` reads bundled JSON); `core/format.ts` (NEW; `formatDate(dateISO, format, locale)` with `gregorian|bikram_sambat|dual` modes wrapping existing `@aibrains/shared-types/utils/bikram-sambat`); `i18n/en/common.json` + `i18n/ne/common.json` (NEW; ~30 keys each).
  - Validation: unit specs covering gregorian / BS / dual; missing-key i18n fallback to EN; Devanagari snapshot test of common Nepali phrases ("बिल", "रसिद", "उप-योग", "जम्मा रकम") renders byte-identically.
  - AC: Fonts loadable in both Node and browser builds; `formatDate('2026-04-28T...', 'dual', 'ne-NP')` returns `"B.S. 2083-01-15 (2026-04-28)"`; Devanagari snapshot stable.
  - Deps: C.0.1.
  - Risk flag: R-PDF-NEW-1 (Devanagari font shaping) — the snapshot suite IS the canary.
  - **🟢 As-shipped (2026-05-24, PR [#183](https://github.com/shoaibrain/edforge/pull/183)):** `@aibrains/pdf-renderer@0.2.0` live on npm. Fonts shipped as `.woff` (not `.ttf` as ticket says) per @fontsource package format. `gregorianToBs` behavior nuance discovered: date-only ISO and `T00:00:00Z` ISO produce off-by-one BS results due to noon-anchored conversion — `normalizeToDateOnly` slices to YYYY-MM-DD before BS conversion to normalize. **Browser-side `registerFonts()` is currently Node-only** (uses `path.join(__dirname, '../../fonts')`) — needs refactor to `registerFonts(baseUrl?)` for the C.2 editor's `<PDFViewer>` (filed as prerequisite of C.2 in design doc).

- **C.0.3** — Layout primitives + reusable components.
  - Files: `packages/pdf-renderer/src/primitives/` (NEW directory): `Document.tsx` (font + i18n context provider), `Page.tsx`, `BrandedHeader.tsx` (logo + school name + address, driven by branding), `BrandedFooter.tsx`, `Watermark.tsx`. `packages/pdf-renderer/src/components/` (NEW directory): `KeyValueTable.tsx`, `LineItemTable.tsx` (configurable columns: description/quantity/amount/discount/taxRate/taxAmount/total — toggleable), `TotalsBlock.tsx`, `SignatureLine.tsx`.
  - Validation: jest snapshot tests with synthetic data; each component renders to PDF when wrapped in `<Document><Page>...`.
  - AC: Bundle size `<1MB` browser, `<8MB` Node; snapshot stability across two runs.
  - Deps: C.0.2.
  - **🟢 As-shipped (2026-05-24, PR [#184](https://github.com/shoaibrain/edforge/pull/184)):** `@aibrains/pdf-renderer@0.3.0` live on npm. 58 specs final after 5 `@react-pdf/renderer` integration surprises (v4 ESM-only → downgraded to v3.4.5; yoga-layout raw TS source → custom Jest `transformIgnorePatterns`; CSS font-fallback chains not supported → `pickFontFamily(text)` helper + per-Text fontFamily; string fontWeight `'normal'`/`'bold'` → numeric `400`/`700`; `fontStyle: 'italic'` crashes → removed from tagline) + 6 CodeRabbit catches (LineItemTable column ordering, ImageSource type widening, "first-script-wins" → "any-Devanagari-wins" semantics, Watermark fontFamily, labelLanguages non-empty tuple). R45 Devanagari canary green end-to-end.

- **C.0.4** — `TemplateDescriptor<TData, TConfig>` type + registry.
  - Files: `packages/pdf-renderer/src/descriptors/types.ts` (NEW; generic type); `descriptors/registry.ts` (NEW; `Map<DocType, TemplateDescriptor>` + `registerDescriptor` + `getDescriptor`); `descriptors/index.ts` (re-exports).
  - Validation: jest unit; registry rejects duplicate `docType` registrations; `getDescriptor('UNKNOWN')` throws.
  - AC: Type is generic; registry is module-singleton; export surface stable.
  - Deps: C.0.3.
  - **🟢 As-shipped (2026-05-24, PR [#185](https://github.com/shoaibrain/edforge/pull/185)):** `@aibrains/pdf-renderer@0.4.0` live on npm. 72 specs total. Registry's module-level `Map` makes the package a **singleton candidate for MF2** — Q3 of the C.2 UI research surfaced that without `singleton: true` in `mf-shared.ts`, each MFE would bundle its own descriptor registry and cross-MFE state would never sync (same trap as `feedback_module_wiring_invariant` at A.12). `labelLanguages` typed as non-empty tuple `readonly [Lang, ...Lang[]]` per CodeRabbit catch.

- **C.0.5** — `SchoolBranding` schema + School entity extension.
  - Files: `packages/shared-types/src/schemas/identity/school-branding.schema.ts` (NEW); `microservices/identity/src/common/entities/school.entity.ts` (extend with `branding?: SchoolBrandingDto` field; entity factory unchanged); `packages/shared-types/package.json` (bump to 0.59.0 next minor); consumer pin bumps in `server/application/package.json` + `server/package.json` per [[edforge-shared-types-caret-pin]].
  - Validation: schema unit; entity-vs-schema contract test; jsdom bundle sim per publish-gate; live `nest build identity` green.
  - AC: Field present, nullable (existing schools backward-compat); schema covers `formalName, addressLines[], phone, email, logoS3Key, principalSignatureS3Key, letterheadBackgroundS3Key, colorPalette: {primary, accent}, panNumber, vatNumber, brandingVersionId`.
  - Deps: none (parallel with C.0.1-C.0.4).
  - **Rolls former C.1.1 + C.1.2 into a single atomic ticket — schema + entity field together is one mergeable unit.**
  - **🟢 As-shipped (2026-05-24, PR [#187](https://github.com/shoaibrain/edforge/pull/187)):** `@aibrains/shared-types@0.61.0` live on npm (jumped past 0.59.0 because intervening sprints had bumps). All AC fields verified present in `school-branding.schema.ts`. Schema also includes hex-color regex enforcement (`^#[0-9A-Fa-f]{6}$`), per-field length caps (formalName ≤200, addressLines ≤120 each + ≤4 lines, panNumber/vatNumber ≤32), and a dedicated `s3KeySchema` (≤500 chars) as the type for the 3 S3-key fields. `School` entity at [school.entity.ts:83](server/application/microservices/identity/src/common/entities/school.entity.ts#L83).

- **C.0.6** — Tenant PDF buckets via CDK.
  - Files: `server/lib/analytics/analytics-stack.ts` — append `edforge-pdfs-<account>-<region>` (BlockPublicAccess.BLOCK_ALL, S3_MANAGED, enforceSSL, RemovalPolicy.RETAIN, lifecycle: `pdf-jobs/*` expire 7d) and `edforge-pdf-assets-<account>-<region>` (same settings + versioned, no lifecycle). Both alongside `ExportBucket` (line ~617).
  - Validation: `cdk synth` clean; `cdk deploy analytics-stack` via `scripts/deploy.sh analytics-stack prod`; deploy log committed.
  - AC: Both buckets live in prod; SSL-only policy active; **no CFN exports for bucket names** (consumer Lambdas read via env var per CLAUDE.md cross-stack export pre-flight rule R-PDF-NEW-2 mitigation).
  - Deps: none.
  - **🟢 As-shipped (2026-05-24, PR [#188](https://github.com/shoaibrain/edforge/pull/188)):** Both buckets live in prod ap-south-1. **Lifecycle change vs ticket text:** CodeRabbit caught that `prefix: 'pdf-jobs/'` would never match real keys (which live at `tenants/{tid}/schools/{sid}/pdf-jobs/...`) — S3 prefix-based lifecycle only matches from start-of-key. Switched to **tag-based filter** (`tagFilters: {lifecycle: 'pdf-jobs'}`); contract: every C.4.1 Lambda + sync render endpoint MUST tag PutObject calls with `Tagging=lifecycle=pdf-jobs` for the 7d expiry to apply. Documented in code comment + design doc §4.5. R46 mitigation verified: all 13 analytics-stack exports have zero importers; bucket name discovery via deterministic env-var convention.

- **C.0.7** — Branding presigned-upload + GET endpoints.
  - Files: `microservices/identity/src/schools/branding.controller.ts` (NEW; `POST /schools/:schoolId/branding/assets/upload-url` returns 5-min presigned PUT URL to `edforge-pdf-assets-*/tenants/{tid}/schools/{sid}/branding/{type}/{uuid}.{ext}`; `GET /schools/:schoolId/branding` returns the persisted branding object with signed GET URLs for assets); `branding.service.ts` (NEW); `branding.module.ts` (NEW); `microservices/identity/src/__tests__/module-wiring.spec.ts` extend with `BrandingModule` (+ its `PermissionGuard` dep); 2 routes in `tenant-api-prod.json`; shared-infra-stack redeploy per R40.
  - Validation: integration; live curl on dev-pabson-primary: PUT logo via signed URL → S3 object exists → GET branding returns the URL.
  - AC: Permission key `branding:configure` (TenantAdmin + Principal school-scoped); upload-url has 5-min TTL; server-side validates the S3 key prefix matches the tenant on PATCH; route-drift lint green.
  - Deps: C.0.5 + C.0.6.
  - **Rolls former C.1.4 + C.1.5 + C.1.6 into one atomic ticket — versioning is a UUID-per-PATCH, half-LOC.**
  - **🟡 As-shipped status (2026-05-25):** PRs [#189](https://github.com/shoaibrain/edforge/pull/189) + hotfixes [#190](https://github.com/shoaibrain/edforge/pull/190) (JwtAuthGuard) + [#191](https://github.com/shoaibrain/edforge/pull/191) (TVM cred case). 3 routes shipped (GET + PATCH + POST upload-url — not 2 as text above says). **2 HIGH gaps caught in 2026-05-25 audit, addressed in C.0-followup below:** (a) `@RequireGlobalRole('TenantAdmin')` shipped instead of spec'd `branding:configure` permission with Principal — Principal users blocked from configuring branding; (b) `GET /branding` returns raw S3 keys instead of spec'd signed GET URLs — frontend must presign per-asset. **1 MEDIUM gap:** BrandingService has no unit specs (smoke-tested only — see retros in memory `project_sprint_c0_7_shipped_prod`).

### Sprint C.0-followup — close 2 HIGH gaps + add unit specs (audit-driven 2026-05-25)
**Status:** 🟢 **shipped 2026-05-25 PM** ([PR #195](https://github.com/shoaibrain/edforge/pull/195) + CodeRabbit fix `4c9439a`). All 3 followup tickets closed + live in prod. Identity image `sha256:f4f4b447…` (commit `f518351`) running on prod-basic/identitybasic; 106/106 jest tests pass (was 82 pre-followup, +24 new specs); 5/5 live smoke green on dev-pabson-primary with explicit C.0-fu.2 `urls.logo` assertion. Deploy logs `prod-build-application-identity-…-f518351` + `prod-ecs-roll-identitybasic-…-f518351` + `prod-smoke-c-0-followup-20260525-102741-f518351`.

#### Tickets

- **C.0-fu.1** — Permission model fix on `BrandingController`.
  - Files: `microservices/identity/src/branding/branding.controller.ts` — replace class/method-level `@RequireGlobalRole('TenantAdmin')` with `@RequirePermission({resource: 'branding', action: 'configure', schoolIdParam: 'schoolId'})` (or equivalent composite `@RequireGlobalRole('TenantAdmin') OR @RequireSchoolRole('Principal')`); `microservices/identity/src/common/services/permission-resolver.service.ts` — confirm `branding:configure` permission key is mapped to {TenantAdmin (global), Principal (school-scoped)}; extend `__tests__/module-wiring.spec.ts` if a new guard is introduced.
  - Validation: extend smoke harness to call PATCH /branding as both a TenantAdmin user AND a Principal school-scoped user — both succeed; call as a StandardUser → 403.
  - AC: Per master plan C.0.7 spec; Principal can configure their own school's branding; TenantAdmin can configure any school; no other role can.
  - Deps: none.
  - **🟢 As-shipped (2026-05-25 PM, [PR #195](https://github.com/shoaibrain/edforge/pull/195)):** Added `branding` resource to `permission-registry.ts` with `view` + `configure` actions; granted `branding:configure` + `branding:view` to Principal in `DEFAULT_ROLE_PERMISSIONS` (role-assignment.entity.ts). BrandingController switched to `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission({resource: 'branding', action: 'configure', schoolIdParam: 'schoolId'})`. **No composite decorator needed** — PermissionGuard at line 50 auto-bypasses TenantAdmin, then delegates school-scoped check to RolesService. BrandingModule extended with PermissionGuard + RolesService + IdentityEventsService providers per `feedback_module_wiring_invariant`; wiring spec +1 assertion (now 83 → 106 total identity tests). **Smoke caveat:** the live 5/5 smoke ran with a TenantAdmin JWT (the existing PermissionGuard auto-bypass path). The Principal school-scoped path is fully wired in code + statically asserted in module-wiring spec; a follow-up smoke step with a Principal JWT for dev-pabson-primary would close the validation loop end-to-end. Not blocking C.1.
- **C.0-fu.2** — `GET /branding` returns signed GET URLs alongside raw keys.
  - Files: `microservices/identity/src/branding/branding.service.ts` — extend `getBranding()` to call `S3PresignerService.presignGet(jwt, key, ttl=600s)` for each of `logoS3Key`, `principalSignatureS3Key`, `letterheadBackgroundS3Key` if present; return new `BrandingResponse` shape: `{branding: SchoolBrandingDto | null, urls?: {logo?, principalSignature?, letterheadBackground?}}` (additive — keeps existing field; adds parallel signed-URL field). `branding.types.ts` — extend `BrandingResponse` interface; update `UpdateBrandingRequestDtoZ` if needed.
  - Validation: smoke — after C.0.7 5-step flow, GET response must include `urls.logo` matching `^https://edforge-pdf-assets-.*X-Amz-Signature` and resolve to a 200 PNG download.
  - AC: Per master plan C.0.7 spec; signed URLs have 10-min TTL (matching `DEFAULT_GET_EXPIRY_SECONDS = 600` in `s3-presigner.service.ts`); raw `S3Key` fields still present (backwards-compatible).
  - Deps: none (parallel with C.0-fu.1).
  - **🟢 As-shipped (2026-05-25 PM, [PR #195](https://github.com/shoaibrain/edforge/pull/195)):** `BrandingResponse.urls?: BrandingAssetUrls` field added (additive — raw `branding.<field>S3Key` keys preserved for back-compat). New `buildAssetUrls()` private helper mints signed GET URLs (10-min TTL via `DEFAULT_GET_EXPIRY_SECONDS = 600`) for each present S3-backed asset. Both `getBranding()` AND `updateBranding()` return the new field. **CodeRabbit catch in-PR (`4c9439a`):** original implementation had no error handling around the 3 sequential `presignGet` calls — a single transient S3 failure would 500 the whole response. Refactored to a per-asset `tryPresignTo()` helper that swallows + logs (WARN level) per-asset failures; the call continues with whatever URLs successfully minted. 2 new graceful-degradation specs (single-asset failure + all-asset failure cases) lock in the behavior. Live smoke step 5 explicitly asserts `urls.logo` is present in the GET response after PATCH; assertion green on dev-pabson-primary.
- **C.0-fu.3** — `BrandingService` + `S3PresignerService` unit specs.
  - Files: `microservices/identity/src/branding/branding.service.spec.ts` (NEW; mock `DynamoDBClientService` + `S3PresignerService` + `AuditedWriteService`; cover happy paths + MIME/size validation + tenant-scoping assertion + the no-school-found 404 path); `microservices/identity/src/common/services/s3-presigner.service.spec.ts` (NEW; mock `TokenVendingMachine.assumeRole` returning STS-shape capitalized credentials — regression-guards hotfix #191; mock `getSignedUrl` to assert URL TTL + key prefix + ContentType + ContentLength passed through correctly).
  - Validation: `jest --testPathPattern "branding|s3-presigner"` — all specs green; both hotfix-class typos would have been caught at unit-test time with these mocks in place.
  - AC: Coverage ≥80% on both services; both hotfix scenarios from PRs #190 + #191 reproducible as failing-then-passing test cases.
  - Deps: none (parallel with C.0-fu.1 + C.0-fu.2).
  - **🟢 As-shipped (2026-05-25 PM, [PR #195](https://github.com/shoaibrain/edforge/pull/195)):** `branding.service.spec.ts` (14 specs covering getBranding null/full/partial branding/missing-school + presignUploadUrl MIME/size/404 + updateBranding partial merge/version bump/tenant-scope/audit + the 2 new C.0-fu.2 graceful-degradation cases). `s3-presigner.service.spec.ts` (8 specs covering construction validation + PR #191 TVM credential-casing regression guard + presignPut/Get TTL + ContentType + ContentLength contract). **Mock pattern lesson:** class-based mocks for AWS SDK clients (S3Client + PutObjectCommand + GetObjectCommand) avoid `new jest.fn()` constructor-mock gotchas where the implementation's return value isn't reliably applied. **Established the reusable pattern for any future service that wraps TVM + AWS SDK clients** (C.1.5 finance Invoice render endpoint will mirror this pattern).

**Deploy ladder (as-executed 2026-05-25 PM):**
1. `./scripts/build-application.sh identity` → image `sha256:f4f4b447760d20a43350f35f854a05e0fd4b3fd883f25f32e688cb50ac0f70d57` (tag `f518351-20260525143430`)
2. `./scripts/deploy.sh tenant-template-stack-basic prod` — CFN-level no-op (Track A is app-code-only; no IAM/env-var changes mean the task def stays at revision 4)
3. `aws ecs update-service --force-new-deployment` — explicit force-new-deployment to pull the new `:latest`; service stable in ~3-5 min
4. Wire-check (no auth): 401 + 204 + 204 + `BrandingModule dependencies initialized` in CloudWatch logs
5. Full smoke 5/5 GREEN with C.0-fu.2 `urls.logo` assertion in step 5

**Trap captured:** App-code-only changes that don't touch CDK/IAM produce a CFN no-op on `deploy.sh tenant-template-stack-basic`. ECS won't pull the new `:latest` automatically — must `aws ecs update-service --force-new-deployment` as an extra step. Add to deploy-app.sh wrapper TODO at CLAUDE.md B0.1.

### Sprint C.1 — Invoice + Receipt PDF MVP (Finance, no editor)
**Status:** 🟡 **partial — C.1.1 shipped 2026-05-25 PM ([PR #196](https://github.com/shoaibrain/edforge/pull/196), `@aibrains/pdf-renderer@0.5.0` live on npm); C.1.2–C.1.6 next.** Parallel-eligible with EPIC-D D.4. **No EPIC-D dependency.**
**Demo (sprint-level, deferred to C.1.6):** Click "Download PDF" on any issued invoice in dev-pabson-primary → PDF downloads with BS+AD dual dates, EN+NE labels, NPR currency, correct line items. Existing Print button still works. No template configuration was needed (lazy-default kicked in).

#### Tickets

- **C.1.1** — `<InvoicePdf>` document + invoice descriptor + i18n.
  - Files: `packages/pdf-renderer/src/documents/InvoicePdf.tsx` (NEW); `descriptors/invoice.ts` (NEW; `docType: 'INVOICE'`, sample data, `configurableFields[]`, `defaults(archetype, locale)`); `i18n/{en,ne}/invoice.json` (NEW). Publish `@aibrains/pdf-renderer` 0.2.0 + consumer pin bumps.
  - Validation: snapshot tests against 3 sample invoices (PABSON BS+EN+NE, PABSON BS-only, GENERIC AD+EN).
  - AC: All line-item columns render; subtotal/tax/grand-total block accurate; Devanagari labels render via Devanagari snapshot test; descriptor registered in `getDescriptor('INVOICE')`.
  - Deps: C.0.4.
  - **🟢 As-shipped (2026-05-25 PM, [PR #196](https://github.com/shoaibrain/edforge/pull/196), commit `b0365ea`):** `@aibrains/pdf-renderer@0.5.0` live on npm (verified via `npm view`). `<InvoicePdf>` composes C.0.3 primitives (Document + Page + BrandedHeader + BrandedFooter + Watermark) + C.0.3 components (KeyValueTable + LineItemTable + TotalsBlock + SignatureLine). New `InvoiceTemplateConfig` extends `PdfTemplateConfig` with `lineItemColumns` (7 booleans) + `totalsSection` (5 booleans) + `footer.showSignatureLine`. Dual-language label rendering: when `template.labelLanguages.length === 2`, each label renders stacked vertically with secondary at 80% size. Watermark on `status === 'draft' \| 'cancelled'`. Notes truncate at 500 chars (react-pdf has no `page-break-inside`). **Invoice descriptor self-registers** via side-effect import in `packages/pdf-renderer/src/index.ts`; 13 `configurableFields[]` (5 header toggles + 4 line-item column toggles + 3 totals visibility + 1 dateFormat select) for the C.2.4 editor surface. PABSON archetype defaults: dual-date + EN+NE labels + south-asian numbers + NPR symbol; GENERIC + reserved archetypes (CBSE_IN/NAIS_US/GEMS_UAE) fall through to GENERIC profile (gregorian + EN-only + western + ISO-code currency). `i18n/{en,ne}/invoice.json` ship 30 keys each, full parity. **82/82 pdf-renderer specs** (was 72; +10 new invoice-pdf specs covering 4 render canaries + 6 descriptor assertions including Devanagari R45 canary). **No backend code or AWS deploy in this ticket** — npm publish only. Consumer pin bumps in `server/application/package.json` deferred to C.1.5 finance per `edforge_workspace_only_packages_docker_trap`.

- **C.1.2** — `<ReceiptPdf>` document + receipt descriptor + i18n.
  - Files: `packages/pdf-renderer/src/documents/ReceiptPdf.tsx` (NEW; reuses `BrandedHeader` + `LineItemTable` + `TotalsBlock` from C.0.3 — composition, not duplication); `descriptors/receipt.ts` (NEW); `i18n/{en,ne}/receipt.json`. Publish `@aibrains/pdf-renderer` 0.3.0 + consumer pin bumps.
  - Validation: snapshot tests.
  - AC: Per CEO direction, receipt is structurally separate from invoice (own DDB row, own descriptor, own sample data — payment-focused); primitives shared.
  - Deps: C.1.1.

- **C.1.3** — Identity `PdfTemplatesService` (read-only) + lazy-seed + 1 route.
  - Files: `microservices/identity/src/pdf-templates/pdf-templates.module.ts` (NEW); `pdf-templates.service.ts` (NEW; `getCurrentTemplate(schoolId, docType, ctx)` reads `SCHOOL#{schoolId}#PDF_TEMPLATE#{docType}#CURRENT` row; **on miss returns `descriptor.defaults(archetype, locale)` from `@aibrains/pdf-renderer`** — no DDB write); `pdf-templates.controller.ts` (NEW; `GET /schools/:schoolId/pdf-templates/:docType/current`); `microservices/identity/src/common/entities/base.entity.ts` — extend `IdentityEntityType` enum with `'PDF_TEMPLATE_CURRENT'` + `'PDF_TEMPLATE_VERSION'`; `EntityKeyBuilder.pdfTemplateCurrent(schoolId, docType)` + `pdfTemplateVersion(schoolId, docType, templateId, version)` helpers; `module-wiring.spec.ts` extend; 1 route in `tenant-api-prod.json`; shared-infra-stack redeploy.
  - Validation: jest unit covers descriptor-defaults fallback (no DDB row → returns defaults; with row → returns saved); integration on dev-pabson-primary: `GET .../INVOICE/current` on a school with no row returns full PABSON default config.
  - AC: Lazy-seed pattern matches D.1.3 exactly; permission `pdf-templates:view` required; route-drift lint green.
  - Deps: C.0.4 + C.0.5 + C.1.1.

- **C.1.4** — `IdentityClient.getCurrentTemplate(...)` helper + cross-service LRU cache.
  - Files: `server/application/libs/identity-client/src/identity-client.service.ts` (extend; new method `getCurrentTemplate(schoolId, docType, ctx)` with per-process LRU cache, 60s TTL keyed `tenantId:schoolId:docType`).
  - Validation: jest unit (cache hit / cache miss / TTL expiry / 5xx fallback to descriptor default).
  - AC: Callable from finance + academics; cache capped at 100 entries; on identity 5xx returns descriptor default (graceful degradation — render never 500s on template-fetch failure).
  - Deps: C.1.3.

- **C.1.5** — Finance `GET /invoices/:id/pdf` endpoint.
  - Files: `microservices/finance/src/invoices/invoices.controller.ts` (extend with `@Get(':id/pdf')`); `invoices.service.ts` (extend with `getPdf(schoolId, invoiceId, ctx)`); `microservices/finance/package.json` (add `@aibrains/pdf-renderer` dep + pin); 1 route in `tenant-api-prod.json`; shared-infra-stack redeploy. Audit: extend identity `AuditLogEntry.targetEntity` enum with `'PDF_DOCUMENT'` + `action: 'pdf_generated'` (separate small PR landing alongside).
  - Validation: integration; live curl on dev-pabson-primary fixture invoice; PDF opens, line items present, BS dates correct, NE labels render.
  - AC: Permission `billing:view` reused (no new key); ownership via `identityClient.enforceStudentOwnership`; response size `<500KB` for fixture invoices; audit event `pdf_generated` emitted (fire-and-forget).
  - Deps: C.1.1 + C.1.4.

- **C.1.6** — Finance `GET /payments/:id/receipt/pdf` endpoint + retire client-side jspdf.
  - Files: `microservices/finance/src/payments/payments.controller.ts` (extend); `payments.service.ts` (extend `getReceiptPdf(...)`); 1 route in `tenant-api-prod.json`; shared-infra-stack redeploy. Frontend: `edforge-saas-frontend/apps/shell/src/components/payments/PaymentReceipt.tsx` — replace `handleDownloadPdf` (jspdf+html2canvas at lines 29-53) with call to new `useDownloadReceiptPdf(paymentId)`; `edforge-saas-frontend/packages/finance-services/src/hooks/usePayments.ts` (NEW hook mirroring `useExportInvoicesCsv` blob-anchor pattern). Invoice page: `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` line 98 — add `[Download PDF]` button next to existing `[Print]` (don't replace yet; print fallback stays through C.5).
  - Validation: e2e on dev-pabson-primary; live download → text-selectable PDF (regression check on prior raster behavior).
  - AC: Receipt PDF text is selectable; subsequent PR removes `jspdf` + `html2canvas` deps from `apps/shell/package.json` once C.5 lands; existing Print button still functional.
  - Deps: C.1.2 + C.1.4.
  - **🟢 As-shipped (backend 2026-05-26, frontend 2026-05-26 → 2026-05-27 across 23 PRs):** Backend in PR #202 (live smoke PASS 17,034B receipt PDF on dev-pabson-primary). Frontend grew into a multi-sprint program tracked under [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md): Sprint M0 (foundation hygiene — vitest bootstrap + MfeNotFoundBoundary + MFE-nav ESLint rule), Sprint M1 (Invoice + Receipt download flows — `useDownloadInvoicePdf` + `useDownloadReceiptPdf` + telemetry + error-toast + jspdf retirement), Sprint M1.5-FU (architectural correction: moved receipt page from Shell to Finance MFE — Shell didn't have natural school context, causing a `?schoolId=undefined` bug). Receipt PDF text IS selectable (server-rendered react-pdf, not raster). `jspdf` + `html2canvas` removed from `apps/shell/package.json` in M1.8 (-18 transitive packages). HTML Print button retained as a secondary path; status-gate hardening tracked as M1.5-FU.7 (paused; see PDF MFE plan §3.6). **Pre-existing renderer gap surfaced by M3 phase 2 testing:** see C.1.8 below.

- **C.1.7** — **EPIC-C frontend closeout — Branding read + write (Sprints M2 + M3)**.
  - Files: full inventory in [`pdf-service-mfe-integration-plan.md`](./pdf-service-mfe-integration-plan.md) §0.2 + §4 + §5. Headline:
    - NEW workspace package `@edforge/identity-services` (sibling of `@edforge/finance-services`).
    - NEW `apps/shell/src/pages/settings/branding.tsx` + 4 components (`BrandingDisplay` 269 LOC, `BrandingForm` 489 LOC, `BrandingColorPicker` 146 LOC, `BrandingFileField` 327 LOC NEW).
    - NEW `usePresignedAssetUpload` hook (116 LOC) running the presign → S3 PUT pipeline.
    - i18n `branding` namespace (en + ne parity).
    - ABAC `branding` resource + `view`/`configure` actions; Principal granted `['view', 'configure']`.
  - Validation: live e2e on dev-pabson-primary in prod 2026-05-26 → 2026-05-27. All three asset slots upload successfully; saved branding propagates to next invoice/receipt PDF download (logo + signature visible). M2 = 54/54 specs; M2+M3 phase 1 = 81/81; M3 phase 2 added 4 spec suites (BrandingFileField + BrandingForm + branding-service + use-presigned-asset-upload).
  - AC: TenantAdmin + Principal can view + edit branding via Shell settings; Standard users gated.
  - Deps: C.0.7 (✅) + C.0-followup (✅) + C.0-followup-2 (the 2 server fixes for M3 phase 2 — see PRs #209 + #210 above in the status grid).
  - **🟢 As-shipped (5 PRs on edforge-saas-frontend + 2 server hotfixes on `edforge`):** PR #88 M2 read; PR #89 M3 phase 1 (text + colors); PR #90 M3 phase 2 (asset uploads); server PR #209 (`requestChecksumCalculation: 'WHEN_REQUIRED'`); server PR #210 (PdfAssetsBucket CORS via CDK). Two follow-ups deferred from this ticket: **(a) Issue #25** — BrandingFileField eager blob-preview before Save (~20-30 LOC); **(b) C.1.8 below** — letterhead actually renders in PDF.

- **C.1.8** — **Render `letterheadBackgroundSrc` in pdf-renderer** (pre-existing feature gap surfaced by M3 phase 2 prod test 2026-05-27).
  - Files: [`packages/pdf-renderer/src/primitives/Page.tsx`](packages/pdf-renderer/src/primitives/Page.tsx) extended with optional `letterheadBackgroundSrc` prop + new `<View fixed>` containing `<RpdfImage>` at full bounds; [`InvoicePdf.tsx`](packages/pdf-renderer/src/documents/InvoicePdf.tsx) + [`ReceiptPdf.tsx`](packages/pdf-renderer/src/documents/ReceiptPdf.tsx) thread `branding.letterheadBackgroundSrc` to Page; [`packages/pdf-renderer/src/__tests__/render-smoke.spec.tsx`](packages/pdf-renderer/src/__tests__/render-smoke.spec.tsx) +4 letterhead specs; [`invoice-pdf.renderer.ts`](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.ts) new exported `isPdfLetterheadKey(s3Key)` helper + projection guard; [`receipt-pdf.renderer.ts`](server/application/microservices/finance/src/payments/receipt-pdf.renderer.ts) imports + applies the guard; [`invoice-pdf.renderer.spec.ts`](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.spec.ts) +7 `isPdfLetterheadKey` unit specs; pin bumps in [`packages/pdf-renderer/package.json`](packages/pdf-renderer/package.json) (0.6.0 → 0.7.0), [`server/application/package.json`](server/application/package.json) (^0.6.0 → ^0.7.0), [`server/package.json`](server/package.json) (same).
  - Validation: 98/98 pdf-renderer specs green; 13/13 finance renderer specs green (invoice + receipt + isPdfLetterheadKey unit); `nest build finance` + `nest build identity` compile clean; live deploy ladder executed; image SHAs verified on running tasks; operator-led affirmative UI test confirms letterhead-in-PDF (handed off to operator).
  - AC: ✅ All previous pdf-renderer + finance renderer specs still pass (none regress); existing PDFs without `letterheadBackgroundSrc` render byte-identically (additive change, opt-in). Operator can now make M3 phase 2 letterhead upload appear in PDFs (PNG/JPEG; PDF letterheads stored in S3 but skipped at projection — operator re-uploads as PNG to use them).
  - Deps: C.0.3 (✅) + C.1.7 (✅).
  - **🟢 As-shipped (2026-05-27 PM, [PR #211](https://github.com/shoaibrain/edforge/pull/211), commit `4b2dc50`):** `@aibrains/pdf-renderer@0.7.0` live on npm. finance ECR image `sha256:90359d1c775e275ca5ee82b18032ae26077e6baf07046cb35ca8a115dd7e7fb2` tag `9075379-20260527133701`; identity ECR image `sha256:43a8bf1fe884dfac449146fb2be24b466cd3b51562acc9e12e36a0142aa5ae07` tag `9075379-20260527133727`. Both running on `prod-basic` cluster, finance-TaskDef:2 + identity-TaskDef:4, healthy. **Two ship-cycle lessons captured (L27, L28):** descriptor types promising `ImageSource` fields MUST have a primitive consumer (else the contract is a memory leak in the design — to be enforced by a follow-up lint rule); frontend MIME allowlists that diverge from renderer capabilities are a UX trap (M3 phase 2's PDF letterhead was operator-intent-driven but renderer-incapable). Projection-layer guard chosen over allowlist tightening so the operator-intent contract survives a future renderer upgrade.

### Sprint C.2 — Template Editor UI (Shell-Level Settings)
**Status:** 🔲 not started.
**Demo:** TenantAdmin → Shell → Settings → PDF Templates → Invoice; edits primary color, uploads logo, toggles discount column off, switches to "Nepali only" labels; live preview updates within 300ms of last keystroke; clicks Publish; subsequent invoice PDF downloads reflect the new template; old issued invoices still render against the prior version.

#### Tickets

- **C.2.1** — `PdfTemplatesService` writes (create-draft / patch-draft / publish / republish / version-list / version-get).
  - Files: `microservices/identity/src/pdf-templates/pdf-templates.service.ts` (extend); `pdf-templates.controller.ts` (extend with `POST /schools/:id/pdf-templates` (create draft) + `PATCH .../:templateId` (optimistic-lock on version) + `POST .../:templateId/publish` (draft → published with `TransactWriteItems` atomic state transition: archive old CURRENT + write new VERSION row + update CURRENT pointer) + `POST .../:templateId/versions/:v/republish` (rollback) + `GET .../:templateId/versions` + `GET .../:templateId/versions/:v`); 5 routes in `tenant-api-prod.json`; shared-infra-stack redeploy. Audit + events: extend identity audit-entity `targetEntity` enum with `'PDF_TEMPLATE'`; emit `pdf_template_drafted` / `pdf_template_published` (severity: 'high') / `pdf_template_archived` via `AuditedWriteService`.
  - Validation: integration covering full lifecycle (create draft → patch draft → publish → republish prior version → check that a fixture document with frozen `pdfTemplateRef` still renders against its frozen version).
  - AC: Permission `pdf-templates:configure` (TenantAdmin only V1; Principal opt-in V1.5); only one CURRENT per (schoolId, docType); old documents with frozen ref render correctly against archived versions; smoke validates immutability.
  - Deps: C.1.3.

- **C.2.2** — `ColorField` + `FileField` + `MultiSelectField` in `@edforge/forms`.
  - Files: `edforge-saas-frontend/packages/forms/src/fields/ColorField.tsx` (NEW; native `<input type="color">` + RHF Controller); `FileField.tsx` (NEW; file picker + image preview + size/MIME validation + presigned-PUT integration helper); verify or add `MultiSelectField.tsx`; `packages/forms/src/fields/index.ts` (re-exports); `packages/forms/src/index.ts`.
  - Validation: visual fixture in Storybook (if Storybook exists for `@edforge/forms`; else inline test page); unit tests for validation paths.
  - AC: All three accept RHF `{name, control}`; FileField max-size warning before upload attempt; ColorField produces hex string in form state.
  - Deps: none.

- **C.2.3** — Shell `/settings/pdf-templates` index page.
  - Files: `edforge-saas-frontend/apps/shell/src/pages/settings/pdf-templates/index.tsx` (NEW; lists doc types as cards — Invoice + Receipt active; Report Card + Admit Card + future doc types as disabled-cards with "Coming in Sprint C.x" tooltips); each active card shows "Current: vN, published by X on Y" or "Using default (PABSON BS+EN+NE)"; clicking navigates to editor. `apps/shell/src/router.tsx` (add route + `pdf-templates:view` permission gate); shell sidebar entry under Settings.
  - Validation: manual on dev-pabson-primary; TenantAdmin sees cards; non-TenantAdmin gets explanation page.
  - AC: Mirrors existing `workspace.tsx` settings page layout; reuses `SettingsPageHeader` + `SettingsSection` primitives.
  - Deps: C.2.1.

- **C.2.4** — Shell `/settings/pdf-templates/:docType` generic editor (parameterized by descriptor).
  - Files: `edforge-saas-frontend/apps/shell/src/pages/settings/pdf-templates/[docType].tsx` (NEW; reads `descriptor.configurableFields[]` from `@aibrains/pdf-renderer` and generates form sections using C.2.2 primitives); split-pane layout with debounced live preview via `<PDFViewer>` (300ms debounce); sample selector defaulting to "Default mock"; version history sidebar; draft / publish / discard actions. `edforge-saas-frontend/packages/identity-services/src/hooks/usePdfTemplate.ts` (NEW; mirrors finance-services hook patterns).
  - Validation: e2e on dev-pabson-primary: edit primary color → preview reflects ≤300ms; upload logo via presigned PUT → preview shows logo; toggle "Nepali only" → preview Devanagari renders; publish → audit row in identity DDB; subsequent invoice PDF download reflects new template; old issued invoice still renders against its frozen ref.
  - AC: SAME editor component renders ALL future doc types via descriptor pattern (no per-doc-type editor code); unsaved-changes guard on navigation; logo upload uses C.0.7 presigned PUT.
  - Deps: C.2.1 + C.2.2 + C.2.3.

- **C.2.5** — Document immutability: freeze `pdfTemplateRef` on invoice issue.
  - Files: `microservices/finance/src/invoices/invoices.service.ts` — at `issue()` time, fetch current template via `IdentityClient.getCurrentTemplate(...)` and write `pdfTemplateRef: {docType, templateId, version}` onto the invoice row. `packages/shared-types/src/schemas/finance/invoice.schema.ts` — add `pdfTemplateRef?: PdfTemplateRefDto` field; shared-types minor bump. `invoices.service.ts` `getPdf(...)` — check `invoice.pdfTemplateRef` first; if present fetch that version; else use current.
  - Validation: integration — issue invoice → publish new template version → re-download original invoice → PDF identical to pre-edit (uses frozen version).
  - AC: Old invoices visually stable across template edits; new invoices use latest published version.
  - Deps: C.1.5 + C.2.1.

### Sprint C.3 — Report Card PDF (depends on A.4 ✅ shipped)
**Status:** 🔲 not started. Unblocked — A.4 Result Subsystem shipped 2026-05-23 (memory `project_sprint_a4_shipped_prod`).
**Demo:** From the Result Card detail page in the academics MFE, click "Download PDF" → branded report card downloads with per-subject grades + GPA + class teacher remarks + signatures.

#### Tickets

- **C.3.1** — `<ReportCardPdf>` + `<GradeTable>` component + descriptor.
  - Files: `packages/pdf-renderer/src/components/GradeTable.tsx` (NEW; subject × term grid with toggleable letterGrade/gpa/remark columns); `documents/ReportCardPdf.tsx` (NEW); `descriptors/report-card.ts` (NEW); `i18n/{en,ne}/report-card.json`. Publish `@aibrains/pdf-renderer` minor bump + consumer pin updates.
  - Validation: snapshot tests against 3 fixture result cards (PABSON with NG handling visible, PABSON all-pass, GENERIC).
  - AC: GradeTable accepts column toggles via template config; renders `NG` correctly (visual treatment per CEHRD convention, `gpaPoints=0`, `isPassing=false`); descriptor registered.
  - Deps: C.0.4 + A.4.2 (ResultCard entity, shipped 🟢).

- **C.3.2** — Academics `GET /result-cards/:id/pdf` endpoint.
  - Files: `microservices/academics/src/result-cards/result-cards.controller.ts` (extend); `result-cards.service.ts` (extend); `microservices/academics/package.json` (add `@aibrains/pdf-renderer` dep); 1 route in `tenant-api-prod.json`; shared-infra-stack redeploy. `microservices/academics/src/__tests__/module-wiring.spec.ts` extend (per [[feedback-module-wiring-invariant]]).
  - Validation: integration on dev-pabson-primary fixture result card; live download.
  - AC: Permission `result-cards:view` reused (no new key); uses C.1.4 cache; `pdfTemplateRef` freeze pattern applied at `publish()` time (mirrors invoice issue freeze).
  - Deps: C.3.1 + C.1.4.

- **C.3.3** — Unlock Report Card card in editor.
  - Files: `edforge-saas-frontend/apps/shell/src/pages/settings/pdf-templates/index.tsx` (single-line change — Report Card card moves from disabled to enabled).
  - Validation: e2e — TenantAdmin opens Report Card editor; edits primary color; publishes; subsequent download reflects.
  - AC: ZERO new editor code (descriptor pattern); only the index unblocks.
  - Deps: C.2.4 + C.3.1.

### Sprint C.4 — Batch Generation
**Status:** 🔲 not started.
**Demo:** TenantAdmin selects 50 invoices on the list page; clicks "Generate PDFs"; progress indicator counts up; receives a 50-PDF zip file. Same flow works for Report Cards from academics.

#### Tickets

- **C.4.1** — `edforge-pdf-batch` Lambda + IAM + EventBridge rule.
  - Files: `server/lib/analytics/analytics-stack.ts` — append the Lambda (`NodejsFunction` esbuild, NODEJS_20_X, 2048MB, 15min, `reservedConcurrentExecutions: 50` inside Mumbai's 1000-account quota, per-Lambda DLQ SQS 14d retention, CloudWatch error alarm wired to `operatorAlertTopic`). EB rule `edforge-pdf-job-requested` filtering `source=['edforge.pdf-jobs'], detailType=['PdfJobRequested']`. IAM scoped: `dynamodb:Query/GetItem` on identity + academics + finance tables; `s3:PutObject` on `edforge-pdfs-*/tenants/*`; `events:PutEvents` on SBT bus. Lambda code at `server/lib/document-rendering/lambda/pdf-batch/handler.ts` (NEW; per-docType switch → `getDescriptor(docType)` → render → chunked S3 PutObject → optional `archiver`-streamed zip → DDB `UpdateItem` job status).
  - Validation: `cdk synth` clean; deploy log; live smoke: publish `PdfJobRequested` event → Lambda fires → 10 invoices rendered → DDB row marked complete; DLQ alarm flow tested with forced failure.
  - AC: reservedConcurrency 50; DLQ + alarm SNS-wired to `edforge-alerts-operator`; bucket name resolved via env var (no CFN export — R-PDF-NEW-2 mitigation).
  - Deps: C.0.6 + C.1.1 + C.3.1.

- **C.4.2** — `PdfJob` DDB entity + batch endpoints in identity.
  - Files: `microservices/identity/src/common/entities/base.entity.ts` — extend `IdentityEntityType` enum with `'PDF_JOB'`; `EntityKeyBuilder.pdfJob(schoolId, jobId)`. `microservices/identity/src/pdf-jobs/pdf-jobs.module.ts` (NEW); `pdf-jobs.service.ts` (NEW; `enqueue(...)` writes DDB row + publishes EB event); `pdf-jobs.controller.ts` (NEW; `POST /pdf-jobs` create + `GET /pdf-jobs/:jobId` status); 2 routes in `tenant-api-prod.json`; shared-infra-stack redeploy; `module-wiring.spec.ts` extend. Event taxonomy: `packages/shared-types/src/events/pdf-jobs/pdf-job-requested.schema.ts` + `pdf-job-completed.schema.ts` (NEW); register in `EVENT_REGISTRY` per [taxonomy.ts](../../packages/shared-types/src/events/taxonomy.ts) existing pattern.
  - Validation: integration; live e2e on dev-pabson-primary: enqueue → Lambda fires → completed status → download URL works.
  - AC: Permission `pdf-jobs:create` (TenantAdmin + Principal + Accountant); max 500 IDs per job; presigned URL TTL 600s; jobs accept any `docType` uniformly (single endpoint for invoice/receipt/report-card/future).
  - Deps: C.4.1.

- **C.4.3** — Frontend batch UI (invoice list).
  - Files: `edforge-saas-frontend/apps/finance/src/routes/billing/invoices/index.tsx` (extend with multi-select checkboxes + "Generate PDFs" bulk-action button); `edforge-saas-frontend/packages/finance-services/src/hooks/usePdfJob.ts` (NEW; React Query mutation + conditional-polling per [[feedback-react-query-no-polling-for-event-driven-data]]).
  - Validation: e2e on dev-pabson-primary: select 50 invoices → ~30s wait → zip downloads.
  - AC: Polling interval 2s while pending/processing, off when terminal; download via existing blob-anchor pattern.
  - Deps: C.4.2.

- **C.4.4** — Frontend batch UI (academics report-card list).
  - Files: `edforge-saas-frontend/apps/academics/src/routes/grades/...` extend report-card list with same bulk-select pattern; hoist `usePdfJob` to `@edforge/types` (or sibling shared package) for cross-MFE reuse; add to `mf-shared.ts` singletons per [[edforge-mf-shared-singleton-rule]].
  - Validation: e2e — bulk report-card generation works.
  - AC: Code-share `usePdfJob` between finance + academics MFEs.
  - Deps: C.4.3 + C.3.2.

### Sprint C.5 — Admit Card (interleaves with EPIC-D D.4/D.5)
**Status:** 🔲 blocked on D.4 + D.5 (BLE/SEE workflows — D.3 ✅ shipped 2026-05-24, D.4 + D.5 not started). Template **data-shape** lands here; **entity integration** lives in D.4.4 / D.5.3 per existing master plan cycle-break at §12.

#### Tickets

- **C.5.1** — `<AdmitCardPdf>` data-shape (template ships before BLE/SEE entities).
  - Files: `packages/pdf-renderer/src/documents/AdmitCardPdf.tsx` (NEW; supports BLE Grade 8 and SEE Grade 10 via single component with `examType` discriminator per [`d4-ble-design.md` §11.5](./d4-ble-design.md)); `descriptors/admit-card.ts` (NEW); `components/StudentPhotoFrame.tsx` (NEW); `components/BarcodeQR.tsx` (NEW; accepts pre-generated SVG); `i18n/{en,ne}/admit-card.json`.
  - Validation: snapshot tests with synthetic BLE + SEE data.
  - AC: Component accepts data shape; descriptor registered; ships before D.4 entities — only the contract.
  - Deps: C.0.4.

- **C.5.2** — BLE admit-card render endpoint (**filed under D.4.4** in master plan — cross-EPIC integration).

- **C.5.3** — SEE admit-card render endpoint (**filed under D.5.3** in master plan — cross-EPIC integration).

### Sprint C.5 alternate path (V1.5)
- Transcripts, Student ID Cards, Bonafide / Transfer Certificates land per identical descriptor-pattern: each ships a new `<DocPdf>` + descriptor + i18n bundle + a domain endpoint. ETA: 1-2 days per doc type once C.0-C.4 are live.

---

## 6. EPIC-D — Plan (Structured Framework)

**Goal:** EdForge ships the structured-framework layer: data-driven curriculum subjects, pluggable grading policy, machine-actionable promotion rules, and full Nepal national exam workflows (BLE, SEE, NEB-11/12).

### Sprint D.1 — GradingPolicy Pluggability (Nepal A+/E + `NG`)
**Status:** 🟡 **shipped to prod 2026-05-22 with documented followup** — all 5 tickets shipped over 4 PRs (#146 Phase 1: entity + Zod schema rename + new fields; #147 Phase 2: GradeLetter widen + gpa-calc + lazy-seed + backfill script; #148 hotfix: shared-types 0.55.0 publish-gate; #149 hotfix: inline TenantMetadataReader because `@edforge/tenant-settings-resolver` is workspace-only, can't ship in Docker — see R39). academics ECR rebuilt + rolled (image `sha256:865838dc…`); backfill DRY-RUN proved data shape (2 PABSON tenants, 3 schools, 1 already-policy, 2 plan-to-create); backfill APPLY-true blocked by deployer IAM (PutItem on academics table not granted) — **D.1.3 lazy-seed handles new policy creation organically on first internal Grade-calc read**. E.1 regression smoke 11/11 green post-D.1 academics roll. **Open followup**: D.1.1 mapper serializer omits `gpaScale` + entry-level `isPassing`/`isTerminalFail?`/`displayName?` from response DTO (R38) — runtime entity has them, API response loses them. ~10 LOC fix for next PR.

**As-built note (design Q2 lock-in):** D.1.3 below originally described tenant-seeder-Lambda seed; **as-shipped, this is lazy-seed at first internal call to `getDefaultPolicyEntity()` in `grading-policy.service.ts`**, using `ArchetypeDefaults[archetype]` via the inline `TenantMetadataReaderService` to resolve the archetype. Master plan ticket text below is updated to match.

**Demo:** `GET /schools/:id/grading-policy` returns Nepal CEHRD scale (A+/A/B+/B/C+/C/D+/D/E with documented bands + the `NG` Not-Graded sentinel for failed external-exam subjects) for PABSON-archetype schools; synthetic GENERIC returns US A-F.

**v3.4.1 cross-cut from D.4.0:** GradingPolicy MUST accept `NG` as a terminal letter-grade value distinct from `F` / `Incomplete`. BLE/SEE/NEB result-import paths (D.4.6, D.5.4, D.6.x) write `NG` directly when the external authority publishes it. `isPassing: false`, `gpaPoints: 0`, `displayName: 'Not Graded'`. Without this, D.4.6 result-import 4xx's on `NG` rows.

#### Tickets

- **D.1.1** — `GradingPolicy.gpaScale` + `letterGrades[]` fields.
  - Files: `microservices/academics/src/common/entities/grading-policy.entity.ts` + schema `packages/shared-types/src/schemas/academics/grading-policy.schema.ts`. Add `gpaScale: '4.0' | '5.0'`, `letterGrades: [{letter, minPct, maxPct, gpaPoints, isPassing, isTerminalFail?: boolean, displayName?: string}]`. `isTerminalFail` distinguishes `NG` (cannot retake without supplementary process) from `F` (can retake within term).
  - Validation: entity unit + contract test; spec includes both `F` (US scale) and `NG` (PABSON scale) as test fixtures.
  - AC: Schema + factory updated; existing rows backward-compat (default to US A-F); the entity accepts an `NG` row with `isPassing=false` + `isTerminalFail=true` + `gpaPoints=0`.
  - Deps: 0.4.1.

- **D.1.2** — Remove hardcoded US `GradeLetter` enum from `base.entity.ts:273`.
  - Files: `microservices/academics/src/common/entities/base.entity.ts` — `GradeLetter` becomes string (validated against GradingPolicy.letterGrades).
  - Validation: existing tests stay green; new tests cover Nepal A+/E + `NG` letters; ResultCard.courseScores[].grade + ExternalExamResult.courseResults[].letterGrade both round-trip `NG`.
  - AC: No hardcoded letter list in base entity; archetype-grep CI catches future regressions; `NG` value passes through `Grade.letter` and `ExternalExamResult.letterGrade` without 4xx.
  - Deps: D.1.1.

- **D.1.3** — Lazy-seed default GradingPolicy on first internal read (CEHRD scale + `NG`).
  - **As-built (2026-05-22):** Seed is **NOT** in `tenant-seeder-lambda.ts` (tenant-seeder runs at tenant provisioning; schools don't exist yet). Seed lives in `microservices/academics/src/grades/grading-policy.service.ts::ensureDefaultPolicy()` — fires when `getDefaultPolicyEntity()` returns null (typically from Grade-calc internal paths). Sequence: resolve tenant archetype via inline `TenantMetadataReaderService` → call `getArchetypeDefaults(archetype)` from `@aibrains/shared-types` → translate `minPct/maxPct` (master-plan vocab) → `minPercentage/maxPercentage` (academics entity vocab) → DDB conditional PUT (`attribute_not_exists(entityKey)` for race safety).
  - Files: `microservices/academics/src/grades/grading-policy.service.ts` (modified — `ensureDefaultPolicy` rewritten); `microservices/academics/src/common/services/tenant-metadata-reader.service.ts` (NEW, inlined for Docker — see R39). Falls back to US A-F scale on archetype lookup failure (no 5xx on operator GET).
  - Validation: 4 specs (PABSON 10-letter incl. NG ✓ / GENERIC 5-letter US ✓ / unknown archetype fallback ✓ / METADATA-missing fallback ✓).
  - AC: First read on a school without a default policy creates one from `ArchetypeDefaults[tenant.archetype]`; `NG` row present + flagged correctly for PABSON; idempotent (concurrent races handled by conditional PUT); existing pre-D.1 rows continue to work (legacy row on dev-pabson Saraswati confirmed mapper-readable — see R38).
  - Deps: D.1.1 + 0.4.2 (both ✅ shipped).

- **D.1.4** — `gpa-calculator.service.ts` data-driven.
  - Files: `microservices/academics/src/grades/gpa-calculator.service.ts` — reads `gpaScale` from GradingPolicy (no hardcoded 4.0).
  - Validation: unit tests with 4.0 scale + 5.0 scale.
  - AC: GPA correct for both scales.
  - Deps: D.1.1.

- **D.1.5** — Saraswati GradingPolicy backfill.
  - Files: `scripts/backfill-pabson-grading-policy-saraswati.ts` (NEW).
  - Validation: dry-run + `--apply`.
  - AC: Saraswati has CEHRD scale post-backfill.
  - Deps: D.1.3.

### Sprint D.2 — PromotionRule Entity + Workflow
**Demo:** PABSON `PromotionRule` evaluated post-term-result-publish for `dev-pabson-primary` Grade 8 cohort → flags students for review → operator decides; cross-year handoff (F1 in v2) uses this.

#### Tickets

- **D.2.1** — `PromotionRule` entity + schema.
  - Files: `packages/shared-types/src/schemas/academics/promotion-rule.schema.ts` (NEW); entity. Fields: `ruleId`, `schoolId`, `archetypeId`, `gradeLevel`, `passingThresholdPct`, `minAttendancePct`, `subjectsRequired[]`, `archetypeDefaulted: boolean`.
  - Validation: entity unit + contract test.
  - AC: Schema + factory; module-wiring updated; Ed-Fi alignment: extension namespace `edforge:PromotionPolicy`.
  - Deps: 0.4.1.

- **D.2.2** — PromotionRule CRUD endpoints.
  - Files: `microservices/academics/src/promotion-rules/promotion-rules.controller.ts` (NEW); three-way handoff (`/promotion-rules` new prefix).
  - Validation: integration; route-drift lint.
  - AC: CRUD + audit + event.
  - Deps: D.2.1.

- **D.2.3** — PABSON default PromotionRule seed.
  - Files: tenant-seeder seeds per-grade defaults (e.g., passingPct=35, minAttendancePct=80 — confirmed by champion field visit).
  - Validation: integration.
  - AC: PABSON tenants have defaults; backfill script for existing.
  - Deps: D.2.1 + 0.4.2.

- **D.2.4** — Promotion evaluation service (pure function).
  - Files: `microservices/academics/src/promotion/promotion-evaluator.service.ts` (NEW); reads ResultCard + Attendance summary + PromotionRule; returns `{eligible, retainedReason?}`.
  - Validation: unit table-driven: passes all subjects + ≥80% attendance → eligible; one fail subject → retainedReason='subject_failure'; <80% attendance → 'attendance_failure'.
  - AC: Pure function; archetype-grep zero hits.
  - Deps: D.2.1.

- **D.2.5** — Batch promotion-evaluation endpoint.
  - Files: `POST /schools/:id/academic-years/:fromAyId/promote-from?targetAyId=&gradeLevel=` — evaluates all enrolments in `fromAyId` + `gradeLevel` → returns list with promotion-decision suggestions.
  - Validation: integration on `dev-pabson-primary`.
  - AC: Suggests but doesn't commit; operator review before commit (D.2.6).
  - Deps: D.2.4 + A.4.2.

- **D.2.6** — Cross-year promotion commit (chunked).
  - Files: `POST /schools/:id/academic-years/:fromAyId/promote-from/:targetAyId/commit` with list of decisions; chunked at 100 per TransactWriteItems; creates provisional Enrolments in target AY.
  - Validation: integration: 200 students promoted in chunks; `enrollment.promoted` event per chunk.
  - AC: Atomic per chunk; idempotent on retry.
  - Deps: D.2.5 + D.2.7 + D.2.8.

- **D.2.7** — `Enrollment.priorEnrollmentId` + `promotionDecision` write-once fields.
  - Files: `microservices/academics/src/common/entities/enrollment.entity.ts`; `packages/shared-types/src/schemas/academics/enrollment.schema.ts`. Add `priorEnrollmentId?: string`, `promotionDecision: enum 'promoted'|'retained'|'conditional'|'graduated'|'withdrawn'|'transferred_out'` (write-once).
  - Validation: schema unit; entity unit; integration: second PUT of `promotionDecision` → 409 `PROMOTION_DECISION_LOCKED`.
  - AC: Fields on prior-AY enrollment; write-once enforced.
  - Deps: 0.4.1.

- **D.2.8** — `provisional` EnrollmentStatus + state-machine.
  - Files: `microservices/academics/src/common/entities/base.entity.ts` adds `provisional` to `EnrollmentStatus`; `microservices/academics/src/enrollment/enrollment-state-machine.ts` (NEW) covers `provisional → enrolled`, `provisional → withdrawn`; rejects `enrolled → provisional`.
  - Validation: unit covering every valid + invalid transition.
  - AC: 100% transition coverage; rejection list documented.
  - Deps: D.2.7.

- **D.2.9** — Result-publish event handler (subscribes to `result.published`).
  - Files: `microservices/academics/src/enrollment/enrollment-transition-handler.service.ts` (NEW); subscribes to `result.published` with terminal-exam flag; queries provisional next-AY rows; calls D.2.10.
  - Validation: integration: publish prior-AY terminal result → handler invoked; idempotent on retry.
  - AC: Handler fires on event; idempotent.
  - Deps: D.2.8 + A.4.5.

- **D.2.10** — Atomic provisional→final flip (chunked).
  - Files: `microservices/academics/src/enrollment/enrollment.service.ts` `promoteProvisionalToEnrolled(provisionalIds[])`; chunked at 100 per TransactWriteItems.
  - Validation: integration: 10 provisional rows + handler invocation → 9 flip to `enrolled`, 1 retained gets `gradeLevel` rewritten; attendance under provisional enrollment survives `gradeLevel` rewrite (invariant 3 guard).
  - AC: Atomic per chunk; failure rolls back chunk; audit + event per chunk.
  - Deps: D.2.9.

- **D.2.11** — Cross-AY `GET /students/:id/timeline` endpoint.
  - Files: `microservices/academics/src/students/student-timeline.controller.ts` (NEW); returns all enrollments across AYs via GSI2.
  - Validation: integration across two AYs; every row carries `enrollmentId` (invariant 3 guard); cursor pagination.
  - AC: Returns full chain with promotion decisions sorted by AY ascending; route registered (§1.5 implicit).
  - Deps: D.2.7.

- **D.2.12** — Cross-year smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-cross-year-handoff.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`; simulates full operator-printed window (prior AY active → next AY created → batch-promote → window attendance → publish prior results → 9 flip + 1 retained).
  - AC: Both exit 0; attendance preserved; events at every step.
  - Deps: D.2.6 + D.2.10 + D.2.11.

### Sprint D.3 — ExternalAssessment Family (Foundation)
**Demo:** Backend supports `RubricCategory`, `ExternalExamRegistration`, `ExternalExamAdmitCard`, `InternalAssessment`, `ExternalExamResult`, `ExternalExamRetake` entities; reusable across BLE, SEE, NEB-11, NEB-12 with archetype-defaulted internal-weight.

#### Tickets

- **D.3.0** — `RubricCategory` entity (target for `InternalAssessment.rubricCategoryId` FK).
  - Files: `microservices/academics/src/common/entities/rubric-category.entity.ts` (NEW); `packages/shared-types/src/schemas/academics/rubric-category.schema.ts` (NEW). Fields: `categoryId`, `examType` (BLE/SEE/NEB-11/NEB-12), `academicSubject?` (descriptor from A.2.1 — replaces older `subjectArea?`; nullable for cross-subject categories like attendance/conduct), `categoryName`, `weight` (% of internal-assessment total), `archetypeDefaultId?`, `cdcReference?` (link to CDC rubric publication).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.4.1 + A.2.1.

- **D.3.1** — `ExternalExamRegistration` entity (v3.4.1 — expanded from research D.4.0 §11.1).
  - Files: `microservices/academics/src/external-exams/external-exam-registration.entity.ts` (NEW). Fields:
    - `registrationId` (PK), `studentId`, `enrollmentId`, `tenantId`, `schoolId`
    - `examType` (`'BLE' | 'SEE' | 'NEB_11' | 'NEB_12'`), `examYear` (BS year)
    - `examAuthority` — municipality CEHRD code for BLE (string, e.g. KMC code); `'NEB'` literal for SEE/NEB-11/NEB-12
    - `municipalityId?` (FK to SchoolConfiguration.municipalityConfig.municipalityId at write time; nullable for NEB exams)
    - `symbolNumber?` (assigned by municipality/NEB post-submission; replaces older `externalRollNumber?` term; both names supported by entity-vs-schema mapper for back-compat)
    - `examCenter?` (assigned post-submission; municipality/NEB-assigned location)
    - `courses[]` (array of `Course.courseId` per A.2.0 rename — the subjects/courses the student is registered for; carries the FK chain to `Course.academicSubject` for downstream aggregation)
    - `registrationDate`, `status` (`'DRAFT' | 'SUBMITTED_TO_IEMIS' | 'SYMBOL_ASSIGNED' | 'CANCELLED'` per research §11.1 state machine; replaces older `draft/submitted/confirmed/cancelled`)
    - GSI by `(examType, examYear, schoolId)` for cohort queries; GSI by `symbolNumber` for ledger-import reverse-lookup.
  - Validation: entity unit + contract test; state machine unit (legal/illegal transitions); FK validation on `courses[]` against Course; entity-vs-schema mapper handles both `externalRollNumber` and `symbolNumber` for migration grace period.
  - AC: Factory + contract green; module-wiring updated; state-machine enforced (`DRAFT → SUBMITTED_TO_IEMIS` one-way; `SUBMITTED_TO_IEMIS → SYMBOL_ASSIGNED` one-way; `CANCELLED` terminal); GSI inventory updated; shared-types minor bump.
  - Deps: 0.3.1 + A.2.1 + E.0.2 (municipalityConfig provides the FK target).

- **D.3.2** — `InternalAssessment` entity (per student × course × external exam).
  - Files: `internal-assessment.entity.ts` (NEW). Fields: `assessmentId`, `studentId`, `enrollmentId`, `examType`, `courseId` (per v3.4 A.2.0 rename — replaces `subjectId`; Course carries `academicSubject` descriptor for downstream aggregation), `rubricCategoryId`, `score`, `maxScore`, `enteredBy`, `enteredAt`.
  - Validation: entity unit.
  - AC: Factory; archetype-defaulted internal-weight applied at result-aggregation time.
  - Deps: A.2.1.

- **D.3.3** — `ExternalExamAdmitCard` entity.
  - Files: `external-exam-admit-card.entity.ts` (NEW). Fields: `admitCardId`, `registrationId`, `studentId`, `externalRollNumber`, `examCenterName`, `examCenterAddress`, `examDates[]`, `pdfS3Url?`, `issuedAt`.
  - Validation: entity unit.
  - AC: Factory.
  - Deps: D.3.1.

- **D.3.4** — `ExternalExamResult` entity.
  - Files: `external-exam-result.entity.ts` (NEW). Fields: `resultId`, `studentId`, `enrollmentId`, `examType`, `courseResults[]` (per course: `{courseId, academicSubject, letterGrade, gpaPoints, internalScore, externalScore, isSupplementary}` — per v3.4 A.2.0 rename + D.4.0 BLE NG/supplementary flag), `cumulativeGpa?` (NEB only), `overallStatus` (passed/failed/NG), `importedAt`.
  - Validation: entity unit + contract test.
  - AC: Factory; supports per-course + cumulative; `letterGrade` accepts `NG` (Not Graded) value per D.4.0 + D.5.0 research; `isSupplementary` flips true if the row originated from Grade Increment retake (D.4.7 / D.6.5).
  - Deps: D.3.1 + A.2.1.

- **D.3.5** — `ExternalExamRetake` entity (Grade Increment).
  - Files: `external-exam-retake.entity.ts` (NEW). Fields: `retakeId`, `originalResultId`, `studentId`, `examType`, `subjects[]` (subjects being retaken), `retakeDate`, `fee`, `status`.
  - Validation: entity unit.
  - AC: NEB-only; BLE/SEE skip.
  - Deps: D.3.4.

- **D.3.6** — Module-wiring update.
  - Files: `microservices/academics/src/__tests__/module-wiring.spec.ts` extended; `microservices/academics/src/external-exams/external-exams.module.ts` (NEW).
  - Validation: spec catches forgotten import.
  - AC: New module wired.
  - Deps: 0.3.2 + D.3.1–D.3.5.

### Sprint D.4 — BLE Workflow (Grade 8) End-to-End (v3.4 — D.4.0 resolved)

**Foundation in place:** IEMIS import driver (`microservices/academics/src/students/iemis-transform.ts`); `students.iemis-import` endpoint; AY structure with `gradingPeriods` + `examStartDate`/`examEndDate`; Saraswati Grade 8 cohort already imported via 0.1.x backfill; `ExternalAssessment` entity family from Sprint D.3 (covers BLE/SEE/NEB-11/NEB-12 generically).

**✅ D.4.0 RESEARCH RESOLVED (2026-05-22).** Artifact: [`d4-ble-design.md`](./d4-ble-design.md). Summary of decisions baked into tickets below:
- **Authority chain:** Constitution-of-Nepal-delegated to local governments (Municipality / Metropolitan City). Each municipality drafts/distributes question papers; CEHRD/CDC owns the standard.
- **Registration → IEMIS portal (CSV/Excel manual upload, NO API).** Municipality pulls roster from IEMIS to issue symbolNumber + examCenter.
- **Weight: 50% Internal Assessment (CAS: unit tests, project work, participation) + 50% External Written.** Internal locked + submitted via IEMIS portal BEFORE Chaitra externals.
- **Result format:** Per-subject letter grade `A+ | A | B+ | B | C+ | C | D | NG`; cumulative GPA on 4.0 scale; `NG` (Not Graded) = below threshold.
- **Supplementary (Grade Increment) Exam:** Students with NG in ≤3 subjects can sit re-exams ~2 weeks after main result (e.g. KMC: Baishakh 6-12). Schools run remedial crash courses in the window. **REQUIRED in V1 (new ticket D.4.7).**
- **Admit card:** Municipality generates symbol numbers; school prints + distributes 1-2 weeks before exam. Format confirmed: municipality logo + photo + symbolNumber (large font) + signatures (Headmaster + Municipal Officer).
- **Per-municipality variation:** ONE schema; configurable export headers + logos at SchoolConfiguration level (per audit: Tenant is wrong scope). NEW ticket E.0.2 introduces `municipalityConfig` on SchoolConfiguration.

**Demo (after D.4 sprint):** Engineer can run a synthetic Grade 8 BLE cycle on `dev-pabson-primary`: register cohort → export IEMIS CSV → enter 50/50 internal assessment → issue admit card PDF (with municipality logo from SchoolConfiguration) → import synthetic IEMIS ledger → mark students with NG ≤3 eligible for Grade Increment → re-exam result import → promotion-rule evaluates Grade 8 → 9. Schools (Saraswati and future) use the same flow when their actual BLE window opens.

#### Tickets

- **D.4.1** — BLE registration entity + endpoint (concrete schema from D.4.0 §11.1).
  - Files: `microservices/academics/src/external-exams/ble-registration.controller.ts` (NEW; uses existing `ExternalExamRegistration` entity from D.3.1 — no new entity for BLE-specific shape, the D.3 base entity carries `examType='BLE'`); `POST /schools/:id/external-exams/ble/registrations` (bulk; accepts `studentIds[]` or "all-Grade-8" flag); writes rows with `status='DRAFT'`, `municipalityId` from SchoolConfiguration.
  - Validation: integration with Saraswati Grade 8 cohort (synthetic on dev-pabson-primary).
  - AC: Bulk creation; audit + event per row (`exam.ble_registration_created`); idempotent on re-call (returns existing rows + count).
  - Deps: D.3.1 + E.0.2 (municipalityConfig on SchoolConfiguration).

- **D.4.2** — BLE CDC internal-assessment rubric seed (concrete from D.4.0 §4.2).
  - Files: `packages/shared-types/src/archetype-defaults/ble-cdc-rubric.ts` (NEW); RubricCategory rows: `unitTests` (weight 30%), `projectWork` (weight 30%), `participation` (weight 20%), `subjectActivities` (weight 20%); each sums to 50% of total grade (the external written is the other 50%).
  - Validation: unit; archetype-seed loader on PABSON tenant provisioning.
  - AC: 4 RubricCategory rows for `examType='BLE'` seeded; usable by `InternalAssessment` entity (D.3.2); aggregation engine (A.4.1) produces `/50` from these categories.
  - Deps: D.3.0 + D.3.2 + 0.4.2.

- **D.4.3** — BLE internal-assessment mark entry endpoint (concrete from D.4.0 §11.2).
  - Files: `internal-assessment.controller.ts` `POST /external-exams/:registrationId/internal-assessment` (single per student × course × rubricCategory); `POST .../bulk` (chunked at 100); `PATCH .../:assessmentId` (correction); state machine: `DRAFT → LOCKED_FOR_IEMIS` (one-way; locked rows reject PATCH).
  - Validation: integration with seeded CDC rubric (4 categories); per-course rollup math (sum across categories = totalInternal / 50); 4xx if row in LOCKED state.
  - AC: Mark entry validates `0 ≤ score ≤ maxScore`; LOCKED status rejected via 409 `ASSESSMENT_LOCKED`; audit + event per write; one `internal_assessment.bulk_recorded` event per chunk.
  - Deps: D.3.2 + D.4.2.

- **D.4.4** — BLE IEMIS-CSV export endpoint (registration + locked internal marks).
  - Files: `ble-iemis-export.controller.ts` (NEW); `GET /external-exams/ble/registrations/:cohortId/iemis-export.csv?include=internal-assessment`; streams CSV via `csv-stringify` (NOT Handlebars — pattern matches E.1.0 finding); columns from D.4.0 §8 (`student_iemis_id, first_name, last_name, dob_bs, gender, school_iemis_code, subjects_list`).
  - Validation: integration: synthetic 30-student cohort exports as 30-row CSV; columns match D.4.0 §8 + §11.2 spec.
  - AC: CSV streamed; column headers exactly match D.4.0 §8 (verifiable against IEMIS sample template captured post-pilot-onboard if available); per-municipality header override applied if `SchoolConfiguration.municipalityConfig.exportHeaders` provided.
  - Deps: D.4.1 + D.4.3 + E.0.2.

- **D.4.5** — BLE admit-card render trigger (concrete field list from D.4.0 §11.5).
  - Files: `admit-cards.controller.ts` `POST /external-exams/ble/registrations/:registrationId/admit-card/render`; calls C.4.3 renderer with payload `{registrationId, symbolNumber, examCenter, studentName, studentPhotoS3Url, dobBs, gender, schoolName, schoolIemisCode, subjects[], municipalityName, municipalityLogoS3Url, headmasterName}`; populates `ExternalExamAdmitCard.pdfS3Url`; emits `exam.ble_admit_card_rendered` event.
  - Validation: integration: render admit card → PDF in S3 → URL signed.
  - AC: PDF includes ALL fields from D.4.0 §11.5 admit-card template; municipality logo overlay correct per `SchoolConfiguration.municipalityConfig.municipalityLogoS3Url`; matches research §3.2 / §11.5 field list (school logo, municipality logo, year BS, symbol number, photo, signatures).
  - Deps: D.3.3 + C.4.3 + E.0.2 (municipalityConfig).

- **D.4.6** — BLE IEMIS-ledger result import endpoint (concrete from D.4.0 §11.4).
  - Files: `external-exam-results.controller.ts` `POST /external-exams/ble/results/import` (multipart CSV upload from IEMIS ledger); parses columns `{student_iemis_id, symbol_number, course_letter_grades[]}`; populates `ExternalExamResult.courseResults[].letterGrade` + `gradePoint` (4.0 scale lookup); marks `overallStatus='passed'` if no NG in any course, else `'failed_with_supplementary_eligible'` if NG ≤3, else `'failed'`.
  - Validation: integration with synthetic IEMIS CSV (5 rows: 2 pass, 1 NG-1-subject, 1 NG-3-subjects, 1 NG-5-subjects); per-status assertion correct.
  - AC: CSV parsed; result rows written via TransactWriteItems (idempotent on re-upload via `symbol_number` natural key); events `exam.ble_result_imported` per row; `overallStatus` derivation rule reviewed at PR.
  - Deps: D.3.4 + D.4.1.

- **D.4.7** — BLE Grade Increment (Supplementary) exam endpoint (NEW per D.4.0 §7.2).
  - Files: `external-exam-retakes.controller.ts` (NEW); `POST /external-exams/ble/results/:resultId/supplementary-register` (registers student for re-exam in failed courses); `POST /external-exams/ble/supplementary-results/import` (parses re-exam ledger from municipality); creates new `ExternalExamRetake` row (D.3.5) AND when re-exam result comes back overwrites `ExternalExamResult.courseResults[].letterGrade` for retaken courses + sets `isSupplementary=true` on those entries.
  - Validation: integration: student with NG in 2 subjects → register for supplementary → import re-exam ledger → result row updated; eligibility rule (`NG count ≤ 3`) enforced (4xx on >3 NG).
  - AC: Eligibility rule enforced (NG ≤3 subjects per D.4.0 §7.2 KMC reference); audit + event `exam.ble_supplementary_registered` + `exam.ble_supplementary_result_imported`; window dates enforced (configurable per-municipality on SchoolConfiguration if needed).
  - Deps: D.3.5 + D.4.6.

- **D.4.8** — BLE Grade 8 → 9 promotion rule (refined from D.4.0 §7).
  - Files: BLE-specific PromotionRule seed in `packages/shared-types/src/archetype-defaults/pabson-promotion-rules.ts`; **Rule:** pass = no NG in final results (after supplementary if attempted); NG remaining after supplementary → promote with remedial flag (per CDC policy "strict fail does not permanently bar"); decision data-driven from `ExternalExamResult.overallStatus`.
  - Validation: integration: promotion-evaluator returns correct decision for 4 scenarios (clean pass / supplementary-pass / supplementary-fail-but-promote-with-remedial / total-fail).
  - AC: Rule data-driven; Saraswati Grade 8 cohort evaluable; remedial flag captured on `PromotionDecision.notes`.
  - Deps: D.2.1 + D.3.4 + D.4.7.

- **D.4.9** — BLE smoke (parametric).
  - Files: `scripts/smoke-tests/pilot-ble-flow.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary` — register → export CSV → enter internal marks → lock → render admit card → import result ledger → register supplementary for NG students → import supplementary results → run promotion eval.
  - AC: Full BLE lifecycle (main + supplementary) exits 0; all 7 events on the bus + DLQ depth 0.
  - Deps: D.4.1–D.4.8.

### Sprint D.5 — SEE Workflow (Grade 10) End-to-End

**Foundation:** SEE inherits the BLE pattern from Sprint D.4. The differences are authority (NEB instead of Municipality), weight (25/75 instead of 50/50), result-import source (NEB portal CSV instead of municipality IEMIS ledger), and Grade Increment eligibility (different threshold).

**Demo:** Same shape as Sprint D.4 but for SEE (Grade 10, NEB authority, 25/75 weight, results via `exam.neb.gov.np`).

#### Tickets

- **D.5.1** — SEE registration endpoint.
  - Files: `see-registration.controller.ts` (NEW); shape mirrors BLE but `examAuthority='NEB'`.
  - Validation: integration.
  - AC: Bulk creation; audit + event.
  - Deps: D.3.1.

- **D.5.2** — SEE 25% internal assessment per subject.
  - Files: extend internal-assessment endpoint with SEE-specific 25% rubric (subject-level: labs + assignments + class tests).
  - Validation: integration.
  - AC: 25% rubric applied; SEE-distinct from BLE 50/50.
  - Deps: D.3.2.

- **D.5.3** — SEE admit-card render.
  - Files: same as D.4.4 but SEE template variant.
  - Validation: integration.
  - AC: Admit card correct.
  - Deps: D.3.3 + C.4.3.

- **D.5.4** — SEE result import.
  - Files: similar to D.4.5; CSV from NEB portal export.
  - Validation: integration with NEB-format CSV.
  - AC: Results parsed + written.
  - Deps: D.3.4.

- **D.5.5** — SEE Grade 10 → 11 promotion rule.
  - Files: PABSON PromotionRule for Grade 10 (SEE-pass required for Grade 11 NEB enrollment).
  - Validation: integration.
  - AC: Rule data-driven.
  - Deps: D.2.1 + D.3.4.

- **D.5.6** — Pre-board (PABSON) exam integration.
  - Files: `Exam.examType` accepts `pre_board` value (archetypeDefaults.examPattern); pre-board exams stored as Exam + ExamScore rows (NOT ExternalExam since marks school-managed).
  - Validation: integration: create pre-board exam → mark entry → results.
  - AC: PABSON pre-board modeled correctly; opt-in per school.
  - Deps: A.3.2.

- **D.5.7** — SEE smoke.
  - Files: `pilot-see-flow.ts` (NEW).
  - Validation: smoke on Saraswati + `dev-pabson-primary`.
  - AC: Full SEE lifecycle exits 0.
  - Deps: D.5.1–D.5.6.

### Sprint D.6 — NEB Grade 11/12 Workflow Architecture
**Demo:** Backend architected to support NEB-11 / NEB-12 registration + result import (not in-person at Saraswati; for pilot 2 readiness).

#### Tickets

- **D.6.1** — NEB-11/NEB-12 registration endpoint.
  - Files: `neb-registration.controller.ts` (NEW); subject selection + SEE-mark-sheet ref.
  - Validation: integration.
  - AC: Endpoint live; ABAC: pilot-2 tenant can use.
  - Deps: D.3.1.

- **D.6.2** — NEB-11/NEB-12 internal-assessment endpoint.
  - Files: 25% internal rubric (theory + practical split for science subjects).
  - Validation: integration.
  - AC: Rubric correct.
  - Deps: D.3.2.

- **D.6.3** — NEB admit-card distribution endpoint.
  - Files: NEB-issued admit cards are imported (not generated); endpoint records distribution.
  - Validation: integration.
  - AC: Admit-card metadata stored.
  - Deps: D.3.3.

- **D.6.4** — NEB-12 cumulative GPA computation.
  - Files: extends D.3.4; cumulative across all subjects (NEB-specific).
  - Validation: unit.
  - AC: Cumulative correct.
  - Deps: D.3.4.

- **D.6.5** — Grade Increment Exam (Retake) endpoint.
  - Files: `external-exam-retakes.controller.ts` (NEW); POST `/external-exams/:resultId/retake`; fee Rs.600 captured; eligible if NG ≤1 subject or D+ in all-except-2.
  - Validation: integration.
  - AC: Eligibility rule enforced.
  - Deps: D.3.5.

- **D.6.6** — NEB smoke (architectural, not real-pilot).
  - Files: `pilot-neb-architecture-smoke.ts` (NEW; runs on synthetic NEB-grade-11/12 fixture).
  - Validation: smoke against synthetic data.
  - AC: Lifecycle works architecturally; pilot 2 ready.
  - Deps: D.6.1–D.6.5.

### Sprint D.7 — StudentAcademicTrack Entity — **V1.5 DEFERRED (not counted in V1 ticket total)**
**Demo (V1.5 only):** Per-student multi-year track shows: current grade + grades remaining + board exam ahead (BLE@G8, SEE@G10, NEB@G11/12) + projected completion. Listed here for sequencing reference; tickets do NOT ship in V1.

#### Tickets

- **D.7.1** — `StudentAcademicTrack` entity.
  - Files: `student-academic-track.entity.ts` (NEW).
  - Validation: entity unit + contract test.
  - AC: Factory + module-wiring updated.
  - Deps: D.3.1.

- **D.7.2** — Track CRUD + auto-update on promotion.
  - Files: controller + service; promotion commit (D.2.6) updates track.
  - Validation: integration.
  - AC: Track stays current.
  - Deps: D.7.1 + D.2.6.

- **D.7.3** — Track UI in student + parent portals.
  - Files: frontend.
  - Validation: Playwright.
  - AC: Visible.
  - Deps: D.7.2.

---

## 7. EPIC-E — Comply (CEHRD + Nepal MoE)

**Goal:** EdForge ships CEHRD compliance MVP — Flash I/II templates, discipline (soft), residency, consent, tenant export. Per CEO 2026-05-20: MVP only; iterate.

### Sprint E.0 — Schema Extensions Driven by E.1.0 + D.4.0 Research (NEW v3.4)
**Status:** 🟢 **shipped to prod 2026-05-22** (per memory `project_sprint_e_0_shipped_prod`). All 3 tickets live: `Student.hasEcedExperience?: boolean` + IEMIS transformer extension (E.0.1); `SchoolConfiguration.municipalityConfig` nested object (E.0.2); `Student.scholarshipAmountNpr?: number` (E.0.3). Verified via live `PATCH /schools/{id}/configuration` round-trip on dev-pabson-primary; shared-types 0.53.0 published; identity + academics ECR rebuilt + rolled.

**Source:** E.1.0 + D.4.0 research surfaced specific missing fields needed for Flash I/II + BLE flows. This sprint lands the schema extensions BEFORE E.1 so the aggregation engine has its source data.

**Foundation in place (verified by audit 2026-05-22):** Student entity already has `motherTongueDescriptor`, `ethnicityDescriptor`, `disabilities[]`, `scholarshipCategory`, `sexDescriptor`, `isTransferred`, `previousSchool`, `emisStudentId`. Tenant has `address.country` + `archetype`. SchoolConfiguration exists per school.

**Demo:** Synthetic Grade 1 student record on `dev-pabson-primary` carries `hasEcedExperience=true`; `dev-pabson-primary`'s SchoolConfiguration has `municipalityConfig.municipalityName='Kathmandu Metropolitan City'` + `municipalityLogoS3Url`; both surface in Flash I CSV export + BLE admit-card render.

#### Tickets

- **E.0.1** — Student `hasEcedExperience` field (Flash I Grade 1 requirement).
  - Files: `microservices/academics/src/common/entities/student.entity.ts` extended (+1 field `hasEcedExperience?: boolean`); `packages/shared-types/src/schemas/academics/student.schema.ts` schema updated; `iemis-transform.ts` extended to derive from IEMIS XLSX column `eced_completed` (if present).
  - Validation: entity unit; contract test; IEMIS transform unit (3 cases: explicit true / explicit false / absent → undefined).
  - AC: Factory + contract green; shared-types minor bump + npm publish + AdminWeb jsdom sim; IEMIS transform back-compat (legacy XLSX without column → field undefined, not error).
  - Deps: 0.1.2a (IEMIS transformer).

- **E.0.2** — `municipalityConfig` on SchoolConfiguration (BLE + Flash I/II per-school config).
  - Files: `microservices/identity/src/common/entities/department.entity.ts` extended (per audit — SchoolConfiguration is at lines 47-77 of this file); `packages/shared-types/src/schemas/identity/school-configuration.schema.ts` schema updated; new optional nested object `municipalityConfig: { municipalityId, municipalityName, municipalityLogoS3Url?, ielsExportHeaderOverrides?: Record<string, string> }`.
  - Validation: entity unit; contract test.
  - AC: Field optional; existing schools without it continue to work; PATCH endpoint accepts the field; audit + event on update; shared-types minor bump.
  - Deps: 0.4.1.

- **E.0.3** — `scholarshipAmount` field on Student (Flash II requirement, open per research §15).
  - Files: `microservices/academics/src/common/entities/student.entity.ts` extended (+1 field `scholarshipAmountNpr?: number`); `packages/shared-types/src/schemas/academics/student.schema.ts` schema updated.
  - Validation: entity unit; contract test.
  - AC: Field optional; aggregation in Flash II uses if present, else falls back to scholarship-category-derived default (data-driven from archetypeDefaults).
  - Deps: 0.1.2a.
  - **Note:** Research E.1.0 §5.1 + §15 flagged this as "Inferred — needs IEMIS portal verification." If portal accepts only category (not amount), this field is unused but harmless. Keep optional.

### Sprint E.1 — Flash I/II MVP Templates + Generator (v3.4 — E.1.0 resolved)
**Status:** 🟢 **shipped to prod 2026-05-22** — all 8 tickets live; 5 PRs (#140 Phase 1: shared-types contracts + entity + template descriptors; #141 Phase 2: identity controller + service + state machine + 3-way handoff; #142 Phase 3: report-aggregator Lambda + S3 + scheduler + smoke; #143 hotfix: shared-types 0.54.0 publish-gate; #144 hotfix: Lambda DDB key bare-UUID per `edforge_identity_ddb_bare_uuid_partition_key`). Live smoke against dev-pabson Saraswati: **11/11 assertions, 249 enrollments processed in 1.4s, Lambda memory 153/1024 MB, zero CloudWatch errors post-fix**. Pre-flight + create + Lambda transition `generating → generated` + PATCH `submitted` all working. **Open**: 1 orphan ReportingSnapshot (`5351f942-…`) stuck in `generating` from pre-#144 attempt; non-blocking data debt; deployer IAM cannot mutate (V1.5 AdminWeb UI handles or operator-via-elevated-IAM).

**Foundation in place:** IEMIS import driver (inbound) — `iemis-transform.ts` handles incoming CSV. The export side (this sprint) is the inverse — we already know the field mapping in one direction, we extend it to the other. Plus E.0 schema extensions for `hasEcedExperience` + `municipalityConfig` + `scholarshipAmountNpr`.

**✅ E.1.0 RESEARCH RESOLVED (2026-05-22).** Artifact: [`e1-flash-csv-schema.md`](./e1-flash-csv-schema.md). Concrete decisions:

- **NO IEMIS API:** Confirmed; CSV/Excel manual upload via `emis.cehrd.gov.np` is the V1 strategy.
- **Flash I (intake/baseline) — 13 columns at student-row level:**
  | # | Column | Source (entity.field) | Required |
  |---|---|---|---|
  | 1 | `school_iemis_code` | `School.emisCode` | Y |
  | 2 | `academic_year_bs` | `Session.yearBs` | Y |
  | 3 | `student_iemis_id` | `Student.emisStudentId` | Conditional (blank for new Grade 1 / ECED) |
  | 4 | `first_name` | `Student.firstName` | Y |
  | 5 | `last_name` | `Student.lastName` | Y |
  | 6 | `dob_bs` | `Student.dobBs` (or derived from `Student.dob` via BS↔AD converter) | Y |
  | 7 | `gender` | `Student.sexDescriptor` → mapped to M/F/O | Y |
  | 8 | `caste_ethnicity` | `Student.ethnicityDescriptor` → mapped to {Dalit, Janajati, Brahmin/Chhetri, Others} | Y |
  | 9 | `mother_tongue` | `Student.motherTongueDescriptor` → mapped to plain-text | Y |
  | 10 | `disability_type` | `Student.disabilities[0]?.descriptor` → mapped | N |
  | 11 | `grade_level` | `Enrollment.gradeLevel` | Y |
  | 12 | `stream` | `Enrollment.track` (Grade 11-12 only) | N |
  | 13 | `enrollment_type` | `Enrollment.type` → {New, Promoted, Transfer_In} | Y |
  | 14 | `has_eced_exp` | `Student.hasEcedExperience` (Grade 1 only) | Conditional |
- **Flash II (outcomes/retention) — 10 columns at student-row level:**
  | # | Column | Source |
  |---|---|---|
  | 1 | `school_iemis_code` | `School.emisCode` |
  | 2 | `academic_year_bs` | `Session.yearBs` |
  | 3 | `student_iemis_id` | `Student.emisStudentId` (must exist by EOY) |
  | 4 | `grade_level` | `Enrollment.gradeLevel` |
  | 5 | `total_attendance_days` | `sum(Attendance.status='present')` for AY |
  | 6 | `scholarship_type` | `Student.scholarshipCategory` |
  | 7 | `scholarship_amount` | `Student.scholarshipAmountNpr` (from E.0.3) |
  | 8 | `exam_total_marks` | aggregate from `ResultCard.totalScore` or `ExternalExamResult.cumulativeScore` |
  | 9 | `exam_gpa` | `ResultCard.termGpa` (last term) or `ExternalExamResult.cumulativeGpa` |
  | 10 | `academic_status` | derived from `Enrollment.endStatus` + `PromotionDecision`: {Passed, Passed_Transfer, Repeated, Repeated_Transfer, Dropout} |
- **Submission cadence (research §13):** Flash I due end of Jestha (mid-June); Flash II due end of Chaitra (mid-March). Scheduler emits `reporting.submission_due` 30 days before.
- **CSV engine:** `csv-stringify` stream-based (NOT Handlebars). Reason from research §14: 2000-row Excel via Handlebars risks Lambda memory ceiling. csv-stringify is RFC-4180-compliant + streams.
- **Schema versioning:** Column mappings stored as JSON in S3 (NOT hardcoded in Lambda). Reason from research §14: CEHRD changes Excel headers periodically; S3-config update is faster than backend redeploy.
- **Pre-flight validation:** Required. IEMIS rejects entire upload on row-level validation fail; pre-flight UI surfaces "15 students missing IEMIS ID in Grade 8"-style errors BEFORE CSV download.
- **Forms 7 / 2 / 19:** **NOT modern CEHRD forms.** Research found these absent from public sources; likely legacy district-era. **Excluded from EPIC-E scope.**

**Demo (after E.1 sprint):** Generate synthetic Flash I + Flash II submission for `dev-pabson-primary` via `IEMIS_NPL_CEHRD_FLASH_I` + `IEMIS_NPL_CEHRD_FLASH_II` templates. CSVs exported; columns match research §11+§12 schemas. Pre-flight validation surfaces synthetic errors. Submission history visible. `reporting.submitted` event on bus + event-log.

#### Tickets

- **E.1.1** — `ReportingSnapshot` entity.
  - Files: `microservices/identity/src/external-reporting/reporting-snapshot.entity.ts` (NEW). Fields: `snapshotId`, `tenantId`, `schoolId`, `templateId` (`IEMIS_NPL_CEHRD_FLASH_I` | `IEMIS_NPL_CEHRD_FLASH_II`), `academicYearBs`, `status` (`generating` | `generated` | `submitted` | `verified` | `failed`), `s3Key`, `rowCount`, `generatedAt`, `submittedAt?`, `verifiedAt?`, `errorSummary?` (pre-flight validation result), `schemaVersion` (matches S3-stored template version).
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated; status machine validation; shared-types minor bump.
  - Deps: 0.3.1.

- **E.1.2** — Report template registry (S3-versioned, JSON-config).
  - Files: `packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD_FLASH_I.ts` (NEW; column-mapping JSON ref); `packages/shared-types/src/external-reporting/templates/IEMIS_NPL_CEHRD_FLASH_II.ts` (NEW); accompanying JSON column-mapping configs in `packages/shared-types/src/external-reporting/templates/configs/` (versioned `*-v1.json` files); CDK adds S3 sync to `s3://edforge-reporting-templates/<env>/` for hot-reload by Lambda; tenant-template-stack-basic IAM read-grant on bucket.
  - Validation: roundtrip — load template + sample row → generated CSV column headers exactly match research §11/§12; naming-lint `grep -rni '_SARASWATI\|_PABSON_SARASWATI' packages/shared-types/src/external-reporting/templates/` returns zero.
  - AC: Two templates loadable; naming pilot-agnostic (NPL + CEHRD only); S3 bucket created via CDK; Lambda reads template version at invocation (not at deploy); shared-types minor bump.
  - Deps: 0.4.1 + 0.4.2.

- **E.1.3** — Aggregation Lambda (template-driven, archetype-blind, csv-stringify).
  - Files: `server/lib/external-reporting/lambda/report-aggregator.ts` (NEW); uses `csv-stringify/sync` for ≤500 rows + `csv-stringify` stream for larger; reads template config from S3 (E.1.2); queries DDB single-table-design `STUDENT#<id>` partition to fetch Student + Enrollment + Attendance + ResultCard in batch; writes CSV to S3 `s3://edforge-reporting-output/<tenantId>/<schoolId>/<snapshotId>.csv`; signed URL returned.
  - Validation: integration with Saraswati actuals (1 school, 200 students); archetype-grep CI check `grep -rn 'archetype' server/lib/external-reporting/lambda/` returns zero; csv-stringify roundtrip property test (deserialize back → row count matches input).
  - AC: Aggregations match expected; <60s for 1000-student tenant; <200MB memory for 5000-row export; zero archetype branches; archetype-grep CI check passes.
  - Deps: E.1.2 + 0.4.4 + E.0.1 + E.0.3.

- **E.1.4** — Snapshot POST endpoint.
  - Files: `microservices/identity/src/external-reporting/reporting-snapshot.controller.ts` (NEW); `POST /reporting/snapshots` accepts `{templateId, academicYearBs, dryRun?: boolean}`; three-way handoff (new `/reporting` prefix); triggers Lambda async; returns snapshotId.
  - Validation: integration; route-drift lint green.
  - AC: Triggers Lambda; returns snapshot ID + S3 key (post-Lambda) or `pending` status (pre-Lambda); audit + event `reporting.snapshot_initiated`.
  - Deps: E.1.1 + E.1.3.

- **E.1.5** — Pre-flight validation endpoint (NEW per E.1.0 §14; surfaces §17.6 Sprint-0.1 historical-debt).
  - Files: `reporting-snapshot.controller.ts` extended with `POST /reporting/snapshots/preflight` accepting `{templateId, academicYearBs}`; returns `{rowCount, errors: [{rowIndex, studentId, field, error}], warnings: [{rowIndex, studentId, field, message, suggestedRemedy?}], canProceed: boolean}` WITHOUT writing a snapshot; runs same source-data query as E.1.3 but only validates (no CSV emit).
  - Validation: integration with synthetic data: 5 valid rows + 2 missing `student_iemis_id` + 1 unknown `motherTongue` descriptor → returns 3 errors + `canProceed=false`; **NEW: 206 Saraswati historical-debt rows with null `motherTongueDescriptor`/`disabilities`/`isTransferred` → returns 618 warnings (3 × 206) with `suggestedRemedy='Sprint-0.1-deferred-debt-see-§17.6'`**.
  - AC: Pre-flight surfaces row-level errors AND warnings (distinct); warnings don't block `canProceed` but operator sees them; ABAC-scoped per tenant; <30s for 1000-student tenant (synchronous response, no Lambda async); operator UI consumes this before allowing CSV download; **at this sprint kickoff, the team picks the §17.6 remedy path** (upsert mode / sexDescriptor-only script / manual UI / submit-with-gaps).
  - Deps: E.1.3.

- **E.1.6** — `reporting.submission_due` scheduler.
  - Files: CDK scheduled trigger in `tenant-template-stack-basic.ts` + Lambda `reporting-due-notifier.ts` (NEW); emits event 30 days before Flash I (Jestha) + 30 days before Flash II (Chaitra) deadlines; cron schedule computed from each tenant's Session BS-year + locale.
  - Validation: integration; per-tenant computation correct.
  - AC: Event fires on schedule; cron timing visible in EventBridge Scheduler console (not Lambda Triggers tab — same pattern as IEMIS Job Janitor 0.1.4 per memory).
  - Deps: E.1.4.

- **E.1.7** — Audit + event emit per submission lifecycle step.
  - Files: external-reporting service.
  - Validation: integration; events captured: `reporting.snapshot_initiated`, `reporting.snapshot_generated`, `reporting.snapshot_submitted`, `reporting.snapshot_verified`, `reporting.snapshot_failed`.
  - AC: 5 lifecycle events on bus; audit row per write; per-event payload validated against C0.c.3 Zod schemas (5 new schemas added).
  - Deps: E.1.4.

- **E.1.8** — Saraswati IEMIS Flash I + Flash II dry-run smoke.
  - Files: `scripts/smoke-tests/pilot-external-reporting.ts` (NEW; parametric `PILOT_ID`).
  - Validation: smoke against Saraswati + `dev-pabson-primary`; pre-flight → generate → download CSV → human-inspect first 5 rows match research §11/§12 schemas; manual inspection by operator (Saraswati) + EdForge engineer.
  - AC: Smoke exit 0; both Flash I + Flash II CSVs human-verified to match column-by-column schemas; submission lifecycle events on bus.
  - Deps: E.1.4 + E.1.5.

### Sprint E.2 — Discipline / Form-19 Soft Requirement
**Source:** Per CEO 2026-05-20: SOFT requirement.

**Demo:** Operator records discipline incident → entity persisted with audit + event; dashboard shows count.

#### Tickets

- **E.2.1** — `DisciplineIncident` entity (Ed-Fi-aligned).
  - Files: `microservices/academics/src/discipline/discipline-incident.entity.ts` (NEW). Ed-Fi resource: `DisciplineIncident`.
  - Validation: entity unit + contract test.
  - AC: Factory + contract green; module-wiring updated.
  - Deps: 0.3.1.

- **E.2.2** — `StudentDisciplineIncidentAssociation` entity.
  - Files: `student-discipline-incident-association.entity.ts` (NEW). Ed-Fi-aligned.
  - Validation: entity unit.
  - AC: Factory.
  - Deps: E.2.1.

- **E.2.3** — Discipline CRUD endpoints.
  - Files: `discipline.controller.ts` (NEW); three-way handoff (`/discipline` new prefix).
  - Validation: integration.
  - AC: CRUD + audit + event.
  - Deps: E.2.1 + E.2.2.

- **E.2.4** — Discipline descriptors under `edforge:` namespace.
  - Files: `packages/shared-types/src/edfi/extensions/discipline-descriptor.ts` (NEW).
  - Validation: schema unit.
  - AC: Custom descriptors live in `edforge:` namespace (invariant 11).
  - Deps: none.

- **E.2.5** — Dashboard count surface.
  - Files: extend dashboard with `disciplineIncidentCount`.
  - Validation: integration.
  - AC: Count visible on dashboard.
  - Deps: A.1.1 + E.2.3.

### Sprint E.3 — Data Residency Commitment + Per-Tenant Assertion
**Source:** v2 plan G.1. Mumbai AWS confirmed acceptable per CEO 2026-05-20.

**Demo:** `tenant.regionalCommitment` field captured at provisioning; integration test asserts provisioned tenant's region matches commitment.

#### Tickets

- **E.3.1** — Data-residency commitment doc.
  - Files: `docs/compliance/data-residency-commitment.md` (NEW, legal-reviewed).
  - Validation: doc reviewed.
  - AC: Doc legal-reviewed; committed.
  - Deps: none.

- **E.3.2** — `tenant.regionalCommitment` field.
  - Files: `tenant.entity.ts` + schema.
  - Validation: entity unit.
  - AC: Field present; populated at provision.
  - Deps: none.

- **E.3.3** — Per-tenant residency assertion.
  - Files: identity service test asserts tenant region matches `tenant.regionalCommitment`.
  - Validation: integration: provision tenant claiming region X → infra region must match.
  - AC: Assertion fails fast on mismatch.
  - Deps: E.3.2.

### Sprint E.4 — Parental Consent at User Invite
**Source:** v2 plan G.2.

**Demo:** Invite parent without consent record → 400 `CONSENT_REQUIRED`; with consent → invite succeeds + audit row.

#### Tickets

- **E.4.1** — `Consent` entity (version-hashed policy URL).
  - Files: `consent.entity.ts` (NEW).
  - Validation: entity unit + contract test.
  - AC: Factory + module-wiring updated.
  - Deps: 0.3.1.

- **E.4.2** — User-invite consent capture.
  - Files: identity user-invite path requires `consent` payload; ConsentService records.
  - Validation: integration: cannot invite without consent.
  - AC: Audit + consent row per invite.
  - Deps: E.4.1.

### Sprint E.5 — Tenant Data Export
**Source:** v2 plan G.3.

**Demo:** Click "Export tenant data" on `dev-pabson-primary` → S3 zip arrives with every entity → signed download URL.

#### Tickets

- **E.5.1** — Tenant export endpoint.
  - Files: `microservices/identity/src/tenant-export/tenant-export.controller.ts` (NEW); export Lambda; three-way (`/tenants/:id/export`).
  - Validation: integration on `dev-pabson-primary`.
  - AC: Zip complete; <30min for 1000-student tenant; signed download URL.
  - Deps: 0.3.1.

- **E.5.2** — Export job tracking.
  - Files: `TenantExportJob` entity (status: queued/running/complete/failed).
  - Validation: entity unit.
  - AC: Operator queryable.
  - Deps: E.5.1.

### Sprint E.6 — Scholarship Quota Compliance (nice-to-have, easy)
**Source:** CEO 2026-05-20: nice-to-have if easy hanging fruit.

**Demo:** Dashboard surfaces "scholarship coverage = X%" vs required threshold per enrollment band (10% / 12% / 15% per CEHRD).

#### Tickets

- **E.6.1** — Scholarship coverage computation.
  - Files: `microservices/finance/src/dashboard/scholarship-coverage.service.ts` (NEW); reads `Enrollment` count + `DiscountRule` scholarship type + total students; computes %.
  - Validation: unit.
  - AC: Computation correct; cached 1h.
  - Deps: 0.4.4 (reads enrollment band thresholds from archetypeDefaults).

- **E.6.2** — Dashboard surface.
  - Files: extend finance dashboard with scholarship card.
  - Validation: manual.
  - AC: Card visible; threshold-status badge (under/at/over).
  - Deps: E.6.1.

---

## 8. EPIC-F — Generalize (Multi-Pilot Proof)

**Goal:** EdForge proves the framework: a second PABSON school onboards via data-only drop; synthetic GENERIC archetype passes smokes; engine code untouched.

### Sprint F.1 — Two-Pilot Parametric Smoke Matrix
**Demo:** Every smoke that previously ran against `dev-pabson-primary` ALSO runs against Saraswati with `PILOT_ID=pabson-saraswati-bs-2083`; both exit 0.

#### Tickets

- **F.1.1** — Parametric `PILOT_ID` env-var support in all smokes.
  - Files: every `scripts/smoke-tests/pilot-*.ts` accepts `PILOT_ID` env.
  - Validation: each smoke runs against both tenants.
  - AC: All smokes parametric.
  - Deps: prior smokes from A/B/C/D/E.

- **F.1.2** — CI two-pilot smoke matrix.
  - Files: GH Actions config; matrix axes `PILOT_ID` × smoke-name.
  - Validation: CI green.
  - AC: Matrix runs on PR merge.
  - Deps: F.1.1.

### Sprint F.2 — Synthetic GENERIC Archetype Fixture
**Demo:** Same smokes run with `PILOT_ID=generic-synthetic-q2-2026` (archetype=GENERIC, country=USA, currency=USD, calendar=gregorian); all exit 0.

#### Tickets

- **F.2.1** — GENERIC pilot fixture.
  - Files: `packages/pilot-fixtures/pilots/generic-synthetic-q2-2026/` (NEW); metadata + calendar + bell + structure + holidays + programs.
  - Validation: fixture passes schema.
  - AC: Fixture loadable.
  - Deps: 0.4.3 (GENERIC archetype defaults).

- **F.2.2** — GENERIC archetype smoke.
  - Files: all parametric smokes + GENERIC fixture.
  - Validation: all exit 0; finance accepts USD (per 0.2.13); calendar Gregorian.
  - AC: Engine accepts non-PABSON archetype with zero code change.
  - Deps: F.2.1 + 0.2.13.

### Sprint F.3 — Pilot 2 Provisioning + Setup Rehearsal
**Source:** v2 plan K.5.

**Demo:** Pilot 2 PABSON school provisioned in prod with `tenantTag='production'`; operator-led activation via UI mirrors Saraswati 2026-05-18 flow.

#### Tickets

- **F.3.1** — Pilot 2 dossier + fixture.
  - Files: `docs/pilots/<pilot-2-id>/dossier.md` + `packages/pilot-fixtures/pilots/<pilot-2-id>/...`.
  - Validation: fixture passes schema.
  - AC: Dossier follows v1 §13 pilot-dossier contract.
  - Deps: G.1.3 (champion-identified pilot 2 from secondary PABSON school visits).

- **F.3.2** — Pre-flight smoke pack on pilot 2 fixture.
  - Files: re-run F.1.1 smokes with `PILOT_ID=<pilot-2-id>` BEFORE provisioning.
  - Validation: all exit 0.
  - AC: Pilot 2 ready for provisioning.
  - Deps: F.3.1 + F.1.1.

- **F.3.3** — Pilot 2 provisioning.
  - Files: ControlPlane tenant create flow; operator-led activation.
  - Validation: live activation.
  - AC: Tenant live; setup mirrors Saraswati.
  - Deps: F.3.2.

### Sprint F.4 — REMOVED (single-ticket sprint violates per-sprint DoD; folded into H.1.8 gap list)

The generalization retrospective doc that lived here was a single doc-commit ticket — too thin to constitute a sprint. **Folded into Sprint H.1 as part of the H.1.8 gap-list publication**, which already captures lessons learned for the V1 → V1.5 backlog. The retro artifact still ships, just under H.1.8 ownership.

---

## 9. EPIC-G — Operator Feedback Channel — **OPTIONAL / V1.5 per CEO 2026-05-22**

> **Decision rationale (2026-05-22):** This EPIC was originally framed as "operator validation gates engineering design." Reversed: engineering design comes from primary-source research + existing code audit + Allen ISD reference + prior agent research. Operator feedback is an iterative refinement signal we welcome, NOT a precondition for V1 design or build.
>
> - **G.1 (Champion field trip)** — moved to OPTIONAL. If the champion can collect artifacts opportunistically while in Nepal, great. The 🔬 research blockers above (A.2.0, D.4.0, E.1.0) no longer depend on G.1 deliverables; they design from primary sources internally.
> - **G.2 (Weekly operator sync)** — moved to "if a school surfaces a bug or feature gap, it lands in the deferred-work log for the next sprint." No formal cadence; no critical-path coupling.
> - **G.3 (Adoption telemetry)** — DEFERRED V1.5. Measuring adoption on a half-baked product is noise; we ship the complete Nepal-archetype product first, then measure.
>
> **EPIC-G in V1:** zero engineering tickets are blocked on EPIC-G. The EPIC remains documented as a reference for V1.5 work when the product completes.

**Goal (V1.5 unfreeze):** Operator feedback channel established for continuous post-V1 iteration; pilot 2 candidate identified via champion network; adoption telemetry extended from existing partial implementation.

### Sprint G.1 — Champion Field Trip Execution
**Source:** [`edforge-champion-nepal-discovery-brief.md`](./edforge-champion-nepal-discovery-brief.md).

**Demo:** Champion completes Saraswati + 1-2 secondary PABSON school visits; engineering receives filled interview forms + artifact archive + field journal + pilot 2 scouting log.

#### Tickets

- **G.1.1** — Pre-trip prep call (champion + engineering).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/prep-call-notes.md` (NEW).
  - Validation: notes captured.
  - AC: Brief reviewed; consent norms set; engineering questions clarified.
  - Deps: none.

- **G.1.2** — Saraswati on-site visit (champion).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/saraswati-onsite-<date>/` (NEW directory) — interview forms + artifact photos + field journal.
  - Validation: deliverables per discovery brief §9.
  - AC: 6 persona interviews filled; artifacts collected per §5 of brief.
  - Deps: G.1.1.

- **G.1.3** — Secondary PABSON school visits.
  - Files: per-school folder under `docs/pilots/<school-id>/discovery/`.
  - Validation: deliverables per brief §7.
  - AC: 1-2 schools visited; comparison notes filled.
  - Deps: G.1.1.

- **G.1.4** — Debrief call (champion + engineering).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/discovery/debrief-<date>.md` (NEW).
  - Validation: notes captured.
  - AC: Findings mapped to framework §8 open questions; follow-ups identified.
  - Deps: G.1.2 + G.1.3.

- **G.1.5** — Framework update with evidence.
  - Files: `v1-master-framework.md` §8 updated with resolved 🔴 questions; v2 sprint plan Q9/Q10 resolved.
  - Validation: doc updated.
  - AC: At least 5 of 8 open framework questions resolved.
  - Deps: G.1.4.

### Sprint G.2 — Weekly Operator Sync Cadence (until Day-30)
**Demo:** Weekly 30-min call with Saraswati operator; running log of feedback → fast-follow tickets in <1 week.

#### Tickets

- **G.2.1** — Weekly sync calendar invite + agenda template.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/weekly-sync/agenda-template.md` (NEW).
  - Validation: template reviewed.
  - AC: Cadence scheduled.
  - Deps: G.1.5.

- **G.2.2** — Weekly sync log files (one per week, recurring through Sprint H).
  - Files: `docs/pilots/pabson-saraswati-bs-2083/weekly-sync/<YYYY-MM-DD>.md`.
  - Validation: log committed weekly.
  - AC: Issues categorized: fast-follow / sprint-bundle / formal-backlog within 7d.
  - Deps: G.2.1.

### Sprint G.3 — Adoption Telemetry — **EXTEND existing, do NOT reinvent** (v3.2)

**Foundation in place (per CEO 2026-05-22):** Telemetry is already partially implemented. Some emit-site instrumentation exists; CloudWatch metrics for ECS/Lambda/DDB are wired; some adoption-relevant events emit but lack aggregation / per-school dashboard.

**🔬 PRE-SPRINT RESEARCH BLOCKER — G.3.0:** Before G.3 starts, the engineer inventories what telemetry already exists:
- Audit existing emit-sites: `grep -rn 'session\|portal_opened\|user_activity\|track' server/application/microservices/identity/src/`.
- Audit existing CloudWatch metrics: `aws cloudwatch list-metrics --namespace EdForge/* --region ap-south-1`.
- Audit existing dashboard config: `server/lib/observability/`.
- Audit frontend telemetry hooks: `grep -rn 'trackEvent\|analytics\|telemetry' edforge-saas-frontend/`.
- **Output**: `docs/pilot-greenlight/g3-telemetry-inventory-2026-MM.md` listing (a) what exists, (b) what's missing, (c) the minimum-delta plan. Tickets G.3.1+ are scoped against this inventory.
- **Deps**: none (read-only audit).

**Demo (after G.3.0 + inventory-driven tickets):** Daily-active operator count, sessions-with-write count, parent-portal-open rate visible on existing-or-extended dashboard.

#### Tickets (scope determined by G.3.0 inventory)

- **G.3.1** — Adoption-telemetry events GAP fill (per inventory).
  - Files: identified by G.3.0 (likely `microservices/identity/src/telemetry/`-something existing OR `users.service.ts` extension). NOT a NEW service.
  - Validation: integration: each event emits + lands in event-log (or existing telemetry sink).
  - AC: All adoption-relevant events emit; G.3.0 inventory's "missing" list is closed.
  - Deps: G.3.0.

- **G.3.2** — CloudWatch dashboard extension (per inventory).
  - Files: extends existing `server/lib/observability/` (NEW only if no existing dashboard config exists per G.3.0).
  - Validation: `cdk synth` + deploy; dashboard visible.
  - AC: DAU + WAU + write-count per persona; parent-portal-open rate.
  - Deps: G.3.1.

---

## 10. EPIC-H — Product Completeness Gate + Production Readiness (v3.3)

> **Reframed 2026-05-22:** Originally "Saraswati Greenlight + 30-day hypercare." Per CEO direction, V1 is gated on **product completeness for the Nepal archetype**, not on a single school's operational sign-off or adoption-metric thresholds. Operator stamps and 30-day hypercare are V1.5 / pilot-2 / post-V1-launch concerns. V1's H gate proves: (a) the engineering is complete, (b) compliance MVP exists, (c) the generalization smoke proves archetype-agnostic, (d) end-to-end synthetic + dev-tenant smoke passes.

**Goal:** V1 product completeness validated against synthetic + dev-tenant data; production readiness checklist closed; ready to natural-adoption-onboard new pilot schools without engineering blockers.

### Sprint H.1 — Saraswati Real-Operational Evidence (post-Phase-D)
**Source:** v2 plan H. Capture 1 week period attendance + 1 Term-1 exam-flow + 1 result-publish + cross-year promotion evidence.

#### Tickets

- **H.1.1** — Operator-data verification on Saraswati.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/h-rehearsal-evidence/` (NEW dir).
  - Validation: evidence captured.
  - AC: Operator signs off on data correctness; Term-1 evidence real OR synthetic-with-annotation per v2 plan AC.
  - Deps: A.3.11 + A.4.7 + D.4.9 + D.5.7.

- **H.1.2** — Merge-mode regression audit.
  - Files: `h-rehearsal-evidence/merge-mode-audit.md`.
  - Validation: query Saraswati CalendarDate rows; identify operator-edits; verify they survived post-2026-05-18 regenerations.
  - AC: Operator-edits intact; C3.8 merge-mode contract holds in real prod.
  - Deps: H.1.1.

- **H.1.3** — IEMIS dry-run sign-off.
  - Files: `h-rehearsal-evidence/iemis-dry-run.md`.
  - Validation: operator + EdForge inspect CSV; discrepancies resolved.
  - AC: Sign-off; CSV submission-ready.
  - Deps: E.1.8.

- **H.1.4** — Tenant-export rehearsal on Saraswati.
  - Files: `h-rehearsal-evidence/tenant-export.md`.
  - Validation: G.3 against Saraswati; zip inspected.
  - AC: Zip complete; operator signs off.
  - Deps: E.3.1 + E.5.1.

- **H.1.5** — Prod-shadow rehearsal on fresh `tenantTag=internal-dev`.
  - Files: deploy log in `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}`.
  - Validation: provision fresh dev tenant; run setup steps + teardown.
  - AC: Prod-account provisioning + reporting + export validated; teardown clean.
  - Deps: F.3.3.

- **H.1.6** — Audit + event-log completeness review.
  - Files: `h-rehearsal-evidence/audit-completeness.md`; query report.
  - Validation: query event-log for Saraswati tenant; assert every write has audit + event.
  - AC: Zero unaudited writes or unemitted events; resolved before sign-off.
  - Deps: B.4.1.

- **H.1.7** — Demo video.
  - Files: `h-rehearsal-evidence/rehearsal-walkthrough.mp4`.
  - Validation: captures H.1.1–H.1.6.
  - AC: Video archived; dossier index updated.
  - Deps: H.1.1–H.1.6.

- **H.1.8** — Gap list publication.
  - Files: `h-rehearsal-evidence/gap-list.md`.
  - Validation: any unresolved gap → backlog ticket.
  - AC: Gap list reviewed + signed off.
  - Deps: H.1.7.

### Sprint H.2 — Greenlight Gate (V1 GA Decision) — NOT A NORMAL ENGINEERING SPRINT
**Note:** This is the V1 GA decision gate, not a sprint of engineering tickets. The five "stamps" below are documentation + sign-off artifacts whose underlying engineering is already ticketed across EPICs A–G. Treat H.2.1–H.2.5 as **gate evidence checklists**, not implementation tickets. Sprint demo = the V1 GA call itself.

**Gate criteria:** Five Green gates from framework §9 all hold; user authorizes V1 GA.

#### Tickets

- **H.2.1** — Engineering Green checklist.
  - Files: `h-rehearsal-evidence/engineering-green-checklist.md`.
  - Validation: all items checked.
  - AC: Engineering signs off.
  - Deps: H.1.8.

- **H.2.2** — Operator Green stamp.
  - Files: `h-rehearsal-evidence/operator-green-stamp.md`.
  - Validation: Saraswati operator's signed statement.
  - AC: Operator signs off.
  - Deps: G.2.x + H.1.8.

- **H.2.3** — Compliance Green stamp.
  - Files: `h-rehearsal-evidence/compliance-green-stamp.md`.
  - Validation: Flash I/II + residency + consent + discipline checks pass.
  - AC: Compliance signs off.
  - Deps: E.1.7 + E.3.3 + E.4.2 + E.5.1.

- **H.2.4** — Adoption Green stamp.
  - Files: `h-rehearsal-evidence/adoption-green-stamp.md`.
  - Validation: G.3.2 dashboard meets thresholds.
  - AC: Adoption signs off.
  - Deps: G.3.2.

- **H.2.5** — Generalization Green stamp.
  - Files: `h-rehearsal-evidence/generalization-green-stamp.md`.
  - Validation: F.2.2 + F.3.3 pass.
  - AC: Generalization signs off.
  - Deps: F.2.2 + F.3.3.

### Sprint H.3 — 30-Day Hypercare
**Source:** v2 plan I.

**Demo:** Saraswati live for 30 days. Hypercare runbook in place. Day-30 retro committed.

#### Tickets

- **H.3.1** — Operator-led onboarding session (recorded).
  - Files: `c13-launch-artifacts/onboarding-session.mp4`.
  - Validation: recorded.
  - AC: Operator completes daily ops independently.
  - Deps: H.2.x.

- **H.3.2** — Day 0-7 observability daily check.
  - Files: `c13-launch-artifacts/week-1-checks.md`.
  - Validation: daily check artifacts.
  - AC: No P0/P1 in week 1.
  - Deps: H.2.x.

- **H.3.3** — Day 8-30 hypercare triage queue.
  - Files: `c13-launch-artifacts/hypercare-queue.md`.
  - Validation: triage queue empty by day 30 OR each item tracked.
  - AC: Queue managed.
  - Deps: H.3.2.

- **H.3.4** — Day 30 retrospective.
  - Files: `c13-launch-artifacts/day-30-retro.md`.
  - Validation: retro committed.
  - AC: Lessons → backlog.
  - Deps: H.3.3.

- **H.3.5** — Sign-off log update in dossier.
  - Files: `docs/pilots/pabson-saraswati-bs-2083/dossier.md` "Sign-off log".
  - Validation: dossier updated.
  - AC: All gates green in dossier.
  - Deps: H.3.4.

---

## 11. Risk Register — v2 carry-over + new

### 11.1 v2 plan §10 R1–R21 carry-over with explicit mitigation-ticket mapping

| v2 ID | Risk | v3 mitigation ticket(s) |
|---|---|---|
| R1 | School opens <14 days; D1 frontend slips | Sprint A.1 sized small; A.1.x can ship after 0.2.7 lint without blocking other A sprints |
| R2 | Principal continues IEMIS uploads while ENG-2 unshipped → backfill scope compounds | 0.1.1 → 0.1.2 → 0.1.3 lock-ordered (Sprint 0.1) |
| R3 | F2 (IEMIS) deadline mid-2026 before F1 ready | Resolved 2026-05-19 (flexible); document in pilot dossier per G.1.4 |
| R4 | `dev-pabson-primary` SchoolConfiguration regression hides demo bugs | 0.2.14 audit; reframed as DoD checklist item, runs pre-EPIC-A demo |
| R5 | shared-types caret-pin drift breaks Docker build | §1.4 + §1.5 enforce; per-sprint DoD checklist |
| R6 | EventBridge Lambda cold-start on result Lambda causes >30s SLA breach | A.4.3 cold-start budgeted ≤45s; DLQ + alarm |
| R7 | Operator hypercare UTC+5:45 on-call not staffed | G.2 weekly sync + H.3 hypercare scheduling; framework §8 open question for product |
| R8 | K.2 invariant-13 grep finds late-stage drift | NEW F.0.1 — Weekly invariant-13 audit cron starting at EPIC-D kickoff |
| R9 | Module-wiring spec skipped on new modules | §1.4 + §1.5 enforce; 0.3.2 establishes academics pattern |
| R10 | Finance NPR-literal residue breaks F.2.2 GENERIC | 0.2.13 (relocated to Sprint 0.5 — finance widen) lands before F.2.2 |
| R11 | IEMIS job janitor missing → stuck-running invisible | 0.1.4 janitor |
| R12 | Cognito 1h JWT TTL shorter than CDK+ECS roll | DoD: capture JWT just before smoke; documented in §1.4 sprint DoD |
| R13 | Two-repo git hygiene violation | DoD: explicit `cd <repo>` per git command; CLAUDE.md house rule enforced at PR review |
| R14 | Saraswati operator surfaces Phase-D issue mid-sprint | G.2 weekly sync + in-sprint fast-follow PR budget |
| R15 | Pilot 2 candidate not identified before F.3 | G.1.3 scouting; F.3.1 dep on G.1.3 |
| R16 | Saraswati AY 2083 calendar operator edits won't survive future regenerate | H.1.2 merge-mode audit |
| R17 | Academics has no `auditedWrite()` infrastructure | Sprint 0.3 (0.3.1–0.3.5) ports + migrates |
| R18 | All ~30 academics events PascalCase, unvalidated | Sprint B.2 (B.2.1–B.2.3) migration |
| R19 | Academics has no `module-wiring.spec.ts` | 0.3.2 ships |
| R20 | No timetable entity; period attendance over-scoped | A.5 deferred to V1.5; Saraswati runs class-teacher-takes-morning-attendance for Term 1 |
| R21 | Discipline / Behavior module absent | E.2 (soft per CEO 2026-05-20) |

### 11.2 New risks introduced by this v3 breakdown

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R22 | Track D-Plan `ExternalAssessment` family entities slip; BLE workflow blocks | M | H | Sprint D.3 lands BEFORE D.4 (BLE) attempts use |
| R23 | ~~Document Rendering Lambda cold-start breaches latency budget~~ → **CLOSED 2026-05-24** by EPIC-C plan revision | ~~M~~ → 0 | ~~M~~ → 0 | **Renderer choice swapped from Puppeteer+Handlebars to `@react-pdf/renderer` (no Chromium layer). Sync endpoints run in-container (zero cold start). Batch Lambda cold-start ~500ms vs prior ~5s. Provisioned-concurrency escape hatch no longer needed.** See [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md) §2 for full reasoning. |
| R24 | `archetypeDefaults` entity (0.4) slips, blocks all of EPIC-D | H if 0.4 deferred | H | Make 0.4 hard-dep before any D sprint starts |
| R25 | School branding asset bucket per-tenant scope mismatch with tenant-template-stack-basic CDK | M | M | C.1.3 reviews CDK pattern; may need pivot to shared bucket with prefix |
| R26 | Champion field trip surfaces requirement that's V1-blocking | M | H | G.1.4 debrief surfaces; framework §8 update; bundled into next sprint |
| R27 | Messaging microservice ECS service consumes capacity in `prod-basic` cluster | L | L | B.1.1 deploys; monitor; scale up if needed |
| R28 | PABSON pre-board marks-feed-term-grade decision unknown until G.1 | M | M | D.5.6 ships configurable per-school; defaults per archetype |
| R29 | Cross-year handoff (D.2.7–D.2.12) attendance preservation across `gradeLevel` rewrite breaks invariant 3 | M | H | D.2.10 explicit guard test; H.1.x evidence sprint validates pre-Greenlight |
| R30 | C.4.1 admit-card template's `RenderContext` shape locks before D.4 entities are finalized; rework risk | M | M | C.4.1 ships data-shape schema; D.4.4 / D.5.3 wire entity → template at integration time (cycle broken) |
| R31 | EPIC-B deferral leaves Saraswati's parent-communication channel as WhatsApp/diary/phone; pilot 2 might demand messaging earlier | M | L | Frontend Messages MFE exists with mock data; EventBridge bus + DLQ already shipped (C0.c). EPIC-B can be re-prioritized as a V1.5-fast-follow if F.3 (pilot 2) signals demand. Adapter interface for SMS stubbed for future drop-in. |
| R32 | 🔬 pre-execution research blockers (A.2.0, D.4.0, E.1.0, G.3.0) skipped by engineer; ticket-as-written proceeds without ground-truth | M | M | ✅ **3 of 4 RESOLVED 2026-05-22** via internal research artifacts (§16). G.3.0 V1.5-deferred. §1.8 PR-review rejection rule remains for V1.5 onwards. |
| R33 | Reinvent-the-wheel: engineer creates NEW Subject entity when extending Course suffices; NEW telemetry service when existing emit-sites are extendable | M | M | ✅ **CLOSED 2026-05-22** for Subject case — A.2.0 research chose Option B (extend Course). §1.7 Build-on-existing inventory + §1.8 🔬 markers force "audit-before-build" continues to apply. |
| R34 | IEMIS Excel header-text strings drift from research-time snapshot when CEHRD updates portal templates | M | M | E.1.2 S3-versioned JSON config lets us hotfix headers without backend redeploy. First Saraswati upload attempt is the validation event. Mitigation pre-shipped via schema versioning design. |
| R35 | Grades 1-3 integrated/thematic curriculum unsupported in V1 (deferred to V1.5 per A.2.0 §1.1) — if a pilot school enrolls K-3 cohort in V1, gradebook is unusable for that band | L | M | Saraswati operates Grades 4-10 only in V1 — not pilot-blocking. Pilot 2 candidate selection (G.1.3) should confirm no K-3 dependency before onboarding. V1.5 LearningStandardGrade backlog item #1 from §17.2. |
| R36 | MunicipalityConfig placement on SchoolConfiguration assumes 1 school = 1 municipality; PABSON school chains with school-branches across municipalities might mismatch | L | L | E.0.2 audits: SchoolConfiguration is per-school (`SCHOOL#{schoolId}#CONFIG`). Any chain operating across municipalities provisions one SchoolConfiguration per school. Mitigation built into entity design. |
| R37 | Pre-flight validation Lambda timeout on very-large tenants (5000+ students) | M | M | E.1.5 budgets <30s synchronous response for 1000-student tenant; for 5000+, fallback to async pattern (return jobId + poll for result, same as IEMIS import pattern). Sprint-kickoff decision when first pilot 2 candidate is sized. |
| **R38** | **D.1.1 mapper serializer omits `gpaScale` + entry-level `isPassing`/`isTerminalFail?`/`displayName?` from `GradingPolicyResponseDto`** | L | M | Discovered 2026-05-22 during Sprint D.1 post-deploy probe on dev-pabson Saraswati legacy policy. Runtime entity carries the fields; mapper drops them. Impact: AdminWeb cannot render the `NG` Not-Graded sentinel flag, cannot show gpaScale, cannot show passing-threshold per-letter. **Mitigation:** ~10 LOC fix to `grading-policy.mapper.ts` + DTO interface in next PR; runtime correctness already preserved (gpa-calc reads gpaScale directly via `getDefaultPolicyEntity`); deferred-work entry tracked. |
| **R39** | **Workspace-only npm packages (`"private": true`) cannot ship in any ECS Docker build — same publish-gate trap that hit AdminWeb (CLAUDE.md), now hits academics ECS** | M | M | Discovered 2026-05-22 during Sprint D.1 academics ECR build; PR #149 fix. Dockerfile pattern: copy single `server/application/package.json` → `npm install` from registry. Workspace symlinks invisible to `npm install`; any `@edforge/*` private package import fails build. **Mitigation:** inline the helper into the ECS service's own source tree (academics now has `tenant-metadata-reader.service.ts`); the workspace package stays useful for Lambda consumers (esbuild resolves workspaces at synth). **Pre-merge lint TODO** (B0.1 backlog): grep PR for `@edforge/*` imports in any `microservices/*/src/` path and warn if the imported package's `package.json` has `"private": true`. |
| **R40** | **`tenant-api-prod.json` changes need `cdk deploy shared-infra-stack` — sprint plans tend to miss it in the deploy ladder; smoke fails with 403 SigV4** | M | H | Discovered 2026-05-22 during Sprint A.3 Phase 3 smoke (P1 returned `403 SigV4` after Phase 2 ECR+ECS roll completed). The 8 new `/academics/exams*` paths reached the repo but never deployed to live API Gateway. **Root cause:** sprint plan §7 deploy ladder listed ECR + ECS only; CLAUDE.md change-to-deploy matrix is explicit ("API Gateway route → `shared-infra-stack` → wrapper") but the sprint plan template didn't enforce it. **Resolution:** `cdk deploy shared-infra-stack` (223s) added as a Phase 2 follow-up step; 8 paths went live; smoke 11/11 green on retry. **Forward rule:** §1.5 implicit-Files contract + §13 per-sprint DoD updated to flag this. Every sprint that modifies `tenant-api-prod.json` MUST list `shared-infra-stack` redeploy in its plan §7. |
| **R41** | **`shared-infra-stack` CloudFormation template at 87.7% of 1MB hard limit** → 🟢 **CLOSED 2026-05-23.** Template recovered to ~6% of ceiling. | H → 0 (closed) | H → 0 (closed) | **Fix:** `ApiDefinition.fromAsset()` (CFN gets BodyS3Location pointer instead of inline Body) + API Gateway Stage variables for the 3 deploy-time-dynamic placeholders (NLB DNS, VPC Link ID, authorizer Lambda function name) — region/account stay literal at synth (API GW rejects stage vars in those slots of authorizerUri). Shipped via PR [#169](https://github.com/shoaibrain/edforge/pull/169) (initial) + [#170](https://github.com/shoaibrain/edforge/pull/170) (hotfix1: env-bind region/account) + [#171](https://github.com/shoaibrain/edforge/pull/171) (hotfix2: Option A pivot after attempt 2 failed at cross-stack export protection; removes explicit Lambda functionName to avoid replacement). Deploy attempt 3 succeeded in 60.8s. **Post-deploy Layer 2 evidence:** 0 non-MODEL structural diffs; Stage.Variables map has 3 keys resolved correctly; existing Lambda untouched (LastModified preserved); TenantApiAuthorizerArn export value unchanged → analytics-stack import preserved. **Layer 3 cross-domain smoke:** 15/15 routing-success (2 smoke-script bugs on non-existent paths since corrected; 1 pre-existing backend 500 on /tenants/{tenantId} that doesn't affect routing). **D.2/D.3/D.4/D.5/D.6/C-series all unblocked.** Plan + retros at `docs/pilot-greenlight/cfn-headroom-sprint-plan.md` (§0.2 + §0.3 + §0.4). Memory: `project_sprint_r41a_shipped_prod`. New CLAUDE.md rule added: "Cross-stack export change pre-flight" (audit `aws cloudformation list-imports --export-name <X>` before every cdk deploy of a stack with exported Outputs). |
| **R42** | **ExamScore `studentId='unknown'` placeholder when enrollment FK lookup fails (single-write) or is skipped (bulk handler)** | (accepted V1) | M | Discovered 2026-05-22 during Sprint A.3 Phase 2 implementation + verified via Phase 3 smoke. Single-write `recordScore()` attempts GSI lookup of enrollment but falls back to `'unknown'` on miss; bulk handler skips the lookup entirely for performance. **Impact:** ExamScore rows have `studentId='unknown'` → GSI2 student-centric (`student#{studentId}`) collapses to a single `student#unknown` partition for bulk-written scores. Cross-AY transcript queries by studentId won't surface them. **Mitigation:** A.4 ResultCard aggregation joins ExamScore + ExamCourse → ResultCard rows by `enrollmentId`, then ResultCard carries the correct `studentId` from enrollment. A.4 design MUST handle this. **Forward rule:** A.4 sprint plan must include a backfill or aggregation step that resolves studentId via enrollmentId for any ExamScores written under A.3. ✅ **A.4 Phase 2 closed** (shipped 2026-05-23 via #163): `TermAggregationService.aggregateTermResults` resolves studentId from Enrollment map by enrollmentId; `resultCardResponseSchema.studentId = z.string().uuid()` rejects 'unknown' at schema layer; spec asserts. |
| **R43** | **Sprint creating a new NestJS module in a service without `module-wiring.spec.ts` MUST ship the spec in the same PR; deferring it to a later sprint has cost prod 3 times (S0 + C4 identity, A.4 academics)** | (resolved for academics; finance + rproxy still uncovered) | H if missed | Sprint A.4 Phase 2 ([PR #162](https://github.com/shoaibrain/edforge/pull/162)) created `ResultsModule` for academics. Academics had no module-wiring spec (Sprint 0.3 scope, deferred). ResultsModule declared `PermissionGuard` but omitted `IdentityClientService` (the guard's constructor dep). Nest bootstrap failed → ECS crash loop ~4h until rollback (12:09 UTC) + hotfix (12:55 UTC [PR #163](https://github.com/shoaibrain/edforge/pull/163)). **Mitigation:** PR #163 adds the missing provider AND ships `academics/__tests__/module-wiring.spec.ts` (43 assertions across all 11 PermissionGuard-consumer modules; mirrors identity spec pattern from S0 retro). Memory `feedback_module_wiring_invariant` broadened to cover all services. **Forward rule:** any sprint plan §3 file list containing `*.module.ts` for a service whose `__tests__/module-wiring.spec.ts` doesn't yet exist treats the spec as a Phase 2 deliverable, NOT a deferral. Finance + rproxy module-wiring specs are V1.5 backlog. |
| **R44** | **Result-batch Lambda `cardId` is non-deterministic (`uuid()` per invocation); EventBridge at-least-once redelivery produces duplicate ResultCard rows instead of being caught by `attribute_not_exists` idempotency guard** | (accepted V1; visible in smoke evidence) | M | **Live smoke evidence 2026-05-23 17:25 UTC:** A.4 Phase 4 generated 20 ResultCards for 10 enrollments — Lambda fired twice (EventBridge at-least-once), each invocation called `uuid()` for cardId → distinct entityKeys → `attribute_not_exists(entityKey)` guard didn't catch. Operator sees 2× expected cards per closed exam. **Impact:** non-blocking for V1 Saraswati pilot (operator can manually soft-delete duplicates), but cognitive noise grows linearly with exam closures. **Fix:** derive `cardId` deterministically from hash of `(tenantId, examId, enrollmentId)` — re-fires produce identical keys → `attribute_not_exists` correctly skips. ~10 LOC change in `handler.ts:buildResultCardItem`. **V1.5 backlog** (or fast-follow hotfix if operator load is high). |

### 11.3 New risks introduced by EPIC-C revision (2026-05-24)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R45** | **`@react-pdf/renderer` v3 Devanagari (Nepali) font shaping defect** — complex script ligatures or conjuncts mis-render for specific Nepali codepoints; discovered only in production | M | M | C.0.2 ships snapshot-test suite of common Nepali phrases ("बिल" / "रसिद" / "उप-योग" / "जम्मा रकम") as the canary. Library exports `validateDevanagari(text)` utility for template-save validation (flags unsupported codepoints). Fallback: admin opts back to English-only labels via the editor (graceful degradation). |
| **R46** | **Cross-stack CFN export collision** if PDF bucket / Lambda outputs are exported and consumed by other stacks; future renames break with `Cannot update export ... in use by <stack>` per R41 pattern | L | H | C.0.6 + C.4.1 use env-var pattern for bucket names (no CFN export). Per CLAUDE.md "Cross-stack export change pre-flight" rule. |
| **R47** | **`@aibrains/pdf-renderer` caret-pin trap** — finance/academics/identity/frontend pin different minor versions; lockstep upgrade misses one consumer → Docker build fails per [[edforge-shared-types-caret-pin]] | M | M | Every C.* ticket's Files: line lists all 4 consumer `package.json` pin bumps explicitly. CLAUDE.md publish-gate checklist applies to each minor bump. AdminWeb jsdom sim runs per bump. |
| **R48** | **Lazy-default vs saved-template drift** — descriptor adds a new field; existing saved templates don't have it; render fails or rendered output looks wrong | M | L | Every descriptor field has Zod `.default()`. On read, saved config is merged OVER descriptor defaults (`{...defaults(...), ...saved}`) — missing keys fall back. Schema-evolution test in C.0.4 covers new-field addition. |
| **R49** | **Logo asset orphaning** — admin uploads logo v1 → publishes template v1 → uploads logo v2 → publishes v2. Logo v1 still referenced by historical documents but no longer by current. S3 lifecycle can't detect → permanent storage cost growth | L | L | Logo S3 keys version-pinned (`logos/{templateId}/{uuid}.{ext}`). No auto-cleanup in V1. V1.5 op: manual sweep when template archived AND no documents reference. Acceptable storage cost growth (~MB/year per active school). |

---

## 12. Dependency graph (v3.4 — research-resolved concrete decisions)

```
EPIC-0 (Foundation)
├── 0.1 + 0.2 — parallel; bug fixes + invariant infrastructure
├── 0.3 — Academics audit infra
└── 0.4 — ArchetypeDefaults (hard-dep for all EPIC-D)
                ↓
EPIC-A (Operate, no A.5)        EPIC-D (Plan)                                  EPIC-C (Distribute — revised 2026-05-24)
├── A.1 — Dashboard polish     ├── ✅ D.1 — GradingPolicy plug (incl. NG)      ├── ⏳ C.0 — @aibrains/pdf-renderer + Branding (NEW Phase 0)
├── ✅ A.2 — Course extension  ├── ✅ D.2 — PromotionRule (shipped 2026-05-24) ├── C.1 — Invoice + Receipt PDF MVP (no editor)
│   (A.2.0 resolved → Option B)│   D.2.7-12 — Cross-year handoff               ├── C.2 — Template Editor (Shell-level)
├── ✅ A.3 — Exam (←A.2 + D.1) ├── ✅ D.3 — ExternalAssessment fam (shipped 2026-05-24) ├── C.3 — Report Card (uses A.4 ✅)
└── ✅ A.4 — Result            ├── ⏳ D.4 — BLE (research ✅; 9 tickets        ├── C.4 — Batch generation (Lambda + SQS-free)
                               │   incl. supplementary D.4.7)                  └── C.5 — Admit Card data-shape (D.4/D.5 wire integration)
                               ├── D.5 — SEE (light supplementary at kickoff)
                               └── D.6 — NEB-11/12 (incl. Grade Increment D.6.5)
                ↓
EPIC-E (Comply)
├── ✅ E.0 — Schema extensions (NEW v3.4: hasEcedExperience + municipalityConfig + scholarshipAmountNpr)
├── ✅ E.1 — Flash I/II MVP (E.1.0 resolved; 8 tickets incl. pre-flight validation E.1.5)
├── E.2 — Discipline soft
├── E.3 — Residency assertion (Mumbai AWS confirmed)
├── E.4 — Consent capture
├── E.5 — Tenant export
└── E.6 — Scholarship quota (nice-to-have)
                ↓
EPIC-F (Generalize — product-completeness proof)
├── F.1 — 2-pilot parametric smoke matrix
├── F.2 — Synthetic GENERIC archetype smoke
└── F.3 — Pilot 2 provisioning rehearsal (operationally driven; not V1-blocking)
                ↓
EPIC-H (Product Completeness Gate)
├── H.1 — End-to-end synthetic + dev-tenant verification
├── H.2 — Product-Completeness stamps (engineering + compliance + generalization; no operator + adoption gates)
└── H.3 — Production readiness checklist (no 30-day hypercare gate in V1)


[V1.5 DEFERRED — DO NOT EXECUTE FOR V1]
EPIC-B (Communicate) — Messaging + Parent Inbox + SES + Notice
EPIC-A.5 — Period attendance + Timetable + Substitute
EPIC-D.7 — StudentAcademicTrack
EPIC-G — Operator feedback channel + champion field trip + adoption telemetry
  └── Operator feedback STILL accepted continuously as iterative refinement signal,
      but no formal cadence, no engineering tickets blocked on it.
+ v3.4 backlog: K-3 LearningStandardGrade (Grades 1-3 integrated curriculum);
                subjectArea enum removal (post-A.2 dual-write retirement);
                Caste catalog entity with named values
```

**v3.4 hard-dep notes:**
- **E.0 lands before D.4 and E.1** — E.0.2 (`municipalityConfig` on SchoolConfiguration) is a FK target for the v3.4.1-expanded D.3.1 entity and a render input for D.4.5 admit cards
- **D.1 must land before D.4.6 / D.4.7** — D.4 result-import + supplementary write `NG` letter-grade rows; D.1 GradingPolicy MUST include `NG` in its seed (D.1.3) per v3.4.1
- **A.2 lands before A.3, A.4, D.3** — A.2.0 resolved as Course extension; A.3.3 `ExamCourse` + A.4.2 `ResultCard.courseScores[]` + D.3.x entities all FK against `Course.courseId`
- **✅ A.3 (Exam) shipped — A.4 now fully unblocked.** Hard deps A.3 + D.1 both ✅; A.4 Result Subsystem can start immediately. A.4 design MUST address R42 (ExamScore.studentId='unknown' resolution via enrollmentId join in term-aggregation).
- **✅ A.2 + 0.4 done — D.3 (ExternalAssessment family) also unblocked.** D.3.0 `RubricCategory.academicSubject` references A.2.1 descriptor; D.3.1-D.3.6 entities FK against Course. D.3 can run parallel with A.4.

**Critical-path summary (V1 product completeness):** 0 → (A.1 + D.1 + D.2 + C.1 + C.2) → (A.2 + A.3 + A.4 + C.3 + C.4) → (D.3 + D.4 + D.5 + D.6) → D.2.7–12 cross-year → E.1 + E.3-E.6 → F.1 + F.2 → H.1 → H.2 (gate) → H.3 (production readiness) = **V1 product complete**. **EPIC-B + EPIC-G + A.5 + D.7 NOT on critical path.**

**Parallel-eligible (corrected from v3.0; EPIC-C revised 2026-05-24):**
- EPIC-G.1 runs in parallel with EPIC-0 ✓
- EPIC-B and EPIC-A: independent (run in parallel) ✓
- **EPIC-C.0 + C.1 + C.2 + C.3 parallel with EPIC-D.4 + D.5 + D.6** ✓ (revised — no D.x dependency for V1 doc types Invoice/Receipt/Report Card)
- EPIC-C.4 (batch) depends only on C.0+C.1+C.3 (intra-EPIC) — no EPIC-D dep
- **EPIC-C.5 (Admit Card) interleaves with EPIC-D.4/D.5** — C.5.1 ships AdmitCardPdf data-shape (no entity dep); D.4.4 / D.5.3 wire BLE/SEE entity → render endpoint. Sequencing: C.5.1 → D.4.x / D.5.x → D.4.4 / D.5.3.
- EPIC-E.1 cannot start until C.5 evidence + C.1 branding (E.1.2 template depends on G.1.2 sample) — re-stated.
- EPIC-F.2 cannot start until 0.2.13 (relocated finance widen) ships.

---

## 13. Definition of Done — All Levels

### Per ticket
- [ ] Files changed match listed Files
- [ ] Validation passes (test or documented manual procedure)
- [ ] AC reviewer-checkable (no "tested locally")
- [ ] All architecture invariants (§4 of v1 plan) preserved
- [ ] Audit + event paired (Sprint 0.2.7 lint enforces)
- [ ] Three-way route registration (Nest + tenant-api-prod.json + nginx.template) verified if new endpoint
- [ ] If shared-types changed: minor bump + npm publish + AdminWeb jsdom sim
- [ ] If new NestJS module: module-wiring spec updated SAME PR
- [ ] If new GSI: gsi-inventory.md updated BEFORE CDK deploy
- [ ] Invariant 13 grep returns zero hits
- [ ] PR description references ticket ID (e.g., `D.4.1 — BLE registration endpoint`)

### Per sprint
- [ ] Every ticket meets per-ticket DoD
- [ ] Sprint demo recorded (or run live) against pilot dev tenant or Saraswati
- [ ] Private deploy evidence summarized in ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/INDEX.md for prod-touching actions
- [ ] **If sprint modifies `tenant-api-prod.json` (any new/changed @Get/@Post/@Patch/@Delete path): `cdk deploy shared-infra-stack` executed post-merge** (per R40; CLAUDE.md change-to-deploy matrix). Smoke fails with `403 SigV4` if this step is skipped. Sprint plan §7 (deploy ladder) MUST list this step explicitly when applicable.
- [ ] No regressions in prior sprints' smokes (regression bundle re-run)
- [ ] Closeout note added to docs/pilot-greenlight/sprint-closeouts.md
- [ ] Risk register updated if new risks surfaced
- [ ] Open questions resolved or escalated to framework §8

### Per EPIC
- [ ] Every sprint within EPIC meets per-sprint DoD
- [ ] EPIC-level smoke (the demoable goal) verified
- [ ] Master framework (`v1-master-framework.md`) §2.1 status updated
- [ ] If EPIC-D: invariant 12 + 13 lint passes (no archetype-bleed or pilot-name in code)
- [ ] If EPIC-A or EPIC-D: parametric smoke matrix green on Saraswati + dev-pabson-primary
- [ ] If EPIC-F: synthetic GENERIC archetype smoke green

### Per V1 (Product Completeness Gate — v3.3)

V1 is **"done"** — the Nepal-archetype product is complete and ready for natural adoption — when ALL of the following hold:

- [ ] All V1 EPICs meet per-EPIC DoD (EPIC-0 + EPIC-A excl. A.5 + EPIC-C + EPIC-D excl. D.7 + EPIC-E + EPIC-F + EPIC-H)
- [ ] All V1 🔬 research blockers (§16) resolved via internal research artifacts committed to repo
- [ ] Two-pilot parametric smoke matrix green: Saraswati + `dev-pabson-primary` (every smoke from EPICs A/C/D/E exits 0 with both `PILOT_ID` values)
- [ ] Synthetic `GENERIC` archetype smoke green (proves archetype-agnostic engine)
- [ ] Invariant 12 grep clean: `grep -rn 'archetype' server/application/microservices/*/src/` returns zero hits outside boundary-driver registry
- [ ] Invariant 13 grep clean: `grep -rni 'saraswati\|pabson-saraswati\|sseeb' server/application/microservices/*/src/ packages/shared-types/src/ client/ edforge-saas-frontend/ scripts/smoke-tests/` returns zero hits (excluding pilot-id env-var defaults)
- [ ] All P0/P1 risks (R1-R30) closed or explicitly accepted
- [ ] CloudWatch invariants on `dev-pabson-primary` for 7 consecutive days: zero `INVALID_PAYLOAD`, zero unhandled 5xx on greenlight-path endpoints, p95 < 1.5s on operator queries
- [ ] No EPIC-B / A.5 / D.7 V1.5 deferrals are accidentally on critical path
- [ ] Documentation: each Nepal-archetype workflow has a one-page operator guide (BLE flow, SEE flow, NEB-11/12 flow, term-end results flow, monthly billing flow, IEMIS Flash submission flow)

**Operator + adoption signals (Pilot 2 onboarding, hypercare metrics, parent-portal-open rate, etc.) are V1.5+ concerns.** V1 ships when the product is complete; adoption follows naturally.

---

## 14. What this breakdown deliberately does NOT include

- Tickets that pre-date EPIC-0 (Phase A/B/C — already shipped per v1 plan §0.5)
- Mobile apps (V2 per CEO)
- SMS provider integration (V2; adapter interface stubbed in B.5.2)
- Allen-ISD-specific entities (Endorsements, ARD/IEP, GT, CTE clusters, Performance Acknowledgements, Distinguished Achievement)
- LMS / lesson-plan / content-delivery features
- HR / payroll
- Transport route management
- Public APIs for 3rd-party integrations
- Multi-language UI (deferred V1.5)
- Real-time IEMIS portal API (V1 stays at CSV export)
- Biometric attendance integration (V2)
- Master schedule auto-generator (V1.5)

---

## 15. Ticket count summary (v3.4 — research-resolved concrete decisions, 2026-05-22)

| EPIC | Sprints | V1 Tickets | V1.5 Tickets (deferred) | Notes |
|---|---|---|---|---|
| EPIC-0 | 4 | 25 | 0 | Foundation hardening + ArchetypeDefaults |
| EPIC-A | 4 (excl A.5) | 18 | 10 | A.5 V1.5 per CEO 2026-05-19; A.2 same ticket-count, but tickets pivoted to Course extension (A.2.0 resolved) |
| **EPIC-B** | **6** | **0** | **19** | **ALL DEFERRED V1.5 — premature optimization** |
| EPIC-C | 6 | **24** | 0 | **Revised 2026-05-24** — renumbered C.0–C.5; +6 tickets (C.0 foundation sprint NEW, C.1 invoice/receipt re-scoped, editor moved to shell, lazy-seed adopted, Puppeteer dropped). See [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md). |
| EPIC-D | 6 (excl D.7) | **43** | 3 | v3.4: +2 BLE tickets (D.4.7 supplementary, D.4.8 promotion rule; was 7, now 9) per D.4.0 research; D.7 V1.5 |
| EPIC-E | 7 (NEW E.0) | **21** | 0 | v3.4: NEW Sprint E.0 (3 tickets: E.0.1 hasEcedExperience + E.0.2 municipalityConfig + E.0.3 scholarshipAmount); E.1 expanded from 7 → 8 tickets (E.1.5 pre-flight added) per E.1.0 research |
| EPIC-F | 3 | 6 | 0 | F.4 folded into H.1.8 |
| **EPIC-G** | **3** | **0** | **9** | **ALL OPTIONAL/V1.5 per CEO 2026-05-22** — operator feedback is refinement signal, not V1 gate. G.1 field trip is opportunistic enrichment. G.3 telemetry deferred until product complete. |
| EPIC-H | 3 | 16 | 0 | H.2 is gate, not engineering sprint. Operator-stamps + adoption-metrics removed from V1 criteria (§9 + Per-V1 DoD). |
| **Total V1** | **33** | **153** | **44 V1.5** | v3.4 was 147 V1; **v3.4.2 (2026-05-24) adds 6 EPIC-C tickets** (foundation sprint NEW + properly atomized editor work) — net +6 V1 tickets, +1 sprint. |

Each V1 ticket targets 30-60 min PR review. **V1 product-completeness effort: ~153 atomic PRs.** V1.5 backlog: EPIC-B (19) + EPIC-A.5 (10) + EPIC-G (9) + EPIC-D.7 (3) + research-surfaced V1.5 backlog (§17.2: K-3 LearningStandardGrade + subjectArea cleanup + caste catalog) = **44 deferred tickets**.

**🔬 pre-execution INTERNAL research blockers in V1 (§16):** **3 of 4 RESOLVED as of 2026-05-22.** A.2.0 (Subject-vs-Course → Option B Course extension), D.4.0 (BLE → 9-ticket sprint with concrete entity shapes), E.1.0 (Flash I/II → concrete column-by-column schemas + new Sprint E.0). G.3.0 telemetry inventory remains V1.5-deferred. **No on-site visits or operator interviews are critical-path for V1.**

### v3.4 changes from v3.3

- **A.2.0 RESOLVED:** Sprint A.2 pivoted from "create Subject entity" → "extend Course entity"; 5 tickets re-scoped (same count). Cascading rename: `ExamSubject` → `ExamCourse`, `subjectScores[]` → `courseScores[]`, `subjectId` FK → `courseId` FK across Sprints A.3, A.4, D.3.
- **D.4.0 RESOLVED:** Sprint D.4 expanded from 7 → 9 tickets. New: D.4.7 BLE Grade Increment supplementary endpoint, D.4.8 promotion rule (with remedial flag). Concrete entity shapes from artifact baked into ticket Files: lines.
- **E.1.0 RESOLVED:** NEW Sprint E.0 (3 tickets: schema extensions for hasEcedExperience + municipalityConfig + scholarshipAmount). Sprint E.1 expanded from 7 → 8 tickets (E.1.5 pre-flight validation endpoint added). Concrete Flash I (13 cols) + Flash II (10 cols) column-by-column schemas baked into Sprint E.1 description.
- **Cross-cutting findings (§17 NEW):** 5 V1.5 backlog items surfaced; 4 hypotheses validated; 4 hypotheses refined/invalidated; 3 confidence caveats explicitly tracked for iterative refinement.
- **Risk register:** R32 + R33 marked closed (research artifacts shipped); R34/R35/R36/R37 added (open V1 risks surfaced by research).

### v3.3 changes from v3.2

- EPIC-G demoted from critical-path to OPTIONAL/V1.5 (9 tickets shift to V1.5)
- A.1.2 de-blocked: backend supports it; ship UI unconditionally
- A.2.0 + D.4.0 + E.1.0 reframed: internal-research from primary sources, no field-trip dep
- Per-V1 DoD: removed "operator stamps" + "adoption metrics" + "30-day hypercare"; V1 ships when product is complete; adoption follows naturally
- §0 Philosophy block added: not chasing schools' calendars; not measuring adoption on half-baked product; building complete Nepal-archetype product iteratively from internal evidence

### v3.2 follow-up items (deferred from staff-engineer review)

These remain non-blocking; engineers can begin Sprint 0.1 + 0.2 today because §1.5 (implicit Files contract) + §1.8 (🔬 markers) enforce invariants at PR review:

1. **Three-way-handoff Files: explicit listing** on ~30 new-route tickets — mitigated by §1.5
2. **Module-wiring Files: explicit listing** on ~15 new-module tickets — mitigated by §1.5
3. **Atomicity splits** for 0.1.3 (a/b/c), 0.3.5 (4 services), C.5.2 (4 templates) — at sprint kickoff
4. **AC tightening** for 0.2.2, 0.2.8, B.3.4 (V1.5), C.2.4, H.1.6 — at sprint kickoff
5. **NEW F.0.1 weekly invariant-13 audit cron** (R8 mitigation) — fold into Sprint F.1 at kickoff
6. **GSI inventory updates** as explicit Files: line — enforced by §1.5
7. **CDK file Files: listing** on tickets touching tenant-template-stack — enforced by §1.5

---

## 16. 🔬 Pre-Execution INTERNAL Research Blockers — Summary (v3.4 — 3 of 4 resolved)

Per §1.8, the V1 tickets below carried an internal-research blocker. As of 2026-05-22, **A.2.0, D.4.0, and E.1.0 are all RESOLVED via internal research artifacts.** G.3.0 remains V1.5-deferred (not blocking V1).

| Ticket | Status | Open design question | Output artifact | v3.4 concrete decision |
|---|---|---|---|---|
| **A.2.0** | ✅ **RESOLVED 2026-05-22** | Separate `Subject` entity, or extend `Course` with structured `subjectCode`? | [`a2-subject-vs-course-decision.md`](./a2-subject-vs-course-decision.md) | Option (B): Extend `Course` with `academicSubject`, `stateSubjectCode?`, `curriculumRef`. NO separate Subject entity. Multi-track via two Course rows. Grades 1-3 integrated curriculum → V1.5 deferred. See §0.3 + Sprint A.2 for full breakdown. |
| **D.4.0** | ✅ **RESOLVED 2026-05-22** | Exact BLE registration shape, admit-card template, CDC 50/50 rubric submission | [`d4-ble-design.md`](./d4-ble-design.md) | Municipality-authority + CSV-only IEMIS strategy + per-school MunicipalityConfig (on SchoolConfiguration, not Tenant) + Grade Increment supplementary flow (NG ≤3) + Letter-grade scale A+/A/B+/B/C+/C/D/NG. Sprint D.4 expanded from 7 → 9 tickets. See §0.3 + Sprint D.4. |
| **E.1.0** | ✅ **RESOLVED 2026-05-22** | CEHRD Flash I + Flash II column schemas | [`e1-flash-csv-schema.md`](./e1-flash-csv-schema.md) | Flash I = 13 columns, Flash II = 10 columns at student-row level. Engine: csv-stringify (NOT Handlebars). S3-versioned template configs. Pre-flight validation required. Forms 7/2/19 EXCLUDED (not modern CEHRD). New Sprint E.0 lands `hasEcedExperience` + `municipalityConfig` + `scholarshipAmountNpr` schema extensions before E.1. See §0.3 + Sprint E.0/E.1. |
| **G.3.0** | 🔲 **V1.5 deferred** — not blocking V1 | What adoption telemetry already exists in code; what's missing | `docs/pilot-greenlight/g3-telemetry-inventory.md` (V1.5) | Per v3.3: EPIC-G demoted to OPTIONAL/V1.5; product completeness, not adoption metrics, defines V1. |

**A.1.2** (co-teacher UI) — **de-blocked v3.3**. Backend already supports `coTeacherIds[]`; UI ships unconditionally. Schools that don't co-teach leave the field empty. No research needed.

**Bottom line:** All blocking V1 🔬 markers are now resolved with concrete artifacts. Engineers can execute Sprint A.2, D.4, E.0, E.1 directly against the schemas defined in the artifacts + §0.3 + the rewritten sprint sections.

**Pre-execution discipline:**
1. Engineer opens the ticket
2. Engineer reads the primary sources + reference inputs (all internal-to-EdForge or publicly-available — no field-trip dependency)
3. Engineer audits the existing codebase to identify reusable patterns
4. Engineer writes the 1-2 page decision artifact (`.md` per the table)
5. Engineer updates the ticket's Files / AC / Deps based on the artifact's findings
6. Engineer requests re-review of the ticket scope BEFORE starting code
7. Code PR cites the artifact + the updated ticket spec in the PR description

If the design proves wrong against real-world school behavior post-V1, **iterate in V1.x**. The plan is iterative + agile + agentic, not waterfall.

### v3.1 follow-up items still pending (not blocking V1 execution)

The following improvements from the staff-engineer review (2026-05-20) are documented but not yet edited into this file. They are non-blocking — engineers can begin Sprint 0.1 + 0.2 work today and these issues are caught at PR review per the §1.5 implicit-Files contract:

1. **Three-way-handoff Files: explicit listing** on ~30 new-route tickets — §1.5 implicit contract handles at PR-review time; explicit edit deferred to v3.2.
2. **Module-wiring Files: explicit listing** on ~15 new-module tickets — §1.5 implicit contract handles; explicit edit deferred.
3. **Atomicity splits** for 0.1.3 (split a/b/c), 0.3.5 (4 services), C.5.2 (4 templates) — to be done at sprint kickoff by the engineer claiming the ticket.
4. **Sprint re-buckets**: 0.2.13 finance widen recommended to move into new Sprint 0.5; deferred (mitigated by R10 mapping).
5. **AC rewrites** for 0.2.2 spike, 0.2.8 BS picker, A.1.2 co-teacher conditional, B.3.4 dunning cadence, C.2.4 cold-start, H.1.6 audit completeness — to be tightened at sprint kickoff.
6. **NEW F.0.1 weekly invariant-13 audit cron** (R8 mitigation) — to be added as a free-standing ticket inside Sprint F.1.
7. **GSI inventory updates** as explicit Files: line on all entity tickets that introduce a GSI (~10 tickets).
8. **CDK file Files: listing** on all tickets that touch `tenant-template-stack.ts` (B.1.1, B.3.x, C.1.3, C.2.1, E.1.5).

Track these in a v3.2 revision once the cross-year tickets are reviewed and the team has begun Sprint 0.1.

---

## 17. v3.4 Cross-Cutting Research Findings — Synthesis (NEW, 2026-05-22)

The three research artifacts (A.2.0 / D.4.0 / E.1.0) surfaced findings that cross multiple EPICs. This section is the single place to read what each artifact contributed beyond its own sprint, what V1.5 backlog they generated, and what assumptions they validated/invalidated.

### 17.1 Findings that re-shape multiple EPICs

| Finding | Source artifact(s) | EPICs affected | v3.4 disposition |
|---|---|---|---|
| **NO IEMIS / NEB / Municipality REST API** | A.2.0 §8.1, D.4.0 §8 + §11.7, E.1.0 §8.3 (3 independent confirmations) | D, E | V1 strategy locked: **CSV/Excel export/import only** via emis.cehrd.gov.np portal. API integration is V2+ scope. Eliminates ~6 tickets of API-client work from V1 envelope. |
| **9-digit IEMIS School Code is the canonical national identifier** | D.4.0 §8.1, E.1.0 §6.1 | 0, D, E | Already on School entity (`School.emisCode`). All exports (BLE registration CSV, Flash I/II) join on this. No schema change needed. |
| **Student.emisStudentId is cross-school IEMIS tracking ID** (research called this `stateId`) | E.1.0 §5.2 | 0, D, E | Already on Student entity per audit. Confirmed canonical for cross-school transfer tracking. No schema change. |
| **Letter Grade `NG` (Not Graded) is a terminal grade value** | D.4.0 §6.3 | A, D | GradingPolicy schema (Sprint D.1) MUST accept `NG` as a valid letter-grade value distinct from `F` or `Incomplete`. `ResultCard.courseScores[].grade` accepts it. ExternalExamResult.courseResults[] accepts it. Confirm at Sprint D.1 implementation. |
| **Supplementary / Grade Increment exam flow is required for V1** | D.4.0 §7.2 (KMC reference: Baishakh 6-12 window) | D | NEW Sprint D.4 ticket **D.4.7** (BLE supplementary). NEB equivalent already at Sprint D.6.5. SEE equivalent at Sprint D.5 (light extension; eligibility threshold differs from BLE). |
| **MunicipalityConfig belongs on SchoolConfiguration, NOT Tenant** | D.4.0 §6 + audit 2026-05-22 | 0, D, E | New Sprint E.0 ticket **E.0.2** adds `municipalityConfig` to SchoolConfiguration. Reason: a tenant can hold multi-school chains across municipalities. Schools are the natural per-municipality boundary. |
| **csv-stringify > Handlebars for CSV-row exports at scale** | E.1.0 §14 | E (and any export feature post-V1) | E.1.3 Lambda uses `csv-stringify`. **EPIC-C revision 2026-05-24:** Handlebars is no longer in EPIC-C scope either — the PDF Generation Service uses `@aibrains/pdf-renderer` (`@react-pdf/renderer` underneath), not Handlebars+Puppeteer. Handlebars has zero footprint in the EdForge codebase post-revision. |
| **S3-versioned template configs > hardcoded mappings** | E.1.0 §14 | E | E.1.2 ships JSON column-mapping configs in S3 with versioning. CEHRD-rename hotfixes ship without backend redeploy. Pattern applies to future regional reports. |
| **Pre-flight validation UI required before CSV export** | E.1.0 §14 | E | New E.1.5 endpoint. UI consumes; operator sees row-level errors before downloading. Prevents wasted IEMIS portal upload rejections. |
| **Allen ISD STAAR + PEIMS analogy is architecturally sound** | All three artifacts | A, C, D, E | EdForge stays archetype-agnostic at engine; archetype-specific at boundary (templates + CSV exports + admit-card layouts + IEMIS-shaped reports). The "Student → Section → Course → AcademicSubject" hierarchy + the "baseline-then-outcomes" split (Flash I → Flash II, like Fall PEIMS → Summer PEIMS) confirmed structurally analogous to Ed-Fi V6. |

### 17.2 V1.5 backlog items generated by the research

These are explicitly DEFERRED out of V1; they are not pilot-blocking and add ~3-5 tickets to V1.5:

1. **Grades 1-3 integrated/thematic curriculum gradebook** — A.2.0 §1.1 + §8 noted. Path: Ed-Fi `LearningStandardGrade` array on Grade entity. Estimated 2-3 tickets. Required when first PABSON school with K-3 cohort uses EdForge for K-3 grading. Saraswati operates Grades 4-10 in V1; not blocking.
2. **`subjectArea` enum removal cleanup** — Sprint A.2.3 introduced dual-write back-compat. Post-V1, after all consumers migrate to `academicSubject` descriptor, remove the legacy `subjectArea` field. 1 ticket.
3. **Caste catalog with named values** — Currently `Student.ethnicityDescriptor` is URI-only. Flash I requires categorization into {Dalit, Janajati, Brahmin/Chhetri, Others}; we map at export-time via lookup. A proper caste-catalog entity with regional name + URI + display order is a V1.5 enhancement. 1 ticket.
4. **IEMIS portal API integration** — When/if CEHRD publishes a submission API, V2 replaces CSV-upload path with API push. Sprint E.1 schema-versioned design accommodates this without rewrite — just a new "transport" implementation behind the existing aggregation Lambda.
5. **Per-municipality result-import format normalization** — If municipalities diverge in their ledger CSV format beyond what `municipalityConfig.iemsExportHeaderOverrides` covers, V1.5 introduces a `MunicipalityResultParser` strategy pattern. 1 ticket.

### 17.3 Hypotheses VALIDATED by research

These were assumptions baked into the v3.3 plan; research confirmed them:

- **Ed-Fi V6 alignment is the right interoperability target** (A.2.0 §2) — Course + AcademicSubjectDescriptor + Section + Grade + StudentSectionAssociation maps cleanly to Nepal CDC curriculum + PABSON private-school operations. Multi-track Cambridge/IB layered cleanly.
- **PDF Generation Service (EPIC-C, revised 2026-05-24) covers all printable artifacts uniformly** — invoice, receipt, report card, admit card all share the `@aibrains/pdf-renderer` library + per-school template via DDB + per-school logo via S3 + presigned-URL distribution pattern. Per-school branding via `School.branding` (NEW C.0.5 — `logoS3Key`, `addressLines`, `phone`, `panNumber`, `vatNumber`, `colorPalette`) + per-template overrides via `pdf_template.brandingOverrides?`. `SchoolConfiguration.municipalityConfig` continues to drive admit-card municipality-specific fields per D.4.5. See [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md) for full design.
- **EventBridge-driven automation pattern scales** — `exam.ble_result_imported` → `promotion.evaluate.scheduled` → `flash_ii.aggregation.ready` chains use the existing C0.c.3 runtime-validated payload pattern. No new EventBridge bus needed.
- **archetypeDefaults (Sprint 0.4) is correctly the hub for archetype-specific config** — Each research artifact pointed back to archetypeDefaults for rubric weights, grade ladder, exam pattern, letter-grade scale. The hub-and-spoke pattern holds.

### 17.4 Hypotheses INVALIDATED / refined by research

- **"A field-trip is critical to validate BLE format"** — INVALIDATED. D.4.0 §1-§7 sourced entirely from public CEHRD + KMC + LMC notices + Edusanjal news; admit-card field list captured without operator interview. Validates v3.3 philosophy (§0): primary-source research suffices for V1 design.
- **"Forms 7 / 2 / 19 are CEHRD mandatory submissions"** — INVALIDATED. Research found these NOT in modern CEHRD public sources; likely legacy district-era forms absorbed into the IEMIS portal modules. Removed from EPIC-E scope.
- **"`Subject` is a separate entity in Ed-Fi V6"** — INVALIDATED by A.2.0 §2. Ed-Fi V6 treats subject as a descriptor on Course. Save ~5 entity tickets + the join cost.
- **"BLE → Grade 9 strict-fail blocks the student"** — REFINED. D.4.0 §7.1: strict fail doesn't permanently bar; NG students promote with remedial after supplementary attempt. PromotionRule for BLE (D.4.8) reflects this.

### 17.5 Confidence caveats still open

These are open questions the research surfaced but couldn't fully close (per "Open Questions / Confidence Caveats" sections of each artifact). They're flagged for iterative refinement post-V1.x:

1. **Exact IEMIS Excel header text strings** — Locked behind portal login. v3.4 designed templates from CEHRD-published PDFs + Edusanjal samples; first real IEMIS upload attempt by Saraswati will reveal any header-text mismatches. Mitigation: S3-versioned JSON config (E.1.2) lets us hotfix headers without backend redeploy.
2. **`scholarshipAmount` required vs category-only** — Unclear from portal docs. v3.4 ships field as optional (E.0.3); zero risk if IEMIS rejects unknown column (we exclude it from CSV output via schema config). Iterate post first upload.
3. **Granular internal-assessment sub-categories vs aggregate /50** — D.4.0 §12 flagged uncertainty whether IEMIS wants the breakdown or just the rolled-up score. v3.4 tracks granularly in EdForge (4 RubricCategory rows per subject) but exports aggregate /50 in BLE CSV (D.4.4). Granular detail stays available for school-internal reporting + future IEMIS schema changes.

### 17.6 Sprint 0.1 — 206-row IEMIS historical-debt (deferred to Sprint E.1.5)

Surfaced 2026-05-22 during Sprint 0.1 closeout audits (see [sprint-closeouts.md](sprint-closeouts.md)).

**What it is:** Saraswati's 206 historical Student rows (imported before 0.1.2a's transformer extension shipped) are missing 3 of the 4 derived descriptor fields: `motherTongueDescriptor`, `disabilities[]`, `isTransferred`. The 4th, `sexDescriptor`, is recoverable from existing `Student.gender`.

**Why it can't be auto-backfilled with current code:**
1. **IEMIS import does NOT stash the source XLSX.** The endpoint accepts a JSON array of pre-parsed rows from the frontend; the array is processed by an async worker in memory then discarded. No S3 stash, no DDB blob.
2. **IEMIS import endpoint hard-codes SKIP on duplicates.** When the operator re-uploads the same cohort (e.g. to populate new derived fields), the endpoint detects duplicates by `emisStudentId` via GSI7, adds them to `IemisImportJob.duplicates[]`, and **never calls `createStudent()` or any PATCH/update path**. No `mode='upsert'` parameter exists.

**Why it's not pilot-blocking now:**
- Forward path works: every new IEMIS upload from 2026-05-19 onward populates all 4 fields correctly (0.1.2a transformer).
- The 206-row historical gap is bounded (Saraswati only; not compounding; daily uploads stopped per CEO's previous direction).
- The natural surfacing point is Sprint **E.1.5 pre-flight validation**: when Saraswati first exports Flash I CSV, pre-flight tells them "206 students missing X".

**Remedy paths to choose between at E.1 sprint kickoff:**
| Path | Effort | Coverage | Best-fit when |
|---|---|---|---|
| Add `mode='upsert'` to import endpoint, operator re-uploads | ~half-day eng + tests | All 4 fields, all 206 rows | If we expect repeat scenarios (other tenants, other field additions) — most reusable |
| `sexDescriptor`-only backfill script | ~half-day eng + tests | 1 of 4 fields (sexDescriptor only) | If the other 3 are accepted as gaps; partial value |
| Manual UI per-student edit | 0 eng / ~17 hr operator | All 4 (operator's choice) | If only Saraswati cares and the field count is acceptable |
| Submit Flash I with gaps + amend later | 0 eng / 0 immediate operator | None now; resolves at IEMIS portal's own re-submission cycle | If CEHRD's IEMIS portal accepts incomplete demographic data + amendments |

**Tracking:** This debt is referenced in 0.1.3 (RECLASSIFIED disposition) + this §17.6 entry + the E.1.5 ticket AC will explicitly include "surfaces the Sprint-0.1 206-row backfill gap if any rows in the export remain incomplete."

### 17.7 Ship-cycle lessons (Sprint E.1 + Sprint D.1, 2026-05-22)

Three durable engineering lessons surfaced while shipping E.1 + D.1 end-to-end this session. None are pilot-blocking; all are documented here so future sprints don't repeat them.

#### L1 — DDB single-table partition key is the **bare UUID**, not `TENANT#<tid>`

The identity + academics single-table designs store the partition-key column `tenantId` as the **bare UUID** (e.g. `21aea5da-…`), not the prefixed form. The `TENANT#{tid}` notation that appears in some entity-file header comments (e.g. `base.entity.ts`) is the *logical / Ed-Fi-style notation*, not the *stored value*.

**Incident anchor:** Sprint E.1 Phase 5 live smoke (PR #144). The report-aggregator Lambda's `tenantPk()` helper prefixed the base-table PK with `TENANT#`; every read returned `SCHOOL_NOT_FOUND` and every `UpdateItem` hit `ConditionalCheckFailedException`. CloudWatch logs showed:

```
{"level":"error","msg":"aggregator failed","errorCode":"SCHOOL_NOT_FOUND",
 "errorSummary":"SCHOOL_NOT_FOUND tenant=21aea5da-... school=4209e3d8-..."}
```

Ground-truth: DDB GetItem on the orphan snapshot row returned `TENANTID=21aea5da-…` — bare UUID. Resolution: drop the prefix on base-table reads/writes.

**Codification:**
- Memory entry `edforge_identity_ddb_bare_uuid_partition_key` documents the convention.
- Regression guard in `lambda/report-aggregator/handler.spec.ts` asserts every `ddbSend` call's `Key.tenantId.S` does NOT start with `TENANT#`.
- **GSI partition keys (`gsi1pk`, `gsi2pk`, etc.) ARE legitimately prefixed** per their entity factories (e.g. `gsi2pk: 'TENANT#${tid}#SCHOOL#${sid}'`) — do not confuse the two.
- **Engineering rule for new entity/reader code:** trust factory functions (`createXxxEntity`) over file-header comments. Run an actual DDB GetItem before assuming key shape.

#### L2 — Workspace-only npm packages cannot ship in **any** Docker-built ECS service

CLAUDE.md already documents the "AdminWeb publish-gate gotcha" — workspace-only packages break CodeBuild because CodeBuild has no visibility into monorepo symlinks. This session extended that lesson: **the same trap applies to academics ECS** (and identity, finance, rproxy — any service whose Dockerfile copies a single `server/application/package.json` and runs `npm install`).

**Incident anchor:** Sprint D.1 Phase 2 academics ECR build (PR #149). Phase 2 imported `@edforge/tenant-settings-resolver` for the D.1.3 lazy-seed. That package is `"private": true` — not published to npm. Docker `npm install` failed with `TS2307: Cannot find module '@edforge/tenant-settings-resolver'`.

**Resolution:** PR #149 inlined a ~90 LOC `TenantMetadataReaderService` directly into academics. The workspace package's `getTenantMetadata()` helper stays in place for Lambda consumers (Lambdas built via NodejsFunction + esbuild DO resolve workspace symlinks at synth/bundle time).

**Codification:**
- R39 in the risk register tracks this trap.
- **Engineering rule for new ECS-service code:** any import from `@edforge/*` (vs. `@aibrains/*`) is a red flag. Check the target package's `package.json` — if `"private": true`, you must EITHER (a) inline the needed helper into the ECS service's own source tree, OR (b) publish the package (change `"private"` → false + `npm publish`).
- **Engineering rule for new Lambda code:** workspace-only imports are fine; esbuild resolves them at synth.

#### L3 — Deployer IAM is intentionally narrow; lazy-seed is the operator-grade pattern for prod data

The `edforge-prod-deployer` IAM user has the `aws ecr` + `aws ecs` + `cdk deploy` surface but **NOT** `dynamodb:PutItem` / `:UpdateItem` on tenant tables. This is correct security posture — the deployer can ship infra but cannot directly mutate prod tenant data.

**Incident anchors (3 this session-arc + 1 prior per memory):**
1. Sprint E.1 orphan-snapshot cleanup (2026-05-22) — `aws dynamodb update-item` failed `AccessDeniedException`.
2. Sprint D.1 backfill APPLY=true (2026-05-22) — `npx ts-node backfill.ts --apply` failed same way.
3. Sprint T5 SchoolConfiguration orphan cleanup (2026-05-12, per memory `project_grade_level_fix_T5_shipped`) — used the inline-policy-attach-and-detach workaround.

**Two operator-grade write patterns that DO work:**
- **(a) Lazy-seed via service code** — runtime ECS task roles have the ABAC grants for their own table writes. Designing operations as "on first internal trigger, the service creates the missing data" lets prod-data mutations happen through the JWT-auth path with proper audit trail.
- **(b) Inline-policy attach → operation → detach** — established T5 pattern when (a) doesn't fit. ~5 AWS calls, one-shot, removes the temp grant after use. Use when the operation cannot be triggered through service code (e.g. data cleanup that no API path exposes).

**Codification:**
- Sprint D.1 Q2 design decision (lazy-seed at first GET) directly applied (a) — avoiding the IAM dance.
- The Sprint E.1 orphan snapshot is documented as "operator cleanup via AdminWeb V1.5 UI OR pattern (b)" — non-blocking.
- **Engineering rule for new sprint design:** if a sprint requires backfilling existing prod data, design the operation through the JWT-auth ECS path FIRST. Reserve pattern (b) for one-shot cleanups that fall outside the service's own write paths.

### 17.8 Ship-cycle lessons (Sprint A.3, 2026-05-22)

Five durable engineering lessons surfaced while shipping A.3 (Exam Subsystem) end-to-end. All caught + fixed mid-sprint; documented here so future EPIC-A / EPIC-D sprints don't repeat them.

#### L4 — `tenant-api-prod.json` changes need `cdk deploy shared-infra-stack` (sprint plans systematically miss it)

CLAUDE.md change-to-deploy matrix is explicit: "API Gateway route (`tenant-api-prod.json`) → `shared-infra-stack` → wrapper". But sprint plan templates (A.2, A.3 included) listed only ECR + ECS in their Phase 2 deploy ladder, leaving the API GW deploy invisible.

**Incident anchor:** Sprint A.3 Phase 3 smoke. P1 (`POST /academics/exams`) returned `403 SigV4` immediately after Phase 2's academics ECS roll completed cleanly. Classic API-GW-route-missing pattern per [memory `edforge_api_gateway_route_registration`]. Service was healthy; API GW didn't know about `/academics/exams` because the JSON change hadn't deployed.

**Resolution:** `cdk deploy shared-infra-stack` (223s); 8 new paths live; smoke 11/11 green on retry.

**Codification:**
- R40 added to risk register.
- §13 per-sprint DoD updated to require `shared-infra-stack` redeploy for any sprint modifying `tenant-api-prod.json`.
- **Forward rule for sprint plans:** any sprint plan that lists `tenant-api-prod.json` in its Files: line MUST list `cdk deploy shared-infra-stack` as a separate step in §7 deploy ladder. Cross-reference at sprint plan §7 drafting time.

#### L5 — NestJS POST returns 201 (Created); smoke assertions must accept 2xx not strict 200

The initial A.3.11 smoke compared `status === 200` on bulk-write + idempotency-retry. Both responses had correct bodies (`totalCreated=10/skipped=0/alreadyProcessed=false` and `totalCreated=0/skipped=10/alreadyProcessed=true`) but Nest returned 201 (Created), causing false failures.

**Resolution:** PR #159 relaxed checks to `status >= 200 && status < 300`. Re-run: 11/11 green.

**Codification:**
- **Forward rule for smoke scripts:** status assertions check `2xx` range unless explicitly testing a specific status code semantic (204 DELETE, 409 state-machine reject, etc.). Body content assertions remain strict.

#### L6 — `shared-infra-stack` CloudFormation template at 86% of 1MB limit (architectural ceiling approaching)

CDK warned during A.3 follow-up deploy: `Template size is approaching limit: 863276/1000000`. Each new top-level API GW path adds ~9000 chars; A.3 alone added ~72KB. Remaining headroom ≈ 137KB ≈ 15 paths. With A.4 (~5 paths), D.2 (~6), D.3 (~10), D.4 (~9), D.5 (~7), D.6 (~6), C.1-C.5 (~12) all critical-path, the limit hits within ~2 sprints.

**Codification:**
- R41 added to risk register.
- **Forward rule for sprint plans:** A.4 (next sprint) plan §7 MUST flag template-size before drafting; if path-count pushes total > 90%, architecture-refactor (split `tenant-api-prod.json` into per-domain JSON files referenced from a `shared-api-routes-stack`) becomes a hard prerequisite before A.4 ships.

#### L7 — Live smoke catches integration issues that unit specs cannot (4 caught in A.3)

A.3 Phase 2 entity + state-machine specs (51/51 green) verified the data layer but did NOT exercise the API surface. Four real-world issues only surfaced during the live smoke run:

1. **Wrong table-name env var** in bulk handler (`process.env.ACADEMICS_TABLE_NAME` vs `TABLE_NAME`). Caught + fixed pre-merge during the thorough review (PR #157 commit `3eca9c9`).
2. **Wrong enrollment endpoint path** in smoke pre-flight (`/academics/enrollments` is 404; real path is `/academics/schools/:schoolId/years/:yearId/enrollments`). Caught mid-smoke + fixed via synthetic UUIDs (PR #159).
3. **`tenant-api-prod.json` not deployed to API GW** (R40 / L4 above). Caught at smoke P1.
4. **NestJS POST returns 201 not 200** (L5 above). Caught at smoke P5/P6.

**Codification:**
- **Forward rule for sprint planning:** Phase 3 parametric smoke is non-negotiable for sprints adding new service code. Unit specs verify data shapes; smoke verifies integration end-to-end (routing + cross-service contracts + deploy ladder completeness).
- Memory `feedback_just_ask_for_a_prod_token` already documents the JWT-from-real-Cognito requirement for smokes — extend the principle: **smoke is the integration test of last resort. Don't ship without it.**

#### L8 — Invariant 12 phrasing: "no implicit archetype branching", not "zero grep hits"

`a3-sprint-plan.md` §1.5 stated: "Service code stays `grep 'archetype' → 0 hits`." A.3 actual code has 11 archetype references in `exams.service.ts` — but ALL are data-driven: imports of `getArchetypeDefaults`, function name `assertExamTypeAllowedForArchetype`, variable name `metadata.archetype`, error-message text. **Zero `if (archetype === 'PABSON')` branching.** Same pattern as D.1 (which also has archetype references in its lazy-seed code).

**Codification:**
- **Forward rule for sprint plans:** invariant 12 should read "no IMPLICIT archetype branching" — explicit data-driven lookups via `TenantMetadataReader` + `getArchetypeDefaults()` ARE allowed and necessary. A literal grep-zero rule is too strict and conflicts with the codified D.1 + A.3 patterns.
- Future sprint plan templates (§1.5 wording) should use "no implicit archetype branching" + cite the `if (archetype === ...)` anti-pattern explicitly.

---

### 17.9 Ship-cycle lesson (Sprint A.4 Phase 2 incident, 2026-05-23)

#### L9 — Sprints that create a new NestJS module MUST ship the wiring spec, not defer it

Sprint A.4 Phase 2 ([PR #162](https://github.com/shoaibrain/edforge/pull/162)) introduced a new `ResultsModule` to the academics service. The sprint plan §1.4 invariant gate and §5 R-A4.3 both flagged that academics had no `module-wiring.spec.ts` (Sprint 0.3 scope) and the mitigation was "post-deploy ECS log inspection mandatory." This was wrong. The post-deploy log check is a **detection** mechanism, not a **prevention** mechanism. By the time CW logs show the DI error, prod is already in a crash loop.

**Incident:**
- `ResultsModule.providers` declared `PermissionGuard` but omitted `IdentityClientService` — which `PermissionGuard.constructor(Reflector, IdentityClientService)` injects (root-module exports don't propagate to child modules per memory `feedback_module_wiring_invariant`).
- `nest build academics` compiled cleanly (webpack checks types, not Nest DI graph).
- Phase 2 PR merged + image rolled to prod ap-south-1 at 06:15 UTC 2026-05-23.
- Crash loop ~90s/cycle for ~4 hours from 06:15 → 12:09 UTC. `aws ecs wait services-stable` returned exit=0 because `running == desired` at each polling moment (ECS rapidly replacing failing tasks; the `rolloutState: IN_PROGRESS` signal wasn't being checked).
- Recovery 12:09–12:19 UTC: ECR `:latest` re-tagged to prior A.3 image `sha256:1bdb67f0…`, force-new-deploy, Nest boots cleanly, service restored.
- Forward-fix: [PR #163](https://github.com/shoaibrain/edforge/pull/163) adds the missing provider + a new `academics/__tests__/module-wiring.spec.ts` (43 assertions covering all 11 PermissionGuard-consumer modules). Hotfix image `sha256:2c9fd8b8…` deployed 12:55 UTC; smoke `GET /academics/result-cards` returned `200 + []`.

**This is the third instance of the same DI-graph trap** (Sprint S0 PR #59 identity, Sprint C4 PR #120 identity, now Sprint A.4 PR #162 academics). The first two were caught by `identity/__tests__/module-wiring.spec.ts` retro fixes. Academics had no equivalent spec, so this one bypassed every static check pre-deploy.

**Codification:**
- R43 added to risk register: "Sprint creating a new NestJS module in a service without `module-wiring.spec.ts` MUST ship the spec in the same PR. Treating it as 'next-sprint scope' has cost prod 3 times."
- **Forward rule for sprint plans:** if §3 file list contains any new `.module.ts` for a service whose `__tests__/module-wiring.spec.ts` doesn't yet exist, that spec is a Phase 2 deliverable, NOT a Sprint 0.3 deferral. Update §5 invariant gate to require "wiring-spec exists" before declaring DoD. Memory `feedback_module_wiring_invariant` broadened post-A.4 to cover all services (not just identity).
- **Forward rule for deploy verification:** post-deploy gate for new-module deploys is CW log filter for `"Nest application successfully started"` in the new task's stream, NOT `services-stable`. The latter returns exit=0 even during crash-loops because `running == desired` is true at each snapshot.
- **Forward rule for cargo-cult prevention:** when authoring a new module by copying a sibling pattern, name each provider's purpose before trimming. The A.4 incident root cause was trimming `IdentityClientService` from a copied `ExamsModule` pattern without tracing why it was there (it's a `PermissionGuard` dep, not a service-code dep).
- **Forward rule for review pass:** "for every guard/interceptor declared in providers, walk its constructor params and verify each is also resolvable from this module's provider tree" is now an explicit review checkbox alongside the three-way handoff check.

This is Phase 2's only ship-cycle scar; A.4.1–A.4.6 functionality is otherwise live and the hotfix landed cleanly. Phase 3 (result-batch Lambda + EventBridge wiring) is unblocked.

---

### 17.10 Ship-cycle lessons (Sprint A.4 Phase 3 + Phase 4, 2026-05-23)

Phase 3 (result-batch Lambda + EventBridge wiring) deployed cleanly, but Phase 4 smoke surfaced two data-shape bugs that unit tests had missed. Recovered via PR #167 hotfix; smoke then went 16/16 green. Three durable lessons.

#### L10 — Lambda specs must mock REAL DDB shapes, not synthetic happy-paths

Phase 3 Lambda unit specs (10/10 green pre-deploy) all set `isActive: true` and `letterGrades: [...]` on mocked DDB entity rows. **Real prod rows don't have those fields:** academics service factories don't consistently write `isActive` on ExamCourse, and the dev-pabson-primary GradingPolicy was created pre-D.1.1 without a `letterGrades` field at the DDB level.

Lambda first invocation in live smoke crashed with `TypeError: Cannot read properties of undefined (reading 'length')` on `letterGrades`. After backfill of policy with letterGrades, second invocation returned `cardsCreated:0, examCoursesUsed:0, enrollmentsAggregated:0` — every entity was filtered out by `.filter((x) => x.isActive)` because the field was undefined.

**Hotfix (PR #167)** — defensive `letterGrades ?? []` + `.filter((x) => x.isActive !== false)` (treats undefined as active; explicit false still soft-deletes). 2 new specs that mock entity rows WITHOUT the fields, proving the fix.

**Codification:**
- **Forward rule for Lambda specs:** before writing entity-row mocks, run `aws dynamodb query --table-name <table> --index-name <gsi> --key-condition-expression ... --output json | head -30` to capture ACTUAL attribute presence. Mock the real shape, not the TypeScript-type-implied shape. Optional attributes that the service writes inconsistently are an integration-time discovery.
- **Forward rule for Lambda handlers:** when consuming entities from a Cross-service-written table, treat ALL optional attributes as defensively. Use `!== false` for soft-delete checks (matches the API mapper precedent at `grading-policy.mapper.ts:90`).

#### L11 — Phase 3 "synthetic put-events live-smoke gate" is impractical from deployer IAM; Phase 4 IS the wire-validation

A.4 Phase 3 plan §7 specified a post-deploy synthetic `aws events put-events` test as the gate. **Blocked by prod IAM:** `edforge-prod-deployer` correctly lacks `events:PutEvents` on the SBT bus (only academics ECS task role can publish). Direct `lambda:InvokeFunction` also denied.

For Lambda-on-EventBridge sprints in this repo: **Phase 3 stops at "resources exist + CFN clean"** (verified via `aws lambda get-function`, `events list-rules`, `sqs get-queue-attributes`, `cloudwatch describe-alarms`). **The wire-validation IS the next phase's real-event smoke.**

**Codification:**
- **Rename Phase 3 §7 language:** "synthetic put-events live-smoke gate" → "real-event end-to-end gate (Phase 4)" in future Lambda-on-EventBridge sprint plans.
- A.4 Phase 4 smoke C7 polling proved Lambda fires within 3s of `exam.closed` on a warm cold-start.

#### L12 — Cognito JWT TTL is 1h; tighter than the smoke prep window

A.4 Phase 4 smoke first attempt failed with "Unauthorized" — JWT expired **56 seconds** before the run started. User issued the JWT fresh; by the time I prepared environment + ran, the 1-hour TTL lapsed.

**Codification:**
- **Forward rule for smoke runs:** request fresh JWT IMMEDIATELY before running, not at the start of a longer prep sequence. Smokes that need >55min of setup should plan for a mid-flow JWT refresh.
- V1.5 candidate: refresh-token flow in pilot-smoke scripts so the script auto-renews when the id-token nears expiry.

#### L13 — Operator data backfill discovery (dev-pabson-primary GradingPolicy)

Phase 4 smoke surfaced that `dev-pabson-primary`'s default GradingPolicy `07d6e1d1-…` was seeded pre-D.1.1 WITHOUT letterGrades. Lazy-seed (D.1.3) only fires when no default exists; this school already had one, so the lazy-seed never triggered.

**Operator backfill executed 2026-05-23 17:53 UTC:** PATCH `/academics/grading-policies/07d6e1d1-...?schoolId=4209e3d8-...` with PABSON CEHRD letterGrades (A+/A/B+/B/C+/C/D+/D/E; **NG entry dropped** due to validation rejecting `NG.minPct=0` overlapping `E.minPct=0` — V1.5 validation refinement candidate).

**Codification:**
- **Forward rule for D.1.3 lazy-seed:** seed firing-condition currently is "no default policy exists." Tighten to "no default policy exists OR existing default has incomplete required fields (letterGrades empty)." V1.5 backlog item.
- **Production GradingPolicy audit:** before any tenant goes live (Saraswati, future pilots), operator MUST verify policy.letterGrades is populated. Sprint 0.x checklist candidate.

---

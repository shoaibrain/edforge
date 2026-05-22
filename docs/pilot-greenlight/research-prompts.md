# Research Prompts for V1 🔬 Blockers (A.2.0, D.4.0, E.1.0)

> **Use:** Copy-paste the prompt blocks below into Gemini or Claude on the web. The AI will perform web research and return a structured artifact. Save the output to the corresponding `docs/pilot-greenlight/<artifact>.md` file. The artifact unblocks the engineering ticket per `v1-master-epic-breakdown.md` §16.
>
> **Quality bar:** every claim cites a public URL. Engineer reviews + edits before adopting.

---

## Prompt 1 — A.2.0: Subject vs Course Architectural Decision

**Engineering goal:** Decide whether EdForge needs a separate `Subject` entity for Nepal PABSON archetype, or whether extending the existing `Course` entity with a structured `subjectCode` + curriculum reference is sufficient. Output target: `docs/pilot-greenlight/a2-subject-vs-course-decision.md`.

### Copy-paste into Gemini / Claude

```
ROLE: You are a senior software architect researching curriculum data models for a K-12 EMIS (Education Management Information System) platform targeting private schools in Nepal.

CONTEXT:
- The platform is multi-tenant SaaS, built on AWS + NestJS + DynamoDB.
- The data model is anchored to the Ed-Fi V6 standard.
- Target archetype: PABSON (Private and Boarding Schools' Organisation Nepal) private schools.
- Grade ladder: ECD / PPC / Kindergarten / Grades 1-10 (some schools extend to 11-12).
- National curriculum authority: CDC (Curriculum Development Centre, Nepal), under MoEST. Published at https://moecdc.gov.np/.
- Schools follow CDC curriculum; some PABSON schools also offer Cambridge / IB parallel tracks.
- Existing data model already has a `Course` entity with fields: { id, code, name, subjectArea (enum: mathematics | english_language_arts | science | social_studies | world_languages | arts | physical_education | technology | business | vocational | other), gradeLevels (string[]), credits, courseType, prerequisites[] }. Sections, enrollments, grades all reference Course.
- Allen ISD (Texas, USA) is being studied as a reference framework for structural discipline. Allen ISD uses course codes like "LA1D7A" (English 7) with subject embedded in the code prefix; they do NOT maintain a separate Subject entity.

THE DECISION TO RESEARCH:
Should EdForge add a separate `Subject` entity (with Course.subjectId FK), OR extend the existing Course entity with a structured `subjectCode` field plus a curriculum-reference field? Either path needs to support:
- Subject-teacher assignment per section
- Mark entry per (subject × exam × student) for the SEE/BLE/NEB workflows
- Curriculum sequencing per grade band (Basic 1-3 integrated; 4-8 subject-based; 9-10 SEE prep)
- Multi-track: PABSON schools may offer CDC + Cambridge subjects in parallel

RESEARCH QUESTIONS — answer each with public-source citation:

1. CDC CURRICULUM ORGANIZATION
   1.1 How does CDC organize subjects per grade band? Find the official CDC National Curriculum Framework document (2076 BS / 2019 AD or later) and summarize the subject structure for Basic Level (Grades 1-8) and Secondary (Grades 9-10).
   1.2 Does CDC publish a canonical list of subjects per grade with subject codes? If yes, provide the list. If not, what's the closest published taxonomy?
   1.3 How does CDC treat the 1-3 integrated curriculum vs the 4-8 subject-based curriculum vs the 9-10 SEE-prep curriculum?
   1.4 For Grade 11-12, what subjects are mandatory (per post-2025 NEB curriculum reform) vs elective?

2. SUBJECT vs COURSE IN ED-FI V6
   2.1 Does Ed-Fi V6 have a separate `Subject` resource, or is subject a descriptor on Course?
   2.2 How does Ed-Fi V6 model the relationship between (a) the academic subject of study, (b) the course offering at a school, (c) the section instance with a teacher? Cite the Ed-Fi data model documentation.
   2.3 In Ed-Fi V6, how is the per-subject mark entry for an exam represented?

3. SUBJECT vs COURSE IN PRACTICE — Allen ISD reference
   3.1 In Allen ISD's published Academic Planning Guide (https://www.allenisd.org/), how do they encode subject within their course catalog? Use the middle-school APG as the reference.
   3.2 Course codes like "LA1D7A" — what does each character encode? Find a key/legend.
   3.3 Does Allen ISD maintain a separate Subject entity for curriculum standards alignment (e.g., TEKS subject codes)?

4. PRACTICE IN NEPAL PABSON SCHOOLS
   4.1 Find 2-3 examples of PABSON-affiliated school websites that publish their curriculum (e.g., subject lists per grade). What naming conventions do they use? Are CDC subject names translated to English consistently?
   4.2 Do PABSON schools track curriculum mapping separately from teacher-section assignment, or is it implicit?
   4.3 For Cambridge / IB tracks at PABSON schools, how is subject mapped to local CDC equivalents (if at all)?

5. CAMBRIDGE / IB TRACK PARALLEL
   5.1 At PABSON schools that offer Cambridge IGCSE alongside CDC SEE-prep, are the same subjects taught with two different syllabi? Or different subjects entirely?
   5.2 How would a database design need to differentiate "Mathematics CDC Grade 8" from "Mathematics Cambridge Stage 8" in a single school?

6. NEPAL-SPECIFIC SUBJECT-CODE STANDARDS
   6.1 Does the SEE Board / NEB publish a canonical subject code per Grade 10/11/12 subject for external exam registration? Find the codes.
   6.2 Does the IEMIS portal use a canonical subject taxonomy? Find evidence.

OUTPUT FORMAT — produce a markdown document with this structure:

# A.2.0 Research — Subject vs Course Decision for EdForge Nepal Archetype

## 1. CDC Curriculum Organization
[answers to Q1.1–Q1.4 with URLs]

## 2. Ed-Fi V6 Subject/Course Model
[answers to Q2.1–Q2.3 with URLs]

## 3. Allen ISD Reference
[answers to Q3.1–Q3.3 with URLs]

## 4. PABSON School Practice
[answers to Q4.1–Q4.3 with URLs — at least 2 PABSON school websites cited]

## 5. Cambridge / IB Parallel Tracks
[answers to Q5.1–Q5.2 with URLs]

## 6. NEB / IEMIS Subject Codes
[answers to Q6.1–Q6.2 with URLs]

## 7. Recommendation
Recommend ONE of:
(A) Add separate `Subject` entity with Course.subjectId FK
(B) Extend Course with structured `subjectCode` + `curriculumRef` (no new entity)
(C) Hybrid: extend Course AND create a lightweight Subject lookup table

Rationale must cover:
- Cleanliness of mark entry per (subject × exam × student) for BLE/SEE/NEB workflows
- Multi-track (CDC + Cambridge) handling
- Migration cost from existing Course entity
- Ed-Fi V6 alignment cost
- Concrete schema sketch (the new/modified fields)

## 8. Open Questions / Confidence Caveats
List anything you couldn't find a primary source for, marked as "needs internal decision" — not as "needs on-site visit."

CONSTRAINTS:
- Every factual claim must cite a public URL (CDC, MoEST, NEB, IEMIS portal, school websites, Ed-Fi documentation, Allen ISD).
- Do NOT hallucinate. If a piece of information isn't findable on the web, mark it "not found in public sources" and move on.
- Do NOT recommend "ask the customer." Recommend an internal engineering decision based on the evidence.
- Length target: 1500-2500 words.
- Use the Allen ISD framework as a structural reference; do not copy its specifics (Endorsements, AP/IB, ARD, etc.) unless they have a Nepal analog.
```

### What to do with the output

Save the AI's response as `docs/pilot-greenlight/a2-subject-vs-course-decision.md`. Engineer reviews Section 7 (Recommendation), validates citations in Sections 1-6, updates ticket A.2.x specs to match the recommended path, then begins coding.

---

## Prompt 2 — D.4.0: BLE (Grade 8) Workflow Design

**Engineering goal:** Design EdForge's entities + endpoints + admit-card template + IEMIS integration for the Grade 8 Basic Level Examination (BLE) workflow. Output target: `docs/pilot-greenlight/d4-ble-design.md`.

### Copy-paste into Gemini / Claude

```
ROLE: You are a senior software architect designing the school-side workflow for an external national exam in Nepal. The platform is a K-12 EMIS SaaS targeting Nepal PABSON private schools.

CONTEXT:
- The exam is BLE (Basic Level Examination, also called BEE — Basic Education Examination), Grade 8.
- Administered by local governments (municipalities / metropolitan cities), NOT by the National Examination Board (NEB) — that's a critical distinction.
- Annual, conducted in March (Chaitra in Bikram Sambat calendar).
- Final exam of basic education in Nepal; determines eligibility for Grade 9-10.
- Operates under CDC (Curriculum Development Centre) Basic Level Curriculum standards.
- Internal assessment 50% + External written exam 50% per CDC rubric.
- Grading: 4.0 GPA scale with letter grades A+, A, B+, B, C+, C, D+, D, E (NG = Not Graded, below 35%).
- IEMIS portal at https://emis.cehrd.gov.np/ is involved for some submissions.
- Students still promote to Grade 9 even with NG (BLE pass is NOT a legal gate, per Nepal Education Act).
- Existing platform has student records + enrollment + grade-level + tenant settings + Bikram Sambat date support.

WHAT WE'RE DESIGNING:
The school operator's full BLE workflow in EdForge:
(a) Register Grade 8 cohort with the municipality
(b) Enter CDC 50/50 internal assessment marks per subject per student
(c) Issue admit cards to students (school-issued, distributable as PDF)
(d) Receive results from municipality / IEMIS portal
(e) Apply promotion rule Grade 8 → Grade 9 (BLE pass NOT a gate; remedial support for NG students)

We need to support this for any Nepal municipality, not just one. We need entities, endpoints, and a PDF admit-card template.

RESEARCH QUESTIONS — answer each with public-source citation:

1. AUTHORITY STRUCTURE
   1.1 Confirm: each Nepal municipality / metropolitan city runs its own BLE independently? Cite the legal basis (Education Act, Local Government Operation Act, MoEST circular).
   1.2 Are there common standards across municipalities (CDC-mandated)? Find the CDC document.
   1.3 Who publishes the BLE question paper — the municipality directly, a regional body, or CDC?
   1.4 Who marks the answer sheets — the municipality, the school, or external graders?
   1.5 Find at least 2 separate municipalities' published BLE procedures (e.g., Kathmandu Metropolitan, Lalitpur Metropolitan, Pokhara Metropolitan, Dhanusha district municipalities, Madhesh province).

2. REGISTRATION PROCESS
   2.1 What's the exact registration flow? Schools submit application to municipality — paper, IEMIS portal, both?
   2.2 What student-level data does the registration require? List all fields.
   2.3 What's the registration deadline relative to the March exam? (Magh? Falgun?)
   2.4 Is there a registration fee? How much?
   2.5 Is there a per-student or per-school cap?
   2.6 Find sample registration forms published online by any municipality.

3. ADMIT CARD
   3.1 Who issues the BLE admit card — the school or the municipality?
   3.2 What's the admit-card format? Find sample images via Google Image Search or municipality websites.
   3.3 Standard fields on a BLE admit card: roll number, student name, photo?, school name, exam center, exam dates, subjects, signature blocks?
   3.4 Per-municipality variation: collect format samples from at least 3 different municipalities. Are they wildly different or roughly standardized?
   3.5 When is the admit card issued (relative to the March exam)?

4. INTERNAL ASSESSMENT (CDC 50/50 RUBRIC)
   4.1 What's the exact CDC rubric for the 50% internal assessment? Find the CDC document specifying the subcategories.
   4.2 Common breakdown: 25% attendance + class participation, 25% project / portfolio / oral? Verify.
   4.3 How does the school submit internal-assessment marks? Paper, IEMIS portal, both?
   4.4 What's the deadline for internal-assessment submission?
   4.5 Are there validation rules (e.g., minimum / maximum scores per category)?

5. EXTERNAL EXAM
   5.1 Where do students sit the BLE exam — at their school, at a municipal exam center, or both options exist?
   5.2 What subjects are tested? (Standard CDC Grade 8 subjects?) How many exam days?
   5.3 Question paper provenance (re-confirm Q1.3)
   5.4 Exam supervision and invigilation — municipal staff or school staff?

6. RESULT DELIVERY
   6.1 How does the school receive results — paper, IEMIS portal, both?
   6.2 What's the typical latency from exam → result (in weeks)?
   6.3 Result format: per-subject letter grade + GPA + cumulative? Or only per-subject?
   6.4 Sample result sheet — find images / PDFs online.

7. PROMOTION RULE & RE-EXAM
   7.1 Confirm: BLE pass is NOT a legal requirement for Grade 9 enrollment. Cite the source.
   7.2 What's the formal re-exam / Grade Increment policy for BLE (if any)?
   7.3 What remedial support is the school expected to provide for NG students?

8. IEMIS PORTAL INTERACTION
   8.1 Can a school admin register at https://emis.cehrd.gov.np/ ? What's required?
   8.2 What BLE-related submissions / downloads happen through IEMIS?
   8.3 Are there public screenshots / tutorials showing the BLE portal workflow?

9. ALLEN ISD STAAR ANALOG
   9.1 Briefly: how does Allen ISD register students for STAAR (the Texas state test analog)? What entities + workflow steps?
   9.2 What's the analog for the BLE admit card in Allen ISD's process?
   9.3 Use this only as a structural reference — do not copy specifics.

10. SAMPLE ARTIFACTS TO ARCHIVE
    10.1 List every publicly-downloadable BLE-related artifact you find: registration forms, admit cards, result sheets, CDC rubric docs, municipality circulars. Include the URL for each.
    10.2 Prioritize Kathmandu Metropolitan + 1-2 other municipalities for diversity.

OUTPUT FORMAT — produce a markdown document with this structure:

# D.4.0 Research — BLE (Grade 8) Workflow Design

## 1. Authority & Standards
[Q1 answers]

## 2. Registration Process
[Q2 answers; include sample form URLs]

## 3. Admit Card
[Q3 answers; include sample image URLs from 3+ municipalities]

## 4. Internal Assessment (CDC 50/50 Rubric)
[Q4 answers]

## 5. External Exam
[Q5 answers]

## 6. Result Delivery
[Q6 answers; include sample result URLs]

## 7. Promotion & Re-exam
[Q7 answers]

## 8. IEMIS Portal Interaction
[Q8 answers]

## 9. Allen ISD STAAR — Structural Reference
[Q9 answers, brief]

## 10. Sample Artifact Archive
[Q10 — list of URLs with description]

## 11. EdForge Engineering Recommendations
Based on the research, recommend:
- Entity shape for `ExternalExamRegistration` for BLE (fields, FKs, validation)
- Entity shape for `InternalAssessment` for BLE (per-subject, per-rubric-category)
- Entity shape for `ExternalExamAdmitCard` for BLE
- Entity shape for `ExternalExamResult` for BLE
- Endpoint design: registration submission, internal-assessment mark entry, admit-card render trigger, result import
- Per-municipality variation handling strategy (one schema vs municipality-specific overrides)
- Admit-card PDF template field list (what to render on the PDF)
- IEMIS portal integration strategy (CSV export to upload? API if exists? Manual?)

## 12. Open Questions / Confidence Caveats
List anything you couldn't find a primary source for. Mark as "needs internal decision based on best-available evidence" — NOT as "needs on-site visit."

CONSTRAINTS:
- Every factual claim must cite a public URL (municipality website, CDC document, MoEST circular, IEMIS portal, educational news sites like edusanjal.com / educatenepal.com / readersnepal.com).
- Do NOT hallucinate. If a piece of information isn't findable, mark it "not found in public sources" and move on.
- Do NOT recommend "ask the school" or "on-site visit." The design must be derivable from public sources.
- Length target: 2000-3500 words.
- The output should be precise enough that an engineer can use it directly to write Ed-Fi-aligned DynamoDB schemas + NestJS controllers + Handlebars admit-card template + IEMIS CSV export.
- Use Allen ISD as a STRUCTURAL reference only — do not bring Texas-specific concepts into the Nepal design.
```

### What to do with the output

Save the AI's response as `docs/pilot-greenlight/d4-ble-design.md`. Engineer reviews Section 11 (recommendations), validates citations in Sections 1-10, archives the sample-artifact URLs in `docs/pilots/<pilot-id>/external-exam-references/`, then updates tickets D.4.1-D.4.7 with concrete schemas + endpoints. Architecturally similar workflows for SEE (D.5) + NEB-11/12 (D.6) reuse the entity family.

---

## Prompt 3 — E.1.0: CEHRD Flash I / Flash II Report Schemas

**Engineering goal:** Design EdForge's `IEMIS_NPL_CEHRD_FLASH_I` and `IEMIS_NPL_CEHRD_FLASH_II` report templates — exact CSV/Excel column schemas, aggregation rules, submission cadence. Output target: `docs/pilot-greenlight/e1-flash-csv-schema.md`.

### Copy-paste into Gemini / Claude

```
ROLE: You are a senior data engineer designing CSV/Excel report templates for a Nepal-targeted K-12 EMIS SaaS. The reports must be CEHRD-compliant for annual submission to Nepal's central education database.

CONTEXT:
- CEHRD = Centre for Education and Human Resource Development, Nepal. Under MoEST. Established 2075 BS (2018 AD).
- CEHRD operates IEMIS (Integrated Education Management Information System) at https://emis.cehrd.gov.np/
- IEMIS captures Flash I + Flash II reports annually from every school in Nepal.
- Flash I = intake / enrollment report (typically captured early in academic year)
- Flash II = output / retention report (typically captured at end of academic year)
- Academic year in Nepal runs Baisakh (mid-April) → Chaitra (mid-March next year), using Bikram Sambat (BS) calendar.
- Schools include: government schools, community schools, private schools (PABSON / N-PABSON affiliated), boarding schools.
- Our platform will generate Flash I + Flash II as CSV (or Excel) files that the school's operator uploads to IEMIS, OR submits to municipality if that's the path.
- Data residency: AWS Mumbai (ap-south-1).

WHAT WE'RE DESIGNING:
Two CSV/Excel report templates:
- `IEMIS_NPL_CEHRD_FLASH_I` — annual intake / enrollment submission
- `IEMIS_NPL_CEHRD_FLASH_II` — annual output / retention submission

For each, we need: exact column list, data types, source-entity-in-EdForge mapping, aggregation rules, submission cadence + deadline. Also: any related forms (Form 7, Form 2, Form 19) that share the data model.

RESEARCH QUESTIONS — answer each with public-source citation:

1. CEHRD STRUCTURE & MANDATE
   1.1 What's CEHRD's exact mandate? Cite the founding ordinance / regulation.
   1.2 What's IEMIS, exactly? What datasets does it hold?
   1.3 What's the relationship between CEHRD, MoEST, and the local municipalities for Flash I/II submission flow? Does the school submit directly to CEHRD, to municipality, or both?

2. FLASH I — INTAKE / ENROLLMENT REPORT
   2.1 What exact data does Flash I capture? Column-by-column.
   2.2 Submission cycle: by what date in the academic year? Confirm.
   2.3 Format: CSV, Excel, IEMIS portal form, or all?
   2.4 Find the official Flash I template — is it downloadable from CEHRD or IEMIS?
   2.5 Find at least one historical Flash I report PDF published by CEHRD (annual reports for any recent year). Reverse-engineer the implied column list.

3. FLASH II — OUTPUT / RETENTION REPORT
   3.1 What exact data does Flash II capture? Column-by-column.
   3.2 Submission cycle: by what date in the academic year? Confirm.
   3.3 Format: same options.
   3.4 Official Flash II template URL.
   3.5 Historical Flash II report PDF URLs for reverse engineering.

4. AGGREGATION GRANULARITY
   4.1 Is Flash I per-school, per-municipality, per-district, or all three levels?
   4.2 Does the school report individual student rows, or aggregated counts?
   4.3 What dimensions are required: grade × gender × caste/ethnicity × religion × disability × scholarship status × mother-tongue × ...? List every dimension.

5. STUDENT-LEVEL DATA REQUIREMENTS
   5.1 If individual-student rows are submitted: what fields per student?
   5.2 EMIS ID: required? Format? Does each student have a unique EMIS ID across Nepal?
   5.3 PII handling: any redaction or pseudonymization rules?

6. SCHOOL-LEVEL DATA REQUIREMENTS
   6.1 What school-level metadata is required: emisSchoolCode, school type, level (basic / secondary / higher-secondary), management (public / private / community), language of instruction?
   6.2 Infrastructure data: classroom count, toilet count, water/electricity, library, ICT lab?
   6.3 Staff data: per-grade-level teacher count, qualification distribution, gender distribution?

7. RELATED MANDATORY FORMS
   7.1 Form 7: what is it, when submitted? Source.
   7.2 Form 2: what is it, when submitted? Source.
   7.3 Form 19 (disciplinary): what is it, soft or hard requirement? Source.
   7.4 Any other CEHRD / municipality forms a school must file annually?

8. IEMIS PORTAL DIRECT ACCESS
   8.1 Can a school register at https://emis.cehrd.gov.np/ as a verified school?
   8.2 What does the school dashboard look like? Find public screenshots / tutorials.
   8.3 Is there a documented IEMIS API (REST / SOAP)? If yes, find the docs.

9. ED-FI / TEA PEIMS REFERENCE (structural analog)
   9.1 In Texas, the TEA PEIMS reporting system collects similar enrollment + retention data from every school district. What's the structural shape of a PEIMS submission?
   9.2 What can we learn from PEIMS column design that informs the CEHRD Flash template design?
   9.3 This is reference only — do not copy PEIMS-specific concepts.

10. HISTORICAL CHANGES
    10.1 Has the Flash I / Flash II format changed in the last 5 years? If yes, what changed?
    10.2 Are there announced upcoming changes (digitization, dimension additions)?

OUTPUT FORMAT — produce a markdown document with this structure:

# E.1.0 Research — CEHRD Flash I / Flash II Report Schemas

## 1. CEHRD & IEMIS Structure
[Q1 answers]

## 2. Flash I Specification
[Q2 answers, including URL to official template if findable]

## 3. Flash II Specification
[Q3 answers, including URL to official template if findable]

## 4. Aggregation Granularity
[Q4 answers]

## 5. Student-Level Data
[Q5 answers]

## 6. School-Level Data
[Q6 answers]

## 7. Related Mandatory Forms
[Q7 answers]

## 8. IEMIS Portal Access & API
[Q8 answers; screenshots if findable]

## 9. PEIMS Structural Reference
[Q9 answers, brief]

## 10. Historical Changes
[Q10 answers]

## 11. Proposed Schema — `IEMIS_NPL_CEHRD_FLASH_I`
A markdown table with columns: ColumnName | DataType | Required | SourceEntity (in EdForge) | AggregationRule | Notes
Aim for 30-80 columns, the full Flash I shape.

## 12. Proposed Schema — `IEMIS_NPL_CEHRD_FLASH_II`
Same shape as Section 11. The Flash II columns.

## 13. Submission Cadence + Deadline
A small table per Flash report: report name | due date (BS + AD) | submission channel | acceptance evidence

## 14. EdForge Engineering Recommendations
- Template engine choice (Handlebars / template literal / other)
- Entity → CSV-row mapping pattern
- Aggregation Lambda design (cross-entity joins, GSI usage)
- Error handling for missing/incomplete data
- Version control of templates (when CEHRD updates the format)

## 15. Open Questions / Confidence Caveats
List anything you couldn't find. Mark as "needs follow-up via IEMIS portal registration" or "iterate post-MVP" — NOT "needs on-site visit."

## 16. Artifact URLs to Archive
List every Flash I/II PDF, template, screenshot, or form you found, with URLs. Engineer will download and store in repo for offline reference.

CONSTRAINTS:
- Every factual claim must cite a public URL (CEHRD, MoEST, IEMIS portal, official annual reports, educational news sites).
- Do NOT hallucinate column names. If you can't verify a column from a public source, mark it "inferred — needs IEMIS portal verification" but include it with that label.
- Do NOT recommend "ask the school." The schema must be derivable from public CEHRD documents + IEMIS portal inspection.
- Length target: 2500-4000 words.
- The output must be precise enough that an engineer can use it directly to write Handlebars CSV templates + DynamoDB aggregation Lambda code.
- Sections 11 + 12 (the proposed schemas) are the highest-priority sections — invest the most time there.
- Use PEIMS as a STRUCTURAL reference only.
```

### What to do with the output

Save the AI's response as `docs/pilot-greenlight/e1-flash-csv-schema.md`. Engineer reviews Sections 11 + 12 (the proposed schemas) — these become the column definitions in the `IEMIS_NPL_CEHRD_FLASH_I` and `IEMIS_NPL_CEHRD_FLASH_II` Handlebars / TypeScript templates. Engineer registers at https://emis.cehrd.gov.np/ to verify any "inferred" columns against the actual portal. Updates tickets E.1.1-E.1.7 with concrete schema.

---

## How to use these prompts effectively

1. **One prompt per session.** Don't paste all three into one chat — the context window + research depth degrades. Run each separately.
2. **Use the web-search-enabled AI** (Gemini Search, Claude with web search enabled). Plain LLM without web access will hallucinate URLs.
3. **Verify spot-citations.** Open 3-5 of the cited URLs from each output. If the URL is broken or the content doesn't match the claim, ask the AI to re-research with the correction.
4. **Save the raw output verbatim** to the target `.md` file. Don't edit prose before committing.
5. **Engineer's review pass** is a separate step: open the artifact, validate the recommendations against `v1-master-framework.md` + `v1-master-epic-breakdown.md`, then update the engineering ticket spec.
6. **Iterate.** If the artifact has gaps, refine the prompt and re-run. Don't proceed to code until the artifact's recommendations section is concrete enough to map to entity fields + endpoint shapes.

---

## Why these prompts are structured this way

- **Self-contained context** — each prompt explains EdForge, Nepal context, Ed-Fi V6, Allen ISD reference, so the AI doesn't need our repo
- **Specific numbered questions** — forces granular answers, prevents handwaving
- **Citation requirement** — every claim has a public URL; engineer can verify
- **Anti-hallucination constraints** — explicit "if not findable, mark it so" rule
- **No-on-site-visit constraint** — research must be derivable from public sources
- **Allen ISD as structural reference only** — prevents copying Texas-specific concepts into Nepal design
- **Output format prescribed** — markdown structure drops directly into the target artifact
- **Engineering recommendations section** — forces the AI to map research → schema/endpoint design, not just narrate facts
- **Length target** — prevents both too-thin and too-bloated output

If the AI produces an artifact that doesn't meet these constraints, re-prompt with: "You skipped citation in Section X. Re-research that section with public URLs only."

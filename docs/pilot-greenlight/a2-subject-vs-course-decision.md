# A.2.0 Research — Subject vs Course Decision for EdForge Nepal Archetype

## 1. CDC Curriculum Organization

The Curriculum Development Centre (CDC) under the Ministry of Education, Science and Technology (MoEST) mandates the national curriculum structure. Based on the National Curriculum Framework (NCF) 2076 BS (2019 AD), the 13-year school education system is structured as follows:

* **1.1 Subject Structure by Grade Band:**
* **Basic Level (Grades 1-8):** Divided into two pedagogical approaches. Grades 1-3 utilize a fully integrated curriculum, meaning subjects are blended into thematic areas rather than isolated disciplines. Grades 4-8 pivot to a traditional subject-based curriculum (English, Nepali, Mathematics, Science, Social Studies, etc.).
* **Secondary Level (Grades 9-10):** This tier is heavily specialized for the Secondary Education Examination (SEE). Students take 8 subjects: 6 compulsory (English, Nepali, Mathematics, Science, Social Studies, and Health/Population/Environment) and 2 optional/elective subjects.
*(Source: [National Curriculum Framework 2076 Overview - Prezi](https://prezi.com/p/fsa7l56jhgqm/curriculum-development-in-nepal/), [Nepal Country Profile - Zenodo](https://zenodo.org/records/5517504/files/FINAL%20Nepal%20country%20profile.pdf?download=1))*


* **1.2 Canonical Subject Lists & Codes:**
CDC publishes comprehensive syllabi but does not distribute a canonical, machine-readable developer taxonomy or API. However, the official subject lists act as the taxonomy. For example, the Grade 8 curriculum strictly enumerates core subjects: Compulsory English, Nepali, C. Mathematics, Science, Social Studies, and Environment, Population & Health (EPH). Optional subjects typically include Opt. Mathematics, Economics, and Computer Science.
*(Source: [PABSON Curriculum Plan 2075](https://www.scribd.com/document/455203495/Syllabus-2075-FINAL-2-pdf))*
* **1.3 Curriculum Sequencing Differences:**
* **Grades 1-3 (Integrated):** Learning is assessed against competencies and themes rather than discrete academic subjects.
* **Grades 4-8 (Subject-Based):** Evaluated through standard subject-level examinations (like the District Level Basic Level Examination - BLE at Grade 8).
* **Grades 9-10 (SEE Prep):** Evaluated via the national SEE board. The curriculum is entirely partitioned by subject silos to match the SEE exam structure.
*(Source: [Education Review Office - NASA Framework](https://giwmscdntwo.gov.np/media/pdf_upload/Assessmet%20framework%205%20_2025_zj0dux7.pdf))*


* **1.4 Grade 11-12 Post-2025 Reform:**
Under the new NCF, the older "stream" system (Science, Management, Humanities) was replaced by a standardized core plus electives. Grade 11 and 12 students must take three compulsory subjects: Compulsory English, Compulsory Nepali, and either Compulsory Social Studies & Life Skills OR Compulsory Mathematics. They must then select three additional elective subjects from defined groups (e.g., Physics, Accounting, Computer Science).
*(Source: [Nuffic - Primary and Secondary Education in Nepal](https://www.nuffic.nl/en/education-systems/nepal/primary-and-secondary-education))*

## 2. Ed-Fi V6 Subject/Course Model

To ensure EdForge aligns with modern data interoperability standards, we must look at how the Ed-Fi Alliance handles this architectural boundary.

* **2.1 Subject as an Entity vs. Descriptor:**
In the Ed-Fi V6 Data Model, there is **no separate `Subject` resource entity**. Instead, academic subjects are treated as classifications on courses. The model uses an `AcademicSubjectDescriptor` (e.g., "Mathematics", "Science") which is attached to the `Course` entity and the `LearningStandard` entity.
*(Source: [Ed-Fi Teaching and Learning Domain Docs](https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/teaching-and-learning-domain/entities-references-and-descriptors/))*
* **2.2 Relationship Hierarchy:**
Ed-Fi maps the structural hierarchy as follows:
* **(a) Academic Subject:** Handled via the `AcademicSubjectDescriptor`.
* **(b) Course Offering:** The `Course` entity represents the curriculum definition (e.g., "Compulsory English 10"). The `CourseOffering` entity ties a `Course` to a specific `School` for a specific `Session`.
* **(c) Section & Teacher:** The `Section` entity represents the actual classroom instance. Teachers are linked via `StaffSectionAssociation`, and students via `StudentSectionAssociation`.
*(Source: [Ed-Fi Survey & Teaching Domain Docs](https://docs.ed-fi.org/reference/data-exchange/data-standard/4/model-reference/survey-domain/entities-references-and-descriptors/))*


* **2.3 Mark Entry Representation:**
Exam mark entry per subject is modeled using the `Grade` entity within the Student Academic Record Domain. Grades are assigned to a `StudentSectionAssociation` for a specific `GradingPeriod`. Because the `Section` maps back to a `Course` (which has an `AcademicSubjectDescriptor`), the system can aggregate grades by subject without needing a standalone Subject table. For competency-based models (like Nepal's Grade 1-3), Ed-Fi utilizes the `LearningStandardGrade` array on the `Grade` entity.
*(Source: [Ed-Fi Student Academic Record Best Practices](https://docs.ed-fi.org/reference/data-exchange/data-standard/model-reference/student-academic-record-domain/best-practices/))*

## 3. Allen ISD Reference

Allen ISD serves as an excellent structural reference for organizing complex, multi-tiered course catalogs without bloated schemas.

* **3.1 Subject Encoding in Catalogs:**
In their Middle School Academic Planning Guide (APG), Allen ISD groups courses by high-level curriculum areas (English/Language Arts, Mathematics, Science) but does not expose a database-level "Subject" entity. The subject is intrinsically tied to the course grouping and encoded directly into the `Course Code`.
*(Source: [Allen ISD Middle School Academic Guide](https://www.scribd.com/document/878186395/Middle-School-2024-2025-APG-Official-Final))*
* **3.2 Course Code Legend ("LA1D7A"):**
Course codes in Allen ISD are dense, structured strings that embed multiple dimensions of metadata. For a code like "LA1D7A" (English 7):
* `LA`: Identifies the Subject Area (Language Arts).
* `1D` / `1E`: Denotes the academic track or tier (e.g., regular vs. advanced).
* `7`: Denotes the Grade Level.
* `A`: Denotes the semester (A for Fall, B for Spring).
This allows the SIS to extract the subject dynamically via string prefix parsing rather than a relational join.
*(Source: [Allen ISD Academic Planning Guide 21-22](https://files-backend.assets.thrillshare.com/documents/asset/uploaded_file/3952/Fms/d127552e-ef59-481c-b703-b150aafae233/Academic_Planning_Guide_2021-2022.pdf?disposition=inline))*


* **3.3 No Separate Subject Entity for Standards:**
Allen ISD aligns with Texas state standards (TEKS). They do not maintain a separate "Subject" table to map to TEKS; rather, TEKS learning standards are mapped directly to the `Course` definitions.

## 4. PABSON School Practice

PABSON (Private and Boarding Schools' Organisation Nepal) schools require a data model that can handle rigorous local compliance alongside premium international offerings.

* **4.1 Naming Conventions and Syllabi:**
PABSON schools strictly adhere to CDC guidelines for local tracks but translate them for English-medium instruction. For instance, the PABSON Kathmandu curriculum plan lists "C. Mathematics" (Compulsory Mathematics), "Science", "Social Studies", and "EPH". Schools like Gyandeep Vidyashram Secondary School publish identical core lists. The nomenclature is highly standardized across the archetype.
*(Source: [Gyandeep Vidyashram Profile](https://edusanjal.com/school/gyandeep-secondary-school/), [PABSON Curriculum Plan 2075](https://www.scribd.com/document/455203495/Syllabus-2075-FINAL-2-pdf))*
* **4.2 Curriculum Mapping vs. Teacher Assignment:**
In practice, PABSON schools map curriculum tightly to the exam schedule. The "Subject" is simply the header on the exam paper. Teacher assignment is handled at the section level (e.g., "Section 8A gets Teacher X for Science"). The implicit relationship is `Teacher -> Section -> Course (Science 8)`.
* **4.3 International Equivalency:**
For schools offering international tracks, local equivalency is a manual mapping process for higher education admission, but within the school's daily operations, Cambridge subjects and CDC subjects are treated as distinct academic courses operating on parallel schedules.

## 5. Cambridge / IB Parallel Tracks

To support elite PABSON schools, EdForge must handle multi-track curriculum topologies.

* **5.1 Parallel Syllabi:**
Cambridge IGCSE and CDC SEE-prep are taught as entirely different syllabi. While both might offer "Mathematics" to 14-year-olds, the content, sequencing, and assessment frameworks are vastly different. Cambridge IGCSE Core Mathematics (Topics: Vectors, Transformations, Probability) does not map 1:1 with CDC Compulsory Math. They are distinct courses, not two flavors of the same subject.
*(Source: [Cambridge IGCSE Core Mathematics Syllabus](https://dokumen.pub/cambridge-igcse-core-mathematics-4th-edition-4nbsped-1510421661-9781510421660.html))*
* **5.2 Database Differentiation:**
In a single multi-tenant DB, "Mathematics CDC Grade 8" and "Mathematics Cambridge Stage 8" must be instantiated as two completely separate `Course` records. They may share an `AcademicSubjectDescriptor` of "Mathematics" for high-level dashboard filtering, but their credits, prerequisites, and grade mappings must remain isolated to prevent data contamination.

## 6. NEB / IEMIS Subject Codes

* **6.1 Canonical NEB Subject Codes:**
The National Examinations Board (NEB) does utilize canonical subject codes for exam registration. For example, the newly updated "Compulsory English" for Grade 12 uses the subject code `004` (often appended with set codes like `0041` for exam papers).
*(Source: [Grade 12 English Curriculum Overview](https://www.scribd.com/document/931373571/Syllabus-Compulsory-English-Grade-12-Docx-copy))*
* **6.2 IEMIS Subject Taxonomy:**
The government IEMIS (Educational Management Information System) portal tracks student achievements using these strict subject definitions. Large-scale assessments like the National Assessment of Student Achievement (NASA) for Grade 10 rely on standardized coding for Mathematics, Science, English, and Nepali to run Item Response Theory (IRT) analytics.
*(Source: [National Assessment of Student Achievement 2023 - MAIN REPORT](https://giwmscdnone.gov.np/media/pdf_upload/NASA%2010%20REport%20for%20press%20dec%2029_jfzz7ya.pdf))*

## 7. Recommendation

**I recommend Option (B): Extend `Course` with structured `subjectCode` + `curriculumRef` (no new entity).**

**Rationale & Architectural Impact:**
From a multi-tenant SaaS and serverless AWS perspective, introducing a standalone `Subject` entity creates an unnecessary bounded context boundary that will require constant, heavy JOINs (or DynamoDB `BatchGetItem` round-trips) for every section load, gradebook render, and report card generation.

By adopting Ed-Fi V6's philosophy—treating the Subject as a descriptor property of the Course—we achieve high cohesion and lower latency.

1. **Ed-Fi V6 Alignment Cost:** This strategy yields 100% alignment with the Ed-Fi V6 standard, which utilizes `AcademicSubjectDescriptor` on the `Course` object. Attempting to force a relational `Subject` entity would violate the Ed-Fi specification.
2. **Cleanliness of Mark Entry (BLE/SEE/NEB):** Grades are attached to the `Section` (via Ed-Fi's `Grade` and `StudentSectionAssociation`). To generate a SEE exam report, the backend queries the student's enrollments, expands the related `Course`, and extracts the `subjectCode` (e.g., `004`) to format the official NEB export. No intermediary table is required.
3. **Multi-track (CDC + Cambridge) Handling:** Cambridge Math and CDC Math are simply two `Course` records. They can be filtered on the frontend using `curriculumRef`. This provides the flexibility to assign entirely different grading scales to the Cambridge course without impacting the CDC course logic.
4. **Migration Cost:** Modifying the existing `Course` entity in NestJS/DynamoDB is a low-effort, backward-compatible schema migration. We only need to add a few string attributes and potentially a Global Secondary Index (GSI) on `curriculumRef` for tenant-level curriculum filtering.

**Schema Sketch (DynamoDB / NestJS DTO representation):**

```typescript
interface Course {
  id: string;                      // PK
  tenantId: string;                // SK (AWS SBT Multi-tenant isolation)
  code: string;                    // Local school code (e.g., "MATH-8-CDC")
  name: string;                    // "Compulsory Mathematics Grade 8"
  
  // -- NEW FIELDS FOR SUBJECT HANDLING --
  academicSubject: string;         // Enum/Descriptor: "mathematics" | "science"
  stateSubjectCode?: string;       // NEB/CDC code (e.g., "004" for English)
  curriculumRef: CurriculumType;   // Enum: "CDC_NCF_2076" | "CAMBRIDGE_IGCSE" | "IB_MYP"
  
  // -- EXISTING FIELDS --
  gradeLevels: string[];           // ["Grade 8"]
  credits: number;
  prerequisites: string[];
}

```

## 8. Open Questions / Confidence Caveats

* **IEMIS API / Taxonomy Accessibility:** While we know NEB and IEMIS use specific codes (like `004` for Grade 12 English), there is no publicly accessible, machine-readable JSON dictionary of all IEMIS subject codes available on the web. *Needs internal decision: Do we manually scrape and seed this taxonomy per tenant, or allow school admins to type in their state reporting codes?*
* **Grades 1-3 Integrated Curriculum Grading:** How PABSON schools map the "Integrated" themes into a structured database gradebook is not clearly documented in public technical sources. *Needs internal decision: Should Grades 1-3 utilize standard `Course` grading, or pivot to Ed-Fi `LearningStandardGrade` arrays to track specific developmental competencies?*

---

For more context on how the NEB subject codes are applied in practical exam settings, you can check out this [NEB Grade 12 English Exam Solution](https://www.youtube.com/watch?v=_zaO6Tn-z04). This walk-through of the exam paper clearly demonstrates how the 004 subject code is utilized on official test materials in Nepal.
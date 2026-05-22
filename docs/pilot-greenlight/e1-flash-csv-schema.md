# E.1.0 Research — CEHRD Flash I / Flash II Report Schemas

## 1. CEHRD & IEMIS Structure

* **1.1 CEHRD Mandate:** The Centre for Education and Human Resource Development (CEHRD) was established under the Ministry of Education, Science and Technology (MoEST) to oversee educational planning, management, and resource deployment across Nepal. Its mandate includes the collection, integration, and analysis of educational data to ensure equitable access and quality in the school education system. *(Source: [Flash I Report 2081 - CEHRD](https://giwmscdnone.gov.np/media/pdf_upload/Flash%201%20Report%202081%20Final_rn76ynj.pdf))*
* **1.2 IEMIS Overview:** The Integrated Educational Management Information System (IEMIS) is the centralized, web-based database operated by CEHRD. It tracks comprehensive datasets including School Profiles (infrastructure, SMC/PTA details), Student Information (demographics, enrollment, scholarships, attendance, exam results, and transitions), and Staff Data (teacher qualifications, experience, and training). *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*
* **1.3 Submission Flow:** Following Nepal's federalization, the workflow is decentralized. Schools (Community, Institutional/Private, and Religious) enter or upload their data directly into the IEMIS web portal. However, they operate under the supervision of their respective Local Levels (Municipalities). The Local Level verifies the data and facilitates school code generation, while CEHRD manages the central repository and produces the national Flash Reports. *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*

## 2. Flash I Specification

* **2.1 Data Captured (Intake/Enrollment):** Flash I serves as the beginning-of-year census. It captures initial student enrollment (disaggregated by grade, gender, caste/ethnicity, and disability), ECED (Early Childhood Education and Development) experience of Grade 1 entrants, teacher deployments (permanent, temporary, relief quota), textbook availability, and the baseline physical infrastructure (classrooms, toilets, internet, drinking water) of the school.
* **2.2 Submission Cycle:** Flash I data must be updated and submitted early in the academic year. Official CEHRD directives typically mandate the completion of Flash I updates by the end of **Jestha** (mid-June), approximately two months after the academic year begins in Baisakh. *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*
* **2.3 Format:** Data is submitted via the web-based portal at https://emis.cehrd.gov.np. For bulk data entry, the portal allows downloading an Excel (.xlsx) template, populating it locally, and uploading it back to the system.
* **2.4 Official Template:** The exact Excel template is locked behind the IEMIS login portal and is dynamically generated per school. However, CEHRD provides public Excel sheets for specific modules, such as Teacher Data. *(Source: [CEHRD Teacher Data Excel](https://cehrd.gov.np/content/13693/regarding-the-teacher-s-details-to-make-truthfulness-/))*
* **2.5 Historical Reports:** The [Flash I Report 2081 (2024/25)](https://giwmscdnone.gov.np/media/pdf_upload/Flash%201%20Report%202081%20Final_rn76ynj.pdf) and [Flash I Report 2080](https://opendatanepal.com/datasets/flash-i-report-2080-2023-24) reveal the implied schema: distinct tables for age-wise enrollment, caste (Dalit, Janajati), disabilities (physical, visual, auditory, intellectual), and teacher qualifications.

## 3. Flash II Specification

* **3.1 Data Captured (Output/Retention):** Flash II is the end-of-year census. It evaluates internal efficiency by capturing student academic status (Passed, Passed & Transfer, Repeated, Repeated & Transfer, or Dropout), final exam results, scholarship distribution, and accumulated attendance records for the year. *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*
* **3.2 Submission Cycle:** Flash II is collected at the conclusion of the academic year, typically in **Chaitra** (mid-March) or early Baisakh of the subsequent year.
* **3.3 Format:** Identical to Flash I, it relies on the web-based IEMIS portal UI or bulk Excel uploads.
* **3.4 Official Template:** Locked behind the school login on the IEMIS portal.
* **3.5 Historical Reports:** While Flash II full public PDFs are less frequently syndicated than Flash I, the ASIP/AWPB implementation plans refer strictly to Flash II for retention metrics (promotion, repetition, dropout rates). *(Source: [ASIP & AWPB Document](https://www.globalpartnership.org/node/document/download?file=sites/default/files/2019-05-nepal-implementation-plan-ssdp.pdf))*

## 4. Aggregation Granularity

* **4.1 Reporting Level:** The data is entered at the **individual student and teacher level** by the school. IEMIS then aggregates this data upward to produce school-level, municipality-level, provincial, and national Flash reports.
* **4.2 Row Level:** Schools upload individual student rows via the Excel template (or manage them individually in the UI).
* **4.3 Dimensions Required:** Aggregations demand strict tagging on every student record. Required dimensions include: Grade Level, Gender, Age/DOB, Caste/Ethnicity (Dalit, Janajati, Brahmin/Chhetri, Others), Disability type, Scholarship Status, and Mother-tongue. *(Source: [Flash I Report 2081](https://giwmscdnone.gov.np/media/pdf_upload/Flash%201%20Report%202081%20Final_rn76ynj.pdf))*

## 5. Student-Level Data

* **5.1 Fields per Student:** First Name, Last Name, Date of Birth (BS), Gender, Caste/Ethnicity, Mother Tongue, Disability Status, Previous School (if transferred), ECED Experience (for Grade 1), Current Grade, Stream (for Grades 11-12).
* **5.2 EMIS ID:** Each student in Nepal receives a unique, system-generated tracking ID upon their first entry into IEMIS (usually in ECED or Grade 1). This ID tracks them across transfers between schools.
* **5.3 PII Handling:** IEMIS holds raw PII. However, public Flash Reports published by CEHRD aggregate the data and entirely redact PII. Schools must submit full PII to the portal.

## 6. School-Level Data

* **6.1 Metadata:** 9-digit IEMIS School Code, School Name, School Type (Community, Institutional, Religious), Level (Basic, Secondary), Ecological Belt (Mountain, Hill, Terai), and Province/District/Municipality mapping.
* **6.2 Infrastructure:** Tracked in the "Infras. Inventory Menu". Includes building count, classroom count, separate toilets for girls/boys, drinking water, electricity, library, and ICT/computer lab availability.
* **6.3 Staff Data:** Tracked under the "Teacher Details" module. Captures Qualification (SLC, +2, Bachelor, Master), Training status, Employment Type (Permanent, Temporary, Relief Quota/Rahat), and Gender. *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*

## 7. Related Mandatory Forms

* **7.1 Form 7:** Not found in public sources related to Nepal's CEHRD context.
* **7.2 Form 2:** Not found in public sources related to Nepal's CEHRD context.
* **7.3 Form 19:** Not found in public sources related to Nepal's CEHRD context.
* **7.4 Other Forms:** The primary external mandates are the physical facility assessments and SMC/PTA formation logs, all of which have been absorbed into the central IEMIS portal tabs rather than remaining as standalone paper forms.

## 8. IEMIS Portal Access & API

* **8.1 Registration:** A school cannot arbitrarily register online. A newly established school must apply through its Local Level (Municipality), which verifies the school and issues the official 9-digit IEMIS code required for login.
* **8.2 Dashboard:** The web UI consists of a sidebar with modules: School Profile, Staff/Teacher Info, Student Information, Manage Exam, Infras. Inventory, and SMC/PTA Menu. *(Source: [CEHRD Notice on IEMIS Update](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/))*
* **8.3 API:** There is **no documented, publicly available REST or SOAP API** for third-party SIS/EMIS systems to push data directly to IEMIS. All interoperability relies on the school admin exporting an Excel/CSV file from EdForge and manually uploading it to the IEMIS portal.

## 9. PEIMS Structural Reference

* **9.1 PEIMS Shape:** The Texas Education Agency (TEA) PEIMS system relies on discrete data categories (Organization, District Finance, Staff, Student Demographics, Student Attendance, Course Section). Submissions occur in specific windows (Fall, Mid-Year, Summer, Extended Year).
* **9.2 Structural Lesson:** PEIMS separates demographic baseline data (Fall) from outcome data like attendance and grades (Summer). IEMIS follows this exact logical split with Flash I (baseline/intake) and Flash II (outcomes/retention). Our templates must treat Flash I as an upsert of entity state, and Flash II as an append of transactional outcomes (attendance/grades).

## 10. Historical Changes

* **10.1 Last 5 Years:** The most significant shift has been the move from offline, macro-enabled Excel workbooks (which schools manually carried on USB drives to district resource centers) to a fully centralized web portal. Additionally, the governance structure shifted post-2015 Constitution, placing municipalities (Local Levels) as the primary enforcers of IEMIS updates rather than district education offices. *(Source: [SSDP TA Facility Report](https://www.britishcouncil.org.np/sites/default/files/ssdp_ta_cidp-_final_march_2020.pdf))*
* **10.2 Upcoming Changes:** CEHRD is actively embedding AI and predictive analytics into IEMIS, focusing on dropout forecasting, as well as integrating GIS mapping for school infrastructure. *(Source: [UNICEF IEMIS TOR](https://www.unicef.org/nepal/media/27096/file/Annex%20B%20%20Terms%20of%20Reference.pdf.pdf))*

---

## 11. Proposed Schema — IEMIS_NPL_CEHRD_FLASH_I (Student Baseline/Intake)

This CSV schema represents the student-level upload required early in the academic year.

| ColumnName | DataType | Required | SourceEntity (in EdForge) | AggregationRule | Notes |
| --- | --- | --- | --- | --- | --- |
| school_iemis_code | String | Yes | Tenant.iemisCode | Group by Tenant | 9-digit national school code |
| academic_year_bs | String | Yes | Session.yearBS | Filter by Session | Format: "2082" |
| student_iemis_id | String | No | Student.stateId | None | Blank for new ECED/Grade 1 intakes; required for upper grades |
| first_name | String | Yes | Student.firstName | None |  |
| last_name | String | Yes | Student.lastName | None |  |
| dob_bs | String | Yes | Student.dobBS | Age calculate | Format: YYYY-MM-DD (Bikram Sambat) |
| gender | Enum | Yes | Student.gender | Sum by Gender | M, F, O |
| caste_ethnicity | Enum | Yes | Student.caste | Sum by Caste | Dalit, Janajati, Brahmin/Chhetri, Others |
| mother_tongue | String | Yes | Student.motherTongue | Sum by Language | Inferred — needs IEMIS portal verification |
| disability_type | Enum | No | Student.disability | Sum by Disability | None, Physical, Visual, Auditory, Intellectual |
| grade_level | String | Yes | Enrollment.gradeLevel | Group by Grade | ECED, 1 through 12 |
| stream | String | No | Enrollment.track | Group by Stream | For Grades 11-12 (e.g., Science, Management) |
| enrollment_type | Enum | Yes | Enrollment.type | Sum by Type | New, Promoted, Transfer_In |
| has_eced_exp | Boolean | No | Student.ecedExperience | Sum by ECED Exp | Required only for Grade 1 students |

## 12. Proposed Schema — IEMIS_NPL_CEHRD_FLASH_II (Student Outcomes/Retention)

This CSV schema appends performance and attendance data to the cohort at the end of the year.

| ColumnName | DataType | Required | SourceEntity (in EdForge) | AggregationRule | Notes |
| --- | --- | --- | --- | --- | --- |
| school_iemis_code | String | Yes | Tenant.iemisCode | Group by Tenant |  |
| academic_year_bs | String | Yes | Session.yearBS | Filter by Session |  |
| student_iemis_id | String | Yes | Student.stateId | Match to Flash I | Must exist in IEMIS by year-end |
| grade_level | String | Yes | Enrollment.gradeLevel | Group by Grade |  |
| total_attendance_days | Number | Yes | Attendance.presentDays | Average by Grade | Cumulative days present in the year |
| scholarship_type | Enum | No | Student.scholarship | Sum by Scholarship | Dalit, Female, Martyr, Poor, None |
| scholarship_amount | Number | No | Student.scholarshipAmt | Sum Total | Inferred — needs IEMIS portal verification |
| exam_total_marks | Number | Yes | Gradebook.total | Average / Band | Final exam aggregate |
| exam_gpa | Number | No | Gradebook.gpa | Average |  |
| academic_status | Enum | Yes | Enrollment.endStatus | Sum by Status | Passed, Passed & Transfer, Repeated, Repeated & Transfer, Dropout |

## 13. Submission Cadence + Deadline

| Report Name | Due Date (BS / AD) | Submission Channel | Acceptance Evidence |
| --- | --- | --- | --- |
| **Flash I (Intake)** | End of Jestha (mid-June) | IEMIS Portal (Web UI or Excel Upload) | Portal status changes to "Verified" |
| **Flash II (Retention)** | End of Chaitra (mid-March) | IEMIS Portal (Web UI or Excel Upload) | Portal status changes to "Verified" |

## 14. EdForge Engineering Recommendations

* **Template Engine Choice:** Use a fast stream-based CSV writer like csv-stringify for Node.js over Handlebars. Generating a 2,000-row CSV with Handlebars risks memory bloat in Lambda.
* **Entity Mapping Pattern:** Create a CEHRD_Export_Service. Flash reports require flattening relational data (Student -> Enrollment -> Attendance -> Grades). Use DynamoDB's Single Table Design to fetch the Student partition and all related items in a single query, then map the DTO to the CSV columns.
* **Date Handling (BS to AD):** The system must natively store or accurately calculate Bikram Sambat dates. CEHRD strictly expects DOBs and Academic Years in BS format. Relying on AD-to-BS conversion on the fly for thousands of rows could introduce leap-year drift.
* **Error Handling:** Implement a pre-flight validation UI. Before allowing the school admin to download the CSV, run a validation pass (e.g., "Missing IEMIS ID for 15 students in Grade 8") and surface the errors in a data-grid. IEMIS will reject the entire Excel upload if row-level validation fails.
* **Versioning:** CEHRD frequently modifies the Excel headers. Store the export schema mappings as JSON configurations in S3 or DynamoDB, allowing rapid deployment of template fixes without requiring a full backend redeployment.

## 15. Open Questions / Confidence Caveats

* **Exact Excel Header Row Text:** The exact string values for the CSV/Excel headers (e.g., Student Name vs student_name vs Name) are locked inside the portal. *Needs follow-up via IEMIS portal registration with a pilot school to download the blank template.*
* **Granular Scholarship Fields:** Whether scholarship amounts are required per student or just a boolean flag. *Inferred — needs IEMIS portal verification.*
* **Forms 7, 2, 19:** *Not found in public sources* in relation to Nepal's modern CEHRD. These might be legacy district-level forms replaced by the web portal.

## 16. Artifact URLs to Archive

* **Flash I Report 2081 (PDF):** [https://giwmscdnone.gov.np/media/pdf_upload/Flash%201%20Report%202081%20Final_rn76ynj.pdf](https://giwmscdnone.gov.np/media/pdf_upload/Flash%201%20Report%202081%20Final_rn76ynj.pdf)
* **CEHRD Notice on IEMIS Update (Requirements List):** [https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/](https://edusanjal.com/news/cehrd-notice-to-all-local-levels-and-schools-to-update-iemis/)
* **SSDP TA Facility Report (Context & History):** [https://www.britishcouncil.org.np/sites/default/files/ssdp_ta_cidp-_final_march_2020.pdf](https://www.britishcouncil.org.np/sites/default/files/ssdp_ta_cidp-_final_march_2020.pdf)
* **UNICEF IEMIS TOR (Future state of IEMIS):** [https://www.unicef.org/nepal/media/27096/file/Annex%20B%20%20Terms%20of%20Reference.pdf.pdf](https://www.unicef.org/nepal/media/27096/file/Annex%20B%20%20Terms%20of%20Reference.pdf.pdf)
* **CEHRD Support Portal (Manuals):** [https://ess.cehrd.gov.np/]()
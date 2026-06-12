# Demo seed spec (Sprint S1)

The public-alpha demo data engine populates a tenant with a complete, realistic
school so a prospect can experience the product end-to-end (D1 + D4). This is the
prose companion to the **machine-checkable** spec — the per-archetype roster
configs at
[`packages/pilot-fixtures/demo/<archetype>-roster.json`](../../packages/pilot-fixtures/demo/),
validated by [`roster-config.ts`](../../packages/pilot-fixtures/src/demo/roster-config.ts)
and its conformance test.

## Why a spec + generator (not static JSON)

D4 calls for **two fully-populated K-12 schools, 200 students each** (one PABSON
/ Nepal, one GENERIC / US). Hand-authoring ~430 student rows plus staff, courses,
sections, exams, marks, invoices, and payments would be unreviewable and
unmaintainable. Instead each archetype has a ~120-line **roster config** (the
spec) that a **deterministic, seeded generator** (S1.2–S1.9) expands into the
full entity set, which the loader (S1.10) POSTs into a tenant. Determinism makes
the output testable (same seed → identical roster) and the spec keeps the intent
reviewable.

## The two archetypes

| | PABSON (`pabson-roster.json`) | GENERIC (`generic-roster.json`) |
|---|---|---|
| Country / locale / currency | NPL / `ne-NP` / NPR | USA / `en-US` / USD |
| Calendar | Bikram Sambat | Gregorian |
| Name pool | Nepali | US |
| Grade ladder | NUR, LKG, UKG, 1–10 (13) | K, 1–12 (13) |
| Students | 200 | 200 |
| Staff | 16 (covers every ABAC role) | 16 (covers every ABAC role) |
| Exam cycle | First Terminal Exam (Theory/Practical/Internal) | Fall Semester Final (Final/Midterm/Coursework) |

All grade codes are drawn from the canonical
[`ORDERED_GRADES`](../../packages/shared-types/src/schemas/identity/grade-levels.ts)
catalogue so the loader's school-create payloads validate.

## Entity coverage (the complete demo)

The generator produces, per school, in dependency order:

1. **School** — `schoolType: k12`, reserved synthetic `emisSchoolCode` (see below).
2. **Academic year + terms** — one AY with grading periods.
3. **Grade levels + sections** — every grade with ≥1 section.
4. **Staff users + role assignments** — Principal, Vice-Principal, Accountant,
   Counselor, Nurse, Staff, and ~10 Teachers. The union across both schools
   covers every role in `DEFAULT_ROLE_PERMISSIONS` (asserted in S1.1/S1.5).
5. **Students + enrolments** — 200 students distributed across sections, each
   enrolled into its grade + course-sections. Student + Parent ABAC roles come
   from student/guardian users.
6. **Courses** — per-grade subjects from the band catalogue, each taught by a
   teacher.
7. **Exam cycle** — one exam with weighted components, **marks for every
   enrolled student**, and **published result cards**.
8. **Finance** — grade-scaled tuition + flat fees (admission/exam/transport),
   generated invoices, and a paid / partially-paid / unpaid payment mix.

## Safety: reserved EMIS code band

Real IEMIS school codes are government-assigned 8–10 digit numbers. PABSON
school-create *requires* an 8–10 digit `emisSchoolCode`, so demo schools use the
implausible reserved band `9999NNNN` (`DEMO_EMIS_CODE_RE`). Combined with the
`isDemo` tenant flag (S3.1), demo data is never part of an IEMIS submission and a
demo `emisSchoolCode` can never collide with a real school's. The S3.9 safety
scan asserts this.

## Cross-field invariants (enforced at load)

`loadRosterConfig()` throws on schema failure **and** on any of these
(`rosterInvariantViolations`), so a malformed spec fails loudly rather than
producing a broken seed:

- exam component weights sum to exactly 100%;
- fee `paymentMix` sums to exactly 100%;
- every course band's grade codes exist, and every grade is covered by exactly
  one band (so no section is course-less);
- every required school role has staff ≥ 1;
- there is enough section capacity to seat all target students.

## Adding an archetype

Drop a new `<archetype>-roster.json` under `packages/pilot-fixtures/demo/`,
add the archetype to `DEMO_ARCHETYPES`, and the conformance test covers it
automatically. No generator code changes — the engine is archetype-agnostic.

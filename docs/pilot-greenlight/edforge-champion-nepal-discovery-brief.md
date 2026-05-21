# EdForge Champion — Nepal Field Discovery Brief

> **For:** EdForge Champion (Nepal)
> **Drafted:** 2026-05-20
> **Status:** Ready for champion review and field execution
> **Companion docs:**
> - [`v1-master-framework.md`](./v1-master-framework.md) — strategic context (engineering-facing, you don't have to read this)
> - [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md) — first pilot's facts
> - [`docs/pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md`](../pilots/pabson-saraswati-bs-2083/iemis-import-review-2026-05-19.md) — what happened when the principal first uploaded IEMIS data

---

## 0. What this brief is

You are EdForge's eyes, ears, and trusted relationship-keeper in Nepal. Web research, agent analysis, and operator telemetry can only take EdForge engineering so far. The next leap — from a working pilot platform to a **trusted EMIS that PABSON schools adopt fully** — depends on **ground-truth observation** that only someone on the ground can collect.

This brief is your structured field guide. It is designed so that **after one focused trip + 2-3 follow-up calls**, EdForge engineering will have enough evidence to close 12+ open questions, scope the next phase of work confidently, and identify Pilot 2.

You do not need to understand the engineering. You need to **observe, ask, and bring back artifacts**.

---

## 1. Mission — what we are trying to learn

EdForge is being built **for PABSON-archetype schools in Nepal**, with **Saraswati Secondary English Boarding School (Dhanusha)** as the first live pilot. Saraswati was activated on the platform on 2026-05-18; the principal has uploaded 206 students across 5 grades; in-person classes start in ≤2 weeks; 9 more grade batches remain to upload.

**Engineering has built a lot. We don't yet know enough about how Nepal schools actually run day-to-day to know what to build next.** The product roadmap currently rests on web research + the principal's brief feedback during onboarding. That's not enough. We need:

1. **Operational ground truth at Saraswati** — what the principal, accountant, class teacher, subject teacher, and parent actually do every day, every week, every term.
2. **Compliance artifact collection** — copies of real Flash I/II exports, real admit cards, real report cards, real intimation bills, real CEHRD forms. These tell us exactly what EdForge has to generate.
3. **Validation that Saraswati is representative** — visit 1-2 other PABSON schools to confirm the patterns we see at Saraswati are archetype-level, not Saraswati-specific. This is critical for EdForge to scale beyond one school.
4. **Pilot 2 candidate scouting** — identify 1-2 PABSON schools that could be Pilot 2 (data-only onboard, no engineering changes — proves the product framework works).
5. **Adoption barrier surfacing** — since the principal activated on 2026-05-18, what has she actually used? What has she avoided? Why?

---

## 2. Trip plan — what we suggest

**Total time commitment:** ~4-6 working days, ideally inside a 2-week window. Spread is OK; concentration is better.

| Stage | Where | Time | Output |
|---|---|---|---|
| **Stage 1 — Prep call** | Phone/Zoom with EdForge engineering | 1 hour | Brief reviewed, questions clarified, consent + privacy norms set |
| **Stage 2 — Saraswati visit** | Dhanusha, Madhesh Province | 1-2 days on-site | Filled interview forms (§4) + photographed artifacts (§5) + observation notes (§6) |
| **Stage 3 — Saraswati follow-up** | Phone / WhatsApp with principal | 2-3 short calls | Resolve open questions surfaced in Stage 2 |
| **Stage 4 — Secondary PABSON school visit(s)** | 1-2 schools chosen by you | 0.5-1 day each | Same interview forms — focused on §7 comparison questions |
| **Stage 5 — Pilot 2 candidate scouting** | Network conversations | Ongoing | Shortlist of 2-3 candidate schools (§8) |
| **Stage 6 — Debrief** | Phone/Zoom with EdForge engineering | 1-2 hours | Walk through findings; identify any follow-up calls needed |

**You set the schedule.** What matters is the quality of evidence, not the speed.

---

## 3. Consent + privacy

Before any interview or photo, please get verbal consent. Suggested language (adapt as natural):

> *"EdForge is helping Saraswati [school name] run its day-to-day operations on a software platform. I'm helping EdForge understand how Nepal schools actually work, so they can build the platform better. I'd like to ask you a few questions about how you do [billing / teaching / administration / etc.] today. Anything you say is shared only with the EdForge engineering team, who use it to design the platform. We don't publish your name. We don't share student data. Is that OK?"*

If they say no, thank them and move on. If they say yes but ask not to be recorded — fine, take notes only. If they ask not to be photographed — fine, ask if they can describe instead.

**Special care:**
- **Never collect student personal data** (names, photos, marks, addresses). If a sample document (e.g., admit card) has student info on it, ask if you can photograph it with the student's name covered or blacked out.
- **Never collect signatures or rubber-stamp images** without explicit permission — these can be misused.
- **Do collect aggregate, non-identifying data** — counts, formats, workflows, frequencies.

---

## 4. Interview guides per persona

For each interview, please fill in the form below. Photos / audio (with consent) help; notes are the minimum.

### 4.1 Principal interview (60-90 min)

Goal: understand the principal's strategic role and daily routine.

**Background**
- Years running this school?
- Years with EdForge / when did you sign up?
- Why did you choose EdForge (vs other options / paper)?

**Since EdForge activation on 2026-05-18:**
1. What have you used EdForge for? (Walk us through it screen by screen.)
2. What did you try and stop using? Why?
3. What have you done OUTSIDE EdForge that you wished was in EdForge?
4. What surprised you (positive or negative)?
5. What did you have to call/email engineering about? What were the gaps?
6. Show me your phone home screen — which apps do you actually use for school work? (WhatsApp? Email? IEMIS?)

**Day-to-day operations:**
1. Walk me through your typical day — what do you do at 8 AM? 11 AM? 1 PM? 4 PM?
2. What about Saturday (school day)? Friday afternoon?
3. What's the difference between a Term-1 month and a Term-4 month? Or exam-month vs regular-month?
4. End-of-term — what's that week look like? (Marks compilation, results, parent communication, term break logistics)
5. End-of-year — same question, for AY transition.

**Parent communication today:**
1. How do you talk to parents today, in order of frequency? (WhatsApp group? Phone call? SMS via third-party? Diary in student bag? Notice on gate?)
2. How urgent is "send a message to parent about absence" — same day? Next day? Weekly summary?
3. If we could send messages from EdForge to parent, what would be most valuable? (Absence? Invoice due? Result published? General notice?)
4. Do parents log into the EdForge parent portal? How often? What do they look at?
5. If they don't log in — why not? Phone-friendly issue? Don't know it exists? Don't see value?

**Compliance burden:**
1. What CEHRD / municipality forms do you have to submit this year? When are they due? How do you submit (paper, IEMIS portal, both)?
2. Show me the most painful form. Why is it painful?
3. Do you use the IEMIS portal at `emis.cehrd.gov.np`? How often? What for?
4. What about PABSON — do you submit anything to PABSON? Membership dues, exam registration?

**The big question:**
- 6 months from now, what would make you say "EdForge is the system we run this school on"?
- 6 months from now, what would make you say "we tried EdForge but went back to our old way"?

### 4.2 Accountant interview (60-90 min)

Goal: understand the fee / billing / payment workflow and EdForge's role in it.

**Background:**
- Years as accountant at this school?
- Software tools you use today (besides EdForge)? (Tally? Excel? Sage? Custom?)
- Approximately how many students do you bill per month?

**Fee model:**
1. What fees do you charge? (Tuition, admission, exam, library, lab, transport, hostel, ECA?)
2. Which are monthly vs annual vs term?
3. Which are mandatory vs opt-in?
4. Do you give sibling discounts? Scholarship? Staff-children discount? How are they computed?
5. How often does the fee schedule change?

**Monthly billing cycle:**
1. When in the month do you generate the bills?
2. When in the month are they due?
3. How do you deliver the bill to parents? (Paper sent home with student? Printed and distributed at school? Emailed? Other?)
4. **What does the printed bill look like?** Please photograph 2-3 samples (with student name covered or blacked out). One paid, one unpaid, one with sibling discount if possible.
5. How does the parent pay? (Cash at counter? Bank deposit slip? Online transfer? Mobile banking?)
6. How do you record the payment? (Manual register? Excel? EdForge?)
7. When do you follow up on an unpaid bill? After how many days?
8. What happens if a student doesn't pay for 1 month? 2 months? 3 months?

**EdForge specifically:**
1. Have you used EdForge's finance module yet? (Walk through what you've done.)
2. What would make the EdForge finance module replace your current tool?
3. If you had to print a bill TODAY from EdForge, what would it need to look like? (Format, content, branding, school name, logo, address, signature.)

**Annual closeout:**
1. What does year-end look like (end of Chaitra, AY 2083 → 2084)?
2. Carry-forward balances — how are they handled?
3. Bad debt / write-off — what's your policy?
4. Annual audit — who audits the school's accounts? When? What format do they need?

**Compliance:**
1. Does CEHRD or any government body audit school fees?
2. Do you have to file a financial report with anyone? (Tax? PABSON? CEHRD?)
3. The scholarship-quota rule (10% / 12% / 15% by enrollment band) — do you track it? Does anyone check?

**Photograph / collect (with consent):**
- Sample intimation bill (front and back, student info covered)
- Sample receipt
- Sample reminder notice for unpaid bill
- Annual report / financial summary template (last year's blank version is fine)

### 4.3 Class teacher interview (45-60 min, ideally 2-3 teachers across different grades)

Goal: understand mark entry, attendance, parent communication, and daily-driver workflows.

**Background:**
- Grade(s) you teach
- Years as class teacher at this school
- What device do you use for school work? (Personal phone? School laptop? Shared computer in office?)
- Internet at school — Wi-Fi? Reliable?

**Daily attendance:**
1. When do you take attendance? (First period? Morning assembly? Per period?)
2. How do you take it today? (Paper register? EdForge? Both?)
3. What do you do if a student is absent for 3+ days?
4. Do you message the parent? Who does — you, or the school office?

**Daily teaching:**
1. How do you know what to teach today? (Syllabus printed? CDC book? Lesson plan?)
2. Do you mark "today we covered topic X" anywhere? Or just in your own notebook?
3. Homework / classwork — how do you assign and track?

**Marks (term-end):**
1. How do you record unit-test / quiz marks during the term?
2. End of term — how do you compile to final grade?
3. What about pre-board (PABSON) — do you mark those, or does PABSON?
4. Do you enter marks into EdForge today? Why or why not?

**Communication:**
1. Do you have a WhatsApp group for parents of your section? How active?
2. Do you message individual parents? About what? How often?
3. If EdForge could send a message from you to a parent, what would you send most often?

**Co-teaching:**
1. Are there subjects in your section taught by another teacher? (E.g., a Math specialist for your Grade 8 section, while you're the class teacher.)
2. How do you coordinate marks, attendance, parent communication with co-teachers?

**Special students:**
1. Are there students with special learning needs in your class? How do you handle?
2. Are there students who learn very fast / very slow? How do you support them?

### 4.4 Subject teacher interview (30-45 min, ideally a Math teacher and an English teacher)

Goal: understand subject-level mark entry and curriculum.

**Curriculum:**
1. Which CDC syllabus do you teach? (Class 1-3 integrated? Class 4-8 subject-based? Class 9-10 SEE-prep?)
2. Do you use the CDC textbook, or do you supplement with PABSON books / Cambridge / other?
3. How is the syllabus broken into terms / units / lessons?

**Mark entry:**
1. How often do you assess students? (Unit tests, quizzes, daily questions, homework?)
2. What % of the final grade comes from each?
3. Where do you record these marks today? (Paper, Excel, EdForge?)
4. End-of-term mark — how do you compute it from the in-term assessments?

**External exams (where applicable):**
- **Grade 8 teachers:** BLE. Do you do CDC's 50% internal assessment rubric? Show me an example. How do you submit to IEMIS?
- **Grade 10 teachers:** SEE. Same question for 25% internal. Pre-board (PABSON) — do you teach to pre-board, or to SEE?
- **Grade 11/12 teachers:** if school operates HS — NEB practical, theory, internal split?

### 4.5 Parent interview (20-30 min, ideally 2-3 parents)

Goal: understand the receiving end of school communication and what they value.

**Important:** keep this very short and respectful. Parents are busy.

**Background:**
- How many of your children are at this school?
- Which grades?
- How did you choose this school?

**Communication:**
1. How does the school tell you things today? (WhatsApp? Phone call? Diary in bag? SMS? In person at pickup?)
2. What works well? What doesn't?
3. Do you log into the EdForge parent portal? (If yes — what for? If no — why not?)
4. If the school sent you a message via EdForge — would you read it? On phone? On laptop? Email?

**Bills:**
1. How does the bill reach you each month?
2. How do you pay?
3. What would you prefer (digital invoice you can save? Printed paper? SMS reminder?)

**Marks / results:**
1. How do you find out your child's exam results?
2. How would you prefer to find out?

**Trust:**
- What would make you say "EdForge is helping me track my child's school life"?

### 4.6 Office assistant / admissions clerk interview (30 min, if accessible)

Goal: understand student intake, transfers, records.

- New admission — what's the process? Documents collected? Fees deposited?
- Transfers in (from another school) — how does the EMIS-ID work? Does the prior EMIS-ID get reused or re-issued?
- Transfers out — what do you give the leaving family?
- Year-end — what records do you archive? Where?

---

## 5. Artifacts to collect (photos / digital copies)

For each, photograph 1-2 samples. Student names and personal info should be covered/blacked out unless explicitly approved.

| Artifact | Why we need it |
|---|---|
| **Sample intimation bill** (one paid, one unpaid, one with sibling discount) | Shows EdForge what the bill HAS to look like to be acceptable |
| **Sample receipt for fee payment** | Same — format we'll generate |
| **Sample reminder notice for unpaid bill** | Workflow we'll automate |
| **Sample admit card** (BLE, SEE, pre-board if school has run one) | Template we'll render |
| **Sample report card** (any past year) | The artifact that justifies the platform for parents |
| **Sample term-end mark sheet** | What teacher hands in to the office |
| **Sample SEE / BLE registration form** (blank, downloaded from municipality / NEB) | What EdForge must auto-fill |
| **Sample CEHRD Flash I / Flash II export** (if school can export theirs from IEMIS) | The shape of data we must produce |
| **Sample Form-19 disciplinary form** (if school has one) | Compliance template |
| **Sample notice published to parents** (any recent — school holiday, PTA meeting, etc.) | Format for our notice feature |
| **Sample CDC syllabus page** (any subject, any grade) | Curriculum structure |
| **Annual academic calendar** (the school's printed planner for this AY) | Term boundaries, exam windows, holidays — to validate our pilot fixture |
| **Fee schedule** (the school's published fee structure for this AY) | Validate `FeeStructure` model captures it correctly |
| **School letterhead / logo / principal signature** (with permission for use in EdForge document branding) | For the school branding entity |

---

## 6. Observational notes — what to write down while shadowing

While you're at the school, even outside formal interviews, please write down:

1. **The first 30 minutes of the school day** — what do operators do? Who's at the gate? What does the principal do? What does the office do?
2. **Mid-morning** — break time, parent walk-ins, office activity
3. **End of day** — pick-up, parent interactions, teacher follow-ups
4. **The technology reality** — laptops? Phones? Printer? Wi-Fi quality? Power cuts? UPS / inverter?
5. **The physical paper flow** — where does paper come from, where does it go? What's in the principal's tray? What's in the accountant's tray?
6. **Friction moments** — anytime you see an operator say "ugh, this is annoying" or "we used to do this differently" — write it down verbatim.

---

## 7. Comparison questions for the secondary PABSON school visits

When you visit a second PABSON school (and possibly a third), focus on the **differences from Saraswati**, not the similarities. If the school does something the same way as Saraswati, just note "same as Saraswati." If different, dig in.

Key comparison questions:
1. **Grade range** — same as Saraswati (PK→10) or different? Do they operate HS (Grade 11-12)?
2. **Fee structure** — number of categories, monthly vs annual, scholarship policy.
3. **Pre-board exam** — do they participate in PABSON pre-board? Same regional set as Saraswati? Pre-BLE for Grade 8 too?
4. **Co-teaching** — do they co-teach? In which subjects?
5. **Parent communication** — same WhatsApp / SMS / paper mix, or different?
6. **Mark entry** — paper vs Excel vs system?
7. **Report card format** — same as Saraswati's, or visually different?
8. **CDC vs Cambridge** — pure CDC, mixed, or Cambridge-mostly?
9. **Tech reality** — laptop / printer / Wi-Fi situation vs Saraswati's
10. **What software do they currently use?** (Tally for finance? Any existing EMIS? Pure paper?)

The point of these visits is to surface what's **Saraswati-specific vs PABSON-general** — so EdForge engineering can architect the right defaults vs per-school customizations.

---

## 8. Pilot 2 candidate scouting

The next major EdForge milestone is **Pilot 2: a second PABSON school onboards with zero engineering changes — only data drops**. This proves the EdForge framework is genuinely structured, not Saraswati-shaped.

When you talk to your network, ideal Pilot 2 attributes:

| Attribute | Why |
|---|---|
| PABSON-affiliated, English-medium private/boarding | Same archetype as Saraswati |
| 300-1000 students | Enough to stress-test; not so big it's risky |
| Has a principal who's already digital-leaning | Tolerance for new platform |
| Has an accountant who's not married to Tally | Willing to migrate finance flow |
| Operates ECD → Grade 10 minimum (Grade 12 a plus) | Validates BLE + SEE workflow; HS plus validates NEB |
| In an area with reasonable Wi-Fi / mobile data | Operational reality |
| Willing to be a design partner for 6+ months | Real adoption commitment |
| Not too far from your home base | So you can follow up |

**What we're asking you to do:**
1. Identify 2-3 candidate schools from your network
2. Pre-screen with a 30-minute conversation: "Would you be open to talking to EdForge about being their second pilot?"
3. For each yes, send EdForge engineering: school name + principal contact + 1-paragraph summary of why they're a fit
4. EdForge engineering will follow up with a structured proposal

**No pressure on you to close anything.** Your job is to identify; EdForge engineering closes.

---

## 9. Output format — how to share with EdForge engineering

Three formats are useful:

### 9.1 Filled interview forms

For each interview from §4, please write up the answers in a Google Doc / WhatsApp text / handwritten-then-photographed notes. We don't need fancy formatting — we need the content.

Suggested structure per interview:
```
Date: 2026-MM-DD
School: [school name]
Persona: [Principal / Accountant / Teacher / Parent]
Interviewee: [first name only is fine; or just "Principal" / "Accountant"]

Q: [question from §4.X]
A: [their answer, in their words; please don't paraphrase if you can avoid]

[continue for each question]

Observations (anything they said that wasn't asked):
[notes]
```

### 9.2 Artifact archive

Each photograph / scan / digital sample from §5 should be named:
- `saraswati-2026-05-XX-intimation-bill.jpg`
- `saraswati-2026-05-XX-admit-card-blanked.jpg`
- `school2-2026-05-XX-report-card-2082.jpg`

Share via a Google Drive folder, WhatsApp media-share, or any way that works for you. EdForge engineering will download and organize.

### 9.3 Field journal

A running log of your observations from §6. WhatsApp voice notes work; a doc works; a paper journal that you photograph works. Just capture the friction moments and surprises.

### 9.4 Pilot 2 scouting log

A simple list:

```
1. [School name], [city/area], [principal contact], [why they're a fit]
2. ...
```

---

## 10. The specific questions EdForge engineering needs answered

These are the open questions in our framework (`v1-master-framework.md` §8) that this trip resolves. **You don't need to memorize these** — they're covered by the §4 interviews. They're here so you know the engineering hypotheses your visit will confirm or correct.

### Operational
- Does Saraswati actually co-teach any sections? (Yes/no determines a frontend feature)
- Does Saraswati participate in PABSON pre-board? Do pre-board marks count toward Term-4 grade?
- What's Saraswati's daily attendance workflow today — first-period only? Per-period? Morning assembly only?

### Compliance
- BLE: does the municipality require paper or IEMIS upload? Saraswati's actual workflow?
- IEMIS internal-assessment (CDC 50/50 rubric for BLE) — exact format?
- Form-19 disciplinary — does Saraswati's municipality require it? Is it submitted on paper or via IEMIS?

### Adoption
- Of the EdForge screens, which has Saraswati's principal opened more than once?
- Which has she opened and abandoned?
- What workflows is she still doing outside EdForge?

### Finance
- Sample intimation bill format — what MUST the printed bill look like?
- Payment recording — manual at counter? Bank deposit reconciliation? Mobile banking?
- Scholarship-quota tracking — does Saraswati actively track 10%/12%/15%? Does anyone audit?

### Communication
- Today's actual primary parent channel — WhatsApp group? Diary? Phone? SMS?
- Acceptable latency for absence alert — same day? Next day?

### Pilot 2
- 2-3 candidate schools identified

---

## 11. Time + cost considerations

We are budget-conscious. Some thoughts:

- **Travel costs** to Saraswati and other schools — please log and EdForge will reimburse
- **Phone / data / printing** — log and reimburse
- **Gift / token of appreciation for schools** — small (a box of sweets, a thank-you card) is appropriate. Big gifts create awkwardness and could be seen as a bribe.
- **Time** — you're doing this around your other life. We respect that. **Quality > speed.**

---

## 12. What you should NOT do

- **Do not promise schools anything on EdForge's behalf** beyond "I'll relay this to engineering." Pricing, timelines, features — defer to engineering.
- **Do not collect personally identifying student data** (names, photos, marks, addresses).
- **Do not sign anything on EdForge's behalf** — MoUs, partnership agreements, etc. Refer to engineering.
- **Do not promise SMS, mobile apps, or any specific feature** — these are roadmap items that may or may not ship in V1.
- **Do not over-promise to Saraswati**. They're the first pilot; they should be told "we're learning from you to build a better V1." Not "this is what V2 will do."

---

## 13. After the trip — debrief

Once you've completed the on-site work, please schedule a 1-2 hour debrief call with EdForge engineering. We will:
1. Walk through your filled interview forms together
2. Identify follow-up questions for any subsequent calls
3. Map your findings to the engineering roadmap
4. Update the master framework (`v1-master-framework.md` §8) with your evidence
5. Decide which Pilot 2 candidate to approach formally

---

## 14. One-line mission statement

**Bring back evidence that lets EdForge engineering stop guessing about how Nepal PABSON schools work and start building with confidence.**

Thank you. This is high-leverage work.

---

## Appendix A — Key terms (so you can answer if asked)

- **EdForge:** The software platform; the company.
- **EMIS:** Education Management Information System. The category of product EdForge is.
- **PABSON:** Private and Boarding Schools' Organisation Nepal. The industry association Saraswati is a member of.
- **CEHRD:** Center for Education and Human Resource Development. The government body under MoEST that runs IEMIS and publishes school compliance forms.
- **MoEST:** Ministry of Education, Science and Technology.
- **NEB:** National Examination Board. Runs SEE (Grade 10) and Grade 11/12 board exams.
- **CDC:** Curriculum Development Centre. Publishes the National Curriculum Framework + syllabi.
- **IEMIS:** Integrated Education Management Information System. CEHRD's portal at `emis.cehrd.gov.np`.
- **Flash I / Flash II:** CEHRD's annual reports on student intake (Flash I) and output/retention (Flash II).
- **BLE / BEE:** Basic Level Examination at Grade 8, run by municipalities under CDC standards.
- **SEE:** Secondary Education Examination at Grade 10, run by NEB.
- **AY:** Academic Year. In Nepal, runs Baisakh (mid-April) to Chaitra (mid-April next year).
- **BS:** Bikram Sambat — the Nepali calendar (57 years ahead of Gregorian).
- **Saraswati / SSSEB:** Shree Saraswati Secondary English Boarding School, Dhanusha. EdForge's first live pilot.
- **dev-pabson-primary:** EdForge's internal test tenant; the engineering team uses this for testing.
- **Tenant:** In software language, one school's isolated data + setup on EdForge.

---

## Appendix B — How to reach EdForge engineering

[Engineering contact info — phone, email, WhatsApp. To be filled in by you before sharing this brief with the champion.]

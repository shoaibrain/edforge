# Why EdForge — the plain-language case for school owners

> **For:** anyone explaining EdForge to a Nepali school principal, owner, or
> accountant — champions, founders, partners.
> **What this is:** the selling story in everyday language. No engineering
> jargon. Every claim here is something the platform is actually built to do,
> not a promise about the future.
> **Companion:** [`edforge-champion-nepal-discovery-brief.md`](./edforge-champion-nepal-discovery-brief.md)
> for field discovery; [`edforge-overview.md`](./edforge-overview.md) for the
> source-grounded technical reference; [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
> for the runtime shape.

---

## 1. The one sentence

**EdForge is school software that was built for a Nepali school from day one —
it already speaks your calendar, your rupee, your grades, and your government
reporting, so the school runs the way you already run it, instead of forcing you
to run the way some foreign software expects.**

If you only have ten seconds with a principal, that's the line.

---

## 2. The problem every school owner already feels

Most schools are running on one of three things:

1. **Paper and registers** — attendance registers, mark ledgers, fee books,
   handwritten bills. Nothing is searchable. The knowledge lives in one
   accountant's head and one almirah.
2. **Excel and WhatsApp** — better than paper, but every file is a private
   island. Marks in one sheet, fees in another, no single picture of a student,
   and one wrong formula quietly corrupts a whole term.
3. **Generic "school software"** — usually built for an Indian or Western
   school and bent to fit Nepal. It shows the **English (Gregorian) calendar**
   when your school runs on **Bikram Sambat**. It fights you on the **rupee**.
   It has **no idea what IEMIS, Flash, SEE, BLE, or CEHRD** are. It calls your
   grades by the wrong names. You spend your time translating your real school
   into the software's idea of a school.

The third one is the dangerous competitor — not because it's good, but because
**"we already have something" feels safer than switching.** EdForge's job is to
make switching feel obviously worth it. The way to do that is not "we have more
features." It's **"we fit your school without you bending to fit us."**

---

## 3. The core idea that makes EdForge different

Almost every school product is built for **one school, one country, one way**,
and then patched to handle exceptions.

EdForge is built around a single, deeper idea: **a school is defined by the body
it answers to.** A PABSON private school in Nepal answers to a specific world —
the Nepali calendar, the rupee, CEHRD's curriculum and grade structure, IEMIS
reporting, the SEE and BLE board exams, the PABSON grading scale, the Nepali
school week (Sunday to Friday). That whole bundle is what EdForge calls an
**archetype.**

When you set up a school on EdForge, you make **one choice — "Nepal + PABSON"** —
and the system hands you a school that is **already correctly configured** for
that world:

- **Bikram Sambat calendar** everywhere — दशैं, तिहार, छठ, सरस्वती पूजा and your
  term and exam windows show in BS, the way your printed school calendar does.
- **Nepali rupee (रू)** as the currency, formatted the South Asian way
  (१,२३,४५६ — lakhs, not millions).
- **Nepali language (नेपाली)** alongside English across the screens.
- **The Nepali school week** — Sunday start, Sunday–Friday school days.
- **Your grade structure** — ECD, PPC, Class 1 to Class 10 — and the government
  reporting codes that go with them.
- **The right grading scale** — the PABSON A+/A/B+…D/F scale with 32 as the
  pass mark, not a foreign A–F GPA.

You don't switch on these settings one by one and hope you got them right.
**Picking "Nepal + PABSON" sets all of them, correctly, together.** That's the
difference between software that *can* be made to work in Nepal and software that
*was made for* Nepal.

> **The plain-language version for a principal:**
> *"Other software gives you a blank system and tells you to set it up for Nepal.
> EdForge already knows what a Nepali school is. You tell it which kind of school
> you are, and it's ready."*

---

## 4. What that actually buys each person in the school

A principal doesn't buy "architecture." They buy **what their staff stop having
to do by hand.** Here's the value per person.

### The principal / owner

- **One screen for the whole school** — how many students per grade, who's
  present today, which fees are unpaid, how the school is doing — instead of
  asking three people for three files.
- **Your school's name, logo, and branding** on every bill, receipt, and report
  card the system prints. It looks like *your* school, not like software.
- **Multiple schools under one roof** if you run a chain — each school keeps its
  own setup, but you see them all.

### The accountant

- **Fee structures set once** (tuition, admission, exam, transport, hostel,
  etc.), then **monthly bills generate themselves** instead of being written by
  hand for every student.
- **Sibling discounts, scholarships, and staff-child concessions** handled as
  rules, not as mental math repeated 400 times a month.
- **Every payment is recorded properly** — the bill, the receipt, the running
  account balance, and the ledger all update **together, as one safe action.**
  You can never end up with a receipt that didn't reduce the balance, or a
  payment that got counted twice. (This is the part most school software gets
  quietly wrong; EdForge is built so it *can't* go half-done.)
- **Printed bills and receipts** that look professional and carry your school's
  branding and PAN/VAT details.

### The teacher

- **Attendance and marks in one place** instead of a paper register plus a
  private Excel sheet.
- **Exams that match how you actually assess** — built from components and
  weights (unit tests, term exams, projects), with **your own grading scale**
  (the PABSON A+ to F with 32-pass), not a single number on a foreign A–F GPA.
- **Term results captured and published** from those marks — the data behind the
  printed report card is live today; the polished printable report-card document
  is being finalized now (be honest about that — see §8).
- **Board-exam support that's actually Nepali** — EdForge already tracks the
  **internal-assessment marks (the 50% component) for BLE** and handles
  **student registration for the BLE and SEE board exams**, including the symbol
  number the municipality assigns. No foreign product does this.

### The parent (on the near-term roadmap — frame as direction, not shipped)

- The aim is **bills and results that reach parents digitally** instead of a
  paper slip lost in the school bag, and **one place** to see their child's
  attendance, fees, and grades.
- Be honest: the **parent login portal is not a live pilot feature yet.** Sell
  it as where EdForge is headed, built on the student and finance data that is
  already there — not as something to switch on tomorrow.

### The school's obligation to the government

- EdForge **already produces the IEMIS Flash I and Flash II files** in the CSV
  format CEHRD expects, ready to download and upload to the
  `emis.cehrd.gov.np` portal. It tracks the **IEMIS school code**, the student
  demographic fields CEHRD asks for, and it can **bulk-import your existing
  student list straight out of an IEMIS spreadsheet** so you don't re-type
  hundreds of records.
- It understands the difference between **the grade names your school uses**
  (PG, Nursery, LKG…) and **the official CEHRD codes** (ECD, PPC, Class 1–10)
  that government reports need. **Your teachers keep calling grades whatever your
  school calls them**, and EdForge does the translation to the official codes
  **only when it produces the government report.** You never rename your own
  classes to satisfy the software.

> **Honesty note for the champion.** The Flash export *engine* is live and the
> hard, Nepal-specific parts (BS calendar, grade-code mapping, school codes, the
> demographic and import pipeline, BLE/SEE registration) are in place — you can
> truthfully say *"EdForge generates your Flash files."* What's still being
> completed is **full coverage of every last column** (e.g. the caste/ethnicity
> catalog and pulling exam-marks/attendance totals automatically into Flash II).
> So: promise that **EdForge is the only platform built specifically to carry
> PABSON schools' IEMIS reporting, and already does it** — just don't promise
> that *every* field auto-fills perfectly yet.

---

## 5. Why it's built to last — the "scalable" story, in plain words

The user asked the real question every serious buyer eventually asks:
*"Is this a weekend project that breaks when my school grows, or is it built to
run a real school for years?"* Here is that answer, without the jargon.

### 5.1 Every school's data is in its own locked room

EdForge runs many schools on one platform, but **each school's data is sealed off
from every other school's** — enforced at the deepest level of the system, not
just by a setting someone could forget. A teacher at School A literally **cannot**
reach School B's records, even if something in the software were buggy, because
the locks are in the foundation, not painted on top. For a school owner, that's
the difference between *"they promise it's private"* and *"it's built so it
can't leak."*

### 5.2 Adding the next school is a setup, not a rebuild

Because EdForge knows what a "PABSON Nepal school" *is*, onboarding the next one
is **filling in that school's details — not re-programming the system.** A new
school is ready in **seconds**, not weeks. This is why EdForge can grow from one
pilot to twenty schools without the price or the wait growing the same way.

And it goes further: the same design that lets EdForge add the next *PABSON*
school is what will let it add the **next kind of school** — public schools,
NGO-run schools — by adding their "world" as new data, **without rewriting the
parts that already work.** The school you buy today sits on a platform that's
designed to keep growing under it.

### 5.3 It's built on the same cloud the banks and big companies use

EdForge runs on **Amazon Web Services** — the same infrastructure that runs much
of the internet. In practice for a school that means:

- **Your data is automatically backed up** and can be restored to an earlier
  point in time. A deleted record isn't gone forever.
- **Nothing is ever truly hard-deleted** — when you "remove" something it's
  marked inactive and kept, so mistakes are recoverable and history is intact.
- **It's hosted in the Mumbai region** — close to Nepal, so it's fast.
- **It's secure by default** — encrypted, access-controlled, and monitored, with
  automatic alerts to the EdForge team if something goes wrong.

### 5.4 It's honest about what's ready

EdForge is in **active development with a real first pilot** (Saraswati Secondary
English Boarding School in Dhanusha). The parts that are live are **production
tested on a real school**. The team deliberately ships **one solid tier of
features done right** rather than a long list of half-working ones. That honesty
is itself a selling point: you're buying something being **hardened on a real
Nepali school**, with a team that's on the ground learning how schools actually
work — not a generic product that treats Nepal as an afterthought.

### 5.5 It's aligned to an international data standard

Under the hood, EdForge organizes school data to match **Ed-Fi**, a widely-used
international education-data standard. The school owner doesn't need to care what
that means — but it's why EdForge can speak both "Nepali school" *and* "global
standard" at the same time. **Your data is structured the way the wider education
world structures it**, which means it's portable, future-proof, and not trapped
in one vendor's private format.

---

## 6. Answering the objections you'll actually hear

**"We already use some software."**
> *"What does it show you when you open it — the English calendar or Bikram
> Sambat? Does it know what Flash I is? Does the bill come out in rupees with
> your school's logo, or do you fix it in Word afterward? EdForge is built so you
> stop doing those fixes. You're not replacing software with software — you're
> replacing the daily translation work."*

**"Switching is risky / too much work."**
> *"You don't set up a blank system. You tell EdForge you're a PABSON Nepal
> school and it arrives already configured. Onboarding is giving us your school's
> details and your student list — we do that with you."*

**"Is my data safe? Can other schools see it?"**
> *"Each school is sealed in its own locked space at the foundation of the
> system — not as a setting, as the architecture. It's backed up automatically,
> encrypted, and hosted on Amazon's cloud near Nepal. Deleting something doesn't
> destroy it; it can be recovered."*

**"What if you disappear / what happens to my data?"**
> *"Your data is stored in a standard international format (Ed-Fi), not a secret
> one, and EdForge's source code is openly available to read. You're not locked
> into a black box."*

**"Is it expensive?"**
> *(Defer pricing to the founder — but the structural answer is:)* *"Because
> adding a school is a setup and not a rebuild, EdForge's cost to serve each
> school is low, and that's reflected in the price. You're sharing a platform
> built for many Nepali schools, not paying to build one from scratch."*

---

## 7. The one-page leave-behind (read this aloud)

> **EdForge — school software made for Nepal, not adjusted for it.**
>
> - It already runs on the **Bikram Sambat calendar**, the **rupee**, the
>   **Nepali week**, and **Nepali language** — nothing to configure.
> - It knows your **grades, your grading scale, and your government codes**
>   (IEMIS, CEHRD, SEE, BLE) — and lets your teachers keep your school's own
>   grade names while it handles the official translation for reports.
> - **Fees, bills, receipts, and accounts** stay correct automatically — no
>   double-counted payments, no receipt that didn't update the balance.
> - **Attendance, exams, marks, and published results** live in one place
>   instead of a register plus a private Excel sheet — and it already supports
>   **BLE/SEE board-exam registration** the Nepali way.
> - Every school's data sits in its **own locked, backed-up, encrypted space**
>   on **Amazon's cloud near Nepal**.
> - Adding your school is a **setup in seconds**, not a rebuild — which is why it
>   can grow with you and stay affordable.
> - It's being **hardened on a real Nepali school right now**, by a team learning
>   how Nepali schools actually run.
>
> **You don't bend your school to fit the software. The software already fits
> your school.**

---

## 8. What NOT to promise (so we keep trust)

Straight from the discovery brief — credibility is the asset, don't spend it:

- **Don't promise** as *finished, in-your-hands-today* features: printed
  **report-card and admit-card PDFs** (the marks and exam data behind them are
  live; the polished printable documents are being finalized), **SMS/email to
  parents**, **online payment** via eSewa/Khalti (built but switched off for the
  pilot — payments are cash/bank/cheque today), the **parent login portal**, or
  a **mobile app**. The foundations for several of these are in the code, but
  they are **not** live pilot features. Promise the **fit and the direction**,
  not a delivery date.
- **You *can* confidently demo today:** the Nepali calendar/rupee/language
  setup, student import from an IEMIS spreadsheet, attendance, exams and weighted
  grading, fee structures, bill/invoice and receipt PDFs in English+Nepali, the
  ledger and accounts that stay correct automatically, BLE/SEE registration, and
  the IEMIS Flash file export. These are real.
- **Don't promise** pricing, timelines, or custom features on the founder's
  behalf — relay interest, let the founder commit.
- **Frame the first pilots honestly:** *"We're building V1 with you and learning
  from you to make it better,"* not *"this already does everything."*

The strongest pitch is the true one: **EdForge is the only platform being built
from the ground up to be a Nepali PABSON school's real operating system — and it
already proves it the moment you open it and see your own calendar, your own
rupee, and your own grades looking back at you.**

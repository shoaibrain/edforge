# Pilot Dossier — `pabson-saraswati-bs-2083`

> **Status:** registered (no fixture data extracted yet — pending Sprint C1.2 onward).
> **Purpose:** the human-readable companion to `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/` (the machine-readable fixture). This dossier is the **only** place school-specific facts live. No code reads from this file.

---

## Identity

| Field | Value |
|---|---|
| `pilotId` | `pabson-saraswati-bs-2083` |
| `archetype` | `PABSON` |
| `country` | `NPL` |
| `calendarSystem` | `bikram_sambat` |
| `timezone` | `Asia/Kathmandu` |
| `locale` | `ne-NP` |
| `currency` | `NPR` |
| `weekStart` | `Sunday` |
| `schoolDays` | `Sun, Mon, Tue, Wed, Thu, Fri` |
| `primaryAcademicYearId` | BS 2083 (Apr 2026 → Apr 2027 in Gregorian) |
| `gradingScale` | 32-pass (PABSON archetype standard; **verify with admin during C13.2 onboarding**) |
| `gradeLevels` | ECD, PPC, Class 1 → Class 10 |
| `school` | Saraswati Sec. Eng. Boarding School |

---

## Source

Official printed BS 2083 academic calendar provided by the school during pilot intake. Calendar layout: 12 monthly panels, each with a Holidays section and a Programs section, plus cross-year markers on the final (Chait) panel.

Image evidence captured during pilot intake (referenced from this dossier; not checked into the repo).

---

## Academic structure summary

| Item | Value |
|---|---|
| AY boundary | Baisakh 3 2083 → Chait 30 2083 |
| Terms | 4 (Baisakh 3–Asar 32; Saun 11–Asoj 30; Kartik 10–Pus 30; Magh 6–Chait 29) |
| Exam windows | 4 (Asar 24–32; Asoj 22–30; Pus 21–30; Chait 18–29) |
| Cross-year marker — Result of Final Exam 2083 | Baisakh 8 2084 |
| Cross-year marker — New Session Begin 2084 | Baisakh 12 2084 |
| Provisional window | Baisakh 1 2084 → Baisakh 8 2084 (~7 days) |

The provisional window is the operational window the cross-year handoff (Sprint C9) must handle: AY 2084 active, students attending the new grade level, but AY 2083 results not yet published.

---

## Holiday summary

| Type | Count | Notes |
|---|---|---|
| Multi-day blocks | 6 | Dashain (Kartik 1–9), Tihar (Kartik 22–27 — Laxmi Puja/Gai Puja/Bhai-Tika/etc.), Chhath (Kartik 29–30), Summer (Saun 1–10), Winter (Magh 1–5), Holi (Chait 7–10) |
| Single-day national | 4 | Gantantra Diwas (Jeth 15), Sarbidhan Diwas (Asoj 3), Gregorian New Year (Pus 17), Democracy Day (Fagun 7) |
| Single-day religious | ~9 | Jud-Sital (Baisakh 2), Buddha Jayanti (Baisakh 18), Raksha Bandhan (Bhadau 12), Teej (Bhadau 29), Chaudachan (Bhadau 30), Jitiya (Asoj 18), Ghatasthapana (Asoj 25), Bibah Panchami (Mangsir 28), Maha Shivaratri (Fagun 22) |

Source authority: PABSON archetype-curated holiday seed for AY BS 2083 (Sprint C3.2 produces the canonical seed; this dossier names the holidays for human reference).

---

## Programs

| Date (BS) | Program | Category |
|---|---|---|
| Baisakh 3 | School Re-opens | school_program |
| Jeth 22 | Quiz Contest | school_program |
| Saun 11 | School Re-opens (post-Summer vacation) | school_program |
| Saun 22 | Spelling Contest | school_program |
| Bhadau 19 | Speech Contest | school_program |
| Kartik 10 | School Re-opens (post-Dashain/Tihar) | school_program |
| Mangsir 18 | Game | school_program |
| Magh 6 | School Re-opens (post-Winter vacation) | school_program |
| Magh 28–29 | Saraswati Puja Celebration | school_program |

Total: 9 program events across the AY.

---

## Bell schedule

Two operational shifts modeled in `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/bell-schedule.json`:

| Shift | Scope | Start | End | Periods |
|---|---|---|---|---|
| Shift 1 (Morning routine) | `non-academic` (boarding only) | 05:30 | 09:00 | N/A — boarder operational routine |
| Shift 2 (Day academic) | `academic` | 10:00 | 16:00 | 8 periods × 45 min |
| Exam-day variant | `academic` | 10:00 | 16:00 | 4 blocks × 90 min |

**Important architectural distinction:** Shift 1 is boarding-routine labelling (breakfast, morning prep), NOT an academic shift. V1 academic operations target Shift 2 only. The bell-schedule fixture marks the scope explicitly so the bell-resolver service can ignore non-academic shifts for attendance / period-resolution queries.

---

## gradingScale (V1 assumption — verify with admin)

PABSON archetype default 32-pass scale:

| Grade | Range |
|---|---|
| A+ | ≥ 90 |
| A | 80–89 |
| B+ | 70–79 |
| B | 60–69 |
| C+ | 50–59 |
| C | 40–49 |
| D | 32–39 (pass) |
| F | < 32 (fail) |

The Sprint C13.2 admin onboarding session **must verify** this matches Saraswati's actual policy. If divergent, update both this dossier and `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/metadata.json`.

---

## Admin contact

| Field | Value |
|---|---|
| Name | TBD |
| Email | TBD |
| Phone | TBD |
| Designated decision-maker for V1 questions | TBD |

Captured during C13.2 onboarding session.

---

## Onboarding session

- **Date:** TBD
- **Format:** recorded video session with EdForge support present
- **Deliverable:** recorded walkthrough → archived alongside this dossier

---

## C12 evidence (filled in as artifacts land)

| Artifact | Path | Status |
|---|---|---|
| Rehearsal walkthrough video | `docs/pilots/pabson-saraswati-bs-2083/c12-evidence/rehearsal-walkthrough.mp4` | not yet produced |
| Gap list | `docs/pilots/pabson-saraswati-bs-2083/c12-evidence/gap-list.md` | not yet produced |
| Prod-shadow rehearsal log | `docs/deploys/prod-tenant-provision-<dev-tenant-id>-<ts>-<sha>.log` | not yet produced |
| Sign-off | inline below — section 7 | not yet signed |

---

## C13 launch artifacts (filled in at go-live)

| Artifact | Status |
|---|---|
| Prod tenant ID | not yet provisioned |
| First-login audit log | n/a |
| Hypercare triage queue | n/a |
| Day-30 retro | n/a |

---

## Sign-off log

This section is appended to as gates pass.

| Gate | Date | Signed by | Evidence |
|---|---|---|---|
| C2 internal greenlight | — | — | — |
| C12 external greenlight | — | — | — |
| C13.5 production-ready | — | — | — |

---

## Notes

- All facts in this dossier are pilot-specific. None of them appear in code (per invariant 13). Code reads from `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/` (JSON data) and accepts a generic `pilotId` everywhere else.
- When the second pilot arrives, copy `docs/pilots/pabson-saraswati-bs-2083/dossier.md` to `docs/pilots/<new-pilot-id>/dossier.md`, drop their fixture data under `packages/pilot-fixtures/pilots/<new-pilot-id>/`, register them in the pilot registry, and the test suite + smoke harness picks them up automatically.
- Saraswati uses school-local grade-level codes (`PG`, `NUR`, `LKG`, `UKG`, `1`–`10`) per the PABSON-school convention. CEHRD canonical (`ECD`, `PPC`, `1`–`10`) is a report-time projection applied at IEMIS Flash I/II generation; see the "School-first architecture" section in [CLAUDE.md](../../../CLAUDE.md#school-first-architecture). Don't flag school codes that don't match CEHRD canonical as a regression — that's the design.

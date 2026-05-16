# @edforge/pilot-fixtures

Parametric pilot-fixtures package for EdForge. **Workspace-only** — never published to npm.

## Architecture

Per [invariant 13](../../docs/edforge-pabson-sprint-plan.md), the engine knows zero pilots. Pilots are JSON data dropped under `pilots/<pilot-id>/`. Adding a new pilot is a zero-code operation:

1. Create `pilots/<new-pilot-id>/metadata.json` (and the rest of the fixture files)
2. Run the suite — the registry auto-discovers the new pilot via fs glob

Every file is validated against its JSON Schema (`src/schema/*.schema.json`) at load time. Malformed fixtures fail loudly via `PilotMetadataInvalidError`.

## Layout

```
packages/pilot-fixtures/
├── pilots/
│   └── <pilot-id>/
│       ├── metadata.json                — registry entry (archetype, country, gradeLevels, ...)
│       ├── bell-schedule.json           — daily shifts + exam-day variant
│       ├── academic-structure.json      — terms + exam windows + cross-year markers
│       ├── holidays-consolidated.json   — block-centric canonical view of holidays
│       ├── programs.json                — school programs / events
│       └── calendar/
│           ├── baisakh.json
│           ├── jeth.json
│           └── ... (12 monthly files; per-day events)
└── src/
    ├── pilot-registry.ts                — listPilots + loadPilot (metadata-only)
    ├── loader.ts                        — loadPilotFixture + query helpers
    ├── schema/                          — 5 JSON Schemas (calendar / bell / academic / holidays / programs)
    └── types.ts                         — PilotMetadata + WEEKDAY_TOKENS + error classes
```

## Public API

### Registry (metadata-only)

```ts
import { listPilots, loadPilot, PilotMetadata, PilotNotFoundError } from '@edforge/pilot-fixtures';

const all: PilotMetadata[] = listPilots();                     // every registered pilot
const meta: PilotMetadata = loadPilot('pabson-saraswati-bs-2083');
// loadPilot throws PilotNotFoundError for unknown ids.
```

Use these for cheap queries — when you only need archetype, country, gradeLevels, etc. They DON'T touch the fixture data files.

### Loader (full bundle)

```ts
import { loadPilotFixture, PilotFixture } from '@edforge/pilot-fixtures';

const fixture: PilotFixture = loadPilotFixture('pabson-saraswati-bs-2083');
//   fixture.metadata               — same as loadPilot(pilotId)
//   fixture.calendar[<month>]      — 12 monthly views
//   fixture.bellSchedule           — shifts + examDayShifts
//   fixture.academicStructure      — terms + cross-year markers
//   fixture.holidaysConsolidated   — blocks + singleDayHolidays
//   fixture.programs               — programs[]
```

`loadPilotFixture` reads every fixture file from disk in one pass and validates each against its schema. Throws `PilotMetadataInvalidError` on any schema violation. Does NOT cache — caller's responsibility if needed.

### Query helpers

All take a loaded `PilotFixture`:

```ts
import {
  eventsOnDate,
  expandBlocks,
  expandHolidays,
  expandPrograms,
  instructionalDaysInRange,
  shiftProfileForDate,
  bsDayOfWeek,
} from '@edforge/pilot-fixtures';

// Every event on a specific BS date (supports multi-event days like Asoj 25)
const events = eventsOnDate(fixture, '2083/06/25');
// → [Ghatasthapana (holiday), Term 2 Exam — Day 4 (exam_window)]

// Per-day expansion of holiday blocks (no single-day holidays here)
expandBlocks(fixture);    // 36 per-day entries for the first pilot

// All holidays (blocks + single-day) as per-day entries
expandHolidays(fixture);  // 49 per-day entries (36 block + 13 single)

// Per-day program expansion (Saraswati Puja Magh 28-29 → 2 entries)
expandPrograms(fixture);  // 10 per-day entries (9 programs)

// Count instructional days in a BS range. Excludes weekends + holidays.
// Exam-window days ARE instructional (per C2.4).
instructionalDaysInRange(fixture, '2083/01/03', '2083/03/32');
//   → fewer than 92 (term-1 calendar days) — minus Saturdays + 2 holidays

// Bell-schedule profile for a date.
//   classification: 'regular' | 'exam_day' | 'holiday' | 'weekend' | 'vacation'
//   shifts: Shift[] (empty for non-instructional)
shiftProfileForDate(fixture, '2083/07/01');
// → { classification: 'holiday', shifts: [], reason: 'Dashain' }

// BS day-of-week (TZ-safe via T12:00:00 parse pattern)
bsDayOfWeek(2083, 1, 3);  // → 'sun' | 'mon' | ... | 'sat'
```

## CLI demo

```bash
# Print all events on a given BS date for a pilot
npx ts-node packages/pilot-fixtures/bin/print-day-summary.ts \
  --pilot pabson-saraswati-bs-2083 \
  --date 2083/07/06
```

## Naming caveats

- `loadPilot(pilotId)` returns **metadata only** (the C1.0 registry function). It does NOT include calendar/bell/academic-structure/holidays/programs.
- `loadPilotFixture(pilotId)` returns the **full bundle** (C1.7). Use this for any query that touches more than `metadata`.

## Adding a new pilot

```
pilots/
└── <new-pilot-id>/
    ├── metadata.json
    ├── bell-schedule.json
    ├── academic-structure.json
    ├── holidays-consolidated.json
    ├── programs.json
    └── calendar/
        ├── baisakh.json
        └── ... (all 12 BS months)
```

Then run `npx jest --config jest.config.cjs`. The parametric `describe.each(listPilots())` test blocks automatically pick up the new pilot. No code changes.

## Pilot-agnostic discipline

Engine code (`src/*.ts` except spec files) MUST be pilot-agnostic. Pilot identifiers, school names, and any pilot-specific fact may appear ONLY in:

- `pilots/<pilot-id>/*.json` (data)
- `docs/pilots/<pilot-id>/dossier.md` (human-readable companion)
- Spec files (`src/*.spec.ts`) where pilot IDs are test fixtures

A `grep -ni '<pilot-name>'` against engine code MUST return zero hits. CI enforcement lives outside this package; convention is enforced by reviewer.

## Schemas

Five JSON Schemas under `src/schema/`:

| Schema | Validates |
|---|---|
| `calendar-fixture.schema.json` | each monthly file under `pilots/<id>/calendar/*.json` |
| `bell-schedule.schema.json` | `pilots/<id>/bell-schedule.json` |
| `academic-structure.schema.json` | `pilots/<id>/academic-structure.json` |
| `holidays-consolidated.schema.json` | `pilots/<id>/holidays-consolidated.json` |
| `programs.schema.json` | `pilots/<id>/programs.json` |

All schemas compile under AJV strict-mode. `additionalProperties: false` is enforced at every nesting level — catches typos at validation time, prevents fixture drift.

## Source of truth for BS calendar math

This package consumes `getBsMonthDays` and `bsToGregorian` from `@aibrains/shared-types` for all BS calendar math. Don't reimplement.

The frontend wraps `gregorianToBs` with a `T12:00:00` parse trick to avoid a known timezone fragility (tracked in `docs/pilot-greenlight/deferred-work.md`). The loader's `bsDayOfWeek` uses the same pattern.

## Sprint history

- **C1.0** — registry skeleton + first pilot metadata
- **C1.1** — calendar fixture schema
- **C1.2** — first pilot's 12 monthly calendar files (109 events)
- **C1.3** — bell-schedule fixture
- **C1.4** — academic-structure fixture
- **C1.5** — holidays-consolidated fixture
- **C1.6** — programs fixture
- **C1.7** — loader utility + this README

Next: **Sprint C2** (greenlight gate) — write-path smoke + 5 non-negotiable read-path tests against the deployed service using this fixture.

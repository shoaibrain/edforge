/// <reference types="node" />
/**
 * print-day-summary.ts — CLI demo for the pilot-fixtures loader.
 *
 * Per the C1 sprint plan §C1.7 demo:
 *
 *   npx ts-node packages/pilot-fixtures/bin/print-day-summary.ts \
 *     --pilot pabson-saraswati-bs-2083 \
 *     --date 2083/07/06
 *
 * Prints:
 *   - The pilot's metadata header
 *   - The BS day-of-week
 *   - All events on the date (multi-event support)
 *   - The shift profile classification + applicable shifts
 *
 * Useful for visually verifying fixture data + as a smoke test that the
 * loader's full bundle assembles cleanly.
 *
 * Pilot-agnostic — `--pilot` is a runtime argument.
 */

import {
  loadPilotFixture,
  eventsOnDate,
  bsDayOfWeek,
  shiftProfileForDate,
} from '../src/index';

function parseArgs(argv: string[]): { pilotId: string; bsDate: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pilot' && argv[i + 1]) {
      args.pilot = argv[++i];
    } else if (a === '--date' && argv[i + 1]) {
      args.date = argv[++i];
    }
  }
  if (!args.pilot) {
    console.error('Missing required argument: --pilot <pilotId>');
    process.exit(2);
  }
  if (!args.date) {
    console.error('Missing required argument: --date <YYYY/MM/DD>');
    process.exit(2);
  }
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(args.date)) {
    console.error(`--date must be BS YYYY/MM/DD (got: ${args.date})`);
    process.exit(2);
  }
  return { pilotId: args.pilot, bsDate: args.date };
}

function main(): void {
  const { pilotId, bsDate } = parseArgs(process.argv.slice(2));

  const fixture = loadPilotFixture(pilotId);
  const [year, month, day] = bsDate.split('/').map(Number);
  const dow = bsDayOfWeek(year, month, day);
  const events = eventsOnDate(fixture, bsDate);
  const profile = shiftProfileForDate(fixture, bsDate);

  console.log('');
  console.log(`Pilot:       ${fixture.metadata.pilotId}`);
  console.log(`Archetype:   ${fixture.metadata.archetype} (${fixture.metadata.country})`);
  console.log(`Calendar:    ${fixture.metadata.calendarSystem}`);
  console.log('');
  console.log(`BS Date:     ${bsDate} (${dow})`);
  console.log(`Classification: ${profile.classification}${profile.reason ? ` — ${profile.reason}` : ''}`);
  console.log('');

  if (events.length === 0) {
    console.log('Events on this date: (none)');
  } else {
    console.log(`Events on this date (${events.length}):`);
    for (const ev of events) {
      const meta =
        ev.metadata && Object.keys(ev.metadata).length > 0
          ? ` ${JSON.stringify(ev.metadata)}`
          : '';
      console.log(`  - [${ev.eventType}] ${ev.eventName}${meta}`);
    }
  }
  console.log('');

  if (profile.shifts.length === 0) {
    console.log('Shifts: (non-instructional)');
  } else {
    console.log(`Shifts (${profile.shifts.length}):`);
    for (const shift of profile.shifts) {
      const periodSummary = shift.periods
        ? `, ${shift.periods.length} periods`
        : '';
      console.log(
        `  - ${shift.name} [${shift.scope}] ${shift.startTime}–${shift.endTime}${periodSummary}`,
      );
    }
  }
  console.log('');
}

main();

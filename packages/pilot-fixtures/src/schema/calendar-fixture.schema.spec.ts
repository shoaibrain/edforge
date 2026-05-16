/**
 * C1.1 — Calendar fixture schema contract.
 *
 * The schema describes per-month calendar JSON files
 * (`pilots/<pilot-id>/calendar/{baisakh..chait}.json`) populated in
 * Sprint C1.2.
 *
 * Coverage:
 *   - Schema compiles under AJV strict-mode (the AC).
 *   - Validates a well-formed minimal document.
 *   - Rejects missing required top-level fields (month, events).
 *   - Rejects an unknown month or unknown eventType (enum gates).
 *   - Rejects an unknown metadata.category or metadata.boundary.
 *   - Rejects extra top-level OR per-event properties (additionalProperties: false).
 *   - Rejects malformed bsDate (must be YYYY/MM/DD).
 *
 * Pilot-agnostic — uses generic fixture data; no pilot-specific names.
 */

import Ajv2020 from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

const schemaPath = path.resolve(__dirname, 'calendar-fixture.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

/**
 * Build a fresh AJV instance per test so cached compiled validators
 * don't carry over between assertions. Strict-mode is the AC; if a
 * schema construct misuses an unrecognized keyword AJV throws here.
 */
function makeAjv() {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
  });
  addFormats(ajv);
  return ajv;
}

describe('calendar-fixture.schema.json — AJV strict-mode AC', () => {
  it('schema compiles under AJV strict-mode (the AC)', () => {
    const ajv = makeAjv();
    // compile() throws on any strict-mode violation (unknown keyword,
    // unevaluated required field, etc.). If this passes, AJV is happy.
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('calendar-fixture.schema.json — happy paths', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('accepts a minimal valid doc (empty events array)', () => {
    const doc = { month: 'baisakh', events: [] };
    expect(validate(doc)).toBe(true);
  });

  it('accepts a doc with one event of each eventType', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'ay_boundary',
          eventName: 'AY 2083 Begins',
          metadata: { boundary: 'start' },
        },
        {
          bsDate: '2083/01/02',
          eventType: 'term_boundary',
          eventName: 'Term 1 Begins',
          metadata: { boundary: 'start', termId: 'term-1' },
        },
        {
          bsDate: '2083/01/03',
          eventType: 'holiday',
          eventName: 'Generic Holiday',
          metadata: { category: 'national' },
        },
        {
          bsDate: '2083/01/04',
          eventType: 'program',
          eventName: 'School Re-opens',
          metadata: { category: 'school_specific', sourceTermId: 'term-1' },
        },
        {
          bsDate: '2083/01/05',
          eventType: 'exam_window',
          eventName: 'Exam Day 1',
          metadata: { termId: 'term-1' },
        },
        {
          bsDate: '2083/01/06',
          eventType: 'school_event',
          eventName: 'Generic School Event',
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it('accepts an event with blockId metadata (multi-day holiday day)', () => {
    const doc = {
      month: 'kartik',
      events: [
        {
          bsDate: '2083/07/01',
          eventType: 'holiday',
          eventName: 'Multi-day Block Day 1',
          metadata: { category: 'religious', blockId: 'block-test' },
        },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it('accepts an optional top-level notes field', () => {
    const doc = {
      month: 'baisakh',
      events: [],
      notes: 'This month has the AY boundary.',
    };
    expect(validate(doc)).toBe(true);
  });
});

describe('calendar-fixture.schema.json — sad paths', () => {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);

  it('rejects doc missing "month"', () => {
    expect(validate({ events: [] })).toBe(false);
  });

  it('rejects doc missing "events"', () => {
    expect(validate({ month: 'baisakh' })).toBe(false);
  });

  it('rejects an unknown month value', () => {
    expect(validate({ month: 'march', events: [] })).toBe(false);
  });

  it('rejects an event missing bsDate', () => {
    const doc = {
      month: 'baisakh',
      events: [{ eventType: 'holiday', eventName: 'No Date' }],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an event missing eventType', () => {
    const doc = {
      month: 'baisakh',
      events: [{ bsDate: '2083/01/01', eventName: 'No Type' }],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an event missing eventName', () => {
    const doc = {
      month: 'baisakh',
      events: [{ bsDate: '2083/01/01', eventType: 'holiday' }],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects bsDate not matching YYYY/MM/DD pattern', () => {
    const doc = {
      month: 'baisakh',
      events: [
        { bsDate: '2083-01-01', eventType: 'holiday', eventName: 'Wrong Sep' },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects bsDate with single-digit month component', () => {
    const doc = {
      month: 'baisakh',
      events: [
        { bsDate: '2083/1/01', eventType: 'holiday', eventName: 'Unpadded' },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown eventType', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'unicorn',
          eventName: 'Made-up type',
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown metadata.category', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'holiday',
          eventName: 'Bad Category',
          metadata: { category: 'made-up-category' },
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an unknown metadata.boundary', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'term_boundary',
          eventName: 'Bad Boundary',
          metadata: { boundary: 'middle', termId: 'term-1' },
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra top-level properties (additionalProperties: false)', () => {
    const doc = {
      month: 'baisakh',
      events: [],
      unknown_field: 'sneaky',
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra event-level properties', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'holiday',
          eventName: 'Has Extras',
          unknown_event_field: 'sneaky',
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });

  it('rejects extra metadata properties (additionalProperties: false on metadata)', () => {
    const doc = {
      month: 'baisakh',
      events: [
        {
          bsDate: '2083/01/01',
          eventType: 'holiday',
          eventName: 'Extra Metadata',
          metadata: { category: 'national', mystery_field: 'oh no' },
        },
      ],
    };
    expect(validate(doc)).toBe(false);
  });
});

/**
 * Spec for the C4.1 CalendarBlock entity factory + helpers.
 *
 * Covers:
 *   - createCalendarBlockEntity populates entityKey, gsi1pk/sk, derived
 *     childDateCount, and preserves caller-supplied data.
 *   - computeChildDateCount is inclusive [start, end] and UTC-safe.
 *   - enumerateBlockDates lists every AD date between endpoints.
 *   - Key builders produce the documented shapes (matches the
 *     ecs-dynamodb.ts GSI definitions + gsi-inventory.md).
 */

import {
  CalendarBlockKeyBuilder,
  computeChildDateCount,
  createCalendarBlockEntity,
  enumerateBlockDates,
} from '../calendar-block.entity';

describe('CalendarBlockKeyBuilder', () => {
  it('builds the per-block entityKey', () => {
    expect(CalendarBlockKeyBuilder.calendarBlock('school-1', 'block-1')).toBe(
      'SCHOOL#school-1#BLOCK#block-1',
    );
  });

  it('builds a school-scoped prefix', () => {
    expect(CalendarBlockKeyBuilder.calendarBlocksPrefix('school-1')).toBe(
      'SCHOOL#school-1#BLOCK#',
    );
  });

  it('builds the school-scope GSI1PK', () => {
    expect(CalendarBlockKeyBuilder.schoolScope('tenant-1', 'school-1')).toBe(
      'TENANT#tenant-1#SCHOOL#school-1',
    );
  });

  it('builds a date-sortable GSI1SK keyed by startDate then blockId', () => {
    expect(CalendarBlockKeyBuilder.blockDateSort('2026-10-17', 'block-1')).toBe(
      'CALBLOCK#2026-10-17#block-1',
    );
  });
});

describe('computeChildDateCount', () => {
  it('returns 1 for a same-day range', () => {
    expect(computeChildDateCount('2026-10-17', '2026-10-17')).toBe(1);
  });

  it('returns inclusive day count across a multi-day range', () => {
    // Dashain 2083 in AD: 9-day block 2026-10-17..2026-10-25
    expect(computeChildDateCount('2026-10-17', '2026-10-25')).toBe(9);
  });

  it('returns 0 for an inverted range', () => {
    expect(computeChildDateCount('2026-10-25', '2026-10-17')).toBe(0);
  });

  it('crosses a month boundary correctly', () => {
    expect(computeChildDateCount('2026-10-30', '2026-11-02')).toBe(4);
  });

  it('returns 0 for malformed input', () => {
    expect(computeChildDateCount('not-a-date', '2026-10-17')).toBe(0);
  });
});

describe('enumerateBlockDates', () => {
  it('returns inclusive range as ordered AD strings', () => {
    expect(enumerateBlockDates('2026-10-17', '2026-10-19')).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
    ]);
  });

  it('returns single-day range', () => {
    expect(enumerateBlockDates('2026-10-17', '2026-10-17')).toEqual(['2026-10-17']);
  });

  it('returns empty for inverted range', () => {
    expect(enumerateBlockDates('2026-10-19', '2026-10-17')).toEqual([]);
  });

  it('is TZ-stable in negative-offset hosts (regression guard for C3.7 family)', () => {
    const ORIGINAL_TZ = process.env.TZ;
    try {
      process.env.TZ = 'America/Chicago';
      expect(enumerateBlockDates('2026-10-17', '2026-10-19')).toEqual([
        '2026-10-17',
        '2026-10-18',
        '2026-10-19',
      ]);
    } finally {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    }
  });
});

describe('createCalendarBlockEntity', () => {
  const baseData = {
    blockId: 'b1',
    academicYearId: 'ay-2083',
    blockName: 'Dashain',
    blockDescriptor: 'religious_festival' as const,
    startDate: '2026-10-17',
    endDate: '2026-10-25',
    childEventType: 'break',
    createdAt: '2026-05-17T15:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-05-17T15:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
  };

  it('populates entityType + entityKey + GSI1 keys', () => {
    const e = createCalendarBlockEntity('tenant-1', 'school-1', baseData);
    expect(e.entityType).toBe('CALENDARBLOCK');
    expect(e.entityKey).toBe('SCHOOL#school-1#BLOCK#b1');
    expect(e.gsi1pk).toBe('TENANT#tenant-1#SCHOOL#school-1');
    expect(e.gsi1sk).toBe('CALBLOCK#2026-10-17#b1');
  });

  it('derives childDateCount when not supplied', () => {
    const e = createCalendarBlockEntity('tenant-1', 'school-1', baseData);
    expect(e.childDateCount).toBe(9);
  });

  it('honors caller-supplied childDateCount when present', () => {
    const e = createCalendarBlockEntity('tenant-1', 'school-1', {
      ...baseData,
      childDateCount: 42,
    });
    expect(e.childDateCount).toBe(42);
  });

  it('preserves optional subEvents + description', () => {
    const e = createCalendarBlockEntity('tenant-1', 'school-1', {
      ...baseData,
      description: 'Festival of victory',
      subEvents: [
        { date: '2026-10-22', name: 'Mahaastami' },
        { date: '2026-10-23', name: 'Nawami' },
        { date: '2026-10-24', name: 'Vijaya Dashami' },
      ],
    });
    expect(e.description).toBe('Festival of victory');
    expect(e.subEvents).toHaveLength(3);
    expect(e.subEvents?.[2].name).toBe('Vijaya Dashami');
  });

  it('carries createdBy / updatedBy through unchanged', () => {
    const e = createCalendarBlockEntity('tenant-1', 'school-1', baseData);
    expect(e.createdBy).toBe('user-1');
    expect(e.updatedBy).toBe('user-1');
  });
});

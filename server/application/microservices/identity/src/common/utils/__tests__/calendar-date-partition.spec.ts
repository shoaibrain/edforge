/**
 * Spec for the shared `partitionRowsBySource` helper extracted in Sprint
 * C4-followup from `schools/calendar-date.service.ts`. The original C3.8
 * spec still imports the function from the service path (re-export); this
 * spec exercises the shared util directly.
 */

import type { CalendarDate } from '../../entities/calendar-date.entity';
import { partitionRowsBySource } from '../calendar-date-partition';

const row = (
  date: string,
  createdBy: string,
  updatedBy: string,
): CalendarDate =>
  ({
    entityKey: `SCHOOL#s1#DATE#${date}`,
    date,
    createdBy,
    updatedBy,
  } as CalendarDate);

describe('partitionRowsBySource (shared util)', () => {
  it('marks rows where both audit fields are SYSTEM as deletable', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([
      row('2026-10-17', 'SYSTEM', 'SYSTEM'),
      row('2026-10-18', 'SYSTEM', 'SYSTEM'),
    ]);
    expect(systemRowKeys).toEqual([
      'SCHOOL#s1#DATE#2026-10-17',
      'SCHOOL#s1#DATE#2026-10-18',
    ]);
    expect(preservedDates.size).toBe(0);
  });

  it('preserves operator-created rows (createdBy !== SYSTEM)', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([
      row('2026-10-17', 'user-1', 'user-1'),
    ]);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.has('2026-10-17')).toBe(true);
  });

  it('preserves rows an operator edited on top of a SYSTEM-generated row', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([
      row('2026-10-17', 'SYSTEM', 'user-1'),
    ]);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.has('2026-10-17')).toBe(true);
  });

  it('correctly splits a mixed batch (mirrors the C4-followup merge-mode preflight)', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([
      row('2026-10-17', 'SYSTEM', 'SYSTEM'),       // safe to delete
      row('2026-10-18', 'SYSTEM', 'user-1'),       // operator edit → preserve
      row('2026-10-19', 'user-2', 'user-2'),       // operator-created → preserve
      row('2026-10-20', 'SYSTEM', 'SYSTEM'),       // safe to delete
    ]);
    expect(systemRowKeys.sort()).toEqual([
      'SCHOOL#s1#DATE#2026-10-17',
      'SCHOOL#s1#DATE#2026-10-20',
    ]);
    expect([...preservedDates].sort()).toEqual(['2026-10-18', '2026-10-19']);
  });

  it('handles an empty input', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([]);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.size).toBe(0);
  });
});

/**
 * section-attendance-granular util — the shared distinct-key tally used by the
 * S6 dashboard-truth readers (daily summary dedupes by studentId; per-student
 * range summary dedupes by date).
 */

import { describe, expect, it } from '@jest/globals';
import { granularStudentSets, granularDateSets } from './section-attendance-granular.util';

describe('granularStudentSets (distinct students per status)', () => {
  it('dedupes a student across sections, maps tardy→late, and excludes present/absent/excused', () => {
    const sets = granularStudentSets([
      { studentId: 's1', status: 'late' },
      { studentId: 's1', status: 'present' }, // s1 still counts once for late, present is not an overlay
      { studentId: 's2', status: 'tardy' },   // tardy → late
      { studentId: 's3', status: 'half_day' },
      { studentId: 's4', status: 'remote' },
      { studentId: 's5', status: 'absent' },   // excluded
      { studentId: 's6', status: 'excused' },  // excluded
    ]);
    expect([...sets.late].sort()).toEqual(['s1', 's2']);
    expect([...sets.halfDay]).toEqual(['s3']);
    expect([...sets.remote]).toEqual(['s4']);
  });
});

describe('granularDateSets (distinct dates per status)', () => {
  it('dedupes dates per status — a student late in two sections the same day is one late date', () => {
    const sets = granularDateSets([
      { date: '2026-06-10', status: 'late' },
      { date: '2026-06-10', status: 'late' }, // same date, two sections
      { date: '2026-06-11', status: 'tardy' }, // tardy → late
      { date: '2026-06-10', status: 'half_day' },
      { date: '2026-06-09', status: 'present' }, // not an overlay
    ]);
    expect([...sets.late].sort()).toEqual(['2026-06-10', '2026-06-11']);
    expect([...sets.halfDay]).toEqual(['2026-06-10']);
    expect([...sets.remote].length).toBe(0);
  });
});

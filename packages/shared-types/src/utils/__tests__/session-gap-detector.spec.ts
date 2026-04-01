/**
 * Session Gap Detector Tests
 */

import { detectSessionGaps, type SessionForGapDetection } from '../session-gap-detector';

describe('detectSessionGaps', () => {
  it('should return empty array for fewer than 2 sessions', () => {
    expect(detectSessionGaps([])).toEqual([]);
    expect(detectSessionGaps([{ sessionName: 'S1', beginDate: '2026-01-01', endDate: '2026-06-30' }])).toEqual([]);
  });

  it('should detect a gap between two sessions', () => {
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'Third Semester', beginDate: '2026-07-19', endDate: '2026-09-08' },
      { sessionName: 'Fourth Semester', beginDate: '2026-09-14', endDate: '2026-12-31' },
    ];
    const gaps = detectSessionGaps(sessions);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].dayCount).toBe(5);
    expect(gaps[0].beforeSession).toBe('Third Semester');
    expect(gaps[0].afterSession).toBe('Fourth Semester');
    expect(gaps[0].gapStart).toBe('2026-09-09');
    expect(gaps[0].gapEnd).toBe('2026-09-13');
  });

  it('should not flag contiguous sessions', () => {
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'First', beginDate: '2026-03-29', endDate: '2026-04-29' },
      { sessionName: 'Second', beginDate: '2026-04-30', endDate: '2026-07-19' },
    ];
    const gaps = detectSessionGaps(sessions);
    expect(gaps).toHaveLength(0);
  });

  it('should not flag small gaps under the threshold', () => {
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'First', beginDate: '2026-03-29', endDate: '2026-06-30' },
      { sessionName: 'Second', beginDate: '2026-07-02', endDate: '2026-12-31' },
    ];
    // 1-day gap (July 1) — under default 3-day threshold
    const gaps = detectSessionGaps(sessions);
    expect(gaps).toHaveLength(0);
  });

  it('should detect multiple gaps across 4 sessions', () => {
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'S1', beginDate: '2026-01-01', endDate: '2026-03-15' },
      { sessionName: 'S2', beginDate: '2026-03-25', endDate: '2026-06-15' },
      { sessionName: 'S3', beginDate: '2026-06-16', endDate: '2026-09-08' },
      { sessionName: 'S4', beginDate: '2026-09-20', endDate: '2026-12-31' },
    ];
    const gaps = detectSessionGaps(sessions);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].beforeSession).toBe('S1');
    expect(gaps[0].afterSession).toBe('S2');
    expect(gaps[1].beforeSession).toBe('S3');
    expect(gaps[1].afterSession).toBe('S4');
  });

  it('should sort sessions by beginDate before detecting gaps', () => {
    // Pass in reverse order
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'Fourth', beginDate: '2026-09-14', endDate: '2026-12-31' },
      { sessionName: 'First', beginDate: '2026-03-29', endDate: '2026-04-29' },
      { sessionName: 'Third', beginDate: '2026-07-19', endDate: '2026-09-08' },
      { sessionName: 'Second', beginDate: '2026-04-30', endDate: '2026-07-19' },
    ];
    const gaps = detectSessionGaps(sessions);
    // Only the Third->Fourth gap should be detected
    expect(gaps).toHaveLength(1);
    expect(gaps[0].beforeSession).toBe('Third');
    expect(gaps[0].afterSession).toBe('Fourth');
  });

  it('should respect custom minGapDays threshold', () => {
    const sessions: SessionForGapDetection[] = [
      { sessionName: 'S1', beginDate: '2026-01-01', endDate: '2026-03-15' },
      { sessionName: 'S2', beginDate: '2026-03-20', endDate: '2026-06-15' },
    ];
    // 4-day gap — should be detected with default threshold (3)
    expect(detectSessionGaps(sessions, 3)).toHaveLength(1);
    // But not with threshold of 5
    expect(detectSessionGaps(sessions, 5)).toHaveLength(0);
  });
});

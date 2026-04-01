/**
 * Session Gap Detector — Ed-Fi Session temporal integrity validation
 *
 * Detects gaps between consecutive academic sessions that may indicate
 * misconfiguration. Sessions should ideally cover the full academic year
 * without unexplained gaps.
 *
 * Ed-Fi alignment: Validates Session.beginDate/endDate continuity.
 */

export interface SessionForGapDetection {
  sessionName: string;
  beginDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface SessionGap {
  gapStart: string;       // YYYY-MM-DD (first day of gap)
  gapEnd: string;         // YYYY-MM-DD (last day of gap)
  dayCount: number;       // Number of calendar days in the gap
  beforeSession: string;  // Name of session ending before the gap
  afterSession: string;   // Name of session starting after the gap
}

/**
 * Detect gaps between consecutive academic sessions.
 *
 * A gap is defined as 3+ calendar days between one session's endDate
 * and the next session's beginDate. Gaps of 1-2 days are considered
 * normal (grading transition, administrative days).
 *
 * @param sessions - Array of sessions with name and date range
 * @param minGapDays - Minimum gap size to report (default: 3)
 * @returns Array of detected gaps, empty if sessions are contiguous
 */
export function detectSessionGaps(
  sessions: SessionForGapDetection[],
  minGapDays: number = 3,
): SessionGap[] {
  if (sessions.length < 2) return [];

  const sorted = [...sessions].sort((a, b) => a.beginDate.localeCompare(b.beginDate));
  const gaps: SessionGap[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = new Date(sorted[i].endDate + 'T12:00:00Z');
    const nextStart = new Date(sorted[i + 1].beginDate + 'T12:00:00Z');

    // Gap = days between endDate and beginDate, exclusive of both
    const diffMs = nextStart.getTime() - currentEnd.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) - 1;

    if (diffDays >= minGapDays) {
      const gapStart = new Date(sorted[i].endDate + 'T12:00:00Z');
      gapStart.setDate(gapStart.getDate() + 1);

      const gapEnd = new Date(sorted[i + 1].beginDate + 'T12:00:00Z');
      gapEnd.setDate(gapEnd.getDate() - 1);

      gaps.push({
        gapStart: gapStart.toISOString().split('T')[0],
        gapEnd: gapEnd.toISOString().split('T')[0],
        dayCount: diffDays,
        beforeSession: sorted[i].sessionName,
        afterSession: sorted[i + 1].sessionName,
      });
    }
  }

  return gaps;
}

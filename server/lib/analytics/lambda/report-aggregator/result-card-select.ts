/**
 * Reporting-card selection — which ResultCard represents a student's IEMIS
 * Flash II "final exam achievement for the academic session" (exam_gpa /
 * exam_total_marks).
 *
 * Default strategy is `terminal`: the card from the exam flagged
 * `isTerminalExam` (the year-end/annual exam) — the right answer for Nepali
 * PABSON schools per the CEHRD "final exam achievement" framing. The strategy
 * is intentionally PLUGGABLE: real PABSON usage will clarify whether some
 * authorities want a cumulative-across-terms figure instead, and that can be
 * switched via the `REPORTING_CARD_STRATEGY` env var (or an explicit arg)
 * WITHOUT touching the Flash II transforms. (`cumulative` is reserved for that
 * follow-up; not implemented until a concrete requirement lands.)
 */

export interface ReportRowResultCard {
  enrollmentId: string;
  examId: string;
  termId: string;
  isTerminalExam: boolean;
  totalScore: number;
  totalMaxMarks: number;
  termGpa: number;
  percentage?: number;
  /** ISO timestamp; ties broken newest-first when several cards qualify. */
  generatedAt?: string;
}

export type ReportingCardStrategy = 'terminal' | 'latest';

/** Operator-overridable default; `terminal` unless explicitly switched. */
export function defaultReportingCardStrategy(): ReportingCardStrategy {
  return process.env.REPORTING_CARD_STRATEGY === 'latest' ? 'latest' : 'terminal';
}

function newestFirst(cards: ReportRowResultCard[]): ReportRowResultCard {
  return [...cards].sort((a, b) =>
    (b.generatedAt ?? '').localeCompare(a.generatedAt ?? ''),
  )[0];
}

/**
 * Pick the single ResultCard that represents the student's year-end IEMIS
 * achievement. `terminal` prefers terminal-exam cards (newest if several) and
 * falls back to the newest card overall, so a school that hasn't flagged a
 * terminal exam still reports *something* rather than a blank.
 */
export function selectReportingCard(
  cards: ReportRowResultCard[] | undefined,
  strategy: ReportingCardStrategy = 'terminal',
): ReportRowResultCard | undefined {
  if (!cards || cards.length === 0) return undefined;
  if (strategy === 'latest') return newestFirst(cards);
  const terminal = cards.filter((c) => c.isTerminalExam);
  return terminal.length > 0 ? newestFirst(terminal) : newestFirst(cards);
}

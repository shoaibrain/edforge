/**
 * Derive the token fed to computeAcademicStatus for Flash II `academic_status`.
 *
 * The IEMIS year-end status reflects the per-student PROMOTION OUTCOME, which
 * lives in `enrollment.promotionDecision` (enum: promoted/retained/conditional/
 * graduated/withdrawn/transferred_out, set by the promotion-commit workflow).
 * It is NOT the close-year `exitWithdrawTypeDescriptor`, which is the uniform
 * Ed-Fi marker `'End of school year'` for *everyone* who completed the year and
 * carries no pass/repeat signal. (Surfaced by the 2026-06-07 dev-pabson smoke:
 * close-year students had blank academic_status because the mapper only saw
 * 'End of school year'.)
 *
 * We combine the promotion decision (primary) with the transfer/dropout signal
 * into a token whose substrings computeAcademicStatus already maps
 * (promoted / repeated / transfer / dropout). Falls back to the raw
 * exitWithdrawType for the explicit-withdraw path (e.g. exitType 'Promoted'),
 * and to '' for a bare 'End of school year' with no recorded outcome.
 */
export function deriveReportingEndStatus(
  promotionDecision: string | undefined,
  exitWithdrawType: string | undefined,
  status: string | undefined,
): string {
  const exit = (exitWithdrawType ?? '').toLowerCase();
  const decision = (promotionDecision ?? '').toLowerCase();
  const transferred = exit.includes('transfer') || decision === 'transferred_out';

  // Mid/end-of-year exit as a dropout/withdrawal takes precedence.
  if (exit.includes('drop') || decision === 'withdrawn') return 'dropout';

  switch (decision) {
    case 'promoted':
    case 'conditional': // V1 treats conditional promotion as promoted
    case 'graduated':   // completed the final grade
      return transferred ? 'promoted transfer' : 'promoted';
    case 'retained':
      return transferred ? 'repeated transfer' : 'repeated';
    case 'transferred_out':
      return 'promoted transfer';
    default:
      break;
  }

  // No promotion decision recorded. Fall back to the raw exitWithdrawType so the
  // explicit-withdraw path still maps; a bare 'End of school year' (completed,
  // outcome not recorded) yields '' — graceful, as observed in the smoke.
  if (exit.includes('end of school year')) return '';
  return exitWithdrawType ?? status ?? '';
}

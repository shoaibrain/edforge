/**
 * Grade applicability for fee structures — the single rule shared by
 * bulk preview and both bulk generation paths (#477).
 *
 * A fee structure with an empty `gradeLevels` applies to every grade; one
 * with entries applies only to those grades. The rule already existed in
 * three places that disagreed: `generate()` enforced it but only when the
 * caller passed `dto.gradeLevel`, which neither bulk path did, so bulk wrote
 * every selected fee onto every student regardless of grade. Preview never
 * evaluated it at all, so its `eligibleCount` overstated the batch.
 */

/** Minimal shape needed to decide applicability. */
export interface GradeScopedFee {
  gradeLevels: string[];
}

/**
 * Whether `fee` may be billed to a student in `gradeLevel`.
 *
 * An unknown grade returns `true`: the caller could not resolve the student's
 * grade, and silently dropping a fee on that basis would under-bill without
 * telling anyone. Callers that need a resolved grade must check for one
 * themselves — see `partitionFeesByGrade`.
 */
export function feeAppliesToGrade(fee: GradeScopedFee, gradeLevel?: string): boolean {
  if (!gradeLevel) return true;
  if (fee.gradeLevels.length === 0) return true;
  return fee.gradeLevels.includes(gradeLevel);
}

/**
 * Split `fees` into the ones billable to `gradeLevel` and the ones that are
 * not. `applicable` preserves input order.
 *
 * `gradeResolved` is false when no grade was supplied, in which case every fee
 * lands in `applicable` and no student should be skipped on grade grounds.
 */
export function partitionFeesByGrade<T extends GradeScopedFee>(
  fees: T[],
  gradeLevel?: string,
): { applicable: T[]; excluded: T[]; gradeResolved: boolean } {
  if (!gradeLevel) {
    return { applicable: [...fees], excluded: [], gradeResolved: false };
  }
  const applicable: T[] = [];
  const excluded: T[] = [];
  for (const fee of fees) {
    if (feeAppliesToGrade(fee, gradeLevel)) applicable.push(fee);
    else excluded.push(fee);
  }
  return { applicable, excluded, gradeResolved: true };
}

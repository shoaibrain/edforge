/**
 * Academics Domain Schemas
 * 
 * Re-exports all academics-related Zod schemas and types.
 */

export * from './student.schema';
export * from './classroom.schema';
export * from './attendance.schema';
export * from './section-attendance.schema';
export * from './attendance-policy.schema';
export * from './daily-attendance.schema';
export * from './grade.schema';
export * from './assignment.schema';
export * from './course.schema';
export * from './course-section.schema';
export * from './course-offering.schema';
export * from './grading-policy.schema';
export * from './classwork.schema';

// Sprint A.3 — Exam Subsystem (term-end exam + per-course + per-score)
export * from './exam.schema';
export * from './exam-course.schema';
export * from './exam-score.schema';

// Sprint A.4 — Result Subsystem (per-student per-term ResultCard)
export * from './result-card.schema';

// Sprint D.2 — PromotionRule + cross-year handoff
export * from './promotion-rule.schema';
export * from './promotion-evaluation.schema';

// EPIC-FB Sprint FB-1 — FamilyGroup (sibling linkage for family billing)
export * from './family.schema';

// Sprint D.3 — ExternalAssessment family (foundation)
export * from './external-exam-shared.schema';
export * from './rubric-category.schema';
export * from './external-exam-registration.schema';
export * from './internal-assessment.schema';
export * from './external-exam-admit-card.schema';
export * from './external-exam-result.schema';
export * from './external-exam-retake.schema';

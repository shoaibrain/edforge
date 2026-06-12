/**
 * @edforge/pilot-fixtures/demo — public-alpha demo data engine (Sprint S1).
 *
 * Parametric, deterministic generator that expands a per-archetype roster
 * config into a complete demo tenant entity set (schools, staff, students,
 * courses, sections, exams + marks + result cards, fees + invoices +
 * payments). Consumed by the `scripts/demo-seed/` loader (S1.10), which
 * POSTs the bundle into a provisioned tenant through the real service APIs.
 *
 * Workspace-only — like the rest of this package, never imported by a
 * Docker-built ECS service (S1.13).
 */

export * from './roster-config';
export * from './synthetic-identity';
export * from './generated-types';
export * from './generate-academic-foundation';
export * from './generate-sections';
export * from './generate-staff';
export * from './generate-students';
export * from './generate-courses';
export * from './generate-exams';
export * from './generate-finance';
export * from './generate';
export * from './seeder';

/**
 * StaffTraining Entity — Identity Service (Sprint B.2)
 *
 * DynamoDB entity for staff professional development / training records.
 * Mirrors the Credential entity pattern but is a separate first-class entity
 * because credential = static qualification, training = event with duration +
 * status — see docs/decisions/staff-training-entity-design.md for the full
 * rationale (B.1 ADR).
 *
 * Key Patterns:
 *   PK: TENANT#{tenantId}
 *   SK: STAFF#{staffId}#TRAIN#{trainingId}
 *
 * GSI1 (Training-type lookup, sparse):
 *   gsi1pk: TRAINTYPE#{trainingType}
 *   gsi1sk: STARTDATE#{startDate}
 *
 * Used by Sprint K (Flash-II Staff register export) for aggregating per-staff
 * annual training hours by type.
 */

import { BaseEntity } from './base.entity';

// ============================================
// Training Types (CEHRD-aligned vocabulary)
// ============================================

/**
 * Training categories aligned to CEHRD Teacher Professional Development
 * vocabulary. `'other'` is the safety valve for trainings that don't fit
 * the canonical categories — operator can add freeform `notes`. Adding a
 * new category later = additive Zod-enum change + shared-types minor bump,
 * no DDB migration.
 */
export type TrainingType =
  | 'pedagogical'      // teaching methods, classroom management
  | 'subject_matter'   // content knowledge in a subject area
  | 'technology'       // digital literacy, ed-tech tools
  | 'inclusion'        // inclusive ed, special needs, gender sensitivity
  | 'leadership'       // school admin / management training
  | 'safety'           // school safety, first aid, child protection
  | 'assessment'       // evaluation methods (formative / summative)
  | 'language'         // language proficiency, English language teaching
  | 'induction'        // new-teacher onboarding, probation training
  | 'other';

/**
 * Training lifecycle status. **Operator-set, not derived from dates** — see
 * B.1 ADR §5.5: trainings can be retroactively recorded where date-derived
 * status would be wrong.
 */
export type TrainingStatus =
  | 'scheduled'    // start_date in the future
  | 'in_progress'  // start_date <= today, end_date in the future or absent
  | 'completed'    // training finished
  | 'cancelled';   // training did not happen

// ============================================
// StaffTraining Entity Interface
// ============================================

export interface StaffTraining extends BaseEntity {
  entityType: 'STAFF_TRAINING';

  // Identifiers
  trainingId: string;
  staffId: string;

  // Core fields
  trainingTitle: string;            // human-readable, max 150
  trainingType: TrainingType;
  trainingProvider: string;         // org name, max 150 — not PII for audit
  startDate: string;                // YYYY-MM-DD
  endDate?: string;                 // YYYY-MM-DD; absent for ongoing
  durationHours: number;            // 0–9999 — CEHRD reporting input

  // Lifecycle
  status: TrainingStatus;

  // Optional
  certificateNumber?: string;       // self-reported, max 100
  certificateUrl?: string;          // S3 URL — future upload UI (V1 deferred)
  notes?: string;                   // free text, max 1000 — NOT in audit metadata

  // GSI1 keys — list trainings by trainingType, sorted by startDate.
  // Sprint S3.2 — RENAMED from uppercase. DDB GSI1 attribute names are
  // lowercase (server/lib/tenant-template/ecs-dynamodb.ts:53-54); the
  // uppercase variant was silently NOT populating the index since this
  // entity was first written. Companion fix to S3.1 (calendar-date).
  gsi1pk?: string;                  // TRAINTYPE#{trainingType}
  gsi1sk?: string;                  // STARTDATE#{startDate}
}

// ============================================
// Entity Key Builders
// ============================================

export const StaffTrainingKeyBuilder = {
  /** SK: STAFF#{staffId}#TRAIN#{trainingId} */
  training: (staffId: string, trainingId: string): string =>
    `STAFF#${staffId}#TRAIN#${trainingId}`,

  /** Prefix for listing all trainings for a staff member. */
  trainingsPrefix: (staffId: string): string =>
    `STAFF#${staffId}#TRAIN#`,

  /** gsi1pk: TRAINTYPE#{trainingType} */
  typeLookup: (trainingType: TrainingType): string =>
    `TRAINTYPE#${trainingType}`,

  /** gsi1sk: STARTDATE#{startDate} — fixed-width-friendly with ISO date. */
  startDateSort: (startDate: string): string =>
    `STARTDATE#${startDate || '0000-00-00'}`,
};

// ============================================
// Factory
// ============================================

export function createStaffTrainingEntity(
  tenantId: string,
  staffId: string,
  trainingId: string,
  data: Omit<
    StaffTraining,
    'tenantId' | 'entityKey' | 'entityType' | 'trainingId' | 'staffId' | 'gsi1pk' | 'gsi1sk'
  >,
): StaffTraining {
  return {
    tenantId,
    entityKey: StaffTrainingKeyBuilder.training(staffId, trainingId),
    entityType: 'STAFF_TRAINING',
    trainingId,
    staffId,
    ...data,
    gsi1pk: StaffTrainingKeyBuilder.typeLookup(data.trainingType),
    gsi1sk: StaffTrainingKeyBuilder.startDateSort(data.startDate),
  };
}

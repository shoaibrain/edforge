/**
 * IEMIS Import Job Entity for Academics Service
 *
 * Tracks one async invocation of the bulk-IEMIS-import pipeline. The HTTP
 * request returns 202 + jobId immediately; the worker continues running in
 * the same ECS task via setImmediate, writing progress updates to this row.
 * The frontend polls GET /students/import/iemis/jobs/:jobId until status
 * is terminal (succeeded | failed).
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: IEMIS_JOB#{jobId}
 *
 * No GSIs — direct GetItem by jobId is the only access pattern.
 *
 * Findings + duplicates are capped at 500 each to keep the row under DDB's
 * 400KB hard limit. When truncation happens, `findingsTruncated` /
 * `duplicatesTruncated` are set; the UI shows a banner and the user can
 * re-run a dryRun to download the full CSV.
 */

import {
  BaseEntity,
  EntityKeyBuilder,
} from './base.entity';

export type IemisImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface IemisImportJobFinding {
  row: number;
  field: string;
  level: 'warn' | 'error';
  message: string;
}

export interface IemisImportJobDuplicate {
  row: number;
  emisStudentId: string;
  existingStudentId: string;
}

export interface IemisImportJob extends BaseEntity {
  entityType: 'IEMIS_IMPORT_JOB';

  jobId: string;
  schoolId: string;
  status: IemisImportJobStatus;

  /** Total rows submitted (does not change once set). */
  totalRows: number;

  /** Optional academic-year-id the user chose to enroll new students into.
   *  When set, the worker writes both Student + Enrollment per row. */
  enrollInAcademicYearId?: string;

  // ── Counters (advance during run, frozen on terminal status) ──
  /** Rows that completed Student create successfully. */
  studentsCreated: number;
  /** Rows that completed Enrollment create successfully. Only meaningful when
   *  enrollInAcademicYearId is set; otherwise stays 0. */
  studentsEnrolled: number;
  /** Rows that failed at Student create or before. */
  failed: number;
  /** Rows skipped as duplicates (existing emisStudentId match). */
  skipped: number;

  // ── Findings (capped at 500 to stay under DDB 400KB row limit) ──
  findings: IemisImportJobFinding[];
  findingsTruncated: boolean;
  duplicates: IemisImportJobDuplicate[];
  duplicatesTruncated: boolean;

  // ── Lifecycle timestamps ──
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  /** Error summary on terminal=failed. Single string, no stack trace
   *  (privacy + not useful to operators). */
  error?: string;
}

const FINDINGS_CAP = 500;
const DUPLICATES_CAP = 500;

export function capFindings(findings: IemisImportJobFinding[]): {
  findings: IemisImportJobFinding[];
  truncated: boolean;
} {
  if (findings.length <= FINDINGS_CAP) {
    return { findings, truncated: false };
  }
  return { findings: findings.slice(0, FINDINGS_CAP), truncated: true };
}

export function capDuplicates(duplicates: IemisImportJobDuplicate[]): {
  duplicates: IemisImportJobDuplicate[];
  truncated: boolean;
} {
  if (duplicates.length <= DUPLICATES_CAP) {
    return { duplicates, truncated: false };
  }
  return { duplicates: duplicates.slice(0, DUPLICATES_CAP), truncated: true };
}

/**
 * Construct an IemisImportJob entity row in the queued state.
 */
export function createIemisImportJobEntity(
  tenantId: string,
  jobId: string,
  schoolId: string,
  totalRows: number,
  context: { userId: string },
  enrollInAcademicYearId?: string,
): IemisImportJob {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.iemisImportJob(jobId),
    entityType: 'IEMIS_IMPORT_JOB',
    jobId,
    schoolId,
    status: 'queued',
    totalRows,
    enrollInAcademicYearId,
    studentsCreated: 0,
    studentsEnrolled: 0,
    failed: 0,
    skipped: 0,
    findings: [],
    findingsTruncated: false,
    duplicates: [],
    duplicatesTruncated: false,
    createdAt: now,
    createdBy: context.userId,
    updatedAt: now,
    updatedBy: context.userId,
    version: 1,
  };
}

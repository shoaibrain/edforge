/**
 * Unit tests for the IemisImportJob entity helpers.
 *
 * Why these specific cases get tests:
 *   - capFindings / capDuplicates: cap is a defense against the DDB 400KB
 *     row limit; if either accidentally passes the full array through,
 *     a real 779-row Saraswati import with hundreds of warnings could
 *     cause a putItem failure mid-job and finalize as `failed`. These
 *     tests lock the cap.
 *   - createIemisImportJobEntity: the row layout (PK/SK + initial counters
 *     + entityType discriminator) is consumed by both the worker and the
 *     status endpoint. A regression here is invisible to TypeScript but
 *     immediately breaks polling.
 */

import {
  capFindings,
  capDuplicates,
  createIemisImportJobEntity,
  type IemisImportJobFinding,
  type IemisImportJobDuplicate,
} from './iemis-import-job.entity';

describe('iemis-import-job.entity', () => {
  describe('capFindings', () => {
    it('returns input unchanged + truncated=false when below the cap', () => {
      const findings: IemisImportJobFinding[] = Array.from({ length: 10 }, (_, i) => ({
        row: i + 1,
        field: 'CurrentClass',
        level: 'warn',
        message: `m${i}`,
      }));
      const out = capFindings(findings);
      expect(out.findings).toHaveLength(10);
      expect(out.truncated).toBe(false);
      expect(out.findings[0]).toBe(findings[0]); // same reference, no copy
    });

    it('caps to 500 + truncated=true when above', () => {
      const findings: IemisImportJobFinding[] = Array.from({ length: 750 }, (_, i) => ({
        row: i + 1,
        field: 'CurrentClass',
        level: 'warn',
        message: `m${i}`,
      }));
      const out = capFindings(findings);
      expect(out.findings).toHaveLength(500);
      expect(out.truncated).toBe(true);
      expect(out.findings[0].row).toBe(1);
      expect(out.findings[499].row).toBe(500);
    });

    it('handles empty input', () => {
      const out = capFindings([]);
      expect(out.findings).toEqual([]);
      expect(out.truncated).toBe(false);
    });

    it('handles exactly 500 — boundary, NOT truncated', () => {
      const findings: IemisImportJobFinding[] = Array.from({ length: 500 }, (_, i) => ({
        row: i + 1,
        field: 'X',
        level: 'error',
        message: 'm',
      }));
      const out = capFindings(findings);
      expect(out.findings).toHaveLength(500);
      expect(out.truncated).toBe(false);
    });
  });

  describe('capDuplicates', () => {
    it('caps to 500 + truncated=true above the cap', () => {
      const dups: IemisImportJobDuplicate[] = Array.from({ length: 600 }, (_, i) => ({
        row: i + 1,
        emisStudentId: `${i}`,
        existingStudentId: `s${i}`,
      }));
      const out = capDuplicates(dups);
      expect(out.duplicates).toHaveLength(500);
      expect(out.truncated).toBe(true);
    });

    it('keeps the head of the input (preserves row ordering for operator readability)', () => {
      const dups: IemisImportJobDuplicate[] = Array.from({ length: 700 }, (_, i) => ({
        row: i + 1,
        emisStudentId: `${i}`,
        existingStudentId: `s${i}`,
      }));
      const out = capDuplicates(dups);
      expect(out.duplicates[0].row).toBe(1);
      expect(out.duplicates[499].row).toBe(500);
    });
  });

  describe('createIemisImportJobEntity', () => {
    const ctx = { userId: 'user-123' };

    it('writes the canonical PK/SK shape', () => {
      const job = createIemisImportJobEntity(
        'tenant-abc',
        'job-001',
        'school-xyz',
        100,
        ctx,
      );
      expect(job.tenantId).toBe('tenant-abc');
      expect(job.entityKey).toBe('IEMIS_JOB#job-001');
      expect(job.entityType).toBe('IEMIS_IMPORT_JOB');
    });

    it('initializes counters to zero', () => {
      const job = createIemisImportJobEntity('t', 'j', 's', 50, ctx);
      expect(job.studentsCreated).toBe(0);
      expect(job.studentsEnrolled).toBe(0);
      expect(job.failed).toBe(0);
      expect(job.skipped).toBe(0);
      expect(job.findings).toEqual([]);
      expect(job.findingsTruncated).toBe(false);
      expect(job.duplicates).toEqual([]);
      expect(job.duplicatesTruncated).toBe(false);
    });

    it('starts in the queued state', () => {
      const job = createIemisImportJobEntity('t', 'j', 's', 50, ctx);
      expect(job.status).toBe('queued');
      expect(job.startedAt).toBeUndefined();
      expect(job.completedAt).toBeUndefined();
      expect(job.error).toBeUndefined();
    });

    it('records totalRows + schoolId verbatim', () => {
      const job = createIemisImportJobEntity('t', 'j', 'school-pilot', 779, ctx);
      expect(job.totalRows).toBe(779);
      expect(job.schoolId).toBe('school-pilot');
    });

    it('passes through enrollInAcademicYearId when provided', () => {
      const job = createIemisImportJobEntity('t', 'j', 's', 10, ctx, 'ay-2026');
      expect(job.enrollInAcademicYearId).toBe('ay-2026');
    });

    it('leaves enrollInAcademicYearId undefined when omitted', () => {
      const job = createIemisImportJobEntity('t', 'j', 's', 10, ctx);
      expect(job.enrollInAcademicYearId).toBeUndefined();
    });

    it('stamps audit fields with the caller userId + an ISO timestamp', () => {
      const job = createIemisImportJobEntity('t', 'j', 's', 10, ctx);
      expect(job.createdBy).toBe('user-123');
      expect(job.updatedBy).toBe('user-123');
      expect(job.version).toBe(1);
      expect(job.createdAt).toBe(job.updatedAt);
      expect(() => new Date(job.createdAt).toISOString()).not.toThrow();
    });
  });
});

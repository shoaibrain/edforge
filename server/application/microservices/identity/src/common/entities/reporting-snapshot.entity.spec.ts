/**
 * Sprint E.1.1 — ReportingSnapshot entity unit spec.
 *
 * Covers the state-machine guard + factory. Persistence (DDB writes,
 * audited write integration) is covered by the service spec in
 * external-reporting/reporting-snapshot.service.spec.ts (E.1.4).
 */

import {
  createReportingSnapshotEntity,
  isLegalTransition,
  type ReportingSnapshotStatus,
} from './reporting-snapshot.entity';

describe('ReportingSnapshot — state machine', () => {
  it('allows generating → generated', () => {
    expect(isLegalTransition('generating', 'generated')).toBe(true);
  });

  it('allows generating → failed', () => {
    expect(isLegalTransition('generating', 'failed')).toBe(true);
  });

  it('allows generated → submitted', () => {
    expect(isLegalTransition('generated', 'submitted')).toBe(true);
  });

  it('allows generated → failed', () => {
    expect(isLegalTransition('generated', 'failed')).toBe(true);
  });

  it('allows submitted → verified', () => {
    expect(isLegalTransition('submitted', 'verified')).toBe(true);
  });

  it('allows submitted → failed', () => {
    expect(isLegalTransition('submitted', 'failed')).toBe(true);
  });

  it('rejects verified → anything (terminal)', () => {
    const allOtherStatuses: ReportingSnapshotStatus[] = [
      'generating',
      'generated',
      'submitted',
      'failed',
    ];
    for (const next of allOtherStatuses) {
      expect(isLegalTransition('verified', next)).toBe(false);
    }
  });

  it('rejects failed → anything (terminal)', () => {
    const allOtherStatuses: ReportingSnapshotStatus[] = [
      'generating',
      'generated',
      'submitted',
      'verified',
    ];
    for (const next of allOtherStatuses) {
      expect(isLegalTransition('failed', next)).toBe(false);
    }
  });

  it('rejects generating → submitted (must go via generated)', () => {
    expect(isLegalTransition('generating', 'submitted')).toBe(false);
    expect(isLegalTransition('generating', 'verified')).toBe(false);
  });

  it('rejects backward transitions', () => {
    expect(isLegalTransition('generated', 'generating')).toBe(false);
    expect(isLegalTransition('submitted', 'generated')).toBe(false);
    expect(isLegalTransition('verified', 'submitted')).toBe(false);
  });
});

describe('ReportingSnapshot — factory', () => {
  it('builds a starting-state row with status=generating', () => {
    const e = createReportingSnapshotEntity({
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      snapshotId: 'snap-1',
      templateId: 'IEMIS_NPL_CEHRD_FLASH_I',
      academicYearBs: '2083',
      schemaVersion: 'v1',
      createdBy: 'user-1',
    });

    expect(e.entityType).toBe('REPORTING_SNAPSHOT');
    expect(e.status).toBe('generating');
    expect(e.snapshotId).toBe('snap-1');
    expect(e.schoolId).toBe('school-1');
    expect(e.templateId).toBe('IEMIS_NPL_CEHRD_FLASH_I');
    expect(e.academicYearBs).toBe('2083');
    expect(e.schemaVersion).toBe('v1');
    expect(e.entityKey).toBe('SCHOOL#school-1#REPORTING_SNAPSHOT#snap-1');
    expect(e.version).toBe(1);
    expect(e.createdBy).toBe('user-1');
    expect(e.updatedBy).toBe('user-1');
    expect(e.createdAt).toEqual(e.updatedAt);
  });

  it('passes through dryRun flag', () => {
    const e = createReportingSnapshotEntity({
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      snapshotId: 'snap-dry',
      templateId: 'IEMIS_NPL_CEHRD_FLASH_II',
      academicYearBs: '2083',
      schemaVersion: 'v1',
      createdBy: 'user-1',
      dryRun: true,
    });
    expect(e.dryRun).toBe(true);
  });

  it('leaves generation artifacts unset on creation', () => {
    const e = createReportingSnapshotEntity({
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      snapshotId: 'snap-1',
      templateId: 'IEMIS_NPL_CEHRD_FLASH_I',
      academicYearBs: '2083',
      schemaVersion: 'v1',
      createdBy: 'user-1',
    });
    expect(e.s3Key).toBeUndefined();
    expect(e.rowCount).toBeUndefined();
    expect(e.generatedAt).toBeUndefined();
    expect(e.submittedAt).toBeUndefined();
    expect(e.verifiedAt).toBeUndefined();
    expect(e.errorCode).toBeUndefined();
  });
});

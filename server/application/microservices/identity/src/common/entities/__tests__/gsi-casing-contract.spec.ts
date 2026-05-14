/**
 * GSI Casing Contract Test (Sprint S3.2)
 *
 * Guards against the regression that bit us twice — once in CalendarDate
 * (S3.1) and once across StaffTraining / Leave / Calendar / Credential
 * (S3.2). DynamoDB attribute names are case-sensitive; our GSI1 index is
 * defined on lowercase `gsi1pk` / `gsi1sk` per the CDK
 * (server/lib/tenant-template/ecs-dynamodb.ts:53-54). Any entity factory
 * that writes uppercase `GSI1PK` / `GSI1SK` silently fails to populate the
 * index, and the bug only surfaces when something queries the index — by
 * which time the data is already missing.
 *
 * What this test checks
 * =====================
 * For every entity factory in `common/entities/`, exercise it with
 * representative data and assert:
 *   - The output object contains lowercase `gsi1pk` / `gsi1sk` if the
 *     entity participates in GSI1 at all
 *   - No uppercase `GSI1PK` / `GSI1SK` keys leak in
 *
 * This is structural, not behavioral — we don't care what the GSI values
 * are, only that they live under the correctly-cased attribute names.
 */

import { createStaffTrainingEntity } from '../staff-training.entity';
import { createLeaveEntity } from '../leave.entity';
import { createCalendarEntity } from '../calendar.entity';
import { createCredentialEntity } from '../credential.entity';

function assertGsiCasing(obj: Record<string, any>, label: string) {
  expect(obj).toHaveProperty('gsi1pk');
  expect(obj).toHaveProperty('gsi1sk');
  expect(typeof obj.gsi1pk).toBe('string');
  expect(typeof obj.gsi1sk).toBe('string');
  // Crucially: the uppercase variants must NOT be present. If they are,
  // somebody re-introduced the casing bug — the entity factory needs a fix.
  expect(obj).not.toHaveProperty('GSI1PK');
  expect(obj).not.toHaveProperty('GSI1SK');
  if ('GSI1PK' in obj || 'GSI1SK' in obj) {
    throw new Error(`${label}: uppercase GSI fields leaked — DDB index is case-sensitive`);
  }
}

describe('GSI casing contract — entity factories must use lowercase gsi1pk/gsi1sk', () => {
  const baseMeta = {
    createdAt: '2026-05-14T00:00:00Z',
    createdBy: 'system',
    updatedAt: '2026-05-14T00:00:00Z',
    updatedBy: 'system',
    version: 1,
  };

  it('createStaffTrainingEntity writes lowercase GSI1 keys', () => {
    const ent = createStaffTrainingEntity('t1', 's1', 'tr1', {
      ...baseMeta,
      trainingTitle: 'Pedagogy 101',
      trainingType: 'pedagogical',
      trainingProvider: 'CEHRD',
      startDate: '2026-05-01',
      durationHours: 8,
      status: 'completed',
    } as any);
    assertGsiCasing(ent, 'StaffTraining');
    expect(ent.gsi1pk).toBe('TRAINTYPE#pedagogical');
    expect(ent.gsi1sk).toBe('STARTDATE#2026-05-01');
  });

  it('createLeaveEntity writes lowercase GSI1 keys', () => {
    const ent = createLeaveEntity('t1', 's1', 'l1', {
      ...baseMeta,
      staffId: 's1',
      staffName: 'Test',
      schoolId: 'sch1',
      leaveType: 'sick',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      durationType: 'full_day',
      totalDays: 2,
      status: 'approved',
    } as any);
    assertGsiCasing(ent, 'Leave');
    expect(ent.gsi1pk).toBe('SCHOOL#sch1');
    expect(ent.gsi1sk).toBe('LEAVE#2026-05-01');
  });

  it('createCalendarEntity writes lowercase GSI1 keys', () => {
    const ent = createCalendarEntity('t1', 'sch1', 'cal1', {
      ...baseMeta,
      academicYearId: 'ay1',
      calendarCode: 'STUDENT-2026',
      calendarTypeDescriptor: 'student',
      isDefault: true,
    } as any);
    assertGsiCasing(ent, 'Calendar');
    expect(ent.gsi1pk).toBe('TENANT#t1#SCHOOL#sch1');
    expect(ent.gsi1sk).toBe('CALENDAR#STUDENT-2026');
  });

  it('createCredentialEntity writes lowercase GSI1 keys', () => {
    const ent = createCredentialEntity('t1', 's1', 'c1', {
      ...baseMeta,
      credentialIdentifier: 'CRED-001',
      credentialTypeDescriptor: 'certification',
      issuanceDate: '2024-01-01',
      expirationDate: '2027-01-01',
      issuingOrganization: 'CEHRD',
      name: 'Teacher Certification',
      verificationStatus: 'verified',
      isRenewable: true,
      renewalReminderDays: 90,
    } as any);
    assertGsiCasing(ent, 'Credential');
    expect(ent.gsi1pk).toBe('CREDTYPE#certification');
    expect(ent.gsi1sk).toBe('EXPIRY#2027-01-01');
  });
});

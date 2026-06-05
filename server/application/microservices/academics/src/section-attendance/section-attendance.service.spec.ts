/**
 * Classroom-UX Sprint 1 (1.2–1.4) — bulk section-attendance reason persistence.
 *
 * Regression fence for the confirmed bug: the bulk path dropped the attendance
 * reason and derived Ed-Fi descriptors from `notes` instead of the reason. These
 * tests pin that the create, update, and reason-only paths persist `reason` and
 * derive the descriptors from it.
 *
 * Built by direct construction + spies on the private helpers (validateInstructionalDay,
 * resolveCourseName, resolveStudentNames, recordAttendanceTaken) so the unit under
 * test is the bulk loop itself, not the surrounding I/O.
 */

import { SectionAttendanceService } from './section-attendance.service';

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';

const context = { tenantId: 't1', userId: 'u1', jwtToken: 'jwt' } as any;

const baseDto = {
  sectionId: '22222222-2222-2222-2222-222222222222',
  date: '2026-06-05',
  schoolId: '33333333-3333-3333-3333-333333333333',
  records: [
    { studentId: STUDENT_ID, studentName: 'Test Student', status: 'absent', excuseReason: 'medical' },
  ],
};

describe('SectionAttendanceService — bulk reason persistence (Sprint 1)', () => {
  let service: SectionAttendanceService;
  let mockDynamoDBClient: any;

  beforeEach(() => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      batchGetItems: jest.fn().mockResolvedValue([]),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn().mockResolvedValue(undefined),
    };
    const mockEvents: any = new Proxy({}, { get: () => jest.fn().mockResolvedValue(undefined) });
    const mockDataScope: any = {
      resolveScope: jest.fn().mockResolvedValue({}),
      isStudentInScope: jest.fn().mockReturnValue(true),
    };
    const mockDerivation: any = { deriveSchoolAttendance: jest.fn().mockResolvedValue(undefined) };

    service = new SectionAttendanceService(
      mockDynamoDBClient,
      mockEvents,
      {} as any,
      mockDataScope,
      mockDerivation,
    );

    // Neutralize the surrounding I/O so the bulk loop is the unit under test.
    jest.spyOn(service as any, 'validateInstructionalDay').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'resolveCourseName').mockResolvedValue('Math 101');
    jest.spyOn(service as any, 'resolveStudentNames').mockResolvedValue(new Map());
    jest.spyOn(service as any, 'recordAttendanceTaken').mockResolvedValue(undefined);
  });

  it('1.2 create: persists reason and derives Ed-Fi descriptors from the reason (not notes)', async () => {
    mockDynamoDBClient.batchGetItems.mockResolvedValue([]); // no existing → create

    await service.recordBulkSectionAttendance(baseDto as any, context);

    expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    const entity = mockDynamoDBClient.putItem.mock.calls[0][1];
    expect(entity.reason).toBe('medical');
    // absent + a reason ⇒ Excused Absence, reason echoed (vs 'Unexcused' with no reason).
    expect(entity.attendanceEventCategory).toBe('Excused Absence');
    expect(entity.attendanceEventReason).toBe('medical');
  });

  it('1.2 create: falls back to excuseType when excuseReason is absent', async () => {
    mockDynamoDBClient.batchGetItems.mockResolvedValue([]);
    const dto = { ...baseDto, records: [{ studentId: STUDENT_ID, status: 'absent', excuseType: 'family_emergency' }] };

    await service.recordBulkSectionAttendance(dto as any, context);

    expect(mockDynamoDBClient.putItem.mock.calls[0][1].reason).toBe('family_emergency');
  });

  it('1.3 update: writes reason = :reason and derives descriptors from the reason', async () => {
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      { studentId: STUDENT_ID, status: 'present', note: null, checkInTime: null, reason: null },
    ]);

    await service.recordBulkSectionAttendance(baseDto as any, context);

    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const call = mockDynamoDBClient.updateItem.mock.calls[0];
    const updateExpr = call[3] as string;
    const values = call[4] as Record<string, any>;
    expect(updateExpr).toContain('reason = :reason');
    expect(values[':reason']).toBe('medical');
    expect(values[':aec']).toBe('Excused Absence');
    expect(values[':aer']).toBe('medical');
  });

  it('1.3 update: a reason-only change is NOT a no-op (counts as an update)', async () => {
    // status/note/checkInTime identical; only the reason differs.
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      { studentId: STUDENT_ID, status: 'absent', note: null, checkInTime: null, reason: null },
    ]);

    await service.recordBulkSectionAttendance(baseDto as any, context);

    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
  });

  it('1.3 no-op: identical status/note/checkInTime/reason skips the write', async () => {
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      { studentId: STUDENT_ID, status: 'absent', note: null, checkInTime: null, reason: 'medical' },
    ]);

    await service.recordBulkSectionAttendance(baseDto as any, context);

    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
  });
});

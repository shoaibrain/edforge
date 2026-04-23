/**
 * Sprint 3 S3.7 — `updateStudentDescriptors` + audit emit tests.
 *
 * Asserts:
 *   - Only descriptor-shaped fields are patched (strict DTO would reject
 *     others at the controller layer, but service must still never write
 *     unexpected attributes).
 *   - `student.descriptor.edited` audit event fires with URI-only metadata.
 *   - `disabilities[].notes` is stripped from the audit payload (privacy
 *     guard per S3.7).
 *   - No-op patch (identical to current state) does NOT emit an audit event.
 *   - Audit emit failure does NOT roll back the Student update (fail-open).
 *   - NotFound when the student doesn't exist.
 */

import { NotFoundException } from '@nestjs/common';
import { StudentsService } from './students.service';

type Mocks = Record<string, jest.Mock>;

function makeService(existing: Record<string, any> | null) {
  const dynamoDBClient: Mocks = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    getItem: jest.fn().mockResolvedValue(existing),
    updateItem: jest.fn().mockImplementation(async (_c, _t, _k, _expr, values) => ({
      ...(existing ?? {}),
      ...stripExpressionValues(values),
    })),
  };
  const iemisAuditLogger: Mocks = {
    emit: jest.fn().mockResolvedValue({ eventId: 'evt-1', timestamp: new Date().toISOString() }),
  };
  const svc = new (StudentsService as any)(
    dynamoDBClient,
    { publishStudentUpdated: jest.fn() }, // eventsService
    {}, // identityClient
    {}, // studentIdService
    {}, // dataScopeService
    {}, // enrollmentService
    {}, // attendanceService
    iemisAuditLogger,
  );
  return { svc, dynamoDBClient, iemisAuditLogger };
}

function stripExpressionValues(values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith(':') && !['updatedAt', 'updatedBy', 'inc'].includes(k.slice(1))) {
      out[k.slice(1)] = v;
    }
  }
  return out;
}

const ctx = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  jwtToken: 'jwt',
  email: 'admin@example.com',
  role: 'TenantAdmin',
};

const existingStudent = {
  tenantId: 'tenant-a',
  studentId: 's-1',
  firstName: 'Roshani',
  lastName: 'Khatun',
  dateOfBirth: '2015-03-13',
  primarySchoolId: 'school-1',
  gender: 'female',
  sexDescriptor: undefined,
  languageDescriptor: undefined,
  disabilities: undefined,
  version: 1,
};

describe('StudentsService.updateStudentDescriptors (S3.7)', () => {
  it('throws NotFound when the student is missing', async () => {
    const { svc } = makeService(null);
    await expect(
      svc.updateStudentDescriptors('missing-id', {}, ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only descriptor fields and emits the audit event', async () => {
    const { svc, dynamoDBClient, iemisAuditLogger } = makeService(existingStudent);

    await svc.updateStudentDescriptors(
      's-1',
      {
        sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
        motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
      },
      ctx,
    );

    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const updateExpr = dynamoDBClient.updateItem.mock.calls[0][3] as string;
    expect(updateExpr).toContain('sexDescriptor = :sexDescriptor');
    expect(updateExpr).toContain('motherTongueDescriptor = :motherTongueDescriptor');
    expect(updateExpr).toContain('version = #version + :inc');

    expect(iemisAuditLogger.emit).toHaveBeenCalledTimes(1);
    const [payload, jwt] = iemisAuditLogger.emit.mock.calls[0];
    expect(jwt).toBe('jwt');
    expect(payload.eventType).toBe('student.descriptor.edited');
    expect(payload.tenantId).toBe('tenant-a');
    expect(payload.schoolId).toBe('school-1');
    expect(payload.metadata.studentId).toBe('s-1');
    expect(payload.metadata.changedFields).toEqual(
      expect.arrayContaining(['sexDescriptor', 'motherTongueDescriptor']),
    );
  });

  it('does NOT emit an audit event when the patch is a no-op', async () => {
    const withBothSet = {
      ...existingStudent,
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
    };
    const { svc, dynamoDBClient, iemisAuditLogger } = makeService(withBothSet);
    await svc.updateStudentDescriptors(
      's-1',
      { sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female' },
      ctx,
    );
    expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(iemisAuditLogger.emit).not.toHaveBeenCalled();
  });

  it('strips disabilities[].notes from the audit payload (privacy)', async () => {
    const { svc, iemisAuditLogger } = makeService(existingStudent);
    await svc.updateStudentDescriptors(
      's-1',
      {
        disabilities: [
          {
            descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing',
            notes: 'Private clinical note — must not leak into audit',
          },
        ],
      },
      ctx,
    );
    const payload = iemisAuditLogger.emit.mock.calls[0][0];
    expect(payload.metadata.after.disabilities).toEqual([
      { descriptor: 'uri://ed-fi.org/DisabilityDescriptor#Hearing' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('clinical note');
  });

  it('fail-open: student update succeeds even if audit emit rejects', async () => {
    const { svc, dynamoDBClient, iemisAuditLogger } = makeService(existingStudent);
    iemisAuditLogger.emit.mockRejectedValueOnce(new Error('DDB down'));
    const result = await svc.updateStudentDescriptors(
      's-1',
      { sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female' },
      ctx,
    );
    // Patch still landed in DDB.
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('belowPovertyLine + scholarshipCategory transitions both recorded', async () => {
    const { svc, iemisAuditLogger } = makeService(existingStudent);
    await svc.updateStudentDescriptors(
      's-1',
      { belowPovertyLine: true, scholarshipCategory: 'OBC' },
      ctx,
    );
    const payload = iemisAuditLogger.emit.mock.calls[0][0];
    expect(payload.metadata.changedFields).toEqual(
      expect.arrayContaining(['belowPovertyLine', 'scholarshipCategory']),
    );
    expect(payload.metadata.after.belowPovertyLine).toBe(true);
    expect(payload.metadata.after.scholarshipCategory).toBe('OBC');
  });
});

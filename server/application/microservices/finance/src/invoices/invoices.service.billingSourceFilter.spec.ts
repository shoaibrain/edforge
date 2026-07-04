/**
 * `InvoicesService` list paths — EPIC-FB FB-5.5 `billingSource` filter.
 *
 * Pins the FilterExpression composition on all three list paths (school
 * GSI1 `list`, per-student GSI2 `listForStudents`, grade GSI14
 * `listBySchoolAndGrade`):
 *   - 'agreement' → attribute_exists(agreementId)
 *   - 'standard'  → attribute_not_exists(agreementId)
 *   - composes (ANDs) with the existing status/academicYear filters
 *   - ABSENT param → the query args are byte-identical to today (back-compat)
 *   - invalid value → 400
 *
 * queryGSI positional contract (finance dynamodb-client.service.ts):
 *   (client, indexName, pkValue, skValue, skOperator, filterExpression,
 *    expressionAttributeValues, expressionAttributeNames, limit,
 *    scanIndexForward, exclusiveStartKey)
 */

import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

describe('InvoicesService — billingSource list filter (FB-5.5)', () => {
  let service: InvoicesService;
  let dynamoDBClient: any;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    service = new InvoicesService(
      dynamoDBClient,
      {} as any,
      { getSchoolName: jest.fn().mockResolvedValue('Test School') } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  function lastQueryArgs(): unknown[] {
    const calls = dynamoDBClient.queryGSI.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1];
  }

  describe('school GSI1 path — list()', () => {
    it("'agreement' → attribute_exists(agreementId)", async () => {
      await service.list(SCHOOL_ID, ctx, { billingSource: 'agreement' });
      const args = lastQueryArgs();
      expect(args[1]).toBe('GSI1');
      expect(args[5]).toBe('attribute_exists(agreementId)');
    });

    it("'standard' → attribute_not_exists(agreementId)", async () => {
      await service.list(SCHOOL_ID, ctx, { billingSource: 'standard' });
      expect(lastQueryArgs()[5]).toBe('attribute_not_exists(agreementId)');
    });

    it('composes with status + academicYear filters (ANDed)', async () => {
      await service.list(SCHOOL_ID, ctx, {
        status: 'issued',
        academicYear: '2082-83',
        billingSource: 'agreement',
      });
      const args = lastQueryArgs();
      expect(args[5]).toBe(
        '#status = :status AND academicYear = :academicYear AND attribute_exists(agreementId)',
      );
      expect(args[6]).toEqual({ ':status': 'issued', ':academicYear': '2082-83' });
    });

    it('ABSENT param → no FilterExpression (byte-identical to today)', async () => {
      await service.list(SCHOOL_ID, ctx, {});
      const args = lastQueryArgs();
      expect(args[5]).toBeUndefined();
      expect(args[6]).toBeUndefined();
    });

    it('invalid value → 400', async () => {
      await expect(
        service.list(SCHOOL_ID, ctx, { billingSource: 'bogus' as any }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('per-student GSI2 path — listForStudents()', () => {
    it("'agreement' filter applied on EVERY per-student query", async () => {
      await service.listForStudents(SCHOOL_ID, [STUDENT_ID, 'student-2'], ctx, {
        billingSource: 'agreement',
      });
      const gsi2Calls = dynamoDBClient.queryGSI.mock.calls.filter(
        (c: unknown[]) => c[1] === 'GSI2',
      );
      expect(gsi2Calls).toHaveLength(2);
      for (const call of gsi2Calls) {
        expect(call[5]).toBe('attribute_exists(agreementId)');
      }
    });

    it("'standard' composes with status", async () => {
      await service.listForStudents(SCHOOL_ID, [STUDENT_ID], ctx, {
        status: 'issued',
        billingSource: 'standard',
      });
      const call = dynamoDBClient.queryGSI.mock.calls.find((c: unknown[]) => c[1] === 'GSI2')!;
      expect(call[5]).toBe('#status = :status AND attribute_not_exists(agreementId)');
    });

    it('ABSENT param → no FilterExpression (back-compat)', async () => {
      await service.listForStudents(SCHOOL_ID, [STUDENT_ID], ctx, {});
      const call = dynamoDBClient.queryGSI.mock.calls.find((c: unknown[]) => c[1] === 'GSI2')!;
      expect(call[5]).toBeUndefined();
    });
  });

  describe('grade GSI14 path — listBySchoolAndGrade()', () => {
    it("'agreement' → attribute_exists(agreementId) on the GSI14 query", async () => {
      await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, { billingSource: 'agreement' });
      const call = dynamoDBClient.queryGSI.mock.calls.find((c: unknown[]) => c[1] === 'GSI14')!;
      expect(call[5]).toBe('attribute_exists(agreementId)');
    });

    it('composes with academicYear; absent param stays byte-identical', async () => {
      await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, {
        academicYear: '2082-83',
        billingSource: 'standard',
      });
      let call = dynamoDBClient.queryGSI.mock.calls.find((c: unknown[]) => c[1] === 'GSI14')!;
      expect(call[5]).toBe('academicYear = :academicYear AND attribute_not_exists(agreementId)');

      dynamoDBClient.queryGSI.mockClear();
      await service.listBySchoolAndGrade(SCHOOL_ID, '4', ctx, {});
      call = dynamoDBClient.queryGSI.mock.calls.find((c: unknown[]) => c[1] === 'GSI14')!;
      expect(call[5]).toBeUndefined();
    });
  });
});

import { StaffService } from './staff.service';
import type { RequestContext } from '../common/entities/base.entity';

/**
 * R2.2 — tenant isolation of the EMAIL# GSI lookup. GSI2's partition key
 * (EMAIL#<email>) is not tenant-scoped and GSI queries bypass the IAM
 * LeadingKeys condition, so `getStaffByEmail` MUST filter by tenantId or a
 * colliding staff email could resolve to another tenant's row.
 */
function makeService(queryItems: unknown[]) {
  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    queryGSI: jest.fn().mockResolvedValue({ items: queryItems }),
  } as any;
  const noop = {} as any;
  const service = new StaffService(dynamoDBClient, noop, noop, noop, noop, noop);
  return { service, dynamoDBClient };
}

const ctx: RequestContext = {
  tenantId: 'tenant-a',
  userId: 'user-1',
  email: 'caller@school.edu',
  globalRole: 'TenantUser',
  jwtToken: 'jwt',
  username: 'caller',
};

describe('StaffService.getStaffByEmail — tenant isolation (R2.2)', () => {
  it('scopes the EMAIL# GSI lookup to the caller tenant (filters by tenantId)', async () => {
    const { service, dynamoDBClient } = makeService([]);
    await service.getStaffByEmail('teacher@school.edu', ctx);

    // queryGSI args: (client, indexName, pkValue, skValue, skOperator, filterExpression, exprValues, ...)
    const [, indexName, pkValue, , , filterExpression, exprValues] = dynamoDBClient.queryGSI.mock.calls[0];
    expect(indexName).toBe('GSI2');
    expect(pkValue).toBe('EMAIL#teacher@school.edu');
    expect(filterExpression).toContain('tenantId');
    expect(exprValues[':tenantId']).toBe('tenant-a');
  });

  it('does not pass a Limit (DynamoDB applies Limit before FilterExpression → would truncate)', async () => {
    const { service, dynamoDBClient } = makeService([]);
    await service.getStaffByEmail('teacher@school.edu', ctx);
    // limit is arg index 8
    expect(dynamoDBClient.queryGSI.mock.calls[0][8]).toBeUndefined();
  });

  it('returns null when no staff matches in the caller tenant', async () => {
    const { service } = makeService([]);
    await expect(service.getStaffByEmail('nobody@school.edu', ctx)).resolves.toBeNull();
  });
});

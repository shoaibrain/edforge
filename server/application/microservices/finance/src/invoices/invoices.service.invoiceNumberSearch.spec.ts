import { InvoicesService } from './invoices.service';

/**
 * Issue #348 — invoice-number lookup.
 *
 * The search box filtered only the rows the client had already loaded, so a
 * real, issued, paid invoice reported "no results" whenever it was not on
 * the loaded page (1,423 invoices, 50 loaded). There was no server-side
 * lookup to call: the list endpoint accepted no such parameter, and GSI3
 * (`gsi3sk = INVNUM#{number}`) — the index built for exactly this — had
 * zero readers.
 */

const TENANT_ID = 'tenant-1';
const SCHOOL_ID = 'school-1';
const ctx = { tenantId: TENANT_ID, userId: 'u1', jwtToken: 'jwt', role: 'TenantAdmin', schoolId: SCHOOL_ID } as any;

function buildService() {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockResolvedValue(null),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const service = new InvoicesService(
    dynamoDBClient,
    {} as any,
    { getSchoolName: jest.fn().mockResolvedValue('Test School') } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { service, dynamoDBClient };
}

function lastCall(client: any) {
  const calls = client.queryGSI.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

describe('InvoicesService.list — invoice-number lookup (#348)', () => {
  it('queries GSI3 on the invoice-number sort key', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { invoiceNumber: 'INV-420-2609-0151' });

    const args = lastCall(dynamoDBClient);
    expect(args[1]).toBe('GSI3');
    expect(args[2]).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`);
    expect(args[3]).toBe('INVNUM#INV-420-2609-0151');
  });

  it('matches on a prefix, so a partial number still finds the invoice', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { invoiceNumber: 'INV-420-2609' });
    expect(lastCall(dynamoDBClient)[4]).toBe('begins_with');
  });

  it('uses no FilterExpression, so it cannot starve a page', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { invoiceNumber: 'INV-420-2609-0151' });
    expect(lastCall(dynamoDBClient)[5]).toBeUndefined();
  });

  it('trims operator whitespace from a pasted number', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { invoiceNumber: '  INV-420-2609-0151  ' });
    expect(lastCall(dynamoDBClient)[3]).toBe('INVNUM#INV-420-2609-0151');
  });

  it('ignores a blank value and falls back to the normal listing', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { invoiceNumber: '   ' });
    expect(lastCall(dynamoDBClient)[1]).toBe('GSI1');
  });

  it('leaves the unfiltered listing on GSI1 untouched', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, {});
    expect(lastCall(dynamoDBClient)[1]).toBe('GSI1');
  });
});

describe('InvoicesService.listForStudents — invoice-number lookup (#348)', () => {
  it('narrows within the student\'s own rows rather than widening scope', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.listForStudents(SCHOOL_ID, ['child-a'], ctx, {
      invoiceNumber: 'INV-420-2609-0151',
    });

    const args = lastCall(dynamoDBClient);
    // Still the student partition on GSI2 — a parent can never reach another
    // student's invoice by typing its number.
    expect(args[1]).toBe('GSI2');
    expect(args[2]).toBe(`TENANT#${TENANT_ID}#STUDENT#child-a`);
    expect(args[5]).toContain('begins_with(invoiceNumber, :invoiceNumber)');
    expect(args[6][':invoiceNumber']).toBe('INV-420-2609-0151');
  });

  it('adds no filter when no number is supplied', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.listForStudents(SCHOOL_ID, ['child-a'], ctx, {});
    expect(lastCall(dynamoDBClient)[5]).toBeUndefined();
  });
});

/**
 * #475 — the staff branches. `list()` is only reachable without a gradeLevel;
 * a staff caller who supplies one lands on the GSI14 branch instead, and that
 * branch has to narrow by number too or the grade scope silently wins.
 */
describe('InvoicesService.listBySchoolAndGrade — invoice-number lookup (#475)', () => {
  it('narrows within the grade partition instead of routing to GSI3', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.listBySchoolAndGrade(SCHOOL_ID, '5', ctx, {
      invoiceNumber: 'INV-420-2605-0192',
    });

    const args = lastCall(dynamoDBClient);
    // Going to GSI3 here would drop the grade the caller asked for.
    expect(args[1]).toBe('GSI14');
    expect(args[5]).toContain('begins_with(invoiceNumber, :invoiceNumber)');
    expect(args[6][':invoiceNumber']).toBe('INV-420-2605-0192');
  });

  it('composes with the other grade-scoped filters', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.listBySchoolAndGrade(SCHOOL_ID, '5', ctx, {
      academicYear: '2083-academic-year',
      invoiceNumber: 'INV-420',
    });

    const filter = lastCall(dynamoDBClient)[5];
    expect(filter).toContain('academicYear = :academicYear');
    expect(filter).toContain('begins_with(invoiceNumber, :invoiceNumber)');
  });

  it('adds no filter when no number is supplied', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.listBySchoolAndGrade(SCHOOL_ID, '5', ctx, {});
    expect(lastCall(dynamoDBClient)[5]).toBeUndefined();
  });
});

describe('InvoicesService.list — studentId + invoiceNumber is rejected (#475)', () => {
  it('refuses the combination rather than returning the unfiltered student rows', async () => {
    const { service } = buildService();
    await expect(
      service.list(SCHOOL_ID, ctx, {
        studentId: 'child-a',
        invoiceNumber: 'INV-420-2605-0192',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_FILTER_COMBINATION' },
    });
  });

  it('still allows studentId on its own', async () => {
    const { service, dynamoDBClient } = buildService();
    await service.list(SCHOOL_ID, ctx, { studentId: 'child-a' });
    expect(lastCall(dynamoDBClient)[1]).toBe('GSI2');
  });
});

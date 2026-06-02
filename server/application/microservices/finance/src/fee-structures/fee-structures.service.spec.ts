/**
 * fee-structures.service spec — P3.4 soft-warn grade-level validator.
 *
 * Locks the new resolution chain: enabledGradeLevels (P1) supersedes
 * gradeRange (legacy); a fee structure referencing codes outside the
 * school's configured set warns + saves rather than 400-ing the request.
 *
 * Pre-P3.4 behavior (`throw new BadRequestException`) was rejected per
 * architectural decision #3 — narrowing a school's enabledGradeLevels
 * would silently break previously-working fee-structure flows.
 */

import { FeeStructuresService } from './fee-structures.service';
import type { CreateFeeStructureDto } from '@aibrains/shared-types';

const ctx = {
  tenantId: 'tenant-x',
  userId: 'user-1',
  email: 'admin@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-x',
} as any;

const SCHOOL_ID = 'b8f7a7e3-1234-5678-90ab-cdef01234567';

function makeMockDdb() {
  return {
    getClient: jest.fn().mockResolvedValue({}),
    putItem: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  } as any;
}

function makeMockEvents() {
  return {
    publishFeeStructureCreated: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockIdentity(schoolDetails: unknown) {
  return {
    validateSchoolExists: jest.fn().mockResolvedValue(true),
    getWorkspaceSettings: jest.fn().mockResolvedValue(null),
    getSchoolDetails: jest.fn().mockResolvedValue(schoolDetails),
  } as any;
}

function makeDto(gradeLevels: string[]): CreateFeeStructureDto {
  return {
    name: 'Tuition',
    feeType: 'tuition',
    amount: 5000,
    currency: 'NPR',
    frequency: 'annual',
    gradeLevels,
  } as CreateFeeStructureDto;
}

describe('FeeStructuresService.create — P3.4 grade-level soft-warn validator', () => {
  it('saves successfully when every code is in the school enabledGradeLevels', async () => {
    const identity = makeMockIdentity({
      gradeRange: { start: '1', end: '5' },
      enabledGradeLevels: ['PG', 'NUR', 'LKG', 'UKG', '1', '2', '3'],
    });
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['PG', 'NUR']), ctx);

    expect(warn).not.toHaveBeenCalled();
  })

  it('warns + saves when a code is outside enabledGradeLevels (does NOT throw)', async () => {
    const identity = makeMockIdentity({
      gradeRange: { start: '1', end: '10' },
      enabledGradeLevels: ['1', '2', '3', '4', '5'],
    });
    const ddb = makeMockDdb();
    const svc = new FeeStructuresService(ddb, makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await expect(
      svc.create(SCHOOL_ID, makeDto(['1', '2', '11', '12']), ctx),
    ).resolves.toBeDefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('11');
    expect(warn.mock.calls[0][0]).toContain('12');
    expect(warn.mock.calls[0][0]).not.toContain('"1"');  // valid codes not in warn message
    expect(ddb.putItem).toHaveBeenCalledTimes(1);
  })

  it('prefers enabledGradeLevels over gradeRange when both are present', async () => {
    // gradeRange allows 1–10, but enabledGradeLevels is narrower (1–5).
    // The validator must use enabledGradeLevels (warn on '7') NOT gradeRange.
    const identity = makeMockIdentity({
      gradeRange: { start: '1', end: '10' },
      enabledGradeLevels: ['1', '2', '3', '4', '5'],
    });
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['7']), ctx);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('7');
  })

  it('falls back to gradeRange slice when enabledGradeLevels is missing (legacy schools)', async () => {
    const identity = makeMockIdentity({
      gradeRange: { start: '1', end: '5' },
      // no enabledGradeLevels at all
    });
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['7']), ctx);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('7');
  })

  it('falls back to gradeRange when enabledGradeLevels is an empty array', async () => {
    // Operator un-checked everything → empty array. Treat as "use legacy
    // gradeRange" rather than "no codes are valid" (which would warn on
    // every fee structure ever).
    const identity = makeMockIdentity({
      gradeRange: { start: '1', end: '5' },
      enabledGradeLevels: [],
    });
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['3']), ctx);

    expect(warn).not.toHaveBeenCalled();
  })

  it('warns about transport failure when schoolDetails is null (post-validateSchoolExists)', async () => {
    // validateSchoolExists succeeded but getSchoolDetails returned null →
    // identity is reachable enough to confirm existence but the details
    // fetch failed. P3.4-review: log a DISTINCT warn (different from the
    // "out-of-range" warn) so ops sees the silent miss.
    const identity = makeMockIdentity(null);
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['7']), ctx);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/getSchoolDetails returned null/);
    expect(warn.mock.calls[0][0]).toContain(SCHOOL_ID);
  })

  it('does NOT emit the transport warn when schoolDetails is populated but has no configured grades', async () => {
    // schoolDetails came back fine — just no enabledGradeLevels and no
    // gradeRange. resolveValidGradeCodes returns null → we skip validation
    // silently (no warn), distinct from the transport-failure case above.
    const identity = makeMockIdentity({});
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto(['7']), ctx);

    expect(warn).not.toHaveBeenCalled();
  })

  it('skips validation when dto.gradeLevels is empty (fee applies to all)', async () => {
    const identity = makeMockIdentity({
      enabledGradeLevels: ['1', '2'],
    });
    const svc = new FeeStructuresService(makeMockDdb(), makeMockEvents(), identity);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.create(SCHOOL_ID, makeDto([]), ctx);

    expect(warn).not.toHaveBeenCalled();
    // getSchoolDetails is gated on dto.gradeLevels.length > 0 — confirm
    // we didn't even call out to identity for an empty array
    expect(identity.getSchoolDetails).not.toHaveBeenCalled();
  })
});

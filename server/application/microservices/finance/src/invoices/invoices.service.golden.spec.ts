/**
 * `InvoicesService.generate` — GOLDEN no-agreement output (EPIC-FB FB-3.3).
 *
 * **Backward-compat contract (epic §3.3 step 2):** when no billing agreement
 * exists for the student — resolver returns null — OR the feature flag is
 * off, the standard generation path must stay BYTE-IDENTICAL to the
 * pre-agreement behavior. This spec was written and run green against the
 * UNMODIFIED service BEFORE the FB-3.3 agreement hook landed, pinning the
 * exact produced entity + response DTO as literal expected objects (NOT
 * toMatchSnapshot — a snapshot would silently re-pin on `-u`).
 *
 * Fixture is deliberately representative: two fee structures (one taxed +
 * discounted, one plain), an operator custom line item, and both autoIssue
 * variants. Determinism: uuid v4 is mocked to a counter sequence and the
 * clock is pinned via fake timers.
 *
 * Three run modes, all of which must produce the SAME pinned output:
 *   1. pre-FB-3.3 service (no resolver wired — proves the pin is honest)
 *   2. post-FB-3.3, resolver wired and returning null
 *   3. post-FB-3.3, BILLING_AGREEMENTS_ENABLED='false' (FB-3.9 iii)
 */

jest.mock('uuid', () => {
  let n = 0;
  return {
    v4: jest.fn(() => `uuid-${++n}`),
    __resetUuidCounter: () => {
      n = 0;
    },
  };
});

import { InvoicesService } from './invoices.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const uuidMock = jest.requireMock('uuid') as { __resetUuidCounter: () => void };

const FIXED_NOW = new Date('2026-07-04T10:00:00.000Z');

const ctx = {
  tenantId: 'tenant-uuid',
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: 'school-uuid',
} as any;

const FEE_STRUCTURES = [
  {
    feeStructureId: 'fs-1',
    name: 'Monthly Tuition',
    amount: 1000,
    feeType: 'tuition',
    frequency: 'monthly', // NOT one_time → skips duplicate-detection scan
    gradeLevels: [],
    taxRate: 13,
    taxType: 'vat',
    version: 3,
  },
  {
    feeStructureId: 'fs-2',
    name: 'Transport Fee',
    amount: 500,
    feeType: 'transport',
    frequency: 'monthly',
    gradeLevels: [],
    taxRate: 0,
    taxType: undefined,
    version: 1,
  },
];

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-uuid',
    feeStructureIds: ['fs-1', 'fs-2'],
    academicYear: '2082-83',
    billingPeriod: '2083-03',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-04',
    notes: 'Golden fixture',
    discounts: [{ feeStructureId: 'fs-1', amount: 100, reason: 'Sibling discount' }],
    customLineItems: [{ name: 'Annual picnic', amount: 250 }],
    ...overrides,
  } as any;
}

/**
 * The pinned line items shared by both status variants. uuid consumption
 * order inside generate(): fee lines first (uuid-1, uuid-2), then the
 * custom line id + its synthetic feeStructureId (uuid-3, uuid-4), then the
 * invoiceId (uuid-5). Any new uuid consumed on the standard path breaks
 * this pin — that is the point.
 */
const GOLDEN_LINE_ITEMS = [
  {
    id: 'uuid-1',
    feeStructureId: 'fs-1',
    feeStructureVersion: 3,
    feeType: 'tuition',
    description: 'Monthly Tuition',
    amount: 1000,
    quantity: 1,
    discount: 100,
    discountReason: 'Sibling discount',
    taxRate: 13,
    taxType: 'vat',
    taxAmount: 117,
    total: 1017,
  },
  {
    id: 'uuid-2',
    feeStructureId: 'fs-2',
    feeStructureVersion: 1,
    feeType: 'transport',
    description: 'Transport Fee',
    amount: 500,
    quantity: 1,
    discount: 0,
    discountReason: undefined,
    taxRate: 0,
    taxType: undefined,
    taxAmount: 0,
    total: 500,
  },
  {
    id: 'uuid-3',
    feeStructureId: 'uuid-4',
    feeStructureVersion: 1,
    feeType: 'custom',
    description: 'Annual picnic',
    amount: 250,
    quantity: 1,
    discount: 0,
    discountReason: undefined,
    taxRate: 0,
    taxType: undefined,
    taxAmount: 0,
    total: 250,
    isCustom: true,
  },
];

/**
 * The response-DTO projection of the same lines. Pre-existing mapper
 * contract: `feeType` is entity-side only (not emitted on the DTO) —
 * pinned here exactly as the mapper produced it BEFORE FB-3.3.
 */
const GOLDEN_DTO_LINE_ITEMS = [
  {
    id: 'uuid-1',
    feeStructureId: 'fs-1',
    feeStructureVersion: 3,
    description: 'Monthly Tuition',
    amount: 1000,
    quantity: 1,
    discount: 100,
    discountReason: 'Sibling discount',
    taxRate: 13,
    taxType: 'vat',
    taxAmount: 117,
    total: 1017,
    isCustom: undefined,
  },
  {
    id: 'uuid-2',
    feeStructureId: 'fs-2',
    feeStructureVersion: 1,
    description: 'Transport Fee',
    amount: 500,
    quantity: 1,
    discount: 0,
    discountReason: undefined,
    taxRate: 0,
    taxType: undefined,
    taxAmount: 0,
    total: 500,
    isCustom: undefined,
  },
  {
    id: 'uuid-3',
    feeStructureId: 'uuid-4',
    feeStructureVersion: 1,
    description: 'Annual picnic',
    amount: 250,
    quantity: 1,
    discount: 0,
    discountReason: undefined,
    taxRate: 0,
    taxType: undefined,
    taxAmount: 0,
    total: 250,
    isCustom: true,
  },
];

const GOLDEN_TAX_SUMMARY = [
  { taxType: 'vat', taxableAmount: 900, taxRate: 13, taxAmount: 117 },
  { taxType: 'none', taxableAmount: 750, taxRate: 0, taxAmount: 0 },
];

const GOLDEN_ENTITY_DRAFT: Record<string, unknown> = {
  tenantId: 'tenant-uuid',
  entityKey: 'INVOICE#school-uuid#uuid-5',
  entityType: 'INVOICE',
  invoiceId: 'uuid-5',
  invoiceNumber: 'INV-2026-0001',
  studentAccountId: 'account-uuid',
  studentId: 'student-uuid',
  studentName: 'Aakriti Sharma',
  schoolId: 'school-uuid',
  schoolName: 'Test School',
  academicYear: '2082-83',
  billingPeriod: '2083-03',
  lineItems: GOLDEN_LINE_ITEMS,
  subtotal: 1750,
  taxTotal: 117,
  discountTotal: 100,
  grandTotal: 1767,
  amountPaid: 0,
  amountDue: 1767,
  currency: 'NPR',
  dueDate: '2026-08-15',
  issuedDate: '2026-07-04',
  status: 'draft',
  notes: 'Golden fixture',
  taxSummary: GOLDEN_TAX_SUMMARY,
  enrollmentId: undefined,
  gradeLevel: '4',
  gradeLevelResolutionStatus: 'resolved',
  statusHistory: [],
  gsi1pk: 'TENANT#tenant-uuid#SCHOOL#school-uuid',
  gsi1sk: 'INVOICE#draft#2026-08-15',
  gsi2pk: 'TENANT#tenant-uuid#STUDENT#student-uuid',
  gsi2sk: 'INVOICE#2026-07-04',
  gsi3pk: 'TENANT#tenant-uuid#SCHOOL#school-uuid',
  gsi3sk: 'INVNUM#INV-2026-0001',
  gsi14pk: 'TENANT#tenant-uuid#SCHOOL#school-uuid#GRADE#4',
  gsi14sk: 'INVOICE#2026-07-04',
  createdAt: '2026-07-04T10:00:00.000Z',
  createdBy: 'user-1',
  updatedAt: '2026-07-04T10:00:00.000Z',
  updatedBy: 'user-1',
  version: 1,
};

const GOLDEN_DTO_DRAFT: Record<string, unknown> = {
  id: 'uuid-5',
  invoiceNumber: 'INV-2026-0001',
  studentAccountId: 'account-uuid',
  studentId: 'student-uuid',
  studentName: 'Aakriti Sharma',
  schoolId: 'school-uuid',
  schoolName: 'Test School',
  academicYear: '2082-83',
  billingPeriod: '2083-03',
  lineItems: GOLDEN_DTO_LINE_ITEMS,
  subtotal: 1750,
  taxTotal: 117,
  discountTotal: 100,
  grandTotal: 1767,
  amountPaid: 0,
  amountDue: 1767,
  currency: 'NPR',
  dueDate: '2026-08-15',
  issuedDate: '2026-07-04',
  status: 'draft',
  isOverdue: false,
  notes: 'Golden fixture',
  taxSummary: GOLDEN_TAX_SUMMARY,
  enrollmentId: undefined,
  gradeLevel: '4',
  gradeLevelResolutionStatus: 'resolved',
  statusHistory: [],
  createdAt: '2026-07-04T10:00:00.000Z',
  updatedAt: '2026-07-04T10:00:00.000Z',
};

const GOLDEN_ENTITY_ISSUED: Record<string, unknown> = {
  ...GOLDEN_ENTITY_DRAFT,
  status: 'issued',
  gsi1sk: 'INVOICE#issued#2026-08-15',
  statusHistory: [
    {
      from: 'draft',
      to: 'issued',
      changedAt: '2026-07-04T10:00:00.000Z',
      changedBy: 'user-1',
    },
  ],
};

describe('InvoicesService.generate — GOLDEN no-agreement output (FB-3.3)', () => {
  const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;
  let service: InvoicesService;
  let dynamoDBClient: any;
  let studentAccountsService: any;
  let agreementResolver: { getActiveAgreementForStudent: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
    uuidMock.__resetUuidCounter();
    delete process.env.BILLING_AGREEMENTS_ENABLED;

    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    studentAccountsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        accountId: 'account-uuid',
        studentId: 'student-uuid',
      }),
      recordLedgerEntry: jest.fn().mockResolvedValue(undefined),
    };
    agreementResolver = {
      getActiveAgreementForStudent: jest.fn().mockResolvedValue(null),
    };

    // Cast so this suite compiles against BOTH the pre-FB-3.3 8-param
    // constructor (golden pin proven on the unmodified service) and the
    // post-FB-3.3 9-param one (trailing optional agreementResolver).
    service = new (InvoicesService as any)(
      dynamoDBClient,
      { publishInvoiceGenerated: jest.fn().mockResolvedValue(undefined) } as any,
      {
        getStudentInfo: jest.fn().mockResolvedValue({
          studentId: 'student-uuid',
          firstName: 'Aakriti',
          lastName: 'Sharma',
          gradeLevel: '4',
        }),
        getSchoolName: jest.fn().mockResolvedValue('Test School'),
      } as any,
      { getCurrency: jest.fn().mockResolvedValue('NPR') } as any,
      { nextInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0001') } as any,
      { getByIds: jest.fn().mockResolvedValue(FEE_STRUCTURES) } as any,
      studentAccountsService,
      { optimize: jest.fn(async (u: string) => u) } as any,
      agreementResolver as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    if (ORIGINAL_FLAG === undefined) delete process.env.BILLING_AGREEMENTS_ENABLED;
    else process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
  });

  function putEntity(): InvoiceEntity {
    expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    return dynamoDBClient.putItem.mock.calls[0][1] as InvoiceEntity;
  }

  it('draft variant — entity + DTO match the pinned golden objects exactly', async () => {
    const dto = await service.generate('school-uuid', makeDto(), ctx);

    expect(putEntity()).toEqual(GOLDEN_ENTITY_DRAFT);
    expect(dto).toEqual(GOLDEN_DTO_DRAFT);
  });

  it('autoIssue variant — issued entity + statusHistory + ledger debit match the pin', async () => {
    const billingAccount = { accountId: 'account-uuid', studentId: 'student-uuid', balance: 0 };
    dynamoDBClient.getItem.mockResolvedValue(billingAccount);

    const dto = await service.generate('school-uuid', makeDto({ autoIssue: true }), ctx);

    expect(putEntity()).toEqual(GOLDEN_ENTITY_ISSUED);
    expect(dto).toEqual({
      ...GOLDEN_DTO_DRAFT,
      status: 'issued',
      statusHistory: [
        {
          from: 'draft',
          to: 'issued',
          changedAt: '2026-07-04T10:00:00.000Z',
          changedBy: 'user-1',
        },
      ],
    });
    expect(studentAccountsService.recordLedgerEntry).toHaveBeenCalledWith(
      billingAccount,
      'invoice',
      'uuid-5',
      'Invoice INV-2026-0001 auto-issued on enrollment',
      1767,
      0,
      ctx,
    );
  });

  it('resolver wired and returning null → output identical to the pin (flag on)', async () => {
    const dto = await service.generate('school-uuid', makeDto(), ctx);

    expect(putEntity()).toEqual(GOLDEN_ENTITY_DRAFT);
    expect(dto).toEqual(GOLDEN_DTO_DRAFT);
    // No agreement provenance leaks onto the standard path — the fields
    // must be ABSENT (undefined), never 'catalog'-stamped (FB-3.2 back-compat).
    const entity = putEntity() as any;
    expect(entity.feeOverrideMode).toBeUndefined();
    expect(entity.agreementId).toBeUndefined();
    expect(entity.agreementVersion).toBeUndefined();
  });

  it("BILLING_AGREEMENTS_ENABLED='false' → resolver never consulted, output identical (FB-3.9 iii)", async () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';

    const dto = await service.generate('school-uuid', makeDto(), ctx);

    expect(agreementResolver.getActiveAgreementForStudent).not.toHaveBeenCalled();
    expect(putEntity()).toEqual(GOLDEN_ENTITY_DRAFT);
    expect(dto).toEqual(GOLDEN_DTO_DRAFT);
  });
});

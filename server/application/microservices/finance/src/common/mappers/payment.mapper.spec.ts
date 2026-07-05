/**
 * paymentEntityToDto — gradeLevel + gradeLevelResolutionStatus passthrough
 *
 * Sprint A.2 Codex round-2: closes the contract-completeness gap.
 * Pre-fix the Payment DTO had NO grade-snapshot fields at all,
 * despite A.2's plan-acceptance saying "Mapper passes through."
 */

import { paymentEntityToDto } from './payment.mapper';
import type { PaymentEntity } from '../entities/payment.entity';

function makeEntity(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: 'tenant-1',
    entityKey: 'PAYMENT#school-1#pay-1',
    entityType: 'PAYMENT',
    paymentId: '11111111-1111-4111-8111-111111111111',
    invoiceId: '22222222-2222-4222-8222-222222222222',
    studentAccountId: '33333333-3333-4333-8333-333333333333',
    schoolId: '44444444-4444-4444-8444-444444444444',
    studentId: '55555555-5555-4555-8555-555555555555',
    amount: 1000,
    currency: 'NPR',
    gateway: 'cash',
    status: 'completed',
    paidAt: '2026-07-15T10:00:00Z',
    paidBy: 'operator-1',
    receiptNumber: 'RCP-2026-0001',
    metadata: {},
    refunds: [],
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '2026-07-15T10:00:00Z',
    createdBy: 'operator-1',
    updatedAt: '2026-07-15T10:00:00Z',
    updatedBy: 'operator-1',
    version: 1,
    ...overrides,
  };
}

describe('paymentEntityToDto — Sprint A.2 grade snapshot passthrough', () => {
  it('resolved snapshot → both gradeLevel + gradeLevelResolutionStatus emitted on DTO', () => {
    const dto = paymentEntityToDto(
      makeEntity({ gradeLevel: '4', gradeLevelResolutionStatus: 'resolved' }),
    );
    expect(dto.gradeLevel).toBe('4');
    expect(dto.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('unresolved snapshot → status emitted, gradeLevel undefined', () => {
    const dto = paymentEntityToDto(
      makeEntity({ gradeLevel: undefined, gradeLevelResolutionStatus: 'unresolved' }),
    );
    expect(dto.gradeLevel).toBeUndefined();
    expect(dto.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('pre-A.2 row (neither field on entity) → DTO has both undefined (back-compat)', () => {
    const entity = makeEntity();
    delete (entity as any).gradeLevel;
    delete (entity as any).gradeLevelResolutionStatus;
    const dto = paymentEntityToDto(entity);
    expect(dto.gradeLevel).toBeUndefined();
    expect(dto.gradeLevelResolutionStatus).toBeUndefined();
  });

  it('preserves enrichment fields alongside the new grade fields (studentName + invoiceNumber)', () => {
    const dto = paymentEntityToDto(
      makeEntity({ gradeLevel: '4', gradeLevelResolutionStatus: 'resolved' }),
      { studentName: 'Aakriti Sharma', invoiceNumber: 'INV-2026-0001' },
    );
    expect(dto.gradeLevel).toBe('4');
    expect(dto.gradeLevelResolutionStatus).toBe('resolved');
    expect((dto as any).studentName).toBe('Aakriti Sharma');
    expect((dto as any).invoiceNumber).toBe('INV-2026-0001');
  });
});

describe('paymentEntityToDto — PD.2.1 applications[] passthrough', () => {
  it('pre-PD payment (applications undefined) ⇒ DTO omits applications (back-compat)', () => {
    const dto = paymentEntityToDto(makeEntity());
    expect(dto.applications).toBeUndefined();
  });

  it('split payment (invoice + opening) ⇒ applications array preserved on DTO', () => {
    const dto = paymentEntityToDto(
      makeEntity({
        amount: 3000,
        applications: [
          { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
          { targetType: 'opening_balance', amount: 1000 },
        ],
      }),
    );
    expect(dto.applications).toBeDefined();
    expect(dto.applications).toHaveLength(2);
    expect(dto.applications![0]).toEqual({
      targetType: 'invoice',
      invoiceId: '22222222-2222-4222-8222-222222222222',
      amount: 2000,
    });
    expect(dto.applications![1]).toEqual({
      targetType: 'opening_balance',
      amount: 1000,
    });
  });

  it('applications passthrough composes cleanly with gradeLevel + enrichment fields', () => {
    const dto = paymentEntityToDto(
      makeEntity({
        amount: 3000,
        gradeLevel: '4',
        gradeLevelResolutionStatus: 'resolved',
        applications: [
          { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
          { targetType: 'opening_balance', amount: 1000 },
        ],
      }),
      { studentName: 'Aakriti Sharma', invoiceNumber: 'INV-2026-0001' },
    );
    expect(dto.applications).toHaveLength(2);
    expect(dto.gradeLevel).toBe('4');
    expect((dto as any).studentName).toBe('Aakriti Sharma');
  });
});

/**
 * EPIC-FB FB-4.5 — representation matrix on the way OUT: the mapper's
 * output must satisfy the FB-4.1 superRefine for both identities.
 * Single-target fixture mirrors the live pre-FB row pinned in
 * payment.schema.spec.ts (shared-types); multi-target fixture is the
 * FB-4.4 write shape.
 */
describe('paymentEntityToDto — FB-4.1 representation matrix (schema-validated)', () => {
  const { paymentResponseSchema } = require('@aibrains/shared-types');

  function uuidEntity(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
    return makeEntity({
      paymentId: '11111111-1111-4111-8111-111111111111',
      invoiceId: '22222222-2222-4222-8222-222222222222',
      studentAccountId: '33333333-3333-4333-8333-333333333333',
      schoolId: '44444444-4444-4444-8444-444444444444',
      ...overrides,
    });
  }

  it('single-target entity (live-shaped) → DTO parses; scalars populated; familyId absent', () => {
    const dto = paymentEntityToDto(uuidEntity({
      applications: [
        { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 1000 },
      ],
    }));
    expect(dto.invoiceId).toBe('22222222-2222-4222-8222-222222222222');
    expect(dto.studentAccountId).toBe('33333333-3333-4333-8333-333333333333');
    expect(dto.familyId).toBeUndefined();
    expect(() => paymentResponseSchema.parse(dto)).not.toThrow();
  });

  it('multi-target entity → DTO parses; scalars null; familyId present; applicationInvoiceIds never leaks', () => {
    const entity = uuidEntity({
      invoiceId: null,
      studentAccountId: null,
      studentId: null,
      familyId: '55555555-dddd-4ddd-8ddd-555555555555',
      amount: 2500,
      applications: [
        { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 1000 },
        { targetType: 'invoice', invoiceId: '66666666-6666-4666-8666-666666666666', amount: 1500 },
      ],
      applicationInvoiceIds: [
        '22222222-2222-4222-8222-222222222222',
        '66666666-6666-4666-8666-666666666666',
      ],
    });
    const dto = paymentEntityToDto(entity);
    expect(dto.invoiceId).toBeNull();
    expect(dto.studentAccountId).toBeNull();
    expect(dto.familyId).toBe('55555555-dddd-4ddd-8ddd-555555555555');
    expect((dto as any).applicationInvoiceIds).toBeUndefined();
    expect((dto as any).studentId).toBeUndefined();
    expect(() => paymentResponseSchema.parse(dto)).not.toThrow();
  });

  it('pre-PD legacy entity (no applications at all) → unchanged single shape still parses', () => {
    const dto = paymentEntityToDto(uuidEntity());
    expect(dto.applications).toBeUndefined();
    expect(() => paymentResponseSchema.parse(dto)).not.toThrow();
  });
});

/**
 * invoiceEntityToDto — gradeLevel + gradeLevelResolutionStatus passthrough
 *
 * Sprint A.1 Codex round-2: pins that BOTH snapshot fields flow from
 * the entity through the mapper to the response DTO. Pre-round-2 the
 * mapper passed only `gradeLevel` (omitted status per the [P1d]
 * internal-flag convention); round-2 exposes both for contract
 * completeness so consumers can render "Unknown" without a second
 * filter call.
 */

import { invoiceEntityToDto, isInvoiceOverdue } from './invoice.mapper';
import type { InvoiceEntity } from '../entities/invoice.entity';

function makeEntity(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId: 'tenant-1',
    entityKey: 'INVOICE#school-1#inv-1',
    entityType: 'INVOICE',
    invoiceId: '11111111-1111-4111-8111-111111111111',
    invoiceNumber: 'INV-2026-0001',
    studentAccountId: '22222222-2222-4222-8222-222222222222',
    studentId: '33333333-3333-4333-8333-333333333333',
    studentName: 'Test Student',
    schoolId: '44444444-4444-4444-8444-444444444444',
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 1000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    currency: 'NPR',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-15',
    status: 'issued',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-07-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-07-15T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  };
}

describe('invoiceEntityToDto — Sprint A.1 grade snapshot passthrough', () => {
  it('resolved snapshot → both gradeLevel + gradeLevelResolutionStatus emitted on DTO', () => {
    const dto = invoiceEntityToDto(
      makeEntity({ gradeLevel: '4', gradeLevelResolutionStatus: 'resolved' }),
    );
    expect(dto.gradeLevel).toBe('4');
    expect(dto.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('unresolved snapshot → status emitted, gradeLevel undefined (sparse)', () => {
    const dto = invoiceEntityToDto(
      makeEntity({ gradeLevel: undefined, gradeLevelResolutionStatus: 'unresolved' }),
    );
    expect(dto.gradeLevel).toBeUndefined();
    expect(dto.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('pre-A.1 row (neither field on entity) → DTO has both undefined (back-compat)', () => {
    const entity = makeEntity();
    delete (entity as any).gradeLevel;
    delete (entity as any).gradeLevelResolutionStatus;
    const dto = invoiceEntityToDto(entity);
    expect(dto.gradeLevel).toBeUndefined();
    expect(dto.gradeLevelResolutionStatus).toBeUndefined();
  });
});

/**
 * EPIC-FB FB-0.1(b) — derived `isOverdue`, computed at the read boundary
 * (never stored): `dueDate < today && status ∉ {paid, cancelled, written_off}`.
 * Full status × past/future-dueDate matrix.
 */
describe('invoiceEntityToDto — FB-0.1 derived isOverdue', () => {
  const PAST_DUE = '2020-01-01';
  const FUTURE_DUE = '2099-12-31';

  const matrix: Array<{ status: InvoiceEntity['status']; pastDue: boolean; futureDue: boolean }> = [
    { status: 'draft', pastDue: true, futureDue: false },
    { status: 'issued', pastDue: true, futureDue: false },
    { status: 'partially_paid', pastDue: true, futureDue: false },
    { status: 'overdue', pastDue: true, futureDue: false },
    { status: 'paid', pastDue: false, futureDue: false },
    { status: 'cancelled', pastDue: false, futureDue: false },
    { status: 'written_off', pastDue: false, futureDue: false },
  ];

  for (const { status, pastDue, futureDue } of matrix) {
    it(`status=${status}, past dueDate → isOverdue=${pastDue}`, () => {
      const dto = invoiceEntityToDto(makeEntity({ status, dueDate: PAST_DUE }));
      expect(dto.isOverdue).toBe(pastDue);
      expect(isInvoiceOverdue({ status, dueDate: PAST_DUE })).toBe(pastDue);
    });

    it(`status=${status}, future dueDate → isOverdue=${futureDue}`, () => {
      const dto = invoiceEntityToDto(makeEntity({ status, dueDate: FUTURE_DUE }));
      expect(dto.isOverdue).toBe(futureDue);
      expect(isInvoiceOverdue({ status, dueDate: FUTURE_DUE })).toBe(futureDue);
    });
  }

  it('dueDate equal to today is NOT overdue (strict <, mirrors the sweep)', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(isInvoiceOverdue({ status: 'issued', dueDate: today })).toBe(false);
  });

  it('status is never mutated by the flag — a past-due partial keeps partially_paid', () => {
    const dto = invoiceEntityToDto(makeEntity({ status: 'partially_paid', dueDate: PAST_DUE }));
    expect(dto.status).toBe('partially_paid');
    expect(dto.isOverdue).toBe(true);
  });
});

/**
 * EPIC-FB FB-0.2 — schoolName resolved at read time. The mapper prefers the
 * caller-resolved CURRENT name; stored snapshot is the fallback when the
 * lookup failed (null/undefined) — graceful degradation.
 */
describe('invoiceEntityToDto — FB-0.2 currentSchoolName override', () => {
  it('renamed school → current name replaces the stored snapshot', () => {
    const dto = invoiceEntityToDto(makeEntity({ schoolName: 'Espresso English Academy' }), {
      currentSchoolName: 'Scoggins Middle School',
    });
    expect(dto.schoolName).toBe('Scoggins Middle School');
  });

  it('lookup failure (null) → stored snapshot fallback', () => {
    const dto = invoiceEntityToDto(makeEntity({ schoolName: 'Stored School' }), {
      currentSchoolName: null,
    });
    expect(dto.schoolName).toBe('Stored School');
  });

  it('no options (legacy call sites) → stored snapshot', () => {
    const dto = invoiceEntityToDto(makeEntity({ schoolName: 'Stored School' }));
    expect(dto.schoolName).toBe('Stored School');
  });
});

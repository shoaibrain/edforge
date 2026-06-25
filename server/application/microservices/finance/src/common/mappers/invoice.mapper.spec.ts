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

import { invoiceEntityToDto } from './invoice.mapper';
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

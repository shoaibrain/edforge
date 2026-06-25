/**
 * Sprint A.3 — sparse GSI14 (school + grade scope) population
 *
 * Pins the invariant that gsi14pk/gsi14sk are set ONLY when the
 * entity's gradeLevel snapshot is truthy. Rows with undefined or
 * empty gradeLevel stay sparse on GSI14 (invisible to grade-filtered
 * queries) and surface only through the "Unknown" UI bucket
 * (Sprint B.1 read path).
 */

import { GSIKeyBuilder } from './base.entity';
import { createInvoiceEntity } from './invoice.entity';
import { createPaymentEntity } from './payment.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const USER_ID = 'user-1';

describe('GSIKeyBuilder.schoolGradeScope', () => {
  it('returns the expected `TENANT#tid#SCHOOL#sid#GRADE#g` shape when gradeLevel is set', () => {
    expect(
      GSIKeyBuilder.schoolGradeScope(TENANT_ID, SCHOOL_ID, '4'),
    ).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#GRADE#4`);
  });

  it('returns undefined when gradeLevel is undefined (sparse invariant)', () => {
    expect(
      GSIKeyBuilder.schoolGradeScope(TENANT_ID, SCHOOL_ID, undefined),
    ).toBeUndefined();
  });

  it('returns undefined when gradeLevel is empty string (treated as missing)', () => {
    expect(
      GSIKeyBuilder.schoolGradeScope(TENANT_ID, SCHOOL_ID, ''),
    ).toBeUndefined();
  });
});

describe('createInvoiceEntity — GSI14 sparse population (Sprint A.3)', () => {
  function makeBase(overrides: Partial<{ gradeLevel: string }> = {}) {
    return createInvoiceEntity(
      TENANT_ID,
      SCHOOL_ID,
      {
        invoiceNumber: 'INV-2026-0001',
        studentAccountId: 'acct-1',
        studentId: STUDENT_ID,
        studentName: 'Test Student',
        schoolName: 'Test School',
        academicYear: '2025-2026',
        lineItems: [],
        subtotal: 1000,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 1000,
        dueDate: '2026-08-15',
        issuedDate: '2026-07-15',
        status: 'issued',
        currency: 'NPR',
        ...overrides,
      },
      USER_ID,
    );
  }

  it('populates gsi14pk + gsi14sk when gradeLevel is set', () => {
    const entity = makeBase({ gradeLevel: '4' });
    expect(entity.gsi14pk).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#GRADE#4`);
    expect(entity.gsi14sk).toBe('INVOICE#2026-07-15');
  });

  it('leaves gsi14pk + gsi14sk absent when gradeLevel is undefined (sparse)', () => {
    const entity = makeBase();
    expect(entity.gsi14pk).toBeUndefined();
    expect(entity.gsi14sk).toBeUndefined();
  });

  it('leaves gsi14pk + gsi14sk absent when gradeLevel is empty string', () => {
    const entity = makeBase({ gradeLevel: '' });
    expect(entity.gsi14pk).toBeUndefined();
    expect(entity.gsi14sk).toBeUndefined();
  });
});

describe('createPaymentEntity — GSI14 sparse population (Sprint A.3)', () => {
  function makeBase(overrides: Partial<{ gradeLevel: string }> = {}) {
    return createPaymentEntity(
      TENANT_ID,
      SCHOOL_ID,
      {
        invoiceId: 'inv-1',
        studentAccountId: 'acct-1',
        studentId: STUDENT_ID,
        amount: 1000,
        currency: 'NPR',
        gateway: 'cash',
        ...overrides,
      },
      USER_ID,
    );
  }

  it('populates gsi14pk + gsi14sk when gradeLevel is set', () => {
    const entity = makeBase({ gradeLevel: '4' });
    expect(entity.gsi14pk).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#GRADE#4`);
    expect(entity.gsi14sk).toMatch(/^PAYMENT#\d{4}-\d{2}-\d{2}T/);
  });

  it('leaves gsi14pk + gsi14sk absent when gradeLevel is undefined (sparse)', () => {
    const entity = makeBase();
    expect(entity.gsi14pk).toBeUndefined();
    expect(entity.gsi14sk).toBeUndefined();
  });

  it('leaves gsi14pk + gsi14sk absent when gradeLevel is empty string', () => {
    const entity = makeBase({ gradeLevel: '' });
    expect(entity.gsi14pk).toBeUndefined();
    expect(entity.gsi14sk).toBeUndefined();
  });
});

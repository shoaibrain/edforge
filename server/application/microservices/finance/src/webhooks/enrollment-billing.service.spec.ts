/**
 * Enrollment Billing Service Unit Tests
 *
 * Tests the enrollment→billing pipeline: auto-invoice generation,
 * idempotency via enrollmentId, grade filtering, enrollment type filtering,
 * pro-rate discounts, and fallback duplicate detection.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentBillingService, EnrollmentBillingParams } from './enrollment-billing.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { ProRateService } from '../common/services/pro-rate.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import type { RequestContext } from '../common/entities/base.entity';

// ============================================================================
// Mocks
// ============================================================================

const mockFeeStructuresService = {
  getEnrollmentFees: jest.fn(),
};

const mockInvoicesService = {
  generate: jest.fn(),
  listForStudents: jest.fn(),
};

const mockStudentAccountsService = {
  getOrCreate: jest.fn(),
};

const mockProRateService = {
  calculateProRatedAmount: jest.fn(),
};

const mockEventsService = {
  publishBillingAccountCreated: jest.fn().mockResolvedValue(undefined),
};

const mockIdentityClient = {
  getStudentInfo: jest.fn(),
};

const mockContext: RequestContext = {
  tenantId: 'tenant-001',
  userId: 'user-001',
  email: 'admin@test.com',
  jwtToken: 'valid-jwt-token',
  role: 'TenantAdmin',
  schoolId: 'school-001',
};

const baseParams: EnrollmentBillingParams = {
  tenantId: 'tenant-001',
  schoolId: 'school-001',
  studentId: 'student-001',
  gradeLevel: '5',
  enrollmentDate: '2026-04-01',
  academicYearId: 'year-001',
  studentName: 'Test Student',
  enrollmentId: 'enrollment-001',
  enrollmentType: 'new_admission',
};

const mockFee = {
  feeStructureId: 'fee-001',
  name: 'Tuition Fee',
  amount: 5000,
  frequency: 'annual',
  gradeLevels: ['5'],
  enrollmentTypes: [],
  proRateOnMidTermEntry: false,
  dueDateRule: undefined,
};

const mockAccount = { accountId: 'account-001', studentId: 'student-001' };
const mockInvoice = { id: 'invoice-001', grandTotal: 5000, status: 'issued', lineItems: [{ feeStructureId: 'fee-001' }] };

// ============================================================================
// Test Suite
// ============================================================================

describe('EnrollmentBillingService', () => {
  let service: EnrollmentBillingService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockStudentAccountsService.getOrCreate.mockResolvedValue(mockAccount);
    mockInvoicesService.generate.mockResolvedValue(mockInvoice);
    mockInvoicesService.listForStudents.mockResolvedValue({ items: [], hasMore: false });
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([mockFee]);
    mockIdentityClient.getStudentInfo.mockResolvedValue({ firstName: 'Test', lastName: 'Student' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentBillingService,
        { provide: FeeStructuresService, useValue: mockFeeStructuresService },
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: StudentAccountsService, useValue: mockStudentAccountsService },
        { provide: ProRateService, useValue: mockProRateService },
        { provide: FinanceEventsService, useValue: mockEventsService },
        { provide: IdentityClientService, useValue: mockIdentityClient },
      ],
    }).compile();

    service = module.get<EnrollmentBillingService>(EnrollmentBillingService);
  });

  // --------------------------------------------------------------------------
  // Happy path
  // --------------------------------------------------------------------------

  it('should generate an invoice for a matching fee structure', async () => {
    const result = await service.handleEnrollment(baseParams, mockContext);

    expect(result.accountId).toBe('account-001');
    expect(result.invoiceId).toBe('invoice-001');
    expect(result.feeCount).toBe(1);

    expect(mockStudentAccountsService.getOrCreate).toHaveBeenCalledWith(
      'school-001', 'student-001', 'Test Student', mockContext,
    );
    expect(mockFeeStructuresService.getEnrollmentFees).toHaveBeenCalledWith(
      'school-001', '5', mockContext, 'new_admission',
    );
    expect(mockInvoicesService.generate).toHaveBeenCalledWith(
      'school-001',
      expect.objectContaining({
        feeStructureIds: ['fee-001'],
        studentId: 'student-001',
        autoIssue: true,
        enrollmentId: 'enrollment-001',
        gradeLevel: '5',
      }),
      mockContext,
    );
  });

  // --------------------------------------------------------------------------
  // Idempotency via enrollmentId
  // --------------------------------------------------------------------------

  it('should return existing invoice when enrollmentId matches (idempotency)', async () => {
    const existingInvoice = {
      id: 'existing-invoice-001',
      enrollmentId: 'enrollment-001',
      lineItems: [{ feeStructureId: 'fee-001' }],
    };
    mockInvoicesService.listForStudents.mockResolvedValue({
      items: [existingInvoice],
      hasMore: false,
    });

    const result = await service.handleEnrollment(baseParams, mockContext);

    expect(result.invoiceId).toBe('existing-invoice-001');
    expect(mockInvoicesService.generate).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // No matching fees
  // --------------------------------------------------------------------------

  it('should return feeCount 0 when no fee structures match', async () => {
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([]);

    const result = await service.handleEnrollment(baseParams, mockContext);

    expect(result.feeCount).toBe(0);
    expect(result.invoiceId).toBeUndefined();
    expect(mockInvoicesService.generate).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Grade filtering (verified via getEnrollmentFees mock)
  // --------------------------------------------------------------------------

  it('should pass gradeLevel to getEnrollmentFees for grade filtering', async () => {
    const gradeParams = { ...baseParams, gradeLevel: '10' };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([]);

    await service.handleEnrollment(gradeParams, mockContext);

    expect(mockFeeStructuresService.getEnrollmentFees).toHaveBeenCalledWith(
      'school-001', '10', mockContext, 'new_admission',
    );
  });

  // --------------------------------------------------------------------------
  // Enrollment type filtering
  // --------------------------------------------------------------------------

  it('should pass enrollmentType to getEnrollmentFees for type filtering', async () => {
    const transferParams = { ...baseParams, enrollmentType: 'transfer' };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([]);

    await service.handleEnrollment(transferParams, mockContext);

    expect(mockFeeStructuresService.getEnrollmentFees).toHaveBeenCalledWith(
      'school-001', '5', mockContext, 'transfer',
    );
  });

  // --------------------------------------------------------------------------
  // Fallback duplicate detection (no enrollmentId)
  // --------------------------------------------------------------------------

  it('should skip fees already invoiced when enrollmentId is absent', async () => {
    const noEnrollmentIdParams = { ...baseParams, enrollmentId: undefined };
    const existingInvoice = {
      id: 'old-invoice',
      lineItems: [{ feeStructureId: 'fee-001' }],
    };
    mockInvoicesService.listForStudents.mockResolvedValue({
      items: [existingInvoice],
      hasMore: false,
    });

    const result = await service.handleEnrollment(noEnrollmentIdParams, mockContext);

    expect(result.feeCount).toBe(0);
    expect(mockInvoicesService.generate).not.toHaveBeenCalled();
  });

  it('should generate invoice for new fees when some are already invoiced', async () => {
    const noEnrollmentIdParams = { ...baseParams, enrollmentId: undefined };
    const newFee = { ...mockFee, feeStructureId: 'fee-002', name: 'Lab Fee' };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([mockFee, newFee]);
    mockInvoicesService.listForStudents.mockResolvedValue({
      items: [{ id: 'old-invoice', lineItems: [{ feeStructureId: 'fee-001' }] }],
      hasMore: false,
    });

    const result = await service.handleEnrollment(noEnrollmentIdParams, mockContext);

    expect(result.feeCount).toBe(1);
    expect(mockInvoicesService.generate).toHaveBeenCalledWith(
      'school-001',
      expect.objectContaining({ feeStructureIds: ['fee-002'] }),
      mockContext,
    );
  });

  // --------------------------------------------------------------------------
  // Pro-rate discounts
  // --------------------------------------------------------------------------

  it('should apply pro-rate discount when term dates are provided', async () => {
    const proRateParams: EnrollmentBillingParams = {
      ...baseParams,
      termStartDate: '2026-01-01',
      termEndDate: '2026-12-31',
    };
    const proRateFee = { ...mockFee, proRateOnMidTermEntry: true, frequency: 'annual' };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([proRateFee]);
    mockProRateService.calculateProRatedAmount.mockReturnValue(3750);

    await service.handleEnrollment(proRateParams, mockContext);

    expect(mockProRateService.calculateProRatedAmount).toHaveBeenCalledWith({
      fullAmount: 5000,
      termStartDate: '2026-01-01',
      termEndDate: '2026-12-31',
      enrollmentDate: '2026-04-01',
      frequency: 'annual',
      proRateEnabled: true,
    });
    expect(mockInvoicesService.generate).toHaveBeenCalledWith(
      'school-001',
      expect.objectContaining({
        discounts: [{ feeStructureId: 'fee-001', amount: 1250, reason: expect.stringContaining('Pro-rated') }],
      }),
      mockContext,
    );
  });

  it('should not apply pro-rate when proRateOnMidTermEntry is false', async () => {
    const proRateParams: EnrollmentBillingParams = {
      ...baseParams,
      termStartDate: '2026-01-01',
      termEndDate: '2026-12-31',
    };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([mockFee]); // proRateOnMidTermEntry: false

    await service.handleEnrollment(proRateParams, mockContext);

    expect(mockProRateService.calculateProRatedAmount).not.toHaveBeenCalled();
  });

  it('should not apply pro-rate when term dates are absent', async () => {
    const proRateFee = { ...mockFee, proRateOnMidTermEntry: true };
    mockFeeStructuresService.getEnrollmentFees.mockResolvedValue([proRateFee]);

    await service.handleEnrollment(baseParams, mockContext); // no termStartDate/termEndDate

    expect(mockProRateService.calculateProRatedAmount).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Student name resolution fallback
  // --------------------------------------------------------------------------

  it('should resolve student name from identity when not provided', async () => {
    const noNameParams = { ...baseParams, studentName: undefined };
    mockIdentityClient.getStudentInfo.mockResolvedValue({ firstName: 'Resolved', lastName: 'Name' });

    await service.handleEnrollment(noNameParams, mockContext);

    expect(mockIdentityClient.getStudentInfo).toHaveBeenCalledWith('student-001', mockContext);
    expect(mockStudentAccountsService.getOrCreate).toHaveBeenCalledWith(
      'school-001', 'student-001', 'Resolved Name', mockContext,
    );
  });
});

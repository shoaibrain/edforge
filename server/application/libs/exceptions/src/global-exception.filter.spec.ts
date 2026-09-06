import {
  ArgumentsHost,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { GlobalExceptionFilter } from './global-exception.filter';
import { BusinessException } from './exceptions';

const REQUEST_URL = '/finance/schools/s-1/agreements/a-1/activate';

function runFilter(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        url: REQUEST_URL,
        method: 'POST',
        headers: { 'x-request-id': 'req-1' },
      }),
    }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);

  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('GlobalExceptionFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('domain error payloads (finance 409 contract)', () => {
    it('forwards AGREEMENT_ACTIVE with its invoice references', () => {
      const { status, body } = runFilter(
        new ConflictException({
          code: 'AGREEMENT_ACTIVE',
          message: 'This agreement already priced an invoice this term.',
          agreementId: 'agr-1',
          existingInvoiceId: 'inv-1',
          existingInvoiceNumber: 'INV-2083-0001',
          coveredFeeTypes: ['tuition', 'exam'],
        }),
      );

      expect(status).toBe(409);
      expect(body).toMatchObject({
        statusCode: 409,
        errorCode: 'CONFLICT',
        code: 'AGREEMENT_ACTIVE',
        message: 'This agreement already priced an invoice this term.',
        agreementId: 'agr-1',
        existingInvoiceId: 'inv-1',
        existingInvoiceNumber: 'INV-2083-0001',
        coveredFeeTypes: ['tuition', 'exam'],
        requestId: 'req-1',
        path: REQUEST_URL,
      });
      expect(typeof body.timestamp).toBe('string');
    });

    it('omits existingInvoiceId when the lock backstop threw without one', () => {
      const { body } = runFilter(
        new ConflictException({
          code: 'AGREEMENT_ACTIVE',
          message: 'Concurrent generation detected.',
          agreementId: 'agr-1',
          coveredFeeTypes: ['tuition'],
        }),
      );

      expect(body.code).toBe('AGREEMENT_ACTIVE');
      expect(body.agreementId).toBe('agr-1');
      expect(body).not.toHaveProperty('existingInvoiceId');
    });

    it('forwards CONFLICTING_OPEN_INVOICES with the conflicts[] listing', () => {
      const conflicts = [
        { invoiceId: 'inv-1', invoiceNumber: 'INV-2083-0001', grandTotal: 15000, matchedFeeTypes: ['tuition'] },
        { invoiceId: 'inv-2', invoiceNumber: 'INV-2083-0002', grandTotal: 2500, matchedFeeTypes: ['exam'] },
      ];
      const { status, body } = runFilter(
        new ConflictException({
          code: 'CONFLICTING_OPEN_INVOICES',
          message: '2 open standard invoice(s) cover fee types this agreement replaces.',
          conflicts,
        }),
      );

      expect(status).toBe(409);
      expect(body.code).toBe('CONFLICTING_OPEN_INVOICES');
      expect(body.conflicts).toEqual(conflicts);
    });

    it('forwards AGREEMENT_OVERLAP with the offending students and agreement', () => {
      const { body } = runFilter(
        new ConflictException({
          code: 'AGREEMENT_OVERLAP',
          message: 'Another active agreement covers these students.',
          studentIds: ['stu-1', 'stu-2'],
          conflictingAgreementId: 'agr-9',
        }),
      );

      expect(body.code).toBe('AGREEMENT_OVERLAP');
      expect(body.studentIds).toEqual(['stu-1', 'stu-2']);
      expect(body.conflictingAgreementId).toBe('agr-9');
    });

    it('never lets a payload key overwrite the envelope', () => {
      const { status, body } = runFilter(
        new ConflictException({
          code: 'X',
          message: 'm',
          statusCode: 200,
          errorCode: 'NOT_A_STATUS_CODE',
          timestamp: 'evil',
          requestId: 'evil',
          path: '/evil',
        }),
      );

      expect(status).toBe(409);
      expect(body.statusCode).toBe(409);
      expect(body.errorCode).toBe('NOT_A_STATUS_CODE');
      expect(body.timestamp).not.toBe('evil');
      expect(body.requestId).toBe('req-1');
      expect(body.path).toBe(REQUEST_URL);
    });

    it('ignores a non-string code', () => {
      const { body } = runFilter(new ConflictException({ code: 42, message: 'm' }));
      expect(body).not.toHaveProperty('code');
      expect(body.errorCode).toBe('CONFLICT');
    });
  });

  describe('unchanged envelopes', () => {
    it('keeps the nestjs-zod 400 shape (errors[] + details.validationErrors)', () => {
      const parsed = z.object({ title: z.string() }).safeParse({});
      if (parsed.success) throw new Error('fixture must fail validation');
      const { status, body } = runFilter(new ZodValidationException(parsed.error));

      expect(status).toBe(400);
      expect(body.statusCode).toBe(400);
      expect(body.errorCode).toBe('BAD_REQUEST');
      expect(body.message).toBe('Validation failed');
      expect(body.errors).toEqual([
        expect.objectContaining({ path: ['title'], code: 'invalid_type' }),
      ]);
      expect(body.details.validationErrors).toEqual([
        expect.objectContaining({ path: 'title', code: 'invalid_type' }),
      ]);
      expect(body).not.toHaveProperty('code');
      expect(Object.keys(body).sort()).toEqual(
        ['details', 'errorCode', 'errors', 'message', 'path', 'requestId', 'statusCode', 'timestamp'],
      );
    });

    it('keeps the BusinessException shape (errorCode + details)', () => {
      const { status, body } = runFilter(
        new BusinessException('EMIS code required', 400, 'EMIS_CODE_REQUIRED', { country: 'NPL' }),
      );

      expect(status).toBe(400);
      expect(body.errorCode).toBe('EMIS_CODE_REQUIRED');
      expect(body.details).toEqual({ country: 'NPL' });
      expect(body).not.toHaveProperty('code');
      expect(Object.keys(body).sort()).toEqual(
        ['details', 'errorCode', 'message', 'path', 'requestId', 'statusCode', 'timestamp'],
      );
    });

    it('keeps string-constructed HttpExceptions minimal (no Nest `error` label)', () => {
      const { status, body } = runFilter(new NotFoundException('School not found'));

      expect(status).toBe(404);
      expect(body).toMatchObject({
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        message: 'School not found',
      });
      expect(body).not.toHaveProperty('error');
      expect(body).not.toHaveProperty('code');
    });

    it('maps unknown errors to a generic 500 without leaking the message', () => {
      const { status, body } = runFilter(new Error('dynamodb credentials expired'));

      expect(status).toBe(500);
      expect(body.errorCode).toBe('INTERNAL_SERVER_ERROR');
      expect(body.message).toBe('An unexpected error occurred');
      expect(JSON.stringify(body)).not.toContain('dynamodb');
    });
  });
});

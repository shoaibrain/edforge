import { HttpStatus } from '@nestjs/common';
import { BaseDomainException, BaseErrorCode } from './exception.base';

class TestException extends BaseDomainException {
  constructor(message: string, details?: any) {
    super(BaseErrorCode.INVALID_INPUT, message, HttpStatus.BAD_REQUEST, details);
  }
}

describe('BaseDomainException', () => {
  it('should create exception with error code and message', () => {
    const exception = new TestException('Test error');
    expect(exception.errorCode).toBe(BaseErrorCode.INVALID_INPUT);
    expect(exception.message).toBe('Test error');
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('should include details in error response', () => {
    const details = { field: 'name', reason: 'required' };
    const exception = new TestException('Test error', details);
    
    const response = exception.getErrorResponse();
    expect(response.details).toEqual(details);
  });

  it('should include timestamp in error response', () => {
    const exception = new TestException('Test error');
    const response = exception.getErrorResponse();
    
    expect(response.timestamp).toBeDefined();
    expect(new Date(response.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });
});


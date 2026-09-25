/**
 * LILI-BUG #519 — structured log calls must not collapse to "[object Object]".
 *
 * Observed in production CloudWatch on 2026-09-25, on the deploy carrying
 * #506A:
 *
 *   [finance-service] [PaymentsService][<corr>] [object Object]
 *   [academics-service] [[object Object]][<corr>] Event published: StudentCreated
 *
 * Nest's LoggerService contract is `(message: any, context?: string)`, and both
 * slots reached `String()`. 81 call sites across finance and academics pass a
 * structured object as the MESSAGE (`{ action: 'payment.manual_recorded', ... }`)
 * and 17 pass one as the CONTEXT. Every one of them logged nothing usable.
 *
 * The intent at those call sites is right — they are structured-logging on
 * purpose — so this is fixed once in the logger rather than at ~100 sites.
 *
 * THIS MATTERS MORE AFTER #506B. `logEntry.message` is built BEFORE
 * `JSON.stringify`, so switching to JSON output does not rescue it: the
 * structured logs would ship `"message": "[object Object]"` permanently.
 */

import { StructuredLogger } from './logger.service';

describe('#519 — StructuredLogger normalizes structured input', () => {
  let out: string[];
  let errOut: string[];

  beforeEach(() => {
    out = [];
    errOut = [];
    jest.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(String(a[0])); });
    jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errOut.push(String(a[0])); });
  });
  afterEach(() => jest.restoreAllMocks());

  /** Production mode is the shape that actually ships; assert on the JSON. */
  function prodLogger(): StructuredLogger {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const l = new StructuredLogger('test-service');
    process.env.NODE_ENV = prev;
    return l;
  }

  it('never emits the literal string [object Object] for an object message', () => {
    prodLogger().log({ action: 'payment.manual_recorded', schoolId: 's1', amount: 3000 });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('[object Object]');
  });

  it('promotes `action` to the human-readable message', () => {
    prodLogger().log({ action: 'payment.manual_recorded', schoolId: 's1' });
    expect(JSON.parse(out[0]).message).toBe('payment.manual_recorded');
  });

  it('keeps every other key — the payload is the point of a structured log', () => {
    prodLogger().log({ action: 'payment.manual_recorded', schoolId: 's1', invoiceId: 'i1', amount: 3000 });
    const e = JSON.parse(out[0]);
    expect(e.metadata).toEqual({ schoolId: 's1', invoiceId: 'i1', amount: 3000 });
  });

  it('prefers an inner `message` over `action`, keeping action as metadata', () => {
    prodLogger().log({ action: 'x.y', message: 'human readable', extra: 1 });
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('human readable');
    expect(e.metadata).toEqual({ action: 'x.y', extra: 1 });
  });

  it('falls back to a marker rather than [object Object] when there is no discriminator', () => {
    prodLogger().log({ foo: 'bar' });
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('[structured]');
    expect(e.metadata).toEqual({ foo: 'bar' });
  });

  it('treats an object CONTEXT as metadata, not a context label', () => {
    // event-service.base.ts does exactly this: logger.log(`...`, { eventType, ... })
    prodLogger().log('Event published: StudentCreated', { eventType: 'StudentCreated', id: 'e1' });
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('Event published: StudentCreated');
    expect(e.context).toBeUndefined();
    expect(e.metadata).toEqual({ eventType: 'StudentCreated', id: 'e1' });
  });

  it('still honours a STRING context — the ordinary path is unchanged', () => {
    prodLogger().log('plain message', 'PaymentsService');
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('plain message');
    expect(e.context).toBe('PaymentsService');
    expect(e.metadata).toBeUndefined();
  });

  it('leaves a plain string message exactly as it was', () => {
    prodLogger().warn('something ordinary');
    expect(JSON.parse(out[0]).message).toBe('something ordinary');
  });

  it('applies to warn as well as log', () => {
    prodLogger().warn({ action: 'payment.manual_transaction_cancelled', detail: 'd' });
    const e = JSON.parse(out[0]);
    expect(e.level).toBe('warn');
    expect(e.message).toBe('payment.manual_transaction_cancelled');
  });

  it('normalizes an object handed to error() without inventing a stack', () => {
    prodLogger().error({ action: 'iemis.audit.emit_failure', type: 'student.descriptor.edited' });
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('iemis.audit.emit_failure');
    expect(e.metadata).toEqual({ type: 'student.descriptor.edited' });
    // No trace was supplied, so no fabricated Error object.
    expect(e.error).toBeUndefined();
  });

  it('preserves a real Error stack on error() — the pre-existing contract', () => {
    const boom = new Error('kaboom');
    prodLogger().error(boom);
    const e = JSON.parse(out[0]);
    expect(e.message).toBe('kaboom');
    expect(e.error.name).toBe('Error');
    expect(e.error.stack).toContain('kaboom');
  });

  it('keeps the compliance token intact for the IEMIS metric filter', () => {
    // The CloudWatch MetricFilter keys off this literal text. It is emitted as
    // a plain string today; pin that normalization cannot disturb it.
    prodLogger().error('iemis.audit.emit_failure type=student.descriptor.edited tenant=t1 error=boom');
    expect(out[0]).toContain('iemis.audit.emit_failure');
  });
});

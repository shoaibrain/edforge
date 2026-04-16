import {
  validateAnalyticsEvent,
  AnalyticsEventValidationError,
} from './analytics-event.validator';

const validEvent = () => ({
  schemaVersion: 1,
  eventId: '11111111-2222-3333-4444-555555555555',
  ts: '2026-04-14T12:00:00.000Z',
  tenantId: 'tenant-abc',
  tenantTier: 'BASIC',
  userId: 'user-123',
  role: 'Teacher',
  feature: 'attendance',
  action: 'create',
});

describe('validateAnalyticsEvent', () => {
  it('accepts a valid event', () => {
    const out = validateAnalyticsEvent(validEvent());
    expect(out.eventId).toBe('11111111-2222-3333-4444-555555555555');
    expect(out.schemaVersion).toBe(1);
  });

  it('rejects missing schemaVersion', () => {
    const e: any = validEvent();
    delete e.schemaVersion;
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects schemaVersion: 2', () => {
    const e = { ...validEvent(), schemaVersion: 2 };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects missing tenantId', () => {
    const e: any = validEvent();
    delete e.tenantId;
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects empty tenantId', () => {
    const e = { ...validEvent(), tenantId: '' };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects non-UUID eventId', () => {
    const e = { ...validEvent(), eventId: 'not-a-uuid' };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects non-ISO8601 ts', () => {
    const e = { ...validEvent(), ts: '2026-04-14 12:00:00' };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects tenantTier other than BASIC', () => {
    const e = { ...validEvent(), tenantTier: 'ADVANCED' };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects unknown role', () => {
    const e = { ...validEvent(), role: 'Auditor' };
    expect(() => validateAnalyticsEvent(e)).toThrow(AnalyticsEventValidationError);
  });

  it('rejects missing feature or action', () => {
    const e1: any = validEvent();
    delete e1.feature;
    expect(() => validateAnalyticsEvent(e1)).toThrow(AnalyticsEventValidationError);

    const e2: any = validEvent();
    delete e2.action;
    expect(() => validateAnalyticsEvent(e2)).toThrow(AnalyticsEventValidationError);
  });

  it('accepts optional schoolId, correlationId, metadata', () => {
    const out = validateAnalyticsEvent({
      ...validEvent(),
      schoolId: 'school-1',
      correlationId: 'corr-1',
      metadata: { anything: 'goes', nested: { ok: true } },
    });
    expect(out.schoolId).toBe('school-1');
    expect(out.correlationId).toBe('corr-1');
    expect(out.metadata).toEqual({ anything: 'goes', nested: { ok: true } });
  });

  it('rejects non-object input', () => {
    expect(() => validateAnalyticsEvent(null)).toThrow(AnalyticsEventValidationError);
    expect(() => validateAnalyticsEvent('string')).toThrow(AnalyticsEventValidationError);
    expect(() => validateAnalyticsEvent(42)).toThrow(AnalyticsEventValidationError);
  });

  it('exposes zod issues on the error', () => {
    try {
      validateAnalyticsEvent({ ...validEvent(), schemaVersion: 99 });
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AnalyticsEventValidationError);
      expect((e as AnalyticsEventValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

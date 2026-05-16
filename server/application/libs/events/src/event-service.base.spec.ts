/**
 * C0.c.1 — EventServiceBase contract test.
 *
 * `EventServiceBase` is the abstract publisher every microservice's
 * domain-events service extends (IdentityEventsService,
 * AcademicsEventsService, FinanceEventsService). It targets the SBT
 * EventBridge bus that's exported from `controlplane-stack` and threaded
 * to every ECS task via the `EVENT_BUS_NAME` env var.
 *
 * The class has flowed live events in prod since the Sprint A backend
 * shipped (staff.training, school.created, etc.) but had no automated
 * test coverage. This spec locks the contract so the C0.c.3 refactor
 * (add Zod runtime validation to publishEvent) can move with confidence.
 *
 * Coverage:
 *   - Fail-fast on missing EVENT_BUS_NAME
 *   - publishEvent forms the correct PutEventsCommand shape
 *   - publishEvent invokes the failure handler on FailedEntryCount
 *   - publishEvent invokes the failure handler on send() throw
 *   - publishEvent does NOT throw on EventBridge failure
 *   - publishEvents batches at 10 events per PutEventsCommand
 *   - publishEvents falls back to per-event publish on batch send throw
 *
 * Pilot-agnostic per invariant 13.
 */

const ebSend = jest.fn();
const ebCtor = jest.fn();

jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation((cfg: unknown) => {
      ebCtor(cfg);
      return {
        send: (...args: unknown[]) => ebSend(...args),
      };
    }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventServiceBase, BaseDomainEvent } from './event-service.base';

/**
 * Minimal concrete subclass for testing the abstract base. Real
 * subclasses (IdentityEventsService etc.) follow this exact pattern —
 * set `eventSource` on the instance, otherwise inherit everything.
 */
class TestDomainEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.test';

  // Expose the protected failure handler for assertion in tests.
  public failureHandler = jest.fn();
  // Capture eventBusName for test assertions.
  public getEventBusName(): string {
    return this.eventBusName;
  }
  protected async handleEventPublishingFailure(
    event: BaseDomainEvent,
    error: any,
  ): Promise<void> {
    this.failureHandler(event, error);
  }
}

const BASE_ENV: Record<string, string> = {
  EVENT_BUS_NAME: 'test-sbt-bus',
  AWS_REGION: 'us-east-2',
};

function withEnv(overrides: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const saved = process.env;
  process.env = { ...saved, ...BASE_ENV };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const result = run();
  if (result instanceof Promise) {
    return result.finally(() => {
      process.env = saved;
    });
  }
  process.env = saved;
  return result;
}

function makeEvent(overrides: Partial<BaseDomainEvent> = {}): BaseDomainEvent {
  return {
    eventType: 'TestEntityCreated',
    timestamp: '2026-05-15T12:00:00.000Z',
    tenantId: 'tenant-c0c1',
    ...overrides,
  };
}

describe('EventServiceBase — C0.c.1 contract', () => {
  beforeEach(() => {
    ebSend.mockReset();
    ebCtor.mockReset();
  });

  describe('constructor', () => {
    it('throws fail-fast when EVENT_BUS_NAME is unset', () => {
      withEnv({ EVENT_BUS_NAME: undefined }, () => {
        expect(() => new TestDomainEventsService()).toThrow(
          /EVENT_BUS_NAME environment variable is not set/i,
        );
      });
    });

    it('initializes with EVENT_BUS_NAME and configures the EventBridge client', () => {
      withEnv({}, () => {
        const svc = new TestDomainEventsService();
        expect(svc.getEventBusName()).toBe('test-sbt-bus');
        // EventBridge client constructed with adaptive retry — these are
        // production-critical config values the base class promises.
        expect(ebCtor).toHaveBeenCalledWith(
          expect.objectContaining({
            region: 'us-east-2',
            maxAttempts: 3,
            retryMode: 'adaptive',
          }),
        );
      });
    });
  });

  describe('publishEvent — single', () => {
    it('forms a PutEventsCommand with the documented entry shape', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
        const svc = new TestDomainEventsService();
        const evt = makeEvent({ eventType: 'SchoolCreated', tenantId: 'tenant-abc' });

        await svc.publishEvent(evt);

        expect(ebSend).toHaveBeenCalledTimes(1);
        const command = ebSend.mock.calls[0][0] as PutEventsCommand;
        expect(command.input.Entries).toHaveLength(1);
        const entry = command.input.Entries![0];
        expect(entry.Source).toBe('edforge.test');
        expect(entry.DetailType).toBe('SchoolCreated');
        expect(entry.EventBusName).toBe('test-sbt-bus');
        expect(entry.Detail).toBe(JSON.stringify(evt));
        // Time must be a Date constructed from the event's timestamp
        // (EventBridge requires a Date instance, not a string).
        expect(entry.Time).toBeInstanceOf(Date);
        expect((entry.Time as Date).toISOString()).toBe(evt.timestamp);
      });
    });

    it('invokes the failure handler when FailedEntryCount > 0', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({
          FailedEntryCount: 1,
          Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'boom' }],
        });
        const svc = new TestDomainEventsService();
        const evt = makeEvent();

        await svc.publishEvent(evt);

        expect(svc.failureHandler).toHaveBeenCalledTimes(1);
        expect(svc.failureHandler.mock.calls[0][0]).toBe(evt);
      });
    });

    it('invokes the failure handler when send() throws and does NOT propagate', async () => {
      await withEnv({}, async () => {
        ebSend.mockRejectedValue(new Error('network down'));
        const svc = new TestDomainEventsService();
        const evt = makeEvent();

        // Best-effort delivery: publishEvent must never throw. A throw
        // here would propagate into the calling service write path and
        // break the main operation — see EventServiceBase docstring.
        await expect(svc.publishEvent(evt)).resolves.toBeUndefined();
        expect(svc.failureHandler).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('publishEvents — batched', () => {
    it('no-op on empty array', async () => {
      await withEnv({}, async () => {
        const svc = new TestDomainEventsService();
        await svc.publishEvents([]);
        expect(ebSend).not.toHaveBeenCalled();
      });
    });

    it('chunks at 10 events per PutEventsCommand (EventBridge limit)', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
        const svc = new TestDomainEventsService();
        const events = Array.from({ length: 25 }, (_, i) =>
          makeEvent({ eventType: `TestEvent${i}` }),
        );

        await svc.publishEvents(events);

        // 25 events → 3 calls: 10, 10, 5
        expect(ebSend).toHaveBeenCalledTimes(3);
        const sizes = ebSend.mock.calls.map(
          (c) => (c[0] as PutEventsCommand).input.Entries!.length,
        );
        expect(sizes).toEqual([10, 10, 5]);
      });
    });

    it('falls back to per-event publish when a batch send() throws', async () => {
      await withEnv({}, async () => {
        // First call (batch) throws; subsequent per-event retries succeed.
        ebSend
          .mockRejectedValueOnce(new Error('throttled'))
          .mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt' }] });
        const svc = new TestDomainEventsService();
        const events = [makeEvent({ eventType: 'A' }), makeEvent({ eventType: 'B' })];

        await svc.publishEvents(events);

        // 1 failed batch + 2 per-event retries = 3 calls total.
        expect(ebSend).toHaveBeenCalledTimes(3);
        // Per-event retries are single-entry commands.
        const retrySizes = ebSend.mock.calls.slice(1).map(
          (c) => (c[0] as PutEventsCommand).input.Entries!.length,
        );
        expect(retrySizes).toEqual([1, 1]);
      });
    });
  });

  // ============================================================
  // C0.c.3 — runtime payload validation against EVENT_REGISTRY
  // ============================================================
  describe('C0.c.3 — payload validation gate', () => {
    /**
     * A valid school.created event payload matching the registry schema.
     * Mirrors the happy-path fixture in
     * packages/shared-types/src/events/taxonomy.spec.ts.
     */
    const validSchoolCreated = {
      eventType: 'school.created' as const,
      timestamp: '2026-05-16T12:00:00.000Z',
      tenantId: 'tenant-c0c3',
      sourceUserId: 'user-c0c3',
      schoolId: 'school-1',
      schoolCode: 'SCH001',
      name: 'Test School',
      schoolType: 'elementary' as const,
    };

    it('publishValidatedEvent emits when given a registry-known DomainEvent', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
        const svc = new TestDomainEventsService();

        await svc.publishValidatedEvent(validSchoolCreated);

        expect(ebSend).toHaveBeenCalledTimes(1);
        const entry = (ebSend.mock.calls[0][0] as PutEventsCommand).input.Entries![0];
        expect(entry.DetailType).toBe('school.created');
      });
    });

    it('publishEvent emits + validates a registry-known event with valid payload', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
        const svc = new TestDomainEventsService();

        await svc.publishEvent(validSchoolCreated);

        expect(ebSend).toHaveBeenCalledTimes(1);
        expect(svc.failureHandler).not.toHaveBeenCalled();
      });
    });

    it('publishEvent SKIPS emit + invokes DLQ hook on INVALID_PAYLOAD', async () => {
      await withEnv({}, async () => {
        const svc = new TestDomainEventsService();
        // school.created is registered but the payload is missing the
        // required schoolId/schoolCode/name/schoolType fields.
        const broken = {
          eventType: 'school.created',
          timestamp: '2026-05-16T12:00:00.000Z',
          tenantId: 'tenant-c0c3',
        };

        await svc.publishEvent(broken);

        // SKIPPED — corrupted JSON must not hit EventBridge.
        expect(ebSend).not.toHaveBeenCalled();
        expect(svc.failureHandler).toHaveBeenCalledTimes(1);
        const failureArg = svc.failureHandler.mock.calls[0][1];
        expect(failureArg.errorCode).toBe('INVALID_PAYLOAD');
        expect(Array.isArray(failureArg.issues)).toBe(true);
      });
    });

    it('publishEvent EMITS legacy (unregistered) PascalCase events with a warning', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
        const svc = new TestDomainEventsService();
        // SchoolCreated PascalCase is NOT in EVENT_REGISTRY (only the
        // snake-dotted school.created is). The ~110 existing PascalCase
        // publishers continue to flow under this branch.
        const legacy = {
          eventType: 'SchoolCreated',
          timestamp: '2026-05-16T12:00:00.000Z',
          tenantId: 'tenant-c0c3',
          schoolId: 'school-1',
        };

        await svc.publishEvent(legacy);

        // EMITTED — backward compat preserved.
        expect(ebSend).toHaveBeenCalledTimes(1);
        expect(svc.failureHandler).not.toHaveBeenCalled();
        const entry = (ebSend.mock.calls[0][0] as PutEventsCommand).input.Entries![0];
        expect(entry.DetailType).toBe('SchoolCreated');
      });
    });

    it('publishEvents drops INVALID_PAYLOAD entries from a mixed batch + emits the rest', async () => {
      await withEnv({}, async () => {
        ebSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
        const svc = new TestDomainEventsService();

        const events = [
          validSchoolCreated,
          // Broken — registered eventType, missing required fields.
          {
            eventType: 'school.created',
            timestamp: '2026-05-16T12:00:00.000Z',
            tenantId: 'tenant-c0c3',
          },
          // Legacy — unregistered, emits with warning.
          {
            eventType: 'SchoolUpdated',
            timestamp: '2026-05-16T12:00:00.000Z',
            tenantId: 'tenant-c0c3',
            schoolId: 'school-1',
          },
        ];

        await svc.publishEvents(events);

        // 2 valid+legacy events should be batched into a single PutEvents.
        expect(ebSend).toHaveBeenCalledTimes(1);
        const entries = (ebSend.mock.calls[0][0] as PutEventsCommand).input.Entries!;
        expect(entries.length).toBe(2);
        const detailTypes = entries.map((e) => e.DetailType);
        expect(detailTypes).toContain('school.created');
        expect(detailTypes).toContain('SchoolUpdated');
        // Broken event landed in the DLQ hook.
        expect(svc.failureHandler).toHaveBeenCalledTimes(1);
        expect(svc.failureHandler.mock.calls[0][1].errorCode).toBe('INVALID_PAYLOAD');
      });
    });

    it('publishEvents emits zero EventBridge calls when EVERY entry is INVALID_PAYLOAD', async () => {
      await withEnv({}, async () => {
        const svc = new TestDomainEventsService();
        const allBroken = [
          { eventType: 'school.created', timestamp: '2026-05-16T12:00:00.000Z', tenantId: 't' },
          { eventType: 'attendance.recorded', timestamp: '2026-05-16T12:00:00.000Z', tenantId: 't' },
        ];

        await svc.publishEvents(allBroken);

        expect(ebSend).not.toHaveBeenCalled();
        expect(svc.failureHandler).toHaveBeenCalledTimes(2);
      });
    });
  });
});

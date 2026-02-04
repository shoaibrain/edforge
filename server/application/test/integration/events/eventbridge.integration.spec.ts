/**
 * EventBridge Integration Tests
 * 
 * Tests event publishing to LocalStack EventBridge.
 * Requires: docker-compose -f docker-compose.local.yml up -d
 */

import { EventBridgeClient, PutEventsCommand, DescribeEventBusCommand } from '@aws-sdk/client-eventbridge';
import { 
  createEventBridgeClient, 
  createTestEventBus,
  EVENT_BUS_NAME,
  TEST_TENANT_ID,
  LOCALSTACK_ENDPOINT,
} from '../setup';

describe('EventBridge Integration Tests', () => {
  let eventBridgeClient: EventBridgeClient;

  beforeAll(async () => {
    // Skip if LocalStack is not available
    eventBridgeClient = createEventBridgeClient();
    
    try {
      await eventBridgeClient.send(new DescribeEventBusCommand({ Name: 'default' }));
    } catch (error) {
      console.warn('LocalStack not available, skipping integration tests');
      return;
    }

    await createTestEventBus();
  });

  afterAll(() => {
    eventBridgeClient?.destroy();
  });

  describe('Event Publishing', () => {
    it('should successfully publish a UserCreated event', async () => {
      const event = {
        Source: 'edforge.identity-service',
        DetailType: 'UserCreated',
        Detail: JSON.stringify({
          eventId: `evt-${Date.now()}`,
          eventType: 'UserCreated',
          source: 'edforge.identity-service',
          timestamp: new Date().toISOString(),
          version: '1.0',
          tenantId: TEST_TENANT_ID,
          userId: 'test-user-integration',
          email: 'testuser@integration.edu',
          metadata: {
            correlationId: `corr-${Date.now()}`,
            requestId: `req-${Date.now()}`,
          },
        }),
        EventBusName: EVENT_BUS_NAME,
      };

      const result = await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event],
      }));

      expect(result.FailedEntryCount).toBe(0);
      expect(result.Entries).toHaveLength(1);
      expect(result.Entries![0].EventId).toBeDefined();
    });

    it('should successfully publish a SchoolCreated event', async () => {
      const event = {
        Source: 'edforge.identity-service',
        DetailType: 'SchoolCreated',
        Detail: JSON.stringify({
          eventId: `evt-${Date.now()}`,
          eventType: 'SchoolCreated',
          source: 'edforge.identity-service',
          timestamp: new Date().toISOString(),
          version: '1.0',
          tenantId: TEST_TENANT_ID,
          schoolId: 'test-school-integration',
          schoolCode: 'TSI001',
          name: 'Test School Integration',
          metadata: {
            correlationId: `corr-${Date.now()}`,
            requestId: `req-${Date.now()}`,
          },
        }),
        EventBusName: EVENT_BUS_NAME,
      };

      const result = await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event],
      }));

      expect(result.FailedEntryCount).toBe(0);
      expect(result.Entries).toHaveLength(1);
    });

    it('should successfully publish a StudentEnrolled event', async () => {
      const event = {
        Source: 'edforge.academics-service',
        DetailType: 'StudentEnrolled',
        Detail: JSON.stringify({
          eventId: `evt-${Date.now()}`,
          eventType: 'StudentEnrolled',
          source: 'edforge.academics-service',
          timestamp: new Date().toISOString(),
          version: '1.0',
          tenantId: TEST_TENANT_ID,
          studentId: 'test-student-integration',
          schoolId: 'test-school-integration',
          enrollmentId: `enroll-${Date.now()}`,
          academicYear: '2024-2025',
          gradeLevel: '5',
          metadata: {
            correlationId: `corr-${Date.now()}`,
            requestId: `req-${Date.now()}`,
          },
        }),
        EventBusName: EVENT_BUS_NAME,
      };

      const result = await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event],
      }));

      expect(result.FailedEntryCount).toBe(0);
    });

    it('should successfully publish batch events', async () => {
      const events = [
        {
          Source: 'edforge.identity-service',
          DetailType: 'UserUpdated',
          Detail: JSON.stringify({
            eventId: `evt-${Date.now()}-1`,
            eventType: 'UserUpdated',
            tenantId: TEST_TENANT_ID,
            userId: 'user-1',
            changedFields: ['firstName', 'lastName'],
          }),
          EventBusName: EVENT_BUS_NAME,
        },
        {
          Source: 'edforge.identity-service',
          DetailType: 'UserUpdated',
          Detail: JSON.stringify({
            eventId: `evt-${Date.now()}-2`,
            eventType: 'UserUpdated',
            tenantId: TEST_TENANT_ID,
            userId: 'user-2',
            changedFields: ['email'],
          }),
          EventBusName: EVENT_BUS_NAME,
        },
        {
          Source: 'edforge.academics-service',
          DetailType: 'AttendanceRecorded',
          Detail: JSON.stringify({
            eventId: `evt-${Date.now()}-3`,
            eventType: 'AttendanceRecorded',
            tenantId: TEST_TENANT_ID,
            studentId: 'student-1',
            date: '2024-01-15',
            status: 'present',
          }),
          EventBusName: EVENT_BUS_NAME,
        },
      ];

      const result = await eventBridgeClient.send(new PutEventsCommand({
        Entries: events,
      }));

      expect(result.FailedEntryCount).toBe(0);
      expect(result.Entries).toHaveLength(3);
    });

    it('should handle event with all required fields', async () => {
      const event = {
        Source: 'edforge.identity-service',
        DetailType: 'TenantCreated',
        Detail: JSON.stringify({
          eventId: `evt-tenant-${Date.now()}`,
          eventType: 'TenantCreated',
          source: 'edforge.identity-service',
          timestamp: new Date().toISOString(),
          version: '1.0',
          // Domain data
          tenantId: `tenant-new-${Date.now()}`,
          tenantName: 'New Test District',
          tier: 'basic',
          status: 'provisioning',
          // Metadata
          metadata: {
            correlationId: `corr-${Date.now()}`,
            requestId: `req-${Date.now()}`,
            causationId: `caus-${Date.now()}`,
            userId: 'system',
            userAgent: 'integration-test',
            ipAddress: '127.0.0.1',
          },
        }),
        EventBusName: EVENT_BUS_NAME,
      };

      const result = await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event],
      }));

      expect(result.FailedEntryCount).toBe(0);
      expect(result.Entries![0].EventId).toBeDefined();
    });
  });

  describe('Event Bus Verification', () => {
    it('should verify event bus exists', async () => {
      const result = await eventBridgeClient.send(
        new DescribeEventBusCommand({ Name: EVENT_BUS_NAME })
      );

      expect(result.Name).toBe(EVENT_BUS_NAME);
      expect(result.Arn).toContain(EVENT_BUS_NAME);
    });
  });
});


/**
 * FinanceAuditService spec — Sprint 0.3
 *
 * Covers:
 *   - `emit` writes a DDB row with the expected entity shape
 *   - `emit` always writes the CloudWatch log line, even if DDB fails
 *   - `presignedKey` is SHA256-hashed before storage; raw key never
 *     reaches the DDB row or the CloudWatch line
 *   - DDB write failure is swallowed (warning-logged); caller is NOT
 *     blocked — audit is forensic, not gating
 *   - `list` queries with the right SK prefix + FilterExpression
 *     combinations
 */

import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';
import { FinanceAuditService } from './finance-audit.service';

const TENANT_ID = 'tenant-uuid';
const USER_ID = 'operator-uuid';
const SCHOOL_ID = 'school-uuid';
const JOB_ID = 'job-uuid';

const REQUEST_IP = '203.0.113.42';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) EdForge/1.0';

const ctx = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  jwtToken: 'jwt-token',
  email: 'op@example.com',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
  requestIp: REQUEST_IP,
  userAgent: USER_AGENT,
};

function expectedHash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('FinanceAuditService (Sprint 0.3)', () => {
  let service: FinanceAuditService;
  let dynamoDBClient: any;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      putItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    service = new FinanceAuditService(dynamoDBClient);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('emit', () => {
    it('writes a FINANCE_AUDIT_EVENT entity to DDB with the expected shape', async () => {
      await service.emit(
        'finance.bulk_export.requested',
        { schoolId: SCHOOL_ID, jobId: JOB_ID, documentCount: 86, format: 'zip' },
        ctx,
      );

      expect(dynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      const stored = dynamoDBClient.putItem.mock.calls[0][1];
      expect(stored.entityType).toBe('FINANCE_AUDIT_EVENT');
      expect(stored.eventType).toBe('finance.bulk_export.requested');
      expect(stored.tenantId).toBe(TENANT_ID);
      expect(stored.operatorId).toBe(USER_ID);
      expect(stored.schoolId).toBe(SCHOOL_ID);
      expect(stored.jobId).toBe(JOB_ID);
      expect(stored.documentCount).toBe(86);
      expect(stored.format).toBe('zip');
      expect(stored.entityKey).toMatch(/^AUDIT#FINANCE_BULK#\d{4}-\d{2}-\d{2}T.*#/);
      expect(typeof stored.eventId).toBe('string');
      expect(typeof stored.occurredAt).toBe('string');
    });

    it('emits a structured CloudWatch log line on every call', async () => {
      await service.emit(
        'finance.bulk_export.succeeded',
        { schoolId: SCHOOL_ID, jobId: JOB_ID, documentCount: 86, format: 'merged_pdf' },
        ctx,
      );

      const logLine = logSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('finance.bulk_export.succeeded'),
      );
      expect(logLine).toBeDefined();
      const parsed = JSON.parse(logLine![0] as string);
      expect(parsed.event).toBe('finance.bulk_export.succeeded');
      expect(parsed.tenantId).toBe(TENANT_ID);
      expect(parsed.operatorId).toBe(USER_ID);
      expect(parsed.schoolId).toBe(SCHOOL_ID);
      expect(parsed.jobId).toBe(JOB_ID);
      expect(parsed.documentCount).toBe(86);
      expect(parsed.format).toBe('merged_pdf');
      // Sprint 0.3 — IP + UA recorded on both DDB row + CW line (Codex P1)
      expect(parsed.requestIp).toBe(REQUEST_IP);
      expect(parsed.userAgent).toBe(USER_AGENT);
    });

    it('records requestIp + userAgent on the DDB row (Codex P1 — plan §0.3 required context)', async () => {
      await service.emit(
        'finance.bulk_export.url_minted',
        { schoolId: SCHOOL_ID, jobId: JOB_ID, presignedKey: 'k' },
        ctx,
      );

      const stored = dynamoDBClient.putItem.mock.calls[0][1];
      expect(stored.requestIp).toBe(REQUEST_IP);
      expect(stored.userAgent).toBe(USER_AGENT);
    });

    it('omits requestIp + userAgent when the context does not carry them (best-effort source)', async () => {
      // E.g. an internal worker call without an HTTP request — the
      // fields stay undefined rather than being fabricated.
      const ctxNoNet = { ...ctx, requestIp: undefined, userAgent: undefined };
      await service.emit(
        'finance.bulk_export.started',
        { schoolId: SCHOOL_ID, jobId: JOB_ID },
        ctxNoNet,
      );

      const stored = dynamoDBClient.putItem.mock.calls[0][1];
      expect(stored.requestIp).toBeUndefined();
      expect(stored.userAgent).toBeUndefined();
    });

    it('hashes presignedKey to SHA256 before storage; raw key never reaches the row or log line', async () => {
      const rawKey = 'tenants/X/schools/Y/pdf-jobs/Z/invoices.zip';

      await service.emit(
        'finance.bulk_export.url_minted',
        { schoolId: SCHOOL_ID, jobId: JOB_ID, presignedKey: rawKey },
        ctx,
      );

      const stored = dynamoDBClient.putItem.mock.calls[0][1];
      expect(stored.presignedKeyHash).toBe(expectedHash(rawKey));
      // Raw key MUST NOT be in the stored row
      expect(JSON.stringify(stored)).not.toContain(rawKey);

      // Raw key MUST NOT be in the CW log line either
      const logLine = logSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('url_minted'),
      );
      expect(logLine![0]).not.toContain(rawKey);
      const parsed = JSON.parse(logLine![0] as string);
      expect(parsed.presignedKeyHash).toBe(expectedHash(rawKey));
    });

    it('omits presignedKeyHash when no presignedKey is supplied', async () => {
      await service.emit(
        'finance.bulk_export.started',
        { schoolId: SCHOOL_ID, jobId: JOB_ID },
        ctx,
      );

      const stored = dynamoDBClient.putItem.mock.calls[0][1];
      expect(stored.presignedKeyHash).toBeUndefined();
    });

    it('DDB write failure is swallowed; CloudWatch line still emitted; warning logged', async () => {
      dynamoDBClient.putItem.mockRejectedValueOnce(new Error('DDB unavailable'));

      await expect(
        service.emit(
          'finance.bulk_export.failed',
          { schoolId: SCHOOL_ID, jobId: JOB_ID },
          ctx,
        ),
      ).resolves.toBeUndefined();

      // CW log line still emitted
      const logLine = logSpy.mock.calls.find(([msg]) =>
        typeof msg === 'string' && msg.includes('finance.bulk_export.failed'),
      );
      expect(logLine).toBeDefined();

      // Warning about the DDB failure
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/DDB write failed for eventType=finance\.bulk_export\.failed/),
      );
    });
  });

  describe('list', () => {
    it('always queries the broad AUDIT#FINANCE_BULK# SK prefix — even when `from` is supplied (Codex P2 fix)', async () => {
      // Pre-fix: skPrefix = AUDIT#FINANCE_BULK#{from} meant the
      // begins_with KeyCondition only matched events whose timestamp
      // STARTED WITH the exact `from` string — events AFTER that
      // instant were missed entirely.
      // Post-fix: prefix stays broad; `from`/`to` are FilterExpression
      // range bounds on entityKey.
      await service.list({}, ctx);
      expect(dynamoDBClient.query.mock.calls[0][2]).toBe('AUDIT#FINANCE_BULK#');

      dynamoDBClient.query.mockClear();
      await service.list({ from: '2026-06-21T00:00:00Z' }, ctx);
      expect(dynamoDBClient.query.mock.calls[0][2]).toBe('AUDIT#FINANCE_BULK#');
    });

    it('emits entityKey >= :lowerBound when `from` is supplied (the broken range query that Codex P2 caught)', async () => {
      await service.list({ from: '2026-06-21T00:00:00Z' }, ctx);

      const [, , , filterExpression, attrValues] = dynamoDBClient.query.mock.calls[0];
      expect(filterExpression).toMatch(/entityKey >= :lowerBound/);
      expect(attrValues[':lowerBound']).toBe('AUDIT#FINANCE_BULK#2026-06-21T00:00:00Z');
    });

    it('builds FilterExpression for `from` + `to` + schoolId + operatorId + eventType', async () => {
      await service.list(
        {
          from: '2026-06-21T00:00:00Z',
          to: '2026-06-22T00:00:00Z',
          schoolId: SCHOOL_ID,
          operatorId: USER_ID,
          eventType: 'finance.bulk_export.succeeded',
        },
        ctx,
      );

      const [, , , filterExpression, attrValues, attrNames] =
        dynamoDBClient.query.mock.calls[0];
      expect(filterExpression).toMatch(/entityKey >= :lowerBound/);
      expect(filterExpression).toMatch(/entityKey <= :upperBound/);
      expect(filterExpression).toMatch(/schoolId = :schoolId/);
      expect(filterExpression).toMatch(/operatorId = :operatorId/);
      expect(filterExpression).toMatch(/#evt = :eventType/);
      expect(attrValues).toMatchObject({
        ':lowerBound': 'AUDIT#FINANCE_BULK#2026-06-21T00:00:00Z',
        ':upperBound': 'AUDIT#FINANCE_BULK#2026-06-22T00:00:00Z~',
        ':schoolId': SCHOOL_ID,
        ':operatorId': USER_ID,
        ':eventType': 'finance.bulk_export.succeeded',
      });
      expect(attrNames).toMatchObject({ '#evt': 'eventType' });
    });

    it('emits no FilterExpression when no filter is supplied (broad tenant-wide list)', async () => {
      await service.list({}, ctx);

      const [, , , filterExpression] = dynamoDBClient.query.mock.calls[0];
      expect(filterExpression).toBeUndefined();
    });

    it('caps `limit` at 200 even if a higher value is requested', async () => {
      await service.list({ limit: 9999 }, ctx);

      const [, , , , , , limit] = dynamoDBClient.query.mock.calls[0];
      expect(limit).toBe(200);
    });

    it('defaults `limit` to 50 when not specified', async () => {
      await service.list({}, ctx);

      const [, , , , , , limit] = dynamoDBClient.query.mock.calls[0];
      expect(limit).toBe(50);
    });
  });
});

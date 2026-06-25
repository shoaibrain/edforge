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
    // Helper to read the skBetween param the audit service hands to
    // the DDB helper. Positional signature reminder:
    //   query(client, tenantId, skPrefix, filterExpression,
    //         attrValues, attrNames, limit, exclusiveStartKey,
    //         skBetween)
    const readSkBetween = () =>
      dynamoDBClient.query.mock.calls[0][8];
    const readSkPrefix = () => dynamoDBClient.query.mock.calls[0][2];
    const readFilterExpression = () => dynamoDBClient.query.mock.calls[0][3];
    const readAttrValues = () => dynamoDBClient.query.mock.calls[0][4];
    const readAttrNames = () => dynamoDBClient.query.mock.calls[0][5];
    const readLimit = () => dynamoDBClient.query.mock.calls[0][6];

    it('pushes the time range into a BETWEEN KeyCondition (Codex P2 round-2: prevents Limit-before-Filter starvation)', async () => {
      // Pre-fix: from/to were FilterExpression bounds on top of a
      // broad begins_with. DDB applies Limit BEFORE the filter, so
      // a tenant with N older rows outside the range could return
      // an empty page even though matches existed further down.
      // Post-fix: a true SK range pushed into KeyCondition.
      await service.list(
        { from: '2026-06-21T00:00:00Z', to: '2026-06-22T00:00:00Z' },
        ctx,
      );

      // skPrefix is unused — skBetween supersedes it
      expect(readSkPrefix()).toBeUndefined();
      expect(readSkBetween()).toEqual({
        lower: 'AUDIT#FINANCE_BULK#2026-06-21T00:00:00Z',
        upper: 'AUDIT#FINANCE_BULK#2026-06-22T00:00:00Z~',
      });
      // The time-range bounds are NOT in FilterExpression any more —
      // they've moved to the KeyCondition. FilterExpression is now
      // only for cross-attribute filters.
      expect(readFilterExpression()).toBeUndefined();
    });

    it('defaults the skBetween upper to the prefix + `~` when `to` is not supplied (capture all events ≥ `from`)', async () => {
      await service.list({ from: '2026-06-21T00:00:00Z' }, ctx);

      expect(readSkBetween()).toEqual({
        lower: 'AUDIT#FINANCE_BULK#2026-06-21T00:00:00Z',
        upper: 'AUDIT#FINANCE_BULK#~',
      });
    });

    it('defaults the skBetween lower to the prefix when `from` is not supplied (capture all events ≤ `to`)', async () => {
      await service.list({ to: '2026-06-22T00:00:00Z' }, ctx);

      expect(readSkBetween()).toEqual({
        lower: 'AUDIT#FINANCE_BULK#',
        upper: 'AUDIT#FINANCE_BULK#2026-06-22T00:00:00Z~',
      });
    });

    it('with no time filter, skBetween bounds the AUDIT#FINANCE_BULK# namespace exactly', async () => {
      await service.list({}, ctx);

      expect(readSkBetween()).toEqual({
        lower: 'AUDIT#FINANCE_BULK#',
        upper: 'AUDIT#FINANCE_BULK#~',
      });
    });

    it('cross-attribute filters (schoolId + operatorId + eventType) stay in FilterExpression and do NOT collide with the SK range', async () => {
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

      const filterExpression = readFilterExpression();
      // Time bounds in KeyCondition, not Filter
      expect(filterExpression).not.toMatch(/entityKey/);
      expect(filterExpression).toMatch(/schoolId = :schoolId/);
      expect(filterExpression).toMatch(/operatorId = :operatorId/);
      expect(filterExpression).toMatch(/#evt = :eventType/);

      const attrValues = readAttrValues();
      // SK range NOT in attribute values (passed via skBetween instead)
      expect(attrValues).not.toHaveProperty(':lowerBound');
      expect(attrValues).not.toHaveProperty(':upperBound');
      expect(attrValues).toMatchObject({
        ':schoolId': SCHOOL_ID,
        ':operatorId': USER_ID,
        ':eventType': 'finance.bulk_export.succeeded',
      });
      expect(readAttrNames()).toMatchObject({ '#evt': 'eventType' });
    });

    it('does NOT pass any FilterExpression when only the time range is supplied (cleanest possible Query)', async () => {
      await service.list({ from: '2026-06-21T00:00:00Z' }, ctx);
      expect(readFilterExpression()).toBeUndefined();
      expect(readAttrValues()).toBeUndefined();
    });

    it('caps `limit` at 200 even if a higher value is requested', async () => {
      await service.list({ limit: 9999 }, ctx);
      expect(readLimit()).toBe(200);
    });

    it('defaults `limit` to 50 when not specified', async () => {
      await service.list({}, ctx);
      expect(readLimit()).toBe(50);
    });

    it('regression — >limit pre-range rows do NOT starve a page of matching rows (Codex P2 round-2 root case)', async () => {
      // The bug Codex caught: with Limit-before-Filter, a tenant
      // with say 80 audit events from May (outside the from=June
      // range) and 20 events from July (inside the range) could
      // get back 0 rows on a Limit=50 page, because DDB would read
      // 50 May rows and the FilterExpression would drop all of them.
      //
      // With the BETWEEN KeyCondition push-down, DDB only reads
      // matching rows in the first place, so a Limit=50 against
      // 20 matching rows correctly returns 20. The audit service
      // does NOT need to internally page or post-filter because
      // the range bounds are in the KeyCondition.
      const matchingRows = Array.from({ length: 20 }, (_, i) => ({
        tenantId: TENANT_ID,
        entityKey: `AUDIT#FINANCE_BULK#2026-07-0${i % 10}T00:00:00Z#evt-${i}`,
        entityType: 'FINANCE_AUDIT_EVENT',
        eventType: 'finance.bulk_export.succeeded',
      }));
      dynamoDBClient.query.mockResolvedValueOnce({
        items: matchingRows,
        hasMore: false,
      });

      const result = await service.list({ from: '2026-07-01T00:00:00Z' }, ctx);

      expect(result.items).toHaveLength(20);
      // Single DDB call — the range push-down means no internal
      // pagination is needed to defeat starvation.
      expect(dynamoDBClient.query).toHaveBeenCalledTimes(1);
    });
  });
});

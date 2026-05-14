/**
 * Audit-coverage test helpers (Sprint S0.8).
 *
 * Shared utilities for asserting that a service method emitted the right
 * audit row. The intent is a one-liner at the end of every PUT/POST/PATCH
 * integration test:
 *
 *     await service.transitionStatus(...);
 *     expectAuditRow(mockDDB, { targetEntity: 'SCHOOL', action: 'status_change' });
 *
 * Wired against the `putItem` mock on DynamoDBClientService — the helper
 * filters mock calls for items with `entityType === 'AUDIT_LOG'` and
 * matches against the supplied expectations.
 *
 * This file is intentionally test-only — no runtime imports outside *.spec.ts.
 */

interface MockedDynamoDBClient {
  putItem: { mock: { calls: any[][] } };
}

export interface AuditRowExpectation {
  targetEntity?: string;
  targetEntityId?: string;
  action?: string;
  changedBy?: string;
  /** Match a specific field name appearing in the row's `changes[]`. */
  fieldChanged?: string;
  /** Optionally assert severity. */
  severity?: 'normal' | 'high';
}

/**
 * Extract all audit-log rows that have been written via the mocked DDB
 * client. Filters by `entityType === 'AUDIT_LOG'`. Each entry is the raw
 * row object as passed to `putItem(client, row)`.
 */
export function getAuditRows(mockDynamoDBClient: MockedDynamoDBClient): any[] {
  return mockDynamoDBClient.putItem.mock.calls
    .map((call) => call[1])
    .filter((item) => item && item.entityType === 'AUDIT_LOG');
}

/**
 * Assert that EXACTLY ONE audit row matching the given expectation has
 * been written. The use-case is "this single domain operation emitted
 * exactly one audit row of the right shape, not zero and not two."
 *
 * Throws via Jest's `expect` so the failure message localizes to the
 * call-site in the test.
 */
export function expectAuditRow(
  mockDynamoDBClient: MockedDynamoDBClient,
  expected: AuditRowExpectation,
): void {
  const rows = getAuditRows(mockDynamoDBClient);
  const matched = rows.filter((row) => matchesExpectation(row, expected));

  if (matched.length !== 1) {
    const summary = rows.map((r) => ({
      targetEntity: r.targetEntity,
      targetEntityId: r.targetEntityId,
      action: r.action,
      changedBy: r.changedBy,
      fields: r.changes?.map((c: any) => c.field),
    }));
    throw new Error(
      `expectAuditRow: expected exactly 1 audit row matching ` +
        `${JSON.stringify(expected)}, found ${matched.length}. ` +
        `All audit rows written: ${JSON.stringify(summary, null, 2)}`,
    );
  }
}

/**
 * Assert that NO audit rows have been written. Useful for negative tests
 * (e.g., "no-op update does not emit an audit row").
 */
export function expectNoAuditRow(
  mockDynamoDBClient: MockedDynamoDBClient,
): void {
  const rows = getAuditRows(mockDynamoDBClient);
  if (rows.length > 0) {
    throw new Error(
      `expectNoAuditRow: expected 0 audit rows, found ${rows.length}. ` +
        `Rows: ${JSON.stringify(
          rows.map((r) => ({ targetEntity: r.targetEntity, action: r.action })),
          null,
          2,
        )}`,
    );
  }
}

function matchesExpectation(row: any, expected: AuditRowExpectation): boolean {
  if (expected.targetEntity && row.targetEntity !== expected.targetEntity) return false;
  if (expected.targetEntityId && row.targetEntityId !== expected.targetEntityId) return false;
  if (expected.action && row.action !== expected.action) return false;
  if (expected.changedBy && row.changedBy !== expected.changedBy) return false;
  if (expected.severity && row.severity !== expected.severity) return false;
  if (expected.fieldChanged) {
    const found = (row.changes ?? []).some((c: any) => c.field === expected.fieldChanged);
    if (!found) return false;
  }
  return true;
}

/**
 * Base Entity Types for Finance Service
 *
 * DynamoDB Single-Table Design:
 * - Table: edforge-finance-{tier}
 * - PK: tenantId (TENANT#{tid})
 * - SK: entityKey (varies by entity type)
 *
 * GSI1 (School-scoped): GSI1PK=TENANT#{tid}#SCHOOL#{schoolId}, GSI1SK={entityType}#{sortValue}
 * GSI2 (Student-centric): GSI2PK=TENANT#{tid}#STUDENT#{studentId}, GSI2SK={entityType}#{date/reference}
 * GSI3 (Invoice number lookup): GSI3PK=TENANT#{tid}#SCHOOL#{schoolId}, GSI3SK=INVNUM#{invoiceNumber}
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: FinanceEntityType;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export type FinanceEntityType =
  | 'FEE_STRUCTURE'
  | 'BILLING_ACCOUNT'
  | 'BILLING_ACCOUNT_LOOKUP'
  | 'INVOICE'
  | 'PAYMENT'
  | 'PAYMENT_SESSION'
  | 'LEDGER_ENTRY'
  | 'GATEWAY_CONFIG'
  | 'RECEIPT'
  | 'SEQUENCE'
  | 'DISCOUNT_RULE'
  | 'CREDIT_NOTE'
  | 'REFUND_REQUEST'
  // Sprint 0 foundations:
  | 'IDEMPOTENCY_KEY'
  | 'FINANCE_AUDIT_EVENT';

/**
 * Entity key builders for consistent key generation
 */
export const EntityKeyBuilder = {
  feeStructure: (schoolId: string, feeStructureId: string): string =>
    `FEE_STRUCTURE#${schoolId}#${feeStructureId}`,

  billingAccount: (schoolId: string, studentId: string): string =>
    `BILLING_ACCOUNT#${schoolId}#${studentId}`,

  /**
   * Direct-key lookup row for a BillingAccount by its `accountId` UUID.
   * Sprint C2.T3 added this so `getByAccountId` can do a single O(1) GetItem
   * instead of the prior GSI1 + filter scan, AND so `TransactWriteItems`
   * (Sprint C2.T4) can include the account lookup as a transactional pre-condition.
   * Mirror row carries (schoolId, studentId, accountId) — enough to derive the
   * canonical BillingAccount SK (`BILLING_ACCOUNT#<schoolId>#<studentId>`)
   * with one further GetItem if the caller needs the live balance.
   */
  billingAccountLookup: (accountId: string): string =>
    `ACCOUNT#${accountId}`,

  invoice: (schoolId: string, invoiceId: string): string =>
    `INVOICE#${schoolId}#${invoiceId}`,

  payment: (schoolId: string, paymentId: string): string =>
    `PAYMENT#${schoolId}#${paymentId}`,

  ledgerEntry: (accountId: string, entryId: string): string =>
    `LEDGER#${accountId}#${entryId}`,

  gatewayConfig: (schoolId: string, gateway: string): string =>
    `GATEWAY_CONFIG#${schoolId}#${gateway}`,

  receipt: (schoolId: string, receiptNumber: string): string =>
    `RECEIPT#${schoolId}#${receiptNumber}`,

  sequence: (schoolId: string, sequenceType: string): string =>
    `SEQUENCE#${schoolId}#${sequenceType}`,

  /** SESSION mapping for O(1) payment verification by gateway session ID */
  paymentSession: (sessionId: string): string =>
    `SESSION#${sessionId}`,

  discountRule: (schoolId: string, discountRuleId: string): string =>
    `DISCOUNT_RULE#${schoolId}#${discountRuleId}`,

  creditNote: (schoolId: string, creditNoteId: string): string =>
    `CREDIT_NOTE#${schoolId}#${creditNoteId}`,

  refundRequest: (schoolId: string, refundId: string): string =>
    `REFUND#${schoolId}#${refundId}`,

  /**
   * Sprint 0.2 — generic idempotency-key row, scoped to operator + key.
   * Operator-supplied `Idempotency-Key` HTTP header on opt-in POST routes.
   * Row carries the original response so a duplicate submission within the
   * 24h TTL window replays the cached response without re-running the
   * handler. Tenant-scoped (PK = tenantId); per-operator namespacing in
   * the SK keeps two operators' keys from colliding.
   */
  idempotencyKey: (operatorId: string, key: string): string =>
    `IDEMPOTENCY#${operatorId}#${key}`,

  /**
   * Sprint 0.3 — finance bulk-export audit-event row.
   * Append-only PII access trail for compliance review. Time-sorted SK
   * (ISO timestamp + eventId) so `begins_with` scans return chronological
   * order. Read via `GET /finance/audit/bulk-export`.
   */
  financeAuditEvent: (timestamp: string, eventId: string): string =>
    `AUDIT#FINANCE_BULK#${timestamp}#${eventId}`,
};

/**
 * GSI key builders for finance service
 */
export const GSIKeyBuilder = {
  /** GSI1PK: School scope */
  schoolScope: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /** GSI1SK: Entity + sort value */
  entitySort: (entityType: FinanceEntityType, sortValue: string): string =>
    `${entityType}#${sortValue}`,

  /** GSI2PK: Student scope */
  studentScope: (tenantId: string, studentId: string): string =>
    `TENANT#${tenantId}#STUDENT#${studentId}`,

  /** GSI3PK: Same as school scope (reused for secondary lookups) */
  invoiceLookup: (tenantId: string, schoolId: string): string =>
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /** GSI3SK: Invoice number */
  invoiceNumber: (invoiceNumber: string): string =>
    `INVNUM#${invoiceNumber}`,
};

/**
 * Request context for finance operations
 */
export interface RequestContext {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  schoolId?: string;
  jwtToken: string;
  username?: string;
}

/**
 * Build a RequestContext from tenant credentials and request.
 * Shared across all finance controllers.
 */
export function buildRequestContext(
  tenant: { userId: string; tenantId: string; email: string; globalRole: string; username?: string },
  req: { headers: { authorization?: string } },
  schoolId?: string,
): RequestContext {
  return {
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    email: tenant.email,
    role: tenant.globalRole,
    jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
    username: tenant.username,
    schoolId,
  };
}

/**
 * Pagination result
 */
export interface PaginatedResult<T> {
  items: T[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Safely decode a base64-encoded pagination cursor.
 * Returns undefined if the cursor is missing, malformed, or not valid JSON.
 */
export function decodeCursor(cursor?: string): Record<string, any> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString());
  } catch {
    return undefined;
  }
}

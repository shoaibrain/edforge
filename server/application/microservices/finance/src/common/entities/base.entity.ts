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
  | 'FINANCE_AUDIT_EVENT'
  // Sprint D — async bulk-ops job framework:
  | 'FINANCE_JOB';

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

  /**
   * Sprint D.1 — async finance job row (bulk-generate / bulk-pdf-export).
   *
   * Tenant-scoped (PK = tenantId; bare UUID per the codebase convention
   * documented in `edforge_identity_ddb_bare_uuid_partition_key`).
   * SK is jobId-only — direct `GetItem` by jobId is the primary access
   * pattern used by the polling `GET /finance/jobs/:jobId` endpoint.
   *
   * `list(schoolId, ...)` (Sprint D.2) uses a `begins_with(entityKey,
   * 'FINANCE_JOB#')` + `schoolId` FilterExpression — no GSI in V1, matches
   * the IEMIS-import-job precedent. A GSI keyed by (schoolId, createdAt)
   * is the next-scale upgrade and is deliberately deferred.
   */
  financeJob: (jobId: string): string => `FINANCE_JOB#${jobId}`,
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

  /**
   * Sprint A.3 — GSI14PK: school + gradeLevel scope.
   *
   * Pairs with `entitySort('INVOICE'|'PAYMENT', date)` on GSI14SK
   * so a single Query against this PK returns invoices OR payments
   * for the school + grade — narrowed on the read side with
   * `begins_with(gsi14sk, 'INVOICE#')` / `'PAYMENT#'`.
   *
   * Returns `undefined` when `gradeLevel` is falsy. Callers MUST
   * treat that as "do not set gsi14pk/sk on the entity" so the row
   * stays sparse on the index — only rows with a resolved grade
   * snapshot appear in GSI14. The "Unknown" filter bucket
   * (Sprint B.1) is served via a separate post-filter path on the
   * `gradeLevelResolutionStatus` attribute.
   */
  schoolGradeScope: (
    tenantId: string,
    schoolId: string,
    gradeLevel: string | undefined,
  ): string | undefined =>
    gradeLevel
      ? `TENANT#${tenantId}#SCHOOL#${schoolId}#GRADE#${gradeLevel}`
      : undefined,
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
  /**
   * Sprint 0.3 — client IP for the bulk-export audit trail.
   *
   * V1 source: BEST-EFFORT from the upstream proxy chain — leftmost
   * `X-Forwarded-For` entry (RFC 7239 §5.2) with `req.ip` fallback.
   * This IS the spoofable header path; recording it for the pilot
   * audit trail is a deliberate trade against recording nothing.
   *
   * V1.5 hardening: signed `$context.identity.sourceIp` propagated
   * by API Gateway as an integration-set header that the client
   * cannot inject (or a Cognito pre-token-generation Lambda trigger
   * adding the IP to the ID token). Reaching either requires CDK
   * changes that are out of Sprint 0 scope. Tracked in the locked
   * plan at docs/finance-bulk-ops/sprint-plan.md §0.3.
   *
   * Consumers (audit emitters): treat this as a forensic *hint*,
   * not a security boundary. The DDB row + CloudWatch line both
   * record `requestIp` so the V1.5 upgrade is transparent — only
   * the *source* improves; the consumer surface is unchanged.
   */
  requestIp?: string;
  /** Sprint 0.3 — User-Agent header for the bulk-export audit trail. */
  userAgent?: string;
}

/**
 * Build a RequestContext from tenant credentials and request.
 * Shared across all finance controllers.
 *
 * Sprint 0.3 added `requestIp` + `userAgent` extraction so the
 * bulk-export audit trail can record who downloaded the PII. The
 * IP source is best-effort (see RequestContext.requestIp note); a
 * V1.5 hardening should switch to a signed claim/header.
 */
export function buildRequestContext(
  tenant: { userId: string; tenantId: string; email: string; globalRole: string; username?: string },
  req: {
    headers: { authorization?: string; 'user-agent'?: string; 'x-forwarded-for'?: string };
    ip?: string;
  },
  schoolId?: string,
): RequestContext {
  // X-Forwarded-For is a comma-separated chain `client, proxy1, proxy2`;
  // the leftmost entry is the originating client (per RFC 7239 §5.2).
  // Trim whitespace per RFC 9110 §5.6.6.
  const xff = req.headers['x-forwarded-for'];
  const requestIp = xff
    ? xff.split(',')[0].trim()
    : req.ip;

  return {
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    email: tenant.email,
    role: tenant.globalRole,
    jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
    username: tenant.username,
    schoolId,
    requestIp: requestIp || undefined,
    userAgent: req.headers['user-agent'] || undefined,
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

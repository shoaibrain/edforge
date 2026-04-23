/**
 * IEMIS Permission Constants (Sprint 1, S1.6)
 *
 * IEMIS operations are tenant-wide compliance actions governed by
 * `GlobalRole=TenantAdmin` in V1 (MFA enforcement deferred — see
 * Sprint 13 decision). The permission constants below are the
 * canonical names used across:
 *
 *   - Controllers: `@RequireIemisPermission(IemisPermission.Import)`
 *   - Audit events: `metadata.permission = 'iemis:import'`
 *   - UI tab gating: `if (canUse(IemisPermission.Export)) ...`
 *
 * The `resource:action` string form intentionally mirrors the existing
 * [permission-registry](../../../server/application/microservices/identity/src/common/constants/permission-registry.ts)
 * colon format so both namespaces (tenant-wide IEMIS ops + per-school
 * ABAC permissions) look alike to operators reading logs.
 *
 * Platform-operator-only permissions (like `iemis:manage-templates`
 * in Sprint 9+) live in the same enum but get their own
 * `PlatformOperator` role carve-out rather than TenantAdmin grant —
 * see Sprint 13 for the role split.
 */

export const IemisPermission = {
  /** Enqueue an IEMIS xlsx import (Sprint 8 async worker). TenantAdmin. */
  Import: 'iemis:import',
  /** Generate an IEMIS xlsx export (Flash I/II/Staff/Infra/Attendance). TenantAdmin. */
  Export: 'iemis:export',
  /** Call the IEMIS school-code verification endpoint (S1.5). TenantAdmin. */
  VerifyCode: 'iemis:verify-code',
  /** Read the IEMIS audit log (S1.10). TenantAdmin (with redacted fields for others). */
  ViewAudit: 'iemis:view-audit',
  /** Upload and activate CEHRD .xlsm templates (Sprint 9). PlatformOperator-only. */
  ManageTemplates: 'iemis:manage-templates',
} as const;

export type IemisPermission = (typeof IemisPermission)[keyof typeof IemisPermission];

/**
 * All tenant-admin-grantable IEMIS permissions (i.e. everything except
 * the platform-operator-only `ManageTemplates`). V1 seed: grant the
 * entire set to `GlobalRole=TenantAdmin` by default.
 */
export const TENANT_ADMIN_IEMIS_PERMISSIONS: readonly IemisPermission[] = [
  IemisPermission.Import,
  IemisPermission.Export,
  IemisPermission.VerifyCode,
  IemisPermission.ViewAudit,
] as const;

/**
 * Permissions restricted to platform operators (SaaS-level role).
 * TenantAdmins MUST NOT hold these — they control cross-tenant artifacts
 * (CEHRD template uploads, template-version activation windows).
 */
export const PLATFORM_OPERATOR_IEMIS_PERMISSIONS: readonly IemisPermission[] = [
  IemisPermission.ManageTemplates,
] as const;

/**
 * Type guard for a plausible IemisPermission literal. Use in contexts
 * where a string from config or audit metadata needs to be narrowed
 * to a known permission before branching.
 */
export function isIemisPermission(value: unknown): value is IemisPermission {
  if (typeof value !== 'string') return false;
  return Object.values(IemisPermission).includes(value as IemisPermission);
}

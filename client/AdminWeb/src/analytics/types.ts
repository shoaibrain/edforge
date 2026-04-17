/**
 * Re-exports the analytics API contract from @aibrains/shared-types.
 *
 * Block A1 (analytics frontend SDK) imports from here so component code
 * does not have to know the package name. Single source of truth for
 * /analytics/* response shapes — keeps the Lambda handler, AdminWeb,
 * and edforge-saas-frontend (via its bridge package) in lockstep.
 */
export type {
  AdoptionMetricEntry,
  AdoptionMetricKey,
  AdoptionReport,
  AdoptionStatus,
  AnalyticsErrorResponse,
  ExportCsvUrlResponse,
  FleetFeatureCount,
  FleetSummary,
  Granularity,
  MetricSeries,
  MetricSeriesPoint,
  SessionEventType,
  SessionHistoryEvent,
  SessionHistoryResponse,
  TenantTimeSeriesResponse,
} from '@aibrains/shared-types';

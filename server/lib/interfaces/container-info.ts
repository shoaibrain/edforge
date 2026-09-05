import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as cdk from 'aws-cdk-lib';


export interface ContainerInfo {
  name: string
  image: string
  memoryLimitMiB: number
  cpu: number
  containerPort: number
  /** Running tasks for the service; 1 when absent. 0 keeps the service and its definition but runs nothing (cost-redesign C4.4/C5.3). */
  desiredCount?: number
  policy?: string
  database?: {
    kind: string
    sortKey?: string,
    

  },
  portMappings: Array<{
    name: string, 
    containerPort: number
    appProtocol?: ecs.AppProtocol,
    protocol?: ecs.Protocol
  }>,
  environment: {
    TABLE_NAME: string,
    iam_arn?: string,
    resource?: string,
    proxy_endpoint?: string,
    cluster_endpoint_resource?:string
    namespace?: string,
    IAM_ROLE_ARN?: string,
    REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES?: string,
    IDP_DETAILS?: string,
    PDF_ASSETS_BUCKET?: string,  // Sprint C.0.7 — identity-only; deterministic edforge-pdf-assets-{account}-{region}
    REPORTS_STAGING_BUCKET?: string,  // Sprint E.1 — identity-only; deterministic edforge-reports-staging-{account}-{region}
    PDF_TIMING_ENABLED?: string,  // Sprint 0.1 — finance-only; "true" enables per-call stage timings on the pdf_generated audit log. Default "false".
    PDF_OUTPUT_BUCKET?: string,  // Sprint F.1 — finance-only; deterministic edforge-pdfs-{account}-{region} (7d tag-based lifecycle on lifecycle=pdf-jobs).
    BULK_PDF_CONCURRENCY?: string,  // Sprint MVP.2 — finance-only; process-wide singleton p-limit ceiling for F.3 bulk-PDF-export worker. Default "40"; F.3 worker enforces hard max 40 via Math.min(40, parsed). docs/finance-bulk-ops/sprint-plan.md §5d S5.
    FAMILY_GROUPS_ENABLED?: string,  // EPIC-FB FB-0.4 — academics-only; "false" 404s the /academics/**/families routes. Rollback lever for family groups.
    BILLING_AGREEMENTS_ENABLED?: string,  // EPIC-FB FB-0.4 — finance-only; "false" 404s agreement routes AND disables the agreement resolver hook in invoice generation (standard pricing resumes; issued agreement-priced invoices stay valid). Rollback lever per epic risk R6.
  },
  healthCheck?: {
    command: string[],
    interval?: cdk.Duration,
    timeout?: cdk.Duration,
    retries?: number,
    startPeriod?: cdk.Duration
  }
}
/**
 * PdfTemplate types — Sprint C.1.3
 *
 * Per-school per-docType template entity persisted in the identity table.
 * V1 stores ONLY the `CURRENT` pointer row; the `VERSION` row shape is
 * reserved in `EntityKeyBuilder.pdfTemplateVersion` for V1.5 audit/rollback.
 *
 * The `templateConfig` field is the operator-customizable config that the
 * renderer consumes via `descriptor.Component({ data, template, branding,
 * settings })`. Its shape is `PdfTemplateConfig` from `@aibrains/pdf-renderer`,
 * possibly extended per-docType (e.g., `InvoiceTemplateConfig`,
 * `ReceiptTemplateConfig`). We type it as `Record<string, unknown>` here
 * because the persisted shape is doc-type-dependent — narrowing happens at
 * the call site via `descriptor.defaults(...)` typing.
 */

import type { BaseEntity } from '../common/entities/base.entity';
import type { DocType } from '@aibrains/pdf-renderer';

/**
 * The persisted "current template" row for one (school, docType).
 * Sparsely populated until the C.2.x editor lands — until then, **the row
 * does not exist** for any (school, docType) and the lazy-default path
 * returns the descriptor's archetype-aware defaults on every GET.
 */
export interface PdfTemplate extends BaseEntity {
  entityType: 'PDF_TEMPLATE_CURRENT';
  schoolId: string;
  docType: DocType;
  /**
   * Stable id assigned at first save by the editor (NOT used in the key —
   * the key is `…#CURRENT`, deliberately fixed-cardinality at one row per
   * (school, docType)). Used by future VERSION rows to link back to the
   * conceptual template "lineage."
   */
  templateId: string;
  /**
   * The operator-customized config shape. Typed loosely here because the
   * concrete shape is doc-type-dependent (InvoiceTemplateConfig vs
   * ReceiptTemplateConfig). Service layer treats this as an opaque blob;
   * callers cast to the specific shape via descriptor typing.
   */
  templateConfig: Record<string, unknown>;
  /**
   * Monotonically increasing config version. Bumped each time the editor
   * persists a save; the prior config is snapshotted to a VERSION row.
   * Defaults to 1 at first save. Not the same as the BaseEntity `version`
   * — that one counts DDB UpdateItem revisions.
   */
  configVersion: number;
}

/**
 * GET /schools/:schoolId/pdf-templates/:docType/current response.
 *
 * - `source: 'persisted'` → the operator has previously saved a custom
 *   template; `templateConfig` is the persisted value.
 * - `source: 'default'`   → no persisted row exists; `templateConfig` is
 *   the descriptor's archetype-aware default computed at request time.
 *
 * The `source` discriminator lets render endpoints log whether they're
 * using a persisted vs default template — useful for ops debugging
 * "why does this school's PDF look different than another's" without
 * exposing internal storage details.
 */
export interface PdfTemplateCurrentResponse {
  docType: DocType;
  templateConfig: Record<string, unknown>;
  source: 'persisted' | 'default';
  /**
   * Present only when `source === 'persisted'`. Stable identifier for the
   * concrete template; useful as a freezable reference on rendered PDFs
   * (mirrors the `brandingVersionId` field on rendered branding).
   */
  templateId?: string;
  /**
   * Present only when `source === 'persisted'`. Editor-save version.
   */
  configVersion?: number;
}

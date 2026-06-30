/**
 * BULK_EXPORT_CAPS — Sprint §5d MVP.4
 *
 * Hard workload caps on bulk-operation request payloads. Enforced at
 * the controller boundary via `PayloadTooLargeException` (413).
 * Single source-of-truth so the locked plan + frontend + backend stay
 * in lockstep.
 *
 * Locked plan §5d S8 reasoning:
 *   - `zip` (2000)         — peak memory ceiling at 256 MB RSS holds.
 *   - `merged_pdf` (1000)  — pdf-lib (Sprint H.3) holds the full
 *                             output in memory before upload; tighter cap.
 *   - `bulk_generate` (5000) — DDB write throughput + per-student
 *                             render p95 keep the worst-case wall <60min.
 *
 * If the per-cap budget changes, change ONLY this file. The frontend
 * (Sprint F.5+) reads the same caps via shared-types so the wizard's
 * "Preview" step can client-side warn before submit.
 */

export const BULK_EXPORT_CAPS = {
  /** Sprint F.4 — bulk ZIP-of-PDFs invoice export. */
  zip: 2000,
  /** Sprint H.3 — bulk merged-PDF invoice export (lower because pdf-lib holds output in memory). */
  merged_pdf: 1000,
  /** Sprint E.3 — bulk-invoice-generate cap (resolved studentIds). */
  bulk_generate: 5000,
} as const;

export type BulkExportFormat = keyof typeof BULK_EXPORT_CAPS;

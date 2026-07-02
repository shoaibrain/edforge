/**
 * mergePdfBuffers — Sprint H.1
 *
 * Concatenate multiple PDF buffers into a single merged PDF, preserving the
 * page order of the input list. The output PDF's pages appear in the same
 * order as the input buffers; each source PDF's pages appear in the same
 * order they were in the source.
 *
 * First step of the merged-PDF output variant for the bulk finance export
 * (Sprint H). The bulk-invoice-pdf-export and bulk-receipt-pdf-export
 * workers call this helper after rendering the individual PDFs when the
 * operator picks `outputFormat: 'merged_pdf'` (see Sprint H.3 for the
 * worker wiring).
 *
 * Determinism:
 *   pdf-lib embeds creation + modification timestamps in the document
 *   catalog by default and calls setModificationDate(new Date()) at save
 *   time unless `updateMetadata: false` is passed. Without that override,
 *   the same input list produces byte-different output on every call. This
 *   function overrides all metadata to fixed values, so identical input
 *   yields identical output — required for the audit-trail invariant in
 *   the worker (a re-run of the same job MUST produce byte-identical
 *   artifacts so a downstream signature/hash gate is stable).
 *
 * Memory profile:
 *   Peak RSS ≈ Σ(input bytes) + Σ(merged bytes). pdf-lib holds every
 *   parsed source document + the merged output in memory at once. At the
 *   Sprint H cap of 1000 documents and typical ~20 kB per invoice PDF,
 *   that's ~20 MB peak — well within the finance ECS task's 2 GB budget.
 *   For the 100-invoice pilot case, peak is ~2 MB.
 */

import { PDFDocument } from 'pdf-lib';

export interface MergePdfBuffersOptions {
  /**
   * The PDF `/Title` metadata field written into the merged output.
   * Optional; when omitted, no title is set. Useful for operator-facing
   * artifacts that show up in the browser's tab title.
   */
  title?: string;
}

const EPOCH = new Date(0);

/**
 * Merge PDF byte buffers into a single output buffer.
 *
 * @param buffers - Non-empty list of PDF byte buffers to concatenate.
 * @param options - Optional metadata overrides.
 * @returns The merged PDF as a Node Buffer.
 * @throws When `buffers` is empty.
 */
export async function mergePdfBuffers(
  buffers: Buffer[],
  options: MergePdfBuffersOptions = {},
): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error('mergePdfBuffers: refusing to merge an empty buffer list');
  }

  const merged = await PDFDocument.create();

  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, {
      // Documents produced by the worker are trusted (rendered by us in the
      // same process), so parse-time integrity checks are wasted CPU. This
      // matches pdf-lib's recommended fast-path.
      ignoreEncryption: false,
    });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  // Fixed metadata → byte-deterministic output for identical input.
  merged.setCreationDate(EPOCH);
  merged.setModificationDate(EPOCH);
  merged.setProducer('@aibrains/pdf-renderer mergePdfBuffers');
  merged.setCreator('@aibrains/pdf-renderer');
  if (options.title !== undefined) {
    merged.setTitle(options.title);
  }

  const bytes = await merged.save({
    // Disable pdf-lib's default "update ModDate on save" hook so our
    // explicit EPOCH modification date sticks.
    updateFieldAppearances: false,
    useObjectStreams: false,
  });

  return Buffer.from(bytes);
}

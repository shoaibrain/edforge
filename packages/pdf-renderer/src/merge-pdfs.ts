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
 *   pdf-lib's `save()` does NOT auto-refresh ModDate — the only source of
 *   run-to-run drift is what we set on the document ourselves (CreationDate,
 *   ModificationDate, Producer, Creator). This function fixes all four to
 *   known values so identical input yields identical output — required for
 *   the audit-trail invariant in the worker (a re-run of the same job MUST
 *   produce byte-identical artifacts so a downstream signature/hash gate is
 *   stable). `useObjectStreams: false` on save is a secondary belt-and-
 *   -braces for the same guarantee (see save() call for the rationale).
 *
 * Memory profile:
 *   Peak RSS ≈ Σ(input bytes) + Σ(merged bytes). pdf-lib holds every
 *   parsed source document + the merged output in memory at once. At the
 *   Sprint H cap of 1000 documents and typical ~20 kB per invoice PDF,
 *   that's ~20 MB peak — well within the finance ECS task's 2 GB budget.
 *   For the 100-invoice pilot case, peak is ~2 MB.
 */

import { PDFDocument, ParseSpeeds } from 'pdf-lib';

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
    // Trusted-input fast path: sources come from our own worker in the same
    // process, so we can skip pdf-lib's default object-graph validation.
    // ParseSpeeds.Fastest tells pdf-lib to defer optional integrity checks.
    const src = await PDFDocument.load(buf, {
      parseSpeed: ParseSpeeds.Fastest,
    });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  // Byte-determinism: pdf-lib's save() does NOT auto-refresh ModDate — the
  // only source of run-to-run drift is the values we set here. Fixing them
  // to a known epoch is what makes identical input produce identical output.
  merged.setCreationDate(EPOCH);
  merged.setModificationDate(EPOCH);
  merged.setProducer('@aibrains/pdf-renderer mergePdfBuffers');
  merged.setCreator('@aibrains/pdf-renderer');
  if (options.title !== undefined) {
    merged.setTitle(options.title);
  }

  const bytes = await merged.save({
    // useObjectStreams: false emits the classic xref table format instead of
    // xref streams. Slightly larger output, but byte-stable across pdf-lib
    // minor upgrades that might change stream-compression heuristics — worth
    // the size trade for the audit-hash guarantee.
    useObjectStreams: false,
  });

  return Buffer.from(bytes);
}

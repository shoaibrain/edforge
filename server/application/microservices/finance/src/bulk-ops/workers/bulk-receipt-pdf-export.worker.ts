/**
 * BulkReceiptPdfExportWorker — Sprint G.2
 *
 * First worker registered for the bulk PDF-export flow. Drives a single
 * `bulk_receipt_pdf_export` job from queued → succeeded/failed:
 *
 *   1. Acquire per-school lock (E.4 PerSchoolLock — in-task scope per
 *      §5d S3 / MVP single-task posture). `MVP.5` sentinel on the
 *      FinanceJob row already prevents cross-task double-submit at the
 *      controller layer; this lock additionally serializes same-school
 *      jobs within the task.
 *   2. markRunning + emit `finance.bulk_export.started` (auto-routed by
 *      `FinanceJobsService.emitAudit` via the jobType prefix mapper).
 *   3. ONE-TIME branding + template fetch (the F.3 plan's latency
 *      optimization — branding/template fetched once per job, reused
 *      across N invoices instead of N times).
 *   4. Per-payment loop under the process-wide `PdfRenderConcurrencyBucket`
 *      (MVP.5 S5, shared with the invoice worker — one bucket per task
 *      caps TOTAL PDF renders across both flavors of bulk export). Each
 *      payment → load Payment + parent Invoice + optional studentInfo →
 *      eligibility filter (only status='completed' payments have
 *      receipts) → render → archive.append. Non-completed payments are
 *      recorded as `counters.skipped` (not failed — they're not eligible,
 *      not broken). Real render failures use `appendFailedInvoice` — the
 *      helper name is a legacy of Sprint F.3 but the underlying capped
 *      failedPaymentIds[] array carries the failed paymentIds here.
 *   5. Finalize the archiver stream, await the S3 multipart upload
 *      (started before the loop — archiver pipes into S3 directly).
 *   6. Mint presigned GET URL via `S3Service.presignGet` (15-min TTL).
 *   7. markCompleted with `output.zipKey` + `output.zipUrl` +
 *      `output.urlExpiresAt` — auto-emits `finance.bulk_export.succeeded`.
 *   8. Emit `finance.bulk_export.url_minted` directly (the only audit
 *      event F.3 emits itself; lifecycle events come via the service).
 *      Payload carries `presignedKeyHash = SHA256(zipKey)` per §0.3,
 *      never the URL itself.
 *
 * Catastrophe handling (any throw outside the per-invoice try/catch):
 *   - Catch + markFailed + emit `finance.bulk_export.failed` (auto-routed).
 *   - markFailed best-effort cleans up the MVP.5 active-export sentinel.
 *   - NEVER let the throw propagate to the caller — the controller
 *     (F.4, future) returned 202 already; the operator's only signal is
 *     the FinanceJob row.
 *
 * archiver safety note: archiver `.append(buf, opts)` is SYNCHRONOUS
 * (no await) — it enqueues the entry into archiver's internal stream
 * pump, which serializes ZIP encoding by virtue of the single-threaded
 * JS event loop. Multiple async functions calling `.append()` cannot
 * interleave because each append is a synchronous block. Concurrent
 * RENDER is safe (CPU-bound work in parallel); concurrent APPEND is
 * also safe because the append call itself is sync and the queue is
 * processed sequentially by the stream pump.
 *
 * Memory profile (target: peak RSS < 256 MB per §F.3 acceptance):
 *   - N concurrent in-flight render buffers (~20-40KB each × 40 = ~1.6MB)
 *   - archiver internal stream queue (~few MB)
 *   - lib-storage multipart upload buffer (default partSize 5 MB)
 *   - ECS V8 baseline ~150 MB
 *   - Total: ~160-180 MB realistic peak, with headroom
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
// archiver@7 is a CJS module exporting `module.exports = archiver` (a callable
// function). The default-import syntax (`import archiver from 'archiver'`) emits
// `archiver_1.default(...)` at the call site, but no `.default` property exists
// at runtime — `archiver_1.default` is `undefined` and the worker crashes with
// `(0 , archiver_1.default) is not a function` on the first archiver() call.
// Root cause: server/application/tsconfig.json has `allowSyntheticDefaultImports:true`
// (type-check accepts the syntax) but is missing `esModuleInterop:true` (which
// would inject the `__importDefault` runtime helper).
// `import X = require()` is the TypeScript-canonical way to import a CJS module's
// whole-module-as-default while preserving full types — emits a bare `require()`
// at runtime, which is what archiver actually exports. See PR #359 / E2E test
// against dev-pabson-primary 2026-06-30 where both export jobs failed 1s after dispatch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import archiver = require('archiver');
// Same CJS interop pattern as archiver above: sharp exports a callable
// via `module.exports = sharp`, so `import sharp from 'sharp'` would
// compile to `sharp_1.default` (undefined) without esModuleInterop:true.
// See PR #362 for the class of bug that motivates this syntax.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import { FinanceJobsService } from '../finance-jobs.service';
import { FinanceAuditService } from '../../common/services/finance-audit.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { IdentityClientService } from '../../common/services/identity-client.service';
import { S3Service } from '../../common/services/s3.service';
import { FinanceMetricsService } from '../../common/services/finance-metrics.service';
import { PerSchoolLock, SchoolLockHandle } from '../util/per-school-lock';
import {
  PdfRenderConcurrencyBucket,
  PdfRenderSlotHandle,
} from '../util/pdf-render-concurrency-bucket';
import { withConcurrencyLimit } from '../util/concurrency-limit';
import {
  prewarmInvoiceRenderer,
} from '../../invoices/invoice-pdf.renderer';
import { renderReceiptToPdfBuffer } from '../../payments/receipt-pdf.renderer';
import { PassThrough } from 'stream';
import type { ReceiptTemplateConfig } from '@aibrains/pdf-renderer';
import { mergePdfBuffers } from '@aibrains/pdf-renderer';
import type { RequestContext } from '../../common/entities/base.entity';
import type { PaymentEntity } from '../../common/entities/payment.entity';
import { EntityKeyBuilder } from '../../common/entities/base.entity';
import { DynamoDBClientService } from '../../common/services/dynamodb-client.service';

/**
 * Mirror of the locale-resolution helper in invoices.service.ts:40.
 * Templates with `labelLanguages: ['ne', ...]` resolve to ne-NP;
 * everything else to en-US. Kept inline to avoid coupling the worker
 * to invoices.service.ts internals.
 */
function resolvePrimaryLocale(labelLanguages: unknown): string {
  if (!Array.isArray(labelLanguages) || labelLanguages.length === 0) {
    return 'en-US';
  }
  return labelLanguages[0] === 'ne' ? 'ne-NP' : 'en-US';
}

const METRICS_NAMESPACE = 'Edforge/Finance/BulkPdfExport';
const PRESIGN_TTL_SEC = 900; // 15 min — matches F.2 S3Service default; locked plan §F.2
const ZIP_COMPRESSION_LEVEL = 6; // moderate (zlib default); CPU vs size trade-off
const COUNTER_BATCH_SIZE = 25; // mirrors E.4 worker

/**
 * P1 fix (issue #365) — logo optimization constants.
 *
 * Operator-uploaded school logos land in S3 at their original resolution.
 * Byte-forensic analysis of a live-prod bulk-export invoice PDF on
 * 2026-06-30 (dev-pabson-primary) showed one raster (2000×2000 RGB
 * FlateDecode XObject) at 1.73 MB = 97.8% of the entire PDF's 1.77 MB.
 * The CSS says width:64 height:64 (display units on the page) but PDF
 * viewers scale down at display time — the byte buffer is unchanged.
 *
 * Fix: fetch the logo ONCE per job, resize to LOGO_MAX_EDGE_PX, encode
 * as JPEG with mozjpeg at Q=85, hand a `{data, format:'jpg'}` Buffer to
 * the renderer via the react-pdf SourceDataBuffer shape (native,
 * zero-copy — no data-URI encoding overhead).
 *
 * Expected reduction: 1.73 MB image → ~15-30 KB. PDF total: 1.77 MB →
 * ~200 KB (~9x). 20-invoice ZIP: 35 MB → ~4 MB.
 */
const LOGO_MAX_EDGE_PX = 512;
const LOGO_JPEG_QUALITY = 85;
const LOGO_FETCH_TIMEOUT_MS = 10_000;

/**
 * P2 fix (issue #364) — per-invoice event-loop yield.
 *
 * Node's JS event loop is single-threaded; a batch of concurrent CPU-
 * bound renders can starve incoming HTTP/DDB/S3 callbacks past the API
 * GW 29s integration timeout — which is exactly what produced the 504
 * on a second bulk-export submission during E2E 2026-06-30.
 *
 * Fix: yield to libuv after each invoice's `archive.append` so
 * HTTP handlers + DDB callbacks + S3 multipart progress get a tick
 * between renders. `setImmediate` schedules on the check-phase queue
 * so it runs after any pending I/O callbacks — the right yield primitive
 * for this pattern (queueMicrotask would defeat the purpose).
 */
async function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// NOTE — the worker hard-deadline (locked plan §F.3 acceptance) is NOT
// implemented here. The first hotfix attempt wrapped the per-invoice
// loop in Promise.race against a setTimeout, but Promise.race does NOT
// cancel the loser — withConcurrencyLimit's in-flight workers would
// keep running their per-invoice loops after the race rejected, each
// holding a PdfRenderConcurrencyBucket slot. If a renderer truly hangs
// (the exact case the deadline was meant to catch), the slot is leaked
// permanently → one pathological export bricks the process-wide bucket
// for the entire ECS task = in-task DoS. Reviewer caught this on PR #362
// before merge.
//
// Proper implementation requires an abort/cancellation contract:
//   - PdfRenderConcurrencyBucket.acquire(signal: AbortSignal) — throws
//     AbortError on signal, releasing nothing (slot was never granted)
//     OR if already granted, signals the holder to release-and-throw.
//   - withConcurrencyLimit threads signal through to the per-item fn.
//   - The per-invoice render itself wraps renderInvoiceToPdfBuffer in
//     Promise.race(render, signal) so a hung pdfkit render rejects on
//     abort instead of pinning the slot.
//   - The deadline fires by calling controller.abort() instead of
//     throwing — all in-flight work rejects → finally blocks release
//     slots cleanly → outer catastrophe runs markFailed.
//
// Until that lands, recovery for a wedged worker is:
//   1. ECS task replacement (deploy / OOM / scale-in) ends the process.
//   2. StaleFinanceJobSweeper.onApplicationBootstrap on the NEXT task
//      start marks rows older than 120 min as `failed` + clears the
//      MVP.5 sentinel.
// Tracked as P1 follow-up; deferred from this hotfix per reviewer P1.

export interface BulkReceiptPdfExportWorkerInput {
  schoolId: string;
  /** Resolved by G.3 controller (operator-supplied paymentIds; eligibility filtered inside the worker). */
  paymentIds: string[];
  /**
   * Sprint H.3 — output variant. Same contract as the invoice worker's `format`:
   *   'zip'        preserves the G.2 archiver → S3 stream pipeline.
   *   'merged_pdf' collects rendered receipt buffers and concatenates them
   *                via @aibrains/pdf-renderer's mergePdfBuffers (pdf-lib),
   *                then uploads the merged PDF via S3Service.putPdf.
   * Cap enforcement (2000 zip / 1000 merged_pdf) is in the controller.
   */
  format: 'zip' | 'merged_pdf';
}

@Injectable()
export class BulkReceiptPdfExportWorker {
  private readonly logger = new Logger(BulkReceiptPdfExportWorker.name);

  constructor(
    private readonly jobsService: FinanceJobsService,
    private readonly auditService: FinanceAuditService,
    private readonly invoicesService: InvoicesService,
    private readonly identityClient: IdentityClientService,
    private readonly s3Service: S3Service,
    private readonly perSchoolLock: PerSchoolLock,
    private readonly bucket: PdfRenderConcurrencyBucket,
    /** Direct DDB access for per-payment PaymentEntity lookups.
     * The receipt worker (unlike the invoice worker) needs to load the
     * Payment row itself in the per-item loop (invoice worker only needs
     * getEntity from InvoicesService). Kept as a direct ctor dep so the
     * spec can mock this narrowly without touching invoicesService. */
    private readonly dynamoDBClient: DynamoDBClientService,
    /** Optional for spec ergonomics; Nest DI always supplies it at runtime. */
    private readonly metrics?: FinanceMetricsService,
  ) {}

  async run(
    jobId: string,
    input: BulkReceiptPdfExportWorkerInput,
    context: RequestContext,
  ): Promise<void> {
    let lockHandle: SchoolLockHandle | undefined;
    const tStart = Date.now();
    const isMerged = input.format === 'merged_pdf';
    // Sprint H.3 — format-aware output key. Merged variant: receipts-merged.pdf.
    const outputKey = isMerged
      ? this.buildMergedPdfKey(context.tenantId, input.schoolId, jobId)
      : this.buildZipKey(context.tenantId, input.schoolId, jobId);
    // Zip-only. PR #359 P1 fix-up — hoist the S3 upload promise out of the try
    // block so the catastrophe catch + finally can drain it. Defaults
    // to null until the upload is actually started inside the try.
    let safeS3UploadPromise: Promise<void> | null = null;
    // Zip-only. Hotfix (archiver CJS fix) — hoist `archive` so the catastrophe
    // catch can call abort(). Without abort(), lib-storage's Upload
    // would wait indefinitely for 'end' on a stream that won't arrive.
    // Typed `any` to avoid pulling archiver namespace types through the
    // `import = require()` boundary; archive.abort/append/finalize are
    // covered by the unit + runtime-contract specs.
    let archive: any;
    // Sprint H.3 — merged-PDF collector. See invoice worker for the ordering
    // rationale: Map<paymentId, Buffer>, then walk input.paymentIds in
    // operator-requested order at finalize time.
    const mergedBufferMap: Map<string, Buffer> = new Map();

    try {
      lockHandle = await this.perSchoolLock.acquire(input.schoolId);
      await this.jobsService.markRunning(jobId, context);

      // Sprint F.7 — pre-warm @react-pdf/layout's yoga singleton before
      // the parallel render loop. yoga's loadYoga has a module-level race
      // (see prewarmInvoiceRenderer JSDoc): concurrent first-time callers
      // each overwrite the singleton, and every render except the first
      // winner fails with "Expected null or instance of Config, got an
      // instance of Config". Pre-warming with a serial trivial render
      // ensures the singleton is populated before the parallel loop
      // contends. The promise is memoized at module scope; subsequent
      // worker invocations return immediately (no-op).
      await this.timeStage(
        'YogaPrewarmLatencyMs',
        { schoolId: input.schoolId, jobId },
        () => prewarmInvoiceRenderer(),
      );

      // ─── One-time fetches (the F.3 latency optimization) ─────────
      // Template comes from identity as `Record<string, unknown>` over the
      // wire; cast at the boundary (same shape contract as invoices.service.ts:639-643).
      const templateResponse = await this.timeStage(
        'TemplateFetchLatencyMs',
        { schoolId: input.schoolId, jobId },
        () => this.identityClient.getCurrentTemplate(input.schoolId, 'RECEIPT', context),
      );
      const templateConfig = templateResponse.templateConfig as unknown as ReceiptTemplateConfig;
      const brandingResp = await this.timeStage(
        'BrandingFetchLatencyMs',
        { schoolId: input.schoolId, jobId },
        async () => {
          try {
            return await this.identityClient.getBranding(input.schoolId, context);
          } catch (err) {
            this.logger.warn(
              `Branding fetch failed (degraded — null branding fallback) ` +
                `schoolId=${input.schoolId}: ${(err as Error).message}`,
            );
            return { branding: null, urls: undefined };
          }
        },
      );
      // Locale resolved from template's labelLanguages (mirror of
      // invoices.service.ts:654). 'ne' first → ne-NP; else en-US.
      const locale = resolvePrimaryLocale(templateConfig.labelLanguages);

      // P1 (issue #365) — resize the school logo ONCE per job before
      // the parallel render loop. See LOGO_MAX_EDGE_PX comment for the
      // 2000×2000-image PDF-bloat root cause. Result is a base64 data
      // URI substituted into `brandingResp.urls.logo`, so the renderer's
      // <Image src={logoUrl}> code path is unchanged (data URIs are a
      // valid react-pdf ImageSource).
      //
      // Bonus: eliminates 800 downstream HTTPS fetches of the same S3
      // presigned URL (once per invoice) in the parallel loop — the
      // optimized bytes are already in-process.
      //
      // Fail-open: if the fetch or Sharp step throws, `optimizeLogoForPdf`
      // returns the original URL string. The export still produces
      // (correct but bloated) PDFs — the fix should never take the
      // export from working-but-bloated to broken.
      const optimizedLogoSrc = brandingResp.urls?.logo
        ? await this.timeStage(
            'LogoOptimizeLatencyMs',
            { schoolId: input.schoolId, jobId },
            () => this.optimizeLogoForPdf(brandingResp.urls!.logo!),
          )
        : undefined;
      const brandingWithOptimizedLogo = {
        branding: brandingResp.branding,
        urls: brandingResp.urls
          ? { ...brandingResp.urls, logo: optimizedLogoSrc }
          : undefined,
      };

      // ─── Set up the archiver → S3 stream pipeline (ZIP only) ─────
      // archiver IS a Readable stream; lib-storage Upload accepts it directly.
      // The upload promise is created BEFORE the loop so chunks flow to S3
      // as appends happen, not after all appends complete.
      // Merged-PDF path skips this section entirely — it collects buffers
      // in memory and produces the output post-loop in the finalize step.
      const archiverErrors: Error[] = [];
      let s3UploadError: Error | null = null;
      if (!isMerged) {
      archive = archiver('zip', { zlib: { level: ZIP_COMPRESSION_LEVEL } });
      archive.on('error', (err: Error) => archiverErrors.push(err));
      // Defensive: 'warning' for ENOENT or similar archive-internal events.
      archive.on('warning', (err: any) => {
        if (err.code !== 'ENOENT') archiverErrors.push(err);
      });

      // Sprint F.7 — bridge `archive` (an archiver instance, which
      // extends `readable-stream`'s Readable — a USERSPACE polyfill, not
      // Node's built-in stream module) into a Node-native PassThrough
      // before handing it to lib-storage's Upload. AWS SDK v3's
      // lib-storage `Upload` rejects any Body that fails
      // `instanceof stream.Readable` against the BUILT-IN stream module
      // with: "Body Data is unsupported format, expected data to be one
      // of: string | Uint8Array | Buffer | Readable | ReadableStream |
      // Blob;.". archiver@7's Readable (from readable-stream@4) has the
      // same constructor name as Node's but different module identity,
      // so the SDK's instanceof check fails.
      //
      // PassThrough extends Transform extends Duplex extends Readable
      // (all from `stream`, the BUILT-IN), so `passthrough instanceof
      // stream.Readable === true`. The archive pipes its bytes into
      // PassThrough; PassThrough flows them into lib-storage's
      // multipart Upload. No buffering beyond the default high-water
      // mark; no memory overhead beyond what was already in the pipe.
      //
      // Why not change archiver: archiver IS the canonical streaming
      // ZIP library; readable-stream is a deeply embedded transitive
      // dep. Trying to align archiver's stream identity with Node's
      // is a transitive-dep rewrite that the AWS SDK community has
      // documented this PassThrough pattern as the standard remediation
      // for.
      //
      // Discovered in dev-pabson-primary E2E 2026-06-30 after the F.3
      // archiver-CJS hotfix #362 unmasked the bug. See PR description.
      const s3BodyStream = new PassThrough();
      archive.pipe(s3BodyStream);

      // PR #359 P1 fix-up — attach a catch handler IMMEDIATELY to
      // prevent unhandled-rejection process noise. The promise is
      // awaited explicitly on the happy path (S3UploadLatencyMs
      // timeStage), and on early-return paths (all-failed,
      // catastrophe) we await `safeS3UploadPromise` which always
      // settles. The captured error is rethrown by the happy-path
      // await so the outer catastrophe handler can call markFailed.
      //
      // Without this, an archive.abort() on the all-failed path
      // rejects the underlying lib-storage Upload AFTER the worker
      // has returned → "Possible unhandled rejection" process noise
      // in exactly the failure case the worker is supposed to contain.
      const s3UploadPromise = this.s3Service.putZip(
        context.tenantId,
        context.jwtToken,
        outputKey,
        s3BodyStream,
      );
      safeS3UploadPromise = s3UploadPromise.catch((err: Error) => {
        s3UploadError = err;
        // resolve to null so awaiters never see a rejection
        return null as unknown as void;
      });
      } // end of `if (!isMerged)` — zip-only archiver setup

      // ─── Per-payment loop ────────────────────────────────────────
      let succeeded = 0;
      let skipped = 0;
      let succeededSinceFlush = 0;
      let skippedSinceFlush = 0;
      const failedPaymentIds: string[] = [];
      const limit = this.bucket.getLimit();

      const client = await this.dynamoDBClient.getClient(
        context.tenantId,
        context.jwtToken,
      );

      await withConcurrencyLimit(
        input.paymentIds,
        limit,
        async (paymentId) => {
          let slot: PdfRenderSlotHandle | undefined;
          try {
            slot = await this.bucket.acquire();
            await this.timeStage(
              'PerPaymentLatencyMs',
              { schoolId: input.schoolId, jobId },
              async () => {
                // 1) Payment lookup
                const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
                  client,
                  context.tenantId,
                  EntityKeyBuilder.payment(input.schoolId, paymentId),
                );
                if (!payment) {
                  throw new Error(`Payment ${paymentId} not found`);
                }
                // 2) Eligibility — only completed payments have receipts.
                // Mirror of getReceiptPdf's guard in payments.service.ts:776.
                // Skipped ≠ failed: the payment isn't broken, just not
                // in a state where a receipt PDF makes sense (voided /
                // refunded / pending / etc). Counted separately so the
                // operator sees a clear "X eligible, Y skipped" summary.
                if (payment.status !== 'completed') {
                  skipped++;
                  skippedSinceFlush++;
                  return;
                }
                // 3) Parent invoice lookup — the receipt renderer needs
                // the invoice's line items + student metadata (see
                // receipt-pdf.renderer.ts:170-200 for the exact fields).
                const invoice = await this.invoicesService.getEntity(
                  input.schoolId,
                  payment.invoiceId,
                  context,
                );
                // 4) Render.
                const pdfBuffer = await renderReceiptToPdfBuffer({
                  payment,
                  invoice,
                  branding: brandingWithOptimizedLogo.branding,
                  urls: brandingWithOptimizedLogo.urls,
                  templateConfig,
                  locale,
                });
                if (isMerged) {
                  // Sprint H.3 — merged-PDF path: stash the buffer keyed by
                  // paymentId. Post-loop we walk input.paymentIds and pull
                  // succeeded entries in order. Failed / ineligible payments
                  // are never inserted so they filter out naturally.
                  mergedBufferMap.set(paymentId, pdfBuffer);
                } else {
                  // archiver.append is SYNCHRONOUS — see file-header note on
                  // archiver safety. The filename uses receiptNumber (with
                  // paymentId-prefix fallback for very old rows that never
                  // got a receipt number assigned).
                  const filename = payment.receiptNumber
                    ? `${payment.receiptNumber}.pdf`
                    : `RCP-${payment.paymentId.substring(0, 8)}.pdf`;
                  archive.append(pdfBuffer, { name: filename });
                }
                succeeded++;
                succeededSinceFlush++;
                // P2 (issue #364) — yield to libuv after every render so
                // HTTP handlers, DDB TransactWrite callbacks (MVP.5
                // sentinel check on incoming submissions), and S3 multipart
                // progress can run between CPU-bound renders.
                await yieldToEventLoop();
              },
            );
            // Batched counter flush — mirror of F.3 worker's pattern.
            // Flushes BOTH succeeded and skipped counters when either
            // exceeds threshold; keeps the operator's live view snappy.
            if (succeededSinceFlush >= COUNTER_BATCH_SIZE) {
              const toFlush = succeededSinceFlush;
              succeededSinceFlush = 0;
              await this.jobsService
                .incrementCounter(jobId, 'succeeded', toFlush, context)
                .catch((err) =>
                  this.logger.warn(
                    `incrementCounter(succeeded, ${toFlush}) failed (continuing): ${err.message}`,
                  ),
                );
            }
            if (skippedSinceFlush >= COUNTER_BATCH_SIZE) {
              const toFlush = skippedSinceFlush;
              skippedSinceFlush = 0;
              await this.jobsService
                .incrementCounter(jobId, 'skipped', toFlush, context)
                .catch((err) =>
                  this.logger.warn(
                    `incrementCounter(skipped, ${toFlush}) failed (continuing): ${err.message}`,
                  ),
                );
            }
          } catch (err) {
            // Per-payment failure: record + continue. NEVER let one bad
            // payment abort the rest of the ZIP. The bad PDF is NOT in
            // the archive (we never called append for it).
            failedPaymentIds.push(paymentId);
            const msg = (err as Error).message ?? String(err);
            try {
              // Reuses the invoice worker's `appendFailedInvoice` helper —
              // the helper name is a legacy of F.3 but underneath it just
              // records a string ID into the `failedPaymentIds` capped
              // array on the FinanceJob entity. For a receipt job this
              // array carries paymentIds. Kept as-is to avoid a schema
              // divergence between receipt and invoice job rows.
              await this.jobsService.appendFailedInvoice(
                jobId,
                paymentId,
                msg.slice(0, 500),
                context,
              );
            } catch (appendErr) {
              this.logger.error(
                `appendFailedInvoice (paymentId=${paymentId}) itself failed: ` +
                  `${(appendErr as Error).message}. ` +
                  `Original error: ${msg}`,
              );
            }
          } finally {
            slot?.release();
          }
        },
      );

      // Final counter flush for the trailing partial batches (both
      // succeeded and skipped may have partial trailing counts).
      if (succeededSinceFlush > 0) {
        await this.jobsService
          .incrementCounter(jobId, 'succeeded', succeededSinceFlush, context)
          .catch((err) =>
            this.logger.warn(
              `final incrementCounter(succeeded, ${succeededSinceFlush}) failed (continuing): ${err.message}`,
            ),
          );
      }
      if (skippedSinceFlush > 0) {
        await this.jobsService
          .incrementCounter(jobId, 'skipped', skippedSinceFlush, context)
          .catch((err) =>
            this.logger.warn(
              `final incrementCounter(skipped, ${skippedSinceFlush}) failed (continuing): ${err.message}`,
            ),
          );
      }

      // ─── Failure mode: all-failed ────────────────────────────────
      // Per locked plan §F.3 acceptance: when succeeded === 0 and any
      // payments failed render, terminate as `failed` (not succeeded
      // with an empty ZIP). Operator gets clearer feedback.
      //
      // Skipped-only case (succeeded=0, failed=0, skipped>0) — every
      // payment was ineligible (not `completed`). That's not a failure;
      // it's a data-quality outcome. Ship the (empty) ZIP with the
      // succeeded/skipped counters and let the operator see "0 succeeded,
      // N skipped" via the drawer summary. The receipt-export drawer's
      // AsyncJobProgress renders this cleanly without any special case.
      if (succeeded === 0 && failedPaymentIds.length > 0) {
        // Merged-PDF path: nothing to abort, no in-flight S3 upload to drain.
        // Zip path: PR #359 P1 fix-up — drain the S3 upload promise BEFORE
        // returning. archive.abort() rejects the lib-storage Upload;
        // without awaiting safeS3UploadPromise here, that rejection
        // would surface AFTER the worker returns → "Possible unhandled
        // rejection" process noise. The safe-wrapper guarantees this
        // await never throws.
        if (!isMerged) {
          try {
            archive.abort();
          } catch {
            // archiver may already be in a finalize state; safe to ignore.
          }
          await safeS3UploadPromise;
        }
        const reason = `All ${failedPaymentIds.length} payments failed render`;
        await this.jobsService.markFailed(jobId, reason, context);
        this.emitJobTotal(jobId, input.schoolId, tStart);
        this.logger.error(
          `BulkReceiptPdfExportWorker all-failed jobId=${jobId} ` +
            `schoolId=${input.schoolId} failed=${failedPaymentIds.length}`,
        );
        return;
      }

      // ─── Finalize + await upload (format-branched) ───────────────
      if (isMerged) {
        // Merged-PDF path: walk input.paymentIds in operator order, pull
        // succeeded buffers, hand ordered list to mergePdfBuffers, upload
        // as a single Buffer via putPdf.
        const orderedBuffers = input.paymentIds
          .map((id) => mergedBufferMap.get(id))
          .filter((b): b is Buffer => b !== undefined);
        const mergedPdfBuffer = await this.timeStage(
          'MergePdfLatencyMs',
          { schoolId: input.schoolId, jobId },
          () =>
            mergePdfBuffers(orderedBuffers, {
              title: `EdForge Receipts — ${succeeded} document(s)`,
            }),
        );
        await this.timeStage(
          'S3UploadLatencyMs',
          { schoolId: input.schoolId, jobId },
          () =>
            this.s3Service.putPdf(
              context.tenantId,
              context.jwtToken,
              outputKey,
              mergedPdfBuffer,
            ),
        );
      } else {
        await this.timeStage(
          'ArchiveFinalizeLatencyMs',
          { schoolId: input.schoolId, jobId },
          async () => {
            await archive.finalize();
          },
        );
        await this.timeStage(
          'S3UploadLatencyMs',
          { schoolId: input.schoolId, jobId },
          () => safeS3UploadPromise,
        );
        // PR #359 P1 — promote any S3 upload error captured by the safe
        // wrapper to a thrown exception here, so the outer catastrophe
        // handler runs markFailed. Before the fix, this rejection would
        // race past the catch and end up as an unhandled rejection.
        if (s3UploadError) {
          throw s3UploadError;
        }
        if (archiverErrors.length > 0) {
          throw new Error(
            `archiver emitted ${archiverErrors.length} error(s); first: ${archiverErrors[0].message}`,
          );
        }
      }

      // ─── Mint presigned URL + markCompleted ──────────────────────
      const outputUrl = await this.s3Service.presignGet(
        context.tenantId,
        context.jwtToken,
        outputKey,
        PRESIGN_TTL_SEC,
      );
      const urlExpiresAt = new Date(Date.now() + PRESIGN_TTL_SEC * 1000).toISOString();

      await this.jobsService.markCompleted(
        jobId,
        {
          output: isMerged
            ? {
                mergedPdfKey: outputKey,
                mergedPdfUrl: outputUrl,
                urlExpiresAt,
              }
            : {
                zipKey: outputKey,
                zipUrl: outputUrl,
                urlExpiresAt,
              },
          counters: {
            succeeded,
            failed: failedPaymentIds.length,
            skipped,
          },
        },
        context,
      );

      // Emit url_minted directly — the only audit event F.3 emits itself.
      // Lifecycle events (started/succeeded/failed) come via FinanceJobsService.
      // Per §0.3: store SHA256(outputKey) as `presignedKeyHash`, NEVER the URL.
      await this.auditService
        .emit(
          'finance.bulk_export.url_minted',
          {
            jobId,
            schoolId: input.schoolId,
            invoiceCount: succeeded, // audit event schema uses this key across
                                     // both invoice + receipt exports; it means
                                     // "count of documents rendered", not "invoices"
                                     // specifically. Kept as-is to avoid schema drift.
            format: input.format,
            presignedKeyHash: createHash('sha256').update(outputKey).digest('hex'),
            urlExpiresAt,
          } as any,
          context,
        )
        .catch((err) =>
          this.logger.warn(`url_minted audit emit failed (continuing): ${err.message}`),
        );

      this.emitJobTotal(jobId, input.schoolId, tStart);
      this.logger.log(
        `BulkReceiptPdfExportWorker complete jobId=${jobId} schoolId=${input.schoolId} ` +
          `succeeded=${succeeded} skipped=${skipped} failed=${failedPaymentIds.length} durationMs=${Date.now() - tStart}`,
      );
    } catch (workErr) {
      // Catastrophe path — markRunning failure, all-fetch failure, S3
      // upload failure, archiver error, deadline-exceeded. markFailed
      // (which best-effort cleans up the MVP.5 sentinel) + log + return
      // cleanly. The controller already returned 202; we never throw upward.
      //
      // Hotfix — abort the archive stream so lib-storage's Upload settles
      // promptly instead of waiting indefinitely for chunks that won't
      // arrive. `archive` is hoisted above the try block so it's in scope
      // here; guard for the case where the catastrophe fired before
      // archive was instantiated (e.g., markRunning failed).
      // Merged-PDF path has no archive to abort — mergedBufferMap gets GC'd
      // on function return.
      if (!isMerged && archive) {
        try {
          archive.abort();
        } catch {
          // archiver may already be in finalize/aborted state; safe to ignore.
        }
      }
      const reason = (workErr as Error).message?.slice(0, 200) ?? 'unknown worker failure';
      try {
        await this.jobsService.markFailed(jobId, reason, context);
      } catch (markErr) {
        this.logger.error(
          `markFailed itself failed for jobId=${jobId}: ${(markErr as Error).message}. ` +
            `Original worker error: ${reason}. ` +
            `Sprint I.1 janitor (or §5d MVP.3 sweeper on next task boot) will recover.`,
        );
      }
      this.emitJobTotal(jobId, input.schoolId, tStart);
      this.logger.error(
        `BulkReceiptPdfExportWorker failed jobId=${jobId} schoolId=${input.schoolId} ` +
          `durationMs=${Date.now() - tStart} reason="${reason}"`,
      );
    } finally {
      // PR #359 P1 fix-up — drain the S3 upload promise in finally too.
      // If the catastrophe happened AFTER the upload started but
      // BEFORE the happy-path await landed, the rejection would
      // surface as "Possible unhandled rejection" once the worker
      // returned. The safe-wrapper guarantees this await never throws.
      if (safeS3UploadPromise) {
        await safeS3UploadPromise;
      }
      lockHandle?.release();
    }
  }

  private buildZipKey(tenantId: string, schoolId: string, jobId: string): string {
    return `tenants/${tenantId}/schools/${schoolId}/pdf-jobs/${jobId}/receipts.zip`;
  }

  private buildMergedPdfKey(tenantId: string, schoolId: string, jobId: string): string {
    return `tenants/${tenantId}/schools/${schoolId}/pdf-jobs/${jobId}/receipts-merged.pdf`;
  }

  /**
   * P1 (issue #365) — fetch, resize, and re-encode the school logo
   * ONCE per bulk-export job.
   *
   * Returns a base64 `data:image/jpeg;base64,...` URI suitable to hand
   * back to the renderer's `<Image src={logoUrl}>` path unchanged.
   * On any failure (network, non-image response, Sharp error), returns
   * the original `logoUrl` so the render still produces a working (but
   * bloated) PDF — the optimization is best-effort and MUST NOT
   * downgrade the export from working-but-bloated to broken.
   *
   * Pipeline:
   *   1. Fetch the presigned S3 URL (10s hard timeout via AbortController)
   *   2. Sharp: resize to fit within LOGO_MAX_EDGE_PX × LOGO_MAX_EDGE_PX
   *      (aspect ratio preserved, no upscaling)
   *   3. Sharp: encode as progressive JPEG with mozjpeg at Q=85
   *   4. base64 → data URI
   *
   * Expected byte reduction: ~1.73 MB (2000×2000 RGB FlateDecode) →
   * ~15-30 KB per PDF. Net PDF: 1.77 MB → ~200 KB (~9x).
   *
   * Marked `protected` so unit specs can stub via subclass.
   */
  protected async optimizeLogoForPdf(logoUrl: string): Promise<string> {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        LOGO_FETCH_TIMEOUT_MS,
      );
      let sourceBuffer: Buffer;
      try {
        const response = await fetch(logoUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(
            `logo fetch returned HTTP ${response.status} ${response.statusText}`,
          );
        }
        sourceBuffer = Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timeoutHandle);
      }

      // PR #366 review fix — flatten transparent pixels onto white BEFORE
      // JPEG encode. JPEG has no alpha channel; Sharp converts fully-
      // transparent RGBA(0,0,0,0) pixels to RGB(0,0,0) black by default,
      // producing black-background logos on invoices for the (very common)
      // case of transparent-PNG school logos. `.flatten({background:'#ffffff'})`
      // composites onto white first — visually correct on the typical
      // white invoice page, no file-size cost, no output-format branching.
      const optimized = await sharp(sourceBuffer)
        .resize(LOGO_MAX_EDGE_PX, LOGO_MAX_EDGE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: LOGO_JPEG_QUALITY, progressive: true, mozjpeg: true })
        .toBuffer();

      this.logger.log(
        `optimizeLogoForPdf reduced logo ${sourceBuffer.length} → ${optimized.length} bytes ` +
          `(ratio ${(sourceBuffer.length / optimized.length).toFixed(1)}x)`,
      );

      return `data:image/jpeg;base64,${optimized.toString('base64')}`;
    } catch (err) {
      // Fail-open: unoptimized URL still works, just produces a large PDF.
      this.logger.warn(
        `optimizeLogoForPdf failed (falling back to unoptimized URL): ${(err as Error).message}`,
      );
      return logoUrl;
    }
  }

  private emitJobTotal(jobId: string, schoolId: string, tStart: number): void {
    this.metrics?.put({
      namespace: METRICS_NAMESPACE,
      metricName: 'JobTotalLatencyMs',
      value: Date.now() - tStart,
      unit: 'Milliseconds',
      dimensions: { schoolId, jobId },
    });
  }

  /**
   * Wrap a hot-path step with wall-time measurement + CW emit. Best-effort
   * metric (the metrics service swallows + warns on its own errors); the
   * wrapped fn's result/throw passes through. Mirror of E.4 worker's helper.
   */
  private async timeStage<T>(
    metricName: string,
    dims: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.metrics?.put({
        namespace: METRICS_NAMESPACE,
        metricName,
        value: Date.now() - start,
        unit: 'Milliseconds',
        dimensions: dims,
      });
    }
  }
}

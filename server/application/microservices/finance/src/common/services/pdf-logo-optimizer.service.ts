/**
 * PdfLogoOptimizerService — Plan §5d (2026-07-02)
 *
 * Fetches the operator-uploaded school logo from S3 (via a presigned URL)
 * and re-encodes it as a compact JPEG data URI suitable for embedding
 * inline in react-pdf's `<Image src={logoUrl}>` code path. Solves the
 * bloat problem where a 2000×2000 RGB PNG (1.73 MB) accounts for 97.8%
 * of a 1.77 MB rendered PDF — the CSS renders width:64 height:64 on the
 * page, but PDF viewers scale the raw XObject bytes at display time.
 *
 * Byte reduction (measured against dev-pabson-primary 2026-06-30):
 *   raw logo:       ~1.73 MB (2000×2000 RGB FlateDecode XObject)
 *   optimized:      ~15-30 KB (progressive JPEG mozjpeg Q=85, 512×512)
 *   net PDF:        ~1.8 MB → ~200 KB (~9× smaller)
 *
 * History:
 *   - Sprint F.9 (PR #366): First introduced as a private method
 *     `BulkInvoicePdfExportWorker.optimizeLogoForPdf`.
 *   - Sprint G.2 (PR #368): Copied verbatim into
 *     `BulkReceiptPdfExportWorker` (duplicated, not shared).
 *   - Plan §5d (this file): Extracted into a shared service so
 *     individual-document endpoints (`invoices.service.ts:getPdf`,
 *     `payments.service.ts:getReceiptPdf`) can apply the same
 *     optimization and both workers can drop their private copies.
 *
 * Design decisions (see Plan §5d "Design"):
 *   - **Lazy `require('sharp')` inside `optimize()`**. Module-top import
 *     would fail the entire finance service startup if libvips is
 *     missing in the container. Lazy require limits the blast radius
 *     to just this call (fail-open path returns the original URL).
 *   - **Response-size cap** on the logo fetch (`LOGO_MAX_FETCH_BYTES`).
 *     A hostile server could stream a 5 GB PNG into memory before
 *     Sharp sees it; the cap defends against pathological upstream.
 *   - **`sharp(buf, { limitInputPixels })`** explicit — matches the
 *     libvips default of ~268 M pixels but locks it in for audit-trail.
 *   - **`.flatten({background:'#ffffff'})` BEFORE JPEG encode**
 *     (PR #366 review P1a fix). JPEG has no alpha channel; Sharp
 *     converts fully-transparent RGBA(0,0,0,0) to opaque black by
 *     default, producing black-background logos on invoices for the
 *     very common case of transparent-PNG school logos. Composite
 *     onto white before encode.
 *   - **Fail-open contract**: any error (network, non-image response,
 *     Sharp exception, missing libvips) → return the original URL.
 *     The render still produces a working (but bloated) PDF; the
 *     optimization is best-effort and MUST NOT downgrade "working-but-
 *     bloated" to "broken".
 *   - **Configurable timeout**: individual endpoints pass ~3 s; bulk
 *     workers pass 10 s. Individual endpoints have a synchronous
 *     latency SLA and a longer fail-open ceiling would be a 5× sad-
 *     path regression.
 */

import { Injectable, Logger } from '@nestjs/common';

// Module-scoped constants — all pipeline parameters live here so both
// bulk workers and individual endpoints share the same shape.
export const LOGO_MAX_EDGE_PX = 512;
export const LOGO_JPEG_QUALITY = 85;
/** Individual-endpoint default (3 s). Bulk workers pass their own 10_000. */
export const LOGO_FETCH_TIMEOUT_MS_DEFAULT = 3_000;
/**
 * Fetch response cap. 20 MB is 10× a typical school logo (2000×2000 RGB
 * PNG ≈ 12 MB uncompressed; typical uploads are < 1 MB). Aborts hostile
 * upstream responses before Sharp/libvips see them.
 */
export const LOGO_MAX_FETCH_BYTES = 20 * 1024 * 1024;
/**
 * libvips input-pixel cap. Explicit (matches libvips default 0.268 GP)
 * so future Sharp version bumps don't silently change the ceiling.
 */
export const LOGO_MAX_INPUT_PIXELS = 268_402_689;

export interface OptimizeOptions {
  /** Milliseconds to wait for the logo fetch before aborting. Default 3_000. */
  fetchTimeoutMs?: number;
}

@Injectable()
export class PdfLogoOptimizerService {
  private readonly logger = new Logger(PdfLogoOptimizerService.name);

  /**
   * Fetch + resize + re-encode the school logo.
   *
   * @param logoUrl - Presigned S3 URL from `IdentityClient.getBranding`.
   *                  When `undefined`, returns `undefined` (no-op).
   * @param opts    - Optional overrides (fetch timeout).
   * @returns A `data:image/jpeg;base64,...` URI on success. On any
   *          failure, returns the original `logoUrl` unchanged (fail-open).
   *          Returns `undefined` iff `logoUrl` was `undefined`.
   */
  async optimize(
    logoUrl: string | undefined,
    opts?: OptimizeOptions,
  ): Promise<string | undefined> {
    if (!logoUrl) return undefined;

    // Lazy require — see file-header "Design decisions". If sharp or
    // libvips is missing at runtime, this throw is caught below and
    // we fail-open to the original URL; module-top import would fail
    // the entire finance service startup.
    let sharp: typeof import('sharp');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharp = require('sharp');
    } catch (err) {
      this.logger.warn(
        `PdfLogoOptimizerService: sharp require() failed — likely missing libvips ` +
          `(falling back to original URL): ${(err as Error).message}`,
      );
      return logoUrl;
    }

    const fetchTimeoutMs = opts?.fetchTimeoutMs ?? LOGO_FETCH_TIMEOUT_MS_DEFAULT;

    try {
      // ─── Fetch ────────────────────────────────────────────────────────
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), fetchTimeoutMs);
      let sourceBuffer: Buffer;
      try {
        const response = await fetch(logoUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(
            `logo fetch returned HTTP ${response.status} ${response.statusText}`,
          );
        }
        // Hostile-response defense (pre-stream): reject before reading any
        // bytes when the server advertises an oversized Content-Length.
        // Use `parseInt` with a strict finite/non-negative check — `Number()`
        // coerces malformed headers ('abc', '  50  ') to NaN, which silently
        // bypasses `> CAP` comparison. Malformed values fall through to the
        // streaming check (which is the authoritative gate).
        const rawContentLength = response.headers.get('content-length');
        if (rawContentLength !== null) {
          const advertised = Number.parseInt(rawContentLength, 10);
          if (
            Number.isFinite(advertised) &&
            advertised >= 0 &&
            advertised > LOGO_MAX_FETCH_BYTES
          ) {
            throw new Error(
              `logo Content-Length ${advertised} exceeds cap ${LOGO_MAX_FETCH_BYTES}`,
            );
          }
        }
        // Hostile-response defense (streaming): some upstreams omit or lie
        // about Content-Length. `await response.arrayBuffer()` would allocate
        // the entire body before any check could fire — the pre-check DoS
        // window flagged in PR #399 review P1. Stream via for-await-of and
        // abort the socket the moment accumulated bytes would cross the cap.
        //
        // KNOWN CAVEAT: a single hostile chunk larger than the cap is
        // materialized in memory by undici BEFORE the async iterator hands
        // it to us. Undici's default highWaterMark (16 KiB) controls pull
        // backpressure but does NOT bound chunk size at the iterator
        // surface — an HTTP/1.1 chunked-encoding chunk-size line or an
        // HTTP/2 DATA frame is upstream-controlled. This defense reduces
        // the pre-fix "allocate entire body" DoS window to "allocate one
        // network-controlled chunk," which is a real improvement even if
        // not a complete elimination. In prod the upstream is an S3
        // presigned URL served by AWS — a trust boundary already validated
        // at logo-upload time. Bounding chunk size properly requires BYOB
        // reader mode (`getReader({mode:'byob'})` + a fixed-size ArrayBuffer)
        // and is tracked as a follow-up.
        if (!response.body) {
          throw new Error('logo fetch returned no response body');
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        try {
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            // Check BEFORE retaining the chunk — peak retained memory in
            // the loop is bounded by CAP + one chunk. Strict `>` so a
            // payload exactly at CAP still passes; only CAP+1 rejects.
            if (received + chunk.byteLength > LOGO_MAX_FETCH_BYTES) {
              // Tear down the socket synchronously at the network layer.
              // Throwing out of `for await` also invokes the async
              // iterator's return() hook as defense-in-depth (cancels
              // the reader and releases the stream lock).
              controller.abort();
              // Drop accumulated chunk references synchronously so they
              // are eligible for GC without waiting for the exception to
              // unwind — matters under concurrent-request memory pressure.
              const overshoot = received + chunk.byteLength;
              chunks.length = 0;
              throw new Error(
                `logo stream exceeded cap ${LOGO_MAX_FETCH_BYTES} bytes ` +
                  `(next chunk would push total to ${overshoot})`,
              );
            }
            received += chunk.byteLength;
            chunks.push(chunk);
          }
        } catch (streamErr) {
          // Defense-in-depth: release accumulator references before the
          // exception unwinds through the outer catch. Covers benign
          // fetch-mid-stream failures (network drop, undici throw) as
          // well as our own cap-breach throw above.
          chunks.length = 0;
          throw streamErr;
        }
        // Buffer.concat accepts Uint8Array[] on Node 20 and returns a
        // Node Buffer (required by the downstream sharp call). Passing
        // `received` pre-allocates exactly once.
        sourceBuffer = Buffer.concat(chunks, received);
      } finally {
        clearTimeout(timeoutHandle);
      }

      // ─── Resize + re-encode ────────────────────────────────────────────
      const optimized = await sharp(sourceBuffer, {
        limitInputPixels: LOGO_MAX_INPUT_PIXELS,
      })
        .resize(LOGO_MAX_EDGE_PX, LOGO_MAX_EDGE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        // PR #366 review fix — flatten transparent pixels onto white BEFORE
        // JPEG encode. See file-header design decisions for the class of
        // bug this prevents (transparent PNG → black-background invoice).
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: LOGO_JPEG_QUALITY, progressive: true, mozjpeg: true })
        .toBuffer();

      this.logger.log(
        `PdfLogoOptimizerService: reduced logo ${sourceBuffer.length} → ${optimized.length} bytes ` +
          `(ratio ${(sourceBuffer.length / optimized.length).toFixed(1)}×)`,
      );

      return `data:image/jpeg;base64,${optimized.toString('base64')}`;
    } catch (err) {
      this.logger.warn(
        `PdfLogoOptimizerService.optimize failed (falling back to original URL): ${(err as Error).message}`,
      );
      return logoUrl;
    }
  }
}

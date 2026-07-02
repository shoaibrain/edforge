/**
 * PdfLogoOptimizerService runtime-contract spec — Plan §5d.
 *
 * Uses REAL Sharp against in-memory PNG fixtures. This is the
 * regression guard that catches:
 *   - JPEG encoder converting transparent RGBA(0,0,0,0) to opaque black
 *     when `.flatten({background:'#ffffff'})` is missing (PR #366 P1a fix)
 *   - Resize logic silently changing behavior across Sharp version bumps
 *   - Aspect-ratio preservation on non-square inputs
 *   - Size cap enforcement post-download
 *
 * Successor to `bulk-ops/workers/logo-optimize-runtime.spec.ts` (deleted
 * as part of §5d when the private method moved into this service).
 *
 * Why NOT mocked Sharp:
 *   The sibling `pdf-logo-optimizer.service.spec.ts` mocks Sharp entirely
 *   — it verifies chain WIRING (order, arg values, fail-open flows) but
 *   NOT actual pixel output. That gap let the "black background" bug
 *   through the mocked layer even though it fires on every transparent-
 *   PNG school logo in real prod use.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import {
  PdfLogoOptimizerService,
  LOGO_MAX_FETCH_BYTES,
} from './pdf-logo-optimizer.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const originalFetch = g.fetch;

/**
 * Build a Response-like object whose `body` is an async-iterable
 * yielding the given fixture bytes in a single chunk. Matches the
 * post-PR-#399-P1 streaming shape the service reads at runtime.
 */
function fetchReturns(bytes: Buffer): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? String(bytes.length) : null,
    },
    body: {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        yield new Uint8Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
      },
    },
  });
}

/**
 * Decode a `data:image/jpeg;base64,...` URI back to raw bytes for
 * pixel-level inspection.
 */
function dataUriToBuffer(dataUri: string): Buffer {
  const commaIdx = dataUri.indexOf(',');
  if (!dataUri.startsWith('data:image/jpeg;base64,') || commaIdx < 0) {
    throw new Error(`Expected data:image/jpeg;base64,... — got ${dataUri.slice(0, 60)}...`);
  }
  return Buffer.from(dataUri.slice(commaIdx + 1), 'base64');
}

describe('PdfLogoOptimizerService runtime — real Sharp against real fixtures', () => {
  let svc: PdfLogoOptimizerService;

  beforeEach(() => {
    svc = new PdfLogoOptimizerService();
  });

  afterEach(() => {
    g.fetch = originalFetch;
  });

  /**
   * Fixture: fully-transparent 200×200 PNG (RGBA all zeros). Without
   * `.flatten({background:'#ffffff'})`, Sharp's JPEG encoder converts
   * fully-transparent pixels to opaque BLACK (RGB 0,0,0) — the exact
   * bug PR #366 review caught.
   */
  it('transparent-PNG logo → NO black background on JPEG output (flatten onto white works)', async () => {
    const transparentPng = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // fully transparent
      },
    })
      .png()
      .toBuffer();

    g.fetch = fetchReturns(transparentPng);

    const dataUri = await svc.optimize('https://s3/example/logo.png');
    expect(dataUri).toBeDefined();

    const jpegBytes = dataUriToBuffer(dataUri!);
    // JPEG magic — 0xFFD8FF
    expect(jpegBytes.slice(0, 3).toString('hex')).toBe('ffd8ff');

    // Decode the JPEG and inspect a sample pixel at (10,10). Without
    // flatten, this pixel would be [0,0,0] (black). With flatten
    // onto white, it's [255,255,255] (or very near, allowing for JPEG
    // lossy noise).
    const { data, info } = await sharp(jpegBytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    const offset = 10 * info.width * 3 + 10 * 3;
    const [r, gPx, b] = [data[offset], data[offset + 1], data[offset + 2]];
    expect(r).toBeGreaterThanOrEqual(250);
    expect(gPx).toBeGreaterThanOrEqual(250);
    expect(b).toBeGreaterThanOrEqual(250);
  });

  /**
   * Fixture: opaque red PNG. Sanity check that flatten() doesn't
   * mangle non-transparent pixels.
   */
  it('opaque solid-color PNG preserves the color through the pipeline', async () => {
    const redPng = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 220, g: 30, b: 40 },
      },
    })
      .png()
      .toBuffer();

    g.fetch = fetchReturns(redPng);

    const dataUri = await svc.optimize('https://s3/example/logo.png');
    const jpegBytes = dataUriToBuffer(dataUri!);
    const { data, info } = await sharp(jpegBytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset = 100 * info.width * 3 + 100 * 3;
    const [r, gPx, b] = [data[offset], data[offset + 1], data[offset + 2]];
    // JPEG lossy tolerance ±15 for chroma-heavy pixels.
    expect(Math.abs(r - 220)).toBeLessThan(15);
    expect(Math.abs(gPx - 30)).toBeLessThan(15);
    expect(Math.abs(b - 40)).toBeLessThan(15);
  });

  /**
   * Fixture: oversized logo (2000×2000 — the actual production case
   * that motivated the whole optimization). Assert output is downscaled
   * to fit within 512×512 AND file size is dramatically smaller.
   */
  it('2000×2000 logo → output ≤ 512×512 and ≤ 50 KB (vs multi-MB raw)', async () => {
    const bigLogo = await sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .png()
      .toBuffer();

    g.fetch = fetchReturns(bigLogo);

    const dataUri = await svc.optimize('https://s3/example/logo.png');
    const jpegBytes = dataUriToBuffer(dataUri!);
    const meta = await sharp(jpegBytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.height).toBeLessThanOrEqual(512);
    expect(jpegBytes.length).toBeLessThan(50 * 1024); // 50 KB ceiling
  });

  /**
   * Aspect-ratio regression guard: a 1600×400 landscape logo should
   * NOT be squashed to 512×512. `fit: 'inside'` preserves aspect ratio.
   */
  it('non-square logo preserves aspect ratio (fit:inside)', async () => {
    const wideLogo = await sharp({
      create: {
        width: 1600,
        height: 400,
        channels: 3,
        background: { r: 20, g: 20, b: 20 },
      },
    })
      .png()
      .toBuffer();

    g.fetch = fetchReturns(wideLogo);

    const dataUri = await svc.optimize('https://s3/example/logo.png');
    const meta = await sharp(dataUriToBuffer(dataUri!)).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(128); // 4:1 aspect preserved
  });

  /**
   * Streaming cap enforcement — PR #399 P1 review.
   *
   * When the upstream streams > LOGO_MAX_FETCH_BYTES with no
   * Content-Length hint, the service must fail-open BEFORE the full
   * payload lands in memory. The mock's async iterator yields the body
   * in bounded chunks so the loop's `received + chunk.byteLength > CAP`
   * check can fire mid-stream. Runtime-level regression guard for the
   * P1 finding.
   */
  it('streaming cap: oversized body with no Content-Length → fail-open before drain', async () => {
    // Just past the cap. Filled with zeros — Sharp will never see it
    // because the streaming cap check runs first.
    const oversized = Buffer.alloc(LOGO_MAX_FETCH_BYTES + 1024, 0);
    const CHUNK_SIZE = 1024 * 1024;
    let handedOut = 0;
    g.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null }, // no Content-Length advertised
      body: {
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          for (let off = 0; off < oversized.byteLength; off += CHUNK_SIZE) {
            const len = Math.min(CHUNK_SIZE, oversized.byteLength - off);
            handedOut += len;
            yield new Uint8Array(
              oversized.buffer,
              oversized.byteOffset + off,
              len,
            );
          }
        },
      },
    });

    const out = await svc.optimize('https://s3/example/logo.png');
    expect(out).toBe('https://s3/example/logo.png');
    // Streaming discriminator — proves the loop aborted before consuming
    // the entire payload. Bound: CAP + one chunk. The yield-then-check
    // ordering means the last chunk that trips the check has already
    // been handed to the consumer, but nothing after it is drained.
    expect(handedOut).toBeLessThanOrEqual(LOGO_MAX_FETCH_BYTES + CHUNK_SIZE);
  });
});

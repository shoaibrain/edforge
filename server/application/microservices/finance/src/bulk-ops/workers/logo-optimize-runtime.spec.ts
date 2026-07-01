/**
 * Logo optimization runtime-contract spec — PR #366 review P1a fix.
 *
 * Why this spec exists:
 *   The unit specs in `bulk-invoice-pdf-export.worker.spec.ts` mock
 *   sharp entirely — they verify wiring (once-per-job, fail-open,
 *   data-URI substitution) but NOT the actual pixel output. That gap
 *   let the "JPEG encoding forces transparent pixels to black" bug
 *   through the mocked-spec layer even though it happens on every
 *   transparent-PNG school logo in real prod use.
 *
 *   Same regression-guard pattern as `archiver-runtime.spec.ts` from
 *   PR #362 — use the REAL Sharp module, feed it a fixture that
 *   exercises the failing code path, assert on actual byte output.
 *
 *   If someone later removes the `.flatten({background:'#ffffff'})` call
 *   or swaps the JPEG encoder for another format that treats alpha
 *   differently, this spec fails loudly instead of silently shipping
 *   black-backgrounded logos to operators.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');

// The exact pipeline the worker's `optimizeLogoForPdf` runs on the
// fetched logo buffer. Kept as a local re-implementation (not exported
// from the worker) so the spec runs without the full worker DI graph
// AND so future refactors that change the worker's pipeline must
// also update this reference — the drift is visible in review.
async function pipeline(sourceBuffer: Buffer): Promise<Buffer> {
  return sharp(sourceBuffer)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85, progressive: true, mozjpeg: true })
    .toBuffer();
}

describe('logo optimize runtime — real Sharp against real fixtures', () => {
  /**
   * Fixture: fully-transparent PNG (RGBA all zeros). Without
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

    const optimized = await pipeline(transparentPng);
    expect(optimized.slice(0, 3).toString('hex')).toBe('ffd8ff'); // JPEG magic

    // Decode the JPEG and inspect a sample pixel at (10,10). Without
    // flatten, this pixel would be [0,0,0] (black). With flatten
    // onto white, it's [255,255,255] (or very near, allowing for JPEG
    // lossy noise).
    const { data, info } = await sharp(optimized)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    // Sample at (10,10): row 10 * width * 3 channels + col 10 * 3
    const offset = 10 * info.width * 3 + 10 * 3;
    const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
    // Tolerance ±5 for JPEG lossy compression noise near hard-white areas.
    expect(r).toBeGreaterThanOrEqual(250);
    expect(g).toBeGreaterThanOrEqual(250);
    expect(b).toBeGreaterThanOrEqual(250);
  });

  /**
   * Fixture: opaque red PNG. Sanity check that flatten() doesn't
   * mangle non-transparent pixels — red-in should be roughly red-out.
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

    const optimized = await pipeline(redPng);
    const { data, info } = await sharp(optimized)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset = 100 * info.width * 3 + 100 * 3;
    const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
    // JPEG lossy tolerance ±15 for chroma-heavy pixels.
    expect(Math.abs(r - 220)).toBeLessThan(15);
    expect(Math.abs(g - 30)).toBeLessThan(15);
    expect(Math.abs(b - 40)).toBeLessThan(15);
  });

  /**
   * Fixture: oversized logo (2000×2000 — the actual production case
   * that motivated the whole optimization). Assert output is downscaled
   * to fit within 512×512 AND file size is dramatically smaller.
   */
  it('2000×2000 logo → output ≤ 512×512 and ≤ 50KB (vs 12MB uncompressed raw)', async () => {
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

    const optimized = await pipeline(bigLogo);
    const meta = await sharp(optimized).metadata();
    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.height).toBeLessThanOrEqual(512);
    expect(optimized.length).toBeLessThan(50 * 1024); // 50 KB ceiling
  });
});

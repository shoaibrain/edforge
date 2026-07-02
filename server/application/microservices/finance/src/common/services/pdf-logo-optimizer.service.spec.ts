/**
 * PdfLogoOptimizerService unit spec — Plan §5d.
 *
 * Mocks sharp with a chainable-return object so we can assert:
 *   - Chain order + params (resize dims, flatten background, JPEG opts,
 *     limitInputPixels)
 *   - Fail-open behavior on: undefined input, sharp missing, fetch HTTP
 *     error, oversized Content-Length header, oversized buffer,
 *     Sharp .toBuffer() throw
 *   - Timeout wiring (custom fetchTimeoutMs respected)
 *
 * The real-Sharp path (integration coverage — transparent-PNG regression
 * guard, decode assertion) lives in
 * `pdf-logo-optimizer.service.runtime.spec.ts`.
 */

const sharpFactory = jest.fn();

// Mock sharp at the module boundary. The service does `require('sharp')`
// lazily inside `optimize()`, so we mock the module and the require call
// picks up our mock at call time.
jest.mock('sharp', () => sharpFactory, { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const originalFetch = g.fetch;

import {
  PdfLogoOptimizerService,
  LOGO_MAX_INPUT_PIXELS,
  LOGO_MAX_FETCH_BYTES,
} from './pdf-logo-optimizer.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChainableSharp(finalBuffer: Buffer): any {
  const chain = {
    resize: jest.fn().mockReturnThis(),
    flatten: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(finalBuffer),
  };
  return chain;
}

function makeOkFetchResponse(
  bodyBytes: number,
  advertisedContentLength?: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const buf = Buffer.alloc(bodyBytes, 0);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-length') {
          return String(advertisedContentLength ?? bodyBytes);
        }
        return null;
      },
    },
    arrayBuffer: () => Promise.resolve(buf.buffer),
  };
}

describe('PdfLogoOptimizerService (Plan §5d)', () => {
  let svc: PdfLogoOptimizerService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PdfLogoOptimizerService();
    // Default: sharp returns a chain whose toBuffer resolves to a
    // 20-byte buffer (arbitrary — tests assert the base64 shape, not
    // the specific bytes).
    sharpFactory.mockImplementation(() =>
      makeChainableSharp(Buffer.from('OPTIMIZED_LOGO_BYTES')),
    );
    // Default: fetch returns a 5 KB image.
    g.fetch = jest.fn().mockResolvedValue(makeOkFetchResponse(5_000));
  });

  afterEach(() => {
    g.fetch = originalFetch;
  });

  // ─────────────────────────────────────────────────────────────────
  // Undefined input
  // ─────────────────────────────────────────────────────────────────
  it('returns undefined when logoUrl is undefined (no-op)', async () => {
    const out = await svc.optimize(undefined);
    expect(out).toBeUndefined();
    expect(g.fetch).not.toHaveBeenCalled();
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────
  // Happy path — chain order + params
  // ─────────────────────────────────────────────────────────────────
  it('happy path: returns data:image/jpeg;base64,<...> URI', async () => {
    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe(
      'data:image/jpeg;base64,' + Buffer.from('OPTIMIZED_LOGO_BYTES').toString('base64'),
    );
  });

  it('calls sharp with limitInputPixels + correct chain order', async () => {
    await svc.optimize('https://example.com/logo.png');

    expect(sharpFactory).toHaveBeenCalledTimes(1);
    const [sourceBufferArg, sharpOpts] = sharpFactory.mock.calls[0];
    expect(sourceBufferArg).toBeInstanceOf(Buffer);
    expect(sharpOpts).toEqual({ limitInputPixels: LOGO_MAX_INPUT_PIXELS });

    const chain = sharpFactory.mock.results[0].value;
    expect(chain.resize).toHaveBeenCalledWith(512, 512, {
      fit: 'inside',
      withoutEnlargement: true,
    });
    // PR #366 review P1a: flatten MUST run before jpeg — the mock counts
    // don't guarantee ordering, but jsdom's single-threaded mocking with
    // a chainable stub gives us call-order via jest mock.invocationCallOrder.
    expect(chain.flatten).toHaveBeenCalledWith({ background: '#ffffff' });
    expect(chain.jpeg).toHaveBeenCalledWith({
      quality: 85,
      progressive: true,
      mozjpeg: true,
    });
    const flattenOrder = chain.flatten.mock.invocationCallOrder[0];
    const jpegOrder = chain.jpeg.mock.invocationCallOrder[0];
    expect(flattenOrder).toBeLessThan(jpegOrder);
    expect(chain.toBuffer).toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────
  // Fail-open contracts
  // ─────────────────────────────────────────────────────────────────
  it('fail-open: fetch !ok → returns original URL', async () => {
    g.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => null },
    });

    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  it('fail-open: fetch throws → returns original URL', async () => {
    g.fetch = jest.fn().mockRejectedValue(new Error('DNS lookup failed'));
    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
  });

  it('fail-open: Sharp .toBuffer() throws → returns original URL', async () => {
    sharpFactory.mockImplementation(() => {
      const chain = makeChainableSharp(Buffer.alloc(0));
      chain.toBuffer = jest.fn().mockRejectedValue(new Error('libvips: no bmi'));
      return chain;
    });

    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
  });

  it('fail-open: Content-Length header exceeds 20 MB cap → returns original URL', async () => {
    g.fetch = jest.fn().mockResolvedValue(
      makeOkFetchResponse(5_000, LOGO_MAX_FETCH_BYTES + 1),
    );

    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
    // Sharp is never invoked because we abort before consuming the body.
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  it('fail-open: post-download buffer exceeds cap (upstream lied) → returns original URL', async () => {
    // Advertised = 100 bytes, but the body actually returns > 20 MB.
    g.fetch = jest.fn().mockResolvedValue(
      makeOkFetchResponse(LOGO_MAX_FETCH_BYTES + 1, 100),
    );

    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────
  // Timeout wiring
  // ─────────────────────────────────────────────────────────────────
  it('passes AbortController.signal to fetch', async () => {
    await svc.optimize('https://example.com/logo.png');
    const [url, init] = (g.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://example.com/logo.png');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('custom fetchTimeoutMs is respected (fires abort at the specified delay)', async () => {
    jest.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    g.fetch = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_url: string, init: any) => {
        capturedSignal = init.signal;
        // Return a never-resolving promise so the timeout has to fire.
        return new Promise(() => {});
      },
    );

    const optimizePromise = svc.optimize('https://example.com/logo.png', {
      fetchTimeoutMs: 500,
    });

    // Advance to just before the timeout — nothing aborted yet.
    jest.advanceTimersByTime(499);
    expect(capturedSignal?.aborted).toBe(false);

    // Advance past the timeout — the AbortController fires.
    jest.advanceTimersByTime(2);
    expect(capturedSignal?.aborted).toBe(true);

    // Let promise resolution settle: mimic fetch throwing on abort so
    // optimize returns fail-open.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (g.fetch as any).mockClear();
    jest.useRealTimers();
    // Race the pending optimize against a fresh rejection so the test
    // exits cleanly.
    await Promise.race([
      optimizePromise,
      new Promise((resolve) => setTimeout(resolve, 10)),
    ]);
  });

  // ─────────────────────────────────────────────────────────────────
  // Sharp factory throws on invocation (simulates dlopen path)
  //
  // NOTE: this spec cannot easily simulate the `require('sharp')` call
  // itself throwing — the top-of-file jest.mock replaces the module
  // BEFORE any require call, so the require always succeeds and returns
  // our mock. What we CAN simulate is Sharp's CALLABLE misbehaving (as
  // if libvips's native init failed at first call time). The service's
  // outer try/catch handles both paths identically — return original URL.
  // ─────────────────────────────────────────────────────────────────
  it('fail-open: sharp callable throws on invocation → returns original URL', async () => {
    sharpFactory.mockImplementation(() => {
      throw new Error(
        'sharp: libvips.so.42 not found',
      );
    });

    const out = await svc.optimize('https://example.com/logo.png');
    expect(out).toBe('https://example.com/logo.png');
  });
});

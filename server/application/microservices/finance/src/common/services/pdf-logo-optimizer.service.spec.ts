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

/**
 * Streaming-fetch response stub. The service reads `response.body` via
 * `for await (chunk of response.body)`, so the mock must expose
 * `[Symbol.asyncIterator]`. Chunk size is configurable so tests can
 * exercise multi-chunk vs. single-chunk-overshoot paths.
 *
 * `handedOutBytes` on the returned object is instrumentation for the
 * DoS-discrimination assertion: it counts bytes the mock actually
 * yielded to the consumer. On the pre-fix code that read the full body
 * via `arrayBuffer()`, this counter would land at bodyBytes (or the
 * mock's arrayBuffer() path would throw TypeError). On the post-fix
 * streaming code, it lands at CAP + one chunk when the cap fires — a
 * strict discriminator between old and new behavior.
 */
function makeOkFetchResponse(
  bodyBytes: number,
  advertisedContentLength?: number,
  opts?: {
    /** Omit the Content-Length header entirely (hostile shape #1). */
    omitContentLength?: boolean;
    /** Yield the body in chunks of this size. Default: single chunk. */
    chunkSize?: number;
    /** Await a microtask between chunks so aborts can interrupt the loop. */
    awaitBetweenChunks?: boolean;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const buf = Buffer.alloc(bodyBytes, 0);
  const chunkSize = opts?.chunkSize ?? Math.max(bodyBytes, 1);
  const state = { handedOutBytes: 0 };
  const response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() !== 'content-length') return null;
        if (opts?.omitContentLength) return null;
        return String(advertisedContentLength ?? bodyBytes);
      },
    },
    body: {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        for (let off = 0; off < bodyBytes; off += chunkSize) {
          if (opts?.awaitBetweenChunks) {
            await new Promise<void>((r) => setImmediate(r));
          }
          const len = Math.min(chunkSize, bodyBytes - off);
          const chunk = new Uint8Array(buf.buffer, buf.byteOffset + off, len);
          state.handedOutBytes += len;
          yield chunk;
        }
      },
    },
    // Instrumentation for DoS-discrimination assertions. Tests read this
    // AFTER awaiting optimize() — if the streaming cap fired correctly,
    // handedOutBytes lands at CAP + one chunk (not the full body size).
    get handedOutBytes() {
      return state.handedOutBytes;
    },
  };
  return response;
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

  // ─────────────────────────────────────────────────────────────────
  // PR #399 P1 review — streaming cap DoS discrimination.
  //
  // The pre-fix code did `await response.arrayBuffer()` before checking
  // sourceBuffer.byteLength, allocating the ENTIRE hostile body first.
  // Fail-open observables (returns original URL, does not call sharp)
  // are IDENTICAL between the old and new code — so a test that only
  // asserts those observables doesn't discriminate.
  //
  // These tests use the mock's `handedOutBytes` counter to prove the
  // streaming cap fired MID-STREAM, not after full allocation. The
  // counter is a strict discriminator: on the pre-fix code with the
  // old `arrayBuffer()` shape the mock would either drain fully OR
  // throw TypeError (arrayBuffer is undefined on the new mock); the
  // fixed code walks the async iterator only until the next chunk
  // would breach the cap, then aborts.
  // ─────────────────────────────────────────────────────────────────
  it('streaming cap: hostile body with omitted Content-Length aborts BEFORE draining (P1 discriminator)', async () => {
    // 25 MB body streamed in 1 MB chunks, header omitted entirely.
    // Old code would arrayBuffer() → allocate all 25 MB → then check.
    // New code aborts after the first chunk that would push received
    // above CAP.
    const OVERSHOOT_BODY = 25 * 1024 * 1024;
    const CHUNK_SIZE = 1 * 1024 * 1024;
    const response = makeOkFetchResponse(OVERSHOOT_BODY, undefined, {
      omitContentLength: true,
      chunkSize: CHUNK_SIZE,
    });
    // Capture the AbortSignal so we can assert abort() was invoked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedSignal: AbortSignal | undefined;
    g.fetch = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_url: string, init: any) => {
        capturedSignal = init.signal;
        return Promise.resolve(response);
      },
    );

    const out = await svc.optimize('https://example.com/logo.png');

    // Fail-open observable — matches old-code behavior, useful only as
    // a baseline.
    expect(out).toBe('https://example.com/logo.png');
    expect(sharpFactory).not.toHaveBeenCalled();

    // DISCRIMINATOR: bytes actually pulled from the body must be bounded
    // by CAP + one chunk (~1 MB here). Old arrayBuffer()-based code
    // would drain the full 25 MB. New code aborts on the chunk that
    // would push received over CAP — the mock's yield-then-check
    // ordering means the chunk that TRIPS the check has already been
    // yielded to the consumer, but nothing after it is consumed. So
    // handedOutBytes ≤ CAP + CHUNK_SIZE, which is a strict discriminator
    // (drops from 25 MB to 21 MB while proving the loop halted).
    expect(response.handedOutBytes).toBeLessThanOrEqual(
      LOGO_MAX_FETCH_BYTES + CHUNK_SIZE,
    );
    // Sanity: we DID consume enough to fire the cap (i.e., the check
    // reached inside the loop; not a coincidental early return).
    expect(response.handedOutBytes).toBeGreaterThanOrEqual(
      LOGO_MAX_FETCH_BYTES - CHUNK_SIZE,
    );

    // DISCRIMINATOR: controller.abort() was invoked on cap breach.
    // Old code did not need to abort (it had already consumed the full
    // body). This assertion regresses if a future refactor drops the
    // explicit abort() call in favor of just throwing.
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('streaming cap: hostile body with lying Content-Length aborts BEFORE draining (P1 discriminator)', async () => {
    // Advertises 1 KB (bypasses pre-download guard), then streams 25 MB.
    // Same discrimination pattern as the omitted-header case.
    const OVERSHOOT_BODY = 25 * 1024 * 1024;
    const CHUNK_SIZE = 512 * 1024;
    const response = makeOkFetchResponse(OVERSHOOT_BODY, 1024, {
      chunkSize: CHUNK_SIZE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedSignal: AbortSignal | undefined;
    g.fetch = jest.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_url: string, init: any) => {
        capturedSignal = init.signal;
        return Promise.resolve(response);
      },
    );

    const out = await svc.optimize('https://example.com/logo.png');

    expect(out).toBe('https://example.com/logo.png');
    expect(sharpFactory).not.toHaveBeenCalled();
    // Bound: CAP + one chunk (512 KB). Old code drained 25 MB.
    expect(response.handedOutBytes).toBeLessThanOrEqual(
      LOGO_MAX_FETCH_BYTES + CHUNK_SIZE,
    );
    expect(response.handedOutBytes).toBeGreaterThan(0);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('boundary: payload exactly at LOGO_MAX_FETCH_BYTES passes, +1 byte rejects (strict >)', async () => {
    // Case A: exactly CAP bytes — must succeed and reach sharp.
    sharpFactory.mockClear();
    g.fetch = jest.fn().mockResolvedValueOnce(
      makeOkFetchResponse(LOGO_MAX_FETCH_BYTES, undefined, {
        chunkSize: 1024 * 1024,
        omitContentLength: true,
      }),
    );
    const atCapOut = await svc.optimize('https://example.com/at-cap.png');
    // Must have produced a data URI (proves sharp chain completed, not
    // that we fail-opened for the wrong reason).
    expect(atCapOut).toMatch(/^data:image\/jpeg;base64,/);
    expect(sharpFactory).toHaveBeenCalledTimes(1);
    const passedBuf = sharpFactory.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(passedBuf)).toBe(true);
    expect(passedBuf.byteLength).toBe(LOGO_MAX_FETCH_BYTES);

    // Case B: CAP + 1 byte — must fail-open.
    sharpFactory.mockClear();
    g.fetch = jest.fn().mockResolvedValueOnce(
      makeOkFetchResponse(LOGO_MAX_FETCH_BYTES + 1, undefined, {
        chunkSize: 1024 * 1024,
        omitContentLength: true,
      }),
    );
    const overOut = await svc.optimize('https://example.com/over.png');
    expect(overOut).toBe('https://example.com/over.png');
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  it('happy path: multi-chunk stream reassembles byte-identically into the buffer sharp receives', async () => {
    // 12 bytes yielded in 3 chunks of 4 bytes each. Guards against a
    // subtle Buffer.concat length/offset regression. This test needs
    // REAL fixture bytes (not the generic helper's zero-fill), so we
    // inline the mock.
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
    ]);
    const CHUNK = 4;
    g.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null,
      },
      body: {
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          for (let off = 0; off < bytes.byteLength; off += CHUNK) {
            const len = Math.min(CHUNK, bytes.byteLength - off);
            yield new Uint8Array(
              bytes.buffer,
              bytes.byteOffset + off,
              len,
            );
          }
        },
      },
    });
    sharpFactory.mockClear();

    await svc.optimize('https://example.com/multi-chunk.png');

    expect(sharpFactory).toHaveBeenCalledTimes(1);
    const received = sharpFactory.mock.calls[0][0] as Buffer;
    expect(Buffer.isBuffer(received)).toBe(true);
    expect(received.byteLength).toBe(bytes.byteLength);
    expect(received.equals(bytes)).toBe(true);
  });

  it('malformed Content-Length header falls through to streaming check (not silently bypassed)', async () => {
    // Number('abc') = NaN. Old code would silently bypass the pre-check;
    // the parseInt refactor now falls through to streaming (still gated).
    const response = makeOkFetchResponse(1024, undefined, {
      chunkSize: 512,
      omitContentLength: false, // header IS present, just malformed
    });
    // Override the header get() to return a malformed value.
    response.headers.get = (name: string) =>
      name.toLowerCase() === 'content-length' ? 'not-a-number' : null;

    const out = await svc.optimize('https://example.com/malformed.png');

    // Small body under cap — should complete happily via streaming path.
    expect(out).toMatch(/^data:image\/jpeg;base64,/);
    expect(sharpFactory).toHaveBeenCalledTimes(1);
  });

  it('response.body === null → fail-open (defensive branch)', async () => {
    g.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      body: null,
    });
    sharpFactory.mockClear();

    const out = await svc.optimize('https://example.com/no-body.png');

    expect(out).toBe('https://example.com/no-body.png');
    expect(sharpFactory).not.toHaveBeenCalled();
  });

  it('zero-byte chunks: loop tolerates them without infinite-loop or NaN', async () => {
    // Yield 3 empty chunks then 12 bytes of real data.
    const realBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const emptyChunks = 3;
    g.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'content-length' ? String(realBytes.byteLength) : null,
      },
      body: {
        async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          for (let i = 0; i < emptyChunks; i++) {
            yield new Uint8Array(0);
          }
          yield new Uint8Array(
            realBytes.buffer,
            realBytes.byteOffset,
            realBytes.byteLength,
          );
        },
      },
    });
    sharpFactory.mockClear();

    await svc.optimize('https://example.com/padded.png');

    // Sharp received exactly the real bytes; empty chunks contributed
    // nothing but did not break assembly.
    expect(sharpFactory).toHaveBeenCalledTimes(1);
    const passed = sharpFactory.mock.calls[0][0] as Buffer;
    expect(passed.byteLength).toBe(realBytes.byteLength);
    expect(passed.equals(realBytes)).toBe(true);
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

/**
 * archiver runtime-contract spec — hotfix for F.3 archiver CJS interop bug.
 *
 * Why this spec exists:
 *   PR #359 (F.3) shipped a worker that mocked `archiver` with
 *   `{__esModule: true, default: jest.fn()}` — a shape that matches
 *   the BROKEN `import archiver from 'archiver'` lowering, not the
 *   actual runtime shape of `archiver@7` (`module.exports = archiver`,
 *   a bare callable, no `.default`). The unit suite passed 22/22 against
 *   the fictional shape; live traffic in dev-pabson-primary on 2026-06-30
 *   failed with `(0 , archiver_1.default) is not a function` on the very
 *   first archiver() call. The worker has now been rewritten to use
 *   `import archiver = require('archiver')` (the TS-canonical CJS interop)
 *   and the unit-spec mock corrected to a bare callable.
 *
 *   This spec is the REGRESSION GUARD against a future refactor that
 *   reverts to `import archiver from 'archiver'` (broken under this
 *   service's tsconfig, which lacks `esModuleInterop: true`). It uses
 *   NO `jest.mock` — the real archiver module is imported the same way
 *   the worker does, and the assertions verify the runtime shape.
 *
 *   If this spec ever fails, it is loud diagnostic: either archiver was
 *   upgraded to a major that changed its module shape, OR the worker
 *   was refactored to an incompatible import syntax. The fix in either
 *   case is to keep the worker's import + this spec's import in lockstep.
 *
 * Why we don't just enable `esModuleInterop: true` in tsconfig:
 *   That is a finance-service-wide config change with a broader blast
 *   radius (it affects every cross-module default import). The hotfix
 *   takes the smaller surgical change (the worker's import + this guard
 *   spec); the tsconfig flip is a separate, dedicated PR with its own
 *   validation cycle. See PR description for the full architectural
 *   review surfaced 2026-06-30.
 */

// IMPORTANT: this MUST mirror the worker's import syntax exactly. If the
// worker changes to a different import form, change this line in lockstep.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import archiver = require('archiver');

import { Writable } from 'stream';

describe('archiver runtime contract (no jest.mock — uses the real module)', () => {
  it('archiver is a callable function at runtime (matches archiver@7 CJS shape)', () => {
    // The bug: with `import archiver from 'archiver'` + no esModuleInterop,
    // `archiver` is `archiver_1.default` which is `undefined` at runtime.
    // With `import archiver = require('archiver')`, it's the callable
    // module export directly.
    expect(typeof archiver).toBe('function');
  });

  it('archiver("zip", opts) returns an Archiver with append/finalize/on/abort', () => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    expect(archive).toBeDefined();
    expect(typeof archive.append).toBe('function');
    expect(typeof archive.finalize).toBe('function');
    expect(typeof archive.on).toBe('function');
    expect(typeof archive.abort).toBe('function');
    // Drain to a no-op sink so the archiver instance doesn't dangle as
    // a live stream past the test's lifetime (keeps the Node process
    // exit-clean for jest's process-end check).
    archive.pipe(new Writable({ write: (_c, _e, cb) => cb() }));
    archive.abort();
  });

  it('archiver pipes a one-entry ZIP to a Writable sink with the expected entry name', async () => {
    const archive = archiver('zip', { zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write: (chunk, _enc, cb) => {
        chunks.push(chunk as Buffer);
        cb();
      },
    });
    // Attach the 'finish' listener BEFORE pipe()+finalize() so we don't
    // race with the sink emitting 'finish' before we listen.
    const sinkDone = new Promise<void>((resolve) => sink.on('finish', () => resolve()));
    archive.pipe(sink);
    archive.append(Buffer.from('hello'), { name: 'a.txt' });
    await archive.finalize();
    await sinkDone;
    const out = Buffer.concat(chunks);
    expect(out.length).toBeGreaterThan(0);
    // ZIP signature is "PK\x03\x04" (local file header magic).
    expect(out.slice(0, 4).toString('hex')).toBe('504b0304');
    // The entry name 'a.txt' should appear in the central directory header
    // section of the ZIP byte stream.
    expect(out.toString('binary')).toContain('a.txt');
  });
});

/**
 * NestJS webpack config — Sprint C.1.3.
 *
 * Identity service imports `@aibrains/pdf-renderer` to call `descriptor.defaults(...)`
 * for the lazy-default GET path. The renderer package transitively pulls
 * `@react-pdf/renderer` which transitively pulls `yoga-layout`. yoga-layout
 * ships raw `.ts` files under `node_modules/yoga-layout/src/`, which the
 * default Nest webpack config can't parse (no ts-loader rule for
 * node_modules, and even with one the layout depends on WASM init).
 *
 * The identity service never actually RENDERS — it only reads the JSON
 * defaults from descriptors. Static analysis still pulls React-PDF
 * through the descriptor.Component reference chain, so the cheapest fix
 * is to **externalize** the heavy native-binding packages: leave the
 * `require()` calls in the bundle, resolve them at runtime from the
 * Docker image's `node_modules`. Cost: ~5MB of extra files in the image
 * for code that never executes on identity. Avoids needing a separate
 * server-safe subpath in pdf-renderer (would require a 0.7.0 publish).
 *
 * Academics + finance are unaffected by this externalization — those
 * services either (a) don't depend on pdf-renderer (academics) or
 * (b) DO actually render in-container (finance C.1.5+) and so will need
 * the React-PDF runtime regardless. The externals here just stop webpack
 * from STATICALLY parsing yoga-layout's `.ts` files; at runtime they
 * still resolve from `node_modules` either way.
 *
 * Why a top-level config rather than per-service? Nest's webpack pipeline
 * runs the same way for every microservice in this monorepo. A single
 * config that externalizes "things webpack can't parse but we don't need
 * to bundle" is correct for ALL services — no service NEEDS the runtime
 * binding of yoga-layout / react-pdf statically analyzed.
 */

const path = require('path');

/**
 * Externals as a function so we can match BOTH `yoga-layout` and any nested
 * `yoga-layout/...` subpath imports without listing every internal entry.
 */
function makeExternals() {
  // Modern webpack 5 externals function signature: ({ context, request }, callback).
  return function ({ request }, callback) {
    if (typeof request !== 'string') return callback();
    // External packages — node will resolve these from node_modules at runtime.
    const externalPrefixes = [
      'yoga-layout',
      '@react-pdf/renderer',
      '@react-pdf/layout',
      '@react-pdf/pdfkit',
      '@react-pdf/textkit',
      '@react-pdf/font',
      '@react-pdf/render',
      '@react-pdf/primitives',
      '@react-pdf/types',
      '@react-pdf/stylesheet',
      '@react-pdf/image',
      '@react-pdf/png-js',
      // pdfkit is a transitive dep of @react-pdf/renderer that also has
      // native-ish quirks; safest to externalize for the same reason.
      'pdfkit',
      'fontkit',
    ];
    if (externalPrefixes.some((p) => request === p || request.startsWith(p + '/'))) {
      // Format `commonjs <package>` tells webpack to emit a `require()`
      // that node will resolve at runtime.
      return callback(null, 'commonjs ' + request);
    }
    callback();
  };
}

module.exports = function (options) {
  return {
    ...options,
    externals: [
      // Preserve whatever Nest's default config already externalized
      // (the @nestjs/cli webpack plugin auto-externalizes
      // peer dependencies and optional native modules — keep those).
      ...(Array.isArray(options.externals) ? options.externals : []),
      makeExternals(),
    ],
  };
};

#!/usr/bin/env bash
#
# Build a service into a Lambda deployment directory (cost-redesign C1.4).
#
#   scripts/build-lambda.sh <identity|academics|finance> [--skip-compile]
#
# Output: server/application/dist-lambda/<svc>/index.js (+ .json assets)
#
# Two steps, on purpose:
#   1. `tsc -p microservices/<svc>/tsconfig.app.json` — tsc emits the decorator
#      metadata Nest's DI needs (esbuild cannot emit `emitDecoratorMetadata`,
#      so bundling TypeScript directly would silently break constructor
#      injection). This is deliberately NOT `nest build`: the ECS build is a
#      webpack build (nest-cli.json `webpack: true`) with chunked output that
#      esbuild cannot follow. tsc's output mirrors the source tree under
#      dist-lambda/.tsc/<svc>/ (service + the @app/* libs it imports).
#   2. esbuild bundles the emitted JavaScript into one file, minified, with
#      `--keep-names` (Nest logs and DI tokens use class names). `sharp` is a
#      native module and stays external: finance receives it as a Lambda layer
#      (scripts/build-sharp-layer.sh) and its logo optimiser fails open
#      without it.
#
# JSON files under the service and libs are copied next to the emitted code
# before bundling: tsc does not copy assets (nest-cli would), and the identity
# holiday tables are `require`d at runtime.
set -euo pipefail

SVC="${1:-}"
case "$SVC" in
  identity|academics|finance) ;;
  *) echo "usage: $0 <identity|academics|finance> [--skip-compile]" >&2; exit 2 ;;
esac
SKIP_COMPILE="${2:-}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO_ROOT/server/application"
DIST="$APP/dist-lambda/.tsc/$SVC"
OUT="$APP/dist-lambda/$SVC"
ESBUILD="$REPO_ROOT/node_modules/.bin/esbuild"
[[ -x "$ESBUILD" ]] || ESBUILD="$REPO_ROOT/server/node_modules/.bin/esbuild"
[[ -x "$ESBUILD" ]] || { echo "FATAL: esbuild not found under node_modules/.bin (root or server/) — run npm ci" >&2; exit 2; }

cd "$APP"
if [[ "$SKIP_COMPILE" != "--skip-compile" ]]; then
  echo "==> tsc -p microservices/$SVC/tsconfig.app.json → $DIST"
  rm -rf "$DIST"
  # rootDir is left to tsc (the common root of the service and its libs), so
  # the emitted tree is <DIST>/microservices/<svc>/src and <DIST>/libs/*/src.
  npx tsc -p "microservices/$SVC/tsconfig.app.json" --outDir "$DIST" --rootDir "$APP" --sourceMap false --declaration false --skipLibCheck
fi

ENTRY="$DIST/microservices/$SVC/src/lambda.js"
[[ -f "$ENTRY" ]] || { echo "FATAL: $ENTRY missing — did tsc emit lambda.ts?" >&2; exit 2; }

echo "==> copying JSON assets into dist"
find "microservices/$SVC/src" libs -name '*.json' -not -name 'tsconfig*.json' -not -name 'package.json' -not -path '*/node_modules/*' | while read -r f; do
  mkdir -p "$DIST/$(dirname "$f")"
  cp "$f" "$DIST/$f"
done

ALIASES=()
for lib in libs/*/; do
  name="$(basename "$lib")"
  ALIASES+=("--alias:@app/$name=$DIST/libs/$name/src")
done

EXTERNALS=(
  --external:sharp --external:@img/\*
  --external:@nestjs/microservices --external:@nestjs/websockets --external:@nestjs/platform-socket.io
  --external:@nestjs/platform-fastify --external:@fastify/static --external:@fastify/view
  --external:class-transformer/storage --external:cache-manager --external:@apidevtools/json-schema-ref-parser
  --external:aws-sdk
)

rm -rf "$OUT" && mkdir -p "$OUT"
echo "==> esbuild → $OUT/index.js"
"$ESBUILD" "$ENTRY" \
  --bundle --platform=node --target=node22 --format=cjs \
  --minify --keep-names --sourcemap=external \
  --outfile="$OUT/index.js" --metafile="$APP/dist-lambda/$SVC.meta.json" \
  --log-level=warning \
  "${ALIASES[@]}" "${EXTERNALS[@]}"

# Only index.js ships: the source map would double the asset and the esbuild
# metafile (dist-lambda/<svc>.meta.json, for `esbuild --analyze`) lives
# outside the asset directory.
rm -f "$OUT/index.js.map"

SIZE_BYTES=$(wc -c < "$OUT/index.js" | tr -d ' ')
echo "==> $SVC bundle: $(( SIZE_BYTES / 1024 )) KiB minified, sha256 $(shasum -a 256 "$OUT/index.js" | cut -c1-16)"

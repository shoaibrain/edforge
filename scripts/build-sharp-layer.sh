#!/usr/bin/env bash
#
# Build the `sharp` Lambda layer for the finance function (cost-redesign C1.4).
#
#   scripts/build-sharp-layer.sh
#
# Output: server/application/dist-lambda/layers/sharp/nodejs/node_modules/sharp
#
# `sharp` is native; esbuild cannot bundle it and the version installed on a
# Mac carries darwin binaries. The layer is installed for the Lambda platform
# (linux x64, glibc) with npm's cross-platform flags, pinned to the version in
# server/application/package.json. Finance's PdfLogoOptimizerService fails open
# (original logo URL) when the module is missing, so a broken layer degrades
# logos rather than PDFs — but the layer must exist for parity with ECS.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO_ROOT/server/application"
OUT="$APP/dist-lambda/layers/sharp/nodejs"
VERSION="$(node -e 'console.log(require(process.argv[1]).dependencies.sharp)' "$APP/package.json")"
[[ -n "$VERSION" ]] || { echo "FATAL: sharp is not a dependency of server/application" >&2; exit 2; }

rm -rf "$OUT" && mkdir -p "$OUT"
cd "$OUT"
printf '{"name":"edforge-sharp-layer","private":true}\n' > package.json
echo "==> installing sharp@$VERSION for linux/x64 (glibc) into $OUT"
npm install --no-save --no-audit --no-fund --ignore-scripts \
  --os=linux --cpu=x64 --libc=glibc \
  "sharp@$VERSION" >/dev/null

if ls node_modules/@img/ | grep -q '^sharp-linux-x64'; then
  echo "==> ok: $(ls node_modules/@img/ | grep 'linux-x64' | tr '\n' ' ')"
else
  echo "FAIL: no @img/sharp-linux-x64* package installed" >&2; exit 1
fi
rm -f package.json package-lock.json
du -sh "$OUT" | cut -f1 | xargs echo "==> layer size:"

#!/usr/bin/env bash
#
# Guard for a built Lambda bundle (cost-redesign C1.4).
#
#   scripts/ci/check-lambda-bundle.sh <identity|academics|finance>
#
# Asserts, for server/application/dist-lambda/<svc>/index.js:
#   - it exists and is under the size ceiling (12 MiB minified);
#   - Nest decorator metadata survived bundling (`design:paramtypes`) — the
#     symptom of bundling TypeScript with esbuild instead of the tsc output is
#     its absence, and the failure mode is DI resolving `undefined`;
#   - `sharp` is referenced only as an external require, never inlined;
#   - the file loads under Node (syntax / top-level require resolution).
set -euo pipefail

SVC="${1:-}"
[[ -n "$SVC" ]] || { echo "usage: $0 <svc>" >&2; exit 2; }
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="$REPO_ROOT/server/application/dist-lambda/$SVC/index.js"
MAX_BYTES=$((12 * 1024 * 1024))
FAIL=0

[[ -f "$BUNDLE" ]] || { echo "FAIL: $BUNDLE does not exist" >&2; exit 1; }

SIZE=$(wc -c < "$BUNDLE" | tr -d ' ')
if (( SIZE > MAX_BYTES )); then echo "FAIL: bundle is $SIZE bytes (> $MAX_BYTES)"; FAIL=1; else echo "ok: size $SIZE bytes"; fi

if grep -q 'design:paramtypes' "$BUNDLE"; then echo "ok: decorator metadata present"; else echo "FAIL: no design:paramtypes in bundle — Nest DI would receive undefined"; FAIL=1; fi

if grep -qE 'require\("sharp"\)' "$BUNDLE"; then echo "ok: sharp stays an external require"; else echo "warn: no external require(\"sharp\") found (expected for finance)"; fi
if grep -q '@img/sharp-' "$BUNDLE"; then echo "FAIL: a sharp platform package was inlined"; FAIL=1; fi

# Load it from a directory with no node_modules anywhere above it: in Lambda
# only index.js ships, so a top-level require of anything left external
# (Nest optional peers, aws-sdk v2) must fail HERE, not in the cold start.
ISOLATED="$(mktemp -d)"
cp "$BUNDLE" "$ISOLATED/index.js"
if (cd "$ISOLATED" && EDFORGE_RUNTIME=lambda node -e 'require("./index.js"); console.log("ok: bundle loads in isolation (no node_modules)")'); then :; else echo "FAIL: bundle does not load in isolation — a required module was left external"; FAIL=1; fi
rm -rf "$ISOLATED"

exit $FAIL

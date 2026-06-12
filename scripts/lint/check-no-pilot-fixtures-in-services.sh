#!/usr/bin/env bash
#
# S1.13 — workspace-only guard for @edforge/pilot-fixtures.
#
# pilot-fixtures (incl. its demo data engine) is a PRIVATE workspace package.
# A Docker-built ECS service that imports it will fail `npm install` in the
# isolated build (the workspace symlink is invisible) with TS2305 / "Cannot
# find module '@edforge/pilot-fixtures'". It is fine for CLI scripts + Lambdas
# (esbuild bundles them) but never for a service.
#
# This guard fails if any microservice source imports it. Run locally or in CI:
#   bash scripts/lint/check-no-pilot-fixtures-in-services.sh
#   bash scripts/lint/check-no-pilot-fixtures-in-services.sh --self-test
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCOPE="$ROOT/server/application/microservices"
# Match real module specifiers only (from/import()/require() + a quote char),
# so JSDoc comments that merely mention the package are not flagged.
PATTERN_RE="(from|import\(|require\()[[:space:]]*.@edforge/pilot-fixtures"

scan() {
  local dir="$1"
  [ -d "$dir" ] || { echo "scope not found: $dir" >&2; return 2; }
  grep -rnE --include='*.ts' -- "$PATTERN_RE" "$dir" || true
}

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/microservices/x/src"
  printf "import { buildDemoTenant } from '@edforge/pilot-fixtures';\n" > "$tmp/microservices/x/src/bad.ts"
  printf "// mentions @edforge/pilot-fixtures in a comment only\n" > "$tmp/microservices/x/src/ok.ts"
  found="$(grep -rnE --include='*.ts' -- "$PATTERN_RE" "$tmp/microservices" || true)"
  if [ -n "$found" ] && ! echo "$found" | grep -q 'ok.ts'; then
    echo "self-test OK: guard flags the import, ignores the comment"
    exit 0
  fi
  echo "self-test FAILED: guard mis-detected (got: $found)" >&2
  exit 1
fi

hits="$(scan "$SCOPE")"
if [ -n "$hits" ]; then
  echo "ERROR: a Docker-built service imports @edforge/pilot-fixtures (workspace-only — breaks the ECS Docker build):" >&2
  echo "$hits" >&2
  exit 1
fi
echo "OK: no microservice imports @edforge/pilot-fixtures"

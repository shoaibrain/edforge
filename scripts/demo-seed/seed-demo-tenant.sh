#!/usr/bin/env bash
# Demo tenant seeder wrapper — Sprint S1.11.
# Anchors to the repo root regardless of cwd, then runs the TS seeder via
# ts-node with CommonJS module resolution (so the @edforge/* workspace
# packages resolve), passing through all flags (--dry-run, --reset, etc).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/demo-seed/seed-demo-tenant.ts "$@"

#!/usr/bin/env bash
#
# check-invariant-12.sh — Sprint 0.4.6 (V1 Master EPIC Breakdown)
#
# Enforces the amended Invariant 12:
#   "No service-code branches on `tenant.archetype`, EXCLUDING boundary
#    drivers + data-driven lookups + field declarations + known tech-debt
#    files explicitly listed in the allowlist."
#
# This script greps for the literal string `archetype` (case-insensitive)
# across `server/application/microservices/*/src/`. Every hit must be in
# a file listed in `scripts/lint/invariant-12-allowlist.txt`, OR the
# script exits 1 with structured output.
#
# Why a string grep (vs. an AST/eslint rule)?
#   - Fast, no JS dependency, runs in CI as a single bash invocation
#   - Catches more than just `===` branches (string interpolation,
#     `switch` cases, object-literal keys)
#   - The allowlist of legitimate files is small + slow-growing, so
#     allowlist-based gating is sustainable
#
# Adding a new legitimate use:
#   1. Justify the new file's use of `archetype` (boundary? data-driven? test fixture?)
#   2. Add the path to `scripts/lint/invariant-12-allowlist.txt` with a category tag (B/D/F/T)
#   3. Commit allowlist update in the same PR as the new code
#
# Exit codes:
#   0  — clean (no unexpected files)
#   1  — invariant violation (new file references archetype without allowlist entry)
#   2  — usage/setup error (allowlist missing, repo root wrong)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAN_ROOT="$REPO_ROOT/server/application/microservices"
ALLOWLIST="$REPO_ROOT/scripts/lint/invariant-12-allowlist.txt"

if [[ ! -d "$SCAN_ROOT" ]]; then
  echo "ERROR: scan root not found: $SCAN_ROOT" >&2
  exit 2
fi
if [[ ! -f "$ALLOWLIST" ]]; then
  echo "ERROR: allowlist not found: $ALLOWLIST" >&2
  exit 2
fi

# Read allowlist into an array, stripping comments + blank lines.
# Use while-read for bash 3.2 compatibility (macOS default; mapfile is bash 4+).
allowed=()
while IFS= read -r line; do
  allowed+=("$line")
done < <(grep -v '^[[:space:]]*\(#\|$\)' "$ALLOWLIST" | sed 's/[[:space:]]*$//')

# Grep every microservice src/ subtree for `archetype` (case-insensitive),
# filtering to .ts files. Each hit produces one file path on stdout.
hits=()
while IFS= read -r line; do
  hits+=("$line")
done < <(
  find "$SCAN_ROOT" \
    -type d \( -name node_modules -o -name dist -o -name '__snapshots__' \) -prune -o \
    -type f -name '*.ts' -print \
    | xargs grep -lEi 'archetype' 2>/dev/null \
    | sed "s|^$REPO_ROOT/||" \
    | sort -u
)

violations=()
if [[ ${#hits[@]} -gt 0 ]]; then
  for file in "${hits[@]}"; do
    # Allowlist check — exact match required (no glob support, intentional).
    if ! printf '%s\n' "${allowed[@]}" | grep -qxF "$file"; then
      violations+=("$file")
    fi
  done
fi

if [[ ${#violations[@]} -gt 0 ]]; then
  cat <<EOF >&2

==========================================================================
Invariant 12 violation — ${#violations[@]} file(s) reference 'archetype'
                          without being in the allowlist.
==========================================================================

Files:
EOF
  printf '  - %s\n' "${violations[@]}" >&2
  cat <<EOF >&2

If the use is legitimate (boundary driver, data-driven lookup, field
declaration, or documented tech debt), add the file to:
  scripts/lint/invariant-12-allowlist.txt
with an appropriate category tag (B/D/F/T) and a one-line justification
nearby in the file's comments.

If the use is a real archetype branch in service code, refactor to
data-driven lookup via ArchetypeDefaults (Sprint 0.4) before merging.

==========================================================================
EOF
  exit 1
fi

echo "Invariant 12 lint OK — ${#hits[@]} files scanned; all legitimate uses allowlisted."
exit 0

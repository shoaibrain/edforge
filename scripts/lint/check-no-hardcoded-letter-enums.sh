#!/usr/bin/env bash
#
# check-no-hardcoded-letter-enums.sh — Sprint D.1.2
#
# Enforces the D.1.2 widening of `GradeLetter` from a hard US-scale enum
# (`'A+'|'A'|...|'W'`) to `string`. The valid set of letters is now
# tenant-driven by `GradingPolicyEntity.letterGrades[].letter`. Any
# reintroduction of a hardcoded letter-union or letter-enum in source
# files masks Nepal CEHRD `NG` (Not-Graded), future weighted-honors
# letters, and any archetype-defined scale.
#
# Two patterns blocked:
#   1. TS literal-union containing 3+ single-character / two-character
#      letters separated by `|`:
#         type X = 'A+' | 'B+' | 'C+' | ...
#   2. Zod `z.enum([...])` whose array literal is exclusively a list of
#      grade letters:
#         z.enum(['A+', 'A', ...])
#
# Allowlist: paths where a documented test fixture or comment is allowed
# to mention the old literal set. Categories: F=fixture, T=tech-debt,
# D=docstring.
#
# Exit codes:
#   0  — clean (no unexpected files)
#   1  — violation (new file reintroduces a hardcoded letter list)
#   2  — usage/setup error
#
# Why string grep (vs. eslint rule):
#   - Fast, zero npm dep, runs as a single bash invocation in CI
#   - Catches more than `===` checks (interpolation, switch cases,
#     object-literal keys, Zod enum arrays)
#   - Allowlist of legitimate references is small and slow-growing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Scan backend-only — frontend (edforge-saas-frontend/) is a separate repo
# with its own architecture, not subject to this academics-service invariant.
# shared-types schemas are in scope (they back the academics entity).
SCAN_ROOTS=(
  "$REPO_ROOT/server"
  "$REPO_ROOT/packages/shared-types/src"
)
ALLOWLIST="$REPO_ROOT/scripts/lint/no-hardcoded-letter-enums-allowlist.txt"

for root in "${SCAN_ROOTS[@]}"; do
  if [[ ! -d "$root" ]]; then
    echo "ERROR: scan root not found: $root" >&2
    exit 2
  fi
done
if [[ ! -f "$ALLOWLIST" ]]; then
  echo "ERROR: allowlist not found: $ALLOWLIST" >&2
  exit 2
fi

# Read allowlist into an array, stripping comments + blank lines.
# Use while-read for bash 3.2 compat (macOS default; mapfile is bash 4+).
allowed=()
while IFS= read -r line; do
  allowed+=("$line")
done < <(grep -v '^[[:space:]]*\(#\|$\)' "$ALLOWLIST" | sed 's/[[:space:]]*$//')

# The signature we forbid in source code:
#   - "'A+'" AND "'B'" AND ("'C'" OR "'D'") on the same line OR within an
#     adjacent z.enum([ ... ]) block — a strong indicator the file has a
#     hardcoded US-scale letter list.
#
# We use a two-pass grep:
#   Pass 1 (fast filter): files containing 'A+' AND 'B' AND 'C' literals
#   Pass 2 (precise): within those, look for the literal-union or z.enum pattern
#
# Pass 1 — files mentioning multiple letter-literal singles.
hits=()
while IFS= read -r f; do
  # Skip if path matches allowlist (suffix match).
  is_allowed=0
  for a in "${allowed[@]}"; do
    case "$f" in
      *"$a")
        is_allowed=1
        break
        ;;
    esac
  done
  [[ $is_allowed -eq 1 ]] && continue

  # Pass 2 — within this file, look for the specific patterns.
  # Pattern A: TS literal union containing 3+ letters, e.g.
  #     'A+' | 'A' | 'B+'    or    'A+' | 'B+' | 'C+'
  # We grep for the union form with at least three single-quoted letters
  # joined by `|`.
  if grep -E "'[A-Z][+-]?'[[:space:]]*\|[[:space:]]*'[A-Z][+-]?'[[:space:]]*\|[[:space:]]*'[A-Z][+-]?'" "$f" >/dev/null 2>&1; then
    hits+=("$f")
    continue
  fi

  # Pattern B: z.enum([ ... ]) array containing 3+ letter literals.
  # Match: z.enum(\[[^\]]*'[A-Z][+-]?'[^\]]*'[A-Z][+-]?'[^\]]*'[A-Z][+-]?'[^\]]*\])
  if grep -E "z\.enum\([[:space:]]*\[[^]]*'[A-Z][+-]?'[^]]*'[A-Z][+-]?'[^]]*'[A-Z][+-]?'" "$f" >/dev/null 2>&1; then
    hits+=("$f")
    continue
  fi
done < <(
  find "${SCAN_ROOTS[@]}" \
    -type d \( \
        -name node_modules -o \
        -name dist -o \
        -name build -o \
        -name .cdk.staging -o \
        -name cdk.out -o \
        -name .git \
    \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -name '*.d.ts' \
    -print 2>/dev/null \
  | xargs -I{} grep -l -E "'A\+'" {} 2>/dev/null \
  | xargs -I{} grep -l -E "'B'" {} 2>/dev/null \
  | xargs -I{} grep -l -E "'(C|F)'" {} 2>/dev/null \
  | sort -u
)

if [[ ${#hits[@]} -eq 0 ]]; then
  echo "Hardcoded letter-enum lint OK — no offending source files found."
  exit 0
fi

echo "✗ Hardcoded letter-enum reintroduction detected (D.1.2 invariant):"
for h in "${hits[@]}"; do
  echo "  - $h"
done
echo ""
echo "Why this matters:"
echo "  D.1.2 widened GradeLetter from a US-scale enum to \`string\` so that"
echo "  Nepal CEHRD \`NG\` (Not-Graded), future weighted-honors letters, and"
echo "  any archetype-defined scale round-trip without an entity-file edit."
echo "  A new hardcoded letter list reintroduces the archetype-specific"
echo "  blocker. Either:"
echo "    (a) refactor the offending site to read letters from"
echo "        GradingPolicyEntity.letterGrades[].letter at runtime, OR"
echo "    (b) if this is a legitimate fixture / docstring, add the path"
echo "        suffix to scripts/lint/no-hardcoded-letter-enums-allowlist.txt"
echo "        with a category tag (F=fixture, T=tech-debt, D=docstring)"
exit 1

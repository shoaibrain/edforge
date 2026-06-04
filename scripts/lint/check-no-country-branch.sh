#!/usr/bin/env bash
#
# check-no-country-branch.sh — Sprint GB1.4 (Governance-Body Archetype Framework)
#
# Enforces the CLAUDE.md "Archetype model" rule: **branch on `archetype`, never
# on `country`.** A future Nepal governance body (CBS, NGO-run) is also
# `country=NPL`, so any `country === 'NPL'`-style branch in runtime service code
# silently mis-applies PABSON behavior to it. The canonical example was the
# 2026-06-04 `schools.service.ts` calendar branch (`countryCode === 'NPL' ?
# 'bikram_sambat' : 'gregorian'`), removed in GB1.1; this gate prevents its
# reintroduction.
#
# What is flagged (in `server/application/microservices/**/src/**`, non-spec):
#   - a country-code literal in a comparison:   x === 'NPL'   |   'NPL' !== x
#   - a switch on a country-code literal:        case 'NPL':
#
# What is NOT flagged (legitimate, country-keyed data — the fallback layer):
#   - object keys / property access:  `NPL: { … }`, `COUNTRY_CONFIG_OVERRIDES.NPL`
#   - values / arguments:             `country: 'NPL'`, `getDefaultConfigForCountry('NPL')`
#   - comments / identifiers:         `// … NPL …`, `IEMIS_NPL_CEHRD_FLASH_I`
#
# Escape hatches:
#   - per-line:  add `// allow-country-branch: <reason>` to the offending line.
#   - per-file:  add the path SUFFIX to scripts/lint/no-country-branch-allowlist.txt.
#
# Usage:
#   scripts/lint/check-no-country-branch.sh            # scan the tree
#   scripts/lint/check-no-country-branch.sh --self-test  # run positive/negative fixtures
#
# Exit codes: 0 clean · 1 violation · 2 usage/setup error.
#
# Why string grep (vs. eslint rule): matches the repo's existing invariant
# linters (check-invariant-12.sh, check-no-hardcoded-letter-enums.sh) — fast,
# zero npm dep, runs as a single bash invocation in CI, with a small allowlist.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$REPO_ROOT/scripts/lint/no-country-branch-allowlist.txt"
INLINE_DISABLE="allow-country-branch:"

# Country-code literals that must not be branched on. PABSON + future Nepal
# bodies are all NPL — extend this list as new single-country archetypes appear.
FORBIDDEN_COUNTRIES=("NPL")

# Build the forbidden regex: a CC literal adjacent to ===/!== (either side) or a
# `case` label. Single-quoted or double-quoted.
build_regex() {
  local parts=()
  local cc
  for cc in "${FORBIDDEN_COUNTRIES[@]}"; do
    parts+=("(===|!==)[[:space:]]*['\"]${cc}['\"]")
    parts+=("['\"]${cc}['\"][[:space:]]*(===|!==)")
    parts+=("case[[:space:]]+['\"]${cc}['\"]")
  done
  local IFS='|'
  echo "${parts[*]}"
}
REGEX="$(build_regex)"

# ----------------------------------------------------------------------------
# Self-test: the regex must catch the anti-pattern and spare legitimate uses.
# ----------------------------------------------------------------------------
if [[ "${1:-}" == "--self-test" ]]; then
  fail=0
  should_match=(
    "if (countryCode === 'NPL') {"
    "calendarSystem: country === 'NPL' ? 'bikram_sambat' : 'gregorian',"
    "if ('NPL' === country) {"
    "if (country !== 'NPL') return;"
    "    case 'NPL':"
    "if (addr.country === \"NPL\") {"
  )
  should_not_match=(
    "  NPL: { defaultCurrency: 'NPR' },"
    "  PABSON: COUNTRY_CONFIG_OVERRIDES.NPL,"
    "      country: 'NPL',"
    "  // Archetype wins over country (PABSON beats NPL when both set)."
    "  IEMIS_NPL_CEHRD_FLASH_I: 'v1',"
    "    const cfg = getDefaultConfigForCountry('NPL');"
    "      expect(res.data.country).toBe('NPL');"
  )
  for s in "${should_match[@]}"; do
    if ! echo "$s" | grep -qE "$REGEX"; then
      echo "SELF-TEST FAIL (expected match): $s"; fail=1
    fi
  done
  for s in "${should_not_match[@]}"; do
    if echo "$s" | grep -qE "$REGEX"; then
      echo "SELF-TEST FAIL (false positive): $s"; fail=1
    fi
  done
  if [[ $fail -eq 0 ]]; then
    echo "check-no-country-branch self-test OK (${#should_match[@]} positive, ${#should_not_match[@]} negative)."
    exit 0
  fi
  exit 1
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown argument '$1' (use --self-test or no args)" >&2
  exit 2
fi

SCAN_ROOT="$REPO_ROOT/server/application/microservices"
if [[ ! -d "$SCAN_ROOT" ]]; then
  echo "ERROR: scan root not found: $SCAN_ROOT" >&2
  exit 2
fi
if [[ ! -f "$ALLOWLIST" ]]; then
  echo "ERROR: allowlist not found: $ALLOWLIST" >&2
  exit 2
fi

allowed=()
while IFS= read -r line; do
  allowed+=("$line")
done < <(grep -v '^[[:space:]]*\(#\|$\)' "$ALLOWLIST" | sed 's/[[:space:]]*$//')

violations=()
while IFS= read -r f; do
  is_allowed=0
  for a in "${allowed[@]}"; do
    case "$f" in
      *"$a") is_allowed=1; break ;;
    esac
  done
  [[ $is_allowed -eq 1 ]] && continue

  # Matching lines, minus those carrying the inline-disable marker.
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    case "$hit" in
      *"$INLINE_DISABLE"*) continue ;;
    esac
    violations+=("${f#"$REPO_ROOT/"}:$hit")
  done < <(grep -nE "$REGEX" "$f" 2>/dev/null || true)
done < <(
  find "$SCAN_ROOT" \
    -type d \( -name node_modules -o -name dist -o -name build \) -prune -o \
    -type f -name '*.ts' -not -name '*.d.ts' -not -name '*.spec.ts' \
    -print 2>/dev/null | sort -u
)

if [[ ${#violations[@]} -eq 0 ]]; then
  echo "country-branch lint OK — no '=== ${FORBIDDEN_COUNTRIES[*]}'-style branches in runtime service code."
  exit 0
fi

echo "✗ country-branch anti-pattern detected (GB1 / CLAUDE.md 'Archetype model'):"
for v in "${violations[@]}"; do
  echo "  $v"
done
echo ""
echo "Branch on \`archetype\`, never on \`country\`. A future Nepal governance body"
echo "(CBS, NGO-run) is also country=NPL and would inherit PABSON behavior."
echo "Resolve by one of:"
echo "  (a) branch on the tenant archetype instead (e.g."
echo "      getGovernanceProfile(archetype).regional.* — see schools.service.ts), OR"
echo "  (b) if this is a legitimate country-keyed lookup, restructure it as data"
echo "      access (COUNTRY_DEFAULTS[country]) rather than an equality branch, OR"
echo "  (c) genuinely-justified exception: add \`// allow-country-branch: <reason>\`"
echo "      to the line, or the file's path suffix to"
echo "      scripts/lint/no-country-branch-allowlist.txt."
exit 1

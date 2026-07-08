#!/usr/bin/env bash
#
# check-deploy-evidence-hygiene.sh
#
# Raw deploy evidence often contains operator-specific identifiers: account IDs,
# ARNs, tenant UUIDs, JWT-derived claims, presigned URLs, emails, hostnames, and
# smoke-test payloads. Keep raw evidence local/private; track only the sanitized
# docs/deploys/INDEX.md policy and curated summaries if this allowlist is
# intentionally expanded in a future PR.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

allowed_path() {
  case "$1" in
    docs/deploys/INDEX.md) return 0 ;;
    *) return 1 ;;
  esac
}

fail=0

while IFS= read -r path; do
  if ! allowed_path "$path"; then
    echo "ERROR: tracked deploy evidence is not allowed: $path" >&2
    fail=1
  fi
done < <(git -C "$REPO_ROOT" ls-files 'docs/deploys/*')

if git -C "$REPO_ROOT" ls-files 'docs/deploys/*' | grep -Eq '\.(log|csv)$'; then
  echo "ERROR: raw .log/.csv deploy evidence is tracked under docs/deploys." >&2
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  cat >&2 <<'EOF'

Raw deploy logs and CSVs must stay outside tracked source. Use a private/local
path such as ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}, then add only a
sanitized summary to docs/deploys/INDEX.md.
EOF
fi

exit "$fail"

# Deploy Evidence Index

Tracked source must not contain raw deployment logs, smoke-test transcripts,
JWT-derived claims, tenant UUIDs, account IDs, ARNs, presigned URLs, operator
emails, or environment-specific hostnames.

Raw deploy output belongs in a local/private evidence store such as
`$EDFORGE_DEPLOY_LOG_DIR` or `/tmp/edforge-deploys`. Summaries may be added to
this file only after they are manually redacted and are useful as durable public
project history.

## Current Policy

- `docs/deploys/INDEX.md` is the only tracked file allowed in this directory by
  default.
- Do not force-add `.log`, `.csv`, or ad-hoc deploy prompt files under
  `docs/deploys/`.
- When a deploy needs review evidence, keep raw output private and add a short
  sanitized note here with commit/PR numbers, high-level outcome, validation
  status, and follow-up work.
- Run `npm run lint:deploy-evidence` before opening a PR that touches deploy
  evidence.

## Sanitized Timeline

Detailed historical raw logs and closeout files were removed from tracked
source after the July 2026 source-hygiene review because they contained
operator-specific deployment evidence. Durable status should be reconstructed
from merged PRs, release notes, private deploy logs, and sanitized entries added
here going forward.

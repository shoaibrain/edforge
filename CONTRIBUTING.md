# Contributing to EdForge

Thanks for your interest in EdForge.

This repository is **source-available**, not open source. EdForge is licensed
under the Business Source License 1.1 — see [LICENSE](LICENSE) — and converts
to Apache License, Version 2.0 on the Change Date specified there. Reading
the source, running it for your own organization (including a for-profit
school or school network), and proposing changes are all welcome. Using
EdForge to offer a hosted or managed service to third parties is not — see
the Additional Use Grant in LICENSE.

## How we work in the open

EdForge is built in public by a small team led by **Edforge Technologies LLC**.
That has a few implications for how this repository is run:

- **The roadmap is owner-driven.** We do not accept feature-request issues.
  If you have a proposal, the right entry point is a Discussion (not an
  Issue), framed as a use-case rather than a spec.
- **Bug reports are welcome**, especially with a minimal reproducer. Please
  use the Issues template — be specific about your environment, EdForge
  version (commit SHA), and what you expected versus what happened.
- **Security issues are handled separately.** Do not file public issues for
  vulnerabilities. See [SECURITY.md](SECURITY.md) when it lands, or until
  then email the address on the project's GitHub profile.
- **Pull requests are reviewed at the owner's discretion.** Small, focused
  PRs that fix a real bug or improve test coverage have the best chance of
  landing. Large refactors or net-new features may be closed without merge
  if they do not align with the current roadmap; we will say so quickly and
  with thanks.

## Developer Certificate of Origin (DCO)

We require every commit to be **signed off** under the Developer Certificate
of Origin, version 1.1. This is a lightweight alternative to a Contributor
License Agreement: by signing off, you certify that you wrote the change (or
otherwise have the right to submit it under the project's license) and that
you understand the contribution becomes part of the public record.

The full text of the DCO, reproduced verbatim, is:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.

```

### How to sign off your commits

Add the `-s` (or `--signoff`) flag to every `git commit`:

```bash
git commit -s -m "fix: handle missing tenant id on attendance import"
```

That appends a trailer to your commit message in the form:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must match a real identity you can be reached at. Anonymous
or pseudonymous sign-offs (including with a no-reply email) are not accepted.

If you forgot the sign-off on an existing commit, amend it:

```bash
git commit --amend -s --no-edit
```

For a series of commits, rebase with sign-off:

```bash
git rebase --signoff main
```

CI will reject PRs whose commits are not all signed off.

## Pull request expectations

- **Branch from `main`** for every change. Branch names follow the pattern
  `sprint/<topic>` or `fix/<topic>`.
- **One concern per PR.** A PR that mixes a bug fix with a refactor will be
  asked to split.
- **Tests with the change.** Every behavioural change ships its test in the
  same PR. We do not accept "tests in a follow-up."
- **Conventional commit titles**: `feat: …`, `fix: …`, `chore: …`,
  `docs: …`, `refactor: …`, `test: …`. The PR title becomes the squashed
  commit subject.
- **Keep the working tree clean.** Do not commit generated files, IDE
  configuration, or local environment files. The `.gitignore` is the source
  of truth.

## Project conventions worth knowing

- This is a multi-tenant SaaS codebase using NestJS microservices on AWS
  ECS Fargate, a React MFE on the tenant-facing surface, and CDK for
  infrastructure. The repository layout and the relationships between
  stacks, services, and frontends are documented in `CLAUDE.md`.
- Several dependencies are pinned tighter than `^semver` would suggest
  because newer "compatible" releases break specific bundlers. Do not widen
  these pins. See the *Dependency pins that must not drift* section of
  `CLAUDE.md`.
- The repository is the canonical source of truth — there is no separate
  internal mirror. Discussions and decisions happen on PRs and Issues.

Thank you for reading this far. We try to be quick and direct in reviews;
if you do not hear from us within a week, it is fair to ping the PR.

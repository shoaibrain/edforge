# AIBrains `shared-types` OSS Extraction — Sprint Plan

## Executive summary

Move `packages/shared-types` out of the EdForge monorepo into the public empty
repository [`shoaibrain/aibrains`](https://github.com/shoaibrain/aibrains),
while preserving the published npm package identity
`@aibrains/shared-types`, keeping frontend/backend consumers compatible, and
making the package credible as a standalone open-source standards layer for:

1. **Ed-Fi v6 data model alignment**
2. **SABER-oriented operational insight contracts**
3. **EdTech Hub next-generation EMIS capability framing**

The safest target shape is an **npm-workspace monorepo** named `aibrains`,
initially containing only `packages/shared-types`. The public npm scope already
contains multiple packages (`@aibrains/shared-types`,
`@aibrains/pdf-renderer`), so the repo can later host `pdf-renderer` without
another structural migration.

> Source status: the original request referenced `docs/spec.md`, but no
> `docs/spec.md` or `**/spec.md` exists in this workspace. This plan is based
> on the request plus direct inspection of the EdForge repo and
> `packages/shared-types`.

## Current-state findings that shape the plan

- `@aibrains/shared-types` is already public on npm and local package metadata
  shows version `0.64.0`.
- The package is almost standalone already:
  - runtime dependency: `zod`
  - peer dependency: `zod >=3.22.0 <3.25.0`
  - no source imports from EdForge server/client packages
  - 47 colocated Jest specs
- The package still carries monorepo baggage:
  - license currently says `BUSL-1.1`; the extraction cannot claim “open
    source” until a specific SPDX license is selected and provenance is
    reviewed.
  - README is stale and describes an older structure.
  - `scripts/validate-sync.ts` references a non-existent monorepo school DTO
    path.
  - comments/docs reference internal EdForge docs, memory, prod incidents, and
    pilot-specific names.
- EdForge consumers rely heavily on the **main barrel export** from
  `@aibrains/shared-types`; import compatibility must be treated as a hard
  gate.
- The zod pin is load-bearing. Do **not** widen `zod` beyond `~3.24.4` in
  package dependencies or beyond `<3.25.0` in peer deps without a separate
  coordinated migration.
- AdminWeb is sensitive to frontend dependency graph changes; any EdForge
  consumer bump must include the clean AdminWeb build and jsdom bundle-init
  simulation gate.

## Definition of done for the whole project

- `shoaibrain/aibrains` is a public, cloneable repository with a documented
  workspace layout.
- `packages/shared-types` builds, typechecks, tests, and packs independently
  outside EdForge.
- npm package `@aibrains/shared-types` is published from the new repository
  with provenance and no import-surface regression.
- EdForge consumes `@aibrains/shared-types` from the npm registry instead of a
  workspace symlink.
- Existing EdForge backend, AdminWeb, `pdf-renderer`, and workspace package
  consumers pass their relevant validation gates.
- Public docs explain the package’s role in Ed-Fi, SABER, EdTech Hub, frontend
  validation, backend DTO validation, regional/archetype defaults, events, and
  reporting contracts.

---

## Sprint 0 — Extraction readiness, legal gate, and compatibility inventory

### Sprint goal

Create a factual extraction baseline before moving code: public API inventory,
consumer inventory, legal/provenance decision, current test baseline, and
explicit acceptance gates.

### Demo

A reviewer can open the readiness report, see exactly what will move, what must
remain compatible, what license will apply, and what validations are required
before npm publish and EdForge migration.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S0.1 | Write extraction scope/readiness report | Add a markdown report in EdForge docs or the new repo planning docs. Include package path, current npm version, target repo, package name, non-goals, and note that `docs/spec.md` was not present. | Report is committed and reviewed; no code changes. |
| S0.2 | Create public API inventory | Generate an inventory of all package exports from `src/index.ts`, export-map subpaths, and current EdForge import sites. | Inventory includes main-barrel exports, subpath exports, and consumer files; reviewer can trace each major consumer. |
| S0.3 | Create consumer compatibility matrix | Document consumers: `server/application`, `server`, `client/AdminWeb`, `packages/pdf-renderer`, `pilot-fixtures`, `tenant-settings-resolver`, plus external npm users. | Matrix lists required validations per consumer and whether registry or workspace resolution is used today. |
| S0.4 | Decide OSS license and provenance gate | Choose license for the extracted package, for example Apache-2.0 or MIT, and audit package content for third-party or standards-derived material. Explicitly decide treatment of Ed-Fi-derived descriptors and EdForge trademarks. | `LICENSE` choice is approved before any package metadata changes from `BUSL-1.1`; provenance notes are reviewed. |
| S0.5 | Baseline package tests in current repo | Run current package tests/typecheck without code changes. | `npm test --workspace @aibrains/shared-types` or equivalent passes; `tsc --noEmit` passes; failures become tickets before extraction. |
| S0.6 | Baseline package artifact | Run an npm pack dry run and record included files. | Tarball contains `dist` and public docs only; no source secrets, internal env files, or build cache. |
| S0.7 | Define import-compatibility gate | Add a planned check that compiles representative imports used by EdForge and docs examples against the packed artifact. | Gate is written down and becomes Sprint 2/3 automation. |

---

## Sprint 1 — Bootstrap `shoaibrain/aibrains` and import `shared-types`

### Sprint goal

Create the new repository structure and move the package into it without
changing runtime behavior.

### Demo

Fresh clone of `shoaibrain/aibrains` can run install, build, test, and npm-pack
for `@aibrains/shared-types`.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S1.1 | Initialize target repo workspace | Add root `package.json`, `package-lock.json`, `.gitignore`, `README.md`, workspace config, and root scripts (`build`, `test`, `typecheck`, `pack:shared-types`). | `npm install` succeeds in a clean clone; root scripts delegate to `packages/shared-types`. |
| S1.2 | Add repo governance files | Add selected `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, DCO expectations, and basic issue/PR templates. | Files reflect package-specific governance, not EdForge monorepo governance; license matches S0.4 decision. |
| S1.3 | Import package source preserving history | Use a history-preserving approach where practical (`git subtree split` / filter-based import), then place package at `packages/shared-types`. | Git log for package files shows useful pre-extraction history; package files match EdForge baseline before hardening changes. |
| S1.4 | Normalize workspace paths | Ensure package-local `tsconfig`, Jest config, scripts, and package paths work from the new repo root. | `npm run build --workspace @aibrains/shared-types` passes; `npm test --workspace @aibrains/shared-types` passes. |
| S1.5 | Preserve npm identity | Keep package name `@aibrains/shared-types`, existing main/types paths, current export map, zod dependency/peer pins, and public publish config. | `npm pack --workspace @aibrains/shared-types --dry-run` shows expected package name/version/files. |
| S1.6 | Add minimal root docs | Root README explains the `aibrains` repo purpose and lists `@aibrains/shared-types` as the first package. | README has install/build/test commands that work on a clean clone. |

---

## Sprint 2 — Standalone hardening and public documentation

### Sprint goal

Make the package understandable and trustworthy outside EdForge, without
breaking current imports.

### Demo

A new developer can install the packed package in small frontend and backend
sample projects, validate sample payloads with Zod, and understand how
Ed-Fi/archetype/reporting pieces fit together.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S2.1 | Rewrite package README | Replace stale structure/version notes with current package map: schemas, validators, Ed-Fi descriptors/mappers, events, locale/archetype defaults, external reporting, utilities. Include React and NestJS examples. | README examples compile in a smoke fixture or are covered by doctest-style TypeScript compilation. |
| S2.2 | Add standards architecture docs | Add public docs for Ed-Fi v6 alignment, SABER insight framing, and EdTech Hub EMIS capability framing. Clearly distinguish shipped APIs from roadmap. | Docs avoid unverifiable claims; each shipped claim points to package modules. |
| S2.3 | Sanitize internal references | Replace or remove references to private EdForge docs, memory files, production incidents, and pilot-specific names where they are not needed for package users. Keep useful historical context in public ADRs if needed. | `rg "memory|CLAUDE|prod|Saraswati|docs/" packages/shared-types` is reviewed; remaining matches are intentionally public or test fixtures. |
| S2.4 | Fix or remove stale sync script | Replace `scripts/validate-sync.ts` with a standalone contract check, or remove it if no longer meaningful outside EdForge. | `npm run` scripts do not reference missing EdForge paths; any replacement script has tests or fixture validation. |
| S2.5 | Add export-map contract tests | Add tests that import all public subpaths and key main-barrel symbols from the built `dist` output. | Test fails if a public export path disappears or resolves to source-only files. |
| S2.6 | Add package tarball smoke fixtures | Add small fixture projects or scripts that install the `npm pack` tarball and compile sample CJS/Node and TypeScript imports. | Smoke passes against the tarball, not the workspace symlink. |
| S2.7 | Confirm browser safety | Add a minimal browser-bundle smoke using a lightweight bundler or fixture that imports representative frontend-safe APIs. | Bundle succeeds without pulling Node-only modules into browser paths. |
| S2.8 | Update changelog policy | Keep existing history, add an “extraction release” entry, and document future release-note expectations. | Changelog accurately describes repo move and any non-breaking doc/tooling changes. |

---

## Sprint 3 — CI, quality gates, and release automation

### Sprint goal

Make every pull request in `aibrains` prove that `shared-types` can build,
test, pack, and remain safe to publish.

### Demo

Open a PR in `aibrains`; GitHub Actions runs typecheck, tests, pack smoke,
secret scan, and release dry-run checks.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S3.1 | Add build/test CI workflow | GitHub Actions on pull requests and pushes to main. Use Node 18/20/22 matrix if supported by current toolchain. | CI runs `npm ci`, package build, typecheck, and Jest; all green. |
| S3.2 | Add tarball smoke CI | CI packs `@aibrains/shared-types`, installs the tarball into smoke fixtures, and compiles imports. | CI proves registry-like consumption rather than workspace-only consumption. |
| S3.3 | Add secret scanning | Port or adapt gitleaks config for the package repo; keep false-positive allowlists narrow. | Deliberate test secret in a branch fails scan; normal PR passes. |
| S3.4 | Add dependency/license checks | Add a lightweight dependency audit/license report appropriate for the selected OSS license. | CI report shows `zod` license and package dev dependencies; no disallowed licenses. |
| S3.5 | Add release automation dry run | Configure Changesets or release-please for versioning and changelog generation without publishing yet. | Dry-run PR shows expected version bump and release notes. |
| S3.6 | Add npm provenance publish workflow | Configure trusted publishing / provenance for `@aibrains/shared-types`, gated on tags or release PR merge. | Workflow can run in dry-run mode; real publish remains gated until Sprint 4. |
| S3.7 | Add branch protection checklist | Document required status checks and maintainer steps. | Repo settings checklist is committed; required checks match workflow names. |

---

## Sprint 4 — First release from `aibrains`

### Sprint goal

Publish the first `@aibrains/shared-types` version from the new repository
without breaking existing users.

### Demo

`npm install @aibrains/shared-types@<new-version>` works in a clean project, and
package provenance points to `shoaibrain/aibrains`.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S4.1 | Choose extraction release version | Decide whether the first new-repo release is patch/minor, for example `0.64.1` or `0.65.0`, or a coordinated `1.0.0`. Prefer non-breaking semver unless public API changes. | Version rationale recorded in release notes. |
| S4.2 | Prepare release notes | Include repo move, license decision, no runtime API breaking changes, zod pin warning, and consumer migration guidance. | Release notes reviewed before publishing. |
| S4.3 | Publish release candidate or next tag | Publish to `next` dist-tag first if desired. | Clean install by exact version works; `npm view` metadata is correct. |
| S4.4 | Run external install smoke | In a temp project outside both repos, install exact version and compile representative imports used by frontend and backend. | Compile succeeds; no workspace symlinks are involved. |
| S4.5 | Promote to latest | Promote release to `latest` once smoke passes. | `npm view @aibrains/shared-types version` returns expected version and repository URL points to `aibrains`. |
| S4.6 | Tag GitHub release | Create GitHub release with changelog and npm version. | GitHub tag and npm version match. |

---

## Sprint 5 — Migrate EdForge to registry consumption

### Sprint goal

Remove EdForge’s workspace dependency on `packages/shared-types` and consume
the package from npm, with all affected consumers validated.

### Demo

Fresh EdForge install resolves `@aibrains/shared-types` from npm, backend
builds pass, AdminWeb builds without a white-screen bundle-init regression, and
no code imports the removed workspace path.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S5.1 | Update EdForge dependency pins | Update `server/application/package.json`, `server/package.json`, and root lockfile to the newly published version. Decide whether AdminWeb should also move from `^0.40.0` to the new version in the same sprint. | `npm install` at EdForge root resolves registry tarball; no root workspace link for `@aibrains/shared-types`. |
| S5.2 | Remove shared-types workspace source from EdForge | Delete `packages/shared-types` from EdForge only after the new repo release is available and pins are updated. Keep other packages intact. | `git status` shows removal only for intended package; no imports use relative paths into `packages/shared-types`. |
| S5.3 | Validate backend builds | Run affected NestJS builds for identity, academics, and finance where applicable. | `cd server/application && npx nest build identity`, `academics`, and `finance` pass. |
| S5.4 | Validate shared package consumers | Build/test `@aibrains/pdf-renderer`, `pilot-fixtures`, and `tenant-settings-resolver` against registry `shared-types`. | Each consumer resolves package from npm and passes its relevant build/tests. |
| S5.5 | Validate AdminWeb if bumped | If AdminWeb pin changes, run clean CRA build and jsdom bundle-init simulation. | Build passes and bundle simulation catches no module-init TypeError. |
| S5.6 | Update EdForge docs | Update README/ARCHITECTURE/CLAUDE references from “workspace package source” to “external public package repo” where appropriate. Keep zod pin warning. | Docs accurately describe source-of-truth repo and publish flow. |
| S5.7 | Remove obsolete root scripts | Remove or adjust `build:shared-types` / `dev:shared-types` scripts if package source no longer lives in EdForge. | Root `npm run` list has no broken scripts. |
| S5.8 | Commit migration as one atomic EdForge PR | Keep this PR focused on dependency-source migration; no behavior changes. | PR diff is reviewable; all validations above attached. |

---

## Sprint 6 — Cross-repo contract and release cadence

### Sprint goal

Prevent future drift between `aibrains` releases and EdForge consumers.

### Demo

A new `@aibrains/shared-types` release can be proposed, tested against EdForge
import contracts, and consumed via an automated update path.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S6.1 | Add public API snapshot tests | In `aibrains`, snapshot the public export surface or generate API report files. | Breaking export removals fail CI unless intentionally approved. |
| S6.2 | Add EdForge compatibility fixture | Add a fixture or generated import list based on EdForge usage, without depending on private EdForge internals. | Fixture compiles against packed package and catches missing symbols used by EdForge. |
| S6.3 | Add semver/deprecation policy | Document additive minor releases, breaking major releases, deprecation windows, and zod migration policy. | Policy is visible in CONTRIBUTING or docs. |
| S6.4 | Add dependency update automation in EdForge | Configure Dependabot/Renovate or documented manual process for `@aibrains/shared-types` updates. | Update PRs run backend and AdminWeb gates; no silent workspace resolution. |
| S6.5 | Add release checklist | Checklist covers tests, pack smoke, npm provenance, EdForge consumer PR, AdminWeb jsdom sim when needed, and changelog. | Maintainers can follow checklist for the next release. |
| S6.6 | Add npm dist-tag policy | Define `latest`, `next`, and optional prerelease tags. | Release workflow and docs agree on dist-tag behavior. |

---

## Sprint 7 — Public standards modules and roadmap hardening

### Sprint goal

Make the “three standards” story explicit in the package API and docs, while
avoiding overclaiming features that are not implemented yet.

### Demo

A user can browse docs and code to see Ed-Fi contracts, current reporting
templates, and the planned/initial shape for SABER and EdTech Hub capability
insights.

### Tickets

| ID | Ticket | Implementation notes | Validation / acceptance |
|---|---|---|---|
| S7.1 | Add standards landing doc | Create `docs/standards.md` describing Ed-Fi v6, SABER, and EdTech Hub roles in the package. | Doc separates “implemented now” from “roadmap”; no vague unsupported claims. |
| S7.2 | Add Ed-Fi module map | Document Ed-Fi descriptors, mappers, and schema alignment points. | Examples compile; links point to public package files/docs. |
| S7.3 | Add SABER taxonomy proposal | Add a public RFC or initial `src/saber` taxonomy for domains/indicators only if scope is approved. Keep it data-only and Zod-validated. | Unit tests validate taxonomy shape; docs say experimental if not consumed yet. |
| S7.4 | Add EdTech Hub capability taxonomy proposal | Add a public RFC or initial `src/edtech-hub` capability model for EMIS platform capabilities only if scope is approved. | Unit tests validate taxonomy; API marked experimental if appropriate. |
| S7.5 | Add operational-event-to-insight example | Show how an EdForge-style domain event could map to a standards insight without requiring EdForge runtime. | Example compiles and runs as a pure function/unit test. |
| S7.6 | Add versioned standards-data policy | Define how standards taxonomies are versioned, changed, and cited. | Policy covers breaking changes and source citations. |

---

## Validation strategy by layer

### `aibrains` package validation

- `npm ci`
- `npm run build --workspace @aibrains/shared-types`
- `npm run typecheck --workspace @aibrains/shared-types`
- `npm test --workspace @aibrains/shared-types`
- export-map contract tests from built `dist`
- `npm pack` tarball smoke install
- browser-safe import bundle smoke
- gitleaks / secret scan
- dependency license check

### EdForge consumer validation

- Root `npm install` after removing workspace source.
- `cd server/application && npx nest build identity`
- `cd server/application && npx nest build academics`
- `cd server/application && npx nest build finance`
- Affected Jest suites in identity/academics/finance where shared DTOs are
  used.
- `packages/pdf-renderer` build/test if it remains in EdForge and imports
  `@aibrains/shared-types`.
- AdminWeb clean build and jsdom bundle-init simulation if AdminWeb dependency
  changes.
- No CDK deploy is required solely for a library-source migration unless an
  AdminWeb/control-plane release or service image rollout is intentionally
  performed later.

### Package release validation

- `npm view @aibrains/shared-types@<version>` metadata confirms:
  - repository URL: `https://github.com/shoaibrain/aibrains`
  - license: selected OSS license
  - peer deps preserve `zod >=3.22.0 <3.25.0`
  - package includes only intended files
- Clean temp project can import:
  - main entry: `@aibrains/shared-types`
  - `@aibrains/shared-types/validators`
  - `@aibrains/shared-types/mappers`
  - `@aibrains/shared-types/schemas/analytics`
  - `@aibrains/shared-types/utils/currency`

---

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| License mismatch: package says open source but still carries BUSL metadata | Make license/provenance S0 gate mandatory before metadata changes or public messaging. |
| Breaking EdForge imports by changing barrel exports | Add export-map and EdForge compatibility compile tests before first new-repo release. |
| Hidden workspace resolution masks missing npm artifacts | Tarball smoke tests must install the packed artifact in a temp project. |
| zod drift causes AdminWeb white screen | Preserve `~3.24.4` dependency and `<3.25.0` peer; run AdminWeb build + jsdom sim when bumped. |
| Stale docs confuse external adopters | Rewrite README and add standards docs before “latest” release from new repo. |
| Internal/prod/pilot references leak into OSS package | Run targeted `rg` audit and replace private references with public ADRs or remove. |
| History loss makes provenance hard to audit | Use history-preserving import strategy where practical; record exact source commit. |
| EdForge breaks after removing workspace package | Sequence publish first, then EdForge migration PR with full validation. |

---

## Subagent review prompt and incorporated improvements

### Review prompt

> Review this sprint plan for extracting `packages/shared-types` from
> `shoaibrain/edforge` into the public empty repo `shoaibrain/aibrains`. Check
> whether every ticket is atomic and committable, every sprint produces
> demoable software, every ticket has a validation method, and whether the plan
> accounts for npm package publishing, zod pin constraints, frontend/AdminWeb
> bundle risk, EdForge backend consumers, source history, license/provenance,
> and public standards documentation for Ed-Fi v6, SABER, and EdTech Hub.
> Suggest missing tasks, risky sequencing, and any tickets that should be split
> smaller.

### Review findings applied

- Added **Sprint 0 legal/provenance gate** before any OSS license/package
  metadata changes.
- Added **tarball smoke tests** so validation uses registry-like artifacts
  rather than workspace symlinks.
- Added explicit **export-map and EdForge compatibility tests** to guard the
  main-barrel import surface.
- Sequenced **new repo publish before EdForge source removal** to avoid a
  broken consumer window.
- Added **AdminWeb clean build + jsdom bundle-init** as a required gate if
  AdminWeb’s dependency changes.
- Added **internal-reference sanitization** because current comments/docs
  mention private docs, memory, prod incidents, and pilot-specific names.
- Added a separate **standards hardening sprint** so SABER/EdTech Hub claims
  become explicit docs/API work instead of marketing copy.


# PDF Generation Service — MFE Integration Master Plan

> **Scope:** End-to-end integration of the EdForge PDF Generation Service (EPIC-C) into the tenant-facing frontend (`edforge-saas-frontend`). Covers closing C.1 frontend gaps, shipping the C.2 Template Editor, C.3 Report Cards, C.4 Batch Generation, C.5 Admit Cards, plus the foundational hygiene work (test runner, pin sweep, 404 boundary, telemetry, i18n) the previous plan-draft skipped.
>
> **Audience:** Engineers picking up any sprint must be able to start without re-deriving prior context. Tickets are atomic and committable; each has explicit files, validation, and AC.
>
> **Predecessor docs:**
> - [`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md) §5 — EPIC-C ticket-level breakdown (authoritative for backend scope)
> - [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md) — design rationale + architectural decisions
> - [`/CLAUDE.md`](../../CLAUDE.md) — repo-wide rules (PR-first, caret-pin, MF singleton, three-way route handoff)

---

## 0. State at Plan-Time (2026-05-26)

### 0.1 Backend live in prod 🟢

| Capability | Endpoint | Owner |
|---|---|---|
| Branding read | `GET /schools/:schoolId/branding` (returns raw S3 keys + signed `urls.*` via C.0-followup) | identity |
| Branding asset presign | `POST /schools/:schoolId/branding/assets/upload-url` | identity |
| Branding write | `PATCH /schools/:schoolId/branding` | identity |
| PDF template read | `GET /schools/:schoolId/pdf-templates/:docType/current` (lazy default) | identity |
| Invoice PDF | `GET /schools/:schoolId/invoices/:invoiceId/pdf` (smoke PASS 15,321B `application/pdf`) | finance |
| Receipt PDF | `GET /payments/:paymentId/receipt/pdf?schoolId=…` (smoke PASS 17,034B `application/pdf`) | finance |
| Descriptors | `INVOICE` + `RECEIPT` registered in `@aibrains/pdf-renderer@0.6.0` | library |

### 0.2 Frontend live 🟢
- `@edforge/finance-services`: `downloadReceiptPdf` service + `useDownloadReceiptPdf` mutation.
- `apps/shell/src/components/payments/PaymentReceipt.tsx`: Download + Print buttons wired (jspdf retired from render path).
- Receipt SPA route: `apps/shell/src/router.tsx:828` registers `/payments/$paymentId/receipt` under `protectedRoute`.

### 0.3 Known issues (this plan's inputs) ⚠️

| # | Issue | Severity | Sprint |
|---|---|---|---|
| 1 | `apps/finance/src/routes/billing/payments/index.tsx:522` — `navigate({to: '/payments/${id}/receipt'})` runs against `basepath: '/finance'` router → resolves to `/finance/payments/.../receipt` (no route) → `defaultNotFoundComponent: () => null` → blank screen | **P0 regression** | M1 |
| 2 | `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` Print button exists but Download PDF button missing (C.1.5 ticket scope) | **P1 incomplete** | M1 |
| 3 | `scripts/smoke-tests/c1-pdf-endpoints.sh:78` `grep` exits non-zero on missing `Content-Type` header → script aborts under `set -euo pipefail` (CodeRabbit finding) | **P2 test fragility** | M1 |
| 4 | `jspdf` + `html2canvas` listed in `apps/shell/package.json:41-42` but no remaining imports | P3 debt | M1 |
| 5 | `@aibrains/shared-types` pin drift: `apps/{academics,analytics,people}`, `packages/{date-utils,forms,types}` all at `^0.40.0`; `apps/shell` at `^0.51.0`. Plan assumes `≥0.61.0` for new types | **P0 prereq** | M0 |
| 6 | `apps/finance` has no test runner (no vitest/jest in deps or scripts; one stray `format-date.test.ts` un-runnable) | **P0 prereq** | M0 |
| 7 | `apps/finance/src/router.tsx:172` `defaultNotFoundComponent: () => null` — silent 404 trap; future cross-MFE bugs will be invisible | P1 hygiene | M0 |
| 7a | **`BrandingResponse` + `PdfTemplateCurrentResponse` are private to `server/.../identity/src/*/.types.ts`** — NOT exported from `@aibrains/shared-types`. Plan's `import from '@aibrains/shared-types'` in M2.2 + M4.1 won't compile until the types are promoted. (Verified 2026-05-26: only `SchoolBrandingDto` is exported from shared-types.) | **P0 prereq** | M0 |
| 7b | **Frontend ABAC lacks needed enums.** `packages/abac/src/permissions.ts` `Action` enum has no `'configure'`; `Resource` enum has no `'branding'`, `'pdf-templates'`, or `'pdf-jobs'`. Plan's `usePermission('configure', 'branding')` won't typecheck. Backend uses string `branding:configure` / `pdf-templates:view` already; frontend abac is the divergence. | **P0 prereq** | M0 |
| 8 | No frontend branding read OR write integration | P1 — needed for C.2 | M2 + M3 |
| 9 | No frontend PDF templates read | P1 — needed for C.2 | M4 |
| 10 | No Template Editor UI (C.2 frontend) | P1 feature gap | M5 |
| 11 | No Report Card download button (C.3 frontend) | P2 feature gap | M7 |
| 12 | No Batch Generation UI (C.4) | P2 | M8 |
| 13 | No Admit Card UI (C.5) | P3 (gated on D.4/D.5) | M9 |

### 0.4 Architectural ground truth (verified against repo)
1. **Two independent git repos.** Per `feedback_explicit_cd_per_git`: every git command starts with `cd <repo-root>`. Server: `/Users/shoaibrain/edforge`. Frontend: `/Users/shoaibrain/edforge/edforge-saas-frontend`.
2. **Module Federation 2 / Rsbuild.** Shell is host. Each MFE router has its own `basepath`: Finance = `/finance` (`apps/finance/src/router.tsx:171`). Cross-MFE navigation **cannot** use the local MFE's `navigate({to: ...})` for shell-owned routes — it resolves against the MFE basepath.
3. **Receipt page is shell-owned** (`apps/shell/src/router.tsx:826-836`). Parents + students see receipts without Finance MFE loaded.
4. **MF singletons.** Stateful workspace packages must be `singleton: true` in `packages/config/src/mf-shared.ts` or cross-MFE state never syncs (per `edforge_mf_shared_singleton_rule`).
5. **Caret-pin trap.** `^0.X.0` semver does NOT auto-resolve to `0.(X+1).0` on 0.x packages. Every consumer pin must be bumped explicitly in same PR (per `edforge_shared_types_caret_pin`).
6. **Type names per repo (do not invent).**
   - Active school: `useActiveSchool()` from `apps/shell/src/lib/shell-context.tsx:482`.
   - Settings: `useSettings()` from same module.
   - Permission check: `usePermission(action, resource, schoolId?)` from `packages/abac/src/hooks.ts:48`. Returns `{allowed, reason}`. `action`/`resource` are typed enums — NOT colon-separated strings.
   - Branding type: `SchoolBrandingDto` from `@aibrains/shared-types/schemas/identity/school-branding.schema.ts`. Backend wraps it in `BrandingResponse` (also exported); use the wrapper for endpoint typing.
7. **PR-first workflow, no UAT.** Per `feedback_pr_first_no_more_uat`: every PR ships to prod on merge via Vercel. Plan tickets must be small + reversible.
8. **Vercel preview ≠ prod auth.** Preview domain does not share Cognito session with `edforge.app`. PDF download tests on preview require a dev-tenant JWT injected via the local Cognito client OR run on `edforge.app` post-merge.
9. **`@react-pdf/renderer` is pinned at `^3.4.5`** (`packages/pdf-renderer/package.json:50`). The `fonts.ts:14` docstring referencing v4 is stale — verify before M5.1.

### 0.5 Cross-MFE navigation decision
Receipt page is in Shell. Finance Payments index is in Finance MFE. The fix must navigate across MFEs. Options:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A**. `window.location.href` wrapped in helper | 3-line fix; no new shared surface | Full page reload | **CHOSEN for M1** |
| **B**. Shell-exposed `useShellNavigate()` via MF singleton | Client-side nav | New shared surface; coordination work; only one current consumer | Defer to V1.5 if needed |
| **C**. Move receipt page into Finance MFE | "Right" architecturally for admin nav | Breaks parent/student receipt-viewing pattern; ~200 LOC refactor | Rejected |

**Auth verification (prerequisite of Option A):** AWS Amplify's default Auth config rehydrates from `localStorage` on cold load (`aws-amplify@^6.x` behavior). Full reload preserves the Cognito session in `localStorage`; API client re-attaches Bearer after Amplify init. **Validate this explicitly in M1.0** before committing to Option A — if a future Amplify version moves tokens to memory-only, M1.2 regresses to a login redirect on receipt nav.

---

## 1. Sprint Map (at a glance)

| Sprint | Title | Outcome | Backend Prereq |
|---|---|---|---|
| **M0** | Foundation hygiene | Test runner + pin sweep + 404 boundary + auth-rehydration verified + types promoted + ABAC enums extended | None (M0.9 is a server-repo PR but no AWS deploy) |
| **M1** | Close C.1 frontend | Invoice PDF + Receipt nav both work end-to-end on dev-pabson-primary | None (live) |
| **M2** | Branding read | TenantAdmin/Principal sees branding in Shell settings | None (live) |
| **M3** | Branding write | TenantAdmin/Principal edits branding → next PDF reflects | None (live) |
| **M4** | Templates read | TenantAdmin sees current template config (read-only) | None (live) |
| **M5** | Template Editor (C.2 FE) | TenantAdmin edits + previews + publishes templates | **C.2.1 backend writes** |
| **M6** | Immutability surfacing | Issued docs show frozen-template badge; reprint stable | C.2.5 backend |
| **M7** | Report Card PDF | Academics MFE shows Download on result-card detail | C.3.2 backend |
| **M8** | Batch generation UI | Bulk-select → progress modal → zip | C.4 backend |
| **M9** | Admit Card UI | BLE/SEE bulk admit-card generation | D.4 + D.5 + C.5 backend |
| **M10** | Operator UAT + docs | Pilot sign-off | All prior |

Each sprint demos on a Vercel preview against the live prod backend (dev-pabson-primary tenant). Hand-tests are **sprint-level DoD gates**, not tickets.

---

## 2. Sprint M0 — Foundation Hygiene (prerequisite for M1+)

**Goal:** Remove every "shouldn't this exist yet?" blocker before integrating new features. Without M0, M1's component tests are infeasible and M2/M5's types break.

**Demo:** From a fresh checkout, `npm test` runs the new finance + academics + shell vitest suites and they pass green. `npm run typecheck` succeeds with shared-types ≥0.62.0 across every consumer. A deliberate broken-route push to a feature branch produces a logged 404 in browser console (not a blank page).

### Tickets

#### **M0.1 — Bootstrap vitest in `apps/finance`**
- **Files:**
  - `apps/finance/package.json` — add `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` devDeps; add `"test": "vitest run"` script.
  - `apps/finance/vitest.config.ts` (NEW) — jsdom environment, path aliases mirroring `tsconfig`, setup file.
  - `apps/finance/src/__tests__/setup.ts` (NEW) — `@testing-library/jest-dom` import + globals.
  - `apps/finance/src/utils/format-date.test.ts` — verify it actually runs under new config (was likely orphaned).
- **Validation:** `cd apps/finance && npm test` exits 0 with at least the format-date test green; coverage report optional.
- **AC:** Test runner wired; sample test green; CI hook (if exists) updated.
- **Atomic:** Yes.

#### **M0.2 — Bootstrap vitest in `apps/academics`** (same shape as M0.1 — atomic separate PR for clean per-MFE rollback)

#### **M0.3 — Verify vitest in `apps/shell`**
- **Implementation:** Shell may already have it — confirm and document. If absent, mirror M0.1.

#### **M0.4 — Shared-types pin sweep to `^0.62.0`**
- **Files:** every `package.json` matching `grep -l '@aibrains/shared-types' apps/*/package.json packages/*/package.json` (currently 7 files).
- **Implementation:** Bump each pin to `^0.62.0` (the version M0.9 publishes). Refresh `package-lock.json` via `npm install` from root. Per CLAUDE.md: this is the AdminWeb publish-gate adjacent path — frontend repo doesn't ship to AdminWeb's CodeBuild, so the jsdom-sim is not strictly required here, but **run `npm run build` for every app and confirm no TS errors**.
- **Validation:** `npm run typecheck` from each app passes; `npm run build` for shell + finance + academics + people + analytics succeeds.
- **AC:** No app pins ≤0.61.x for shared-types. Lockfile committed in same PR.
- **Sequencing:** Lands AFTER M0.9 publishes `0.62.0`. If M0.9 slips, M0.4 widens to `^0.61.0` as a fallback and M2+ adopts inline types until M0.9 unblocks.
- **Atomic:** Yes (cross-cutting but mechanical).

#### **M0.5 — Replace `defaultNotFoundComponent: () => null` with logged 404 boundary**
- **Files:**
  - `apps/finance/src/router.tsx:172`
  - `apps/academics/src/router.tsx` (verify + apply same fix)
  - `apps/people/src/router.tsx` (verify + apply)
  - `apps/analytics/src/router.tsx` (verify + apply)
  - NEW shared component `packages/shell-components/src/MfeNotFoundBoundary.tsx` — renders an explanatory UI with a "Return to Shell" link AND emits `console.warn` + a structured analytics event so silent navigation bugs surface immediately.
- **Implementation:** Each MFE router uses `defaultNotFoundComponent: () => <MfeNotFoundBoundary mfe="finance"/>`.
- **Validation:** Unit test — render router with a bogus route; assert `console.warn` called and component visible.
- **AC:** No MFE has the silent-null 404 anymore. The exact bug that broke PR #64 is now visually + telemetry-detectable.
- **Atomic:** Yes.

#### **M0.6 — Auth-rehydration smoke (Option A safety check)**
- **Files:** `apps/shell/src/__tests__/auth-rehydration.test.ts` (NEW)
- **Implementation:** Spin up jsdom; populate `localStorage` with a Cognito-shaped token bundle; simulate `window.location.assign` reload; assert Amplify rehydrates without redirecting to login. If the test cannot be written in jsdom (Amplify SDK guards on browser globals), document a manual reproduction script + a one-line runbook entry in `docs/runbooks/auth-rehydration-check.md`.
- **Validation:** Test green OR documented runbook + verified by hand on dev-pabson-primary.
- **AC:** We have written evidence that `window.location.href` to a same-origin shell route preserves auth. If it does NOT, this ticket reopens cross-MFE nav decision and Option B / C work begins.
- **Atomic:** Yes.

#### **M0.7 — MFE-router lint rule**
- **Files:** `eslint.config.js` (or wherever ESLint config lives at repo root)
- **Implementation:** Custom rule (or simple `no-restricted-syntax`) flagging `navigate({to: '/payments/...'})` and other hard-coded shell paths inside non-shell MFE routes. Concrete: lint error when a `to: '/...'` literal in an MFE outside the MFE's own basepath. Initial blocklist: `'/payments'`, `'/settings'`, `'/dashboard'` (shell-owned roots).
- **Validation:** Run lint on current `apps/finance/src/routes/billing/payments/index.tsx` (after M1.2's fix) — clean. Add a temporary regression case and confirm lint catches it.
- **AC:** New PRs reintroducing the broken pattern fail lint.
- **Atomic:** Yes.

#### **M0.8 — i18n parity check extension**
- **Files:** `packages/i18n/src/__tests__/locale-parity.test.ts` (extend if exists, else create)
- **Implementation:** Add the upcoming namespaces this plan will introduce (`branding`, `pdf-templates`, `pdf-jobs`) to the parity test stub so every M2/M3/M4/M5/M7/M8 ticket adding keys must add en + ne in lockstep.
- **Validation:** Stub locale files for the namespaces exist with empty `{}` objects; test green.
- **AC:** Future i18n-missing PRs fail the test.
- **Atomic:** Yes.

#### **M0.9 — Promote `BrandingResponse` + `PdfTemplateCurrentResponse` to `@aibrains/shared-types` (SERVER REPO)**
- **Files (server repo):**
  - `packages/shared-types/src/schemas/identity/branding-response.types.ts` (NEW) — move + re-export `BrandingResponse` + `BrandingAssetUrls` (currently in `server/application/microservices/identity/src/branding/branding.types.ts:78-88`).
  - `packages/shared-types/src/schemas/identity/pdf-template-response.types.ts` (NEW) — move + re-export `PdfTemplateCurrentResponse` + `DocType` enum + sibling shapes from `pdf-templates.types.ts`.
  - `packages/shared-types/src/index.ts` — add re-exports.
  - `server/application/microservices/identity/src/branding/branding.types.ts` — re-export from `@aibrains/shared-types` for back-compat; keep local-only types (DB row shape) here.
  - `server/application/microservices/identity/src/pdf-templates/pdf-templates.types.ts` — same.
  - `packages/shared-types/package.json` — bump to `0.62.0`.
- **Implementation:** Pure type-promotion. No runtime change. Backend ECR rebuild is a no-op functionally but required for pin consistency per `edforge_shared_types_caret_pin`. Update consumer pins in `server/application/package.json` + `server/package.json` in same PR.
- **Validation:** `npm run build` in shared-types + `nest build identity` succeed. `npm view @aibrains/shared-types@0.62.0` after publish.
- **AC:** Frontend `@edforge/identity-services` can `import type { BrandingResponse, PdfTemplateCurrentResponse } from '@aibrains/shared-types'`. Backend services compile unchanged.
- **Atomic:** Yes (one server-repo PR).
- **Blocker for:** M2.2, M4.1. Without this, the frontend has no canonical type source and would duplicate (drift risk).

#### **M0.10 — Extend frontend ABAC `Action` + `Resource` enums + grant TenantAdmin/Principal**
- **Files (frontend repo):**
  - `packages/abac/src/permissions.ts:13` — add `'configure'` to `Action` (and `'publish'` for templates if backend uses it; verify against `permission-registry.ts`).
  - `packages/abac/src/permissions.ts:23` — add `'branding'`, `'pdf-templates'`, `'pdf-jobs'` to `Resource`.
  - `packages/abac/src/permissions.ts` `ROLE_PERMISSIONS` map — grant TenantAdmin: `branding: ['view','configure']`, `pdf-templates: ['view','configure']`, `pdf-jobs: ['view','create']`. Principal: same as TenantAdmin but school-scoped (the engine already enforces school scoping). Standard users: no actions on these resources.
  - `packages/abac/src/engine.test.ts` — add regression specs covering the new tuples for each role.
- **Implementation:** Mirror the backend `DEFAULT_ROLE_PERMISSIONS` map at `server/application/microservices/identity/src/common/entities/role-assignment.entity.ts` (branding:configure + branding:view + pdf-templates:view already granted to Principal there). The frontend ABAC is purely UI affordance gating — backend remains source of truth — but they must agree, or operators see buttons they can't activate.
- **Validation:** Vitest — `usePermission('configure', 'branding')` returns true for TenantAdmin + Principal, false for Standard. Type-check passes against the new enum members.
- **AC:** Every `usePermission(...)` call in M2.5 + M3.5 + M4.5 + M5.10 + M8.3 compiles and matches backend grants.
- **Atomic:** Yes (single PR).
- **Blocker for:** M2.5, M3.5, M4.5, M5.10, M8.3. Cannot ship UI gates without this.

**M0 sprint DoD:** All 10 tickets merged. `npm test` works in finance + academics + shell. No MFE silently 404s. shared-types pinned at `^0.62.0` everywhere (note: bumped from `0.61.0` to `0.62.0` to absorb M0.9's type-promotion). ABAC enums extended. Auth-rehydration assertion exists. ESLint catches cross-MFE nav bugs.

---

## 3. Sprint M1 — Close C.1 Frontend

**Goal:** Every endpoint the C.1 backend exposes is reachable via UI. View Receipt works. Invoice Download works. Smoke harness is robust. Dead deps gone.

**Demo (sprint DoD, hand-test on Vercel preview against dev-pabson-primary):**
1. Click View Receipt eye-icon on Finance Payments index → SPA navigates to receipt page → Download PDF works.
2. Open Invoice detail → click new Download PDF button → real PDF downloads.
3. Open Invoice list → click new Download row-action → same.
4. `bash scripts/smoke-tests/c1-pdf-endpoints.sh` exits cleanly when `Content-Type` header is empty.
5. `npm ls jspdf` in `apps/shell` returns empty.
6. Every error path (4xx + 5xx + network) surfaces a `sonner` toast with structured message.

### Tickets

#### **M1.1 — `viewDocument(href)` + `receiptHref(paymentId)` helpers**
- **Files:**
  - `packages/finance-services/src/utils/navigation.ts` (NEW)
  - `packages/finance-services/src/index.ts` (re-export)
- **Implementation:**
  ```ts
  export function viewDocument(href: string): void {
    if (typeof window !== 'undefined') window.location.href = href
  }
  export function receiptHref(paymentId: string): string {
    return `/payments/${encodeURIComponent(paymentId)}/receipt`
  }
  ```
- **Validation:** Vitest — `receiptHref('a b')` returns `/payments/a%20b/receipt`; `viewDocument` triggers `location.href` assignment via jsdom spy; SSR-safe (no `window` reference outside guard).
- **AC:** No router imports. Pure. Reusable for invoice + report-card patterns.
- **Atomic:** Yes.

#### **M1.2 — Fix View Receipt button**
- **Files:** `apps/finance/src/routes/billing/payments/index.tsx` (line 522 + import block)
- **Implementation:** Replace `navigate({to: ...})` call with `viewDocument(receiptHref(payment.id))`. Drop unused `navigate` if no other callers in file.
- **Validation:** Vitest component test — render 1 completed-payment row; click eye-icon; assert `window.location.href` === `/payments/{id}/receipt`. Hand-test on Vercel preview.
- **AC:** Click navigates to shell receipt route. No blank screen. ESLint rule from M0.7 stays clean.
- **Deps:** M0.6 + M0.7 + M1.1.

#### **M1.3 — `downloadInvoicePdf` service**
- **Files:** `packages/finance-services/src/services/invoices.service.ts`
- **Implementation:** Mirror `downloadReceiptPdf` shape (`payments.service.ts:217-272`): blob response, Content-Disposition filename parse, error blob-JSON unwrap with string type-guard on `parsed.message`.
- **Validation:** Vitest — happy path (returns `{blob, filename}`); error path (JSON `{message}` in blob → re-thrown Error with message); non-JSON error blob → re-thrown with raw text; null content-disposition → fallback filename `invoice-${invoiceId}.pdf`.
- **AC:** Symmetric API surface to `downloadReceiptPdf`. No `window.open`.
- **Atomic:** Yes.

#### **M1.4 — `useDownloadInvoicePdf` mutation hook**
- **Files:** `packages/finance-services/src/hooks/useInvoices.ts` (verify path; may be `usePayments.ts` if invoices live there)
- **Implementation:** `useMutation` wrapping `downloadInvoicePdf`; `onSuccess` triggers anchor-blob download with filename from service. `onError` invokes `toast.error()` with structured message.
- **Validation:** Vitest — mutation success creates + clicks anchor (jsdom spy on `document.createElement`); error triggers `sonner` toast (mock).
- **AC:** Anchor revoked after `100ms` setTimeout to avoid early-revoke race; `aria-hidden` on anchor.
- **Deps:** M1.3.

#### **M1.5 — Download button on Invoice detail page**
- **Files:** `apps/finance/src/routes/billing/invoices/$invoiceId.tsx` (line ~98 per C.1.5 ticket)
- **Implementation:** Add `<button>` with `Download` icon (lucide-react) next to Print. Hook into `useDownloadInvoicePdf`. Disabled+spinner while `mutation.isPending`. Style mirrors `PaymentReceipt.tsx:73-92` for visual consistency. i18n key `invoice.actions.downloadPdf` (en + ne).
- **Validation:** Vitest component test — render with mocked invoice; click; assert mutation called with `{schoolId, invoiceId}`. Keyboard: Tab reaches button; Enter activates.
- **AC:** Print still works; download disabled while pending; no console errors; screen-reader text present.
- **Deps:** M1.4 + M0.8 (i18n parity).

#### **M1.6 — Download action on Invoice list row**
- **Files:** `apps/finance/src/routes/billing/invoices/index.tsx` (actions column at line ~235)
- **Implementation:** Add Download icon button as a row action. Per-row state (one row's pending state doesn't disable other rows).
- **Validation:** Vitest — 3-row table; click Download on row 2; row 2 spinner, rows 1+3 buttons remain enabled; mutation called with row 2's id.
- **AC:** Per-row state; loading spinner localized to clicked row.
- **Deps:** M1.4.

#### **M1.7 — Smoke harness `Content-Type` fix**
- **Files:** `scripts/smoke-tests/c1-pdf-endpoints.sh` (SERVER REPO)
- **Implementation:** Replace lines 77-79 with a `|| true`-suffixed pipeline. Concrete (matches actual code shape using `sed`):
  ```bash
  ctype_from_headers() {
    (grep -i "^content-type:" "$1" || true) | head -1 | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: //'
  }
  ```
- **Validation:** Bash one-liner: pass an empty file → function returns empty string, exit 0. Re-run last prod smoke fixture → identical PASS output.
- **AC:** Smoke aborts only on genuine PDF validation failure, not on grep miss.
- **Atomic:** Yes (small PR in server repo).

#### **M1.8 — Drop `jspdf` + `html2canvas` from `apps/shell/package.json`**
- **Files:** `apps/shell/package.json:41-42`
- **Implementation:** Delete the two lines; refresh lockfile.
- **Validation:** `npm ls jspdf html2canvas` empty in `apps/shell`. `npm run build` succeeds. Bundle-size diff (before/after) reported in PR description.
- **AC:** No imports reintroduced; build still passes.
- **Atomic:** Yes.

#### **M1.9 — Drop unused `receiptRef` from PaymentReceipt**
- **Files:** `apps/shell/src/components/payments/PaymentReceipt.tsx:31` + reference at line 107.
- **Implementation:** Remove `useRef` import (if unused after delete), the `receiptRef` declaration, and the `ref={receiptRef}` attribute. Documented comment can also be removed.
- **Validation:** Vitest snapshot stable; visual identical.
- **AC:** Dead-code drop; nothing else changes.
- **Atomic:** Yes.

#### **M1.10 — Frontend telemetry for PDF downloads**
- **Files:**
  - `packages/finance-services/src/hooks/useInvoices.ts` (extend M1.4) + `usePayments.ts` (extend existing `useDownloadReceiptPdf`)
  - Wire to existing analytics surface (verify path — likely `apps/shell/src/analytics`).
- **Implementation:** Emit structured events on mutation lifecycle: `pdf.download.started`, `pdf.download.succeeded` (with `{docType, schoolId, byteSize}`), `pdf.download.failed` (with `{docType, schoolId, errorClass, errorMessage}`). PII-aware: never include student names or invoice numbers in the event payload.
- **Validation:** Vitest — mocked analytics receives all 3 events across happy + error paths. No PII fields in event body.
- **AC:** Operators can answer "how many invoice PDFs were downloaded in the last week?" from the existing analytics pipeline. Aligns with telemetry patterns in the rest of the codebase.
- **Deps:** M1.4 + (existing `useDownloadReceiptPdf`).
- **Atomic:** Yes.

#### **M1.11 — Error-toast hook for PDF downloads**
- **Files:** `packages/finance-services/src/hooks/usePdfErrorToast.ts` (NEW)
- **Implementation:** Tiny helper that takes an `Error` and dispatches `sonner` toast with a localized message (i18n key `pdf.errors.*` for known classes: `unauthorized`, `forbidden`, `notFound`, `serverError`, `network`, `unknown`). Both M1.4 (invoice) + existing receipt hook adopt it.
- **Validation:** Vitest — known error classes map to correct i18n keys; unknown error → generic key.
- **AC:** One canonical error-toast surface for PDF flows; future PDF hooks reuse it.
- **Atomic:** Yes.

**M1 sprint DoD:** Six demo steps pass on Vercel preview against dev-pabson-primary. PR merge order: M1.1 → M1.2 → M1.3 → M1.4 → M1.5 / M1.6 (parallelizable) → M1.7 → M1.8 → M1.9 → M1.10 / M1.11. Vercel rollback strategy: each PR is a single revert away from prior state.

---

## 4. Sprint M2 — Branding Read Integration

**Goal:** TenantAdmin + Principal can view current branding in a Shell settings page. No edits yet (read-only first; mirrors D.1 GradingPolicy pattern).

**Demo:** Navigate to `/settings/branding`. With branding set: logo, color swatches, formal name, PAN/VAT all render. With null branding: empty-state with "No branding configured yet — defaults will be used."

### Tickets

#### **M2.1 — Bootstrap `@edforge/identity-services` + MF singleton config**
- **Files:**
  - `packages/identity-services/package.json` (NEW; mirrors `finance-services` deps + adds `@aibrains/shared-types: ^0.62.0` — matches the M0 baseline set by M0.4 + M0.9)
  - `packages/identity-services/tsconfig.json` (NEW)
  - `packages/identity-services/src/index.ts` (NEW — placeholder export)
  - Root `package.json` / `package-lock.json` (workspaces refresh)
  - `packages/config/src/mf-shared.ts` — add `@edforge/identity-services` to the singletons list (mirror the `@edforge/finance-services` entry verbatim).
  - Every MFE's `rsbuild.config.ts` that explicitly lists shared deps (verify) — add identity-services.
- **Validation:** `npm install` from root succeeds. `npm run build` in identity-services + every consuming app succeeds. Dev-mode runtime check: navigate Shell → Finance → back to Shell; no "two copies of module" warning.
- **AC:** Package is a peer of `@edforge/finance-services` in structure and singletonness. Empty exports surface.
- **Atomic:** Yes (one PR — reviewer suggested merging the previous M2.1 + M2.2 split).

#### **M2.2 — Branding service**
- **Files:** `packages/identity-services/src/services/branding.service.ts` (NEW)
- **Implementation:**
  ```ts
  import { apiGet } from '@edforge/api-client'
  import type { BrandingResponse } from '@aibrains/shared-types'
  export async function getBranding(schoolId: string): Promise<BrandingResponse> {
    return apiGet<BrandingResponse>(`/schools/${schoolId}/branding`)
  }
  ```
  `BrandingResponse` MUST be exported from `@aibrains/shared-types` — this is the deliverable of **M0.9** (the type-promotion ticket). M2.2 cannot start until M0.9 has shipped + published. If M0.9 slips, M2.2 either waits OR defines a local `BrandingResponse` shape in `@edforge/identity-services/types` and refactors when M0.9 lands.
- **Validation:** Vitest — mocked apiGet returns shape `{branding, urls?}`; service returns as-is; error path propagates.
- **AC:** Type-safe. Reuses shared-types (no parallel definitions).
- **Deps:** M2.1 + **M0.9**.

#### **M2.3 — `useSchoolBranding` query hook**
- **Files:** `packages/identity-services/src/hooks/useBranding.ts` (NEW); `index.ts` re-export.
- **Implementation:**
  ```ts
  export const brandingKeys = {
    all: ['branding'] as const,
    school: (schoolId: string) => [...brandingKeys.all, schoolId] as const,
  }
  export function useSchoolBranding(schoolId: string | undefined) {
    return useQuery({
      queryKey: brandingKeys.school(schoolId ?? ''),
      queryFn: () => getBranding(schoolId!),
      enabled: !!schoolId,
      staleTime: 60_000,
    })
  }
  ```
- **Validation:** Vitest + `@tanstack/react-query` MockProvider — query fires only when schoolId present; staleTime 60s matches backend LRU.
- **AC:** Keys exported for M3 invalidation.
- **Deps:** M2.2.

#### **M2.4 — `BrandingDisplay` read-only card**
- **Files:** `apps/shell/src/components/branding/BrandingDisplay.tsx` (NEW); `index.ts`.
- **Implementation:** Renders logo (signed URL from `branding.urls?.logo`), formal name (uses `useSettings()` for locale to pick from `formalName`), color swatches with `aria-label="Primary color #XXXXXX"`, PAN/VAT, signature thumbnail. Empty-state when `branding` null. i18n namespace `branding`.
- **Validation:** Vitest snapshot — 3 cases (full / partial / null). a11y: color swatches have ARIA labels with hex; logo has alt text.
- **AC:** Mobile-responsive (single-column layout < 768px); dark-mode compatible.
- **Deps:** M2.3 + M0.8.

#### **M2.5 — `/settings/branding` route + sidebar entry**
- **Files:**
  - `apps/shell/src/pages/settings/branding.tsx` (NEW) — uses `useActiveSchool` + `useSchoolBranding` + renders `BrandingDisplay`.
  - `apps/shell/src/router.tsx` — register `/settings/branding` under settings parent.
  - `apps/shell/src/pages/settings/index.tsx` (or equivalent settings hub) — add Branding card/link.
- **Implementation:** Permission gate via `usePermission(<action>, <resource>)`. **Pre-ticket task:** add concrete `{action, resource}` tuple for "view branding" to `@edforge/abac` if not already there (likely `'view', 'branding'`). Mirrors `apps/shell/src/pages/settings/workspace.tsx` layout.
- **Validation:** Hand-test on Vercel preview as TenantAdmin + Principal + non-privileged user.
- **AC:** TenantAdmin + Principal see card; others see permission-denied page (existing pattern).
- **Deps:** M2.4 + abac tuple added.

**M2 sprint DoD:** Navigate to `/settings/branding` as TenantAdmin on dev-pabson-primary; card renders. As non-privileged user, gate works. i18n: en + ne keys parity-green.

---

## 5. Sprint M3 — Branding Write Integration

**Goal:** TenantAdmin / Principal can edit branding. Logo / signature / letterhead upload via presigned PUT direct to S3. Next PDF download reflects new branding.

**Demo:** /settings/branding → Edit → upload new logo PNG (<500KB) → change primary color to `#005A5B` → set formalName to "नमुना माध्यमिक विद्यालय" → Save → toast → /finance/invoices/{id} → Download PDF → new logo + color visible.

### Tickets

#### **M3.1 — `useUpdateBranding` mutation**
- **Files:**
  - `packages/identity-services/src/services/branding.service.ts` — add `updateBranding(schoolId, dto): Promise<BrandingResponse>` (PATCH).
  - `packages/identity-services/src/hooks/useBranding.ts` — `useUpdateBranding`; on success invalidate `brandingKeys.school(schoolId)`.
- **Validation:** Vitest — mutation invalidates query; error path propagates to M1.11 error-toast.
- **AC:** Symmetric to `useUpdateInvoice` patterns in finance-services.
- **Deps:** M2.3.

#### **M3.2 — `usePresignedAssetUpload` hook**
- **Files:** `packages/identity-services/src/hooks/usePresignedAssetUpload.ts` (NEW)
- **Implementation:**
  ```ts
  export function usePresignedAssetUpload() {
    return useMutation<
      {s3Key: string},
      Error,
      {schoolId: string; assetType: 'logo'|'principalSignature'|'letterheadBackground'; file: File}
    >({
      mutationFn: async ({schoolId, assetType, file}) => {
        // 1. POST /schools/{schoolId}/branding/assets/upload-url
        //    body: {assetType, contentType: file.type, contentLength: file.size}
        // 2. fetch(presignedUrl, {method: 'PUT', body: file, headers: {'Content-Type': file.type, 'Content-Length': String(file.size)}})
        // 3. Return s3Key from step 1
      },
    })
  }
  ```
  Pre-validate MIME (PNG/JPEG only) + size cap (1MB) before requesting presign — backend enforces, but failing fast is better UX.
- **Validation:** Vitest with MSW — 2-step happy path; presign failure; PUT 403 (signature expired); pre-validation error (oversize) surfaces without network call.
- **AC:** Single hook handles full upload flow. PUT preserves S3 CORS contract.
- **Deps:** M2.2.

#### **M3.3a — `ColorField` primitive in `@edforge/forms`**
- **Files:** `packages/forms/src/fields/ColorField.tsx` (NEW); `packages/forms/src/fields/index.ts`.
- **Implementation:** `<input type="color">` + RHF Controller; emits normalized `#RRGGBB`. Includes text input fallback for clipboard-paste use.
- **Validation:** Vitest with RHF — typing `#abc123` updates form state; color picker selection updates state.
- **AC:** Plays with existing `<Form>` pattern; mobile-tested.
- **Atomic:** Yes (independent).

#### **M3.3b — `FileField` primitive in `@edforge/forms`**
- **Files:** `packages/forms/src/fields/FileField.tsx` (NEW)
- **Implementation:** File picker + image preview thumbnail + MIME/size pre-validation; emits the `File` object to form state. Optional `onUpload` callback to wire `usePresignedAssetUpload`.
- **Validation:** Vitest — file selection updates state; size violation shows inline error; preview renders for image MIME types.
- **AC:** ARIA-labeled drop zone; keyboard activation (Enter to open picker).
- **Atomic:** Yes (independent of M3.3a).

#### **M3.4a — `BrandingForm` scaffold + identity section**
- **Files:** `apps/shell/src/components/branding/BrandingForm.tsx` (NEW)
- **Implementation:** RHF root form with identity section only: formalName, panNumber, vatNumber, addressLines (textarea), phone, email. Submit handler stubs to `useUpdateBranding`. Cancel button resets form.
- **Validation:** Vitest — submit dispatches mutation with identity fields only; cancel restores prior values; dirty state tracked.
- **AC:** Section renders even when other sections aren't built yet (M3.4b lands incrementally).
- **Deps:** M3.1 + M3.3a + M3.3b are NOT needed yet — pure text fields.

#### **M3.4b — Visual section + presigned PUT wiring**
- **Files:** `apps/shell/src/components/branding/BrandingForm.tsx` (extend)
- **Implementation:** Add visual section: logo (FileField → usePresignedAssetUpload), principalSignature (same), letterheadBackground (same), primary + accent ColorField. On submit, ensure assets are uploaded BEFORE PATCH is called (sequential or `Promise.all` then PATCH).
- **Validation:** Vitest — upload happy path triggers PATCH with returned S3 keys; upload failure shows toast + leaves PATCH unfired.
- **AC:** Upload progress visible per asset. Atomic save semantics (no partial PATCH if any upload fails).
- **Deps:** M3.4a + M3.2 + M3.3a + M3.3b.

#### **M3.4c — Unsaved-changes guard**
- **Files:** `apps/shell/src/components/branding/BrandingForm.tsx` (extend); `apps/shell/src/pages/settings/branding.tsx`.
- **Implementation:** TanStack Router `useBlocker` — when form is dirty and user navigates away, modal asks "Discard changes?"
- **Validation:** Vitest — dirty form + nav click → modal renders; confirm → nav proceeds; cancel → stays.
- **AC:** Survives Tab close (browser's `beforeunload` event).
- **Deps:** M3.4b.

#### **M3.5 — Mount BrandingForm with edit toggle**
- **Files:** `apps/shell/src/pages/settings/branding.tsx`
- **Implementation:** Add Edit button gated on `usePermission('configure', 'branding')` (concrete tuple — add to abac in same PR if not there). On click, swap `BrandingDisplay` → `BrandingForm`. On save: swap back, query refetches via invalidation.
- **Validation:** Hand-test as TenantAdmin + Principal + non-privileged.
- **AC:** Editing locked for non-privileged. Save → display reflects new data.
- **Deps:** M2.5 + M3.4c + M3.1.

#### **M3.6 — i18n keys for `branding` namespace**
- **Files:** `packages/i18n/src/locales/en/branding.json` (NEW) + `ne/branding.json` (NEW)
- **Implementation:** All visible strings keyed; parity test from M0.8 green.
- **Validation:** Parity test green.
- **AC:** No hard-coded English in BrandingDisplay / BrandingForm.
- **Atomic:** Yes (can ship parallel with M3.4a/b/c).

**M3 sprint DoD:** Demo passes. PDF download reflects new branding immediately (no cache stale issue thanks to identity-side 60s LRU + frontend query invalidation).

---

## 6. Sprint M4 — PDF Templates Read Integration

**Goal:** TenantAdmin sees current template config for each registered docType (INVOICE + RECEIPT active; REPORT_CARD + ADMIT_CARD disabled "Coming"). Read-only.

**Demo:** /settings/pdf-templates → cards per docType → click INVOICE → detail page renders descriptor's `configurableFields[]` with current values + "Source: default (PABSON)" or "Source: persisted vN" badge.

### Tickets

#### **M4.1 — `pdf-templates` service in identity-services**
- **Files:** `packages/identity-services/src/services/pdf-templates.service.ts` (NEW)
- **Implementation:**
  ```ts
  import type { PdfTemplateCurrentResponse } from '@aibrains/shared-types'
  export async function getCurrentTemplate(
    schoolId: string,
    docType: 'INVOICE'|'RECEIPT'|'REPORT_CARD'|'ADMIT_CARD',
  ): Promise<PdfTemplateCurrentResponse> {
    return apiGet(`/schools/${schoolId}/pdf-templates/${docType}/current`)
  }
  ```
- **Validation:** Vitest.
- **AC:** Types from shared-types ≥0.62.0 (matches the M0 baseline set by M0.4 + M0.9). `PdfTemplateCurrentResponse` is delivered to `@aibrains/shared-types` by **M0.9** — same blocker as M2.2.
- **Deps:** M2.1 + **M0.9**.

#### **M4.2 — `useCurrentPdfTemplate` query hook**
- **Files:** `packages/identity-services/src/hooks/usePdfTemplates.ts` (NEW)
- **Implementation:** Mirrors `useSchoolBranding`; keys: `pdfTemplateKeys.school(schoolId).docType(docType)`. 60s staleTime.
- **Validation:** Vitest.
- **AC:** Keys exported for M5 invalidation.
- **Deps:** M4.1.

#### **M4.3 — Doc-type registry (frontend mirror)**
- **Files:** `packages/identity-services/src/constants/pdf-doc-types.ts` (NEW)
- **Implementation:** Static array: `{docType, labelKey, descriptionKey, enabled, sprintName}`. Used by index page.
- **Validation:** Snapshot.
- **AC:** Adding new docType is a one-line change.
- **Atomic:** Yes.

#### **M4.4 — `PdfTemplateInspectCard` read-only component**
- **Files:** `apps/shell/src/components/pdf-templates/PdfTemplateInspectCard.tsx` (NEW)
- **Implementation:** Reads descriptor's `configurableFields[]` (imported from `@aibrains/pdf-renderer`) — note: this triggers descriptor self-registration side-effect, OK since `@aibrains/pdf-renderer` will be singleton'd in M5.2. Renders each field as label+value (read-only). "Source" badge with logic:
  - `source === 'default'` → "Default (archetype: PABSON)"
  - `source === 'persisted'` → "Customized (v{N}, last updated {date})"
- **Validation:** Vitest with both source values; snapshot for each; behavioral test for badge logic.
- **AC:** Generic across docTypes (no per-docType code path).
- **Deps:** M4.2.

#### **M4.5 — `/settings/pdf-templates` index page**
- **Files:**
  - `apps/shell/src/pages/settings/pdf-templates/index.tsx` (NEW)
  - `apps/shell/src/router.tsx` (route registration)
- **Implementation:** Renders cards from M4.3 registry. Enabled cards link to `/settings/pdf-templates/:docType`. Disabled cards have tooltip with future-sprint name.
- **Validation:** Snapshot + hand-test.
- **AC:** Permission gate `usePermission('view', 'pdf-templates')`.
- **Deps:** M4.3 + M4.4 + abac tuple added.

#### **M4.6 — `/settings/pdf-templates/:docType` read-only detail page**
- **Files:** `apps/shell/src/pages/settings/pdf-templates/[docType].tsx` (NEW)
- **Implementation:** Reads route param; fetches via `useCurrentPdfTemplate`; renders `PdfTemplateInspectCard`. "Edit (coming in Sprint M5)" disabled button as a teaser.
- **Validation:** Hand-test on dev-pabson-primary.
- **AC:** Permission gate works.
- **Deps:** M4.5.

#### **M4.7 — i18n keys for `pdf-templates` namespace**
- Same shape as M3.6.

**M4 sprint DoD:** Index renders 2 active + 2 disabled cards on dev-pabson-primary. Detail renders descriptor fields for both INVOICE + RECEIPT with correct "Source: default" badge (no operator has yet customized templates in prod).

---

## 7. Sprint M5 — Template Editor UI (C.2 Frontend)

**Prerequisite (backend, NOT in this plan):** C.2.1 backend writes (`POST/PATCH/POST publish/POST republish/GET versions`) — **NOT YET SHIPPED.** Track in master plan. Plan §13 includes the "backend-lag protocol" for feature-flag-shipping M5 if backend hits delay.

**Demo:** TenantAdmin opens `/settings/pdf-templates/INVOICE`; toggles "discount column" off; preview re-renders in ≤300ms; clicks Publish; downloads a NEW invoice → no discount column. Re-downloads an OLD invoice → discount column still present (frozen `pdfTemplateRef` from M6 backend). Version History → revert to v1.

### Tickets

#### **M5.0 — `<PDFViewer>`-in-MF spike**
- **Files:** `apps/shell/src/__experimental__/pdf-viewer-spike.tsx` (NEW; deleted after sprint)
- **Implementation:** Lazy-import `<PDFViewer>` from `@react-pdf/renderer` + render a static `<Document>`. Verify the build succeeds, the bundle isn't crippling, the worker / yoga-WASM / pdf.js layers all resolve under Rsbuild MF.
- **Validation:** `npm run build` succeeds. Lighthouse / bundle-analyzer report attached to PR description. Manual: page loads in dev mode; PDF renders in iframe; first paint of the spike page < 1s on a 3G throttle.
- **AC:** **GO/NO-GO gate.** If `<PDFViewer>` cannot boot under MF or bundle is too heavy (>2MB compressed for the route), M5 re-scopes to a server-side preview render endpoint (`POST /pdf-templates/preview` returning a Blob) and M5.6 is rewritten.
- **Atomic:** Yes.

#### **M5.1 — Browser-side `registerFonts(baseUrl?)` refactor in `@aibrains/pdf-renderer`**
- **Files:** `packages/pdf-renderer/src/core/fonts.ts` (SERVER REPO)
- **Implementation:** Refactor `registerFonts()` to accept `baseUrl?: string`. When provided, fetches `.woff` files from `${baseUrl}/<font>.woff`; without baseUrl, falls back to the existing Node `path.join(__dirname, ...)` path. **Also fix the stale v4 docstring at line 14** (actual dep is v3.4.5).
- **Validation:** Vitest — Node path still works; jsdom + mocked fetch path works; Devanagari snapshot stable on both paths.
- **AC:** Backward-compatible. Bumps `@aibrains/pdf-renderer` to `0.7.0`. Per CLAUDE.md publish gate: publish to npm → bump consumer pins in `server/application/package.json` + `server/package.json` + every frontend app/package consuming `@aibrains/pdf-renderer` → refresh lockfiles in both repos → backend ECR rebuild (no-op functionally but pin consistency) → AdminWeb jsdom-sim if AdminWeb pulls pdf-renderer (verify; if not, skip).
- **Deps:** M5.0 green.

#### **M5.2 — MF singleton for `@aibrains/pdf-renderer`**
- **Files:** `packages/config/src/mf-shared.ts` + every MFE's `rsbuild.config.ts` that explicitly lists shared deps.
- **Implementation:** Add `@aibrains/pdf-renderer: {singleton: true, requiredVersion: '^0.7.0'}`. Without this, descriptor registry duplicates across MFEs (same trap as `edforge_mf_shared_singleton_rule`).
- **Validation:** Build green. Dev runtime — navigate Shell → Finance → Shell, descriptor `getDescriptor('INVOICE')` returns the same object both times (use a console.assert in spike code).
- **AC:** Descriptor registry truly singleton.
- **Deps:** M5.1.

#### **M5.3 — `MultiSelectField` primitive in `@edforge/forms`**
- **Files:** `packages/forms/src/fields/MultiSelectField.tsx` (NEW)
- **Implementation:** Standard multi-select with RHF Controller. Used by descriptor fields like `lineItemColumns` (7 booleans collapsed to one multi-select).
- **Validation:** Vitest + visual.
- **AC:** Keyboard navigable; ARIA-compliant.
- **Atomic:** Yes.

#### **M5.4a — Template draft service + mutations**
- **Files:** `packages/identity-services/src/services/pdf-templates.service.ts` + `hooks/usePdfTemplates.ts`.
- **Implementation:** Add `createDraft(...)`, `patchDraft(...)`. Hooks `useCreateDraft()` + `usePatchDraft()`. Invalidate template query on success.
- **Validation:** Vitest.
- **AC:** Optimistic-lock version param honored (backend will return 409 on conflict; surface to user via M1.11 toast).
- **Deps:** Backend C.2.1 draft endpoints live.

#### **M5.4b — Publish + republish mutations**
- **Files:** same as M5.4a.
- **Implementation:** Add `publishDraft(...)`, `republishVersion(...)`. Hooks `usePublishDraft()` + `useRepublishVersion()`. **Severity-high** mutations: confirm dialog before publish in M5.9.
- **Validation:** Vitest.
- **AC:** Backend audit event `pdf_template_published` (high severity) fires — verify via integration test on dev-pabson-primary.
- **Deps:** Backend C.2.1 publish endpoint live.

#### **M5.4c — Version history queries**
- **Files:** same.
- **Implementation:** `listVersions(...)` + `getVersion(...)`. Hooks `useTemplateVersions()` + `useTemplateVersion()`. Cache-key separation from CURRENT.
- **Validation:** Vitest.
- **AC:** N/A.
- **Deps:** Backend C.2.1 versions endpoint live.

#### **M5.5 — Descriptor-driven form section renderer**
- **Files:** `apps/shell/src/components/pdf-templates/DescriptorFormSections.tsx` (NEW)
- **Implementation:** Reads `descriptor.configurableFields[]` and emits a form section per group. Field `type` (boolean/string/enum/color/file/multiselect) maps to primitive. Validation comes from descriptor.
- **Validation:** Snapshot — INVOICE descriptor → 13 fields rendered; RECEIPT descriptor → 17 fields.
- **AC:** Adding a new field to a descriptor in `@aibrains/pdf-renderer` requires ZERO change here.
- **Deps:** M3.3a + M3.3b + M5.3.

#### **M5.6 — `LivePreview` with lazy `<PDFViewer>`**
- **Files:** `apps/shell/src/components/pdf-templates/LivePreview.tsx` (NEW)
- **Implementation:** `React.lazy(() => import('@react-pdf/renderer').then(m => ({default: m.PDFViewer})))`. Suspense fallback while bundle loads. Debounce form state changes by 300ms before re-rendering.
- **Validation:** Vitest — debounce verified; lazy boundary triggers (mocked import).
- **AC:** First-paint of editor page does NOT include `<PDFViewer>` bundle (verify via build analysis).
- **Deps:** M5.0 + M5.1 + M5.2 + M5.5.

#### **M5.7 — Sample data selector**
- **Files:** `apps/shell/src/components/pdf-templates/SampleDataSelector.tsx` (NEW)
- **Implementation:** Defaults to descriptor's bundled `sampleData`. Allows operator to switch to a real recent doc (e.g., most-recent issued invoice via finance API).
- **Validation:** Component test.
- **AC:** Preview reflects selected sample.
- **Deps:** M5.6.

#### **M5.8 — Version history sidebar**
- **Files:** `apps/shell/src/components/pdf-templates/VersionHistory.tsx` (NEW)
- **Implementation:** Lists `useTemplateVersions()` results. Each row: vN, publishedBy, publishedAt, "Active" badge, "Republish" button (with confirm).
- **Validation:** Component test.
- **AC:** Republish triggers `useRepublishVersion` → toast → preview re-renders.
- **Deps:** M5.4c.

#### **M5.9 — Editor page composition + unsaved-changes guard**
- **Files:** `apps/shell/src/pages/settings/pdf-templates/[docType].tsx` (REPLACE M4.6 read-only with editor)
- **Implementation:** Split-pane: form (left) + preview (right) + version history (sidebar). Header: Save Draft / Publish (with confirm dialog) / Discard. `useBlocker` per M3.4c pattern.
- **Validation:** Hand-test on dev-pabson-primary against C.2.1 backend.
- **AC:** All demo steps pass.
- **Deps:** M5.4a/b/c + M5.5 + M5.6 + M5.7 + M5.8.

#### **M5.10 — Permission upgrade**
- **Files:** `apps/shell/src/pages/settings/pdf-templates/[docType].tsx`
- **Implementation:** Read via `usePermission('view', 'pdf-templates')`. Edit/publish via `usePermission('configure', 'pdf-templates')`. View-only users see read-only mode (no form inputs).
- **Validation:** Test as TenantAdmin + Principal + non-privileged.
- **AC:** Per C.2.1 spec: TenantAdmin V1; Principal V1.5 opt-in.
- **Deps:** M5.9 + abac tuple added.

#### **M5.11 — i18n keys for `pdf-templates` editor surface**
- Same shape as M3.6.

#### **M5.12 — Bundle-size + perf budget**
- **Files:** `apps/shell/perf-budget.json` (NEW or extend) + CI assertion.
- **Implementation:** Assert main-bundle gzipped size hasn't regressed beyond a documented threshold. The `<PDFViewer>` lazy-load isolates this — the route bundle is separate, not main.
- **Validation:** Bundle analyzer output in M5.0 PR description; CI assertion on every PR.
- **AC:** Main-bundle regression alarm if M5.6 imports `<PDFViewer>` eagerly by accident.
- **Deps:** M5.6.

**M5 sprint DoD:** All demo steps pass. C.2.5-frozen old docs render correctly (verified in M6).

---

## 8. Sprint M6 — Document Immutability Surfacing

**Prerequisite:** C.2.5 backend (`pdfTemplateRef` frozen on issue).

### Tickets

#### **M6.1 — Frozen-template badge on Invoice detail**
- **Files:** `apps/finance/src/routes/billing/invoices/$invoiceId.tsx`
- **Implementation:** When `invoice.pdfTemplateRef` is present, render badge: "Template v{N} (locked at issue)". Tooltip explains immutability.
- **Validation:** Component test; hand-test.
- **AC:** Badge absent for pre-C.2.5 issued docs (no ref).
- **Deps:** C.2.5 backend.

#### **M6.2 — Frozen-template badge on Receipt**
- **Files:** `apps/shell/src/components/payments/PaymentReceipt.tsx`
- **Implementation:** Same pattern.
- **Validation:** Same.
- **Deps:** C.2.5 backend.

#### **M6.3 — Operator reprint-immutability runbook**
- **Files:** `docs/runbooks/pdf-reprint-immutability.md` (NEW)
- **Implementation:** Step-by-step on dev-pabson-primary: issue invoice → publish new template version → re-download original → expected unchanged.
- **Validation:** Execute the runbook; capture screenshots.
- **AC:** Runbook linked from M10 operator UAT checklist.

---

## 9. Sprint M7 — Report Card PDF Frontend (C.3)

**Prerequisite:** C.3.2 backend `GET /result-cards/:id/pdf`.

### Tickets

#### **M7.0 — Bootstrap `@edforge/academics-services` (if not present)**
- **Files:** Mirror M2.1 if `packages/academics-services/` doesn't exist; else skip.
- **Validation:** `npm install` + build green.
- **AC:** Workspace package + MF singleton config + abac tuples added.

#### **M7.1 — `downloadReportCardPdf` service**
- **Files:** `packages/academics-services/src/services/result-cards.service.ts` (NEW or extend).
- **Implementation:** Mirror M1.3.
- **Validation:** Vitest.
- **AC:** Symmetric API surface.
- **Deps:** C.3.2 + M7.0.

#### **M7.2 — `useDownloadReportCardPdf` hook**
- Mirror M1.4. Reuses M1.10 telemetry + M1.11 error toast.

#### **M7.3 — Download button on Result Card detail page**
- **Files:** `apps/academics/src/routes/result-cards/$resultCardId.tsx` (verify path)
- Mirror M1.5.

#### **M7.4 — Per-row Download on Result Card list**
- **Files:** `apps/academics/src/routes/result-cards/index.tsx`
- Mirror M1.6.

#### **M7.5 — Unlock REPORT_CARD card in templates index**
- **Files:** `packages/identity-services/src/constants/pdf-doc-types.ts` (one-line change toggling `enabled`).
- **Validation:** Snapshot.
- **AC:** Single-line. Editor (M5.9) automatically supports the new docType via descriptor pattern.
- **Deps:** M5.9 + backend C.3.1 descriptor registered.

#### **M7.6 — i18n keys for report-card**

#### **M7.7 — Telemetry for report-card downloads**
- Extends M1.10 with `docType: 'REPORT_CARD'`.

---

## 10. Sprint M8 — Batch Generation UI (C.4)

**Prerequisite:** C.4.1 Lambda + C.4.2 endpoints live.

### Tickets

#### **M8.1 — `usePdfJob` hook with conditional polling**
- **Files:** New shared location — `packages/identity-services/src/hooks/usePdfJob.ts` (centralized; both finance + academics MFE consume).
- **Implementation:** Mutation to `POST /pdf-jobs` + status query with `refetchInterval` only while job is `pending|processing` (per `feedback_react_query_no_polling_for_event_driven_data`).
- **Validation:** Vitest mocking job lifecycle. Polling stops at terminal status.
- **AC:** Already singleton via M2.1.
- **Deps:** C.4.2.

#### **M8.2 — Multi-select state on invoice list**
- **Files:** `apps/finance/src/routes/billing/invoices/index.tsx`
- **Implementation:** Add checkboxes column + "select-all in view" toggle. Persist selection per-page only (don't survive route changes).
- **Validation:** Vitest.
- **AC:** Clear visual count of selected.

#### **M8.3 — `BulkGeneratePdfsButton` + progress modal**
- **Files:** `apps/finance/src/components/BulkGeneratePdfsButton.tsx` (NEW); `apps/finance/src/components/PdfJobProgressModal.tsx` (NEW)
- **Implementation:** Click → modal opens → calls `enqueueJob` → polls status → progress bar → on complete, blob-anchor zip download.
- **Validation:** Component test + hand-test on dev-pabson-primary.
- **AC:** Modal cancellable (backend cancel optional; if not supported, hide cancel).
- **Deps:** M8.1 + M8.2.

#### **M8.4 — Multi-select + bulk action on Result Card list**
- **Files:** `apps/academics/src/routes/result-cards/index.tsx`
- Mirror M8.2 + reuse modal from M8.3.

#### **M8.5 — i18n keys for `pdf-jobs` namespace**

#### **M8.6 — Telemetry for batch jobs**
- Emits `pdf.job.{enqueued,polled,succeeded,failed}` per M1.10 pattern.

#### **M8.7 — Mobile UX review of bulk select**
- **Files:** None — execution-only QA. Document findings in M10 docs.
- **AC:** Multi-select usable on mobile (Saraswati operators may use Android Chrome).

---

## 11. Sprint M9 — Admit Card UI (C.5 — V1.5 / gated)

**Prerequisite:** D.4 + D.5 BLE/SEE entities + C.5 backend.

### Tickets

#### **M9.1 — `downloadAdmitCardPdf` service + hook** (mirror M1.3/M1.4)

#### **M9.2 — Download button on student detail page** (academics or people MFE — verify ownership)

#### **M9.3 — Bulk admit-card from students list with grade filter**
- **Implementation:** Reuses M8.1 + M8.3 modal; filters students by grade (BLE = G8, SEE = G10).

#### **M9.4 — Unlock ADMIT_CARD card in templates index**
- One-line in M4.3 registry.

#### **M9.5 — i18n + telemetry**

---

## 12. Sprint M10 — Operator UAT + Documentation

### Tickets

#### **M10.1 — Operator UAT checklist**
- **Files:** `docs/operator/pdf-service-uat.md` (NEW)
- **Implementation:** Step-by-step covering every PDF surface (download invoice / receipt / report card / admit card; edit branding; edit template; generate batch). Edge cases: empty data, missing template, network failure, permission denied.
- **AC:** Saraswati operator can execute without engineer help.

#### **M10.2 — User-facing documentation**
- **Files:** `docs/user-guides/printing-and-pdfs.md` (NEW)
- **Implementation:** Screenshot-driven. Two-page max for school admins (NOT engineers).
- **AC:** Plain language; PABSON-archetype examples.

#### **M10.3 — Rollback runbook**
- **Files:** `docs/runbooks/pdf-frontend-rollback.md` (NEW)
- **Implementation:** Documents `vercel rollback <deployment>` workflow + git revert pattern. For each M-sprint feature, lists the dominant regression risks + how to hotfix.
- **AC:** First-call engineer can revert any M-sprint deploy in <5 min.

#### **M10.4 — Saraswati pilot sign-off ceremony**

---

## 13. Cross-Cutting Concerns

### 13.1 Testing pyramid (per ticket)
- **Unit (Vitest):** every service + hook. Mandatory.
- **Component (Vitest + RTL):** every UI ticket producing visible markup.
- **Integration (jsdom + mocked API or MSW):** flows that span multiple components / hooks.
- **E2E hand-test (Vercel preview + dev-pabson-primary live backend):** sprint DoD gate. NOT a ticket.

### 13.2 PR + commit conventions
- One ticket = one PR. Branch: `sprint/m{N}-{ticket-id}-{slug}`.
- PR description quotes the ticket's AC verbatim as a checklist.
- CodeRabbit findings addressed in-PR before merge (per project history: every C.1 PR caught + fixed CodeRabbit findings).
- Per CLAUDE.md house rules: no `--no-verify`, no force-push to main, no amending published commits.

### 13.3 Cross-repo / pin-bump coordination
- **`@aibrains/shared-types` minor bump** (M0.4 + any future bump): npm publish → bump every consumer pin → refresh lockfile → backend `nest build` + ECR rebuild (the workspace-only Docker trap applies to backend, not frontend, but pin consistency required). AdminWeb jsdom-sim if AdminWeb imports the new exports.
- **`@aibrains/pdf-renderer` minor bump** (M5.1): same as above. AdminWeb does NOT import pdf-renderer (verify pre-publish), so jsdom-sim is N/A.

### 13.4 Backend-lag protocol
When a sprint's backend prereq is not yet shipped:
- Frontend PRs may merge to `main` behind a feature flag (use `apps/shell/src/config/feature-flags.ts` — verify pattern exists; if not, M5 must add it).
- Flag default: OFF in prod.
- Flag toggle path: `apps/shell` env var → Vercel project setting per env (preview vs prod).
- Flag retirement: ticket lands when backend ships; flag deleted in PR that wires the flag-gated UI to "always on."
- Applies to: M5 (until C.2.1 ships), M6 (C.2.5), M7 (C.3.2), M8 (C.4), M9 (D.4 + D.5 + C.5).

### 13.5 Rollback strategy (Vercel-on-merge)
Per `feedback_pr_first_no_more_uat`: every merged PR is in prod within minutes. Two rollback paths:
1. **`vercel rollback <deployment>`** — fastest; reverts entire Vercel deploy to prior successful build. Available to anyone with Vercel project access.
2. **`git revert <sha> + push main`** — slower (Vercel rebuilds) but auditable. Preferred when issue affects multiple landed PRs.
Documented in M10.3.

### 13.6 Risk register (this plan)

| ID | Risk | Mitigation | Sprint |
|---|---|---|---|
| RM0-1 | Test runner bootstrap diverges across MFEs | M0.1/2/3 use identical vitest.config.ts shape | M0 |
| RM0-2 | shared-types pin sweep introduces TS errors | Run typecheck per app; widen pin if needed | M0 |
| RM1-1 | `window.location.href` drops Cognito on reload | M0.6 verification + M0.5 logged 404 boundary | M0/M1 |
| RM1-2 | Cross-MFE nav patterns multiply unmaintainable | M0.7 lint rule; revisit if pain grows | M0/M1 |
| RM3-1 | S3 CORS rejects PUT from Vercel preview origin | Backend CORS already permits dev-pabson-primary upload origin; verify in M3 hand-test | M3 |
| RM5-0 | `<PDFViewer>` doesn't boot under MF host | M5.0 spike is GO/NO-GO gate | M5 |
| RM5-1 | yoga-WASM / pdf.js browser bundle too large | M5.6 lazy import + M5.12 budget | M5 |
| RM5-2 | Live preview perf storm | 300ms debounce + sample-data memoization | M5 |
| RM5-3 | Descriptor registry duplication across MFEs | M5.2 singleton + assertion in M5.0 | M5 |
| RM5-4 | C.2.1 backend lag | Feature flag per §13.4 | M5 |
| RM7-1 | `academics-services` package may not exist | M7.0 scaffolds if absent | M7 |
| RM8-1 | Mobile multi-select UX | M8.7 review; potential redesign | M8 |
| RM10-1 | Rollback path untested | M10.3 documents + tests via a low-stakes intentional revert during pre-pilot | M10 |

### 13.7 abac (`@edforge/abac`) tuples to add
Before each sprint, verify these `(action, resource)` tuples exist; add to abac registry in same PR if not:
- M2.5: `('view', 'branding')`
- M3.5: `('configure', 'branding')`
- M4.5: `('view', 'pdf-templates')`
- M5.10: `('configure', 'pdf-templates')`
- M8.3: `('create', 'pdf-jobs')`

Each new tuple must be wired to the backend's permission-registry equivalent (`server/application/microservices/identity/src/common/constants/permission-registry.ts`) — typically already done by backend prereqs, but verify per-ticket.

### 13.8 Out of scope
- Backend ticket work (except M5.1 publish coordination + abac tuple additions).
- AdminWeb UI changes — template editor is tenant-facing per design.
- Migration of existing issued docs (lazy-default pattern; no migration).
- Customer-facing storefront for branding examples.
- V1.5+ doc types (transcript, ID card, certificates) — descriptor pattern means each is ~1-2 days; not pre-planned.

---

## 14. Open Questions for Product / Engineering

1. **C.2.1 backend ETA?** M5 sprint cannot start without it. Currently not scheduled on master plan §0.4.
2. **abac action/resource enum extensions** — coordinate naming with backend permission-registry. Tuples chosen above mirror existing `(view, X)` / `(configure, X)` convention.
3. **Feature flag infrastructure** — does Shell already have `feature-flags.ts`? If not, M5 (or earlier sprint) bootstraps.
4. **Mobile testing scope** — iOS Safari + Android Chrome? Saraswati operators' devices? Inform M8 design.
5. **Saraswati pilot date** — does timeline force prioritization (skip M5 → M7 if report cards higher-urgency than custom invoices)?
6. **Customer support tooling** — when an operator reports "my PDF looks wrong," how do we reproduce? V1.5 spike: an admin-side "render a doc with these inputs" debug page.

---

## 15. Out-of-Sprint Hygiene
- Update `docs/pilot-greenlight/v1-master-epic-breakdown.md` §0.4 as each M-sprint ships.
- Create `project_sprint_m{N}_shipped` memory entries per CLAUDE.md auto-memory rules after each sprint.
- Append `MEMORY.md` index entry per sprint (keep ≤150 chars per the memory-size warning).
- Append `docs/deploys/INDEX.md` for any PRs that trigger ECR/CDK changes (M5.1 is the candidate).

---

**END OF PLAN**

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

## 0. State at Plan-Time (last refresh 2026-05-27 PM — comprehensive ground-truth audit after PR #90 merge)

> **Audit basis:** This section was rewritten in full on 2026-05-27 after a code-vs-doc audit. Every status flip below is anchored to a merge commit on `main` (backend `/Users/shoaibrain/edforge` OR frontend `edforge-saas-frontend`), a deploy log under `docs/deploys/`, or a verified live state of code. **No claims here are extrapolated from intent — only from artifact.**
>
> **Headline:** The PDF service is **functionally feature-complete for the C.1 surface** (Invoice + Receipt downloads end-to-end through the UI) AND **branding read + write is functionally feature-complete** (text, colors, AND asset uploads — logo / principal-signature / letterhead-background). All three of M1, M1.5-FU, M2, M3-phase-1, M3-phase-2 shipped in prod (Vercel auto-deploy on merge to `main`). Two pre-existing gaps remain unresolved and are now captured below: (a) `letterheadBackgroundSrc` is declared in `descriptors/types.ts` and passed by finance renderers but **no renderer consumes it** — uploaded letterhead is not in the rendered PDF; (b) the asset-upload UX shows the prior asset thumbnail until Save (no local blob preview). Neither blocks pilot operator usage of M2+M3 branding; both are appropriate C.1.7-followup / M3-phase-3 work.

### 0.1 Backend live in prod 🟢 (last verified 2026-05-27)

| Capability | Endpoint | Owner | Shipped via |
|---|---|---|---|
| Branding read | `GET /schools/:schoolId/branding` (returns raw S3 keys + signed `urls.*` via C.0-followup) | identity | PRs #189 + #195 |
| Branding asset presign | `POST /schools/:schoolId/branding/assets/upload-url` (5-min PUT TTL, ABAC-scoped to tenant prefix, **`requestChecksumCalculation: 'WHEN_REQUIRED'`** since PR #209 — see §0.3.5) | identity | PRs #189 + #209 |
| Branding write | `PATCH /schools/:schoolId/branding` (additive merge; bumps `brandingVersionId`) | identity | PR #189 |
| PDF-assets bucket CORS | S3 CORS allows `https://edforge.app`, `https://www.edforge.app`, `https://edforge-saas-frontend-*.vercel.app` for PUT/GET/HEAD with `ETag` + `x-amz-version-id` exposed; 50-min maxAge | analytics-stack | PR #210 (deployed 2026-05-27 01:18 UTC, log `analytics-prod-analytics-stack-20260527-011646-1071a3c.log`) |
| PDF template read | `GET /schools/:schoolId/pdf-templates/:docType/current` (lazy default — returns descriptor.defaults() on persisted miss, NO DDB write) | identity | PR #199 |
| Invoice PDF | `GET /schools/:schoolId/invoices/:invoiceId/pdf` (smoke PASS 15,321B `application/pdf`) | finance | PR #201 |
| Receipt PDF | `GET /payments/:paymentId/receipt/pdf?schoolId=…` (smoke PASS 17,034B `application/pdf`) | finance | PR #202 |
| Descriptors | `INVOICE` + `RECEIPT` registered in `@aibrains/pdf-renderer@0.6.0` | library | PRs #196 + #198 |

### 0.2 Frontend live 🟢 (last verified 2026-05-27 against origin/main `d063a88`)

**Finance MFE — C.1 download surfaces:**
- `@edforge/finance-services`: `downloadReceiptPdf` + `useDownloadReceiptPdf`; `downloadInvoicePdf` + `useDownloadInvoicePdf`; `usePdfErrorToast`; `trackPdfDownload*` telemetry. (`viewDocument` + `receiptHref` cross-MFE-nav helpers retired in M1.5-FU.6.)
- `apps/finance/src/components/billing/PaymentReceipt.tsx`: Download + (HTML) Print buttons wired; jspdf retired.
- `apps/finance/src/routes/billing/payments/$paymentId/receipt.tsx`: in-MFE receipt page (moved from Shell in M1.5-FU.2).
- `apps/finance/src/routes/billing/payments/index.tsx`: View Receipt eye-icon (`navigate({to: '/payments/$paymentId/receipt'})`, in-MFE smooth nav) + per-row `ReceiptDownloadIconButton` (M1.5-FU.4).
- `apps/finance/src/routes/billing/invoices/$invoiceId.tsx`: Download PDF button next to Print on Invoice detail.
- `apps/finance/src/routes/billing/invoices/index.tsx`: per-row Download PDF action on the Invoice list (per-row hook instance for state isolation).

**Shell — M2/M3 Branding surfaces (new):**
- `@edforge/identity-services` (NEW workspace package, PR #88 M2.1): services + React Query hooks + types for branding. **Not** a MF singleton (stateless — same precedent as `@edforge/finance-services`); cache shared via `@tanstack/react-query` singleton. Exports: `getBranding`, `updateBranding`, `presignBrandingUpload`, `uploadAssetToS3`, `useSchoolBranding`, `useUpdateBranding`, `usePresignedAssetUpload`, `runAssetUpload`, `brandingKeys`, types `BrandingResponse`/`SchoolBrandingDto`/etc., constants `BRANDING_ASSET_TYPES`/`BRANDING_ASSET_MIME_ALLOWLIST`/`BRANDING_ASSET_MAX_BYTES`.
- `apps/shell/src/pages/settings/branding.tsx`: `/settings/branding` page (PR #88). View-only via `BrandingDisplay`; "Edit" button toggles to `BrandingForm` when `usePermission('configure', 'branding')` allows it (PR #89).
- `apps/shell/src/components/branding/BrandingDisplay.tsx` (PR #88, 269 LOC): read-only viewer — logo (signed GET URL from `branding.urls?.logo`), formal name (locale-aware), color swatches (ARIA-labeled), PAN/VAT, address, contact, signature thumbnail.
- `apps/shell/src/components/branding/BrandingForm.tsx` (PR #89 + extended in PR #90, 489 LOC): RHF form. Fields: formalName, tagline, panNumber, vatNumber, contact email/phone, addressLines (multi-line), `BrandingColorPicker` × 2 (primary + accent), `BrandingFileField` × 3 (logo + principalSignature + letterheadBackground). Wired to `useUpdateBranding` (diff-based PATCH — only dirty fields sent). `useFormDirtyGuard` (preexisting hook reused) wraps Cancel button. Submit disabled when `!isDirty || mutation.isPending`.
- `apps/shell/src/components/branding/BrandingColorPicker.tsx` (PR #89, 146 LOC): `<input type="color">` + text input via `Controller` from `@edforge/forms`.
- `apps/shell/src/components/branding/BrandingFileField.tsx` (NEW PR #90, 327 LOC): per-slot file picker. Pre-validates MIME + size synchronously, runs presign → S3 PUT via `usePresignedAssetUpload`; updates form state with returned `s3Key`. Disabled during upload; spinner state. Renders current asset thumbnail (img for PNG/JPEG/SVG; "View PDF" link for letterhead PDF). i18n keys under `form.upload.*` (en + ne parity).

**Cross-cutting (shipped via M0 + M1.5-FU):**
- `packages/ui`: `MfeNotFoundBoundary` replaces silent `() => null` 404s across every MFE router (M0.5 PR #66).
- `packages/config/src/mf-shared.ts`: finance MFE adopts the canonical singleton helper (M1.5 hotfix PR #78).
- `packages/config/eslint-mfe-nav.js`: ESLint guard blocks shell-owned route patterns inside MFE `navigate({to: ...})` calls (M0.7 PR #71; receipt-specific selectors relaxed in M1.5-FU.6 PR #86 once receipt moved in-MFE).
- `packages/abac/src/permissions.ts`: `branding` resource + `view` / `configure` actions; Principal granted `['view', 'configure']` on `branding`; TenantAdmin bypasses via globalRole (PR #88).
- `packages/i18n/src/locales/{en,ne}/branding.json`: branding namespace, full parity.

**What's NOT live yet (as of 2026-05-27):** M4 (templates read), M5 (template editor), M6 (immutability surfacing), M7 (Report Card download), M8 (batch UI), M9 (admit card UI), M10 (operator UAT + docs). See §1 Sprint Map for the up-to-date status grid and §0.6 below for the remaining-PDF-service-work catalog with concrete next-step ordering.

### 0.2-shipped — Shipped work log (Slice 1 + Slice 2 closed 2026-05-26)

> Two slices of the plan are shipped end-to-end. The view-receipt regression that triggered this whole plan is closed, AND the C.1 Invoice PDF + Receipt PDF surfaces are reachable from the UI. Per `feedback_pr_first_no_more_uat`, every PR below is live on `edforge.app` post-merge.

**Slice 1 — Stop the bleeding + safety nets (8 PRs):**

| PR | Ticket | Repo |
|---|---|---|
| edforge#205 | M1.7 — smoke harness `Content-Type` `\|\| true` fix | server |
| #65 | M0.1 — bootstrap vitest in `apps/finance` | frontend |
| #66 | M0.5 — `MfeNotFoundBoundary` across 7 MFEs (replaces silent `() => null`) | frontend |
| #67 | M0.5 review-fix — pure-render boundary + clean Location restore | frontend |
| #68 | M1.1 — `viewDocument` + `receiptHref` helpers | frontend |
| #69 | M1.1 review-fix — same-origin guard on `viewDocument` | frontend |
| #70 | M1.2 — View Receipt button navigates to shell route, not raw API URL | frontend |
| #71 (+ followup #71.fu) | M0.7 — ESLint rule blocks `/payments/:id/receipt` from non-shell MFEs | frontend |

**Slice 2 — Complete C.1 frontend (Invoice PDF download flow) (10 PRs):**

| PR | Ticket | Repo |
|---|---|---|
| #72 | M1.3 — `downloadInvoicePdf` service in `@edforge/finance-services` | frontend |
| #73 | M1.4 — `useDownloadInvoicePdf` mutation hook | frontend |
| #74 | M1.4 review-fix — empty/whitespace `invoiceNumber` falls back to id-derived filename | frontend |
| #75 | M1.11 — `usePdfErrorToast` canonical PDF error UX (auto-wired into both download hooks) | frontend |
| #76 | M1.10 — `pdf_download_{started,succeeded,failed}` telemetry via `window.va` (no SDK dep) | frontend |
| #77 | M1.5 — Download PDF button on Invoice detail page | frontend |
| #78 | M1.5 hotfix — finance MFE adopts canonical `getMFSharedConfig` (fixes i18n button-label rendering as raw key in prod) | frontend |
| #79 | M1.6 — per-row Download PDF action on Invoice list with per-row hook instances | frontend |
| #80 | M1.8 — drop `jspdf` + `html2canvas` from `apps/shell` (-18 transitive pkgs) | frontend |
| #81 | M1.9 — drop dead `receiptRef` from `PaymentReceipt.tsx` | frontend |
| #82 | M1.10 followup — widen `Window.va.properties` to `unknown` to coexist with `@vercel/analytics` SDK ambient declaration | frontend |

**End-to-end proven in prod (live testing 2026-05-26):**
- Invoice list per-row Download → real PDF (`INV-…pdf`) downloads with PABSON branding + Devanagari fonts
- Invoice detail Download PDF button → same
- View Receipt eye-icon → navigates to receipt page (no longer opens raw JSON in new tab)
- `pdf_download_started/succeeded/failed` events firing in Vercel analytics
- Localized error toasts on 4xx/5xx
- ESLint rule prevents regression of the cross-MFE `navigate()` trap

**Slice 3 — Sprint M1.5-FU: Receipt page → Finance MFE + 404 root-cause fix (5 PRs):**

| PR | Ticket | Repo |
|---|---|---|
| #83 | M1.5-FU.1 — hot-patch `getPaymentReceipt(paymentId, schoolId)` + `usePaymentReceipt` gated on both; unblocked testing while still in Shell | frontend |
| #84 | M1.5-FU.2 + .3 + .5 — move receipt page to `apps/finance/src/routes/billing/payments/receipt.tsx`; relocate `PaymentReceipt.tsx` into Finance MFE; revert eye-icon to in-MFE `navigate({to:...})`; `onBack` + error-state Return route to `/payments` (not `/parent-portal/fees`) | frontend |
| #84 followup | CodeRabbit: replace `as string` casts on `navigate({to})` with typed routes (6 billing files); `isLoading || isPending` in receipt page (covers idle pre-`schoolId`); empty-string filename `??` → `.trim() ||`; widen `Window.va.properties` to `unknown`; add `flow.returnToPayments` i18n key (en + ne) | frontend |
| #85 | M1.5-FU.4 — per-row `ReceiptDownloadIconButton` on Payments list with per-row `useDownloadReceiptPdf` hook instances; 3-spec isolation invariant test mirroring M1.6's invoice-list test | frontend |
| #86 | M1.5-FU.6 — delete `viewDocument` + `receiptHref` helpers + navigation-helpers spec (-10 tests, dead code); relax M0.7 ESLint rule to drop `/payments/<id>/receipt` selectors (Finance owns the route now) while keeping `/settings/...` + `/home/...` selectors | frontend |

**End-to-end proven in prod (live testing 2026-05-26 PM):** receipt page loads on completed payments via the eye-icon (in-MFE smooth nav, no full reload); per-row Download produces server-rendered receipt PDF with PABSON branding; "Return" button routes to `/finance/payments` not parent portal; deep-link to `/finance/payments/<id>/receipt` resolves cleanly. **Surfaced 5 new issues (§0.3 #18-22) that Sprint M1.5-FU.7 addresses.**

**Slice 4 — Sprint M2 (Branding read) + Sprint M3 phase 1 (Branding text+colors write) + Sprint M3 phase 2 (Asset uploads write) + 2 server hotfixes (5 PRs total):**

| PR | Ticket | Repo | Notes |
|---|---|---|---|
| #88 | **M2** Branding read at `/settings/branding` | frontend | NEW workspace package `@edforge/identity-services` + `BrandingDisplay` + ABAC `(view, 'branding')` (PRINCIPAL + TenantAdmin); inline types (M0.9 type-promotion deferred); 1 review-fix `25fad59` gates `useSchoolBranding` on `canView`; 54/54 specs |
| #89 | **M3 phase 1** Branding write (text + colors) | frontend | `BrandingForm` (RHF) + `BrandingColorPicker`; diff-based PATCH; reuses preexisting `useFormDirtyGuard`; edit-toggle on `usePermission('configure', 'branding')`; review-fix `1c71898` consolidates RHF imports through `@edforge/forms` + fail-fasts on undefined `schoolId`; 81/81 specs (M2 + M3 combined) |
| edforge#209 | Server fix: AWS SDK v3 `requestChecksumCalculation: 'WHEN_REQUIRED'` on `S3Client` | server | Pre-blocks M3 phase 2: SDK v3.730+ default `WHEN_SUPPORTED` embeds `x-amz-checksum-crc32=AAAAAA==` (empty-payload CRC) into every signed PUT URL → S3 rejects every non-empty browser upload. WHEN_REQUIRED reverts to pre-v3.730 behavior. +2 regression-guard specs in `s3-presigner.service.spec.ts`. Deploy logs `prod-build-application-identity-20260527-054726-785a1fc.log` + `prod-ecs-roll-identitybasic-20260527-054826-785a1fc.log`. |
| edforge#210 | Server fix: PdfAssetsBucket CORS on `analytics-stack` | server | `NoSuchCORSConfiguration` blocked browser preflight after #209 unblocked checksum. CDK `CorsRule`: `AllowedMethods: [PUT, GET, HEAD]`, 3 origins (`https://edforge.app` + `https://www.edforge.app` + `https://edforge-saas-frontend-*.vercel.app`), `AllowedHeaders: ['*']`, `ExposedHeaders: ['ETag', 'x-amz-version-id']`, `maxAge: 3000`. CDK property name = `maxAge` (not `maxAgeSeconds`). Regression spec on `analytics-stack.spec.ts` asserts the full CORS shape. Deploy log `analytics-prod-analytics-stack-20260527-011646-1071a3c.log` shows `UPDATE_COMPLETE` on `PdfAssetsBucket838FC56C` in 23s. Verified live via `aws s3api get-bucket-cors`. |
| #90 | **M3 phase 2** Branding asset uploads (logo + signature + letterhead) | frontend | `BrandingFileField` × 3 (327 LOC NEW) + `usePresignedAssetUpload` hook (116 LOC NEW) + per-asset MIME allowlist + size caps (`BRANDING_ASSET_MAX_BYTES` map: logo 2MB, signature 1MB, letterhead 5MB); raw `fetch` for S3 PUT (avoids axios leaking Cognito Authorization header to S3 CDN); review-fix `0f35028` cleans up helper text + dead sentinel; ~1.5K LOC + 4 spec suites |

**End-to-end proven in prod (live testing 2026-05-27 morning):**
- `/settings/branding` loads on dev-pabson-primary (PABSON Saraswati school) as both TenantAdmin and Principal; Standard user gated.
- BrandingForm round-trip: edit formalName + brand colors + addressLines + PAN → Save → `useUpdateBranding` PATCHes diff only → success toast → refetch → BrandingDisplay reflects updates.
- BrandingFileField round-trip: pick PNG → MIME + size validate inline → POST to upload-url → PUT to S3 (with CORS) → `s3Key` set in form state → Save → server PATCH stores `logoS3Key` → next invoice/receipt PDF download embeds new logo (via existing C.1.5/C.1.6 branding fetch + react-pdf inline-image bytes).
- All three asset slots (logo, signature, letterhead) PUT successfully after PR #209 + #210 deploys. Letterhead PDF uploads to S3 but **is not rendered in the invoice/receipt PDF output** (see §0.3 Issue #24 — pre-existing pdf-renderer feature gap, not an M3 regression).

### 0.3 Known issues (this plan's inputs) ⚠️

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | View Receipt eye-icon → blank screen via cross-MFE basepath collision | P0 regression | ✅ Closed (M1.2 PR #70) |
| 2 | Invoice detail: Download PDF button missing | P1 incomplete | ✅ Closed (M1.5 PR #77) |
| 3 | Smoke harness aborts on missing `Content-Type` under `set -euo pipefail` | P2 fragility | ✅ Closed (M1.7 server #205) |
| 4 | `jspdf` + `html2canvas` orphan deps in `apps/shell` | P3 debt | ✅ Closed (M1.8 PR #80) |
| 5 | `@aibrains/shared-types` caret-pin drift across consumers | P0 prereq | 🟡 Partial — M0.4 deferred until M2 actually consumes new types. Current Slice 1+2 didn't need it (M1.11 added `@edforge/i18n` to apps/finance which transitively kept pins consistent). Will land with M2. |
| 6 | `apps/finance` has no test runner | P0 prereq | ✅ Closed (M0.1 PR #65) |
| 7 | `defaultNotFoundComponent: () => null` silent 404 across MFE routers | P1 hygiene | ✅ Closed (M0.5 PR #66) |
| 7a | `BrandingResponse` + `PdfTemplateCurrentResponse` not exported from shared-types | P0 prereq | 🔲 Deferred to M2 (only blocks branding read; Slice 2 didn't need it) |
| 7b | Frontend ABAC missing `configure` / `branding` / `pdf-templates` enums | P0 prereq | 🔲 Deferred to M2 (only blocks branding gate; Slice 2 didn't need it) |
| 8 | No frontend branding read OR write integration | P1 | 🔲 M2 + M3 (next sprint) |
| 9 | No frontend PDF templates read | P1 | 🔲 M4 |
| 10 | No Template Editor UI (C.2 frontend) | P1 | 🔲 M5 (gated on C.2 backend) |
| 11 | No Report Card download button (C.3 frontend) | P2 | 🔲 M7 (gated on C.3 backend) |
| 12 | No Batch Generation UI (C.4) | P2 | 🔲 M8 (gated on C.4 backend) |
| 13 | No Admit Card UI (C.5) | P3 | 🔲 M9 (gated on D.4/D.5 + C.5 backend) |
| **14** | **`GET /finance/payments/:id/receipt` requires `?schoolId=` (backend), but frontend `getPaymentReceipt(paymentId)` doesn't pass it → DDB lookup builds malformed key `PAYMENT#undefined#<id>` → 404 "Payment not found" on every receipt fetch. **Currently blocks all receipt-PDF testing in prod** (the user can see the payment in the Payments list — DDB record is fine — but the receipt route page can't load it).** | **P0 blocker** | 🔴 **M1.5-FU (next)** |
| **15** | **Receipt page is shell-owned but should belong to Finance MFE.** Parent/Student portal access is OUT OF SCOPE per 2026-05-26 product decision. Shell ownership is what created Issue #14 (no school context on the page → no `schoolId` to pass to the API). Also forces the cross-MFE full-page-reload nav pattern that Option A in §0.5 reluctantly adopted. | **P0 architectural** | 🔴 **M1.5-FU (next)** |
| **16** | **Payments list has no per-row Download** — symmetric gap to M1.6 (which added per-row Download to the Invoice list). Operators currently need eye-icon → receipt page → Download button (2 clicks + full reload). | **P1 UX gap** | 🔴 **M1.5-FU (next)** |
| **17** | **"Return to Invoices" button on the shell receipt page hardcodes `/parent-portal/fees`** ([receipt.tsx:41,54](apps/shell/src/pages/payments/receipt.tsx)) — wrong destination for admins. Was correct for the original parent-flow design; now misroutes Finance admins to the parent portal. | **P1 routing bug** | ✅ Closed (M1.5-FU.5 PR #84) |
| **18** | **Breadcrumbs auto-generate clickable Links for every non-final URL segment, including dynamic UUID segments that don't have a matching route.** URL `/finance/payments/<paymentId>/receipt` produces a "Details" crumb linking to `/finance/payments/<paymentId>` — but Finance MFE only defines `/payments` and `/payments/$paymentId/receipt`. The intermediate path falls into `MfeNotFoundBoundary` and shows "Page not found." Root cause: [Breadcrumbs.tsx:242-266](apps/shell/src/components/layout/Breadcrumbs.tsx#L242-L266) computes `matchingRoute = matches.find(m => m.pathname === path)` (line 247) and stores it on the item for `routeId` only — never gates the Link-vs-span branch on its presence. Affects any deep route that passes through a dynamic segment without a corresponding own-page route (most "list → detail-subpage" flows). **First fix attempt (PR #87, 2026-05-26) widened the span-vs-Link predicate to `!isCurrentPage && !isNonNavigable && hasMatchingRoute` — this proved too broad: TanStack Router's `matches[]` pathnames don't always match the URL-segment-shaped paths the Breadcrumbs component constructs (route-id form, layout routes, trailing-slash variance), so VALID intermediate Links across Finance / Settings / Academics regressed into non-clickable spans. PR cancelled.** Correct fix shape: narrower predicate scoped to *dynamic* segments only, OR drive from route metadata (does the route registration include a standalone page at this dynamic level?). Verify any retry against Finance / Settings / Academics / list-detail flows on a Vercel preview BEFORE merge. See memory [[feedback-breadcrumb-predicate-too-broad]]. | **P1 navigation bug** | 🟡 **DEFERRED — needs a narrower predicate; see note** |
| **19** | **View Receipt eye-icon + Download PDF buttons on Payments list show for payments where `receiptNumber` is set but `status !== 'completed'`.** Backend `GET /finance/payments/:id/receipt` and `/receipt/pdf` both throw `BAD_REQUEST 400 "Receipt is only available for completed payments"` for non-completed statuses. Symptom in prod: clicking eye-icon on a refunded/voided/failed payment with a stale `receiptNumber` returns 400 from the API; the receipt page renders the generic "Failed to load" error. User-reported: "Its not consistently working for all the payments." The list-row gate at [payments/index.tsx](apps/finance/src/routes/billing/payments/index.tsx) checks `payment.receiptNumber` only — should AND with `payment.status === 'completed'`. | **P1 UX inconsistency** | 🔴 **M1.5-FU.7 (next)** |
| **20** | **Receipt page error UI shows generic `t('error.failedToLoad')` regardless of error class.** A 400 (wrong status) reads identically to a 404 (no such payment) reads identically to a 5xx. Operators can't tell whether the action is impossible-by-rule (refunded payment has no receipt) or transient-and-retryable. Should differentiate via `error.response?.data?.errorCode` / `status`. | **P2 UX clarity** | 🔴 **M1.5-FU.7 (next)** |
| **21** | **PaymentReceipt's "Print Receipt" button uses `window.print()`** ([PaymentReceipt.tsx](apps/finance/src/components/billing/PaymentReceipt.tsx)) — renders the live HTML page (with sidebar + header + breadcrumb + nav chrome via CSS print rules), NOT the polished server-rendered PDF. Two outputs from one UI for the same intent. Symmetric to the Download PDF button which DOES use the server-rendered PDF. Resolution options: (a) remove Print button entirely since Download already produces a print-ready PDF, or (b) wire Print to the same `useDownloadReceiptPdf` + `window.print()`-on-the-Blob flow. **Recommend (a)** — pure deletion + a stale i18n key removal; users print via Download → OS print dialog. | **P3 UX consistency** | 🔴 **M1.5-FU.7 (next)** |
| **22** | **Stray "Download PDF" tooltip leak visible top-left of Payments page** (per 2026-05-26 testing screenshot). Likely a tooltip portal anchored to a now-unmounted button OR a CSS `position: fixed` overlay that's missing a parent containment context. Needs investigation — could be Radix/shadcn tooltip provider mounting drift, or a Vercel preview-only artifact. Low confidence on cause until inspected with React DevTools. | **P3 UI artifact** | 🔴 **M1.5-FU.7 (next, investigate)** |
| **23** | **Sprint M3 phase 2 asset uploads to S3 fail every non-empty PUT** with a signature/checksum mismatch (AWS SDK v3.730+ `requestChecksumCalculation: 'WHEN_SUPPORTED'` default embeds empty-payload CRC32 into signed URL). | **P0 blocker** | ✅ **Closed 2026-05-27 via server PR #209** — `S3Client` constructed with `requestChecksumCalculation: 'WHEN_REQUIRED'` in [s3-presigner.service.ts:87](server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L87); +2 regression-guard specs in [s3-presigner.service.spec.ts](server/application/microservices/identity/src/common/services/s3-presigner.service.spec.ts) at the `requestChecksumCalculation: 'WHEN_REQUIRED'` assertion AND a defense-in-depth assertion that `ChecksumAlgorithm` is NOT on the PutObjectCommand input. |
| **23a** | **After PR #209, browser PUT still fails CORS preflight** — `OPTIONS https://edforge-pdf-assets-…/...` returns `NoSuchCORSConfiguration`. The PdfAssetsBucket created in C.0.6 via CDK had no `cors:` property. | **P0 blocker (revealed after #209 unblocked checksum)** | ✅ **Closed 2026-05-27 via server PR #210** — CDK `CorsRule` added with PUT/GET/HEAD methods; 3 origins (`https://edforge.app`, `https://www.edforge.app`, `https://edforge-saas-frontend-*.vercel.app`); `AllowedHeaders: ['*']`; `ExposedHeaders: ['ETag', 'x-amz-version-id']`; `maxAge: 3000`. Verified live via `aws s3api get-bucket-cors`. Regression spec on `analytics-stack.spec.ts`. Deployed via `./scripts/deploy-analytics.sh analytics-stack prod` (log `analytics-prod-analytics-stack-20260527-011646-1071a3c.log`). |
| **24** | **`letterheadBackgroundSrc` is declared in pdf-renderer descriptor type but no renderer consumes it.** [packages/pdf-renderer/src/descriptors/types.ts:66](packages/pdf-renderer/src/descriptors/types.ts#L66) defines `letterheadBackgroundSrc?: ImageSource;` on `BrandingPdfData`. Both finance renderers pass it: [receipt-pdf.renderer.ts:169](server/application/microservices/finance/src/payments/receipt-pdf.renderer.ts#L169) and [invoice-pdf.renderer.ts:141](server/application/microservices/finance/src/invoices/invoice-pdf.renderer.ts#L141). But `grep letterheadBackgroundSrc packages/pdf-renderer/src` returns ONLY the type declaration — no `Page`, `Document`, `BrandedHeader`, or descriptor template reads it. [Page.tsx:38](packages/pdf-renderer/src/primitives/Page.tsx#L38) sets `backgroundColor: DEFAULT_COLORS.background` and nothing else. **Result:** the M3 phase 2 letterhead upload succeeds end-to-end (S3 PUT works, `letterheadBackgroundS3Key` persists, GET signed URL mints), but the resulting PDF has no letterhead overlay. **This is a pre-existing pdf-renderer feature gap from C.0.3 (primitives), NOT a Sprint M3 regression.** | **P1 feature gap surfaced by M3 phase 2 prod test** | 🔲 **C.1.7-followup or future C.0.x ticket** — see §0.6 remaining-work catalog |
| **25** | **BrandingFileField shows the prior asset thumbnail until form is saved.** When operator picks a new file, `usePresignedAssetUpload` runs presign + S3 PUT + sets `s3Key` in form state — but `BrandingFileField`'s `currentUrl` prop reflects what the server last returned (last refetch's `branding.urls?.<asset>`). The just-uploaded file's signed GET URL is only available AFTER Save → refetch. UX feels like the upload didn't take effect. **Fix:** keep `URL.createObjectURL(file)` in local component state when upload succeeds; render that blob URL as a preview overlay until refetch supplies the canonical signed GET URL; revoke the blob URL on unmount. ~20-30 LOC in BrandingFileField. | **P2 UX gap surfaced by M3 phase 2 prod test** | 🔲 **M3-phase-2-followup ticket** — see §0.6 remaining-work catalog |

### 0.4 Architectural ground truth (verified against repo)
1. **Two independent git repos.** Per `feedback_explicit_cd_per_git`: every git command starts with `cd <repo-root>`. Server: `/Users/shoaibrain/edforge`. Frontend: `/Users/shoaibrain/edforge/edforge-saas-frontend`.
2. **Module Federation 2 / Rsbuild.** Shell is host. Each MFE router has its own `basepath`: Finance = `/finance` (`apps/finance/src/router.tsx:171`). Cross-MFE navigation **cannot** use the local MFE's `navigate({to: ...})` for shell-owned routes — it resolves against the MFE basepath.
3. **Receipt page is CURRENTLY shell-owned at `apps/shell/src/router.tsx:826-836` — ⚠️ this is the architectural defect Sprint M1.5-FU will correct.** The page belongs in Finance MFE (it's finance content; school context lives there; admin nav stays in-MFE without a full-page reload). Parent/Student portal access to receipts is **out of scope** per the 2026-05-26 product decision; if reintroduced later (V1.5+), the parent portal will mount its own receipt view inside the parent portal MFE, NOT share Finance's. See §0.5 for the corrected nav decision.
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

### 0.5 Cross-MFE navigation decision — **REVISED 2026-05-26 after Slice 1+2 testing**

The original §0.5 (this slot) chose Option A (`window.location.href` shim) on the premise that Receipt is shell-owned because parents/students would need access without Finance MFE loaded. Testing on dev-pabson-primary after Slice 2 shipped surfaced two facts that invalidate that premise:

1. **The receipt page is admin-facing in current scope.** Parent/Student portal access is deferred per the 2026-05-26 product decision. The shell-ownership rationale no longer applies.
2. **Shell-ownership was the root cause of the receipt 404** (Issue #14): a shell-mounted page has no natural source of `schoolId`, so `getPaymentReceipt(paymentId)` was written without it, the backend requires it as a `?schoolId=` query param, and the DDB lookup falls back to `PAYMENT#undefined#<id>` → 404. The PDF endpoint (C.1.6) avoided this because the Download button lives in Finance MFE where `useAppStore().activeSchoolId` is natural.

| Option | Pros | Cons | Verdict (revised) |
|---|---|---|---|
| **A**. `window.location.href` shim (`viewDocument` helper) | 3-line fix; no new shared surface | Full page reload; doesn't fix the underlying school-context loss → 404 bug | **Interim shim in Slice 1; superseded by Option C** |
| **B**. Shell-exposed `useShellNavigate()` via MF singleton | Client-side nav | Doesn't fix the school-context loss; new shared surface for one consumer | Rejected |
| **C**. Move receipt page into Finance MFE | Fixes the 404 root cause; in-MFE smooth nav; admin context is correct from the start; aligns with the established finance-page pattern | ~80 LOC of relocations + router rewire; M1.1's `viewDocument` + `receiptHref` helpers become dead code after the move | **CHOSEN — Sprint M1.5-FU** |

**What this means concretely:**
- The receipt page moves from `apps/shell/src/pages/payments/receipt.tsx` to `apps/finance/src/routes/billing/payments/$paymentId/receipt.tsx`
- Finance router mounts it at `/payments/$paymentId/receipt` (resolves through `basepath: '/finance'` to `/finance/payments/$paymentId/receipt`)
- The Payments-list eye-icon (M1.2 fix) reverts from `viewDocument(receiptHref(id))` to a normal in-MFE `navigate({to: '/payments/$paymentId/receipt'})` — same as the Invoice list's View button
- The shell route at `/payments/$paymentId/receipt` is dropped (MfeNotFoundBoundary will 404 cleanly if anything still navigates there)
- M1.1's `viewDocument` + `receiptHref` helpers become unused — Sprint M1.5-FU drops them
- M0.7's ESLint rule's `/payments/<id>/receipt` blocklist entry is removed — the route is in-MFE now, no longer cross-MFE-forbidden

**Why not just patch `getPaymentReceipt` to take a schoolId (a 2-line fix)?** That fix would close the 404 today, but the underlying defect — receipt-as-shell-content despite being finance domain — would still bite the next person who adds an admin-facing receipt feature (e.g., voiding, reprint history, audit log). The page belongs where the data does. Option C closes the root cause; the schoolId patch closes only the symptom.

---

## 0.6 Remaining PDF-service work catalog (last refresh 2026-05-27)

> This section is the consolidated punch-list for closing the PDF service end-to-end before returning to the V1 master EPIC-C roadmap. Every entry is anchored to evidence (a known issue # from §0.3, a deferred ticket from the original plan, or a verified gap from the as-shipped audit). Sprints are ordered by what unblocks what, not by ambition.

### A. Outstanding (small) cleanup behind the shipped surface

| # | Work | Type | Scope estimate | Why pickup-able now |
|---|---|---|---|---|
| 0.6.A.1 | **Sprint M1.5-FU.7.2/.7.3/.7.4/.7.5** — receipt-flow UX hardening (status-gate on per-row eye-icon, error-class differentiation on receipt page, drop Print button, investigate stray tooltip). Skip FU.7.1 (breadcrumb predicate) per §3.6 — needs separate narrower-predicate design. | UX hardening | ~80-120 LOC frontend + 6 specs | Was deferred behind M2 per 2026-05-26 PM. M2+M3 shipped → ready to resume. None of FU.7.2-.7.5 depend on M3 phase 2 work. |
| 0.6.A.2 | **M3-phase-2-followup: BrandingFileField eager preview** — Issue #25. Keep `URL.createObjectURL(file)` blob in local state on upload success; render as preview overlay until next refetch supplies the canonical signed GET URL; revoke on unmount. | Frontend UX | ~20-30 LOC in BrandingFileField + 1 new spec | Pure frontend cosmetic; no backend touch. Direct continuation of PR #90. |
| 0.6.A.3 | **M1.5-FU.7.1 reattempt** — breadcrumb predicate fix scoped to dynamic-only segments OR driven from route metadata (NOT widened `!matchingRoute`). Pre-merge verification matrix on Vercel preview: `/finance`, `/finance/payments`, `/settings/branding`, `/academics/students/<id>/grades`, `/finance/payments/<id>/receipt`. Memory pin: [[feedback-breadcrumb-predicate-too-broad]]. | Frontend bug | ~30-50 LOC in Breadcrumbs.tsx + spec; design pass first | Optional, not pilot-blocking — current behavior leaks one non-existent "Details" Link per deep-receipt URL only. |

### B. Pre-existing feature gap surfaced by M3 phase 2

| # | Work | Type | Scope estimate | Why classified here |
|---|---|---|---|---|
| 0.6.B.1 | **Issue #24 — `letterheadBackgroundSrc` actually renders.** Extend [packages/pdf-renderer/src/primitives/Page.tsx](packages/pdf-renderer/src/primitives/Page.tsx) (or `Document.tsx`) to render an absolutely-positioned `<Image>` primitive at full page bounds behind content when `branding.letterheadBackgroundSrc` is provided. PDF page sizing constants apply (A4 = 595×842pt at 72dpi). Snapshot test against PABSON letterhead fixture. Bumps `@aibrains/pdf-renderer` to 0.7.0. Per CLAUDE.md publish-gate: npm publish → bump every consumer pin → AdminWeb jsdom sim (verify if AdminWeb imports pdf-renderer; per §0.4 it does not — skip). Then backend ECR rebuild for finance + identity (which has the `letterheadBackgroundS3Key` plumbing). | Feature gap closure | ~50-80 LOC pdf-renderer + 1 snapshot fixture + cross-repo pin bump + ECR rebuild | Originally scoped under C.0.3 layout primitives but the descriptor type promised the field while no primitive consumed it. Operators can NOT use the M3 phase 2 letterhead upload until this lands. |

### C. Continuing the original integration plan (gated on backend NOT yet shipped)

| # | Work | Status | Backend prereq | Gate |
|---|---|---|---|---|
| 0.6.C.1 | **Sprint M4 — Templates read** | 🔲 not started, backend ready | C.1.3 `GET /pdf-templates/:docType/current` ✅ shipped | M0.9 type promotion ideal but not mandatory — inline-types path can ship today (already proven by M2 + M3 packaging `BrandingResponse` inline in `@edforge/identity-services/types`). |
| 0.6.C.2 | **Sprint M5 — Template Editor UI** | 🔲 not started | **C.2.1 backend `PATCH /pdf-templates/:docType` + draft/publish/republish endpoints — NOT shipped** | Cannot start until backend ships. Confirm in master EPIC-C C.2 priority before opening this. |
| 0.6.C.3 | **Sprint M6 — Immutability surfacing** | 🔲 not started | C.2.5 backend (freeze `pdfTemplateRef` at issue) — NOT shipped | Gated on C.2.5. |
| 0.6.C.4 | **Sprint M7 — Report Card PDF** | 🔲 not started | C.3.2 backend `GET /result-cards/:id/pdf` — NOT shipped (gated on A.4 ✅ + C.3.1 descriptor ➕) | Critical for Saraswati pilot (Month 2-3 of adoption per master plan §1.2). |
| 0.6.C.5 | **Sprint M8 — Batch generation UI** | 🔲 not started | C.4.1 Lambda + C.4.2 endpoints — NOT shipped | Lower priority for pilot — operators rarely need bulk-50 PDFs at once in pilot; report-card batches matter most. |
| 0.6.C.6 | **Sprint M9 — Admit Card UI** | 🔲 not started | D.4 + D.5 + C.5 backend — NONE shipped | Required for BLE/SEE prep Spring 2027 (master plan §1.2); not pilot-Day-1. |
| 0.6.C.7 | **Sprint M10 — Operator UAT + docs** | 🔲 not started | All prior PDF sprints | Pre-pilot greenlight gate. |

### D. Deferred housekeeping (not pilot-blocking; do when convenient)

| # | Work | Notes |
|---|---|---|
| 0.6.D.1 | **M0.4 — `@aibrains/shared-types` pin sweep to current published** | Currently 7 consumers (`apps/{shell,academics,people,analytics}/package.json` + `packages/{types,forms,date-utils}/package.json`) pinned at `^0.40.0` or `^0.51.0`; npm has `0.61.0` live. Cosmetic until M0.9. |
| 0.6.D.2 | **M0.9 — Promote `BrandingResponse` + `PdfTemplateCurrentResponse` to `@aibrains/shared-types`** | Currently inlined in `@edforge/identity-services/src/types.ts` (M2/M3 used the inline path). Type-promotion is mechanical; same shape, just move the file + re-export. Bumps shared-types to 0.62.0. Frontend gets canonical types matching backend `branding.types.ts` + `pdf-templates.types.ts`. |
| 0.6.D.3 | **M0.10 — Frontend ABAC enum extension to `pdf-templates` + `pdf-jobs`** | `branding` already wired (PR #88). When M4 starts, add `'pdf-templates'` + `'pdf-jobs'` to `Resource` in `packages/abac/src/permissions.ts` and grant Principal `pdf-templates: ['view', 'configure']` + `pdf-jobs: ['view', 'create']`. |

### E. Recommended execution order (closes PDF service end-to-end without backend rework)

Reading the matrix:

1. **0.6.A.2** (eager preview) + **0.6.A.1** (M1.5-FU.7.2-.7.5) — small UX cleanup behind shipped surfaces. Single morning.
2. **0.6.B.1** (letterhead rendering) — the only pdf-renderer extension required to make M3 phase 2 letterhead upload functionally meaningful. Half a day.
3. **0.6.C.1** (M4 templates read) — opens read-only template inspection in Settings, no backend writes needed.
4. **Pause / sync with backend** — confirm C.2.1 backend ETA (currently "NOT shipped" per §0.4 master plan). If C.2.1 not slotted, move to D.4 BLE Workflow per master plan §0.4 critical-path move #3, returning to M5+ once backend lands.
5. **Backend-dependent sprints** (M5 → M6 → M7 → M8 → M9 → M10) — proceed in master-plan order once each backend prereq ships.

**Sequencing note for ICs:** Sections A + B + 0.6.C.1 above are pre-Greenlight pilot-completing work. Sections 0.6.C.2-0.6.C.7 are post-Greenlight or later — they require backend that has its own priority queue in the V1 master plan, not this plan. When you finish A + B + 0.6.C.1, the right move is to hand off to the master plan and pick up the next critical-path sprint there (D.4 BLE Workflow is research-resolved + dependency-clear per memory `project_v1_master_plan_locked`).

---

## 1. Sprint Map (at a glance)

| Sprint | Title | Outcome | Backend Prereq | Status |
|---|---|---|---|---|
| **M0** (partial) | Foundation hygiene | Test runner + 404 boundary shipped; pin sweep + types promotion + ABAC enums deferred to M2 prereq | — | 🟢 M0.1 + M0.5 shipped; M0.4 + M0.9 + M0.10 still required for M2 |
| **M1** | Close C.1 frontend (Invoice PDF + Receipt nav) | Invoice PDF download via detail + list per-row; View Receipt eye-icon fixed | None (live) | ✅ Shipped (18 PRs) |
| **M1.5-FU** | Receipt page → Finance MFE + 404 root-cause fix + Payments list Download + Return-to-Invoices fix | All receipt PDF flows reachable + working on dev-pabson-primary; in-MFE nav (no full reload); admin "Return" routes to Finance | None (live) | ✅ Shipped (5 PRs: #83/#84/#85/#86 + #84 followup) |
| **M1.5-FU.7** | Receipt UX hardening (breadcrumb bug + status-gate + error differentiation + Print button + stray tooltip) | View/Download only on completable rows; breadcrumb never offers non-existent routes; differentiated 400/404/5xx UX; one canonical print path | None (live) | 🟡 **PAUSED — FU.7.1 attempt cancelled (PR #87); other FU.7.2-FU.7.5 fixes valid but deferred behind M2 per 2026-05-26 PM decision** |
| **M2** | Branding read | TenantAdmin/Principal sees branding in Shell settings | None (live) | ✅ Shipped 2026-05-26 (PR #88) |
| **M3 phase 1** | Branding write (text + colors) | Operator edits formalName / tagline / PAN/VAT / contact / address / brand colors | None (live) | ✅ Shipped 2026-05-26 (PR #89) |
| **M3 phase 2** | Branding write (asset uploads) | Operator uploads logo / signature / letterhead via presigned PUT | Server-fix for AWS SDK v3 checksum default (Issue #23) + S3 CORS (#23a) | ✅ Shipped 2026-05-27 (FE PR #90 + server PRs #209 + #210; live e2e proven post-deploy) |
| **M3 phase 3** (NEW, scope below) | Asset-upload UX preview + letterhead PDF rendering | Eager blob-preview before Save (Issue #25) + `letterheadBackgroundSrc` actually rendered as page background (Issue #24) | None for #25; pdf-renderer 0.7+ minor for #24 | 🔲 Scoped in §0.6 below |
| **M1.5-FU.7** | Receipt UX hardening (breadcrumb bug + status-gate + error differentiation + Print button + stray tooltip) | View/Download only on completable rows; breadcrumb never offers non-existent routes; differentiated 400/404/5xx UX; one canonical print path | None (live) | 🟡 **PAUSED — FU.7.1 attempt cancelled (PR #87); FU.7.2-FU.7.5 fixes valid but deferred behind M2 per 2026-05-26 PM decision; M2+M3 now shipped, ready to resume** |
| **M4** | Templates read | TenantAdmin sees current template config (read-only) | None (live — backend `GET /pdf-templates/:docType/current` shipped in C.1.3) | 🔲 Ready to start (gated on M0.9 type promotion OR inline-types path) |
| **M5** | Template Editor (C.2 FE) | TenantAdmin edits + previews + publishes templates | **C.2.1 backend writes — NOT shipped** | 🔲 Blocked on backend C.2.1 |
| **M6** | Immutability surfacing | Issued docs show frozen-template badge; reprint stable | C.2.5 backend — NOT shipped | 🔲 Blocked on backend C.2.5 |
| **M7** | Report Card PDF | Academics MFE shows Download on result-card detail | C.3.2 backend — NOT shipped | 🔲 Blocked on backend C.3.2 |
| **M8** | Batch generation UI | Bulk-select → progress modal → zip | C.4 backend — NOT shipped | 🔲 Blocked on backend C.4 |
| **M9** | Admit Card UI | BLE/SEE bulk admit-card generation | D.4 + D.5 + C.5 backend — NOT shipped | 🔲 Blocked on backend C.5 (+ D.4/D.5) |
| **M10** | Operator UAT + docs | Pilot sign-off | All prior | 🔲 Final sprint |

Each sprint demos on a Vercel preview against the live prod backend (dev-pabson-primary tenant). Hand-tests are **sprint-level DoD gates**, not tickets.

### How this plan maps to the master EPIC-C roadmap

| This plan | Master plan section ([`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md)) | Backend status |
|---|---|---|
| Slice 1 + Slice 2 (M0.1, M0.5, M0.7, M1.*) | C.1.6 frontend ticket — "retire jspdf" | ✅ closed via this work |
| **M1.5-FU (next)** | EPIC-C C.1 frontend closeout (receipt page belongs in Finance MFE; admin-only in current scope) | ✅ C.1.5 + C.1.6 backend live |
| M2 + M3 | EPIC-C C.2 prep (branding) | ✅ C.0 + C.0-followup backend live |
| M4 | EPIC-C C.2 prep (templates read) | ✅ C.1.3 backend live |
| M5 | **EPIC-C C.2 Template Editor UI** | 🔲 C.2.1 backend NOT shipped (separately tracked) |
| M6 | EPIC-C C.2.5 (immutability surfacing) | 🔲 C.2.5 backend NOT shipped |
| M7 | EPIC-C C.3 (Report Card) | 🔲 C.3.2 backend NOT shipped (gated on A.4 ✅) |
| M8 | EPIC-C C.4 (batch Lambda) | 🔲 C.4 backend NOT shipped |
| M9 | EPIC-C C.5 (admit card) | 🔲 D.4/D.5 + C.5 NOT shipped |

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

**M1 — SHIPPED 2026-05-26 (closed across 18 PRs).** See §0.2-shipped for the full log.

---

## 3.5 Sprint M1.5-FU — Receipt page → Finance MFE + 404 root-cause fix

> **Status:** 🔴 NEXT — blocks all receipt-PDF testing in prod.
>
> **Surfaced by:** 2026-05-26 live testing on `edforge.app/finance/payments` after Slice 2 shipped. The user clicked View Receipt on a real payment row, hit a 404, and triggered the architectural review that produced this sprint.

**Goal:** Close the receipt-PDF flow end-to-end on dev-pabson-primary. The Invoice flow (M1.5 + M1.6) is fully working in prod; the Receipt flow has a P0 backend-key-construction bug that the shell-owned-page architecture caused. Fix the architecture and the bug closes with it.

**Demo (sprint DoD):**
1. On `edforge.app/finance/payments` (admin signed in to dev-pabson-primary), click View Receipt on any completed payment row → **in-MFE smooth nav** (no full reload; URL becomes `/finance/payments/{id}/receipt`)
2. Receipt page loads with the real receipt data (no more 404)
3. Click Download PDF → real receipt PDF downloads with PABSON branding
4. Per-row Download button (new) on the Payments list → same PDF in one click, no navigation
5. From the receipt page, "Return to Invoices" / `onBack` routes to `/finance/payments` (NOT `/parent-portal/fees`)
6. `pdf_download_started`/`succeeded` events still fire (M1.10 telemetry intact)

### Why this sprint exists (the four bugs it closes)

Per §0.3 Known issues #14, #15, #16, #17:

| # | Symptom | Root cause |
|---|---|---|
| 14 | `GET /finance/payments/:id/receipt` returns 404 for every payment | Backend requires `?schoolId=`; frontend doesn't pass it; DDB key becomes `PAYMENT#undefined#<id>` |
| 15 | Receipt page lives in Shell despite being finance content | Original design assumed parent/student access — now out of scope |
| 16 | Payments list has no per-row Download (Invoices does) | Missed scope in M1 — symmetric to M1.6 |
| 17 | "Return to Invoices" routes to `/parent-portal/fees` | Hardcoded for the original parent flow |

All four are symptoms of the same architectural mismatch. Fix the architecture (move receipt to Finance MFE) and three of the four close mechanically.

### Tickets

#### **M1.5-FU.1 — Hot-patch: pass `schoolId` to `getPaymentReceipt` (unblocks testing TODAY)**
- **Files:**
  - `packages/finance-services/src/services/payments.service.ts:79` — change signature `getPaymentReceipt(paymentId, schoolId)` + `params: { schoolId }`
  - `packages/finance-services/src/hooks/usePayments.ts:210` — `usePaymentReceipt(paymentId, schoolId)` propagates it; gated on `!!schoolId && !!paymentId`
  - `apps/shell/src/pages/payments/receipt.tsx` — read `activeSchoolId` from `useAppStore()` (or via the shell-context), pass to the hook; bail to a clear "no active school" UI if absent (rare cold-mount path)
- **Why first:** Unblocks the user's testing immediately. Receipt page works in its current shell location. Subsequent tickets in this sprint move it to Finance MFE without re-breaking anything.
- **Validation:**
  - Vitest: `getPaymentReceipt('p', 's')` calls `apiGet('/finance/payments/p/receipt', { schoolId: 's' })`
  - Hand-test on Vercel preview: receipt page loads on real payment from dev-pabson-primary
- **AC:** Receipt JSON fetch returns 200 in the live testing scenario from screenshot 3 of the 2026-05-26 report.
- **Deps:** None (backend already requires the param; just plumb it).
- **Atomic:** Yes.

#### **M1.5-FU.2 — Move the receipt page into Finance MFE**
- **Files:**
  - **NEW** `apps/finance/src/routes/billing/payments/$paymentId/receipt.tsx` — receipt route component. Reads `useParams({strict: false}).paymentId` + `useAppStore((s) => s.activeSchoolId)`. Renders `PaymentReceipt` component (kept in shell-components OR moved here too — decide in §M1.5-FU.5).
  - `apps/finance/src/router.tsx` — register new route at `path: '/payments/$paymentId/receipt'` under the protected/billing parent; resolves through `basepath: '/finance'` to `/finance/payments/$paymentId/receipt`.
  - **DELETE** `apps/shell/src/pages/payments/receipt.tsx`
  - `apps/shell/src/router.tsx:826-836` — drop the `/payments/$paymentId/receipt` route registration. After deletion, anyone navigating to the bare shell path hits `MfeNotFoundBoundary` (M0.5) which logs a warn + offers Return to Home — perfect for catching stragglers.
  - `apps/shell/src/hooks/usePayments.ts` — drop the `usePaymentReceipt` re-export if it had no other consumer; keep the underlying hook in `@edforge/finance-services` (still used by the Finance receipt page).
- **Validation:**
  - Vitest: render the new route component with mocked store + hook → asserts receipt fetches with correct `(paymentId, schoolId)`
  - Hand-test: click View Receipt eye-icon on Payments list → URL becomes `/finance/payments/<id>/receipt`; page renders; no full-page reload (single HMR-style transition in dev; single MFE-router push in prod)
- **AC:** Receipt page lives in Finance MFE at `/finance/payments/$paymentId/receipt`. Direct deep-link to that URL works (e.g., from an email). Shell route is gone.
- **Deps:** M1.5-FU.1 (so the receipt fetch works while the page is still in Shell — no need to bisect "did the move break it or did the 404 break it?").

#### **M1.5-FU.3 — Revert the eye-icon nav from cross-MFE shim to in-MFE navigate**
- **Files:**
  - `apps/finance/src/routes/billing/payments/index.tsx:522` — change `onClick={() => viewDocument(receiptHref(payment.id))}` → `onClick={() => navigate({ to: '/payments/$paymentId/receipt', params: { paymentId: payment.id } })}` (or however TanStack types the params syntax in this codebase). Resolves through finance's basepath to the new in-MFE route.
- **Validation:**
  - Vitest: click eye-icon → `navigate` called with the right route + params
  - Hand-test: same as M1.5-FU.2 demo step 1
- **AC:** No more `window.location.href`. No more full-page reload. The nav is the same shape as the Invoice list's View button (which uses in-MFE navigate today).
- **Deps:** M1.5-FU.2.

#### **M1.5-FU.4 — Per-row Download PDF button on Payments list (closes Issue #16)**
- **Files:**
  - `apps/finance/src/routes/billing/payments/index.tsx` — add `ReceiptDownloadIconButton` component (per-row hook instance pattern from M1.6); slot into the actions column next to the View eye-icon. Renders only when `payment.receiptNumber` is set (i.e., status is completed). i18n key reuses `payments.actions.downloadPdf` (same as M1.5/M1.6 — already in en + ne).
  - **NEW** `apps/finance/src/__tests__/payments-list-row-download.test.tsx` — mirror of M1.6's `invoice-list-row-download.test.tsx`: 3-row table, per-row isolation invariant (click row 2 → row 2 spinner; rows 1+3 stay enabled).
- **Validation:** Vitest 3 specs + hand-test.
- **AC:** Symmetry with Invoice list. `useDownloadReceiptPdf` already exists (shipped C.1.6 + M1.10 + M1.11 — telemetry + error toast auto-wired). Zero new hooks, zero new services.
- **Deps:** None (could land in parallel with M1.5-FU.2/3, but cleaner to land after the move so the call site is colocated with the new receipt page).

#### **M1.5-FU.5 — Fix "Return to Invoices" routing + relocate PaymentReceipt if needed**
- **Files:**
  - `apps/finance/src/routes/billing/payments/$paymentId/receipt.tsx` — the new receipt page. `onBack` + the error-state "Return to Invoices" button → `navigate({ to: '/payments' })` (Finance MFE's payments list; not parent portal).
  - **Decision point during this ticket:** `PaymentReceipt` component currently lives at `apps/shell/src/components/payments/PaymentReceipt.tsx`. Two options:
    - **5a:** Leave it in shell, import via `@edforge/shell-components` (add the export there). Pro: no churn. Con: shell-components becomes a transitive dep of finance MFE.
    - **5b:** Move `PaymentReceipt.tsx` into Finance MFE alongside the new receipt page. Pro: full colocation. Con: ~250 LOC move, but mechanical.
    - **Recommendation:** 5b. Receipt is finance content; the component renders finance data; the only consumer is the receipt page. Symmetry with `apps/finance/src/components/billing/*` which already houses finance-only components.
- **Validation:** Click Return → URL becomes `/finance/payments`. Hand-test as both completed-load and error-load paths.
- **AC:** No more `/parent-portal/fees` references in the receipt flow. Issue #17 closed.
- **Deps:** M1.5-FU.2.

#### **M1.5-FU.6 — Cleanup: drop the M1.1 cross-MFE-nav shim helpers + relax the M0.7 lint rule**
- **Files:**
  - `packages/finance-services/src/utils/navigation.ts` — drop `viewDocument` + `receiptHref`. The Invoice flow never used them (M1.5/M1.6 use `navigate({to: ...})` in-MFE directly). Receipt flow used them in M1.2 + the prior eye-icon fix; both call sites flip to in-MFE navigate in M1.5-FU.3.
  - `packages/finance-services/src/index.ts` — remove the re-exports.
  - `apps/finance/src/__tests__/navigation-helpers.test.ts` — delete (covered the now-removed helpers).
  - `packages/config/eslint-mfe-nav.js` — remove the `/payments/<id>/receipt` selector(s). Keep the `/settings/...` + `/home/...` selectors (those are still shell-owned and the rule has a real future job there). Add a docstring note that the receipt-specific rules were removed when receipt moved in-MFE.
- **Validation:** Vitest still green; `pnpm typecheck` clean; ESLint rule still fires on `/settings/...` from MFE code (regression-fixture test in the same file).
- **AC:** ~200 LOC of dead code removed. The plan's §0.5 Option A shim is fully retired.
- **Deps:** M1.5-FU.2 + M1.5-FU.3 (all consumers gone).
- **Atomic:** Yes (single PR; pure deletion + a small lint config tweak).

### Sprint M1.5-FU DoD
1. All 6 demo steps at the top of this section pass on Vercel preview against dev-pabson-primary
2. `apps/shell/src/pages/payments/` no longer exists (or contains only the `callback.tsx` for the eSewa/Khalti redirect, untouched by this sprint)
3. `grep -rn "viewDocument\|receiptHref" apps/ packages/` returns empty
4. `apps/finance` Vitest count is at the M1 baseline + ~5 new specs (M1.5-FU.2 + M1.5-FU.4 specs); typecheck clean
5. ESLint rule still catches `/settings/...` from MFE code (regression-protected via the rule's own fixture)

### What this sprint does NOT touch (deferred)
- **M0.4 + M0.9 + M0.10** (shared-types pin sweep, type promotion, ABAC enums) — these block M2 (branding), not M1.5-FU. M1.5-FU only touches existing types + already-exported hooks.
- **Parent / Student portal receipt access** — out of scope per the 2026-05-26 product decision. If reintroduced in V1.5+, parent portal mounts its own receipt view inside its own MFE (NOT shares Finance's). The Finance receipt page in this sprint is admin-only by route (Finance MFE is gated on TenantAdmin / Principal / Accountant role anyway).
- **Backend changes** — none. The 404 is purely a frontend plumbing miss; backend contract is correct as documented in payments.controller.ts:179-197.

---

## 3.6 Sprint M1.5-FU.7 — Receipt-flow UX hardening (post-prod-test cleanup)

> **Status: 🟡 PAUSED — deferred behind Sprint M2 per 2026-05-26 PM decision.**
>
> **What happened (2026-05-26 PM):** A single-PR execution of FU.7.1–FU.7.5 was opened as
> [PR #87 on edforge-saas-frontend](https://github.com/shoaibrain/edforge-saas-frontend/pull/87)
> and cancelled by the operator. The FU.7.1 Breadcrumbs fix widened the span-vs-Link
> predicate to gate on `!matchingRoute` — that proved too broad. TanStack Router's
> `useMatches()` pathnames don't always match the URL-segment-shaped paths that
> [Breadcrumbs.tsx](apps/shell/src/components/layout/Breadcrumbs.tsx) constructs
> (route-id form, layout routes, trailing-slash variance), so VALID intermediate
> Links across Finance / Settings / Academics regressed into non-clickable spans
> in the Vercel preview. Memory: [[feedback-breadcrumb-predicate-too-broad]].
>
> **Decision:** Issue #18 (the breadcrumb bug) is now formally **DEFERRED** —
> needs a narrower predicate scoped to *dynamic* segments only, or driven from
> route metadata, with verification across Finance / Settings / Academics /
> list-detail flows on a Vercel preview BEFORE merge. The other four fixes
> (FU.7.2 status gate, FU.7.3 error differentiation, FU.7.4 Print button
> removal, FU.7.5 tooltip investigation) are independently valid and
> regression-free against M1.5-FU, but the operator chose to pivot to M2
> rather than re-open them as a smaller follow-up PR right now.
>
> **When to resume:** After M2 (Branding read) ships, OR if Issue #19's
> stale-receiptNumber 400 errors become a pilot-blocker before then. FU.7.1
> needs its own design pass before next attempt — don't re-execute on muscle
> memory.
>
> **Originally surfaced by:** Same 2026-05-26 testing session that confirmed
> M1.5-FU's primary outcomes (receipt page in Finance MFE, in-MFE nav,
> server-PDF download). Five secondary defects didn't surface until the
> operator clicked through edge cases — non-completed payments, breadcrumb
> back-nav, the Print button, and a stray tooltip.
>
> **Why a separate sprint, not folded into M1.5-FU:** M1.5-FU shipped end-of-day 2026-05-26 and closed the four issues it was scoped for (#14-#17). These five (#18-#22) are independent in scope: a generic breadcrumb bug + a status-gate gap + an error-class differentiation + a print-method choice + a UI artifact. Folding would have stalled M1.5-FU's merge while we investigate #22.

**Goal:** Make the receipt flow consistent + obvious for every payment state, not only the happy path. After this sprint, every Payments-list row whose receipt is reachable shows the View + Download buttons; every row whose receipt is not reachable (refunded/voided/failed/pending) hides them; breadcrumbs stop offering navigation to non-existent routes; error states tell the operator WHY they can't see a receipt.

**Demo (sprint DoD):**
1. On `edforge.app/finance/payments` (admin), the View Receipt eye-icon + Download PDF buttons render ONLY on rows where `status === 'completed' && receiptNumber`. Refunded/voided/failed/pending rows show neither button (or show them grayed-out with a tooltip explaining why — pick one in §FU.7.2).
2. On the receipt page, the breadcrumb trail does NOT include a clickable "Details" link to a non-existent intermediate route. The dynamic `<paymentId>` crumb either renders as plain text (non-navigable) or is collapsed entirely.
3. Trying to fetch a receipt for a non-completed payment (deep-link only, since the buttons are gated) shows a differentiated error: "This payment is not completed — receipts are only available for completed payments" — distinct from "Receipt not found" (404) and "Couldn't load receipt — please retry" (5xx).
4. The Print Receipt button is either gone OR uses the server-rendered PDF (operator decision in §FU.7.4).
5. No stray "Download PDF" tooltip leaks on the Payments list.

### Tickets

#### **M1.5-FU.7.1 — Breadcrumbs: skip Link rendering for dynamic segments without a matching route (closes Issue #18) — 🟡 DEFERRED 2026-05-26 PM after PR #87 cancelled**

> **Post-mortem note (2026-05-26 PM):** First attempt (PR #87) widened the
> span-vs-Link predicate to gate on `!matchingRoute`. Vercel preview showed
> previously-clickable intermediate Links (Finance / Settings / Academics /
> Payments) regressing to non-clickable spans because TanStack Router's
> `useMatches()` pathnames don't always match the URL-segment-shaped paths
> the Breadcrumbs component constructs. Operator cancelled the PR.
>
> **Next-attempt design requirements** (before re-opening):
> 1. **Narrow the gate to dynamic segments only.** Use `isDynamic && !matchingRoute` instead of `!matchingRoute`. Static intermediate segments like `payments` should keep their existing Link behavior even when the pathname-equality check misses.
> 2. **OR drive the gate from route metadata** rather than from `matches.find`. TanStack Router's route registry knows which dynamic segments have own-page routes; expose that on the route definitions and read it here.
> 3. **Manual verification matrix** (Vercel preview, dev-pabson-primary):
>    - `/finance` — clickable: yes
>    - `/finance/payments` — clickable on the `Payments` crumb: yes
>    - `/settings/branding` — clickable on the `Settings` crumb: yes
>    - `/academics/students/<id>/grades` — `Students` clickable: yes; `<id>` clickable: NO
>    - `/finance/payments/<id>/receipt` — `Payments` clickable: yes; `<id>` clickable: NO; `Receipt` current page: span
>    - Click each clickable crumb — confirm no `MfeNotFoundBoundary` fires
> 4. **Memory pin:** [[feedback-breadcrumb-predicate-too-broad]] — read first.
>
> The ticket body below remains as the original spec for reference; do NOT
> implement it verbatim. Use the design requirements above.


- **Files:**
  - [apps/shell/src/components/layout/Breadcrumbs.tsx:242-266](apps/shell/src/components/layout/Breadcrumbs.tsx#L242-L266) — extend the BreadcrumbItem with an `isNavigable` boolean computed as `!!matchingRoute || (!isDynamic && !isNonNavigable)`. The render branch at line 312 widens its condition from `isCurrentPage || isNonNavigable` to `isCurrentPage || isNonNavigable || !isNavigable`. Dynamic segments without a matching route still render their label (so the trail remains visually complete) but as a `<span>`, not a `<Link>`.
  - **NEW** `apps/shell/src/components/layout/__tests__/Breadcrumbs.test.tsx` (or add to existing test file if present) — vitest fixture: render with matches simulating `/finance/payments/<UUID>/receipt`. Assert: the `<UUID>` crumb is a `<span>` not an `<a>`; the trail is `[Home → Finance → Payments → <Details span> → Receipt]`.
- **Why this fix, not "auto-redirect intermediate to /payments"**: the breadcrumb is wayfinding, not routing. The fix is to stop pretending the intermediate has its own page; it doesn't, and never will (PaymentDetails-as-a-page isn't on the roadmap). Other dynamic-mid-path routes (e.g., `/academics/students/<id>/grades`) get the same fix for free.
- **Why not collapse the dynamic segment entirely**: keeps the trail visually consistent (Home → Finance → Payments → Details → Receipt vs. Home → Finance → Payments → Receipt — the latter looks like a sibling route). Italic-styled non-navigable span preserves the depth cue.
- **Validation:** vitest + hand-test on `edforge.app/finance/payments/<UUID>/receipt`.
- **AC:** Clicking the "Details" segment does nothing (no Link). The crumb remains visible in italic. No 404 boundary triggers from breadcrumb clicks.
- **Deps:** None.
- **Atomic:** Yes (one component file + one test file).

#### **M1.5-FU.7.2 — Gate View Receipt + Download buttons on `status === 'completed'` (closes Issue #19)**
- **Files:**
  - [apps/finance/src/routes/billing/payments/index.tsx](apps/finance/src/routes/billing/payments/index.tsx) — both render gates change from `{payment.receiptNumber && (...)}` to `{payment.status === 'completed' && payment.receiptNumber && (...)}`. Applies to: (a) the eye-icon View Receipt button (M1.5-FU.3 location), (b) the `ReceiptDownloadIconButton` (M1.5-FU.4 location).
  - **NEW** `apps/finance/src/__tests__/payments-list-receipt-gate.test.tsx` — vitest fixture: 4 rows with statuses `completed/refunded/voided/failed`, all with `receiptNumber` set. Assert: only the completed row renders View + Download buttons; the other 3 rows render neither.
- **Design decision (resolve during ticket):** show-vs-hide vs. grayed-out-with-tooltip. **Recommend: hide.** A grayed-out button invites tooltip-debugging clicks ("why is this disabled?"); for refunded/voided payments there's no operator-actionable path anyway. Hide is simpler and matches every other CRUD-affordance gate in the app.
- **Validation:** vitest + hand-test on a payment that was completed then refunded (if dev-pabson-primary has one; otherwise synthesize one or test on a failed-status payment).
- **AC:** Operator never sees a button that would 400 when clicked. User-reported "Its not consistently working for all the payments" resolves on the spot.
- **Deps:** None.
- **Atomic:** Yes (one component + one test).

#### **M1.5-FU.7.3 — Differentiated receipt page error messages (closes Issue #20)**
- **Files:**
  - [apps/finance/src/routes/billing/payments/receipt.tsx](apps/finance/src/routes/billing/payments/receipt.tsx) — the error-branch (`if (error || !receipt)` at line 49) reads `error?.response?.status` (axios-shape) or equivalent. Branches on:
    - `400` → `t('error.receiptNotAvailable')` ("This payment is not completed — receipts are only available for completed payments.")
    - `404` → `t('error.receiptNotFound')` ("We couldn't find a receipt for this payment. It may have been deleted or never issued.")
    - `403` → `t('error.receiptForbidden')` ("You don't have permission to view this receipt.")
    - default → existing `t('error.failedToLoad')`
  - `packages/i18n/src/locales/en/payments.json` — add the 3 new keys under `error.*`.
  - `packages/i18n/src/locales/ne/payments.json` — same keys, Devanagari translation. (Per M0.8 i18n parity check — both files must keep matching keys.)
  - Test: extend `apps/finance/src/__tests__/...` (or create a new spec) — render the page with each error shape, assert the right message renders.
- **Why server-error-code, not custom error-class shape**: the backend already returns descriptive `errorCode` strings on 400 (`PAYMENT_NOT_COMPLETED` etc.) per the EdForge error contract; we could branch on `errorCode` too. Status is the simpler invariant and what the user actually sees; `errorCode` mapping is M0.8-territory and would over-scope this ticket.
- **Validation:** vitest 4 specs (one per branch) + hand-test on a 400 (deep-link to a refunded payment's receipt).
- **AC:** Three distinct error messages render based on status. Operators can self-diagnose.
- **Deps:** None.
- **Atomic:** Yes (one component + one test + two i18n files).

#### **M1.5-FU.7.4 — Drop or fix the Print Receipt button (closes Issue #21)**
- **Recommended path: drop the button.**
  - **Files:**
    - [apps/finance/src/components/billing/PaymentReceipt.tsx](apps/finance/src/components/billing/PaymentReceipt.tsx) — remove the Print Receipt button (any `window.print()` handler + its surrounding markup).
    - `packages/i18n/src/locales/en/payments.json` + `packages/i18n/src/locales/ne/payments.json` — remove the `actions.print` (or equivalent) i18n key. M0.8 parity check stays clean.
    - Update PaymentReceipt's component-level test (if any) to drop Print-button assertions.
  - **Why drop, not fix**: the Download PDF button next to it already produces a print-ready PDF via `useDownloadReceiptPdf` — the operator can print from the OS print dialog (Cmd-P) on the opened PDF. Keeping both is offering two paths to the same outcome with diverging quality (HTML-print is unbranded chrome-included; PDF-print is clean PABSON-branded). One canonical UX is better.
  - **What changes for users**: "Print" → "Download → Open PDF → Cmd-P." One extra step in exchange for consistent output.
- **Alternative path (if operator pushback): wire Print to PDF.** Print button calls `useDownloadReceiptPdf().mutateAsync(...)`, opens the resulting Blob in a new tab (`URL.createObjectURL(blob)`), and triggers `window.print()` on that tab. Adds non-trivial cross-tab state plumbing. Defer unless operators reject Path A.
- **Validation:** vitest + hand-test (Download still works; Print button no longer renders).
- **AC:** Only one print path exists, and it produces the polished server PDF.
- **Deps:** None.
- **Atomic:** Yes.

#### **M1.5-FU.7.5 — Investigate + fix stray "Download PDF" tooltip on Payments list (closes Issue #22)**
- **Investigation first, fix-shape unknown until reproduced.**
  - **Repro:** load `edforge.app/finance/payments` on dev-pabson-primary in Chrome; inspect the top-left area where the user's screenshot shows the leak.
  - **Hypothesis 1:** A Radix/shadcn Tooltip provider mounting a portal at the document root + the trigger button unmounting before the tooltip closes → orphan tooltip stays anchored at last known position. Fix: ensure each Tooltip is scoped to its row's lifetime (TooltipProvider per row OR `useEffect` cleanup that dispatches `pointerleave` on unmount).
  - **Hypothesis 2:** The per-row `ReceiptDownloadIconButton` (M1.5-FU.4) uses a `<button title={...}>` HTML title attribute that the browser positions at the page top-left when the row scrolls out. Fix: replace `title=` with a Radix Tooltip OR `aria-label` only (no visual tooltip).
  - **Hypothesis 3:** Vercel preview build artifact, not a prod bug. (Confirm by retesting on `edforge.app` directly.)
- **Files:** TBD pending repro.
- **Validation:** repro screenshot before/after; vitest if a code fix lands.
- **AC:** No stray tooltip artifact visible on the Payments list at any scroll position.
- **Deps:** Investigation may downgrade this to "no fix needed" if Hypothesis 3 holds — in which case the ticket closes with a comment on PR rather than a code change.
- **Atomic:** Yes (single small fix or single comment-and-close).

### Sprint M1.5-FU.7 DoD
1. All 5 demo steps at the top of this section pass on Vercel preview against dev-pabson-primary
2. The 2026-05-26 PM testing-screenshot defects (#18-#22) are all resolved (or downgraded with a documented "not a bug" closure in PR)
3. `apps/finance` Vitest count is at the M1.5-FU baseline + ~6 new specs (FU.7.1 + FU.7.2 + FU.7.3 + FU.7.4 specs)
4. `pnpm typecheck` clean; ESLint rule still firing on `/settings/...` from MFE code (no regression)
5. i18n parity holds: en + ne payments.json have matching keys after FU.7.3 + FU.7.4

### What this sprint does NOT touch (deferred)
- **M0.4 + M0.9 + M0.10** — still M2 prereqs.
- **PaymentDetails as its own page**: not on the roadmap. The breadcrumb fix in FU.7.1 is the correct closure of the intermediate-route question. If a PaymentDetails page is ever added (V1.5+?), the breadcrumb auto-becomes navigable for that segment without any further change — `matchingRoute` would be present at that point.
- **Backend changes**: none. All 5 issues are frontend-side.
- **The `payment.status` enum normalization**: code branches on `payment.status === 'completed'` (string literal) assuming the backend's payment-status enum matches. Verify against `@aibrains/shared-types` before the FU.7.2 PR — if there's an exported `PaymentStatus.Completed` constant, use it instead of the literal.

---

## 4. Sprint M2 — Branding Read Integration

> **Status: ✅ Shipped to prod 2026-05-26 via PR #88** (`cae00fd` + review-fix `25fad59`). Live on `edforge.app/settings/branding`. M0.9 type promotion + M0.10 ABAC enum extension were done inline (types in `@edforge/identity-services/src/types.ts`; `branding` resource + `view`/`configure` actions added to `packages/abac/src/permissions.ts`). M2.1 created NEW workspace package `@edforge/identity-services` (not MF-singleton — stateless). M2.2-M2.5 all closed within the same PR. Below tickets retained for historical scope traceability.



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

> **Status: ✅ Shipped to prod across 2 phases + 2 server hotfixes (2026-05-26 → 2026-05-27).**
>
> **M3 phase 1 (text + colors, PR #89 `88c3db4` + review-fix `1c71898`):** `BrandingForm` + `BrandingColorPicker` shipped. Diff-based PATCH, dirty guard, edit-toggle on `usePermission('configure', 'branding')`. RHF imports consolidated through `@edforge/forms` re-exports. Fail-fast on undefined `schoolId`. 81/81 specs.
>
> **M3 phase 2 (asset uploads, FE PR #90 `384daef` + `0f35028`):** `BrandingFileField` × 3 + `usePresignedAssetUpload` hook shipped. Per-asset MIME allowlist + size caps (logo 2MB / signature 1MB / letterhead 5MB). Raw `fetch` for S3 PUT (avoids axios leaking Authorization to S3 CDN). ~1.5K LOC + 4 spec suites.
>
> **Server hotfixes unlocking M3 phase 2 in prod (both deployed 2026-05-27):**
> - **PR #209** — `S3Client { requestChecksumCalculation: 'WHEN_REQUIRED' }` in [s3-presigner.service.ts:87](server/application/microservices/identity/src/common/services/s3-presigner.service.ts#L87) opts out of AWS SDK v3.730+ default that embeds `x-amz-checksum-crc32=AAAAAA==` into presigned PUT URLs (S3 rejects every non-empty browser upload with signature/CRC32 mismatch). +2 regression-guard specs.
> - **PR #210** — CDK `CorsRule` on PdfAssetsBucket in [analytics-stack.ts](server/lib/analytics/analytics-stack.ts): PUT/GET/HEAD on `edforge.app` + `www.edforge.app` + `edforge-saas-frontend-*.vercel.app`; `ExposedHeaders: ['ETag', 'x-amz-version-id']`; `maxAge: 3000`. CDK property name is `maxAge` (not `maxAgeSeconds`). Regression spec on `analytics-stack.spec.ts`. Deployed via `./scripts/deploy-analytics.sh analytics-stack prod` (log `analytics-prod-analytics-stack-20260527-011646-1071a3c.log`).
>
> **Live e2e proven 2026-05-27:** all three asset slots upload successfully; saved branding propagates to next invoice/receipt PDF download (logo + signature visible; **letterhead PDF persists in S3 + signed URL retrievable, but does NOT appear in the rendered PDF — pre-existing pdf-renderer feature gap per §0.3 Issue #24 and §0.6.B.1**).
>
> **Two follow-ups deferred from this sprint:** Issue #25 (eager preview UX) → §0.6.A.2; Issue #24 (letterhead in PDF render) → §0.6.B.1.



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

# Pre-C.2 UI Research Memo

> **Drafted:** 2026-05-25
> **Scope:** Answers the 5 open UI questions that gated Sprint C.2 kickoff (the Shell-side PDF template editor). Output of the 5-stream parallel research spike on `docs/c-2-ui-research`.
> **Companion:** [`c-epic-pdf-generation-design.md`](./c-epic-pdf-generation-design.md) §8 (frontend editor design)
> **Status:** ✅ All 5 questions answered. **One blocker surfaced** (browser font registration); a new prerequisite ticket C.2.0 captures the fix. C.1.1 (Invoice render) is unaffected and can proceed in parallel.

---

## TL;DR

| # | Question | Verdict |
|---|---|---|
| Q1 | Will the Shell's auth flow yield the same JWT that the C.0.7 curl smoke used? | ✅ Yes. `@edforge/api-client` auto-attaches `Authorization: Bearer …` + `X-Tenant-Id`. Zero integration friction. |
| Q2 | Can `@react-pdf/renderer@3.4.5` render PDFs in the browser? | ⚠️ Yes, with one fix: `Font.register()` needs absolute URLs in the browser; our `registerFonts()` uses Node-only `path.join`. Refactor in C.2.0. |
| Q3 | Should the editor live in Shell or as a remote MFE? | ✅ **Shell page** at `apps/shell/src/pages/settings/pdf-templates/[docType].tsx`. All other settings already live in Shell. |
| Q4 | Does the form library convention match design assumptions? | ✅ Yes — RHF v7.54.2 + Zod v3.24.4 + zodResolver. 8 primitives exist; ColorField + FileField are new. |
| Q5 | What's the scope of the AdminWeb SchoolBrandingPage migration? | ✅ Simpler than expected — file doesn't exist yet. Greenfield read-only view, ~2-3 days post-C.2. Frontend-only, no controlplane redeploy. |

---

## Q1: Shell auth flow ✅

The Shell's auth state is managed by `useAuthStore` (Zustand at `apps/shell/src/stores/auth.store.ts:51`) subscribing to **Amplify v6 Hub events** (`signedIn`, `signedOut`, `tokenRefresh_failure`).

The decisive piece for C.2 is **`@edforge/api-client`**:

- The package exports typed `apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete` helpers built on a singleton axios instance.
- A **request interceptor** (`packages/api-client/src/index.ts:85-116`) runs on every call:
  1. Calls Amplify's `fetchAuthSession()` via `getIdToken()` to fetch the current JWT.
  2. Sets `Authorization: Bearer <token>` header.
  3. Parses `custom:tenantId` from the JWT payload and sets `X-Tenant-Id` header.
- Shell adds a thin wrapper at `apps/shell/src/lib/api.ts` with **response interceptors** for 401/403 redirect-to-login UX.

So every C.0.7 endpoint call from C.2 is one line:

```typescript
import { apiGet, apiPatch } from '@edforge/api-client'

const branding = await apiGet<BrandingResponse>(`/schools/${schoolId}/branding`)
const updated  = await apiPatch<BrandingResponse>(`/schools/${schoolId}/branding`, patch)
```

Identical shape to the curl smoke. JWT shape exposes `user.tenantId` + `user.globalRole` (`TenantAdmin` | `StandardUser`) + `user.assignments` via `mapCognitoToUserIdentity()` (`packages/auth/src/user-mapper.ts:50-64`).

**Token refresh** is silent: Amplify v6 refreshes before expiry; only **failure** triggers a sign-out via the Hub listener. No app-level retry logic needed.

**No action required for C.2.** The existing `tenant.service.ts:174` pattern (`getSchool`) is the model to copy.

---

## Q2: `@react-pdf/renderer` in browser ⚠️ (1 blocker)

The v3.4.5 we pinned in C.0.3 ships with **first-class browser support**:

| Capability | Status |
|---|---|
| `<PDFViewer>` (iframe-embedded preview with native toolbar) | ✅ Exported |
| `<BlobProvider>` (callback-style blob generation — perfect for debounced live preview) | ✅ Exported |
| `usePDF()` hook (programmatic instance management) | ✅ Exported |
| `Document`, `Page`, `View`, `Text` primitives | ✅ Exported (same as server) |
| Dedicated browser bundle (`react-pdf.browser.js`, ~78KB minified) | ✅ Present |
| CJS + ESM dual format | ✅ v3.4.5 supports both — Rsbuild auto-detects via `browser` field |
| Tree-shake `renderToBuffer` etc out of the browser bundle | ✅ Built-in |

### 🛑 The one blocker

Our [`packages/pdf-renderer/src/core/fonts.ts`](../../packages/pdf-renderer/src/core/fonts.ts) uses:

```typescript
const FONT_DIR = path.join(__dirname, '../../fonts')
```

That's **Node-only**. `Font.register()` in the browser **must** receive absolute URLs (`/fonts/NotoSans-Regular.woff` or `https://…`).

### Fix (C.2.0 — new prerequisite ticket)

1. Refactor `registerFonts(baseUrl?: string)`:
   - Node default: existing behavior (relative disk path).
   - Browser caller: pass `baseUrl: '/fonts'`; the function constructs `/fonts/<name>.woff` for each registration.
2. Copy the .woff files from `packages/pdf-renderer/fonts/` into `apps/shell/public/fonts/` as a Shell build step.
3. Publish `@aibrains/pdf-renderer@0.5.0` (minor bump — backwards-compatible: existing server callers ignore the new optional param).
4. Bump pin in `server/application/package.json` + `server/package.json` for server consumers; also add Shell pin (per-sprint shared-types checklist applies).

### Bundle / lazy-load strategy

`<PDFViewer>` pulls in the browser bundle (~78KB minified). C.2 should `React.lazy()` the LivePreview panel so it's not in the initial Shell payload. The editor page itself can be eager — just the viewer panel is lazy.

### Sources

- [`react-pdf` Compatibility Guide](https://react-pdf.org/compatibility)
- [GitHub Issue #2223 — Font.register in Next.js](https://github.com/diegomura/react-pdf/issues/2223)
- [GitHub Issue #2907 — CJS support](https://github.com/diegomura/react-pdf/issues/2907)

---

## Q3: MF2 singleton + editor placement ✅

### Singleton config audit

[`edforge-saas-frontend/packages/config/src/mf-shared.ts`](../../edforge-saas-frontend/packages/config/src/mf-shared.ts) is the canonical shared-deps file. **`@aibrains/pdf-renderer` is NOT currently listed.**

This matters because `packages/pdf-renderer/src/descriptors/registry.ts` uses a **module-level `Map`** for descriptor storage. Without `singleton: true, eager: true`, each MFE bundles its own copy and cross-MFE registry contents never sync — exactly the trap that the [`edforge_mf_shared_singleton_rule`](../../.claude/projects/-Users-shoaibrain-edforge/memory/edforge_mf_shared_singleton_rule.md) memory captured during Sprint A.12.

**Action (folded into C.2.0):** add `@aibrains/pdf-renderer` to mf-shared with `singleton: true, eager: true` BEFORE any editor code lands.

### Editor placement decision: **Shell page**

| Option | Vote |
|---|---|
| `apps/shell/src/pages/settings/pdf-templates/[docType].tsx` | ✅ recommended |
| `apps/finance/.../templates/...` (remote MFE) | ❌ |

Reasons:

1. **All other settings already live in Shell.** `pages/settings/workspace.tsx`, `pages/settings/account.tsx`, `pages/settings/organization.tsx` are all there. Splitting PDF-template settings off into Finance would break the user mental model.
2. **PDF templates span domains.** Invoice/Receipt are finance, Report Card is academics, Admit Card is exams. Hosting in any one MFE is wrong — Shell is the cross-domain home.
3. **Routing is ready.** TanStack Router file-based config (`apps/shell/src/router.tsx`) — `settingsPdfTemplatesRoute` follows the same one-line pattern as `settingsWorkspaceRoute`.
4. **Deploy story.** Shell ships via Vercel (per CLAUDE.md). PR triggers a preview build automatically — fast feedback loop.

---

## Q4: Form library convention ✅

[`edforge-saas-frontend/packages/forms`](../../edforge-saas-frontend/packages/forms) confirms exactly the design's assumption:

- **React Hook Form v7.54.2** + **Zod v3.24.4** + `@hookform/resolvers/zod`
- Schema-driven validation via `useForm({resolver: zodResolver(schema)})`
- `FormProvider` wrap + named primitive pattern: `<TextField name="firstName" required />`
- Theme via CSS custom properties (`rgb(var(--surface-secondary))`) + Tailwind merge utilities; **no `@edforge/theme` import** (so primitives are theme-agnostic)
- Animations via Framer Motion springs for focus/error states

### Existing primitives inventory

| Primitive | Status | File |
|---|---|---|
| `TextField` | ✅ | `packages/forms/src/fields/TextField.tsx` |
| `TextareaField` | ✅ | `…/TextareaField.tsx` |
| `SelectField` | ✅ | `…/SelectField.tsx` |
| `CheckboxField` | ✅ | `…/CheckboxField.tsx` |
| `DateField` | ✅ | `…/DateField.tsx` |
| `PhoneField` | ✅ | `…/PhoneField.tsx` |
| `ToggleField` | ✅ | `…/ToggleField.tsx` |
| `RadioGroupField` | ✅ | `…/RadioGroupField.tsx` |
| **`ColorField`** | ❌ MISSING | new for C.2.2 — ~20 LOC, wraps `<input type="color">` |
| **`FileField`** | ❌ MISSING | new for C.2.2 — ~100 LOC, presigned-PUT integration |
| `MultiSelectField` | 🟡 not separately verified | check if `SelectField` has `multiple`; if not, ~50 LOC extension |

### FileField sketch (for C.2.2 planning)

The component needs to:

1. Accept file via `<input type="file">` or drag-and-drop.
2. Client-side validation: file size + MIME against the per-asset-type allowlist (already enumerated in `server/application/microservices/identity/src/branding/branding.types.ts`).
3. Call `POST /schools/:id/branding/assets/upload-url` with `{assetType, contentType, contentLength}`.
4. PUT the file to the returned presigned URL.
5. On success, store the returned `key` in the RHF field state (the form value is the S3 key string, not the file blob).
6. Show preview thumbnail + upload progress.

### Form section pattern (from `account.tsx`)

```tsx
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { TextField, SelectField } from '@edforge/forms/fields'
import { userProfileSchema } from '@/schemas/person.schema'

const methods = useForm({
  resolver: zodResolver(userProfileSchema),
  defaultValues: { ... }
})

return (
  <FormProvider {...methods}>
    <form onSubmit={methods.handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextField name="firstName" label="First Name" required />
        <TextField name="lastName" label="Last Name" required />
      </div>
    </form>
  </FormProvider>
)
```

C.2.4 (editor page) follows this exact shape; the descriptor's `configurableFields[]` enumerates which primitives to render in which order.

---

## Q5: AdminWeb SchoolBrandingPage migration ✅ — actually greenfield

The design doc (line 722) referenced an existing v3.4 ticket "C.5.1 — move SchoolBrandingPage.tsx". **The file doesn't exist.** AdminWeb's `pages/` only contains `Auth/`, `Dashboard/`, `Tenants/`.

So the post-C.2 task is **build a read-only view from scratch**, not a migration. Specifics:

- AdminWeb has no school API client today (only `/tenant-registrations` + `/tenants`)
- AdminWeb pins `@aibrains/shared-types@^0.40.0` — `SchoolBrandingDto` is already exported there; **no shared-types bump needed**
- Pattern to mirror: `client/AdminWeb/src/pages/Tenants/TenantDetail.tsx` lines 340–550 (Card-based read-only layout)
- **Frontend-only** → no controlplane-stack redeploy needed (just S3 sync + CloudFront invalidation)

### Minimum work post-C.2

1. Create `client/AdminWeb/src/pages/Schools/SchoolBrandingPage.tsx` (read-only Card view).
2. Create `client/AdminWeb/src/services/schoolService.ts` with `getSchoolBranding(schoolId): Promise<SchoolBrandingDto>` → calls `GET /schools/:id/branding`.
3. Wire route in `App.tsx`: `<Route path="/schools/:id/branding" element={<SchoolBrandingPage />} />`.
4. (Optional polish) Image preview via presigned `GET` URL through the existing identity-side `presignGet` method (currently dead code; this would be its first consumer).

**Estimate:** 2-3 days post-C.2 ship.

---

## 📐 Revised C.2 sprint plan

The 5 C.2 tickets in the design doc remain, **plus one prerequisite**:

| # | Ticket | Owner | Effort | Notes |
|---|---|---|---|---|
| **C.2.0** *(NEW)* | `@aibrains/pdf-renderer` 0.5.0: browser font registration + MF2 singleton | pdf-renderer + Shell config | ~0.5 day | Refactor `registerFonts(baseUrl?)`, copy fonts into `apps/shell/public/fonts/`, add to `mf-shared.ts` as `singleton+eager`. Publish + bump consumers. |
| C.2.1 | `pdf-templates` identity module (CRUD + lazy-default seed per design §6.3) | server | ~3 days | 8 routes per design §6.3. Mirrors lazy-seed of D.1.3 GradingPolicy. |
| C.2.2 | `ColorField` + `FileField` primitives in `@edforge/forms` | frontend | ~1 day | FileField does the presigned-PUT integration (calls C.0.7 endpoints). |
| C.2.3 | `/settings/pdf-templates` index page | Shell | ~0.5 day | Doc-type cards (Invoice + Receipt active V1; others disabled-but-visible). |
| C.2.4 | `/settings/pdf-templates/[docType]` editor page | Shell | ~2 days | Generic descriptor-driven editor + `<BlobProvider>` 300ms debounced live preview (lazy-loaded). |
| C.2.5 | Publish flow + version history UI + immutability snapshot on issue | Shell + server | ~1 day | Glues editor → CRUD endpoints; freezes `pdfTemplateRef` on issued documents. |

**Net effect:** 5 → 6 tickets, ~7–8 days of work for Sprint C.2 as a whole.

---

## 🚀 What's unblocked NOW

| Track | Status | Why |
|---|---|---|
| **C.1.1 — Invoice render endpoint (finance)** | ✅ unblocked | Pure server work using `renderToBuffer` (Node, no browser issues). Fully independent of every research finding here. |
| C.2.0 — Font + MF2 prerequisite | ✅ unblocked | Can start in parallel with C.1.1. |
| C.2.1 — pdf-templates identity module | ✅ unblocked | Server work; independent of UI. |
| C.2.2–C.2.5 — Shell editor work | 🟡 gated on C.2.0 | Font registration must work in browser first. |
| AdminWeb read-only view | 🔵 deferred until C.2 ships | Per CEO call: tenant-facing edit lands first, then support read view. |

---

## Process retros captured

The 5-stream parallel research pattern took ~10 min wall clock vs hours of serial exploration. Worth repeating before any large UI sprint kickoff. The output answers concrete blocking questions (font path, MF2 singleton) that would otherwise surface during build and stall the sprint mid-flight.

# EPIC-C — PDF Generation Service Design (revised)

> **Drafted:** 2026-05-24
> **Last execution update:** 2026-05-24 (Sprint C.0 in flight — 4 of 7 tickets shipped through C.0.4)
> **Status:** ⏳ Sprint C.0 in flight — C.0.1 / C.0.2 / C.0.3 / C.0.4 🟢 all merged + published to npm (`@aibrains/pdf-renderer@0.4.0` live); C.0.5 + C.0.6 + C.0.7 🔲 next.
> **Supersedes:** v3.4 EPIC-C draft in [`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md) §5
> **Companion docs:**
> - Master plan: [`v1-master-epic-breakdown.md`](./v1-master-epic-breakdown.md) §5 (EPIC-C, amended in lockstep with this doc)
> - Pilot dossier: [`docs/pilots/pabson-saraswati-bs-2083/dossier.md`](../pilots/pabson-saraswati-bs-2083/dossier.md)
> - Cross-references: BLE design [`d4-ble-design.md`](./d4-ble-design.md) §11.5 (admit-card fields) — admit-card data shape lands in C.5.1, entity wiring in D.4.4
> - Validation-spike memory ([`feedback_validation_spike_before_library_integration`](../../.claude/projects/-Users-shoaibrain-edforge/memory/feedback_validation_spike_before_library_integration.md)) — captures the 5+ `@react-pdf/renderer` integration surprises hit during C.0.3 + the rule going forward

---

## 0. Why this document exists

The v3.4 EPIC-C draft scoped PDF generation as a finance-feature using **Puppeteer + Handlebars on a Chromium Lambda**, with the operator branding UI in **AdminWeb**, and a hand-wave at "future doc types."

Re-thinking the design at staff-architect depth surfaced four mismatches with the actual EdForge platform vision:

1. **PDF generation is a platform capability, not a finance feature.** The EMIS needs invoice, receipt, report card, transcript, admit card, ID card, certificates, hall tickets, attendance sheets, mark lists — ~12 doc types over the next 2-3 quarters spanning finance / academics / identity domains. Putting templates and renderer in finance creates cross-domain dependencies (academics → finance to render a transcript?) we don't want.
2. **Templates are tenant-level metadata** alongside `WorkspaceSettings` and `SchoolConfiguration`. They belong in identity DDB, not finance.
3. **The template editor should live in ONE place** for all doc types. AdminWeb is system-admin-facing; the TenantAdmin who configures their school's invoice template lives in the tenant-facing Shell. The editor moves to Shell-Settings.
4. **`@react-pdf/renderer` is a better fit than Puppeteer** for our use case: in-container rendering (no Chromium), JSX-as-template (live preview free via `<PDFViewer>`), single source of truth between server + browser.

This document captures the revised design, the trade-offs taken, the open questions resolved by CEO direction (2026-05-24), and the C.0–C.5 atomic-ticket plan in the master-plan format.

---

## 1. Decisions captured at sign-off (2026-05-24)

| Decision | Choice | Rationale |
|---|---|---|
| Template storage | **Identity DDB** | Templates are platform metadata; co-located with WorkspaceSettings; identity already owns the permission + audit infrastructure. |
| Renderer execution | **In-container for sync, Lambda for batch** — same shared library | Sync = zero cold-start. Batch = leverages Lambda concurrency (1000 Mumbai quota). One library, two execution paths via `@react-pdf/renderer` which works in both Node + browser. |
| Editor location | **Tenant-facing Shell** (`/settings/pdf-templates`) | TenantAdmin manages templates from one place across all doc types. NOT AdminWeb (that's EdForge-staff-facing). |
| Default seeding | **Lazy-seed (Option C)** — no backfill, no tenant-seeder change | Identical to D.1.3 GradingPolicy lazy-seed pattern. Default = pure function of `(archetype, locale)` baked into descriptors. DDB row only created on admin save. |
| PABSON archetype defaults | **BS+AD dual dates + EN+NE labels + ne-NP locale + NPR + south-asian number format** | Saraswati and other PABSON tenants get sensible PDFs out of the box with zero operator action. |
| Tier gating | **None in V1**, architecture stays scalable | When EdForge grows to multi-tier, a `@RequireTier` decorator on the `pdf-templates:configure` permission key gates editing without affecting render endpoints. |
| Receipts vs invoices | **Separate doc types**, separate DDB rows, separate descriptors | Per CEO direction. Primitives (`LineItemTable`, `BrandedHeader`) are shared in the renderer library. |
| Per-school scope | **Per-school templates only** — tenant-level inheritance left as future additive change | DDB key `SCHOOL#{schoolId}#PDF_TEMPLATE#{docType}#CURRENT`. Adding tenant-level inheritance later = new entity type + cascade-resolve in `getCurrentTemplate(...)`. No migration. |
| Renderer library | **`@aibrains/pdf-renderer` (built on `@react-pdf/renderer` v3)** | NOT Puppeteer+Handlebars. See §2 for full reasoning. |

---

## 2. Renderer library choice — why `@react-pdf/renderer`

The v3.4 draft locked in Puppeteer + Handlebars. Re-litigated against the new platform vision + Nepali requirement:

| Concern | Puppeteer + Handlebars | `@react-pdf/renderer` |
|---|---|---|
| In-container rendering (NestJS Fargate) | ❌ Needs Chromium ~200MB + 1GB+ memory in container | ✅ Pure JS, ~5MB Node bundle, runs anywhere |
| Shell-level live preview in browser | ❌ Puppeteer is server-only; live preview iframe would call Lambda on every keystroke | ✅ `<PDFViewer>` renders in-browser using the same JSX as the server. No infra round-trip. |
| Devanagari (Nepali) script | ✅ Web fonts native | ✅ Via `Font.register('Noto Sans Devanagari')` at boot; v3 uses Yoga + Fontkit for complex script shaping. |
| Template authoring | `.hbs` files (server-only); no live preview | JSX components (server + browser); live preview free. |
| Single source of truth | ❌ Three sources: `.hbs` template, AdminWeb preview iframe, generated PDF. Drift inevitable. | ✅ One source: `<InvoicePdf>` JSX, rendered three ways from the same code. |
| Cold-start (R23) | 3-5s Chromium boot | 200-500ms first invocation; in-container has zero cold start. |
| Per-render memory | Chromium hold + 256MB | ~50MB working set. |
| Future migration to alternative | Locked into Chromium operationally | Renderer is library-internal. Descriptor pattern lets us swap any single doc-type's renderer to Puppeteer later if a need surfaces (e.g., marketing brochures with arbitrary embedded HTML). |
| Team skill leverage | Mixed (Handlebars + Chromium + Lambda containerization) | High (the team is React-heavy; JSX is familiar; Yoga is React Native styling primitives) |

**Choice: `@react-pdf/renderer`.** Risk R23 (Lambda cold-start) closes by virtue of the choice — no Chromium, no comparable cold-start cost.

**Caveat — Devanagari shaping confidence (updated 2026-05-24):** Nepali (Devanagari script) has complex shaping rules (conjuncts, vowel marks, ligatures). `@react-pdf/renderer` v3 uses Yoga + Fontkit + Harfbuzz. ✅ **C.0.3 canary proved the pipeline works** — `render-smoke.spec.tsx` renders five common Nepali phrases (बिल / रसिद / उप-योग / जम्मा रकम / विद्यार्थीको नाम) end-to-end to a real PDF Buffer in every CI run. **Risk R45** is now Low likelihood; fallback ("admin opts back to English-only labels") remains the operator escape hatch.

---

## 3. Architecture overview

```
                    ┌──────────────────────────────────────────────────────────┐
                    │  @aibrains/pdf-renderer  (npm-published shared package)  │
                    │  ──────────────────────────────────────────────────────  │
                    │  core/                                                   │
                    │    fonts (Noto Sans + Noto Sans Devanagari)              │
                    │    i18n (en + ne bundles)                                │
                    │    format (date BS/AD/dual, currency, number)            │
                    │  primitives/                                             │
                    │    Document, Page, BrandedHeader, BrandedFooter,         │
                    │    Watermark                                             │
                    │  components/                                             │
                    │    KeyValueTable, LineItemTable, TotalsBlock,            │
                    │    GradeTable, StudentPhotoFrame, BarcodeQR,             │
                    │    SignatureLine                                         │
                    │  documents/                                              │
                    │    <InvoicePdf>, <ReceiptPdf>, <ReportCardPdf>,          │
                    │    <AdmitCardPdf>, <TranscriptPdf>, ...                  │
                    │  descriptors/                                            │
                    │    invoice, receipt, report-card, admit-card, ...        │
                    │    each: docType + Component + sampleData +              │
                    │    configurableFields[] + defaults(archetype, locale)    │
                    └─────────────────┬────────────────────────────────────────┘
                                      │ npm install
   ┌──────────────┬──────────────┬────┴──────────────┬──────────────────┬─────────────────────┐
   │              │              │                   │                  │                     │
   ▼              ▼              ▼                   ▼                  ▼                     ▼
finance NestJS   academics    identity NestJS    edforge-pdf-batch    shell (browser)   apps/{finance,academics}
ECS service      NestJS ECS   ECS service        Lambda (esbuild)     <PDFViewer> for   MFEs (download buttons)
                                                                       live preview
GET /invoices   GET /result-  pdf-templates       Consumes              In Settings →
  /:id/pdf     cards/:id/pdf  module + branding   PdfJobRequested       PDF Templates →
GET /payments                  module             event; renders        editor route
  /:id/receipt                                    per-docType via
  /pdf                         CRUD + lazy-seed   getDescriptor(); 
                               + presigned URLs   uploads to S3;
                                                  updates DDB job
                                                  status; emits
                                                  pdf.job.completed
   │              │              │                   │
   │              │              │                   │
   ▼              ▼              ▼                   ▼
 ──────────  finance DDB  ──── identity DDB ────  S3 buckets ──
                            (templates +         (edforge-pdfs-*
                             branding +           edforge-pdf-assets-*)
                             pdf jobs)
```

### Three boundaries the team has to internalize

1. **Renderer = pure function.** `(documentData, templateConfig, brandingConfig, locale) → PDFBuffer`. No I/O. No DDB. No S3. Unit-testable via snapshots.
2. **Template management = identity domain.** Templates + branding are platform metadata. One CRUD API. One permissions model. One audit pattern. One editor UI.
3. **Domain endpoints = thin orchestrators.** Each `GET .../<doc>/pdf` endpoint: (a) fetches its own data, (b) fetches the template via `IdentityClient` (60s LRU cache), (c) calls the shared renderer, (d) returns the blob, (e) emits an audit event. Zero rendering logic in the orchestrator.

---

## 4. Data model

### 4.1 Identity DDB (`edforge-identity-basic`) — new entity types

```
# Current "active" pointer per (schoolId, docType) — 1 row
PK = tenantId (bare UUID per identity convention)
SK = SCHOOL#{schoolId}#PDF_TEMPLATE#{docType}#CURRENT
Fields: { templateId, currentVersion, lastPublishedAt, lastPublishedBy }
GSI1: gsi1pk = TENANT#{tenantId}#SCHOOL#{schoolId},
       gsi1sk = PDF_TEMPLATE#{docType}

# Versioned template documents — 1 row per version, immutable once published
PK = tenantId
SK = SCHOOL#{schoolId}#PDF_TEMPLATE#{docType}#{templateId}#V{version}
Fields: {
  templateId, version, docType, status,  # 'draft' | 'published' | 'archived'
  config,                                  # the full JSON template body
  createdAt, createdBy,
  publishedAt?, publishedBy?,
  archivedAt?
}

# Batch job rows
PK = tenantId
SK = SCHOOL#{schoolId}#PDF_JOB#{jobId}
Fields: {
  jobId, docType, status,        # pending|processing|completed|partial|failed
  totalCount, completedCount, failedCount,
  errors[],
  s3KeyZip?,
  presignedUrl?,
  requestedBy, requestedAt, completedAt?,
  ttl                            # auto-expire 7d after completion
}
```

### 4.2 Template config shape (versioned, per docType)

```typescript
interface PdfTemplateConfig {
  // Branding overrides (else inherit from School.branding)
  brandingOverrides?: Partial<SchoolBrandingDto>

  // Layout
  pageSize: 'A4' | 'A5' | 'LETTER'
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }  // mm

  // Header (per-template overrides for what's shown)
  header: {
    showLogo: boolean
    showSchoolName: boolean
    showSchoolAddress: boolean
    tagline?: string
  }

  // Footer
  footer: {
    text?: string
    showPaymentTerms: boolean
    showSignatureLine: boolean
    showPageNumbers: boolean
  }

  // Locale (consults but can override workspace settings)
  dateFormat: 'gregorian' | 'bikram_sambat' | 'dual'
  numberFormat: 'south-asian' | 'western' | 'auto-from-workspace'
  currencyDisplay: 'symbol' | 'iso-code' | 'name'
  labelLanguages: ('en' | 'ne')[]  // minimum 1 entry — single or dual mode

  // Doc-type-specific (varies by descriptor — see invoice example below)
  [key: string]: unknown
}

// Example: InvoiceTemplateConfig extends PdfTemplateConfig
interface InvoiceTemplateConfig extends PdfTemplateConfig {
  lineItemColumns: {
    description: boolean        // always true
    quantity: boolean
    amount: boolean             // always true
    discount: boolean
    taxRate: boolean
    taxAmount: boolean
    total: boolean              // always true
  }
  totalsSection: {
    showSubtotal: boolean
    showTaxTotal: boolean
    showDiscountTotal: boolean
    showAmountPaid: boolean
    showAmountDue: boolean
    showTaxBreakdown: boolean
  }
  watermark?: {
    enabled: boolean
    text: string
    opacity: number
    rotation: number
  }
}
```

### 4.3 School entity extension (C.0.5)

```typescript
interface School {
  // ... existing fields ...
  branding?: {
    formalName?: string
    addressLines?: string[]        // up to 4 lines
    phone?: string
    email?: string
    logoS3Key?: string              // → edforge-pdf-assets-*
    principalSignatureS3Key?: string
    letterheadBackgroundS3Key?: string
    colorPalette?: { primary: string; accent: string }
    panNumber?: string              // Nepal tax registration
    vatNumber?: string
    brandingVersionId?: string      // UUID, bumped on every update
  }
}
```

### 4.4 Document immutability (frozen template ref on issued docs)

Issued documents (invoice on `issued` status, receipt on payment, result card on `published`) carry:

```typescript
pdfTemplateRef?: {
  docType: 'INVOICE' | 'RECEIPT' | 'REPORT_CARD' | ...
  templateId: string
  version: number
}
```

Render endpoints check `pdfTemplateRef` first — if present, fetch the frozen version. Else use current. **Old documents render byte-identically forever, even after the template is edited 10× since.**

### 4.5 S3 layout

```
edforge-pdfs-<account>-<region>/                  # generated PDFs (short-lived)
  tenants/{tenantId}/schools/{schoolId}/
    pdf-jobs/{jobId}/
      invoices/INV-2026-001234.pdf
      report-cards/...
      bundle.zip                                   # if deliveryMode='zip'
  # Lifecycle: TAG-BASED (NOT prefix). Every writer placing an object under
  # .../pdf-jobs/... MUST tag it { lifecycle: 'pdf-jobs' } at PutObject time;
  # the bucket rule expires tagged objects at 7d. Prefix-based lifecycle
  # cannot match here because the prefix is buried under tenants/{tid}/
  # schools/{sid}/. Untagged objects survive — leaves room for a V1.5 audit-
  # copy lane in the same bucket without unintended deletion.

edforge-pdf-assets-<account>-<region>/            # template assets (long-lived)
  tenants/{tenantId}/schools/{schoolId}/
    branding/{logo|signature|letterhead}/{uuid}.{ext}
    pdf-templates/{templateId}/{logo}/{uuid}.{ext}  # template-specific overrides
  # Lifecycle: versioned, no expiration
```

Both buckets: `BlockPublicAccess.BLOCK_ALL`, `S3_MANAGED` encryption, `enforceSSL: true`, `RemovalPolicy.RETAIN`. **No CFN exports** for bucket names (consumer Lambdas read via env var) — per CLAUDE.md cross-stack export pre-flight rule.

---

## 5. Renderer library: API contract

### 5.1 Public API

```typescript
// Server (Node)
import { renderToBuffer, getDescriptor } from '@aibrains/pdf-renderer'

const descriptor = getDescriptor('INVOICE')
const buffer: Buffer = await renderToBuffer(
  <descriptor.Component
    data={invoiceData}
    template={templateConfig}
    branding={schoolBranding}
    workspaceSettings={settings}
  />
)

// Browser
import { PDFViewer, getDescriptor } from '@aibrains/pdf-renderer'

const descriptor = getDescriptor('INVOICE')
return (
  <PDFViewer width="100%" height="100%">
    <descriptor.Component data={mockData} template={formValues} ... />
  </PDFViewer>
)
```

### 5.2 TemplateDescriptor pattern (the extensibility hinge)

```typescript
interface TemplateDescriptor<TData, TConfig extends PdfTemplateConfig> {
  docType: DocType
  i18nNamespace: string
  Component: React.ComponentType<{
    data: TData
    template: TConfig
    branding: SchoolBrandingDto
    workspaceSettings: WorkspaceSettings
  }>
  schema: ZodSchema<TConfig>
  defaults(archetype: Archetype, locale: string): TConfig
  sampleData(archetype: Archetype, locale: string): TData
  configurableFields: ConfigurableField[]
}

interface ConfigurableField {
  path: string                            // dot path in TConfig (e.g. 'lineItemColumns.discount')
  type: 'text' | 'textarea' | 'toggle' | 'select' | 'multiselect' | 'color' | 'file' | 'number'
  labelKey: string                        // i18n key
  descriptionKey?: string
  options?: string[]                      // for select / multiselect
  accept?: string                         // for file (MIME)
  maxSizeBytes?: number                   // for file
  minItems?: number                       // for multiselect
  visibleIf?: { path: string; equals: unknown }  // conditional display
}
```

**Adding a new doc type = adding a descriptor + a `<DocPdf>` component. Zero changes to:**
- The editor UI (it reads `configurableFields[]` and renders form sections automatically)
- The template DDB schema (new `docType` value is just data)
- The render orchestrator pattern (each domain has a 30-line endpoint that calls `renderToBuffer(<descriptor.Component .../>)`)
- The batch Lambda (per-docType switch dispatches via `getDescriptor`)

This is the platform property. ~1-2 day per future doc type.

### 5.3 Localization

```typescript
// In a document component
import { t } from '@aibrains/pdf-renderer/core/i18n'

function InvoicePdf({ template, ... }) {
  const lang = template.labelLanguages[0]  // primary

  return (
    <Document>
      <Page>
        {/* Single-language */}
        <Text>{t('invoice', 'invoice', lang)}</Text>

        {/* Dual-language */}
        {template.labelLanguages.length === 2 && (
          <View>
            <Text style={styles.labelPrimary}>{t('invoice', 'invoice', template.labelLanguages[0])}</Text>
            <Text style={styles.labelSecondary}>{t('invoice', 'invoice', template.labelLanguages[1])}</Text>
          </View>
        )}

        {/* Data fields are NOT translated — rendered as-stored */}
        <Text>{data.studentName}</Text>
      </Page>
    </Document>
  )
}
```

`t(ns, key, lang)` reads from `@aibrains/pdf-renderer/i18n/{lang}/{ns}.json`. Bundled with the package. Server + browser see the same translations.

---

## 6. Endpoint contract (per-domain)

### 6.1 Sync endpoint (in NestJS service container)

```
GET /{domain}/.../{noun}/{id}/pdf
  Headers: Authorization: Bearer <Cognito ID JWT>

Response: 200 application/pdf
  Content-Disposition: attachment; filename="<sensible-filename>.pdf"
  X-Correlation-Id: <uuid>
```

Standard NestJS controller method:

```typescript
@Get(':id/pdf')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
async getPdf(
  @Param('schoolId') schoolId: string,
  @Param('id') id: string,
  @TenantCredentials() ctx: TenantContext,
  @Res() res: Response,
): Promise<void> {
  const data = await this.invoicesService.get(schoolId, id, ctx)
  await this.identityClient.enforceStudentOwnership(data.studentId, schoolId, ctx)

  const template = data.pdfTemplateRef
    ? await this.identityClient.getTemplateVersion(schoolId, data.pdfTemplateRef, ctx)
    : await this.identityClient.getCurrentTemplate(schoolId, 'INVOICE', ctx)
  const branding = await this.identityClient.getSchoolBranding(schoolId, ctx)
  const settings = await this.identityClient.getWorkspaceSettings(ctx)

  const buffer = await this.pdfRendererService.render('INVOICE', {
    data,
    template,
    branding,
    workspaceSettings: settings,
  })

  this.auditedWriteService.emit(ctx, {
    action: 'pdf_generated',
    targetEntity: 'PDF_DOCUMENT',
    targetId: id,
    details: { docType: 'INVOICE', templateId: template.id, version: template.version },
  })  // fire-and-forget

  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `attachment; filename="Invoice-${data.invoiceNumber}.pdf"`)
  res.send(buffer)
}
```

### 6.2 Batch endpoint (write to identity, consumed by Lambda)

```
POST /pdf-jobs
Body: { docType, schoolId, ids: string[], deliveryMode: 'zip' | 'individual' }
Response: 202 { jobId, status: 'pending', estimatedCompletionAt }

GET /pdf-jobs/{jobId}
Response: 200 {
  jobId, status, totalCount, completedCount, failedCount,
  downloadUrl?,     # present iff completed; 600s TTL; re-issued on each GET
  errors?,
  createdAt, completedAt?
}
```

### 6.3 Template management

```
GET    /schools/:schoolId/pdf-templates                                  # list all docTypes
GET    /schools/:schoolId/pdf-templates/:docType/current                 # the CURRENT row (or descriptor default)
GET    /schools/:schoolId/pdf-templates/:templateId/versions             # version history
GET    /schools/:schoolId/pdf-templates/:templateId/versions/:v          # a specific version
POST   /schools/:schoolId/pdf-templates                                  # create draft
PATCH  /schools/:schoolId/pdf-templates/:templateId                      # update draft (opt-lock on version)
POST   /schools/:schoolId/pdf-templates/:templateId/publish              # draft → published
POST   /schools/:schoolId/pdf-templates/:templateId/versions/:v/republish # rollback
DELETE /schools/:schoolId/pdf-templates/:templateId/drafts/:v            # delete unpublished draft only
```

### 6.4 Branding management

```
GET    /schools/:schoolId/branding                                        # the persisted branding object
POST   /schools/:schoolId/branding/assets/upload-url                     # returns presigned PUT URL
PATCH  /schools/:schoolId/branding                                       # update with newly-uploaded s3Key
```

All routes: three-way handoff per CLAUDE.md (NestJS controller + `tenant-api-prod.json` + nginx if new prefix; existing `/schools` prefix covers everything except a new top-level `/pdf-jobs`).

---

## 7. Lazy-seed pattern (the key decision)

The question CEO asked: *"Do we need backfill for existing tenants, or is it better to leave to the user to configure?"*

The answer: **neither** — lazy-seed.

```typescript
// identity service: PdfTemplatesService.getCurrentTemplate
async getCurrentTemplate(schoolId: string, docType: DocType, ctx: TenantContext) {
  const row = await this.ddb.getItem(ctx.tenantId, this.keys.pdfTemplateCurrent(schoolId, docType))
  if (row) {
    const version = await this.ddb.getItem(ctx.tenantId,
      this.keys.pdfTemplateVersion(schoolId, docType, row.templateId, row.currentVersion))
    return version  // saved config
  }
  // No row → return descriptor default (NO DDB write)
  const archetype = await this.tenantMetadataReader.getArchetype(ctx.tenantId)
  const locale = await this.workspaceSettings.getLocale(ctx)
  const descriptor = getDescriptor(docType)
  return {
    templateId: null,                              // null signals "lazy-default"
    version: 0,
    config: descriptor.defaults(archetype, locale),
    isLazyDefault: true,                            // editor uses this flag
  }
}
```

**Implications:**
- New schools: invoices render immediately with PABSON-archetype defaults (BS+AD + EN+NE + NPR). No operator action needed.
- Existing schools (Saraswati, dev-pabson-primary): same — no backfill script, no tenant-seeder modification.
- Editor: when admin opens an unsaved template, it pre-fills with the lazy default. First save creates the DDB row.
- Schema evolution: when descriptor gains a new field, every unsaved template surfaces it immediately. Saved templates merge their saved config OVER the descriptor default, so new fields fall back gracefully.

**Why this is correct (and not Option A active backfill or Option B user-initiated):**
- Active backfill writes DDB rows that may never be edited (clutter); requires deployer IAM grants that recurringly block sprints per [project_grade_level_fix_T5_shipped](docs/pilot-greenlight/v1-master-epic-breakdown.md); tenant-seeder Lambda would need updating, which is non-trivial.
- User-initiated means existing schools' first invoice download fails until an admin sets up the template — bad UX, undefined error path.
- Lazy-seed inherits the well-proven D.1.3 pattern (memory `project_sprint_d1_shipped_prod`).

---

## 8. Frontend (editor UI)

### 8.1 Where it lives

Tenant-facing Shell, mirroring the existing Workspace Settings page:

```
Shell (apps/shell)
├── pages/settings/
│   ├── workspace.tsx                           # exists; regional defaults
│   ├── school-configuration.tsx                # exists; school-level overrides
│   ├── pdf-templates/
│   │   ├── index.tsx                           # NEW C.2.3 — list of all doc types
│   │   └── [docType].tsx                       # NEW C.2.4 — generic editor
│   └── ...
```

### 8.2 Index page (C.2.3)

A list of doc-type cards. Each card shows:
- Doc type label
- Current state: "Using default" or "v3 published by [admin] on [date]"
- Click → navigate to `[docType].tsx`

V1 active doc-type cards: Invoice, Receipt, Report Card.
V1.5+ disabled-but-visible cards: Admit Card (Coming with D.4/D.5), Transcript, ID Card, Bonafide Certificate, Transfer Certificate.

### 8.3 Generic editor (C.2.4)

Reads `descriptor.configurableFields[]` from `@aibrains/pdf-renderer` and renders form sections. **Same component for every doc type** — the difference is the descriptor.

```
┌────────────────────────────────────────┬─────────────────────────────────┐
│ Settings ▸ PDF Templates ▸ Invoice     │                                 │
│ Saraswati School                       │                                 │
│ Current: v3 by Shoaib 2 days ago       │  ┌───────────────────────────┐  │
│                                        │  │  LIVE PREVIEW             │  │
│ ┌─ Branding (or "use school defaults") │  │  <PDFViewer> {jsx}        │  │
│ │ ☑ Override branding for this template│  │                           │  │
│ │   Primary color  [#0D9488]           │  │  300ms debounced re-render│  │
│ │   Logo           [Upload...]         │  │                           │  │
│ └──────────────────────────────────────│  │  Sample switcher:         │  │
│                                        │  │  ◉ Default mock           │  │
│ ┌─ Layout                              │  │  ○ Real invoice [search]  │  │
│ │ Page size [A4 ▼]   Orientation [P ▼] │  │                           │  │
│ └──────────────────────────────────────│  └───────────────────────────┘  │
│                                        │                                 │
│ ┌─ Line Items                          │  Version history ▾              │
│ │ ☑ Quantity  ☑ Tax rate               │   v3 (published 2d ago)         │
│ │ ☐ Discount  ☐ Tax amount             │   v2 (archived)                 │
│ └──────────────────────────────────────│   v1 (archived)                 │
│                                        │                                 │
│ ┌─ Language                            │                                 │
│ │ Labels  ☑ English  ☑ Nepali          │                                 │
│ │ Date format [Dual (BS / AD) ▼]       │                                 │
│ └──────────────────────────────────────│                                 │
│                                        │                                 │
│ [Discard] [Save Draft] [Publish v4]    │                                 │
└────────────────────────────────────────┴─────────────────────────────────┘
```

### 8.4 Sample-data switcher

- **Default mock** (V1): `descriptor.sampleData(archetype, locale)` returns a hardcoded plausible invoice. PABSON → NPR / BS / Nepali labels.
- **Real invoice** (V1.5 polish, optional in C.3): searchable picker → fetches real invoice via existing finance API → preview renders against real data.

### 8.5 Form primitives needed

| Primitive | Status in `@edforge/forms` | Action |
|---|---|---|
| TextField, TextareaField, SelectField, ToggleField, CheckboxField, DateField, PhoneField | Exist | Reuse |
| `ColorField` | **Missing** | NEW C.2.2 — native `<input type="color">` + RHF Controller |
| `FileField` (image upload + preview) | **Missing** | NEW C.2.2 — file picker + preview + size/MIME validation + presigned-PUT integration |
| `MultiSelectField` | Verify | NEW or extend SelectField — C.2.2 |

---

## 9. Concurrency planning (revised given Mumbai prod = 1000)

The first design draft assumed account-wide Lambda concurrency was ~10 (UAT value). CEO clarified 2026-05-24: Mumbai prod = **1000 unreserved Lambda concurrency**. Revised budget:

```
Reserved:
  edforge-pdf-batch                             50
Sum of other Lambdas' reserved                   0  (none reserved today)
                                              ────
Total reserved                                  50
Unreserved pool available to other Lambdas     950
```

**Why 50:** 50 concurrent Lambda instances × ~10 PDFs per chunk × ~3s per PDF = ~150 PDFs/second peak. ~9000 PDFs/minute. Plenty for V1 + V2.

**Per-tenant fairness:** EB rule fires Lambda per `PdfJobRequested` event. Each event → one Lambda invocation → one job. Lambda concurrency naturally parallelizes across tenants. If 50-job concurrent limit becomes a constraint, the lever is per-tenant SQS FIFO with `MessageGroupId = tenantId` — not needed for V1.

---

## 10. Phase plan (atomic tickets)

See the master plan §5 (EPIC-C) for the canonical C.0–C.5 ticket breakdown. Summary:

| Sprint | Tickets | Outcome | EPIC-D dep | Status |
|---|---|---|---|---|
| **C.0** | 7 (C.0.1–C.0.7) | `@aibrains/pdf-renderer` published; fonts + primitives + components + descriptor registry; `SchoolBranding` schema + entity field + presigned upload endpoint live | None | ⏳ **4 of 7 shipped** (see §10.1) |
| **C.1** | 6 (C.1.1–C.1.6) | Invoice + Receipt PDF MVP downloadable from existing pages; jspdf+html2canvas retired from `PaymentReceipt.tsx`; lazy-seed working | None | 🔲 not started |
| **C.2** | 5 (C.2.1–C.2.5) | Shell-level template editor; TenantAdmin can customize Invoice + Receipt; document immutability frozen on issue | None | 🔲 not started |
| **C.3** | 3 (C.3.1–C.3.3) | Report Card PDF (uses A.4 ✅) | None | 🔲 not started |
| **C.4** | 4 (C.4.1–C.4.4) | Batch generation (Lambda) | None | 🔲 not started |
| **C.5** | 1 ships in C.5 + 2 referenced in D.4/D.5 (C.5.2 = D.4.4, C.5.3 = D.5.3) | Admit Card data-shape ships; entity integration interleaves with EPIC-D | C.5.2 needs D.4; C.5.3 needs D.5 | 🔲 not started |
| **Total** | **24 V1 tickets across 6 sprints** | — | — | — |

### 10.1 Sprint C.0 execution log

> Tracks ticket-level progress + lessons captured during execution. Updated after every C.0.* PR ships.

| Ticket | Title | PR | Status | npm publish | Notes |
|---|---|---|---|---|---|
| **C.0.1** | `@aibrains/pdf-renderer` workspace package skeleton | [#182](https://github.com/shoaibrain/edforge/pull/182) | 🟢 merged 2026-05-24 | `0.1.0` was *not* published (404 on `npm view`); the name was reserved but no content shipped to npm until C.0.2 absorbed the publish. | Discovered: root uses **npm workspaces**, NOT pnpm — master plan ticket text had `pnpm-workspace.yaml` which is wrong; small docs correction queued. |
| **C.0.2** | Core utilities (theme + i18n + format) | [#183](https://github.com/shoaibrain/edforge/pull/183) | 🟢 merged 2026-05-24 | `0.2.0` ✅ live on npm | Discovered: `gregorianToBs` has different behavior for date-only ISO vs `T00:00:00Z` strings — slicing to YYYY-MM-DD before BS conversion normalizes both forms. `formatDate` design-doc example output stays correct. |
| **C.0.3** | Fonts + primitives + components | [#184](https://github.com/shoaibrain/edforge/pull/184) | 🟢 merged 2026-05-24 | `0.3.0` ✅ live on npm | **Five `@react-pdf/renderer` integration surprises hit + fixed during the PR** (see §15 Lessons). All 53 specs passed including the R45 Devanagari canary. Subsequent CodeRabbit review surfaced 6 more issues (LineItemTable column ordering, Image src type widening, "first-script-wins" → "any-Devanagari-wins" semantics, Watermark fontFamily) — all valid, all landed on the same branch. 58 specs final. |
| **C.0.4** | `TemplateDescriptor<T>` + registry | [#185](https://github.com/shoaibrain/edforge/pull/185) | 🟢 merged 2026-05-24 | `0.4.0` ✅ live on npm | 72 specs total. CodeRabbit caught `labelLanguages: readonly Lang[]` accepting empty array — fixed by switching to non-empty tuple type `readonly [Lang, ...Lang[]]`. |
| **C.0.5** | `SchoolBranding` schema + School entity extension | TBD | 🔲 next | shared-types minor bump | First C.* ticket that touches **identity service**; brings the shared-types publish-gate workflow back into the loop. |
| **C.0.6** | Tenant PDF S3 buckets (CDK) | TBD | 🔲 not started | n/a (CDK only) | Adds two buckets to `analytics-stack.ts`. No CFN exports — env-var pattern per R46. |
| **C.0.7** | Branding presigned-upload + GET endpoints (identity) | TBD | 🔲 not started | n/a | New `pdf-templates` + `branding` modules in identity service; first `tenant-api-prod.json` change in EPIC-C → `shared-infra-stack` redeploy. |

### 10.2 Critical-path timeline (post 2026-05-24 CEO call: PDF prioritized over D.4)

```
2026-05-24 (now)
   │
   ├─►  ✅ Sprint C.0.1–C.0.4 shipped (library foundation + descriptor registry)
   │      └─► @aibrains/pdf-renderer at 0.4.0 ✅ live on npm
   │      └─► R45 Devanagari rendering proven via canary test
   │
   ├─►  ⏳ Sprint C.0.5–C.0.7 next (SchoolBranding entity + S3 buckets + upload endpoints)
   │
   ├─►  Sprint C.1  (invoice + receipt MVP; ships independently)
   │      └─► Saraswati operator + dev-pabson-primary admin can download
   │          branded invoice + receipt PDFs immediately
   │
   ├─►  Sprint C.2  (editor) ──┐
   │                            └─► TenantAdmin self-customizes templates
   │
   ├─►  Sprint C.3  (Report Card; parallel-eligible with C.2)
   │      └─► Term-1 closure path complete for Saraswati
   │
   ├─►  Sprint C.4  (batch generation)
   │      └─► Bulk invoice / report-card generation at term-end
   │
   ├─►  Sprint C.5.1  (admit-card data-shape only)
   │
   └─►  EPIC-D D.4 (BLE Workflow) starts
          └─► D.4.4 wires admit-card entity → render (closes C.5)
```

---

## 11. Risks (new + updated)

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R23 | ~~Document Rendering Lambda cold-start~~ → **CLOSED** | 0 | 0 | Renderer choice change (see §2). |
| R45 | `@react-pdf/renderer` v3 Devanagari font shaping defect | M → L | M | **Canary landed in C.0.3** (not C.0.2 — needed the renderer to be wired). `render-smoke.spec.tsx` renders "बिल" / "रसिद" / "उप-योग" / "जम्मा रकम" + "विद्यार्थीको नाम" end-to-end to a real PDF Buffer and asserts the `%PDF-` magic + non-empty length. Live snapshot confirms no shaping crashes. `validateDevanagari(text)` helper is V1.5 polish (deferred — not needed for V1 since the canary already gates the pipeline). Fallback (admin reverts to English-only labels) remains the operator escape hatch. |
| R46 | Cross-stack CFN export collision (R41 pattern) | L | H | C.0.6 + C.4.1 use env-var pattern for bucket names; no CFN export. Per CLAUDE.md "Cross-stack export change pre-flight" rule. |
| R47 | `@aibrains/pdf-renderer` caret-pin trap | M | M | Every C.* ticket Files: line lists all 4 consumer `package.json` pin bumps explicitly; CLAUDE.md publish-gate checklist applies. |
| R48 | Lazy-default vs saved-template drift on schema evolution | M | L | **Deferred from C.0.4 — `schema: ZodSchema<TConfig>` is NOT in the C.0.4 `TemplateDescriptor` contract.** Schema validation is a server-side concern (identity's `PdfTemplatesService` in C.0.7); adding to the descriptor contract is non-breaking and can land then. For now, mitigation strategy stands: on every template-config read, saved config will merge OVER `descriptor.defaults()` so missing keys fall back to defaults. The merge happens in the server; descriptors don't enforce it directly. |
| R49 | Logo asset orphaning | L | L | Logo S3 keys version-pinned. No auto-cleanup V1. Manual sweep V1.5 when template archived AND no documents reference. Acceptable storage cost growth. |

Full risk register lives in master plan §11. R23 marked CLOSED with note pointing here.

---

## 12. What this design deliberately does NOT include in V1

- **Email delivery** of PDFs (per CEO direction: in-app download/print only).
- **SMS / WhatsApp distribution** (V1.5 with EPIC-B messaging).
- **Public / parent-portal-shareable links** (V1.5 if requested).
- **PDF/A archival format** (V1 produces standard PDF; PDF/A for long-term legal archive is V2).
- **Digital signatures (PKI)** (V2).
- **OCR / text extraction back from PDFs** (V2).
- **Tier-gated paywall** on the configure permission (no V1 tier check; architecture stays scalable for V2).
- **Tenant-level template inheritance** (per-school only V1; additive change V1.5 if requested).
- **Custom-renderer-per-doc-type** (e.g., Puppeteer-for-this-one-thing) — descriptor pattern admits it, but no V1 doc type needs it.
- **Real-invoice preview in editor** (C.3 polish — V1 default mock is sufficient).
- **Multi-doc-type editor power features** (drag-and-drop layout, custom regions, free-form HTML) — V2 maybe; V1 is form + descriptor.

---

## 13. Open follow-ups (not blocking C.0 kickoff)

1. **Designer review of default Invoice + Receipt templates** before C.1 ships. The first impressions are set by the lazy-default rendering — make sure it looks good out of the box.
2. **Backfill plan for existing School entities to add `branding`** — none needed (field is nullable; UI surfaces "set up your branding" prompt on empty), but call out in onboarding playbook.
3. **AdminWeb branding page (existing v3.4 ticket C.5.1)** — move from `client/AdminWeb/src/pages/schools/SchoolBrandingPage.tsx` to a read-only view (EdForge support can SEE tenant branding, but TenantAdmin OWNS editing in the tenant-facing Shell). One-PR move post-C.2.
4. **Permission key `pdf-templates:configure` → Principal opt-in V1.5** — V1 restricts to TenantAdmin only. Easy to relax later.
5. **CloudWatch dashboard** for PDF service — V1.5 polish (Sprint H.1 evidence work).
6. **Operator runbook** at `docs/runbooks/pdf-generation.md` — V1.5 polish.
7. **`scripts/verify-adminweb-bundle.sh`** (CLAUDE.md TODO) — relevant if AdminWeb consumes `@aibrains/pdf-renderer`. For V1 AdminWeb does NOT consume the renderer (editor is in tenant-facing Shell), so this stays a general CLAUDE.md TODO unaffected by EPIC-C.

---

## 14. Sign-off captured (2026-05-24 CEO)

- ✅ Templates in identity DDB
- ✅ Renderer in-container for sync; same library in Lambda for batch
- ✅ Editor in tenant-facing Shell at `/settings/pdf-templates`
- ✅ Lazy-seed pattern (option C) adopted
- ✅ PABSON archetype default = BS+AD dual + EN+NE labels
- ✅ No tier gating V1; architecture scalable
- ✅ Receipt separate from Invoice
- ✅ Per-school templates only
- ✅ `@aibrains/pdf-renderer` (`@react-pdf/renderer`) over Puppeteer+Handlebars
- ✅ Master plan §5 EPIC-C amended in same PR as this artifact

**Sprint C.0 progress (2026-05-24):** C.0.1, C.0.2, C.0.3, C.0.4 all shipped + published — `@aibrains/pdf-renderer@0.4.0` live on npm. Next branches: `sprint/c-0-5-school-branding-schema` for C.0.5 → C.0.6 → C.0.7.

---

## 15. Lessons captured during execution

> Real surprises hit during Sprint C.0 execution. Each is a concrete constraint the renderer carries forward; reviewers of C.1+ should know about them.

### 15.1 `@react-pdf/renderer` integration constraints (C.0.3)

The library docs and the C-EPIC design's "renderer choice" section both elided five integration details. All caught + fixed during the C.0.3 PR:

1. **v4 is ESM-only.** Our package is `node16` CJS (matches `@aibrains/shared-types`). Pinned to `^3.4.5` — last v3 release. React 19 support requires v4; we accept the peer-warning when the Shell (React 19) consumes our package in C.2.
2. **`@fontsource/*` ships `.woff` and `.woff2`, NOT `.ttf`.** Design assumed `.ttf` paths. `.woff` works with react-pdf v3; postbuild copy uses `.woff`.
3. **`yoga-layout` (transitive dep) ships raw TypeScript source.** Required custom Jest `transformIgnorePatterns: ['/node_modules/(?!yoga-layout/)']`. Not obvious from any documentation.
4. **No CSS-style font-fallback chains.** `fontFamily: 'Noto Sans, Noto Sans Devanagari'` is treated as a literal family name and fails to resolve. Each `<Text>` element must have ONE family. The `pickFontFamily(text)` helper (in `core/fonts.ts`) script-detects via Unicode block (`U+0900..U+097F`) and routes per text run. Every text-rendering primitive + component uses it automatically; callers don't think about scripts.
5. **`Font.register` requires NUMERIC `fontWeight` (400/700), not strings ('normal'/'bold').** String registration succeeds silently but the resolver looks up numerics and throws "Could not resolve font for X, fontWeight 400" at render time.

The validation-spike memory ([`feedback_validation_spike_before_library_integration`](../../.claude/projects/-Users-shoaibrain-edforge/memory/feedback_validation_spike_before_library_integration.md)) captures the process rule going forward: **before writing more than one file against any new external library, run a 30-minute throwaway-script spike** that exercises the riskiest cross-environment path. That single spike before C.0.1 would have caught all five up-front and avoided three PRs of incremental discovery.

### 15.2 `pickFontFamily` semantics (post-CodeRabbit correction, C.0.3)

The original JSDoc + test comment said "first-script-wins"; the actual implementation (`DEVANAGARI_RANGE.test(str)`) is **any-Devanagari-wins**. Both interpretations agree for `'बिल / Invoice'` but diverge for `'Invoice / बिल'` — the function returns Devanagari for both. Comment + spec fixed in the C.0.3 follow-up commit. The "any-Devanagari-wins" rule is acceptable because the Devanagari font has Latin glyphs too (so Latin characters render OK in the Devanagari font); the alternative (true first-script-wins via scanning the first character cluster) is V1.5 polish if mixed-language output looks bad.

### 15.3 LineItemTable column ordering (post-CodeRabbit correction, C.0.3)

Initial implementation used `Object.keys(columns).filter(k => columns[k])` — relies on insertion order + lets callers hide `description`/`amount`/`total` despite "always shown" JSDoc. Fixed via explicit `COLUMN_RENDER_ORDER` array + `REQUIRED_COLUMNS` set. 5 new specs in `LineItemTable.spec.tsx` cover the contract — including the case where caller passes `{description: false, ...}` and the runtime correctly ignores the attempted hide.

### 15.4 ISO date normalization in `formatDate` (C.0.2)

`gregorianToBs('2026-04-28T00:00:00Z')` returns BS 2083-01-14; `gregorianToBs('2026-04-28')` returns BS 2083-01-15. The shared-types converter anchors date-only strings to noon-local (per the C3.7 fix) but interprets `T00:00:00Z` strings as UTC instants which shift the day in non-UTC timezones. **Document dates (invoice `dueDate`, etc.) are calendrical, not precise instants** — `formatDate` slices to YYYY-MM-DD before BS conversion, normalizing both forms. Consumers pass raw ISO from DDB without caller-side normalization.

### 15.5 `labelLanguages` non-empty enforcement (post-CodeRabbit correction, C.0.4)

Original `labelLanguages: readonly Lang[]` accepted `[]` despite JSDoc requiring at least one entry. Fixed via non-empty tuple type `readonly [Lang, ...Lang[]]` — the compiler now rejects empty arrays at the call site. Existing fixture `['en']` literal satisfies the stricter type without code change.

### 15.6 Open follow-ups surfaced during execution (not blocking)

- **Visual regression / content-verification tests.** Current render-smoke specs assert "PDF buffer is non-empty + starts with `%PDF-`". They don't extract text from the rendered PDF and verify content. **C.1 InvoicePdf MUST add at least one `pdf-parse`-based golden test** that asserts expected strings appear.
- **Bundle size for frontend Shell.** Published `0.4.0` ships **207.9 kB packed / 304.0 kB unpacked / 88 files** per `npm publish` output. Of the unpacked total, **~296 KB is fonts** (`NotoSans-{Regular,Bold}.woff` ≈ 20 KB each + `NotoSansDevanagari-{Regular,Bold}.woff` ≈ 128 KB each). When the Shell live-preview imports `@aibrains/pdf-renderer` in Sprint C.2, those fonts ship to every tenant browser. **C.2 kickoff must include a font-loading strategy decision** (lazy load? CDN? subset?). The earlier "~700 KB" estimate in drafts was off-by-2× because it assumed `.ttf`; `.woff` is the wire format we ship.
- **Italic faces not registered in V1.** Any template that sets `fontStyle: 'italic'` crashes the render. Either register italic faces or add a runtime guard. V1.5 polish.
- **`schema: ZodSchema<TConfig>` on `TemplateDescriptor`** — deliberately deferred to C.0.7 when server-side template CRUD needs it. Adding to the descriptor contract is non-breaking.

---


# @aibrains/pdf-renderer

EdForge PDF rendering library. JSX-based document templates built on
[`@react-pdf/renderer`](https://react-pdf.org/), with Devanagari (Nepali) font support,
Bikram Sambat date support, and a `TemplateDescriptor` registry for cross-domain
document types.

## Status

**Sprint C.0.1 — skeleton + first publish.** No documents or primitives shipped yet.
See [`docs/pilot-greenlight/c-epic-pdf-generation-design.md`](../../docs/pilot-greenlight/c-epic-pdf-generation-design.md)
for the architecture and the C.0.* sprint plan.

## Roadmap (C.0.* tickets)

| Ticket | Content |
| --- | --- |
| **C.0.1** (this) | Package skeleton, build infrastructure, first publish to npm at 0.1.0 |
| C.0.2 | Fonts (Latin + Devanagari), theme tokens, i18n helpers (EN/NE bundles), format helpers (Gregorian/BS/dual date, currency, number) |
| C.0.3 | Layout primitives (`Document`, `Page`, `BrandedHeader`, `BrandedFooter`, `Watermark`) + reusable components (`KeyValueTable`, `LineItemTable`, `TotalsBlock`, `SignatureLine`) |
| C.0.4 | `TemplateDescriptor<T>` type + per-`DocType` registry (`getDescriptor`, `registerDescriptor`) |
| C.0.5 | `SchoolBranding` schema + entity extension (lands on `@aibrains/shared-types` + identity service — not this package) |
| C.0.6 | Tenant PDF S3 buckets via CDK (not this package) |
| C.0.7 | Branding presigned-upload + GET endpoints (identity service — not this package) |
| C.1.* | First document components: `<InvoicePdf>`, `<ReceiptPdf>` |
| C.3.1 | `<GradeTable>` component + `<ReportCardPdf>` |
| C.5.1 | `<AdmitCardPdf>` data-shape |

## Build

```bash
# From repo root
npm install
cd packages/pdf-renderer
npm run build      # produces dist/index.js + dist/index.d.ts
npm run typecheck  # tsc --noEmit
```

## License

MIT — see [LICENSE](../../LICENSE) at the repo root.

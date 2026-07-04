# EPIC-FB — Family-Level Billing Agreements

> **Status:** v1.2 — 2026-07-04. Backend implementation COMPLETE on `claude/epic-fb-implementation` (see **Appendix C — Implementation record**). FE tasks deferred to the frontend repo per the owner's backend-only release decision. v1.1 was the plan; v1.2 records what shipped.
>
> **Provenance:** produced from a code audit (finance + academics + identity services, shared-types, CDK infra, API Gateway spec, frontend finance MFE) **plus live API verification** against tenant `dev-pabson-primary` (school `DPPSW`) with a TenantAdmin JWT (read-only GETs only), then **adversarially reviewed** by an independent pass that re-verified the highest-risk claims against source (corrections in Appendix B). Supporting audit evidence is in §4; design reference in §3.

---

# 1. The Epic

## 1.1 Problem

Schools negotiate family-level deals — "the Adhikari family pays NPR 40,000 total for three children" — but EdForge can only bill standard per-student fees. Today:

- **No family concept exists.** Guardians are embedded per-student copies; two students cannot be linked as siblings; nothing can answer "students in family X". In live pilot data, guardians carry no email/phone, so even incidental parent-account dedup never fires (§4.7 L4).
- **No agreement/contract concept exists.** The closest mechanisms (grade-level fee overrides, discount rules, credit notes, custom line items) cannot express a negotiated per-family amount with a term and an audit trail (§4.9).
- **Invoice generation has no override hook.** All three generation paths (manual, bulk, enrollment-webhook auto-issue) apply standard fees unconditionally; the webhook path would silently full-price-bill a covered student on re-enrollment (§4.10).
- **One payment cannot settle multiple invoices or students** — the payment schema hard-caps at one invoice target (§4.3), so a parent paying one cheque for three children requires three separate recorded payments.

**Prior art — PR-CA (must reconcile, gate FB-2.0 / risk R10).** [docs/pilot-onboarding-hardening/sprint-plan.md](../pilot-onboarding-hardening/sprint-plan.md) §4 contains a locked, **not-yet-implemented** plan (owner ask 2026-06-27) for a **per-student** `StudentFeeAgreement`: annual amount + installments, `status: active|voided` + `isActive` per P1d, optimistic-concurrency `version` in body, invoice provenance via `feeOverrideMode: 'catalog'|'agreement'` + snapshotted `agreementId`/`agreementVersion`, and the generation hook placed **before** the Sprint A.1 `gradeLevel` snapshot block (`invoices.service.ts:178-260`). Verified: zero PR-CA code exists on `main` as of #423. EPIC-FB is the family-level generalization of the same concept — FB's `per_student` agreement type ≈ `StudentFeeAgreement` + family linkage. **There must be one agreement entity, never two**; the reconciliation decision (PR-CA ships first as the per-student foundation FB extends, or FB's `BillingAgreement` subsumes PR-CA's scope directly) is taken with the owner at FB-2.0. EPIC-FB adopts PR-CA's locked conventions either way (§3.0).

## 1.2 Outcome (epic definition of done)

An operator can: link students into a **family**; record a **billing agreement** (fixed family total or per-student negotiated amounts, covering selected fee types, over a term) with validation, versioning, and audit; have **all three invoice-generation paths** price covered students by the agreement (with suppression provenance on every line, a 409 guard against accidental standard billing, and a permissioned override); settle multiple siblings' invoices with **one payment**; and see **why any invoice looks the way it does** (fee-structure version, agreement version, discount rule) plus family-level financial rollups. The dormant `sibling` discount-rule condition works from real family data.

**Epic exit criteria:**
1. All Sprint 0–5 exit demos pass on the non-prod tenant with live-smoke evidence in each closing PR.
2. Golden test proves generation output is byte-identical to pre-epic behavior when no agreements exist.
3. Flag-off rollback proven by test: agreement routes 404, standard generation resumes, issued agreement-priced invoices stay valid/readable/payable.
4. Operator runbook executed end-to-end once on the dev tenant.

## 1.3 Scope

**In:** FamilyGroup (academics) · BillingAgreement CRUD + lifecycle + versioning (finance) · agreement-aware generation on all three paths · coexistence guard + `billing:manage` override · multi-invoice family payments · sibling discount evaluator · family rollup + invoice provenance trace · remediation of three live defects that would corrupt agreement-era reporting.

**Out (deliberate, §3.5):** household-level billing accounts / family ledger · cross-school or cross-tenant families · `discount_percent` agreement type · payer-scoped or tenant-wide agreement indexes · recurring/scheduled invoice generation · parent-portal agreement visibility.

**Structural constraints honored:** no new DDB GSIs (verified reuse of existing GSI1/GSI2 slots in both tables, §3.0) · no new services · no Student/Guardian entity changes · the only infra deploy is two feature-flag env vars.

## 1.4 Sprint ladder

| Sprint | Codename | Goal | Demoable outcome | Builds on |
|---|---|---|---|---|
| FB-0 | Foundations | Fix live defects L1–L3; feature flags | Status/reporting defects fixed live | — |
| FB-1 | Families | FamilyGroup in academics | Link siblings, query family (API + UI) | FB-0 flags |
| FB-2 | Agreements (draft) | Agreement CRUD, draft-only + RBAC checkpoint | Draft/validate/cancel agreements (API + UI) | FB-1 families |
| FB-3 | Agreement pricing | Generation integration + activation locks | Agreement pricing on all 3 paths, guarded | FB-2 CRUD |
| FB-4 | Family payments | Multi-invoice settlement | One payment settles siblings' invoices | FB-3 (partials fix FB-0.1) |
| FB-5 | Discounts & trace | Sibling rule, rollups, provenance | Auto sibling discount, family rollup, "why" trace | FB-1 + FB-3 |

**Task ID convention:** `FB-<sprint>.<n>`. Every task is one commit-sized, independently reviewable change with its own tests (or stated validation where tests don't apply). Every sprint closes with a non-prod deploy + live-smoke task; prod promotion rides the standard non-prod → human-approval → prod ladder and is not tracked as epic tasks.

## 1.5 Cross-cutting conventions (apply to every task)

- **Three-way route registration:** Nest controller + `tenant-api-prod.json`; nginx untouched — `/academics` (nginx.template:199) and `/finance` (:218) prefix blocks already cover all new routes. `npm run lint:routes` on every endpoint PR.
- **Module wiring:** new NestJS modules register in the service's `module-wiring.spec.ts` watchlist in the same PR.
- **Shared types:** every `@aibrains/shared-types` change = minor bump + publish + consumer caret-pin bumps (`server/application/package.json`, `server/package.json`, root lockfile) in the same PR. zod stays `~3.24.4`.
- **Two repos:** all tasks marked *(FE)* live in `edforge-saas-frontend/` — a separate git repository with its own branches/PRs; every git command there starts with an explicit `cd`.
- **GSI inventory:** any task adding a new GSI1/GSI2 sort-key prefix updates `docs/pilot-greenlight/gsi-inventory.md` in the same PR.
- **Deploy order per sprint:** shared-types publish (0) → `shared-infra-stack` for API GW routes (1) → ECR push + ECS rolling update (2). The only `tenant-template-stack-basic` change in the epic is FB-0.4's env vars.

---

# 2. Sprints & Tasks

## Sprint FB-0 — Audit-findings remediation & foundations

**Sprint goal:** the pre-existing defects that would corrupt agreement-era reporting are fixed and verified live; the feature flags exist.
**Sprint demo:** live dev-tenant walkthrough: partial payment survives the overdue sweep with `isOverdue=true`; dashboard splits draft vs issued exposure; draft cleanup dry-run.

| ID | Task | Validation |
|---|---|---|
| FB-0.1 | Derived `isOverdue` flag; stop erasing `partially_paid` | status-machine + regression + filter tests |
| FB-0.2 | School-rename snapshot policy | mapper + PDF snapshot tests |
| FB-0.3 | Draft-invoice lifecycle policy | service + aggregation tests, route linter |
| FB-0.4 | Feature flags (`FAMILY_GROUPS_ENABLED`, `BILLING_AGREEMENTS_ENABLED`) | controller flag tests, CDK diff |
| FB-0.5 | Non-prod deploy + live smoke | smoke evidence in PR |

- **FB-0.1 — Derived `isOverdue`; stop erasing `partially_paid`** *(live finding L2, risk R5)*
  The sweep (`overdue-detection.service.ts:66-93`) deliberately transitions `partially_paid → overdue`, losing the partial signal from `status`. Fix read-side: `isOverdue` computed from `dueDate < today && status ∉ {paid, cancelled, written_off}` in mappers/list filters; sweep restricted to `issued → overdue`; "overdue" list/dashboard semantics switch to the derived flag so past-due partials still surface everywhere they did before. This preserves both signals — chosen over sweep-rule tweaks that lose one.
  *Tests:* status-machine unit tests for every legal/illegal transition; regression test reproducing the live sequence (issued → partial payment → sweep leaves `partially_paid`, `isOverdue=true`); dashboard/list filter tests proving past-due partials still counted as overdue.
- **FB-0.2 — School-rename snapshot policy** *(live finding L1)*
  Resolve `schoolName` at read/PDF-render time from the school record; stored value remains only the at-issuance archival name.
  *Tests:* mapper test (renamed school → list/detail show current name); PDF snapshot behavior pinned.
- **FB-0.3 — Draft-invoice lifecycle policy** *(live finding L3)*
  Draft age surfacing + `POST /finance/schools/{sid}/invoices/bulk-cancel-drafts` (filters + dry-run) + dashboard `excludeDrafts` toggle (default on). API GW spec row.
  *Tests:* only `draft` bulk-cancellable; tenant/school scoping; dashboard aggregation; route linter.
- **FB-0.4 — Feature flags**
  Task-def env vars via `service-info.txt` (precedent: `ANALYTICS_ENABLED`); guards return 404 on flagged-off routes.
  *Tests:* controller tests both flag states. *Deploy:* `tenant-template-stack-basic` diff shows exactly the env vars.
- **FB-0.5 — Non-prod deploy + live smoke**
  Deploy FB-0.1–0.4; smoke with tenant JWT: partial survives sweep; draft split; dry-run cleanup.

## Sprint FB-1 — Family groups (academics)

**Sprint goal:** operator can create a family, link/unlink students, and query siblings — API + minimal student-profile UI panel.
**Sprint demo:** create "Adhikari family", link two students, `GET /students/{id}/family` returns the sibling; UI panel shows it.

| ID | Task | Validation |
|---|---|---|
| FB-1.1 | Family Zod schemas + shared-types publish | schema unit tests |
| FB-1.2 | Family + member entities/factories | key-pinning tests, gsi-inventory |
| FB-1.3 | FamiliesService CRUD | scoped-query unit tests |
| FB-1.4 | Link/unlink + single-family invariant | invariant + idempotency tests |
| FB-1.5 | `GET /academics/students/{id}/family` | linked/unlinked/deactivated tests |
| FB-1.6 | Controller + guards + module wiring | wiring spec, permission tests |
| FB-1.7 | API Gateway registration | route-drift linter, CDK diff |
| FB-1.8 | *(FE)* Family panel on student profile | URL guard tests, visual smoke |
| FB-1.9 | Non-prod deploy + live smoke | smoke evidence in PR |

- **FB-1.1 — Zod schemas + publish.** `packages/shared-types/src/schemas/academics/family.schema.ts`: `familyResponseSchema`, `createFamilySchema`, `familyMemberSchema`, `addFamilyMemberSchema`, `studentFamilyViewSchema`. One shared-types bump + pin bumps in this PR (agreement schemas ship in FB-2.1 — no consumer-less stubs).
  *Tests:* valid/invalid payloads, max lengths, uuid formats.
- **FB-1.2 — Entities + factories.** `family.entity.ts` per design §3.1 (family row + member row) with factories emitting exact PK/SK/GSI keys; update `docs/pilot-greenlight/gsi-inventory.md` (`FAMILY#` gsi1sk prefix; `FAMILY#` gsi2sk prefix on bare-studentId gsi2pk).
  *Tests:* factory tests pinning every key string, incl. assertion that gsi2pk is the bare studentId (documented academics convention, §4.5).
- **FB-1.3 — FamiliesService: create/get/list/update/deactivate.** School-scoped list via GSI1; soft-delete via `isActive` (never emitted in response DTOs, P1d).
  *Tests:* mocked-DDB unit tests incl. tenant/school scoping of every query.
- **FB-1.4 — Link/unlink with single-family invariant.** GSI2 pre-check + `ConditionExpression: attribute_not_exists` put on the member row; unlink deletes; audit entries both ways; denormalized `studentName` fetched at link time. (Residual race is acceptable here — a transient double-link has no financial consequence and is operator-repairable; contrast agreements, FB-3.5.)
  *Tests:* second-family link → 409; conditional-write failure mapping; unlink idempotency.
- **FB-1.5 — Student family view.** GSI2 lookup → family → member list excluding subject; 200 with `family: null` when unlinked (not 404).
  *Tests:* linked/unlinked/deactivated-family; withdrawn-member shape.
- **FB-1.6 — Controller + guards + wiring.** New `FamiliesModule`; `@RequirePermission` on existing `students:view/edit` actions; feature-flag guard; **wiring-spec watchlist updated same PR**.
- **FB-1.7 — API GW registration.** All family routes into `tenant-api-prod.json`; `npm run lint:routes`; `cdk diff shared-infra-stack` shows only the new routes.
- **FB-1.8 — *(FE)* Family panel.** Trace route → component before editing (house rule). Panel: current family + siblings, link (search-or-create), unlink. New `families.service.ts` with URL guard tests pinning exact apiGet/apiPost paths; react-query invalidation (no polling).
  *Validation:* guard tests + `npm run dev:shell` visual smoke (screenshot in PR).
- **FB-1.9 — Non-prod deploy + live smoke.** shared-infra (routes) → academics ECR/ECS; smoke: create family, link two students, sibling query returns.

## Sprint FB-2 — BillingAgreement CRUD (finance, draft-only)

**Sprint goal:** draft, view, edit, cancel agreements with full validation and audit; **activation deliberately blocked** until the generation guard exists (risk R6).
**Sprint demo:** draft NPR 40,000 / 2-children / tuition+admission agreement end-to-end in the UI; validation and audit visible; activation provably 409s.

| ID | Task | Validation |
|---|---|---|
| FB-2.0 | RBAC review checkpoint | decision recorded; role changes as own PR |
| FB-2.1 | Agreement Zod schemas + publish | superRefine branch tests |
| FB-2.2 | Agreement/pointer/lock entities + factories | key-pinning tests, gsi-inventory |
| FB-2.3 | Create (draft) + get + list | validation-path tests |
| FB-2.4 | Draft update + cancel | transition matrix, transact tests |
| FB-2.5 | Advisory overlap detection | overlap matrix tests |
| FB-2.6 | Controller + routes + audit | wiring spec, route linter |
| FB-2.7 | Integration test: lifecycle transactWrite | local-DDB suite green |
| FB-2.8 | *(FE)* Agreements list + detail | URL guard tests, screenshot |
| FB-2.9 | *(FE)* Agreement create wizard | URL guard tests, screenshot |
| FB-2.10 | Non-prod deploy + live smoke | smoke evidence in PR |

- **FB-2.0 — RBAC + PR-CA reconciliation checkpoint** *(risks R9, R10)*. ✅ **DECIDED with the owner, 2026-07-04 — recorded before any FB-2 code was written:**
  - **(a) PR-CA reconciliation — RESOLVED: FB subsumes PR-CA.** One `BillingAgreement` entity ships under EPIC-FB; PR-CA's per-student scope is exactly the `per_student` agreement type with a single student and no `familyId`. All PR-CA locked conventions adopted (`feeOverrideMode`, `agreementId`/`agreementVersion` snapshots, version-in-body optimistic concurrency, generation hook before the gradeLevel snapshot block). No `StudentFeeAgreement` entity is ever created; the PR-CA plan's CA.* tickets are satisfied by FB-2/FB-3 deliverables.
  - **(b) RBAC — RESOLVED: ALL agreement operations require `billing:manage`** (owner chose stricter than the tiered option): draft CRUD, listing/detail, activation, cancellation, and the `overrideAgreement` bypass are all `billing:manage`-gated; `billing:view` alone does NOT expose agreement terms. Rationale: negotiated pricing is sensitive. No permission-registry change needed. The VicePrincipal `billing:*` default-grant question (R9) stays flagged — no role-grant changes ride the implementation PR.
- **FB-2.1 — Zod schemas + publish.** `billing-agreement.schema.ts` per design §3.2: response/create/update, terms discriminated union (`fixed_total` | `per_student`), superRefine invariants (allocation sums to total; lines reference member students; ≤30 students; term-date ordering). Bump + pins.
  *Tests:* every superRefine branch.
- **FB-2.2 — Entities + factories: agreement, member pointer, activation lock.** Exact key shapes per §3.2 (status + effectiveTo duplicated into pointer gsi2sk; lock row with TTL = effectiveTo + grace). gsi-inventory updated (`AGREEMENT#` prefixes).
  *Tests:* key pinning incl. assertion that all finance GSI pks carry `TENANT#{tid}` prefix (risk R1).
- **FB-2.3 — Create (draft) + get + list.** Validates: school exists, currency match, term dates, every studentId enrolled (academics HTTP client), optional familyId membership. Pointer rows written at create (status `draft`). GSI1 list with status filter.
  *Tests:* every rejection path; tenant scoping; academics client mocked.
- **FB-2.4 — Draft update + cancel.** Draft edits in place (financial fields included — drafts are cheap); `draft → cancelled` + statusHistory; pointer sync in same transactWrite. Active-agreement editing guarded `NotImplemented` until FB-3.6.
  *Tests:* transition matrix; transact composition; guard test.
- **FB-2.5 — Advisory overlap detection.** At draft-create: GSI2 per member student, overlapping windows → 409 with conflicting id. Advisory only — **binding** enforcement is the activation lock (FB-3.5); documented as such in code.
  *Tests:* overlap matrix (touching/containing/disjoint); multi-student conflicts.
- **FB-2.6 — Controller + module + routes + audit.** `AgreementsModule` under `/finance/schools/{sid}/agreements` (+ `GET /finance/students/{studentId}/agreements`); `billing:view/create/edit` guards per FB-2.0; wiring spec; API GW rows; route linter; audit events (`AGREEMENT_CREATED/UPDATED/CANCELLED`) + EventBridge events.
- **FB-2.7 — Integration test: lifecycle transactWrite.** In `server/application/test/integration/`: create → cancel against local DynamoDB; agreement + pointer rows move atomically; lock rows never exist for drafts.
- **FB-2.8 — *(FE)* List + detail.** "Agreements" nav item (Configuration group), status-filtered list, detail with terms + statusHistory.
- **FB-2.9 — *(FE)* Create wizard.** Pick family (FB-1.5 API) → members auto-populate → terms with live allocation-sum validation → review + create (draft).
- **FB-2.10 — Non-prod deploy + live smoke.** Draft agreement for the FB-1 family; bad allocation rejected; cancel; audit complete; activation endpoint 409s.

## Sprint FB-3 — Agreement-aware invoice generation

**Sprint goal:** activation changes what generation produces on **all three paths**, with provenance, guards, and byte-identical no-agreement behavior.
**Sprint demo:** activate the FB-2 agreement; bulk-generate — covered siblings priced by agreement with visible provenance; standard tuition invoice for a covered child blocked with a clear message; a re-enrollment auto-invoice respects the agreement.

| ID | Task | Validation |
|---|---|---|
| FB-3.1 | AgreementResolverService (date-bounded) | stale-pointer + boundary tests |
| FB-3.2 | Invoice/line provenance fields | back-compat fixture tests |
| FB-3.3 | `generate()` suppression + replacement | golden no-agreement test |
| FB-3.4 | Coexistence guard + `billing:manage` override | guard/permission/audit tests |
| FB-3.5 | Activation: locks + invoice-conflict check + expiry | lock-contention tests |
| FB-3.6 | Versioning of active agreements | version-chain tests |
| FB-3.7 | Bulk preview + generate | mixed-coverage worker tests |
| FB-3.8 | Enrollment webhook path | integration tests |
| FB-3.9 | Flag-off rollback semantics | flag-off suite |
| FB-3.10 | *(FE)* Generation surfaces | URL guard tests, 3-state smoke |
| FB-3.11 | Non-prod deploy + live smoke (exit gate incl. webhook) | smoke evidence in PR |

- **FB-3.1 — AgreementResolverService.** `getActiveAgreementForStudent(studentId, schoolId, onDate)`: GSI2 query `gsi2pk = TENANT#{tid}#STUDENT#{sid} AND gsi2sk > 'AGREEMENT#active#{onDate}'`, then verify `effectiveFrom ≤ onDate` on the hydrated agreement — **pointer status is never trusted alone**. In-request memoization for bulk.
  *Tests:* status/date boundaries; **stale-active pointer past effectiveTo returns nothing**; tenant-prefix assertion on constructed keys.
- **FB-3.2 — Provenance fields.** `agreementId?` (invoice header), line `agreementId?/agreementVersion?`, `suppressedFeeStructureIds[]?` on entity + response schema (bump + pins).
  *Tests:* real pre-change live invoice JSON still parses; absent fields omitted from responses.
- **FB-3.3 — Suppression + replacement in `generate()`.** Design §3.3 steps 1–3+5, single-invoice path: covered feeTypes suppressed, replaced by agreement lines (amount from allocation/lines; description `"{title} (family agreement)"`); non-covered feeTypes bill normally on the same invoice.
  *Tests:* covered/uncovered mixes; fixed_total vs per_student; agreement + custom lines; **golden test — zero agreements ⇒ output deep-equals pre-change output**.
- **FB-3.4 — Coexistence guard + override.** Requesting a covered standard fee without `overrideAgreement: true` → `409 AGREEMENT_ACTIVE` (agreement id in payload). Override requires **`billing:manage`** (pricing bypass, not `billing:create`) and emits `AGREEMENT_BYPASSED` audit event.
- **FB-3.5 — Activation.** `draft → active` unlocked. One transactWrite: status update + pointer sync + per-student `AGREEMENT_ACTIVE_LOCK#{schoolId}#{studentId}` conditional puts (repo lock-entity pattern per `EXTERNAL_EXAM_SYMBOL_LOCK`, `ecs-dynamodb.ts:224-234`) — a second agreement activating for any same student **fails atomically**. Plus **existing-invoice conflict check**: open standard invoices covering coveredFeeTypes in-term are listed to the operator (resolve via cancel/credit note). Cancel/expire deletes locks; TTL is the backstop; lazy `active → expired` display flip on reads (no background job — avoids the system-client footgun).
  *Tests:* lock contention; conflict listing; lock cleanup on cancel; TTL attribute; lazy-expiry read.
- **FB-3.6 — Versioning of active agreements.** Financial-term change → new version + supersede, atomic incl. pointer + lock re-targeting; invoices pin `agreementVersion`.
  *Tests:* version chain; in-flight invoice retains old version reference.
- **FB-3.7 — Bulk paths.** `bulk-preview` adds per-student `billingSource: 'standard' | 'agreement' | 'mixed'`; bulk worker routes each student through the memoized resolver; async job path covered.
- **FB-3.8 — Enrollment webhook path** *(risk R3 — the highest-risk integration point)*. Suppression in `enrollment-billing.service`; auto-issued invoices carry agreement lines; enrollmentId idempotency unchanged.
  *Tests:* integration — covered student enrolls → agreement-priced auto-invoice.
- **FB-3.9 — Flag-off rollback** *(risk R6)*. `BILLING_AGREEMENTS_ENABLED=false` ⇒ agreement routes 404, resolver hook inert, **issued agreement-priced invoices remain valid/readable/payable**.
  *Tests:* suite pinning all three behaviors.
- **FB-3.10 — *(FE)* Generation surfaces.** Wizard + bulk preview show agreement badges/billingSource; 409 surfaced with agreement link + explicit override confirmation; invoice detail renders "Priced by agreement: {title} v{n}".
- **FB-3.11 — Non-prod deploy + live smoke (sprint exit gate).** MUST include the webhook path: enroll a covered student on the dev tenant → auto-invoice agreement-priced; plus mixed-coverage bulk run and a blocked-then-overridden manual generation.

## Sprint FB-4 — Family payments (multi-invoice settlement)

**Sprint goal:** one recorded payment settles multiple invoices across siblings with correct ledgers, receipts, and balances.
**Sprint demo:** one NPR 25,000 cheque settles two siblings' invoices (one fully, one partially); both ledgers and the receipt show the split; single-invoice payments byte-identical to before.

| ID | Task | Validation |
|---|---|---|
| FB-4.0 | Prerequisite re-check (FB-0.1) | regression suite green |
| FB-4.1 | Payment identity & keying for multi-target | representation superRefine + fixture tests |
| FB-4.2 | Widen `applications[]` | superRefine matrix |
| FB-4.3 | Allocation planner | property-style tests |
| FB-4.4 | Multi-target transactWrite path | composition + atomicity tests |
| FB-4.5 | Consumer sweep (receipt/void/refund/mappers) | single- + multi-target fixtures, PDF snapshot |
| FB-4.6 | Family open-invoices endpoint | controller/service tests, route linter |
| FB-4.7 | Integration test: multi-target settlement | local-DDB suite green |
| FB-4.8 | *(FE)* Record Payment family mode | URL guard tests, visual smoke |
| FB-4.9 | Non-prod deploy + live smoke | smoke evidence in PR |

- **FB-4.0 — Prerequisite.** FB-0.1 regression suite green — family payments multiply partial states.
- **FB-4.1 — Payment identity & keying (design-critical, §3.4 pt 2).** Today `invoiceId`/`studentAccountId` are **required** on the payment and GSI2 keys it to one student (`payment.entity.ts:198`) — multi-target is *not* a schema widening. Change: top-level `invoiceId`/`studentAccountId` nullable with a superRefine tying null ⟺ >1 invoice application; optional `familyId` stamped for reporting; **GSI2 stays single-student-or-absent** — per-student visibility for family payments flows through **ledger entries** (each student's ledger already records its share referencing the paymentId; that is the system of record for per-student money movement). Bump + pins + gsi-inventory note.
  *Tests:* representation-consistency matrix; back-compat fixture of a real single-target live payment row.
- **FB-4.2 — Widen `applications[]`.** N distinct invoice targets (same school + currency), cap 20 (transactWrite ceiling ~3 items/target), generalized ordering (invoice entries by due date then invoiceNumber; opening-balance entry last), sum-within-1-cent kept.
  *Tests:* dup targets, cross-currency, sum drift, cap, ordering violations.
- **FB-4.3 — Allocation planner.** Pure function: (amount, openInvoices[], strategy oldest-due-first | explicit) → applications[]; unallocatable remainder rejected (same no-credit-memo rule as today).
  *Tests:* property-style — allocations always sum; never exceed per-target amountDue; deterministic ordering incl. invoiceNumber tie-break.
- **FB-4.4 — Multi-target write path.** `recordManualPayment`: payment put + N invoice updates + per-application ledger entries + M account updates via `buildCompositeLedgerTransactItems` in one transactWrite; chronology guard per account.
  *Tests:* composition; partial/full mixes; atomicity on mocked transact rejection.
- **FB-4.5 — Consumer sweep (§3.4 pt 3).** Receipt JSON/PDF, void, refund, every mapper reading `payment.invoiceId` handles null/multi; receipt shows per-invoice breakdown.
- **FB-4.6 — Family open-invoices endpoint.** `GET /finance/schools/{sid}/families/{familyId}/open-invoices` — members via academics API, open invoices + suggested allocation. API GW row.
  *Tests:* incl. cross-school member exclusion.
- **FB-4.7 — Integration test.** One payment over 3 invoices / 2 students: invoice statuses, both ledgers, both account balances, receipt payload asserted against local DDB.
- **FB-4.8 — *(FE)* Family mode.** "Pay for family" tab: pick family → open invoices with suggested allocation → editable per-invoice amounts with live sum check.
- **FB-4.9 — Non-prod deploy + live smoke.** The sprint-demo scenario, executed live.

## Sprint FB-5 — Sibling discounts, reporting & traceability

**Sprint goal:** the dormant sibling discount works from real family data; family-level financials and full invoice provenance are operator-visible.
**Sprint demo:** "2+ siblings → 10% tuition discount" auto-applies to a linked family at generation; family summary shows consolidated outstanding; any invoice explains itself down to rule/agreement versions.

| ID | Task | Validation |
|---|---|---|
| FB-5.1 | Sibling-count resolution in finance | family/none/deactivated tests |
| FB-5.2 | `sibling` discount-rule evaluator | rule matrix + precedence tests |
| FB-5.3 | Family financial rollup endpoint | aggregation tests |
| FB-5.4 | Invoice "why" trace + *(FE)* panel | trace composition tests |
| FB-5.5 | Dashboard coverage tile + billingSource filter *(FE)* | aggregation + guard tests |
| FB-5.6 | Operator runbook + rollout kit | runbook executed on dev tenant |
| FB-5.7 | Non-prod deploy + live smoke | smoke evidence in PR |

- **FB-5.1 — Sibling-count resolution.** Finance helper calling `GET /academics/students/{id}/family` (HTTP, not DDB — no IAM grant needed) with per-request caching; returns active-enrolled sibling count.
- **FB-5.2 — Sibling rule evaluator** *(live finding L5)*. At generation: active sibling rules evaluate via FB-5.1 (`count >= minSiblings` → percentage/fixed on applicable feeTypes, `maxDiscountAmount`, priority ordering); discount lines carry new optional `discountRuleId` provenance. **Precedence documented + tested: agreement > discount rule > manual discount** (agreement-covered feeTypes exempt from rules).
- **FB-5.3 — Family rollup.** `GET /finance/schools/{sid}/families/{familyId}/summary` — computed read-side: member balances, open invoices, agreement status, last payments. No new materialized state.
  *Tests:* incl. member with no billing account.
- **FB-5.4 — Invoice "why" trace.** `GET …/invoices/{id}/provenance`: each line resolved to source (fee-structure version / agreement version / discount rule / custom) + suppressions + any `AGREEMENT_BYPASSED` audit event. *(FE)* "How was this calculated?" panel on invoice detail.
- **FB-5.5 — Dashboard.** Summary adds `agreementCoverage {studentsCovered, activeAgreements, invoicedViaAgreement}`; invoices list gains `billingSource` filter; *(FE)* tiles.
- **FB-5.6 — Operator runbook.** `docs/family-billing/operator-runbook.md`: linking existing pilot students into families (manual, UI-driven — no data migration; no family data exists), agreement rollout checklist, precedence rules table, flag-off rollback procedure. Executed once end-to-end on the dev tenant; results recorded.
- **FB-5.7 — Non-prod deploy + live smoke.** Sibling rule auto-applies; family summary consolidates; provenance trace answers "why" for agreement-priced, discounted, and overridden invoices.

## Task-count summary

| Sprint | Tasks | Theme |
|---|---|---|
| FB-0 | 5 | Findings remediation + flags |
| FB-1 | 9 | Family groups in academics |
| FB-2 | 10 | Agreements CRUD (draft-only) + RBAC checkpoint |
| FB-3 | 11 | Agreement-aware generation + activation locks |
| FB-4 | 9 | Multi-invoice family payments |
| FB-5 | 7 | Sibling discounts + reporting + trace |
| **Total** | **51** | |

---

# 3. Design Reference

## 3.0 Placement decisions

- **FamilyGroup lives in academics** (people domain owns relationships; students/guardians are already there). Finance never reads the academics table directly (cross-service DDB IAM trap, CLAUDE.md) — it resolves families via the academics API and **snapshots** what it needs.
- **BillingAgreement lives in finance** as a new module inside the existing finance service (not a new service): it participates in invoice generation transactions, shares the sequence/audit/event plumbing, and a separate service would need cross-table transactions DDB can't provide.
- **No new GSIs required** for either entity. Verified: academics and finance are separate tables from the same construct (`tenant-template-stack.ts:522`), both with a GSI2 slot (`ProjectionType.ALL`); the proposed key shapes match each table's existing GSI2 convention (bare `studentId` in academics; `TENANT#{tid}#STUDENT#{sid}` in finance), and **every existing GSI2 query in both services uses a sort-key `begins_with` condition** (`INVOICE`, `CREDIT_NOTE`, `ENROLLMENT#`, `SEC_ENROLL#`, attendance ranges), so new `FAMILY#` / `AGREEMENT#` sk-prefixed rows cannot leak into existing reads. This avoids the one-GSI-per-deploy constraint entirely.
- **No changes to the Student or Guardian entities.** Family membership is standalone rows; the student record is untouched (field-governance and Ed-Fi mapping unaffected). The one adjacent cleanup candidate is the guardian `userId` schema/entity divergence (§4.4), needed only if/when agreements surface in the parent portal.
- **Alignment with PR-CA (prior art, §1.1).** The PR-CA plan independently validated the same structural choices — same finance table, GSI1 (school-scope) + GSI2 (student-scope) reuse, no new GSI, one extra `GetItem` per invoice at generation. EPIC-FB adopts its locked conventions verbatim: `feeOverrideMode: 'catalog' | 'agreement'` on the invoice, snapshotted `agreementId`/`agreementVersion` (so a later void/supersede never orphans invoice provenance), `status` + `isActive` as orthogonal axes with `isActive` omitted from response DTOs (P1d), optimistic-concurrency `version` in the PATCH body, and the generation hook placed **before** the `gradeLevel` snapshot block (`invoices.service.ts:178-260`) so snapshot logic runs on the agreement path too. Whether the entity ships under PR-CA's name first or as `BillingAgreement` directly is the FB-2.0 decision — the schema is designed so PR-CA's per-student shape is exactly FB's `per_student` type with `studentIds = [one]` and no `familyId`.

## 3.1 FamilyGroup (academics table)

```
Family row:        PK tenantId   SK FAMILY#{familyId}
  familyId, name ("Adhikari family"), primaryContact {name, phone?, email?},
  notes?, isActive, createdBy, timestamps
  gsi1pk TENANT#{tid}#SCHOOL#{schoolId}   gsi1sk FAMILY#{NAME}     ← school-scoped listing

Member row:        PK tenantId   SK FAMILY_MEMBER#{familyId}#{studentId}
  familyId, studentId, studentName (denorm), relationshipNote?, addedBy, timestamps
  gsi2pk {studentId}             gsi2sk FAMILY#{familyId}          ← "family for student X"
                                   (bare studentId matches the academics GSI2 convention —
                                    enrollment rows already use it; isolation caveat in §4.5 applies)
```

- **Invariant (V1): a student belongs to at most one family.** GSI2 pre-check + conditional put; residual race acceptable for operator-driven linking (no financial consequence; repairable) and covered by an integrity check in tests.
- V1 scope: same-school families only (matches the school-scoped operator UI); the model doesn't preclude cross-school later.
- API (all under existing `/academics` prefix → no new nginx block; API GW spec rows still required): families CRUD, member link/unlink, `GET /academics/students/{studentId}/family`.

## 3.2 BillingAgreement (finance table)

```
Agreement row:     PK tenantId   SK AGREEMENT#{schoolId}#{agreementId}
  agreementId, schoolId, familyId? (academics ref), title,
  payer {name, phone?, email?},                                ← snapshot, not FK
  studentIds[] (snapshot at activation; revalidated at invoice time),
  agreementType: 'fixed_total' | 'per_student'                  (V1)
  terms:
    fixed_total  → { totalAmount, allocation: [{studentId, amount}] }   (allocation must sum to total)
    per_student  → { lines: [{studentId, feeType?, feeStructureId?, amount}] }
  coveredFeeTypes[]  ← which standard feeTypes this agreement REPLACES (others still bill normally,
                        e.g. agreement covers tuition+admission, transport still per-standard-fees)
  billingFrequency, currency, effectiveFrom, effectiveTo (AD ISO; BS is display-only),
  status: draft → active → expired | cancelled   (+ superseded via versioning),
  version, versionParentId (financial-term changes on an ACTIVE agreement create a new
  version and supersede the old, atomically — mirrors fee-structure versioning),
  approvedBy?, notes, createdBy, statusHistory[]
  gsi1pk TENANT#{tid}#SCHOOL#{sid}   gsi1sk AGREEMENT#{status}#{effectiveFrom}

Member pointer:    PK tenantId   SK AGREEMENT_MEMBER#{schoolId}#{studentId}#{agreementId}
  gsi2pk TENANT#{tid}#STUDENT#{studentId}   gsi2sk AGREEMENT#{status}#{effectiveTo}
                                              ← "agreement for student" at invoice time

Activation lock:   PK tenantId   SK AGREEMENT_ACTIVE_LOCK#{schoolId}#{studentId}
  agreementId, effectiveTo, ttl (= effectiveTo + grace, DDB TTL auto-clears)
```

- **Overlap enforcement is the lock row, not query-then-write.** Activation is one transactWrite: agreement status update + pointer sync + one `Put … ConditionExpression: attribute_not_exists(entityKey)` lock per member student — a second agreement activating for the same student fails atomically. Cancel/expire deletes locks (TTL backstop). Follows the repo's lock-entity pattern (`EXTERNAL_EXAM_SYMBOL_LOCK`, `ecs-dynamodb.ts:224-234`); a conditional put on the pointer row cannot block a *different* agreementId, and query-then-write races.
- **Expiry semantics:** no background job. The resolver is date-bounded and never trusts pointer status alone (§3.3), so a stale `active` pointer past `effectiveTo` is harmless for billing; agreement reads lazily flip display status; lock TTL clears the constraint.
- **Validation at create/activate:** students enrolled (academics API), amounts > 0 + allocation sums, term-date ordering, currency match, ≤30 students; at **activation** additionally: lock acquisition + **existing-invoice conflict check** (open standard invoices covering coveredFeeTypes in-term listed to the operator — resolve via cancel or credit note; warning-with-listing, not silent).
- If `familyId` is provided, membership is validated at activation but **the agreement owns its studentIds snapshot** — later family edits never silently change billing.

**Asked-for access patterns, answered explicitly:**
- *"All agreements for parent X":* no dedicated index in V1 — `payer` is a snapshot, not an FK. Resolution: family → member students (academics API) → GSI2 pointer per student (bounded ≤30). A payer-user-scoped index only becomes necessary if agreements surface in the parent portal (deprioritized); deferring loses nothing.
- *"All active agreements for tenant":* school-scoped in V1 (GSI1), matching the school-scoped operator UI everywhere else in finance; tenant-wide = iterate the tenant's schools (BASIC tenants have single-digit school counts). Explicit descope, not an oversight.

## 3.3 Invoice-generation integration

`AgreementResolverService.getActiveAgreementForStudent(studentId, schoolId, onDate)` → GSI2 query with **date-bounded key condition** (`gsi2sk > 'AGREEMENT#active#{onDate}'`) + `effectiveFrom` verification on the hydrated agreement.

Hook order in `generate()` — and identically in the bulk worker and the **enrollment webhook** (all three paths):

1. Resolve active agreement for student/date.
2. None → unchanged standard path (**byte-identical when no agreements exist** — the backward-compat contract, pinned by a golden test).
3. Agreement → requested fee structures with `feeType ∈ coveredFeeTypes` are **suppressed**, replaced by agreement lines (`lineItem.agreementId` + `agreementVersion`; description `"{title} (family agreement)"`). Non-covered feeTypes bill normally on the same invoice.
4. **Coexistence guard:** covered standard fee without `overrideAgreement: true` → `409 AGREEMENT_ACTIVE`. Override gated by **`billing:manage`**; emits `AGREEMENT_BYPASSED` audit event. Block-by-default prevents silent double-billing; the escape hatch handles legitimate exceptions.
5. Invoice gains optional `agreementId`; lines gain `agreementId`/`agreementVersion` + `suppressedFeeStructureIds[]` provenance.

Enrollment webhook: auto-apply fees filter through the same suppression; auto-issued invoice carries agreement lines; enrollmentId idempotency unchanged. `bulk-preview` returns per-student `billingSource: 'standard' | 'agreement' | 'mixed'`.

## 3.4 Payments & family-level settlement

Invoices remain **per-student** (statements, IEMIS, Ed-Fi, and the ledger all key on student) — agreements change *amounts*, not *structure*. Family settlement = the already-deferred **multi-invoice payment split**, which is **not** schema-widening-only; three coupled decisions:

1. **`applications[]` relaxation:** N invoice entries (distinct open invoices, same school + currency), sum-within-tolerance kept; ordering generalizes to "invoice entries first, by due date then invoiceNumber; opening-balance last". Existing rows (0/1 invoice entries) remain valid.
2. **Payment-row identity:** today's required single `invoiceId`/`studentAccountId` + single-student `gsi2pk` (`payment.entity.ts:198`) can't represent multi-student payments. Fix: nullable top-level ids (null ⟺ multi-target, superRefine-tied), optional `familyId` for reporting, **GSI2 single-student-or-absent** — per-student visibility flows through ledger entries (already the per-student system of record). School-scoped lists (GSI1) show family payments normally.
3. **Consumer sweep:** receipt JSON/PDF, void, refund, and every mapper reading `payment.invoiceId` must handle null/multi — an explicit task (FB-4.5), not a side effect.

Allocation planner: (amount, target invoices, oldest-due-first | explicit) → applications[]; same overpayment rejection as today. One transactWrite: payment + N invoice updates + N+ ledger entries + M account updates; N ≤ 20 (100-item ceiling). Payment application logic changes; invoice structure does not.

## 3.5 Deliberately not built in V1

Household-level billing accounts / family ledger (rollups computed read-side) · cross-school/cross-tenant families · `discount_percent` agreement type (discount rules already model percentages; agreements are for negotiated amounts) · payer-scoped or tenant-wide agreement indexes (§3.2) · recurring/scheduled invoice generation (pre-existing orthogonal gap) · parent-portal agreement visibility (portals deprioritized; would also require the guardian `userId` schema extension, §4.4).

## 3.6 Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | **GSI tenant isolation is application-layer only** — finance prefixes `TENANT#{tid}`; academics uses bare-UUID keys (isolation = unguessability). The TVM client does NOT protect GSI queries. | Agreement pointer queries keep the finance prefix convention; FAMILY_MEMBER rows inherit the academics convention as accepted residual risk; both get spec coverage asserting constructed key prefixes (FB-1.2, FB-2.2, FB-3.1). |
| R2 | **Cross-service consistency (family ↔ agreement)** — no distributed transaction between academics and finance. | Agreements snapshot `studentIds`; membership revalidated only at activation; family edits never mutate agreements. |
| R3 | **Enrollment-webhook bypass** — suppression only on the manual path would full-price-bill covered students on re-enrollment. | FB-3.8 dedicated task + webhook live smoke as the FB-3 exit gate (FB-3.11). |
| R4 | **Payment-schema backward compatibility** — nullable ids + widened applications[] must not break receipts, ledger builder, void/refund, or pinned consumers. | Coordinated shared-types bump + pins in one PR; back-compat fixtures from real pre-change rows (FB-4.1/4.2/4.5). |
| R5 | **Status-machine lossiness (L2)** — sweep intentionally erases `partially_paid`; family payments multiply partials. | Fixed **before** FB-4 via derived `isOverdue` read-side flag (FB-0.1) — the only option preserving both signals. |
| R6 | **Double-billing during rollout.** | FB-2 is draft-only by construction; activation ships with the guard (FB-3); activation checks already-issued conflicting invoices (FB-3.5); flag-off rollback pinned by test (FB-3.9). |
| R7 | **Draft bloat (L3)** confuses agreement-aware regeneration. | Cleanup/expiry policy ships first (FB-0.3). |
| R8 | **DDB transactWrite ceilings.** | ≤20 payment targets, ≤30 students/agreement — bounds live in the Zod schemas, not just service code. |
| R9 | **RBAC surface** — `billing` registry needs no change, but VicePrincipal holds `billing:*` by default (`role-assignment.entity.ts:161`, UNVERIFIED flag) while agreements introduce negotiated pricing. | FB-2.0 hard checkpoint: role-grant review + decision recorded before agreements ship; `overrideAgreement` gated by `billing:manage`. |
| R10 | **Two competing agreement designs** — PR-CA (`StudentFeeAgreement`, per-student, locked pilot non-negotiable) and EPIC-FB (`BillingAgreement`, family-level) describe the same concept at different scopes; implementing both would fork provenance, guards, and operator mental models. | One-entity rule enforced at FB-2.0: reconciliation decision with the owner before any FB-2 code; FB adopts PR-CA's locked conventions (§3.0) so either sequencing converges on the same schema. |

---

# 4. Audit Evidence (current state & gaps)

## 4.1 Fee structures & application logic

**Where the logic lives.** Finance NestJS microservice: `server/application/microservices/finance/src/fee-structures/` (service + controller), contract schemas in `packages/shared-types/src/schemas/finance/fee-structure.schema.ts`, DDB entity in `finance/src/common/entities/fee-structure.entity.ts`.

**Data model.** DDB single-table (`edforge-finance-<tier>`), PK = bare `tenantId`, SK = `FEE_STRUCTURE#{schoolId}#{feeStructureId}`; school-scoped listing via GSI1 (`gsi1pk = TENANT#{tid}#SCHOOL#{sid}`, `gsi1sk = FEE_STRUCTURE#{feeType}#{NAME}`). Key fields (fee-structure.entity.ts:21-50): `feeType` (tuition, admission, exam, transport, library, lab, hostel, uniform, miscellaneous, custom), `amount`, `currency`, `taxRate`/`taxType`, `frequency` (one_time, monthly, quarterly, annual), `gradeLevels[]`, **`autoApplyOnEnrollment`**, `proRateOnMidTermEntry`, `effectiveFrom/To`, `dueDateRule` (days_after_enrollment | fixed_day_of_month | on_enrollment), `enrollmentTypes[]`.

- **Versioning:** changes to `amount`/`taxRate`/`taxType` create a new entity and deactivate the old atomically via transactWrite (fee-structures.service.ts:243-327); non-financial edits in-place; version-history endpoint exists.
- **Grade-level overrides:** `templateParentId` + `isOverride`; `getApplicableFee()` (fee-structures.service.ts:543-572) resolves child-before-parent. **The only "override" mechanism today — grade-scoped, not student- or family-scoped.**

**Fee determination at enrollment — two paths:**
1. **Enrollment-triggered:** academics emits enrollment events (`packages/shared-types/src/events/enrollment-billing.events.ts`) → finance `enrollment-webhook.controller.ts` → `enrollment-billing.service.ts:51-122`: billing account create/get, `enrollmentId` idempotency, fetch `autoApplyOnEnrollment=true` fees matching grade + enrollment type, mid-term pro-rating, then `invoicesService.generate()` with **`autoIssue: true`** (~line 176).
2. **Operator-driven:** `feeStructureIds[]` picked in the Generate wizard (single POST; bulk preview + generate with `selectionMode: 'students' | 'grades'`).

Fees are **calculated at invoice time** — nothing is attached to the student between enrollment and invoicing.

**End-to-end example (verified live).** School `4209e3d8…` (`DPPSW`) has 7 fee structures (Admission NPR 20,000 one_time auto-apply; Transport NPR 900 monthly; grade-scoped tuition). Live invoice `INV-420-2605-0585`: three line items each pinning `feeStructureId` + `feeStructureVersion` with per-line amount/discount/tax/total; invoice-level subtotal/taxTotal/discountTotal/grandTotal; `taxSummary[]`; denormalized `gradeLevel` snapshot; full `statusHistory[]` (draft → issued → overdue → paid, with actor IDs).

## 4.2 Invoice generation

**Triggers:** enrollment webhook (auto-issue), manual single, bulk (>25 students auto-promotes to async job, 202 + jobId, polled at `GET /finance/jobs/{jobId}`). **No scheduled/recurring generation** — monthly/quarterly `frequency` is metadata the operator acts on manually.

**Line items** (`invoices.service.ts:124-197`): one line per selected fee structure (qty 1, operator-supplied discount, per-line tax) + optional custom ad-hoc lines (`isCustom: true`, synthetic feeStructureId, no tax/discount). **Entity** (invoice.entity.ts:8-12, 203-208): SK `INVOICE#{schoolId}#{invoiceId}`; GSI1 `INVOICE#{status}#{dueDate}`; GSI2 `TENANT#{tid}#STUDENT#{sid}` / `INVOICE#{issuedDate}`; GSI3 `INVNUM#{invoiceNumber}`; GSI14 school+grade sparse. Statuses: `draft, issued, partially_paid, paid, overdue, cancelled, written_off` + statusHistory. **Numbering:** `INV-{schoolPrefix}-{YYMM}-{seq}`, atomic DDB counter per school-month (`sequence.service.ts`; bulk pre-reserves via `incrementSequenceBy`); verified live (`4209…` → `420`). **Due dates:** from `dueDateRule` (`due-date.util.ts`); stored AD/ISO, BS is a frontend projection.

**Dependencies:** fee-structures service, student-accounts service (account + ledger), sequence service, academics API over HTTP (`identity-client.service.ts:469,505,538` via `ACADEMICS_SERVICE_URL` — **no cross-service DDB reads**), FinanceEventsService (EventBridge), audit logger.

## 4.3 Payment application

**Recording** (`payments.service.ts:78-403`, manual): idempotency-key check → invoice validation → allocation planning: `toInvoice = min(payment, amountDue)`, `toOpening = min(remainder, openingBalanceRemaining)`; **leftover rejected (`PAYMENT_EXCEEDS_ALLOCATABLE`) — no credit memo in V1**. Recorded as discriminated `applications[]` (`payment.schema.ts:50-60`) with invariants: **≤1 invoice entry**, ≤1 opening-balance entry, **invoice entry first** (ledger ordering), sum within 1-cent tolerance.

**Write path:** one transactWrite — payment put (manual = `completed` immediately), invoice update, one append-only ledger entry per application (`buildCompositeLedgerTransactItems`, payments.service.ts:289), billing-account materialized-balance update.

**Capabilities:** partial payment **yes** (verified live: `INV-420-2605-0015` 20,000 total / 10,000 paid / 10,000 due). Overpayment/credit **no**. **One payment across multiple invoices/students: no** — schema caps at one invoice target, and the payment row itself is single-student (required top-level `invoiceId`/`studentAccountId`; GSI2 keys one student, `payment.entity.ts:198`); multi-splits were deferred to "V1.5". Gateways (eSewa, Khalti, …) via initiate/redirect/verify; refunds via a governed workflow.

**Student accounts:** `BILLING_ACCOUNT#{schoolId}#{studentId}` with materialized balance/totalPaid + opening-balance fields; `ACCOUNT#{accountId}` mirror row; append-only `LEDGER#{accountId}#{entryId}` (verified live: invoice debit + payment credit with running balance).

## 4.4 Student & parent data models

**Students** live in the **academics** table (`edforge-academics-<tier>`; academics and finance are **separate tables** from the same `EcsDynamoDB` construct, `tenant-template-stack.ts:522`), PK bare `tenantId`, SK `STUDENT#{studentId}` (`student.entity.ts:28-128`); GSI1 roster; sparse GSI7 EMIS lookup.

**Guardians are an embedded array on the student record** (min 1 / max 10 — `student.schema.ts:232`; shape at :126-143): names, relationship enum (`mother, father, guardian, grandparent, sibling, aunt, uncle, other`), contact fields, `isPrimary`, `canPickup`, `hasPortalAccess`. A `userId` link to the identity User exists **on the academics entity only** (`student.entity.ts:170`) — *not* in the shared-types API contract; reading `guardian.userId` through the API needs a schema extension first (divergence flagged as cleanup candidate). **No separate Guardian/Parent entity, no StudentParentAssociation** — a parent of three children is three independent embedded copies.

**Only cross-student parent linkage is incidental:** `createParentAccount` (identity `users.service.ts:1093-1160`) is idempotent on email → same Cognito userId. A login dedup, not a queryable relationship — and **live pilot data shows zero guardian emails/phones across 50 sampled students (44 with guardians)**. Sibling inference from existing data is not viable; explicit linking is required.

**Enrollment:** Ed-Fi-shaped entity (`ENROLLMENT#{schoolId}#{yearId}#{studentId}`) with grade, entry/exit dates, promotion tracking. Finance reads academics only via API/events; billing accounts created on demand in finance.

## 4.5 Tenant isolation

- **Main table:** request-scoped clients via token-vending machine (`dynamodb-client.service.ts:51-68`); IAM `dynamodb:LeadingKeys = ${aws:PrincipalTag/tenant}` (`ecs-dynamodb.ts:321-334`). Wrong-tenant main-table access fails at IAM.
- **GSIs have NO infrastructure-level tenant protection:** the GSI statement is an unconditioned `dynamodb:Query` on `index/*` (`ecs-dynamodb.ts:337-341`); LeadingKeys doesn't apply; the TVM client doesn't change that. Application conventions differ by table: **finance** consistently prefixes `TENANT#{tid}` (`GSIKeyBuilder.studentScope`, finance base.entity.ts:163); **academics does not** — enrollment/section-enrollment gsi2pk is a **bare studentId** (enrollment.entity.ts:163, section-enrollment.entity.ts:117), result-cards use `enrollment#{id}`. Isolation there rests on UUID unguessability + JWT-scoped query paths — accepted residual risk that new academics rows inherit.
- **System client** (`getSystemClient()`, ECS task role, background jobs) bypasses ABAC; must tenant-filter in code — standing footgun for new jobs.
- School scoping: `@RequirePermission(..., schoolIdParam)`; live negative probe of a nonexistent schoolId → clean 404.

## 4.6 Audit & events

`FinanceAuditService` (DDB rows + SIEM CloudWatch lines; queryable at `GET /finance/audit/bulk-export` — verified live incl. opening-balance events with operator/IP/UA). Operation audit: `FEE_STRUCTURE_CREATED/VERSIONED/UPDATED`, `DISCOUNT_RULE_CREATED`, opening-balance set/revised. EventBridge fire-and-forget: `InvoiceGenerated`, `InvoiceStatusChanged`, `PaymentCompleted`, `BillingAccountCreated`, fee-structure events. **Explainability gap:** lines pin fee-structure versions and discounts carry `discountReason`, but nothing links a discount/price to the *rule or agreement* that produced it.

## 4.7 Live-verification findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| L1 | Denormalized `schoolName` drifts after school rename (live invoice still says "Espresso English Academy"; school is "Scoggins Middle School"). | live GET invoice | Low (appears on legal documents) |
| L2 | **`partially_paid` intentionally transitioned back to `overdue`** — `overdue-detection.service.ts:66-93` queries both `INVOICE#issued` and `INVOICE#partially_paid`. Designed-but-lossy: one status field can't carry "past due" + "partially paid"; UI shows `partially_paid: 0` while 53 "overdue" include partials. Verified live: overdue → partially_paid → overdue (system, 43 min later). `amountPaid/amountDue` stay correct. | live statusHistory + code | Medium (compounds when family payments multiply partials) |
| L3 | Draft bloat: 1,190/1,265 invoices (94%) are `draft`; no lifecycle policy; dashboard "Total invoiced" includes drafts. | live dashboard | Medium (metric semantics) |
| L4 | Guardian data contact-empty in real usage — sibling inference has zero coverage. | live sample (50 students) | High for this epic |
| L5 | `sibling` discount condition exists in schema (`discount-rule.schema.ts:13`) with **no evaluator anywhere**. | code + live (0 rules) | Confirms gap |

## 4.8 Gap: family relationships

| Question | Answer |
|---|---|
| Two students marked as siblings? | **No.** The `sibling` enum value classifies *a guardian*, not student↔student links. No familyId/householdId/relationship rows anywhere (comprehensive grep). |
| One parent linked to multiple students? | Only implicit Cognito email dedup — and pilot data has no guardian emails, so in practice **no**. |
| Queryable family/household concept? | **Must be built.** Neither service can answer "students in family X". |

## 4.9 Gap: billing agreements

No `Agreement`/`Contract`/`Package`/`BillingPlan` concept exists **in code** (repo-wide grep, re-verified against `main` at #423). Nearest neighbors and why they fail: **fee-structure overrides** — grade-scoped, school-wide; **discount rules** — school-wide rules, `sibling` unimplemented, not negotiated amounts; **credit notes** — post-hoc, no term, manual; **custom line items** — one-off, no persistence/term/audit of the deal. **In planning**, PR-CA's `StudentFeeAgreement` (§1.1) covers the per-student case but has no family linkage, no multi-student terms, and no family settlement — the gaps this epic exists for.

## 4.10 Gap: override mechanism & reporting

`generate()` applies exactly what the caller passes — **no pre-generation hook consults any override source**, and the **enrollment webhook auto-issues** from `autoApplyOnEnrollment` fees, so a manual-path-only guard is bypassed on (re-)enrollment. Reporting: no rule-level provenance, no operator-facing "why" trace, no family-level rollups (per-student accounts can't express them).

---

# Appendix A — Live API verification log

Read-only GETs against `https://www.edforge.app/api` with a TenantAdmin JWT for tenant `dev-pabson-primary` (`21aea5da-…719f`), 2026-07-04:

- `GET /schools` → 3 schools; `4209e3d8…` (`DPPSW`) confirmed as the invoice-prefix `420` school.
- `GET /finance/schools/{sid}/fee-structures` → 7 structures (shapes matched entity audit).
- `GET …/invoices?limit=2`, `GET …/invoices/{id}` → line-item/provenance/statusHistory shapes verified; L1 + L2 observed.
- `GET …/payments?limit=1` → `applications[]` single-invoice breakdown verified live.
- `GET …/student-accounts`, `GET …/student-accounts/{id}/ledger` → materialized balances + append-only ledger verified.
- `GET …/dashboard/summary` → L3 (1,190 drafts) observed.
- `GET /finance/audit/bulk-export?limit=3` → audit trail live (opening-balance events with operator/IP/UA).
- `GET /academics/students?schoolId=…&limit=50` → guardian shape verified; L4 (zero guardian contacts) observed.
- Negative probe: invoices for a nonexistent schoolId → 404, clean school scoping.
- `GET …/discount-rules`, `GET …/credit-notes` → both empty (modules live, unused by pilot).

# Appendix B — Adversarial-review corrections applied

An independent review pass re-verified the draft's claims against source. Confirmed accurate: fee/invoice/payment/ledger mechanics, the enrollment auto-issue path, and — most load-bearing — the GSI-reuse design (both tables' GSI2 conventions and the sk-prefix non-pollution property verified query-by-query). Corrections it forced, all applied above:

1. **Isolation claims fixed (§4.5, R1):** academics GSI keys are *not* tenant-prefixed; GSIs have no LeadingKeys/ABAC protection anywhere; the TVM client does not protect GSI queries.
2. **Overlap enforcement redesigned (§3.2, FB-3.5):** query-then-write races and a pointer-row conditional can't block a different agreementId — replaced with the repo's lock-entity pattern (`AGREEMENT_ACTIVE_LOCK`).
3. **Sprint FB-4 was under-designed:** required `invoiceId`/`studentAccountId` + single-student GSI2 keying make multi-target payments more than a schema widening — added FB-4.1 (identity/keying) and FB-4.5 (consumer sweep); adopted ledger-entries-as-per-student-view.
4. **Lazy expiry vs pointer status contradiction resolved:** date-bounded resolver; stale-pointer tests (FB-3.1/FB-3.5).
5. **Asked-for access patterns answered explicitly (§3.2):** "agreements for parent X" and "active agreements for tenant" — designed or explicitly descoped with rationale.
6. **Activation-time existing-invoice conflict check added (§3.2, FB-3.5).**
7. **Guardian `userId` citation fixed (§4.4):** entity-only (`student.entity.ts:170`); max-10 at `student.schema.ts:232`.
8. **L2 reframed:** deliberate sweep behavior, not a bug — fix is the derived `isOverdue` read-side flag (FB-0.1), the only option preserving both signals.
9. **Plan hygiene:** dropped consumer-less schema stubs and unconsumed family events; split the FE agreements ticket; added integration-test, deploy/smoke, gsi-inventory, flag-off rollback, RBAC checkpoint, generalized payment-ordering rule, and two-repo PR conventions.

# Appendix C — Implementation record (v1.2, 2026-07-04)

One PR, per-task commits (`FB-x.y:` prefixes). Owner decisions FB-2.0(a)/(b) recorded in §FB-2.0. **Backend-only release** — all *(FE)* tasks deferred to `edforge-saas-frontend` follow-up PRs; every shipped flow is API-demoable (see the operator runbook).

## Task status

| Task | Status | Notes |
|---|---|---|
| FB-0.1–0.4 | ✅ | isOverdue derived read-side; sweep restricted to issued→overdue; schoolName read-time (5-min TTL cache); bulk-cancel-drafts + dashboard excludeDrafts/draftTotals; flags shipped default **true** (rollback lever, guard+suppression land together so R6 window is closed) |
| FB-1.1–1.7 | ✅ | Academics FamilyGroup; member gsi2pk = bare studentId (convention, R1 caveat pinned by test); +companion read `GET …/families/{id}/members` (added when FB-4.6 surfaced its absence) |
| FB-2.0–2.7 | ✅ | One BillingAgreement entity (subsumes PR-CA); ALL routes `billing:manage` (spec fails on downgrade); real-DDB lifecycle integration test (8 steps) |
| FB-3.1–3.9 | ✅ | Resolver date bound is `>=` (epic sketch's `>` excluded effectiveTo-day — corrected); hook `planAgreementPricing()` before the gradeLevel snapshot block; golden no-agreement byte-identity proven test-first; webhook needed zero logic change (generate() is the single chokepoint); flag-off suite pins R6 rollback |
| FB-4.0–4.7 | ✅ | Planner + multi-target transactWrite (1+2N+M ≤61 items); void/refund reverse every application; multi rows carry **no GSI2** (per-student view = ledger); receipt breakdown; real-DDB settlement test incl. genuine TransactionCanceledException atomicity |
| FB-5.1–5.5 | ✅ | Sibling count includes self, active-only, degrade→0 never 5xx; precedence agreement > rule > manual (rule REPLACES manual — authority order); provenance endpoint (overrides[] omitted — see Deviations); dashboard agreementCoverage + billingSource filter |
| FB-5.6 | ✅ (doc) | `operator-runbook.md`; §6 execution record pending post-deploy live validation |
| FB-0.5/1.9/2.10/3.11/4.9/5.7 | ⏳ | Per-sprint deploy+smoke collapse into ONE release: local gates → PR → prod behind explicit go/no-go → live JWT validation (UAT environment sunset) |
| *(FE)* FB-1.8, 2.8, 2.9, 3.10, 4.8, 5.4/5.5 panels | ⏸ deferred | Frontend repo, after this release |

## Settled generation semantics (supersedes §3.3's step-4 letter)

Default = **auto-suppress + replace** (covered feeTypes silently priced by the agreement, provenance on every line — correct pricing is never an error). `409 AGREEMENT_ACTIVE` = the **duplicate-billing guard**: a non-cancelled invoice already carries this agreementId for the same billing period. `overrideAgreement:true` (requires `billing:manage`) bills standard fees and emits `AGREEMENT_BYPASSED`. Marked `EPIC-FB settled semantics` at the hook.

## Deviations from plan (all deliberate, all in code comments too)

1. **Resolver bound `>=`** not `>` (inclusive effectiveTo). 2. **overrides[] omitted from provenance** — `AGREEMENT_BYPASSED` lands in CloudWatch via AuditLoggerService, not in queryable DDB audit rows; making it queryable is a follow-up. 3. **Sibling-rule fetch not AY-scoped** — rules pin `academicYearId` (uuid) while generation carries the AY label; no mapping exists in finance; bounded by `isActive`; follow-up. 4. **Multi-target payments never touch opening balance** (planner contract). 5. **Multi-refund is full-only** (partial → 400). 6. **Family open-invoices endpoint is NOT flag-gated** (degrades via academics 404; agreements flag would wrongly couple family payments to agreements). 7. **Route-drift linter upgraded** during task H: scans all three services, shape-normalized matching (param labels are API GW metadata), KNOWN_DRIFT 22→13 (10 were label false positives; +1 true pre-existing finance `reconcile` drift filed). 8. Sprint FB-2's draft-only gate was moot in a single-release ship (guard + activation land together) — flags default true.

## Follow-ups carried out of the epic

- Frontend task set (deferred above).
- Drain remaining 13 KNOWN_DRIFT routes (incl. `payments/{paymentId}/reconcile`).
- AGREEMENT_BYPASSED → queryable audit rows, then provenance `overrides[]`.
- AY label→id resolution for discount-rule scoping.
- `npm run test:integration` root config referenced but absent repo-wide (pre-existing); agreements/family-payment suites run via `test/integration/jest.config.js` added here.

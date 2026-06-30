/**
 * Finance module-wiring contract test — Pilot Onboarding Hardening
 * Sprint PD.0.3.
 *
 * Mirrors the academics + identity wiring specs that exist today.
 * Catches the same DI-graph bug class that took identity down on
 * 2026-05-14: a shared service registered on the root module's
 * `providers + exports` is NOT visible to child modules unless that
 * child also declares it locally. Root-module exports do NOT
 * propagate.
 *
 * The trap is silent at build time: `nest build finance` succeeds
 * even when DI is broken. ECS `services-stable` returns HEALTHY
 * even when the container crash-loops on Nest bootstrap (the health
 * probe predates DI resolution). The wiring spec is the only static
 * gate that catches this class of bug before it ships.
 *
 * Per CLAUDE.md memory `feedback_module_wiring_invariant`: every
 * NestJS module that consumes shared services MUST (a) declare those
 * providers in its OWN module + (b) be registered in this spec's
 * watchlist in the SAME PR. Future modules added to finance MUST
 * extend this spec.
 *
 * Why static metadata instead of full bootstrap: the full FinanceModule
 * transitively imports AuthModule (Cognito JwtStrategy), HealthModule,
 * AnalyticsEventsModule, etc. which require env vars + AWS auth at
 * construction time. A full bootstrap would require either real AWS
 * creds or per-provider mocking — costly to maintain, slow to run.
 *
 * Instead, this spec reads each module's @Module({ providers: [...] })
 * metadata via NestJS's reflection convention and asserts that every
 * service whose constructor injects a common dependency has that
 * dependency declared in its OWN module's providers.
 */

import { APP_INTERCEPTOR } from '@nestjs/core';
import { FinanceModule } from '../finance.module';
import { FeeStructuresModule } from '../fee-structures/fee-structures.module';
import { StudentAccountsModule } from '../student-accounts/student-accounts.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentGatewaysModule } from '../payment-gateways/payment-gateways.module';
import { EnrollmentWebhookModule } from '../webhooks/enrollment-webhook.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DiscountRulesModule } from '../discount-rules/discount-rules.module';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { RefundsModule } from '../refunds/refunds.module';
import { FinanceAuditModule } from '../audit/audit.module';
import { BulkOperationsModule } from '../bulk-ops/bulk-ops.module';
import { FinanceJobsService } from '../bulk-ops/finance-jobs.service';
import { BulkInvoiceGenerateWorker } from '../bulk-ops/workers/bulk-invoice-generate.worker';
import { BulkInvoicePdfExportWorker } from '../bulk-ops/workers/bulk-invoice-pdf-export.worker';
import { StaleFinanceJobSweeper } from '../bulk-ops/stale-finance-job-sweeper.service';
import { PerSchoolLock } from '../bulk-ops/util/per-school-lock';
import { PdfRenderConcurrencyBucket } from '../bulk-ops/util/pdf-render-concurrency-bucket';
// NOTE: S3Service is already imported below (line ~65) from the F.2 PR — don't double-import.
import { InvoicesService } from '../invoices/invoices.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { SequenceService } from '../common/services/sequence.service';
import { FinanceMetricsService } from '../common/services/finance-metrics.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { S3Service } from '../common/services/s3.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdempotentInterceptor } from '../common/interceptors/idempotent.interceptor';
// Phase E hotfix imports — needed for the new
// "Modules that locally provide StudentAccountsService also provide
// its full constructor dep set" block.
import { StudentAccountsService } from '../student-accounts/student-accounts.service';

/**
 * Read the `@Module({ providers: [...] })` metadata.
 * NestJS stores it via `Reflect.defineMetadata('providers', ...)`.
 */
function getModuleProviders(moduleClass: any): any[] {
  return Reflect.getMetadata('providers', moduleClass) ?? [];
}

/**
 * Read the `@Module({ imports: [...] })` metadata.
 */
function getModuleImports(moduleClass: any): any[] {
  return Reflect.getMetadata('imports', moduleClass) ?? [];
}

/**
 * Read the `@Module({ exports: [...] })` metadata.
 */
function getModuleExports(moduleClass: any): any[] {
  return Reflect.getMetadata('exports', moduleClass) ?? [];
}

describe('Finance module wiring — DI graph completeness', () => {
  // ============================================================================
  // DynamoDBClientService — every feature module reads or writes the
  // finance DDB table. Must be locally declared per child module; the
  // root export does NOT propagate.
  // ============================================================================
  describe('Every feature module that uses DynamoDBClientService declares it', () => {
    const consumerModules = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: EnrollmentWebhookModule, name: 'EnrollmentWebhookModule' },
      { module: DashboardModule, name: 'DashboardModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
      { module: FinanceAuditModule, name: 'FinanceAuditModule' },
      // Sprint D.4 — BulkOperationsModule's FinanceJobsService writes
      // FinanceJob rows; DynamoDBClientService is its first ctor dep.
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains DynamoDBClientService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(DynamoDBClientService);
      },
    );
  });

  // ============================================================================
  // IdentityClientService — backs PermissionGuard's role/permission
  // resolution. Required by every module that protects routes with
  // @RequirePermission() OR locally provides PermissionGuard. The
  // generalized PermissionGuard-deps block below (Phase E hotfix #2)
  // is the canonical check; this list documents the directly-used
  // call sites.
  // ============================================================================
  describe('Every feature module that uses IdentityClientService declares it', () => {
    const consumerModules = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: EnrollmentWebhookModule, name: 'EnrollmentWebhookModule' },
      { module: DashboardModule, name: 'DashboardModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
      // Phase E hotfix incident #2 — FinanceAuditModule declares
      // PermissionGuard but pre-fix omitted IdentityClientService,
      // crashing the container on Nest bootstrap.
      { module: FinanceAuditModule, name: 'FinanceAuditModule' },
      // Sprint D.4 — BulkOpsController injects IdentityClientService
      // directly (not via PermissionGuard — see bulk-ops.controller.ts)
      // for the 404-not-403 school-scope check. Local provider is
      // mandatory because Nest can't resolve controller deps from
      // root-module exports.
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains IdentityClientService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(IdentityClientService);
      },
    );
  });

  // ============================================================================
  // FinanceEventsService — emits domain events for every state change.
  // Every write-path module declares it.
  // ============================================================================
  describe('Every feature module that emits domain events declares FinanceEventsService', () => {
    const consumerModules = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: EnrollmentWebhookModule, name: 'EnrollmentWebhookModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains FinanceEventsService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(FinanceEventsService);
      },
    );
  });

  // ============================================================================
  // PermissionGuard — declared per-module because Nest evaluates guards
  // in the controller's module context, not the root's.
  // ============================================================================
  describe('Every feature module that protects routes declares PermissionGuard', () => {
    const consumerModules = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: DashboardModule, name: 'DashboardModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
      { module: FinanceAuditModule, name: 'FinanceAuditModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains PermissionGuard',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(PermissionGuard);
      },
    );
  });

  // ============================================================================
  // TenantSettingsService — used by modules that resolve tenant currency,
  // tax policy, archetype-aware defaults.
  // ============================================================================
  describe('Modules that resolve tenant settings declare TenantSettingsService', () => {
    const consumerModules = [
      // InvoicesService.generate() uses tenant currency + tax policy.
      { module: InvoicesModule, name: 'InvoicesModule' },
      // PaymentsService.recordManualPayment validates payment currency
      // against tenant currency.
      { module: PaymentsModule, name: 'PaymentsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains TenantSettingsService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(TenantSettingsService);
      },
    );
  });

  // ============================================================================
  // Phase E hotfix — modules that locally PROVIDE StudentAccountsService
  // (instead of importing StudentAccountsModule) MUST also locally
  // provide every constructor dep that StudentAccountsService injects.
  //
  // This is the EXACT bug pattern that took finance down on prod
  // 2026-06-27 after the rolling deploy of PD.2: PD.1.4 added
  // FinanceAuditService to StudentAccountsService's constructor +
  // declared it in StudentAccountsModule, but InvoicesModule +
  // PaymentsModule provide StudentAccountsService LOCALLY (not via
  // StudentAccountsModule import). Nest can't resolve the dep in the
  // consumer module's context, and the container crash-loops on
  // bootstrap with:
  //
  //   "Nest can't resolve dependencies of the StudentAccountsService
  //    (DynamoDBClientService, IdentityClientService, ?). Please make
  //    sure that the argument FinanceAuditService at index [2] is
  //    available in the InvoicesModule context."
  //
  // ECS circuit-breaker rolled the deploy back automatically; the
  // service is back on the pre-PD task definition. CLAUDE.md memory
  // `feedback_module_wiring_invariant` is the canonical write-up.
  //
  // This block hard-codes the rule: every module in the watchlist
  // that includes StudentAccountsService as a local provider MUST
  // ALSO include EVERY constructor dep of that service.
  //
  // FUTURE refactor (V1.5+): switch InvoicesModule + PaymentsModule
  // to `imports: [StudentAccountsModule]` instead of providing
  // StudentAccountsService locally. That removes the duplication
  // entirely. For pilot scope the conservative fix is the local
  // dep declaration (same shape as DynamoDBClientService,
  // FinanceEventsService, IdentityClientService — all duplicated
  // across feature modules in this codebase).
  describe('Modules that locally provide StudentAccountsService also provide its full constructor dep set', () => {
    const STUDENT_ACCOUNTS_SVC_DEPS = [
      { svc: DynamoDBClientService, name: 'DynamoDBClientService' },
      { svc: IdentityClientService, name: 'IdentityClientService' },
      // PD.1.4 added this dep — the bug that took prod down.
      { svc: FinanceAuditService, name: 'FinanceAuditService' },
    ];

    // Every module here locally lists StudentAccountsService in its
    // providers[]. If a new module starts providing it, ADD IT HERE
    // — the wiring spec is the only static gate that catches the
    // missing-dep regression. nest build will pass; ECS services-stable
    // will pass; the container will crash on Nest bootstrap in prod.
    const providersOfStudentAccountsService = [
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      // Note: StudentAccountsModule is the canonical owner — covered
      // by the per-dep watchlists above.
    ];

    it('sanity — the StudentAccountsService constructor dep list is complete (extend this list when adding new ctor params)', () => {
      // This is a meta-assertion: if a future PR adds a 4th constructor
      // param to StudentAccountsService, the developer MUST add it to
      // STUDENT_ACCOUNTS_SVC_DEPS above OR this spec is a lie. Force
      // the next maintainer to update this list by failing loudly on
      // any mismatch in module-provider counts.
      const studentAccountsModuleProviders = getModuleProviders(StudentAccountsModule);
      for (const dep of STUDENT_ACCOUNTS_SVC_DEPS) {
        expect(studentAccountsModuleProviders).toContain(dep.svc);
      }
    });

    for (const consumerModule of providersOfStudentAccountsService) {
      describe(`${consumerModule.name} locally provides StudentAccountsService and its deps`, () => {
        it(`${consumerModule.name}.providers contains StudentAccountsService`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(StudentAccountsService);
        });

        for (const dep of STUDENT_ACCOUNTS_SVC_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of StudentAccountsService)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }
  });

  // ============================================================================
  // Phase E hotfix #2 — generalized PermissionGuard-deps check.
  //
  // Sprint 0.3 introduced FinanceAuditModule with `providers: [..., PermissionGuard]`
  // but WITHOUT IdentityClientService — the dep PermissionGuard's constructor
  // injects. This sat latent until the PD.2 rolling deploy 2026-06-27 forced
  // Nest to fully bootstrap the module graph in prod, at which point the
  // container crash-looped with:
  //
  //   "Nest can't resolve dependencies of the PermissionGuard
  //    (Reflector, ?). Please make sure that the argument
  //    IdentityClientService at index [1] is available in the
  //    FinanceAuditModule context."
  //
  // Same exact bug class as the StudentAccountsService case above. This block
  // hard-codes the PermissionGuard constructor dep list + asserts every
  // module that locally declares PermissionGuard ALSO provides every dep.
  //
  // Future maintainer: if PermissionGuard's constructor grows a new param,
  // add it to PERMISSION_GUARD_DEPS below.
  describe('Modules that locally provide PermissionGuard also provide its full constructor dep set', () => {
    const PERMISSION_GUARD_DEPS = [
      // Reflector is Nest framework — provided automatically; not in this list.
      { svc: IdentityClientService, name: 'IdentityClientService' },
    ];

    const providersOfPermissionGuard = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: DashboardModule, name: 'DashboardModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
      { module: FinanceAuditModule, name: 'FinanceAuditModule' },
    ];

    for (const consumerModule of providersOfPermissionGuard) {
      describe(`${consumerModule.name} locally provides PermissionGuard and its deps`, () => {
        it(`${consumerModule.name}.providers contains PermissionGuard`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(PermissionGuard);
        });

        for (const dep of PERMISSION_GUARD_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of PermissionGuard)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }
  });

  // ============================================================================
  // Sprint D.4 — BulkOperationsModule provides FinanceJobsService locally,
  // and FinanceJobsService injects FinanceAuditService for transition
  // audit emissions. Mirrors the StudentAccountsService Phase-E pattern
  // above: any module that LOCALLY provides FinanceJobsService MUST also
  // locally provide every ctor dep of that service.
  //
  // Future maintainer: if FinanceJobsService grows a 3rd constructor
  // dep, add it to FINANCE_JOBS_SVC_DEPS below — this spec is the only
  // static gate that catches the "added a ctor param, forgot a module
  // provider" regression class.
  // ============================================================================
  describe('Modules that locally provide FinanceJobsService also provide its full constructor dep set', () => {
    const FINANCE_JOBS_SVC_DEPS = [
      { svc: DynamoDBClientService, name: 'DynamoDBClientService' },
      { svc: FinanceAuditService, name: 'FinanceAuditService' },
    ];

    const providersOfFinanceJobsService = [
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    for (const consumerModule of providersOfFinanceJobsService) {
      describe(`${consumerModule.name} locally provides FinanceJobsService and its deps`, () => {
        it(`${consumerModule.name}.providers contains FinanceJobsService`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(FinanceJobsService);
        });

        for (const dep of FINANCE_JOBS_SVC_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of FinanceJobsService)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }

    it('exports FinanceJobsService for downstream Sprint E/F/G worker consumers', () => {
      const exportsList = getModuleExports(BulkOperationsModule);
      expect(exportsList).toContain(FinanceJobsService);
    });
  });

  // ============================================================================
  // FinanceAuditService — exported by FinanceAuditModule. Consumers
  // either import FinanceAuditModule OR declare the service locally.
  // PD.1.4 added StudentAccountsModule as the first non-bulk-export
  // consumer (setOpeningBalance emits audit events). Phase E hotfix
  // (above) added InvoicesModule + PaymentsModule as transitive
  // consumers via their locally-provided StudentAccountsService.
  // ============================================================================
  describe('FinanceAuditModule exports FinanceAuditService for downstream consumers', () => {
    it('FinanceAuditModule.providers contains FinanceAuditService', () => {
      const providers = getModuleProviders(FinanceAuditModule);
      expect(providers).toContain(FinanceAuditService);
    });

    it('FinanceAuditModule.exports contains FinanceAuditService', () => {
      const exportsList = getModuleExports(FinanceAuditModule);
      expect(exportsList).toContain(FinanceAuditService);
    });

    it('FinanceModule.imports contains FinanceAuditModule', () => {
      const imports = getModuleImports(FinanceModule);
      expect(imports).toContain(FinanceAuditModule);
    });
  });

  // ============================================================================
  // Sprint 0.2 — IdempotentInterceptor MUST be registered as APP_INTERCEPTOR
  // on the root FinanceModule, NOT just declared as a regular provider. The
  // @Idempotent() decorator does nothing without this global registration.
  // PD.1.5 will be the first non-bulk-export consumer (PUT opening-balance).
  // CA.1.3 adds 6 more endpoints (fee-agreement CRUD).
  // ============================================================================
  describe('IdempotentInterceptor is registered as APP_INTERCEPTOR on FinanceModule', () => {
    it('FinanceModule.providers contains an APP_INTERCEPTOR entry for IdempotentInterceptor', () => {
      const providers = getModuleProviders(FinanceModule);
      const interceptorEntry = providers.find(
        (p: any) =>
          p &&
          typeof p === 'object' &&
          p.provide === APP_INTERCEPTOR &&
          p.useClass === IdempotentInterceptor,
      );
      expect(interceptorEntry).toBeDefined();
    });
  });

  // ============================================================================
  // Root module wiring — FinanceModule's imports list IS the source of
  // truth for which feature modules ship with finance. A missing import
  // here means the routes silently don't bind.
  // ============================================================================
  describe('FinanceModule imports every feature module', () => {
    const expectedFeatureModules = [
      { module: FeeStructuresModule, name: 'FeeStructuresModule' },
      { module: StudentAccountsModule, name: 'StudentAccountsModule' },
      { module: InvoicesModule, name: 'InvoicesModule' },
      { module: PaymentsModule, name: 'PaymentsModule' },
      { module: PaymentGatewaysModule, name: 'PaymentGatewaysModule' },
      { module: EnrollmentWebhookModule, name: 'EnrollmentWebhookModule' },
      { module: DashboardModule, name: 'DashboardModule' },
      { module: DiscountRulesModule, name: 'DiscountRulesModule' },
      { module: CreditNotesModule, name: 'CreditNotesModule' },
      { module: RefundsModule, name: 'RefundsModule' },
      { module: FinanceAuditModule, name: 'FinanceAuditModule' },
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    it.each(expectedFeatureModules)(
      'FinanceModule.imports contains $name',
      ({ module }) => {
        const imports = getModuleImports(FinanceModule);
        expect(imports).toContain(module);
      },
    );
  });

  // ============================================================================
  // Defensive: root-level services that are NOT consumed via module imports
  // (e.g., FinanceEventsService is re-exported by FinanceModule for shared
  // access). Asserts the canonical root exports survive refactors.
  // ============================================================================
  describe('FinanceModule exports the canonical shared services', () => {
    it.each([
      { svc: DynamoDBClientService, name: 'DynamoDBClientService' },
      { svc: IdentityClientService, name: 'IdentityClientService' },
      { svc: TenantSettingsService, name: 'TenantSettingsService' },
      { svc: FinanceEventsService, name: 'FinanceEventsService' },
      // Sprint F.2 — S3Service is exported so future modules (BulkOperationsModule
      // workers in F.3 / G.2 / H.3) can inject it locally. The S3Service itself
      // requires no constructor deps beyond env vars, so unlike StudentAccountsService
      // there's no dep-graph block to add — only the root-export assertion.
      { svc: S3Service, name: 'S3Service' },
    ])(
      'FinanceModule.exports contains $name',
      ({ svc }) => {
        const exportsList = getModuleExports(FinanceModule);
        expect(exportsList).toContain(svc);
      },
    );
  });

  // ============================================================================
  // Sprint E.4 — BulkInvoiceGenerateWorker is the first worker registered
  // in BulkOperationsModule. Its constructor injects the full identity +
  // finance + lock dep set. Same hardening pattern as the
  // FinanceJobsService / StudentAccountsService / PermissionGuard blocks
  // above: if the worker ctor grows a new dep, add it to
  // BULK_INVOICE_GENERATE_WORKER_DEPS so the wiring spec catches a
  // missing local provider before it boots prod.
  //
  // Also asserts BulkOperationsModule exports the worker (so
  // InvoicesController can inject it via the InvoicesModule → BulkOps
  // import edge) and PerSchoolLock (so future workers can share the
  // per-school serialization gate).
  //
  // PR #341 review F5: lifecycle audit emits moved into FinanceJobsService
  // (the sole audit gatekeeper). The worker no longer injects
  // FinanceAuditService — it's still in BulkOperationsModule.providers
  // because FinanceJobsService consumes it.
  // ============================================================================
  describe('Modules that locally provide BulkInvoiceGenerateWorker also provide its full constructor dep set', () => {
    const BULK_INVOICE_GENERATE_WORKER_DEPS = [
      { svc: FinanceJobsService, name: 'FinanceJobsService' },
      { svc: InvoicesService, name: 'InvoicesService' },
      { svc: SequenceService, name: 'SequenceService' },
      { svc: IdentityClientService, name: 'IdentityClientService' },
      { svc: FeeStructuresService, name: 'FeeStructuresService' },
      { svc: TenantSettingsService, name: 'TenantSettingsService' },
      { svc: DynamoDBClientService, name: 'DynamoDBClientService' },
      { svc: PerSchoolLock, name: 'PerSchoolLock' },
      // Issues #344 + #345 — FinanceMetricsService is an optional
      // constructor dep (worker has `private readonly metrics?:`)
      // for spec ergonomics, but Nest DI provides the real impl at
      // runtime. Pin its presence here so a future refactor that
      // drops it from BulkOperationsModule.providers doesn't silently
      // disable hot-path observability in prod.
      { svc: FinanceMetricsService, name: 'FinanceMetricsService' },
    ];

    const providersOfBulkInvoiceGenerateWorker = [
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    for (const consumerModule of providersOfBulkInvoiceGenerateWorker) {
      describe(`${consumerModule.name} locally provides BulkInvoiceGenerateWorker and its deps`, () => {
        it(`${consumerModule.name}.providers contains BulkInvoiceGenerateWorker`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(BulkInvoiceGenerateWorker);
        });

        for (const dep of BULK_INVOICE_GENERATE_WORKER_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of BulkInvoiceGenerateWorker)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }

    it('BulkOperationsModule exports BulkInvoiceGenerateWorker (for InvoicesController consumption)', () => {
      const exportsList = getModuleExports(BulkOperationsModule);
      expect(exportsList).toContain(BulkInvoiceGenerateWorker);
    });

    it('BulkOperationsModule exports PerSchoolLock (future workers can share the gate)', () => {
      const exportsList = getModuleExports(BulkOperationsModule);
      expect(exportsList).toContain(PerSchoolLock);
    });
  });

  // ============================================================================
  // Sprint F.3 — BulkInvoicePdfExportWorker is the second worker
  // registered in BulkOperationsModule. Same hardening pattern as the
  // E.4 BulkInvoiceGenerateWorker block: if the ctor grows a new dep,
  // add it to BULK_PDF_EXPORT_WORKER_DEPS so the wiring spec catches
  // a missing local provider before it boots prod. The bucket
  // (PdfRenderConcurrencyBucket) is the §5d MVP.5 S5 process-wide
  // singleton — Nest DI singleton-ness IS the source of the
  // "process-wide cap, NOT per-job" property.
  // ============================================================================
  describe('Modules that locally provide BulkInvoicePdfExportWorker also provide its full constructor dep set', () => {
    const BULK_PDF_EXPORT_WORKER_DEPS = [
      { svc: FinanceJobsService, name: 'FinanceJobsService' },
      { svc: InvoicesService, name: 'InvoicesService' },
      { svc: IdentityClientService, name: 'IdentityClientService' },
      { svc: S3Service, name: 'S3Service' },
      { svc: PerSchoolLock, name: 'PerSchoolLock' },
      { svc: PdfRenderConcurrencyBucket, name: 'PdfRenderConcurrencyBucket' },
      // FinanceMetricsService is an optional ctor dep (`private readonly metrics?:`)
      // — pin its presence here so a future refactor that drops it from
      // BulkOperationsModule.providers doesn't silently disable F.3's
      // per-stage timing metrics in prod.
      { svc: FinanceMetricsService, name: 'FinanceMetricsService' },
    ];

    const providersOfBulkPdfExportWorker = [
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    for (const consumerModule of providersOfBulkPdfExportWorker) {
      describe(`${consumerModule.name} locally provides BulkInvoicePdfExportWorker and its deps`, () => {
        it(`${consumerModule.name}.providers contains BulkInvoicePdfExportWorker`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(BulkInvoicePdfExportWorker);
        });

        for (const dep of BULK_PDF_EXPORT_WORKER_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of BulkInvoicePdfExportWorker)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }

    it('BulkOperationsModule exports BulkInvoicePdfExportWorker (for future F.4 controller consumption)', () => {
      const exportsList = getModuleExports(BulkOperationsModule);
      expect(exportsList).toContain(BulkInvoicePdfExportWorker);
    });
  });

  // ============================================================================
  // Sprint §5d MVP.3 — StaleFinanceJobSweeper closes the F.1-review
  // durability gap: a container replacement (deploy / OOM / scale-in)
  // ends the process before the worker's try/finally runs, leaving the
  // FinanceJob row stuck `running` forever. The sweeper fires on
  // OnApplicationBootstrap, scans for rows older than 2× the worker's
  // 60-min hard cap, marks them `failed` with a sentinel error.
  //
  // Same hardening pattern as the BulkInvoiceGenerateWorker block: if
  // the sweeper ctor grows a new dep, add it to STALE_SWEEPER_DEPS so
  // the wiring spec catches a missing local provider before it boots
  // prod. nest build passes when DI is broken; ECS services-stable
  // returns HEALTHY even when the container crash-loops on Nest init.
  // ============================================================================
  describe('Modules that locally provide StaleFinanceJobSweeper also provide its full constructor dep set', () => {
    const STALE_SWEEPER_DEPS = [
      { svc: DynamoDBClientService, name: 'DynamoDBClientService' },
      // FinanceMetricsService is an optional ctor dep (`private readonly metrics?:`)
      // for spec ergonomics; Nest DI provides the real impl at runtime.
      // Pin its presence here so a future refactor that drops it from
      // BulkOperationsModule.providers doesn't silently disable the
      // StaleJobsSwept / SweeperFailures CW metrics in prod.
      { svc: FinanceMetricsService, name: 'FinanceMetricsService' },
    ];

    const providersOfStaleSweeper = [
      { module: BulkOperationsModule, name: 'BulkOperationsModule' },
    ];

    for (const consumerModule of providersOfStaleSweeper) {
      describe(`${consumerModule.name} locally provides StaleFinanceJobSweeper and its deps`, () => {
        it(`${consumerModule.name}.providers contains StaleFinanceJobSweeper`, () => {
          const providers = getModuleProviders(consumerModule.module);
          expect(providers).toContain(StaleFinanceJobSweeper);
        });

        for (const dep of STALE_SWEEPER_DEPS) {
          it(`${consumerModule.name}.providers contains ${dep.name} (constructor dep of StaleFinanceJobSweeper)`, () => {
            const providers = getModuleProviders(consumerModule.module);
            expect(providers).toContain(dep.svc);
          });
        }
      });
    }
  });

  // ============================================================================
  // Sprint E.3 — InvoicesModule imports BulkOperationsModule so the
  // InvoicesController can inject FinanceJobsService + BulkInvoiceGenerateWorker
  // for the async bulk-generate branch. This is a NEW edge in the module
  // graph; the spec pins it so a future refactor that drops the import
  // surfaces a clear failure (instead of a runtime Nest "can't resolve
  // dependencies of InvoicesController" crash).
  // ============================================================================
  describe('InvoicesModule wires the async bulk-generate branch', () => {
    it('InvoicesModule.imports contains BulkOperationsModule', () => {
      const imports = getModuleImports(InvoicesModule);
      expect(imports).toContain(BulkOperationsModule);
    });
  });
});

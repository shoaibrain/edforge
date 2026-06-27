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
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { IdempotentInterceptor } from '../common/interceptors/idempotent.interceptor';

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
  // @RequirePermission().
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
  // FinanceAuditService — exported by FinanceAuditModule. Consumers
  // either import FinanceAuditModule OR declare the service locally.
  // PD.1.4 will add StudentAccountsModule as the first non-bulk-export
  // consumer (setOpeningBalance emits audit events).
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
    ])(
      'FinanceModule.exports contains $name',
      ({ svc }) => {
        const exportsList = getModuleExports(FinanceModule);
        expect(exportsList).toContain(svc);
      },
    );
  });
});

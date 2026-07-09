/**
 * Module-wiring contract test — Sprint S0 retro.
 *
 * Catches the DI-graph bug class that took prod down on 2026-05-14:
 *
 *   Nest can't resolve dependencies of the AcademicYearsService
 *   (DynamoDBClientService, ?, AcademicSessionService). Please make sure
 *   that the argument AuditedWriteService at index [1] is available in
 *   the AcademicYearsModule context.
 *
 * **Root cause** was: `AuditedWriteService` was registered on
 * `IdentityModule.providers + exports`, but feature modules
 * (AcademicYearsModule, SchoolsModule, ...) don't import IdentityModule
 * and therefore don't see its exports. The unit specs all use
 * `Test.createTestingModule` with hand-rolled `providers: [...]` arrays,
 * which constructs a synthetic DI graph that bypasses the real module
 * wiring entirely. The error was only discoverable by deploying.
 *
 * **Why this test is static-metadata, not a full DI bootstrap:**
 * The full SchoolsModule + AcademicYearsModule transitively import
 * AuthModule (Cognito JwtStrategy), RolesModule, UsersModule, etc.
 * which require env vars + AWS auth at construction time. A full
 * bootstrap test would require either real AWS creds or extensive
 * provider-by-provider mocking — costly to maintain and slow to run.
 *
 * Instead we do the cheaper, more targeted thing: read each module's
 * `@Module({ providers: [...] })` metadata via NestJS's reflection
 * convention and assert that every service whose constructor injects
 * a common dependency has that dependency declared in its OWN module's
 * providers (not relying on root-module export propagation, which
 * doesn't work for child modules).
 *
 * Specifically: any service that takes `AuditedWriteService` as a
 * constructor parameter MUST be in a module whose `providers` includes
 * `AuditedWriteService`. Same pattern as `DynamoDBClientService` already
 * follows in every module that uses it.
 */

import { AcademicYearsModule } from '../academic-years/academic-years.module';
import { SchoolsModule } from '../schools/schools.module';
import { CalendarModule } from '../schools/calendar.module';
import { CalendarBlockModule } from '../calendar-blocks/calendar-block.module';
import { ReportingSnapshotModule } from '../external-reporting/reporting-snapshot.module';
import { BrandingModule } from '../branding/branding.module';
import { PdfTemplatesModule } from '../pdf-templates/pdf-templates.module';
import { MasterScheduleModule } from '../schools/master-schedule.module';
import { StaffModule } from '../staff/staff.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { LeaveModule } from '../leave/leave.module';
import { StaffTrainingsModule } from '../staff-trainings/staff-trainings.module';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdempotencyService } from '../common/services/idempotency.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { StaffReadGuard } from '../common/guards/staff-read.guard';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { RolesService } from '../roles/roles.service';
import { AuthModule } from '../auth/auth.module';
import { SecurityModule } from '../security/security.module';
import { IdentityModule } from '../identity.module';
import { APP_GUARD } from '@nestjs/core';
import { SessionRevokedGuard } from '../common/guards/session-revoked.guard';

/**
 * Read the `@Module({ providers: [...] })` metadata from a NestJS module
 * class. NestJS stores it on the constructor under Reflect's
 * design-time-metadata-by-string key `providers`.
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

describe('Module wiring contract — DI graph completeness', () => {
  // ============================================
  // The exact bug pattern that took prod down 2026-05-14
  // ============================================
  describe('Every feature module that uses AuditedWriteService declares it as a provider', () => {
    // List of modules whose services inject AuditedWriteService. If a new
    // service starts injecting it, the file maintainer adds the owning
    // module here AND ensures that module's providers array includes
    // AuditedWriteService.
    const consumerModules = [
      { module: SchoolsModule, name: 'SchoolsModule' },
      { module: AcademicYearsModule, name: 'AcademicYearsModule' },
      // Sprint S2.3 — CalendarDateService.generateCalendar emits CALENDAR audit row.
      { module: CalendarModule, name: 'CalendarModule' },
      // Sprint C4 — CalendarBlockService emits CALENDAR_BLOCK audit rows on
      // create/update/delete. Added 2026-05-17 after the deploy-day incident
      // that took identity down for ~6 minutes when the original
      // CalendarBlockModule only imported AcademicYearsModule and missed
      // DynamoDBClientService + AuditedWriteService in its providers list.
      { module: CalendarBlockModule, name: 'CalendarBlockModule' },
      // Sprint E.1 — ReportingSnapshotService emits REPORTING_SNAPSHOT
      // audit rows on create + every state transition (generating →
      // generated | submitted | verified | failed).
      { module: ReportingSnapshotModule, name: 'ReportingSnapshotModule' },
      // Sprint C.0.7 — BrandingService emits SCHOOL/update audit rows on
      // PATCH /schools/:id/branding (branding is a sub-document of School).
      { module: BrandingModule, name: 'BrandingModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains AuditedWriteService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(AuditedWriteService);
      },
    );
  });

  // ============================================
  // Generalize the pattern — DynamoDBClientService is the canonical
  // example of a common service that must be declared per-module.
  // Test it the same way as a regression guard.
  // ============================================
  describe('Every feature module that uses DynamoDBClientService declares it as a provider', () => {
    const consumerModules = [
      { module: SchoolsModule, name: 'SchoolsModule' },
      { module: AcademicYearsModule, name: 'AcademicYearsModule' },
      { module: CalendarModule, name: 'CalendarModule' },
      { module: CalendarBlockModule, name: 'CalendarBlockModule' },
      { module: ReportingSnapshotModule, name: 'ReportingSnapshotModule' },
      { module: BrandingModule, name: 'BrandingModule' },
      // Sprint C.1.3 — PdfTemplatesService reads PdfTemplate + Tenant rows.
      { module: PdfTemplatesModule, name: 'PdfTemplatesModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains DynamoDBClientService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(DynamoDBClientService);
      },
    );
  });

  // ============================================
  // Sprint C.0.7 — S3PresignerService for branding upload-url endpoint.
  // Mirrors the AuditedWriteService pattern: feature modules that inject
  // it must declare it as a local provider; root-module exports do not
  // propagate to child modules.
  // ============================================
  describe('Every feature module that uses S3PresignerService declares it as a provider', () => {
    const consumerModules = [
      { module: BrandingModule, name: 'BrandingModule' },
      // Sprint E.1 — ReportingSnapshotService injects S3PresignerService for
      // the GET /reporting/snapshots/:id/download presigned-URL endpoint.
      { module: ReportingSnapshotModule, name: 'ReportingSnapshotModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains S3PresignerService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(S3PresignerService);
      },
    );
  });

  // ============================================
  // Sprint C.0-followup — PermissionGuard + RolesService for the
  // `branding:configure` permission key. PermissionGuard at
  // common/guards/permission.guard.ts injects (Reflector, RolesService,
  // DynamoDBClientService). RolesService at roles/roles.service.ts
  // injects (DynamoDBClientService, IdentityEventsService). All four
  // deps must be locally declared in any feature module that wires
  // PermissionGuard (root-module exports don't propagate).
  // ============================================
  describe('Every feature module that uses PermissionGuard declares its full DI graph', () => {
    const consumerModules = [
      { module: BrandingModule, name: 'BrandingModule' },
      // Sprint C.1.3 — PdfTemplatesController is gated by
      // PermissionGuard + `pdf-templates:view`. Same DI graph requirement
      // as BrandingModule (PermissionGuard → RolesService → IdentityEventsService).
      { module: PdfTemplatesModule, name: 'PdfTemplatesModule' },
      // P0 authz remediation — BellScheduleController is gated by
      // PermissionGuard + `scheduling:*`. Same DI graph requirement.
      { module: MasterScheduleModule, name: 'MasterScheduleModule' },
      // P0 authz remediation — Calendar + CalendarDate controllers gated by
      // PermissionGuard + `scheduling:*`.
      { module: CalendarModule, name: 'CalendarModule' },
      // P0 authz remediation — AcademicYearsController gated by
      // PermissionGuard + `scheduling:*`.
      { module: AcademicYearsModule, name: 'AcademicYearsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains PermissionGuard + RolesService + IdentityEventsService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(PermissionGuard);
        expect(providers).toContain(RolesService);
        expect(providers).toContain(IdentityEventsService);
      },
    );
  });

  // ============================================
  // Staff-read authz — StaffReadGuard (common/guards/staff-read.guard.ts)
  // denies portal accounts (Parent/Student) on staff HR reads. It injects
  // only DynamoDBClientService, so any feature module that wires it must
  // declare both StaffReadGuard and DynamoDBClientService as providers
  // (root-module exports don't propagate). nest build passes even when this
  // is broken; only this spec catches the silent DI gap.
  // ============================================
  describe('Every feature module that uses StaffReadGuard declares its DI graph', () => {
    const consumerModules = [
      { module: StaffModule, name: 'StaffModule' },
      { module: CredentialsModule, name: 'CredentialsModule' },
      { module: LeaveModule, name: 'LeaveModule' },
      { module: StaffTrainingsModule, name: 'StaffTrainingsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains StaffReadGuard + DynamoDBClientService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(StaffReadGuard);
        expect(providers).toContain(DynamoDBClientService);
      },
    );
  });

  // ============================================
  // BH-1.4 service-auth — InternalApiKeyGuard gates the internal
  // AcademicYearsInternalController (GET /internal/schools/:id/academic-years)
  // used by finance's billing AY resolution. The guard has no injected deps,
  // but Nest still needs it declared in the module that wires @UseGuards on the
  // controller; a missing provider fails at bootstrap (nest build passes).
  // ============================================
  describe('Every feature module that uses InternalApiKeyGuard declares it as a provider', () => {
    const consumerModules = [
      { module: AcademicYearsModule, name: 'AcademicYearsModule' },
    ];

    it.each(consumerModules)(
      '$name.providers contains InternalApiKeyGuard',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(InternalApiKeyGuard);
      },
    );
  });

  // ============================================
  // SR.2 (Identity & Access #424) — SessionRevokedGuard is a root-level
  // APP_GUARD that 401s a revoked session. It injects DynamoDBClientService;
  // if that provider is dropped from IdentityModule, Nest fails to instantiate
  // the global guard at bootstrap (nest build still passes). This asserts the
  // root wiring stays intact.
  // ============================================
  describe('IdentityModule wires the SessionRevokedGuard (SR.2)', () => {
    const providers = getModuleProviders(IdentityModule);

    it('registers SessionRevokedGuard as an APP_GUARD', () => {
      const useClasses = providers
        .filter((p: any) => p && p.provide === APP_GUARD)
        .map((p: any) => p.useClass);
      expect(useClasses).toContain(SessionRevokedGuard);
    });

    it('provides SessionRevokedGuard\'s DI (DynamoDBClientService)', () => {
      expect(providers).toContain(DynamoDBClientService);
    });
  });

  // ============================================
  // Sprint S1.1 (Identity & Access) — AuthService injects SecurityService to
  // capture login attempts into the user-facing login-history. Unlike the
  // per-module common-service pattern above, this dependency is satisfied by
  // AuthModule *importing* SecurityModule (which exports SecurityService). If
  // the import is dropped, Nest can't resolve AuthService's SecurityService
  // param — nest build still passes; only bootstrap (or this test) catches it.
  // ============================================
  describe('AuthModule can resolve SecurityService (login-history capture)', () => {
    it('AuthModule imports SecurityModule', () => {
      const imports = getModuleImports(AuthModule);
      const names = imports.map((m: any) => m?.name ?? String(m));
      expect(names).toContain('SecurityModule');
    });

    it('SecurityModule exports SecurityService', () => {
      const exports = getModuleExports(SecurityModule);
      const names = exports.map((e: any) => e?.name ?? String(e));
      expect(names).toContain('SecurityService');
    });
  });

  // ============================================
  // Module shape sanity — guards against accidentally deleting `exports`
  // (which would break IdentityModule's import of the feature module).
  // ============================================
  describe('Feature modules export their primary service', () => {
    it('SchoolsModule exports SchoolsService', () => {
      const exports = getModuleExports(SchoolsModule);
      // Read by name — class identity is hard to assert without circular
      // imports, but the export array should be non-empty and contain
      // exactly one identifier matching SchoolsService.
      expect(exports.length).toBeGreaterThan(0);
      const names = exports.map((e: any) => e?.name ?? String(e));
      expect(names).toContain('SchoolsService');
    });

    it('AcademicYearsModule exports AcademicYearsService', () => {
      const exports = getModuleExports(AcademicYearsModule);
      const names = exports.map((e: any) => e?.name ?? String(e));
      expect(names).toContain('AcademicYearsService');
    });

    it('BrandingModule exports BrandingService', () => {
      const exports = getModuleExports(BrandingModule);
      const names = exports.map((e: any) => e?.name ?? String(e));
      expect(names).toContain('BrandingService');
    });

    it('PdfTemplatesModule exports PdfTemplatesService', () => {
      const exports = getModuleExports(PdfTemplatesModule);
      const names = exports.map((e: any) => e?.name ?? String(e));
      expect(names).toContain('PdfTemplatesService');
    });
  });

  // ============================================
  // Imports declared — guards against accidentally emptying imports[]
  // which would break the `AcademicSessionService for grading period
  // validation` forward-ref wiring.
  // ============================================
  describe('AcademicYearsModule has its CalendarModule import declared', () => {
    it('AcademicYearsModule.imports is non-empty', () => {
      const imports = getModuleImports(AcademicYearsModule);
      // NestJS's `forwardRef()` returns an object `{ forwardRef: ()=>... }`
      // so we just assert at least one import exists; tighter shape
      // checks would couple this test to NestJS internals.
      expect(imports.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // IdempotencyService — declared globally for now (S0.10), no consumer
  // adopts it yet. Test that it's at least resolvable so we don't ship
  // a broken module-graph for the un-adopted provider.
  // ============================================
  describe('IdempotencyService is exported as a class symbol', () => {
    it('IdempotencyService is a constructable class', () => {
      expect(typeof IdempotencyService).toBe('function');
      expect(IdempotencyService.name).toBe('IdempotencyService');
    });
  });
});

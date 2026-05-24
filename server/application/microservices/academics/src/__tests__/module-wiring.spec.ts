/**
 * Academics module-wiring contract test — A.4 incident retro.
 *
 * Catches the DI-graph bug class that took academics prod down on
 * 2026-05-23:
 *
 *   Nest can't resolve dependencies of the PermissionGuard
 *   (Reflector, ?). Please make sure that the argument
 *   IdentityClientService at index [1] is available in the
 *   ResultsModule context.
 *
 * **Root cause** was identical to the identity module-wiring incident
 * (2026-05-14): a feature module declared `PermissionGuard` as a
 * provider without also declaring `IdentityClientService`, which the
 * guard injects at construction time. Nest's root-module exports do
 * NOT propagate to child modules; every feature module must declare
 * its own `IdentityClientService` provider.
 *
 * **Why this test is static-metadata, not a full DI bootstrap:**
 * Mirrors `identity/src/__tests__/module-wiring.spec.ts` reasoning —
 * full bootstrap requires env vars + AWS auth at construction. Static
 * metadata read is cheaper, faster, and catches the exact bug class.
 *
 * **Forward rule** (per memory `feedback_module_wiring_invariant`):
 * any NEW academics feature module that uses `PermissionGuard` MUST
 * also declare `IdentityClientService` in providers AND register here
 * in `consumerModules` in the SAME PR.
 */

import { ExamsModule } from '../exams/exams.module';
import { ResultsModule } from '../results/results.module';
import { CoursesModule } from '../courses/courses.module';
import { GradesModule } from '../grades/grades.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SectionsModule } from '../sections/sections.module';
import { SectionAttendanceModule } from '../section-attendance/section-attendance.module';
import { ClassworkModule } from '../classwork/classwork.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { StudentsModule } from '../students/students.module';
import { PromotionRulesModule } from '../promotion-rules/promotion-rules.module';
import { PromotionModule } from '../promotion/promotion.module';
import { IdentityClientService } from '../common/services/identity-client.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PromotionEvaluatorService } from '../promotion/promotion-evaluator.service';

function getModuleProviders(moduleClass: any): any[] {
  return Reflect.getMetadata('providers', moduleClass) ?? [];
}

// Every academics module that uses PermissionGuard goes here.
// New modules MUST be added when they import PermissionGuard.
const consumerModules = [
  { module: ExamsModule, name: 'ExamsModule' },
  { module: ResultsModule, name: 'ResultsModule' },
  { module: CoursesModule, name: 'CoursesModule' },
  { module: GradesModule, name: 'GradesModule' },
  { module: EnrollmentModule, name: 'EnrollmentModule' },
  { module: AttendanceModule, name: 'AttendanceModule' },
  { module: SectionsModule, name: 'SectionsModule' },
  { module: SectionAttendanceModule, name: 'SectionAttendanceModule' },
  { module: ClassworkModule, name: 'ClassworkModule' },
  { module: DashboardModule, name: 'DashboardModule' },
  { module: StudentsModule, name: 'StudentsModule' },
  // Sprint D.2.2 — new CRUD module under PermissionGuard.
  { module: PromotionRulesModule, name: 'PromotionRulesModule' },
];

describe('Academics module-wiring contract — DI graph completeness', () => {
  describe('Every module that declares PermissionGuard also declares its IdentityClientService dep', () => {
    it.each(consumerModules)(
      '$name.providers includes IdentityClientService (PermissionGuard dep)',
      ({ module }) => {
        const providers = getModuleProviders(module);
        if (providers.includes(PermissionGuard)) {
          expect(providers).toContain(IdentityClientService);
        }
      },
    );

    it.each(consumerModules)(
      '$name.providers includes PermissionGuard',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(PermissionGuard);
      },
    );
  });

  describe('Every consumer module declares DynamoDBClientService', () => {
    it.each(consumerModules)(
      '$name.providers includes DynamoDBClientService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(DynamoDBClientService);
      },
    );
  });

  // AcademicsEventsService is required by every write-path module
  // (anything that emits domain events). DashboardModule is read-only
  // (cache + aggregate) and intentionally does NOT emit, so it's
  // excluded here. New write-path modules should be added.
  describe('Every write-path module declares AcademicsEventsService', () => {
    const writePathModules = consumerModules.filter(
      (m) => m.name !== 'DashboardModule',
    );

    it.each(writePathModules)(
      '$name.providers includes AcademicsEventsService',
      ({ module }) => {
        const providers = getModuleProviders(module);
        expect(providers).toContain(AcademicsEventsService);
      },
    );
  });

  // ============================================================================
  // Sprint D.2.4 — pure-function modules (no PermissionGuard, no DDB)
  // ============================================================================
  //
  // PromotionModule wraps the D.2.4 evaluator (pure function — no DDB, no
  // events, no guards). Its module-wiring contract is therefore minimal:
  // declare + export the evaluator service. Phase 3 (D.2.5 batch endpoint)
  // will introduce sibling modules that DO need the full PermissionGuard
  // wiring; those join consumerModules then.
  describe('Pure-function modules (no PermissionGuard)', () => {
    it('PromotionModule.providers includes PromotionEvaluatorService', () => {
      const providers = getModuleProviders(PromotionModule);
      expect(providers).toContain(PromotionEvaluatorService);
    });

    it('PromotionModule.providers does NOT include PermissionGuard (pure function — no auth surface)', () => {
      const providers = getModuleProviders(PromotionModule);
      expect(providers).not.toContain(PermissionGuard);
    });

    it('PromotionModule.providers does NOT include DynamoDBClientService (pure function — no DDB)', () => {
      const providers = getModuleProviders(PromotionModule);
      expect(providers).not.toContain(DynamoDBClientService);
    });
  });
});

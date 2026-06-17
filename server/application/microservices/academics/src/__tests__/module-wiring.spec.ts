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
import { ExternalExamsModule } from '../external-exams/external-exams.module';
import { BoardExamsModule } from '../board-exams/board-exams.module';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantMetadataReaderService } from '../common/services/tenant-metadata-reader.service';
import { AttendancePolicyResolverService } from '../attendance/attendance-policy-resolver.service';
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
  // Sprint D.2 Phase 3 — D.2.5 + D.2.6 endpoints under PermissionGuard
  // (PromotionBatchController). PromotionModule now declares
  // PermissionGuard + IdentityClientService, so it joins the consumer
  // list (previously a pure-function-only module per Phase 2).
  { module: PromotionModule, name: 'PromotionModule' },
  // Sprint GB2.3 — board-exam list endpoint under PermissionGuard. Read-only
  // (lazy-seed is an internal side-effect, no domain-event emit), so it is
  // excluded from the AcademicsEventsService write-path check below.
  { module: BoardExamsModule, name: 'BoardExamsModule' },
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
      (m) => m.name !== 'DashboardModule' && m.name !== 'BoardExamsModule',
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
  // Sprint D.2 Phase 3 — Cross-year handoff wiring guards
  // ============================================================================
  //
  // The Phase 2 invariant "PromotionModule is pure-function-only" was
  // relaxed in Phase 3 when D.2.5 + D.2.6 endpoints landed under
  // PermissionGuard. The one Phase 2 contract that MUST survive is:
  // PromotionEvaluatorService stays in the providers list so existing
  // consumers keep resolving it.
  describe('Evaluator-still-registered (Sprint D.2.4 carryover)', () => {
    it('PromotionModule.providers still includes PromotionEvaluatorService', () => {
      const providers = getModuleProviders(PromotionModule);
      expect(providers).toContain(PromotionEvaluatorService);
    });
  });

  // ResultCardsService.publishResultCard (A.4.5) fires the cross-year
  // handoff via synchronous DI on EnrollmentTransitionHandlerService,
  // which in turn injects EnrollmentFlipService. Both providers MUST be
  // declared on ResultsModule. Missing either provider would crash the
  // publish path on the first terminal-exam publish.
  describe('D.2.9 cross-year handoff wiring (ResultsModule)', () => {
    it('ResultsModule.providers includes EnrollmentTransitionHandlerService (D.2.9)', () => {
      const providers = getModuleProviders(ResultsModule);
      const provNames = providers.map((p: { name?: string } | string) =>
        typeof p === 'string' ? p : p?.name ?? String(p),
      );
      expect(provNames).toContain('EnrollmentTransitionHandlerService');
    });

    it('ResultsModule.providers includes EnrollmentFlipService (D.2.10)', () => {
      const providers = getModuleProviders(ResultsModule);
      const provNames = providers.map((p: { name?: string } | string) =>
        typeof p === 'string' ? p : p?.name ?? String(p),
      );
      expect(provNames).toContain('EnrollmentFlipService');
    });
  });

  // ============================================================================
  // Sprint D.3 — ExternalAssessment family (foundation; controllers in D.4+)
  // ============================================================================
  //
  // ExternalExamsModule is a SHELL in this sprint — zero providers, zero
  // controllers. D.4 / D.5 / D.6 add their controllers + services under
  // this module. The shell ships now to honor the
  // [[feedback-module-wiring-invariant]] discipline at module-introduction
  // time, not retrofitted.
  //
  // These assertions:
  //   1-4. EntityKeyBuilder methods exist + return the expected shape
  //        for the 6 new entity types
  //   5.   The lock builder (companion to ExternalExamRegistration)
  //        exists + is deterministic on (schoolId, studentId, examType,
  //        examYear)
  //   6.   ExternalExamsModule shell has zero providers (Phase-2
  //        contract; D.4 PR will relax this)
  //   7.   ExternalExamsModule shell has zero controllers
  describe('D.3 ExternalAssessment family — foundation wiring', () => {
    it('EntityKeyBuilder.rubricCategory returns RUBRIC_CATEGORY#{schoolId}#{categoryId}', () => {
      expect(EntityKeyBuilder.rubricCategory('S', 'C')).toBe('RUBRIC_CATEGORY#S#C');
    });

    it('EntityKeyBuilder.externalExamRegistration returns EXT_EXAM_REG#{schoolId}#{registrationId}', () => {
      expect(EntityKeyBuilder.externalExamRegistration('S', 'R')).toBe('EXT_EXAM_REG#S#R');
    });

    it('EntityKeyBuilder.internalAssessment returns INTERNAL_ASSESSMENT#{registrationId}#{assessmentId}', () => {
      expect(EntityKeyBuilder.internalAssessment('R', 'A')).toBe('INTERNAL_ASSESSMENT#R#A');
    });

    it('EntityKeyBuilder.externalExamAdmitCard returns EXT_ADMIT_CARD#{registrationId} (1:1)', () => {
      expect(EntityKeyBuilder.externalExamAdmitCard('R')).toBe('EXT_ADMIT_CARD#R');
    });

    it('EntityKeyBuilder.externalExamResult returns EXT_EXAM_RESULT#{registrationId} (1:1)', () => {
      expect(EntityKeyBuilder.externalExamResult('R')).toBe('EXT_EXAM_RESULT#R');
    });

    it('EntityKeyBuilder.externalExamRetake returns EXT_EXAM_RETAKE#{originalResultId}#{retakeId}', () => {
      expect(EntityKeyBuilder.externalExamRetake('Res', 'Rt')).toBe('EXT_EXAM_RETAKE#Res#Rt');
    });

    it('EntityKeyBuilder.externalExamRegistrationLock is deterministic on (schoolId, studentId, examType, examYear)', () => {
      const k1 = EntityKeyBuilder.externalExamRegistrationLock('S', 'St', 'BLE', 2083);
      const k2 = EntityKeyBuilder.externalExamRegistrationLock('S', 'St', 'BLE', 2083);
      expect(k1).toBe(k2);
      expect(k1).toBe('EXT_EXAM_REG_LOCK#S#St#BLE#2083');
    });

    it('EntityKeyBuilder.externalExamSymbolLock is deterministic on (examType, examYear, symbolNumber)', () => {
      const k1 = EntityKeyBuilder.externalExamSymbolLock('BLE', 2083, 'SYM-007');
      const k2 = EntityKeyBuilder.externalExamSymbolLock('BLE', 2083, 'SYM-007');
      expect(k1).toBe(k2);
      expect(k1).toBe('EXT_EXAM_SYMBOL_LOCK#BLE#2083#SYM-007');
    });

    it('ExternalExamsModule shell has ZERO providers (D.3 foundation only)', () => {
      const providers = getModuleProviders(ExternalExamsModule);
      expect(providers).toHaveLength(0);
    });

    it('ExternalExamsModule shell has ZERO controllers (D.4 adds them)', () => {
      const controllers = Reflect.getMetadata('controllers', ExternalExamsModule) ?? [];
      expect(controllers).toHaveLength(0);
    });
  });

  // ============================================================================
  // Sprint 2 — AttendancePolicyResolverService injects IdentityClientService +
  // TenantMetadataReaderService; both must be declared on AttendanceModule.
  // ============================================================================
  describe('Attendance policy resolver wiring (Sprint 2)', () => {
    it('AttendanceModule.providers includes the resolver + its TenantMetadataReaderService dep', () => {
      const providers = getModuleProviders(AttendanceModule);
      expect(providers).toContain(AttendancePolicyResolverService);
      expect(providers).toContain(TenantMetadataReaderService);
    });
  });
});

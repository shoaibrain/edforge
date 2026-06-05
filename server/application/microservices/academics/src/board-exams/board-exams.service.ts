/**
 * BoardExamsService — Sprint GB2.2.
 *
 * Lazily seeds a school's board-exam definitions from the archetype profile on
 * first empty list (seed-on-empty seam, mirroring `PromotionRulesService.
 * ensureDefaultRule` / D.2.3). Idempotent + concurrency-safe via
 * `attribute_not_exists(entityKey)`; a non-empty set is operator-owned and is
 * never topped up. Grade-gated to the school's coverage so a primary-only school
 * doesn't get SEE@10 (and PABSON's grade-10 ceiling excludes NEB_11/NEB_12).
 *
 * Archetype is resolved exactly as D.2.3 does (TenantMetadataReader → archetype
 * → `getArchetypeDefaults`); unknown/missing archetype → seed nothing (fail-soft,
 * never a 5xx on the operator GET). GENERIC has no board exams, so seeding is a
 * no-op there.
 */

import { Injectable, Logger } from '@nestjs/common';
import { getArchetypeDefaults, type BoardExamDefinition } from '@aibrains/shared-types';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  TenantMetadataReaderService,
} from '../common/services/tenant-metadata-reader.service';
import { resolveArchetypeOrDegrade } from '../common/services/resolve-archetype';
import { RequestContext } from '../common/entities/base.entity';
import {
  BoardExamEntity,
  createBoardExamEntity,
} from '../common/entities/board-exam.entity';

@Injectable()
export class BoardExamsService {
  private readonly logger = new Logger(BoardExamsService.name);
  private _tenantMetadataReader?: TenantMetadataReaderService;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * List a school's board exams, lazily seeding from the archetype profile the
   * first time the set is empty. Returns the (possibly just-seeded) rows.
   */
  async listBoardExams(
    schoolId: string,
    context: RequestContext,
  ): Promise<BoardExamEntity[]> {
    const existing = await this.queryBoardExams(schoolId, context);
    if (existing.length > 0) return existing;
    return this.getOrSeedBoardExams(schoolId, context);
  }

  /**
   * Seed the archetype's board exams for a school if none exist yet. Safe to
   * call concurrently: each row is written under `attribute_not_exists`, and a
   * losing writer simply re-queries the winner's rows.
   */
  async getOrSeedBoardExams(
    schoolId: string,
    context: RequestContext,
  ): Promise<BoardExamEntity[]> {
    const archetype = await this.resolveTenantArchetype(context.tenantId);
    const definitions = this.boardExamDefinitionsFor(archetype);
    if (definitions.length === 0) return [];

    // No top-up: a partial/non-empty set is operator-owned (they may have
    // deleted one). Only seed into a genuinely empty set.
    const existing = await this.queryBoardExams(schoolId, context);
    if (existing.length > 0) return existing;

    const maxGrade = await this.resolveSchoolMaxGrade(schoolId, context);
    const candidates = definitions.filter(
      (def) => boardExamGradeNumber(def) <= maxGrade,
    );

    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    for (const def of candidates) {
      const entity = createBoardExamEntity(
        context.tenantId,
        schoolId,
        archetype as string,
        def,
        context.userId,
      );
      try {
        await this.dynamoDBClient.putItem(
          client,
          entity,
          'attribute_not_exists(entityKey)',
        );
        this.logger.log(
          `Seeded BoardExam ${def.examType} (grade ${def.grade}) schoolId=${schoolId} archetype=${archetype}`,
        );
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
          this.logger.debug(
            `BoardExam ${def.examType} already present (concurrent seed) schoolId=${schoolId}`,
          );
          continue;
        }
        throw err;
      }
    }
    return this.queryBoardExams(schoolId, context);
  }

  private boardExamDefinitionsFor(archetype?: string): BoardExamDefinition[] {
    if (!archetype) return [];
    try {
      return [...getArchetypeDefaults(archetype).boardExams];
    } catch (err) {
      this.logger.warn(
        `boardExamDefinitionsFor: unknown archetype=${archetype}; seeding nothing. err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async queryBoardExams(
    schoolId: string,
    context: RequestContext,
  ): Promise<BoardExamEntity[]> {
    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );
    const res = await this.dynamoDBClient.query<BoardExamEntity>(
      client,
      context.tenantId,
      `BOARD_EXAM#${schoolId}#`,
    );
    return res.items;
  }

  /**
   * The school's highest covered grade as an integer. On any failure we gate to
   * 0 (seed nothing) rather than guess high — an operator can create board exams
   * manually, but we must never seed an exam for a grade a school doesn't run.
   */
  private async resolveSchoolMaxGrade(
    schoolId: string,
    context: RequestContext,
  ): Promise<number> {
    try {
      const school = await this.identityClient.getSchool(schoolId, context);
      return gradeCodeToNumber(school.gradeRange?.end);
    } catch (err) {
      this.logger.warn(
        `resolveSchoolMaxGrade: getSchool failed schoolId=${schoolId}; gating to 0. err=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  private resolveTenantArchetype(tenantId: string): Promise<string | undefined> {
    return resolveArchetypeOrDegrade(
      this.getTenantMetadataReader(),
      tenantId,
      this.logger,
      'seeding nothing',
    );
  }

  private getTenantMetadataReader(): TenantMetadataReaderService {
    if (!this._tenantMetadataReader) {
      this._tenantMetadataReader = new TenantMetadataReaderService();
    }
    return this._tenantMetadataReader;
  }
}

/** Numeric grade of a board-exam definition (grade may be a number or a code). */
function boardExamGradeNumber(def: BoardExamDefinition): number {
  return typeof def.grade === 'number' ? def.grade : gradeCodeToNumber(def.grade);
}

/**
 * Trailing-integer of a grade code: '10'→10, 'Class 10'→10, 'Grade 8'→8,
 * 'UKG'/'ECD'→0. Conservative (0 when no digits) so non-numeric early grades
 * never accidentally clear a board-exam grade gate.
 */
function gradeCodeToNumber(code?: string): number {
  if (!code) return 0;
  const m = String(code).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

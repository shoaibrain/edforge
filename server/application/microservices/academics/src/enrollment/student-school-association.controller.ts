/**
 * Student-School-Association controller — Sprint 3 (S3.3).
 *
 * Ed-Fi projection over the internal Enrollment entity. Keeps the Ed-Fi
 * surface-area separate from the EnrollmentController so downstream IEMIS
 * exporters (Sprint 10) have a stable canonical endpoint to consume without
 * coupling to internal Enrollment semantics.
 *
 * No writes here — SSA is a read projection per the Option B architecture
 * call (2026-04-23). Writes stay on EnrollmentController (create, update,
 * withdraw, transfer).
 *
 * Not-yet-implemented: `GET /schools/:schoolId/years/:yearId/student-school-associations`
 * — the bulk list-by-year. Deferred to Sprint 10 where it will be wired
 * alongside the actual Flash I exporter and can carry the paging / batching
 * semantics the export flow requires.
 */

import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import {
  type StudentSchoolAssociation,
  enrollmentToStudentSchoolAssociation,
} from '@aibrains/shared-types';
import { EnrollmentService } from './enrollment.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import type { RequestContext } from '../common/entities';

@Controller('academics')
@UseGuards(JwtAuthGuard)
export class StudentSchoolAssociationController {
  private readonly logger = new Logger(StudentSchoolAssociationController.name);

  constructor(
    private readonly enrollmentService: EnrollmentService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * GET /academics/schools/:schoolId/years/:yearId/students/:studentId/student-school-association
   *
   * findByComposite — idempotent read of a single Ed-Fi SSA.
   */
  @Get('schools/:schoolId/years/:yearId/students/:studentId/student-school-association')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async findByComposite(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StudentSchoolAssociation> {
    const context = this.buildContext(tenant, req, schoolId);

    const enrollment = await this.enrollmentService.getEnrollment(
      schoolId,
      yearId,
      studentId,
      context,
    );
    if (!enrollment) {
      throw new NotFoundException('StudentSchoolAssociation not found');
    }

    const year = await this.fetchAcademicYear(schoolId, yearId, context);
    return enrollmentToStudentSchoolAssociation(
      enrollment as any,
      year ?? null,
    );
  }

  /**
   * GET /academics/students/:studentId/student-school-associations?schoolId=…
   *
   * listByStudent — every SSA for a given student across all academic years.
   * Bounded by the number of years the student has been enrolled (typically
   * ≤12), so no paging for now.
   */
  @Get('students/:studentId/student-school-associations')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'students', action: 'view' })
  async listByStudent(
    @Param('studentId') studentId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<{ items: StudentSchoolAssociation[] }> {
    const context = this.buildContext(tenant, req, schoolId);

    const history = await this.enrollmentService.getStudentEnrollmentHistory(
      studentId,
      context,
    );
    const yearCache = new Map<string, any>();
    const items: StudentSchoolAssociation[] = [];
    for (const enrollment of history) {
      const yearId = (enrollment as any).academicYearId as string;
      if (!yearCache.has(yearId)) {
        const year = await this.fetchAcademicYear(
          (enrollment as any).schoolId,
          yearId,
          context,
        );
        yearCache.set(yearId, year);
      }
      items.push(
        enrollmentToStudentSchoolAssociation(
          enrollment as any,
          yearCache.get(yearId) ?? null,
        ),
      );
    }
    this.logger.debug(
      `listByStudent: studentId=${studentId} results=${items.length}`,
    );
    return { items };
  }

  // --------------------------------------------------------------------- //
  // Helpers                                                               //
  // --------------------------------------------------------------------- //

  private buildContext(
    tenant: TenantContext,
    req: Request,
    schoolId: string,
  ): RequestContext {
    const jwt = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    return {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      email: (tenant as any).email ?? '',
      role: (tenant as any).role ?? 'TenantAdmin',
      jwtToken: jwt,
      schoolId,
    };
  }

  private async fetchAcademicYear(
    schoolId: string,
    yearId: string,
    context: RequestContext,
  ) {
    try {
      const years = await this.identityClient.getAcademicYears(
        schoolId,
        context as any,
      );
      return years.find((y: any) => y.id === yearId || y.academicYearId === yearId) ?? null;
    } catch (err) {
      this.logger.warn(
        `fetchAcademicYear: identity lookup failed for schoolId=${schoolId} yearId=${yearId} — proceeding without schoolYear reference`,
      );
      return null;
    }
  }
}

import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { GradingService } from './grading.service';
import { CreateGradeDto, UpdateGradeDto } from './dto/grading.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('assessment/grades')
export class GradingController {
  constructor(private readonly gradingService: GradingService) {}

  /**
   * Build RequestContext from incoming request (following school service pattern)
   */
  private buildContext(req: any, tenant: any): RequestContext {
    return {
      userId: req.user?.userId || 'unknown',
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      tenantId: tenant.tenantId
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createGrade(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() createDto: CreateGradeDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.gradingService.createGrade(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      createDto,
      context
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getGradesByClassroom(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Query() filters: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.gradingService.getGradesByClassroom(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      filters,
      jwtToken
    );
  }

  @Get('students/:studentId/assignments/:assignmentId')
  @UseGuards(JwtAuthGuard)
  async getGrade(
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.gradingService.getGrade(
      tenant.tenantId,
      schoolId,
      academicYearId,
      studentId,
      assignmentId,
      jwtToken
    );
  }

  @Put('students/:studentId/assignments/:assignmentId')
  @UseGuards(JwtAuthGuard)
  async updateGrade(
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() updateDto: UpdateGradeDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.gradingService.updateGrade(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      studentId,
      assignmentId,
      updateDto,
      context
    );
  }

  @Put('students/:studentId/assignments/:assignmentId/publish')
  @UseGuards(JwtAuthGuard)
  async publishGrade(
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.gradingService.publishGrade(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      studentId,
      assignmentId,
      context
    );
  }

  @Get('students/:studentId')
  @UseGuards(JwtAuthGuard)
  async getGradesByStudent(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.gradingService.getGradesByStudent(
      tenant.tenantId,
      studentId,
      academicYearId,
      jwtToken
    );
  }

  @Get('students/:studentId/course-grade')
  @UseGuards(JwtAuthGuard)
  async calculateCourseGrade(
    @Param('studentId') studentId: string,
    @Query('classroomId') classroomId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.gradingService.calculateCourseGrade(
      tenant.tenantId,
      studentId,
      classroomId,
      academicYearId,
      jwtToken
    );
  }
}

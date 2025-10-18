import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { GradingService } from './grading.service';
import { CreateGradeDto, UpdateGradeDto } from './dto/grading.dto';
import { RequestContext } from './entities/grading.entity';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('academic/schools/:schoolId/academic-years/:academicYearId/classrooms/:classroomId/grades')
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
    @Param('assignmentId') assignmentId: string,
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

  @Get('/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async getGradesByStudent(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('studentId') studentId: string,
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

  @Get('/students/:studentId/course-grade')
  @UseGuards(JwtAuthGuard)
  async calculateCourseGrade(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
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

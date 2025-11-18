import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AssignmentService } from './assignment.service';
import { CreateAssignmentDto, UpdateAssignmentDto } from './dto/assignment.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('assessment/assignments')
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  /**
   * Build RequestContext from incoming request
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
  async createAssignment(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() createDto: CreateAssignmentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.assignmentService.createAssignment(
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
  async getAssignments(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Query() filters: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.assignmentService.getAssignments(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      filters,
      jwtToken
    );
  }

  @Get(':assignmentId')
  @UseGuards(JwtAuthGuard)
  async getAssignment(
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.assignmentService.getAssignment(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      assignmentId,
      jwtToken
    );
  }

  @Put(':assignmentId')
  @UseGuards(JwtAuthGuard)
  async updateAssignment(
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() updateDto: UpdateAssignmentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.assignmentService.updateAssignment(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      assignmentId,
      updateDto,
      context
    );
  }

  @Put(':assignmentId/publish')
  @UseGuards(JwtAuthGuard)
  async publishAssignment(
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.assignmentService.publishAssignment(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      assignmentId,
      context
    );
  }

  @Put(':assignmentId/archive')
  @UseGuards(JwtAuthGuard)
  async archiveAssignment(
    @Param('assignmentId') assignmentId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.assignmentService.archiveAssignment(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      assignmentId,
      context
    );
  }

  @Get('teachers/:teacherId')
  @UseGuards(JwtAuthGuard)
  async getAssignmentsByTeacher(
    @Param('teacherId') teacherId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.assignmentService.getAssignmentsByTeacher(
      tenant.tenantId,
      teacherId,
      academicYearId,
      jwtToken
    );
  }
}

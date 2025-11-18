import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ClassroomService } from './classroom.service';
import { CreateClassroomDto, UpdateClassroomDto } from './dto/classroom.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('curriculum/classrooms')
export class ClassroomController {
  constructor(private readonly classroomService: ClassroomService) {}

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

  /**
   * Create a new classroom
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async createClassroom(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Body() createDto: CreateClassroomDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.classroomService.createClassroom(
      tenant.tenantId,
      schoolId,
      academicYearId,
      createDto,
      context
    );
  }

  /**
   * Get all classrooms for school/year
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getClassrooms(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query() filters: any,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.classroomService.getClassrooms(
      tenant.tenantId,
      schoolId,
      academicYearId,
      filters,
      jwtToken
    );
  }

  /**
   * Get classroom by ID
   */
  @Get(':classroomId')
  @UseGuards(JwtAuthGuard)
  async getClassroom(
    @Param('classroomId') classroomId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.classroomService.getClassroom(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      jwtToken
    );
  }

  /**
   * Update classroom
   */
  @Put(':classroomId')
  @UseGuards(JwtAuthGuard)
  async updateClassroom(
    @Param('classroomId') classroomId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Body() updateDto: UpdateClassroomDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.classroomService.updateClassroom(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      updateDto,
      context
    );
  }

  /**
   * Get classrooms by teacher
   */
  @Get('teachers/:teacherId')
  @UseGuards(JwtAuthGuard)
  async getClassroomsByTeacher(
    @Param('teacherId') teacherId: string,
    @Query('academicYearId') academicYearId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.classroomService.getClassroomsByTeacher(
      tenant.tenantId,
      teacherId,
      academicYearId,
      jwtToken
    );
  }
}


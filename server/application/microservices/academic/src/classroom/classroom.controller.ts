import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ClassroomService } from './classroom.service';
import { CreateClassroomDto, UpdateClassroomDto, EnrollStudentDto } from './dto/classroom.dto';
import { RequestContext } from './entities/classroom.entity';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('academic/schools/:schoolId/academic-years/:academicYearId/classrooms')
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
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
   * Enroll student in classroom
   */
  @Post(':classroomId/students')
  @UseGuards(JwtAuthGuard)
  async enrollStudent(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Body() enrollDto: EnrollStudentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.classroomService.enrollStudent(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      enrollDto.studentId,
      context
    );
  }

  /**
   * Unenroll student from classroom
   */
  @Delete(':classroomId/students/:studentId')
  @UseGuards(JwtAuthGuard)
  async unenrollStudent(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.classroomService.unenrollStudent(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      studentId,
      context
    );
  }

  /**
   * Get classrooms by teacher
   */
  @Get('/teachers/:teacherId')
  @UseGuards(JwtAuthGuard)
  async getClassroomsByTeacher(
    @Param('schoolId') schoolId: string,
    @Param('academicYearId') academicYearId: string,
    @Param('teacherId') teacherId: string,
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


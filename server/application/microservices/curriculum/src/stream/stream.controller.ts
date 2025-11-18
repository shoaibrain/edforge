import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { StreamService } from './stream.service';
import { CreateStreamPostDto, UpdateStreamPostDto, CreatePostCommentDto, StreamPostFiltersDto } from './dto/stream.dto';
import type { RequestContext } from '@edforge/shared-types';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('curriculum/stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  /**
   * Build RequestContext from incoming request
   */
  private buildContext(req: any, tenant: any): RequestContext {
    return {
      userId: req.user?.userId || 'unknown',
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      tenantId: tenant.tenantId,
      userName: req.user?.name || 'Unknown User',
      userRole: req.user?.role || 'student',
      userAvatar: req.user?.avatar
    };
  }

  /**
   * Create a new stream post
   */
  @Post('posts')
  @UseGuards(JwtAuthGuard)
  async createPost(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() createDto: CreateStreamPostDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.streamService.createPost(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      createDto,
      context
    );
  }

  /**
   * Get stream posts for a classroom
   */
  @Get('posts')
  @UseGuards(JwtAuthGuard)
  async getStreamPosts(
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Query() filters: StreamPostFiltersDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.streamService.getStreamPosts(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      filters,
      jwtToken
    );
  }

  /**
   * Get a specific stream post
   */
  @Get('posts/:postId')
  @UseGuards(JwtAuthGuard)
  async getStreamPost(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.streamService.getStreamPost(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      jwtToken
    );
  }

  /**
   * Update a stream post
   */
  @Put('posts/:postId')
  @UseGuards(JwtAuthGuard)
  async updateStreamPost(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() updateDto: UpdateStreamPostDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.streamService.updateStreamPost(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      updateDto,
      context
    );
  }

  /**
   * Delete a stream post
   */
  @Delete('posts/:postId')
  @UseGuards(JwtAuthGuard)
  async deleteStreamPost(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.streamService.deleteStreamPost(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      context
    );
  }

  /**
   * Pin/unpin a stream post
   */
  @Put('posts/:postId/pin')
  @UseGuards(JwtAuthGuard)
  async togglePinPost(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.streamService.togglePinPost(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      context
    );
  }

  /**
   * Create a comment on a stream post
   */
  @Post('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  async createComment(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @Body() createDto: CreatePostCommentDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const context = this.buildContext(req, tenant);
    return this.streamService.createComment(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      createDto,
      context
    );
  }

  /**
   * Get comments for a stream post
   */
  @Get('posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  async getPostComments(
    @Param('postId') postId: string,
    @Query('schoolId') schoolId: string,
    @Query('academicYearId') academicYearId: string,
    @Query('classroomId') classroomId: string,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return this.streamService.getPostComments(
      tenant.tenantId,
      schoolId,
      academicYearId,
      classroomId,
      postId,
      jwtToken
    );
  }
}

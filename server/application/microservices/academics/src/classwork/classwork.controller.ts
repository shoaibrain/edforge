/**
 * Classwork Controller
 *
 * REST endpoints for classwork item and topic CRUD within class sections.
 * All endpoints require authentication (JwtAuthGuard) and scheduling permissions.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ClassworkService } from './classwork.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RequestContext } from '../common/entities';
import { ClassworkItemResponseDto, ClassworkTopicResponseDto, SectionClassworkResponseDto } from '../common/mappers/classwork.mapper';

// UUID v4 pattern for input validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CLASSWORK_TYPES = ['assignment', 'quiz', 'material', 'question'] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_POSSIBLE_POINTS = 0;
const MAX_POSSIBLE_POINTS = 10000;

@Controller('academics/classwork')
@UseGuards(JwtAuthGuard)
export class ClassworkController {
  private readonly logger = new Logger(ClassworkController.name);

  constructor(private readonly classworkService: ClassworkService) {}

  // ============================================================================
  // ITEMS
  // ============================================================================

  /**
   * Get all classwork for a section (items + topics, grouped)
   * GET /academics/classwork?sectionId=xxx&schoolId=xxx
   */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'view' })
  async getSectionClasswork(
    @Query('sectionId') sectionId: string,
    @Query('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SectionClassworkResponseDto> {
    this.logger.log(`GET /academics/classwork — sectionId=${sectionId} schoolId=${schoolId}`);
    if (!sectionId || !schoolId) {
      throw new BadRequestException('sectionId and schoolId are required');
    }
    if (!UUID_REGEX.test(sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    if (!UUID_REGEX.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.getSectionClasswork(sectionId, schoolId, context);
  }

  /**
   * Create a classwork item
   * POST /academics/classwork
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'create' })
  async createItem(
    @Body() dto: {
      sectionId: string;
      schoolId: string;
      type: string;
      title: string;
      description?: string;
      topicId?: string;
      categoryId?: string;
      categoryName?: string;
      assessmentCategory?: string;
      possiblePoints?: number;
      dueDate?: string;
      status?: string;
    },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ClassworkItemResponseDto> {
    this.logger.log(`POST /academics/classwork — sectionId=${dto.sectionId} schoolId=${dto.schoolId} type=${dto.type} title=${dto.title}`);
    if (!dto.sectionId || !dto.schoolId || !dto.title || !dto.type) {
      throw new BadRequestException('sectionId, schoolId, type, and title are required');
    }
    if (!UUID_REGEX.test(dto.sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    if (!UUID_REGEX.test(dto.schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!VALID_CLASSWORK_TYPES.includes(dto.type as any)) {
      throw new BadRequestException(
        `type must be one of: ${VALID_CLASSWORK_TYPES.join(', ')}`,
      );
    }
    if (dto.title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `title must not exceed ${MAX_TITLE_LENGTH} characters`,
      );
    }
    if (dto.description !== undefined && dto.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    if (dto.possiblePoints !== undefined) {
      if (
        typeof dto.possiblePoints !== 'number' ||
        dto.possiblePoints < MIN_POSSIBLE_POINTS ||
        dto.possiblePoints > MAX_POSSIBLE_POINTS
      ) {
        throw new BadRequestException(
          `possiblePoints must be a number between ${MIN_POSSIBLE_POINTS} and ${MAX_POSSIBLE_POINTS}`,
        );
      }
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.createItem(dto as any, context);
  }

  /**
   * Update a classwork item
   * PATCH /academics/classwork/:itemId?schoolId=xxx&sectionId=xxx
   */
  @Patch(':itemId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async updateItem(
    @Param('itemId') itemId: string,
    @Query('schoolId') schoolId: string,
    @Query('sectionId') sectionId: string,
    @Body() dto: any,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ClassworkItemResponseDto> {
    this.logger.log(`PATCH /academics/classwork/${itemId} — schoolId=${schoolId} sectionId=${sectionId} bodyKeys=${Object.keys(dto).join(',')}`);
    if (!schoolId || !sectionId) {
      throw new BadRequestException('schoolId and sectionId query params are required');
    }
    if (!UUID_REGEX.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!UUID_REGEX.test(sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    if (dto.type !== undefined && !VALID_CLASSWORK_TYPES.includes(dto.type)) {
      throw new BadRequestException(
        `type must be one of: ${VALID_CLASSWORK_TYPES.join(', ')}`,
      );
    }
    if (dto.title !== undefined && dto.title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `title must not exceed ${MAX_TITLE_LENGTH} characters`,
      );
    }
    if (dto.description !== undefined && dto.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    if (dto.possiblePoints !== undefined) {
      if (
        typeof dto.possiblePoints !== 'number' ||
        dto.possiblePoints < MIN_POSSIBLE_POINTS ||
        dto.possiblePoints > MAX_POSSIBLE_POINTS
      ) {
        throw new BadRequestException(
          `possiblePoints must be a number between ${MIN_POSSIBLE_POINTS} and ${MAX_POSSIBLE_POINTS}`,
        );
      }
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.updateItem(itemId, schoolId, sectionId, dto, context);
  }

  /**
   * Delete a classwork item
   * DELETE /academics/classwork/:itemId?schoolId=xxx&sectionId=xxx
   */
  @Delete(':itemId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async deleteItem(
    @Param('itemId') itemId: string,
    @Query('schoolId') schoolId: string,
    @Query('sectionId') sectionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/classwork/${itemId} — schoolId=${schoolId} sectionId=${sectionId}`);
    if (!schoolId || !sectionId) {
      throw new BadRequestException('schoolId and sectionId query params are required');
    }
    if (!UUID_REGEX.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!UUID_REGEX.test(sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.deleteItem(itemId, schoolId, sectionId, context);
  }

  // ============================================================================
  // TOPICS
  // ============================================================================

  /**
   * Create a classwork topic
   * POST /academics/classwork/topics
   */
  @Post('topics')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'create' })
  async createTopic(
    @Body() dto: { sectionId: string; schoolId: string; name: string },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ClassworkTopicResponseDto> {
    this.logger.log(`POST /academics/classwork/topics — sectionId=${dto.sectionId} schoolId=${dto.schoolId} name=${dto.name}`);
    if (!dto.sectionId || !dto.schoolId || !dto.name) {
      throw new BadRequestException('sectionId, schoolId, and name are required');
    }
    if (!UUID_REGEX.test(dto.sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    if (!UUID_REGEX.test(dto.schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (dto.name.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `name must not exceed ${MAX_TITLE_LENGTH} characters`,
      );
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.createTopic(dto, context);
  }

  /**
   * Update a classwork topic
   * PATCH /academics/classwork/topics/:topicId?schoolId=xxx&sectionId=xxx
   */
  @Patch('topics/:topicId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async updateTopic(
    @Param('topicId') topicId: string,
    @Query('schoolId') schoolId: string,
    @Query('sectionId') sectionId: string,
    @Body() dto: { name?: string; sortOrder?: number },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<ClassworkTopicResponseDto> {
    this.logger.log(`PATCH /academics/classwork/topics/${topicId} — schoolId=${schoolId} sectionId=${sectionId} bodyKeys=${Object.keys(dto).join(',')}`);
    if (!schoolId || !sectionId) {
      throw new BadRequestException('schoolId and sectionId query params are required');
    }
    if (!UUID_REGEX.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!UUID_REGEX.test(sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    if (dto.name !== undefined && dto.name.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `name must not exceed ${MAX_TITLE_LENGTH} characters`,
      );
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.updateTopic(topicId, schoolId, sectionId, dto, context);
  }

  /**
   * Delete a classwork topic (unassigns items)
   * DELETE /academics/classwork/topics/:topicId?schoolId=xxx&sectionId=xxx
   */
  @Delete('topics/:topicId')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async deleteTopic(
    @Param('topicId') topicId: string,
    @Query('schoolId') schoolId: string,
    @Query('sectionId') sectionId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`DELETE /academics/classwork/topics/${topicId} — schoolId=${schoolId} sectionId=${sectionId}`);
    if (!schoolId || !sectionId) {
      throw new BadRequestException('schoolId and sectionId query params are required');
    }
    if (!UUID_REGEX.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!UUID_REGEX.test(sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.deleteTopic(topicId, schoolId, sectionId, context);
  }

  // ============================================================================
  // REORDER
  // ============================================================================

  /**
   * Reorder classwork items and topics
   * PATCH /academics/classwork/reorder
   */
  @Patch('reorder')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'scheduling', action: 'edit' })
  async reorderItems(
    @Body() dto: {
      schoolId: string;
      sectionId: string;
      items: Array<{ id: string; type: 'item' | 'topic'; sortOrder: number; topicId?: string | null }>;
    },
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    this.logger.log(`PATCH /academics/classwork/reorder — schoolId=${dto.schoolId} sectionId=${dto.sectionId} itemCount=${dto.items?.length || 0}`);
    if (!dto.schoolId || !dto.sectionId || !dto.items?.length) {
      throw new BadRequestException('schoolId, sectionId, and items are required');
    }
    if (!UUID_REGEX.test(dto.schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    if (!UUID_REGEX.test(dto.sectionId)) {
      throw new BadRequestException('sectionId must be a valid UUID');
    }
    const context = this.buildContext(tenant, req);
    return this.classworkService.reorderItems(dto.schoolId, dto.sectionId, dto.items, context);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      role: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}

/**
 * Classwork Module
 *
 * Provides classwork item and topic management within class sections.
 * Supports assignments, quizzes, materials, and questions organized by topics.
 */

import { Module } from '@nestjs/common';
import { ClassworkController } from './classwork.controller';
import { ClassworkService } from './classwork.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { DataScopeService } from '../common/services/data-scope.service';
import { HttpClientModule } from '@app/http-client';
import { AuthModule } from '@app/auth';

@Module({
  imports: [
    AuthModule,
    HttpClientModule,
  ],
  controllers: [ClassworkController],
  providers: [
    ClassworkService,
    DynamoDBClientService,
    AcademicsEventsService,
    IdentityClientService,
    PermissionGuard,
    DataScopeService,
  ],
  exports: [ClassworkService],
})
export class ClassworkModule {}

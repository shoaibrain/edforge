import { Module } from '@nestjs/common';
import { ClassroomController } from './classroom.controller';
import { ClassroomService } from './classroom.service';
import { ValidationService } from './services/validation.service';
import { CurriculumEventsService } from '../common/services/curriculum-events.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';
import { CacheModule } from '@app/cache';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Module({
  imports: [AuthModule, ClientFactoryModule, CacheModule],
  controllers: [ClassroomController],
  providers: [ClassroomService, ValidationService, CurriculumEventsService, DynamoDBClientService],
  exports: [ClassroomService],
})
export class ClassroomModule {}


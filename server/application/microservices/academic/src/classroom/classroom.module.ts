import { Module } from '@nestjs/common';
import { ClassroomController } from './classroom.controller';
import { ClassroomService } from './classroom.service';
import { ValidationService } from './services/validation.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';
import { DynamoDBClientService } from '../common/dynamodb-client.service';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [ClassroomController],
  providers: [ClassroomService, ValidationService, DynamoDBClientService],
  exports: [ClassroomService],
})
export class ClassroomModule {}


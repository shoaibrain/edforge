import { Module } from '@nestjs/common';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { ValidationService } from './services/validation.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [AssignmentController],
  providers: [AssignmentService, ValidationService],
  exports: [AssignmentService],
})
export class AssignmentModule {}


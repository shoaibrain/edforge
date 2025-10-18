import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ValidationService } from './services/validation.service';
import { AuthModule } from '@app/auth';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, ValidationService],
  exports: [AttendanceService],
})
export class AttendanceModule {}


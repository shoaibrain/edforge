/**
 * Admin Module - Administrative operations
 */

import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { RolesModule } from '../roles/roles.module';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [AdminController],
})
export class AdminModule {}

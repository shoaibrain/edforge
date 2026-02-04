/**
 * Roles Module
 */

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuthModule } from '@app/auth';
import { DEFAULT_ROLE_PERMISSIONS } from '../common/entities/role-assignment.entity';
import {
  PERMISSION_REGISTRY,
  validatePermissionsAgainstRegistry,
} from '../common/constants/permission-registry';

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesService, DynamoDBClientService, IdentityEventsService],
  exports: [RolesService],
})
export class RolesModule implements OnModuleInit {
  private readonly logger = new Logger(RolesModule.name);

  onModuleInit() {
    const result = validatePermissionsAgainstRegistry(
      DEFAULT_ROLE_PERMISSIONS,
      PERMISSION_REGISTRY,
    );

    if (!result.valid) {
      for (const error of result.errors) {
        this.logger.error(`Permission validation error: ${error}`);
      }
      throw new Error(
        `Permission registry validation failed with ${result.errors.length} error(s). ` +
        `DEFAULT_ROLE_PERMISSIONS references undefined resources or actions. Fix the registry or the role permissions.`
      );
    }

    this.logger.log('Permission registry validated successfully against DEFAULT_ROLE_PERMISSIONS');
  }
}

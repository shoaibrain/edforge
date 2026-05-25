/**
 * BrandingModule — Sprint C.0.7
 *
 * Three endpoints for per-school PDF branding management:
 *   GET    /schools/:schoolId/branding
 *   POST   /schools/:schoolId/branding/assets/upload-url
 *   PATCH  /schools/:schoolId/branding
 *
 * Module-wiring (per [[feedback-module-wiring-invariant]]): every service
 * this module's controllers inject must be declared in this module's own
 * `providers` array — child modules don't inherit IdentityModule exports.
 * The wiring-spec at `__tests__/module-wiring.spec.ts` enforces this
 * statically.
 */

import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { S3PresignerService } from '../common/services/s3-presigner.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RolesService } from '../roles/roles.service';
import { AuthModule } from '@app/auth';

/**
 * Sprint C.0-followup: BrandingController now uses PermissionGuard + the
 * `branding:configure` permission (was @RequireGlobalRole('TenantAdmin')).
 * PermissionGuard injects Reflector (auto-provided by NestCore) +
 * RolesService + DynamoDBClientService. RolesService in turn injects
 * IdentityEventsService — so it's added here per [[feedback-module-wiring-invariant]].
 */
@Module({
  imports: [AuthModule],
  controllers: [BrandingController],
  providers: [
    BrandingService,
    DynamoDBClientService,
    S3PresignerService,
    AuditedWriteService,
    IdentityEventsService,
    PermissionGuard,
    RolesService,
  ],
  exports: [BrandingService],
})
export class BrandingModule {}

/**
 * PdfTemplatesModule — Sprint C.1.3
 *
 * One read-only endpoint for resolving the current PDF template per
 * (school, docType). Lazy-default — the underlying DDB row does not exist
 * until the C.2.x editor saves an operator customization; until then
 * every GET returns the descriptor's archetype-aware defaults computed
 * fresh from `@aibrains/pdf-renderer`.
 *
 * Module-wiring (per [[feedback-module-wiring-invariant]]): every service
 * this module's controllers inject must be declared in this module's own
 * `providers` array — child modules don't inherit IdentityModule exports.
 *
 * PermissionGuard chain:
 *   PermissionGuard (Reflector + RolesService + DynamoDBClientService)
 *     → RolesService (DynamoDBClientService + IdentityEventsService)
 * All four deps must be locally declared. The wiring-spec at
 * `__tests__/module-wiring.spec.ts` enforces this statically.
 *
 * `AuditedWriteService` is intentionally NOT listed in providers — the
 * V1 endpoint is read-only and emits no audit rows. The editor sprint
 * (C.2.x) will add it when the PATCH path lands.
 */

import { Module } from '@nestjs/common';
import { PdfTemplatesController } from './pdf-templates.controller';
import { PdfTemplatesService } from './pdf-templates.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { PermissionGuard } from '../common/guards/permission.guard';
import { RolesService } from '../roles/roles.service';
import { AuthModule } from '@app/auth';

@Module({
  imports: [AuthModule],
  controllers: [PdfTemplatesController],
  providers: [
    PdfTemplatesService,
    DynamoDBClientService,
    IdentityEventsService,
    PermissionGuard,
    RolesService,
  ],
  exports: [PdfTemplatesService],
})
export class PdfTemplatesModule {}

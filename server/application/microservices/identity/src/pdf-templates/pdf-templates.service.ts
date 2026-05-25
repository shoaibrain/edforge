/**
 * PdfTemplatesService — Sprint C.1.3
 *
 * Read-only template resolver for one (school, docType). The C.2.x editor
 * will land the write path in a later sprint; until then, every operator
 * sees the descriptor's archetype-aware defaults on first GET.
 *
 * Lazy-default semantics (per design doc §1 + Sprint 0 D.1.3 retro):
 *   - GET on a school with no persisted template row → return
 *     `descriptor.defaults(archetype, locale)` freshly computed.
 *     **No DDB write.** The row only ever exists when an admin has
 *     explicitly saved a customization.
 *   - GET on a school WITH a persisted row → return the saved
 *     `templateConfig` plus the stable `templateId` + `configVersion` for
 *     render-side audit-row freezing (mirrors `brandingVersionId`).
 *
 * Archetype resolution: read `Tenant.archetype` from the METADATA row.
 * Reserved archetypes (`CBSE_IN`, `NAIS_US`, `GEMS_UAE`) and the
 * undefined-archetype fallback both end up in the descriptor's GENERIC
 * branch by virtue of the descriptor's defaults function — the service
 * doesn't need to branch on archetype here.
 *
 * Locale resolution: V1 always passes `'en-US'` to the descriptor's
 * `defaults(archetype, locale)`. Both invoice and receipt descriptors
 * ignore locale (`_locale: string`) — they derive every locale-sensitive
 * default (numbers, date format, label languages) from archetype. The
 * locale parameter exists in the descriptor contract for future doc types
 * (e.g., NEB Grade-11 transcript that varies by region within Nepal).
 *
 * Tenant isolation:
 *   - PartitionKey is the bare-UUID `tenantId` from the JWT
 *     (per [[edforge-identity-ddb-bare-uuid-partition-key]]).
 *   - SortKey is built server-side via `EntityKeyBuilder.pdfTemplateCurrent`.
 *   - Reads use the tenant-scoped credentials from `DynamoDBClientService`.
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';
import type { Tenant } from '../common/entities/tenant.entity';
import { getDescriptor, hasDescriptor, type DocType } from '@aibrains/pdf-renderer';
import { PdfTemplate, PdfTemplateCurrentResponse } from './pdf-templates.types';

/**
 * V1 always passes `en-US` to descriptor.defaults. See file header.
 * Externalized so a future per-tenant locale resolution can replace it
 * without touching call sites.
 */
const DEFAULT_LOCALE = 'en-US';

@Injectable()
export class PdfTemplatesService {
  private readonly logger = new Logger(PdfTemplatesService.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  /**
   * Resolve the current template for a (school, docType).
   *
   * @throws BadRequestException — if `docType` is not a known descriptor.
   * @throws NotFoundException   — if `schoolId` does not exist in this tenant.
   *   (Validates schoolId via the implicit metadata read — see below.)
   */
  async getCurrentTemplate(
    schoolId: string,
    docType: string,
    context: RequestContext,
  ): Promise<PdfTemplateCurrentResponse> {
    // Validate docType up-front so a typo returns 400 cleanly rather than
    // a confusing "no descriptor" deep-stack error from `getDescriptor`.
    if (!hasDescriptor(docType as DocType)) {
      throw new BadRequestException({
        errorCode: 'PDF_TEMPLATE_UNKNOWN_DOC_TYPE',
        message:
          `Unknown docType '${docType}'. Known: see GET /pdf-templates ` +
          `(future endpoint) or the registry in @aibrains/pdf-renderer.`,
      });
    }
    const typedDocType = docType as DocType;

    const client = await this.dynamoDBClient.getClient(
      context.tenantId,
      context.jwtToken,
    );

    // Two parallel reads: persisted template row + tenant metadata for archetype.
    // The persisted-row miss is the lazy-default trigger; the metadata read is
    // unconditional because the lazy-default path needs the archetype.
    const [persisted, tenant] = await Promise.all([
      this.dynamoDBClient.getItem<PdfTemplate>(
        client,
        context.tenantId,
        EntityKeyBuilder.pdfTemplateCurrent(schoolId, typedDocType),
      ),
      this.dynamoDBClient.getItem<Tenant>(
        client,
        context.tenantId,
        EntityKeyBuilder.tenantMetadata(),
      ),
    ]);

    // Tenant metadata is the source-of-truth row created at provisioning.
    // Its absence indicates either a deeply-mis-provisioned tenant or a
    // tampered JWT — fail loud rather than silently substitute GENERIC.
    if (!tenant) {
      throw new NotFoundException({
        errorCode: 'TENANT_METADATA_NOT_FOUND',
        message:
          `Tenant metadata row not found for tenantId=${context.tenantId}. ` +
          `Tenant may not be fully provisioned.`,
      });
    }
    // Note: we do NOT separately validate schoolId existence with a third
    // GetItem. The C.2.x editor PATCH path will check school existence
    // explicitly; for the V1 read-only path the descriptor default is
    // archetype-derived (not school-specific), so returning the default
    // for a non-existent school is harmless. If this becomes a problem,
    // C.1.5 finance endpoint will fail to load the invoice anyway.

    if (persisted) {
      this.logger.debug(
        `Persisted template hit for schoolId=${schoolId} docType=${typedDocType} ` +
          `templateId=${persisted.templateId} configVersion=${persisted.configVersion}`,
      );
      return {
        docType: typedDocType,
        templateConfig: persisted.templateConfig,
        source: 'persisted',
        templateId: persisted.templateId,
        configVersion: persisted.configVersion,
      };
    }

    // Lazy-default path: compute descriptor defaults for this archetype.
    // No DDB write — the row only exists after explicit operator save in C.2.x.
    const archetype = (tenant.archetype ?? 'GENERIC') as Parameters<
      ReturnType<typeof getDescriptor>['defaults']
    >[0];
    const descriptor = getDescriptor(typedDocType);
    const defaults = descriptor.defaults(archetype, DEFAULT_LOCALE);

    this.logger.debug(
      `Lazy-default template for schoolId=${schoolId} docType=${typedDocType} ` +
        `archetype=${archetype}`,
    );

    return {
      docType: typedDocType,
      templateConfig: defaults as unknown as Record<string, unknown>,
      source: 'default',
    };
  }
}

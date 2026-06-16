/**
 * Attendance Policy Resolver — Attendance Domain epic (Sprint 2, S2.T4).
 *
 * Resolves the effective attendance mode + counting policy for a school via
 *   school override (inherited tenant default) → archetype default → platform.
 *
 * Read-path only: nothing branches on the result yet (recording starts honoring
 * the mode in Sprint 4). Degrades gracefully — a failure reading the school
 * config or the tenant archetype falls back to the archetype/platform default
 * rather than 5xx-ing the operator.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  getArchetypeAttendanceDefaults,
  type AttendancePolicy,
  type AttendancePolicyResponseDto,
  type AttendancePolicySource,
} from '@aibrains/shared-types';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantMetadataReaderService } from '../common/services/tenant-metadata-reader.service';
import { RequestContext } from '../common/entities';

@Injectable()
export class AttendancePolicyResolverService {
  private readonly logger = new Logger(AttendancePolicyResolverService.name);

  constructor(
    private readonly identityClient: IdentityClientService,
    private readonly tenantMetadataReader: TenantMetadataReaderService,
  ) {}

  async resolveEffectivePolicy(
    schoolId: string,
    context: RequestContext,
  ): Promise<AttendancePolicyResponseDto> {
    // 1. School-level override (inherited from the tenant default at create time).
    let schoolPolicy: AttendancePolicy | undefined;
    try {
      const config = await this.identityClient.getSchoolConfiguration(schoolId, context);
      schoolPolicy = config?.attendancePolicy;
    } catch (err) {
      this.logger.warn(`resolveEffectivePolicy: school config read failed for ${schoolId}; ignoring: ${err}`);
    }

    // 2. Archetype fallback — degrade to the platform default on any read failure.
    let archetype: string | undefined;
    try {
      archetype = await this.tenantMetadataReader.getArchetype(context.tenantId);
    } catch (err) {
      this.logger.warn(`resolveEffectivePolicy: archetype read failed for tenant ${context.tenantId}; degrading to platform default: ${err}`);
      archetype = undefined;
    }
    const archetypeKnown = !!archetype;
    const defaults = getArchetypeAttendanceDefaults(archetype);

    const effectiveMode = schoolPolicy ?? defaults.mode;
    const modeSource: AttendancePolicySource = schoolPolicy
      ? 'school'
      : archetypeKnown
        ? 'archetype'
        : 'platform';
    const countingSource: AttendancePolicySource = archetypeKnown ? 'archetype' : 'platform';

    return {
      schoolId,
      effectiveMode,
      modeSource,
      countingPolicy: defaults.countingPolicy,
      countingSource,
      archetype: archetype || undefined,
    };
  }
}

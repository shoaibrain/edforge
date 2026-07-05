/**
 * FamilyGroupsFlagGuard — EPIC-FB feature flag (FB-0.4 / FB-1.6)
 *
 * When `FAMILY_GROUPS_ENABLED === 'false'` every families route throws
 * NotFoundException — the flag-off contract is "the routes don't exist"
 * (404), not 403, so flag state is not probeable. Any other value
 * (including unset) leaves the routes live.
 *
 * Read at request time (not module init) so tests can flip
 * `process.env.FAMILY_GROUPS_ENABLED` per case and ECS env-var rollouts
 * need no code change.
 */

import { Injectable, CanActivate, NotFoundException } from '@nestjs/common';

@Injectable()
export class FamilyGroupsFlagGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.FAMILY_GROUPS_ENABLED === 'false') {
      throw new NotFoundException('Cannot find resource');
    }
    return true;
  }
}

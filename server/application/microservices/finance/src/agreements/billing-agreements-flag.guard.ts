/**
 * BillingAgreementsFlagGuard — EPIC-FB feature flag (FB-0.4 / FB-2.6)
 *
 * When `BILLING_AGREEMENTS_ENABLED === 'false'` every agreements route
 * throws NotFoundException — the flag-off contract is "the routes don't
 * exist" (404), not 403, so flag state is not probeable. Any other value
 * (including unset) leaves the routes live. Mirrors academics'
 * FamilyGroupsFlagGuard.
 *
 * Read at request time (not module init) so tests can flip
 * `process.env.BILLING_AGREEMENTS_ENABLED` per case and ECS env-var
 * rollouts need no code change.
 */

import { Injectable, CanActivate, NotFoundException } from '@nestjs/common';

@Injectable()
export class BillingAgreementsFlagGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.BILLING_AGREEMENTS_ENABLED === 'false') {
      throw new NotFoundException('Cannot find resource');
    }
    return true;
  }
}

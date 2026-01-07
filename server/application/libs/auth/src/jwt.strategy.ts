/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthConfig } from './auth-config';
import { TenantContext, TenantTier, GlobalRole } from './tenant-context.interface';

/**
 * JWT Cognito Payload Interface
 * Maps Cognito JWT claims to typed properties
 */
interface CognitoJwtPayload {
  sub: string;
  'cognito:username': string;
  'cognito:groups'?: string[];
  'custom:tenantId': string;
  'custom:tenantTier': string;
  'custom:tenantName': string;
  'custom:userRole'?: string;
  email: string;
  email_verified?: boolean;
  phone_number?: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly authConfig: AuthConfig) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${authConfig.authority}/.well-known/jwks.json`
      }),

      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: authConfig.clientId,
      issuer: authConfig.authority,
      algorithms: ['RS256']
    });

    this.logger.log(`JWT Strategy initialized with authority: ${authConfig.authority}`);
  }

  /**
   * Validate and transform JWT payload into TenantContext
   * 
   * @param payload - Raw Cognito JWT payload
   * @returns Type-safe TenantContext
   */
  async validate(payload: CognitoJwtPayload): Promise<TenantContext> {
    // Extract User Pool ID from issuer URL
    // Format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
    const match = payload.iss.match(/([a-z\d_\-]+)(\/*|)$/gi);
    const userPoolId = match?.[0] || '';

    // Validate and normalize tenant tier
    const tenantTier = this.normalizeTenantTier(payload['custom:tenantTier']);
    
    // Validate and normalize global role
    const globalRole = this.normalizeGlobalRole(payload['custom:userRole']);

    const context: TenantContext = {
      userId: payload.sub,
      username: payload['cognito:username'],
      tenantId: payload['custom:tenantId'],
      tenantTier,
      tenantName: payload['custom:tenantName'],
      email: payload.email,
      globalRole,
      userPoolId,
      appClientId: payload.aud,
    };

    this.logger.debug(`JWT validated for user ${context.email} in tenant ${context.tenantId}`);
    
    return context;
  }

  /**
   * Normalize tenant tier to valid enum value
   */
  private normalizeTenantTier(tier: string | undefined): TenantTier {
    const normalized = tier?.toUpperCase();
    if (normalized === 'BASIC' || normalized === 'ADVANCED' || normalized === 'PREMIUM') {
      return normalized;
    }
    this.logger.warn(`Unknown tenant tier "${tier}", defaulting to BASIC`);
    return 'BASIC';
  }

  /**
   * Normalize global role to valid enum value
   */
  private normalizeGlobalRole(role: string | undefined): GlobalRole {
    if (role === 'TenantAdmin' || role === 'StandardUser') {
      return role;
    }
    this.logger.warn(`Unknown global role "${role}", defaulting to StandardUser`);
    return 'StandardUser';
  }
}

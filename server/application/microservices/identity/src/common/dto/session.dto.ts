/**
 * Session DTOs for Identity Service
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional,
} from 'class-validator';

/**
 * Session Response DTO
 */
export class SessionResponseDto {
  sessionId: string;
  userId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  deviceInfo?: DeviceInfoDto;
  ipAddress?: string;
  lastActiveAt?: string;
}

/**
 * Device Info DTO
 */
export class DeviceInfoDto {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  os?: string;
  browser?: string;
  deviceId?: string;
}

/**
 * Session List Response DTO
 */
export class SessionListResponseDto {
  sessions: SessionResponseDto[];
  total: number;
}

/**
 * Revoke Session DTO
 */
export class RevokeSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Revoke All Sessions DTO
 */
export class RevokeAllSessionsDto {
  @IsString()
  @IsOptional()
  exceptCurrentSession?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}


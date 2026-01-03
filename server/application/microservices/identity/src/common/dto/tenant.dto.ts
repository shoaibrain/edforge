/**
 * Tenant DTOs for Identity Service
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsEmail,
  ValidateNested,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantTier, TenantStatus } from '../entities/base.entity';

/**
 * Tenant Address DTO - MUST be defined before classes that reference it
 */
export class TenantAddressDto {
  @IsString()
  @IsNotEmpty()
  street1: string;

  @IsString()
  @IsOptional()
  street2?: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @IsString()
  @IsOptional()
  country?: string;
}

/**
 * Tenant Branding DTO - MUST be defined before classes that reference it
 */
export class TenantBrandingDto {
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  faviconUrl?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  primaryColor?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  secondaryColor?: string;

  @IsString()
  @IsOptional()
  customDomain?: string;
}

/**
 * Update Tenant DTO
 */
export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @IsString()
  @IsOptional()
  contactPhone?: string;

  @ValidateNested()
  @Type(() => TenantAddressDto)
  @IsOptional()
  address?: TenantAddressDto;

  @IsEnum(['active', 'inactive', 'suspended', 'trial'])
  @IsOptional()
  status?: TenantStatus;

  @ValidateNested()
  @Type(() => TenantBrandingDto)
  @IsOptional()
  branding?: TenantBrandingDto;
}

/**
 * Tenant Response DTO
 */
export class TenantResponseDto {
  tenantId: string;
  name: string;
  subdomain: string;
  contactEmail: string;
  contactPhone?: string;
  address?: TenantAddressDto;
  tier: TenantTier;
  status: TenantStatus;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
  branding?: TenantBrandingDto;
  schoolCount?: number;
  userCount?: number;
  studentCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tenant Lookup Response DTO (for subdomain resolution)
 */
export class TenantLookupResponseDto {
  tenantId: string;
  name: string;
  subdomain: string;
  tier: TenantTier;
  status: TenantStatus;
  branding?: TenantBrandingDto;
}

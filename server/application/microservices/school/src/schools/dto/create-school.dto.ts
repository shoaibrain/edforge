/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

import { IsString, IsEmail, IsOptional, IsEnum, IsNumber, IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSchoolDto {
  @IsString()
  schoolName: string;

  @IsString()
  schoolCode: string;

  @IsString()
  address: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  country: string;

  @IsString()
  postalCode: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  principalName?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSchoolDto {
  @IsOptional()
  @IsString()
  schoolName?: string;

  @IsOptional()
  @IsString()
  schoolCode?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  principalName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export class CreateDepartmentDto {
  @IsString()
  departmentName: string;

  @IsString()
  departmentCode: string;

  @IsString()
  headOfDepartment: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateSemesterDto {
  @IsString()
  semesterName: string;

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

export class CreateAcademicYearDto {
  @IsString()
  yearName: string;

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSemesterDto)
  semesters: CreateSemesterDto[];
}

export class AcademicSettingsDto {
  @IsString()
  defaultAcademicYear: string;

  @IsString()
  defaultSemester: string;

  @IsEnum(['LETTER', 'NUMERIC', 'PERCENTAGE'])
  gradingSystem: 'LETTER' | 'NUMERIC' | 'PERCENTAGE';

  @IsNumber()
  passingGrade: number;

  @IsNumber()
  maxAbsences: number;
}

export class AttendanceSettingsDto {
  @IsNumber()
  requiredAttendancePercentage: number;

  @IsNumber()
  lateArrivalThreshold: number;

  @IsNumber()
  earlyDepartureThreshold: number;
}

export class NotificationSettingsDto {
  @IsBoolean()
  emailNotifications: boolean;

  @IsBoolean()
  smsNotifications: boolean;

  @IsBoolean()
  pushNotifications: boolean;
}

export class CreateSchoolConfigurationDto {
  @ValidateNested()
  @Type(() => AcademicSettingsDto)
  academicSettings: AcademicSettingsDto;

  @ValidateNested()
  @Type(() => AttendanceSettingsDto)
  attendanceSettings: AttendanceSettingsDto;

  @ValidateNested()
  @Type(() => NotificationSettingsDto)
  notificationSettings: NotificationSettingsDto;
}

export class GenerateSchoolReportDto {
  @IsEnum(['ACADEMIC', 'ATTENDANCE', 'FINANCIAL', 'STAFF', 'COMPREHENSIVE'])
  reportType: 'ACADEMIC' | 'ATTENDANCE' | 'FINANCIAL' | 'STAFF' | 'COMPREHENSIVE';

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;
}

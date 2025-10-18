import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class CreateAttendanceDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  date: string; // YYYY-MM-DD format

  @IsEnum(['present', 'absent', 'tardy', 'excused', 'late', 'early_departure'])
  @IsNotEmpty()
  status: 'present' | 'absent' | 'tardy' | 'excused' | 'late' | 'early_departure';

  @IsString()
  @IsOptional()
  checkInTime?: string; // HH:MM format

  @IsString()
  @IsOptional()
  checkOutTime?: string; // HH:MM format

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1440) // Max 24 hours in minutes
  minutesLate?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  duration?: number; // Minutes present

  @IsNumber()
  @IsOptional()
  @Min(0)
  expectedDuration?: number; // Expected minutes

  @IsString()
  @IsOptional()
  periodId?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(12)
  periodNumber?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  excuseReason?: string;

  @IsBoolean()
  @IsOptional()
  parentNotified?: boolean;

  @IsBoolean()
  @IsOptional()
  documentationRequired?: boolean;

  @IsString()
  @IsOptional()
  excuseDocumentation?: string;
}

export class UpdateAttendanceDto {
  @IsEnum(['present', 'absent', 'tardy', 'excused', 'late'])
  @IsOptional()
  status?: 'present' | 'absent' | 'tardy' | 'excused' | 'late';

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1440)
  minutesLate?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  excuseReason?: string;

  @IsBoolean()
  @IsOptional()
  parentNotified?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class BulkAttendanceDto {
  @IsString()
  @IsNotEmpty()
  date: string;

  @IsNotEmpty()
  records: Array<{
    studentId: string;
    status: 'present' | 'absent' | 'tardy' | 'excused' | 'late';
    notes?: string;
  }>;
}


import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsEnum, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ClassScheduleDto {
  @IsEnum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
  @IsNotEmpty()
  dayOfWeek: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

  @IsString()
  @IsNotEmpty()
  startTime: string; // HH:MM

  @IsString()
  @IsNotEmpty()
  endTime: string; // HH:MM

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(12)
  periodNumber?: number;
}

export class CreateClassroomDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  grade: string;

  @IsString()
  @IsOptional()
  section?: string;

  @IsString()
  @IsNotEmpty()
  teacherId: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  coTeacherIds?: string[];

  @IsString()
  @IsOptional()
  room?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(200)
  capacity?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClassScheduleDto)
  schedule: ClassScheduleDto[];

  @IsEnum(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';
}

export class UpdateClassroomDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsString()
  @IsOptional()
  section?: string;

  @IsString()
  @IsOptional()
  teacherId?: string;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  coTeacherIds?: string[];

  @IsString()
  @IsOptional()
  room?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(200)
  capacity?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ClassScheduleDto)
  schedule?: ClassScheduleDto[];

  @IsEnum(['active', 'inactive', 'archived'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'archived';

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class EnrollStudentDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;
}


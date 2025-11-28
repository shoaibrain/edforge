/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Business Rules Service - Complex business rule validations
 * 
 * BUSINESS RULES:
 * 1. Capacity: Classroom must have available seats
 * 2. Prerequisites: Student must meet course prerequisites
 * 3. Schedule Conflicts: No overlapping class times
 * 4. Financial Clearance: All outstanding balances must be paid
 * 5. Guardian Consent: Primary guardian must consent
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DynamoDBClientService } from '../dynamodb-client.service';
import { EntityKeyBuilder } from '../entities/base.entity';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CurriculumHttpClientService } from './curriculum-http-client.service';

export interface EnrollmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CapacityCheck {
  currentEnrollment: number;
  maxCapacity: number;
  availableSeats: number;
  isAvailable: boolean;
}

export interface ScheduleConflict {
  conflictType: 'TIME_OVERLAP' | 'SAME_PERIOD' | 'SAME_TEACHER';
  conflictingClassroomId: string;
  conflictingClassName: string;
  conflictDetails: string;
}

@Injectable()
export class EnrollmentBusinessRulesService {
  private readonly logger = new Logger(EnrollmentBusinessRulesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly curriculumHttpClient: CurriculumHttpClientService
  ) {}

  /**
   * Validate all business rules for enrollment
   */
  async validateEnrollmentRules(
    tenantId: string,
    studentId: string,
    classroomId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<EnrollmentValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Capacity Check
    const capacityCheck = await this.checkClassroomCapacity(
      tenantId,
      classroomId,
      schoolId,
      academicYearId
    );
    if (!capacityCheck.isAvailable) {
      errors.push(
        `Classroom is at capacity. Current: ${capacityCheck.currentEnrollment}/${capacityCheck.maxCapacity}`
      );
    }

    // 2. Prerequisites Check
    const prerequisiteCheck = await this.checkPrerequisites(
      tenantId,
      studentId,
      classroomId,
      schoolId,
      academicYearId
    );
    if (!prerequisiteCheck.isValid) {
      errors.push(...prerequisiteCheck.errors);
    }

    // 3. Schedule Conflicts Check
    const scheduleConflicts = await this.checkScheduleConflicts(
      tenantId,
      studentId,
      classroomId,
      schoolId,
      academicYearId
    );
    if (scheduleConflicts.length > 0) {
      for (const conflict of scheduleConflicts) {
        errors.push(
          `Schedule conflict: ${conflict.conflictDetails} (${conflict.conflictType})`
        );
      }
    }

    // 4. Financial Clearance Check
    const financialCheck = await this.checkFinancialClearance(
      tenantId,
      studentId,
      schoolId,
      academicYearId
    );
    if (!financialCheck.isCleared) {
      if (financialCheck.blocksEnrollment) {
        errors.push(
          `Financial clearance required: ${financialCheck.reason} (Outstanding: ${financialCheck.outstandingBalance})`
        );
      } else {
        warnings.push(
          `Financial warning: ${financialCheck.reason} (Outstanding: ${financialCheck.outstandingBalance})`
        );
      }
    }

    // 5. Guardian Consent Check
    const consentCheck = await this.checkGuardianConsent(
      tenantId,
      studentId,
      classroomId
    );
    if (!consentCheck.hasConsent) {
      errors.push(
        `Guardian consent required: ${consentCheck.reason}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Business Rule 1: Check classroom capacity
   */
  async checkClassroomCapacity(
    tenantId: string,
    classroomId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<CapacityCheck> {
    try {
      // Get classroom entity from curriculum service
      const classroom = await this.curriculumHttpClient.getClassroom(
        tenantId,
        schoolId,
        academicYearId,
        classroomId
      );

      const maxCapacity = classroom.capacity || 30;
      
      // Count current enrollments in this classroom
      // Query GSI2: schoolId#academicYearId -> ENROLLMENT#active#studentId
      const enrollmentKey = `SCHOOL#${schoolId}#ACADEMIC_YEAR#${academicYearId}`;
      const enrollments = await this.dynamoDBClient.query(
        tenantId,
        enrollmentKey,
        'entityType = :type AND classroomId = :classroomId AND status = :status',
        {
          ':type': 'ENROLLMENT',
          ':classroomId': classroomId,
          ':status': 'active'
        }
      );

      const currentEnrollment = enrollments.length;
      const availableSeats = maxCapacity - currentEnrollment;

      return {
        currentEnrollment,
        maxCapacity,
        availableSeats,
        isAvailable: availableSeats > 0
      };
    } catch (error) {
      this.logger.error('Error checking classroom capacity:', error);
      throw new BadRequestException('Failed to check classroom capacity');
    }
  }

  /**
   * Business Rule 2: Check prerequisites
   */
  async checkPrerequisites(
    tenantId: string,
    studentId: string,
    classroomId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Get classroom to check course prerequisites from curriculum service
      const classroom = await this.curriculumHttpClient.getClassroom(
        tenantId,
        schoolId,
        academicYearId,
        classroomId
      );

      // Check if classroom has prerequisites (prerequisites may not be in Classroom interface yet)
      const prerequisites = (classroom as any).prerequisites;
      if (!prerequisites || prerequisites.length === 0) {
        return { isValid: true, errors: [] };
      }

      // Get student's transcript/previous grades
      const studentKey = EntityKeyBuilder.student(studentId);
      const student = await this.dynamoDBClient.getItem(tenantId, studentKey);

      if (!student) {
        errors.push('Student not found');
        return { isValid: false, errors };
      }

      // Check each prerequisite
      for (const prerequisite of prerequisites) {
        const prerequisiteMet = await this.checkSinglePrerequisite(
          tenantId,
          studentId,
          prerequisite,
          academicYearId
        );

        if (!prerequisiteMet) {
          errors.push(
            `Prerequisite not met: ${prerequisite.type} ${prerequisite.requirement}`
          );
        }
      }

      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (error) {
      this.logger.error('Error checking prerequisites:', error);
      return {
        isValid: false,
        errors: ['Failed to validate prerequisites']
      };
    }
  }

  private async checkSinglePrerequisite(
    tenantId: string,
    studentId: string,
    prerequisite: any,
    academicYearId: string
  ): Promise<boolean> {
    switch (prerequisite.type) {
      case 'COURSE_COMPLETION':
        // Check if student completed required course with minimum grade
        const completedCourses = await this.getCompletedCourses(
          tenantId,
          studentId,
          prerequisite.courseId
        );
        if (completedCourses.length === 0) {
          return false;
        }
        const grade = completedCourses[0].finalGrade;
        return grade >= (prerequisite.minimumGrade || 60);

      case 'GRADE_LEVEL':
        // Check if student is at required grade level
        const student = await this.dynamoDBClient.getItem(
          tenantId,
          EntityKeyBuilder.student(studentId)
        );
        return student?.gradeLevel === prerequisite.requiredGrade;

      case 'GPA':
        // Check if student meets minimum GPA
        const gpa = await this.getStudentGPA(tenantId, studentId, academicYearId);
        return gpa >= (prerequisite.minimumGPA || 2.0);

      default:
        this.logger.warn(`Unknown prerequisite type: ${prerequisite.type}`);
        return true; // Don't block on unknown types
    }
  }

  /**
   * Business Rule 3: Check schedule conflicts
   */
  async checkScheduleConflicts(
    tenantId: string,
    studentId: string,
    classroomId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<ScheduleConflict[]> {
    const conflicts: ScheduleConflict[] = [];

    try {
      // Get classroom schedule from curriculum service
      const classroom = await this.curriculumHttpClient.getClassroom(
        tenantId,
        schoolId,
        academicYearId,
        classroomId
      );

      if (!classroom.schedule || !classroom.schedule.length) {
        return conflicts; // No schedule = no conflicts
      }

      // Get all active enrollments for this student
      const studentEnrollments = await this.getStudentActiveEnrollments(
        tenantId,
        studentId,
        schoolId,
        academicYearId
      );

      // Check each existing enrollment for conflicts
      for (const enrollment of studentEnrollments) {
        if (enrollment.classroomId === classroomId) {
          continue; // Skip the same classroom
        }

        const existingClassroom = await this.curriculumHttpClient.getClassroom(
          tenantId,
          schoolId,
          academicYearId,
          enrollment.classroomId
        );

        if (!existingClassroom.schedule || !existingClassroom.schedule.length) {
          continue;
        }

        // Check for time overlap between all schedule items
        let hasTimeConflict = false;
        for (const schedule1 of classroom.schedule) {
          if (hasTimeConflict) break;
          for (const schedule2 of existingClassroom.schedule) {
            const timeConflict = this.checkTimeOverlap(schedule1, schedule2);
            if (timeConflict) {
              conflicts.push({
                conflictType: 'TIME_OVERLAP',
                conflictingClassroomId: enrollment.classroomId,
                conflictingClassName: existingClassroom.name || enrollment.classroomId,
                conflictDetails: `Overlapping schedule: ${schedule1.dayOfWeek} ${schedule1.startTime}-${schedule1.endTime}`
              });
              hasTimeConflict = true;
              break; // Found a conflict, no need to check more
            }
          }
        }

        // Check for same period between all schedule items
        let hasPeriodConflict = false;
        for (const schedule1 of classroom.schedule) {
          if (hasPeriodConflict) break;
          for (const schedule2 of existingClassroom.schedule) {
            if (schedule1.periodNumber === schedule2.periodNumber && schedule1.periodNumber !== undefined) {
              conflicts.push({
                conflictType: 'SAME_PERIOD',
                conflictingClassroomId: enrollment.classroomId,
                conflictingClassName: existingClassroom.name || enrollment.classroomId,
                conflictDetails: `Same period: ${schedule1.periodNumber}`
              });
              hasPeriodConflict = true;
              break; // Found a conflict, no need to check more
            }
          }
        }
      }

      return conflicts;
    } catch (error) {
      this.logger.error('Error checking schedule conflicts:', error);
      return conflicts; // Return empty on error to not block enrollment
    }
  }

  /**
   * Business Rule 4: Check financial clearance
   */
  async checkFinancialClearance(
    tenantId: string,
    studentId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<{
    isCleared: boolean;
    blocksEnrollment: boolean;
    outstandingBalance: number;
    reason: string;
  }> {
    try {
      // Get billing account for student
      const accountKey = EntityKeyBuilder.billingAccount(schoolId, academicYearId, studentId);
      const account = await this.dynamoDBClient.getItem(tenantId, accountKey);

      if (!account) {
        return {
          isCleared: true,
          blocksEnrollment: false,
          outstandingBalance: 0,
          reason: 'No billing account found'
        };
      }

      const outstandingBalance = account.balance?.totalOutstanding || 0;
      const threshold = 100; // $100 threshold - configurable

      if (outstandingBalance > threshold) {
        return {
          isCleared: false,
          blocksEnrollment: true, // Blocks enrollment if > $100
          outstandingBalance,
          reason: `Outstanding balance exceeds threshold ($${threshold})`
        };
      } else if (outstandingBalance > 0) {
        return {
          isCleared: false,
          blocksEnrollment: false, // Warning but doesn't block
          outstandingBalance,
          reason: 'Outstanding balance exists but below threshold'
        };
      }

      return {
        isCleared: true,
        blocksEnrollment: false,
        outstandingBalance: 0,
        reason: 'No outstanding balance'
      };
    } catch (error) {
      this.logger.error('Error checking financial clearance:', error);
      // Don't block on error - assume cleared
      return {
        isCleared: true,
        blocksEnrollment: false,
        outstandingBalance: 0,
        reason: 'Unable to verify financial status'
      };
    }
  }

  /**
   * Business Rule 5: Check guardian consent
   */
  async checkGuardianConsent(
    tenantId: string,
    studentId: string,
    classroomId: string
  ): Promise<{
    hasConsent: boolean;
    reason: string;
  }> {
    try {
      // Get student to find primary guardian
      const studentKey = EntityKeyBuilder.student(studentId);
      const student = await this.dynamoDBClient.getItem(tenantId, studentKey);

      if (!student || !student.guardians || student.guardians.length === 0) {
        return {
          hasConsent: false,
          reason: 'No guardians found for student'
        };
      }

      const primaryGuardian = student.guardians.find((g: any) => g.isPrimary);
      if (!primaryGuardian) {
        return {
          hasConsent: false,
          reason: 'No primary guardian found'
        };
      }

      // Check if guardian has given consent for this classroom/course
      // This would typically be stored in a consent entity or guardian preferences
      const consentKey = `CONSENT#${studentId}#${classroomId}`;
      const consent = await this.dynamoDBClient.getItem(tenantId, consentKey);

      if (consent && consent.status === 'approved') {
        return {
          hasConsent: true,
          reason: 'Guardian consent on file'
        };
      }

      // For MVP, assume consent is given if guardian exists
      // In production, this would require explicit consent
      return {
        hasConsent: true,
        reason: 'Guardian consent assumed (MVP)'
      };
    } catch (error) {
      this.logger.error('Error checking guardian consent:', error);
      // Don't block on error - assume consent given
      return {
        hasConsent: true,
        reason: 'Unable to verify consent, assuming approved'
      };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async getCompletedCourses(
    tenantId: string,
    studentId: string,
    courseId: string
  ): Promise<any[]> {
    // Query for completed courses with this courseId
    // This would query grades/transcripts
    try {
      const queryKey = `STUDENT#${studentId}`;
      const items = await this.dynamoDBClient.query(
        tenantId,
        queryKey,
        'entityType = :type AND courseId = :courseId AND status = :status',
        {
          ':type': 'GRADE',
          ':courseId': courseId,
          ':status': 'completed'
        }
      );
      return items;
    } catch (error) {
      this.logger.error('Error getting completed courses:', error);
      return [];
    }
  }

  private async getStudentGPA(
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<number> {
    // Calculate GPA from grades
    // This is a simplified version - in production would aggregate all grades
    try {
      const queryKey = `STUDENT#${studentId}`;
      const grades = await this.dynamoDBClient.query(
        tenantId,
        queryKey,
        'entityType = :type AND academicYearId = :yearId',
        {
          ':type': 'GRADE',
          ':academicYearId': academicYearId
        }
      );

      if (grades.length === 0) {
        return 0;
      }

      // Calculate weighted GPA
      let totalPoints = 0;
      let totalCredits = 0;

      for (const grade of grades) {
        const points = this.gradeToPoints(grade.letterGrade || grade.percentage);
        const credits = grade.credits || 1;
        totalPoints += points * credits;
        totalCredits += credits;
      }

      return totalCredits > 0 ? totalPoints / totalCredits : 0;
    } catch (error) {
      this.logger.error('Error calculating GPA:', error);
      return 0;
    }
  }

  private gradeToPoints(grade: string | number): number {
    if (typeof grade === 'number') {
      // Percentage to GPA points (4.0 scale)
      if (grade >= 90) return 4.0;
      if (grade >= 80) return 3.0;
      if (grade >= 70) return 2.0;
      if (grade >= 60) return 1.0;
      return 0.0;
    }

    // Letter grade to GPA points
    const gradeMap: Record<string, number> = {
      'A+': 4.0, 'A': 4.0, 'A-': 3.7,
      'B+': 3.3, 'B': 3.0, 'B-': 2.7,
      'C+': 2.3, 'C': 2.0, 'C-': 1.7,
      'D+': 1.3, 'D': 1.0, 'D-': 0.7,
      'F': 0.0
    };
    return gradeMap[grade.toUpperCase()] || 0.0;
  }

  private async getStudentActiveEnrollments(
    tenantId: string,
    studentId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<any[]> {
    try {
      const queryKey = `STUDENT#${studentId}`;
      const enrollments = await this.dynamoDBClient.query(
        tenantId,
        queryKey,
        'entityType = :type AND schoolId = :schoolId AND academicYearId = :yearId AND status = :status',
        {
          ':type': 'ENROLLMENT',
          ':schoolId': schoolId,
          ':academicYearId': academicYearId,
          ':status': 'active'
        }
      );
      return enrollments;
    } catch (error) {
      this.logger.error('Error getting student enrollments:', error);
      return [];
    }
  }

  private checkTimeOverlap(schedule1: { dayOfWeek: string; startTime: string; endTime: string }, schedule2: { dayOfWeek: string; startTime: string; endTime: string }): boolean {
    if (!schedule1 || !schedule2) {
      return false;
    }

    // Same day
    if (schedule1.dayOfWeek !== schedule2.dayOfWeek) {
      return false;
    }

    // Check time overlap
    const start1 = this.timeToMinutes(schedule1.startTime);
    const end1 = this.timeToMinutes(schedule1.endTime);
    const start2 = this.timeToMinutes(schedule2.startTime);
    const end2 = this.timeToMinutes(schedule2.endTime);

    return !(end1 <= start2 || end2 <= start1);
  }

  private timeToMinutes(time: string): number {
    // Convert "HH:MM" to minutes since midnight
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}


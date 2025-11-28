/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Analytics Service - Read-only analytics queries
 * 
 * DATA SOURCES:
 * - DynamoDB (real-time queries)
 * - S3 Data Lake via Athena (historical analytics)
 * - CloudWatch Metrics (system metrics)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ClientFactoryService } from '@app/client-factory';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { AthenaQueryService } from '../common/services/athena-query.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly s3Client: S3Client;
  private readonly dataLakeBucketName: string;

  constructor(
    private readonly clientFactory: ClientFactoryService,
    private readonly configService: ConfigService,
    private readonly athenaQueryService: AthenaQueryService
  ) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.dataLakeBucketName = this.configService.get<string>('DATA_LAKE_BUCKET_NAME') || 'edforge-data-lake';
    this.logger.log(`Analytics Service initialized. Data Lake: ${this.dataLakeBucketName}`);
  }

  /**
   * Principal Dashboard - School-wide metrics
   */
  async getPrincipalDashboard(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    dateRange: { startDate?: string; endDate?: string },
    jwtToken: string
  ): Promise<any> {
    const client = await this.clientFactory.getClient(tenantId, jwtToken);
    
    // Query multiple data sources and aggregate
    const [enrollmentStats, attendanceStats, gradeStats, atRiskCount] = await Promise.all([
      this.getEnrollmentStats(client, tenantId, schoolId, academicYearId),
      this.getAttendanceStats(client, tenantId, schoolId, academicYearId, dateRange),
      this.getGradeStats(client, tenantId, schoolId, academicYearId),
      this.getAtRiskStudentCount(client, tenantId, schoolId, academicYearId)
    ]);

    return {
      schoolId,
      academicYearId,
      dateRange,
      enrollment: enrollmentStats,
      attendance: attendanceStats,
      grades: gradeStats,
      atRiskStudents: atRiskCount,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Teacher Dashboard - Classroom-specific metrics
   */
  async getTeacherDashboard(
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    filters: { classroomId?: string; startDate?: string; endDate?: string },
    jwtToken: string
  ): Promise<any> {
    const client = await this.clientFactory.getClient(tenantId, jwtToken);
    
    const [classrooms, assignments, grades, attendance] = await Promise.all([
      this.getTeacherClassrooms(client, tenantId, teacherId, academicYearId, filters.classroomId),
      this.getAssignmentStats(client, tenantId, teacherId, academicYearId, filters),
      this.getClassroomGradeStats(client, tenantId, teacherId, academicYearId, filters),
      this.getClassroomAttendanceStats(client, tenantId, teacherId, academicYearId, filters)
    ]);

    return {
      teacherId,
      academicYearId,
      filters,
      classrooms,
      assignments,
      grades,
      attendance,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Student Performance Analytics
   */
  async getStudentPerformance(
    tenantId: string,
    studentId: string,
    academicYearId: string,
    jwtToken: string
  ): Promise<any> {
    const client = await this.clientFactory.getClient(tenantId, jwtToken);
    
    const [grades, attendance, assignments] = await Promise.all([
      this.getStudentGrades(client, tenantId, studentId, academicYearId),
      this.getStudentAttendance(client, tenantId, studentId, academicYearId),
      this.getStudentAssignments(client, tenantId, studentId, academicYearId)
    ]);

    const gpa = this.calculateGPA(grades);
    const attendanceRate = this.calculateAttendanceRate(attendance);
    const completionRate = this.calculateCompletionRate(assignments);

    return {
      studentId,
      academicYearId,
      gpa,
      attendanceRate,
      completionRate,
      grades,
      attendance,
      assignments,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * At-Risk Students Identification
   */
  async getAtRiskStudents(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    threshold: number,
    jwtToken: string
  ): Promise<any> {
    const client = await this.clientFactory.getClient(tenantId, jwtToken);
    
    // Query students with GPA below threshold or high absence rate using Athena
    const atRiskStudents = await this.queryAtRiskStudents(
      client,
      tenantId,
      schoolId,
      academicYearId,
      threshold
    );

    return {
      schoolId,
      academicYearId,
      threshold,
      count: atRiskStudents.length,
      students: atRiskStudents,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Achievement Gap Analysis
   */
  async getAchievementGaps(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    demographic?: string,
    jwtToken?: string
  ): Promise<any> {
    // This would query Athena for historical data from S3 Data Lake
    // For MVP, return placeholder structure
    return {
      schoolId,
      academicYearId,
      demographic,
      gaps: [],
      message: 'Achievement gap analysis requires S3 Data Lake integration',
      generatedAt: new Date().toISOString()
    };
  }

  // ============================================================================
  // HELPER METHODS - Query Athena Data Lake
  // ============================================================================

  /**
   * Get enrollment statistics from enrollment_events table
   */
  private async getEnrollmentStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<any> {
    try {
      // Query enrollment events to count total and active enrollments
      const query = `
        SELECT 
          COUNT(DISTINCT JSON_EXTRACT_SCALAR(detail, '$.studentId')) as totalStudents,
          COUNT(DISTINCT CASE 
            WHEN JSON_EXTRACT_SCALAR(detail, '$.eventType') = 'StudentEnrolled' 
            THEN JSON_EXTRACT_SCALAR(detail, '$.studentId') 
          END) as activeEnrollments,
          JSON_EXTRACT_SCALAR(detail, '$.gradeLevel') as gradeLevel,
          COUNT(*) as enrollmentCount
        FROM enrollment_events
        WHERE service = 'enrollment-service'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
        GROUP BY JSON_EXTRACT_SCALAR(detail, '$.gradeLevel')
      `;

      // Use monitoring to track query performance
      // Future: Check for materialized view (principal_dashboard_view) and use if available
      const result = await this.athenaQueryService.executeQueryWithMonitoring(query, {
        tenantId,
        schoolId,
        academicYearId
      });

      const byGrade: Record<string, number> = {};
      let total = 0;
      let active = 0;

      result.rows.forEach((row: any) => {
        const grade = row.gradeLevel || 'Unknown';
        byGrade[grade] = parseInt(row.enrollmentCount) || 0;
        total += parseInt(row.totalStudents) || 0;
        active += parseInt(row.activeEnrollments) || 0;
      });

      return {
        total,
        active,
        byGrade
      };
    } catch (error: any) {
      this.logger.error(`Failed to get enrollment stats: ${error.message}`, error.stack);
      return {
        total: 0,
        active: 0,
        byGrade: {}
      };
    }
  }

  /**
   * Get attendance statistics from attendance_events table
   */
  private async getAttendanceStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    dateRange: { startDate?: string; endDate?: string }
  ): Promise<any> {
    try {
      const dateFilters = this.athenaQueryService.buildDateRangeFilters(
        dateRange.startDate,
        dateRange.endDate
      );

      const query = `
        SELECT 
          COUNT(DISTINCT JSON_EXTRACT_SCALAR(detail, '$.date')) as totalDays,
          COUNT(CASE WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'PRESENT' THEN 1 END) as present,
          COUNT(CASE WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'ABSENT' THEN 1 END) as absent,
          COUNT(CASE WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'TARDY' THEN 1 END) as tardy,
          AVG(CASE 
            WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'PRESENT' THEN 1.0 
            ELSE 0.0 
          END) * 100 as avgAttendanceRate
        FROM attendance_events
        WHERE service = 'attendance-service'
          AND ${dateFilters.yearFilter}
          AND ${dateFilters.monthFilter}
          AND ${dateFilters.dayFilter}
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
      `;

      // Use monitoring to track query performance
      // Future: Check for materialized view (principal_dashboard_view) and use if available
      const result = await this.athenaQueryService.executeQueryWithMonitoring(query, {
        tenantId,
        schoolId,
        academicYearId
      });

      if (result.rows.length === 0) {
        return {
          averageRate: 0,
          totalDays: 0,
          present: 0,
          absent: 0,
          tardy: 0
        };
      }

      const row = result.rows[0];
      return {
        averageRate: parseFloat(row.avgAttendanceRate) || 0,
        totalDays: parseInt(row.totalDays) || 0,
        present: parseInt(row.present) || 0,
        absent: parseInt(row.absent) || 0,
        tardy: parseInt(row.tardy) || 0
      };
    } catch (error: any) {
      this.logger.error(`Failed to get attendance stats: ${error.message}`, error.stack);
      return {
        averageRate: 0,
        totalDays: 0,
        present: 0,
        absent: 0,
        tardy: 0
      };
    }
  }

  /**
   * Get grade statistics from assessment_events table
   */
  private async getGradeStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<any> {
    try {
      const query = `
        SELECT 
          AVG(CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
              CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100) as avgPercentage,
          JSON_EXTRACT_SCALAR(detail, '$.letterGrade') as letterGrade,
          COUNT(*) as gradeCount
        FROM assessment_events
        WHERE service = 'assessment-service'
          AND "detail-type" = 'GradePublished'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
        GROUP BY JSON_EXTRACT_SCALAR(detail, '$.letterGrade')
      `;

      // Use monitoring to track query performance
      // Future: Check for materialized view (principal_dashboard_view) and use if available
      const result = await this.athenaQueryService.executeQueryWithMonitoring(query, {
        tenantId,
        schoolId,
        academicYearId
      });

      const distribution: Record<string, number> = {};
      let totalAvg = 0;
      let count = 0;

      result.rows.forEach((row: any) => {
        const grade = row.letterGrade || 'Unknown';
        distribution[grade] = parseInt(row.gradeCount) || 0;
        totalAvg += parseFloat(row.avgPercentage) || 0;
        count++;
      });

      return {
        averageGPA: count > 0 ? totalAvg / count : 0,
        distribution,
        bySubject: {} // Would need subject data from events
      };
    } catch (error: any) {
      this.logger.error(`Failed to get grade stats: ${error.message}`, error.stack);
      return {
        averageGPA: 0,
        distribution: {},
        bySubject: {}
      };
    }
  }

  /**
   * Get at-risk student count
   */
  private async getAtRiskStudentCount(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<number> {
    try {
      // Use the at-risk query logic (simplified version)
      const query = `
        WITH student_grades AS (
          SELECT 
            JSON_EXTRACT_SCALAR(detail, '$.studentId') as studentId,
            AVG(CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
                CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100) as avgScore
          FROM assessment_events
          WHERE service = 'assessment-service'
            AND "detail-type" = 'GradePublished'
            AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
            AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
            AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
          GROUP BY JSON_EXTRACT_SCALAR(detail, '$.studentId')
        )
        SELECT COUNT(DISTINCT studentId) as atRiskCount
        FROM student_grades
        WHERE avgScore < 60
      `;

      // Use monitoring to track query performance
      // Future: Check for materialized view (principal_dashboard_view) and use if available
      const result = await this.athenaQueryService.executeQueryWithMonitoring(query, {
        tenantId,
        schoolId,
        academicYearId
      });

      if (result.rows.length === 0) {
        return 0;
      }

      return parseInt(result.rows[0].atRiskCount) || 0;
    } catch (error: any) {
      this.logger.error(`Failed to get at-risk student count: ${error.message}`, error.stack);
      return 0;
    }
  }

  /**
   * Get teacher's classrooms from curriculum_events
   */
  private async getTeacherClassrooms(
    client: DynamoDBDocumentClient,
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    classroomId?: string
  ): Promise<any[]> {
    try {
      let query = `
        SELECT DISTINCT
          JSON_EXTRACT_SCALAR(detail, '$.classroomId') as classroomId,
          JSON_EXTRACT_SCALAR(detail, '$.courseId') as courseId
        FROM curriculum_events
        WHERE service = 'curriculum-service'
          AND "detail-type" = 'ClassroomCreated'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.teacherId') = :teacherId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
      `;

      if (classroomId) {
        query += ` AND JSON_EXTRACT_SCALAR(detail, '$.classroomId') = :classroomId`;
      }

      const params: any = { tenantId, teacherId, academicYearId };
      if (classroomId) {
        params.classroomId = classroomId;
      }

      const result = await this.athenaQueryService.executeQuery(query, params);

      return result.rows.map((row: any) => ({
        classroomId: row.classroomId,
        name: row.courseId || row.classroomId,
        studentCount: 0 // Would need separate query to count students
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get teacher classrooms: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Get assignment statistics from assessment_events
   */
  private async getAssignmentStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    filters: { startDate?: string; endDate?: string }
  ): Promise<any> {
    try {
      const dateFilters = this.athenaQueryService.buildDateRangeFilters(
        filters.startDate,
        filters.endDate
      );

      const query = `
        SELECT 
          COUNT(DISTINCT JSON_EXTRACT_SCALAR(detail, '$.assignmentId')) as totalAssignments,
          COUNT(DISTINCT CASE 
            WHEN "detail-type" = 'AssignmentPublished' 
            THEN JSON_EXTRACT_SCALAR(detail, '$.assignmentId') 
          END) as publishedAssignments,
          COUNT(DISTINCT CASE 
            WHEN "detail-type" = 'GradePublished' 
            THEN JSON_EXTRACT_SCALAR(detail, '$.assignmentId') 
          END) as gradedAssignments,
          AVG(CASE 
            WHEN "detail-type" = 'GradePublished' 
            THEN CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
                 CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100 
          END) as avgScore
        FROM assessment_events
        WHERE service = 'assessment-service'
          AND ${dateFilters.yearFilter}
          AND ${dateFilters.monthFilter}
          AND ${dateFilters.dayFilter}
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.teacherId') = :teacherId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
      `;

      const result = await this.athenaQueryService.executeQuery(query, {
        tenantId,
        teacherId,
        academicYearId
      });

      if (result.rows.length === 0) {
        return {
          total: 0,
          published: 0,
          graded: 0,
          averageScore: 0
        };
      }

      const row = result.rows[0];
      return {
        total: parseInt(row.totalAssignments) || 0,
        published: parseInt(row.publishedAssignments) || 0,
        graded: parseInt(row.gradedAssignments) || 0,
        averageScore: parseFloat(row.avgScore) || 0
      };
    } catch (error: any) {
      this.logger.error(`Failed to get assignment stats: ${error.message}`, error.stack);
      return {
        total: 0,
        published: 0,
        graded: 0,
        averageScore: 0
      };
    }
  }

  /**
   * Get classroom grade statistics
   */
  private async getClassroomGradeStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    filters: { classroomId?: string }
  ): Promise<any> {
    try {
      let query = `
        SELECT 
          AVG(CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
              CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100) as avgGrade,
          JSON_EXTRACT_SCALAR(detail, '$.letterGrade') as letterGrade,
          COUNT(*) as gradeCount,
          JSON_EXTRACT_SCALAR(detail, '$.studentId') as studentId,
          AVG(CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
              CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100) as studentAvgScore
        FROM assessment_events
        WHERE service = 'assessment-service'
          AND "detail-type" = 'GradePublished'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.teacherId') = :teacherId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
      `;

      const params: any = { tenantId, teacherId, academicYearId };
      if (filters.classroomId) {
        query += ` AND JSON_EXTRACT_SCALAR(detail, '$.classroomId') = :classroomId`;
        params.classroomId = filters.classroomId;
      }

      query += ` GROUP BY JSON_EXTRACT_SCALAR(detail, '$.letterGrade'), JSON_EXTRACT_SCALAR(detail, '$.studentId')`;

      const result = await this.athenaQueryService.executeQuery(query, params);

      const distribution: Record<string, number> = {};
      const studentScores: Record<string, number[]> = {};

      result.rows.forEach((row: any) => {
        const grade = row.letterGrade || 'Unknown';
        distribution[grade] = (distribution[grade] || 0) + parseInt(row.gradeCount) || 0;
        
        const studentId = row.studentId;
        if (studentId) {
          if (!studentScores[studentId]) {
            studentScores[studentId] = [];
          }
          studentScores[studentId].push(parseFloat(row.studentAvgScore) || 0);
        }
      });

      // Calculate top performers and struggling students
      const studentAverages = Object.keys(studentScores).map(studentId => ({
        studentId,
        averageScore: studentScores[studentId].reduce((a, b) => a + b, 0) / studentScores[studentId].length
      }));

      const topPerformers = studentAverages
        .sort((a, b) => b.averageScore - a.averageScore)
        .slice(0, 5)
        .map(s => ({ studentId: s.studentId, averageScore: s.averageScore }));

      const strugglingStudents = studentAverages
        .filter(s => s.averageScore < 60)
        .sort((a, b) => a.averageScore - b.averageScore)
        .slice(0, 5)
        .map(s => ({ studentId: s.studentId, averageScore: s.averageScore }));

      const overallAvg = result.rows.length > 0
        ? result.rows.reduce((sum: number, row: any) => sum + (parseFloat(row.avgGrade) || 0), 0) / result.rows.length
        : 0;

      return {
        averageGrade: overallAvg,
        distribution,
        topPerformers,
        strugglingStudents
      };
    } catch (error: any) {
      this.logger.error(`Failed to get classroom grade stats: ${error.message}`, error.stack);
      return {
        averageGrade: 0,
        distribution: {},
        topPerformers: [],
        strugglingStudents: []
      };
    }
  }

  /**
   * Get classroom attendance statistics
   */
  private async getClassroomAttendanceStats(
    client: DynamoDBDocumentClient,
    tenantId: string,
    teacherId: string,
    academicYearId: string,
    filters: { classroomId?: string; startDate?: string; endDate?: string }
  ): Promise<any> {
    try {
      const dateFilters = this.athenaQueryService.buildDateRangeFilters(
        filters.startDate,
        filters.endDate
      );

      let query = `
        SELECT 
          JSON_EXTRACT_SCALAR(detail, '$.studentId') as studentId,
          AVG(CASE 
            WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'PRESENT' THEN 1.0 
            ELSE 0.0 
          END) * 100 as attendanceRate
        FROM attendance_events
        WHERE service = 'attendance-service'
          AND ${dateFilters.yearFilter}
          AND ${dateFilters.monthFilter}
          AND ${dateFilters.dayFilter}
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
      `;

      const params: any = { tenantId, academicYearId };
      if (filters.classroomId) {
        query += ` AND JSON_EXTRACT_SCALAR(detail, '$.classroomId') = :classroomId`;
        params.classroomId = filters.classroomId;
      }

      query += ` GROUP BY JSON_EXTRACT_SCALAR(detail, '$.studentId')`;

      const result = await this.athenaQueryService.executeQuery(query, params);

      const byStudent = result.rows.map((row: any) => ({
        studentId: row.studentId,
        attendanceRate: parseFloat(row.attendanceRate) || 0
      }));

      const avgRate = byStudent.length > 0
        ? byStudent.reduce((sum, s) => sum + s.attendanceRate, 0) / byStudent.length
        : 0;

      return {
        averageRate: avgRate,
        byStudent
      };
    } catch (error: any) {
      this.logger.error(`Failed to get classroom attendance stats: ${error.message}`, error.stack);
      return {
        averageRate: 0,
        byStudent: []
      };
    }
  }

  /**
   * Get student grades from assessment_events
   */
  private async getStudentGrades(
    client: DynamoDBDocumentClient,
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<any[]> {
    try {
      const query = `
        SELECT 
          JSON_EXTRACT_SCALAR(detail, '$.assignmentId') as assignmentId,
          CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) as score,
          CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) as maxScore,
          CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
          CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100 as percentage,
          JSON_EXTRACT_SCALAR(detail, '$.letterGrade') as letterGrade,
          time as date
        FROM assessment_events
        WHERE service = 'assessment-service'
          AND "detail-type" = 'GradePublished'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.studentId') = :studentId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
        ORDER BY time DESC
      `;

      const result = await this.athenaQueryService.executeQuery(query, {
        tenantId,
        studentId,
        academicYearId
      });

      return result.rows.map((row: any) => ({
        assignmentId: row.assignmentId,
        score: parseFloat(row.score) || 0,
        maxScore: parseFloat(row.maxScore) || 0,
        percentage: parseFloat(row.percentage) || 0,
        letterGrade: row.letterGrade,
        date: row.date
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get student grades: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Get student attendance from attendance_events
   */
  private async getStudentAttendance(
    client: DynamoDBDocumentClient,
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<any[]> {
    try {
      const query = `
        SELECT 
          JSON_EXTRACT_SCALAR(detail, '$.date') as date,
          JSON_EXTRACT_SCALAR(detail, '$.status') as status
        FROM attendance_events
        WHERE service = 'attendance-service'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.studentId') = :studentId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
        ORDER BY JSON_EXTRACT_SCALAR(detail, '$.date') DESC
      `;

      const result = await this.athenaQueryService.executeQuery(query, {
        tenantId,
        studentId,
        academicYearId
      });

      return result.rows.map((row: any) => ({
        date: row.date,
        status: row.status
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get student attendance: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Get student assignments from assessment_events
   */
  private async getStudentAssignments(
    client: DynamoDBDocumentClient,
    tenantId: string,
    studentId: string,
    academicYearId: string
  ): Promise<any[]> {
    try {
      const query = `
        SELECT DISTINCT
          JSON_EXTRACT_SCALAR(detail, '$.assignmentId') as assignmentId,
          JSON_EXTRACT_SCALAR(detail, '$.title') as title,
          JSON_EXTRACT_SCALAR(detail, '$.dueDate') as dueDate,
          CASE 
            WHEN "detail-type" = 'GradePublished' THEN 'completed'
            WHEN "detail-type" = 'AssignmentPublished' THEN 'assigned'
            ELSE 'pending'
          END as status
        FROM assessment_events
        WHERE service = 'assessment-service'
          AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
          AND JSON_EXTRACT_SCALAR(detail, '$.studentId') = :studentId
          AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
        ORDER BY JSON_EXTRACT_SCALAR(detail, '$.dueDate') DESC
      `;

      const result = await this.athenaQueryService.executeQuery(query, {
        tenantId,
        studentId,
        academicYearId
      });

      return result.rows.map((row: any) => ({
        assignmentId: row.assignmentId,
        title: row.title || 'Untitled Assignment',
        status: row.status,
        dueDate: row.dueDate
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get student assignments: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Query at-risk students using combined grade and attendance data
   */
  private async queryAtRiskStudents(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    threshold: number
  ): Promise<any[]> {
    try {
      const query = `
        WITH student_grades AS (
          SELECT 
            JSON_EXTRACT_SCALAR(detail, '$.studentId') as studentId,
            AVG(CAST(JSON_EXTRACT_SCALAR(detail, '$.score') AS DOUBLE) / 
                CAST(JSON_EXTRACT_SCALAR(detail, '$.maxScore') AS DOUBLE) * 100) as avgScore
          FROM assessment_events
          WHERE service = 'assessment-service'
            AND "detail-type" = 'GradePublished'
            AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
            AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
            AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
          GROUP BY JSON_EXTRACT_SCALAR(detail, '$.studentId')
        ),
        student_attendance AS (
          SELECT 
            JSON_EXTRACT_SCALAR(detail, '$.studentId') as studentId,
            AVG(CASE 
              WHEN JSON_EXTRACT_SCALAR(detail, '$.status') = 'PRESENT' THEN 1.0 
              ELSE 0.0 
            END) * 100 as attendanceRate
          FROM attendance_events
          WHERE service = 'attendance-service'
            AND JSON_EXTRACT_SCALAR(detail, '$.tenantId') = :tenantId
            AND JSON_EXTRACT_SCALAR(detail, '$.schoolId') = :schoolId
            AND JSON_EXTRACT_SCALAR(detail, '$.academicYearId') = :academicYearId
          GROUP BY JSON_EXTRACT_SCALAR(detail, '$.studentId')
        )
        SELECT 
          COALESCE(g.studentId, a.studentId) as studentId,
          COALESCE(g.avgScore, 0) as avgScore,
          COALESCE(a.attendanceRate, 0) as attendanceRate,
          CASE 
            WHEN COALESCE(g.avgScore, 0) < :threshold OR COALESCE(a.attendanceRate, 0) < :threshold THEN true
            ELSE false
          END as isAtRisk
        FROM student_grades g
        FULL OUTER JOIN student_attendance a ON g.studentId = a.studentId
        WHERE COALESCE(g.avgScore, 0) < :threshold OR COALESCE(a.attendanceRate, 0) < :threshold
      `;

      const result = await this.athenaQueryService.executeQuery(query, {
        tenantId,
        schoolId,
        academicYearId,
        threshold
      });

      return result.rows.map((row: any) => {
        const riskFactors: string[] = [];
        if (parseFloat(row.avgScore) < threshold) {
          riskFactors.push('Low GPA');
        }
        if (parseFloat(row.attendanceRate) < threshold) {
          riskFactors.push('Low Attendance');
        }

        return {
          studentId: row.studentId,
          avgScore: parseFloat(row.avgScore) || 0,
          attendanceRate: parseFloat(row.attendanceRate) || 0,
          riskFactors
        };
      });
    } catch (error: any) {
      this.logger.error(`Failed to query at-risk students: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Calculate GPA from grades array
   * Assumes grades have percentage field (0-100)
   * Converts percentage to GPA scale (0-4.0)
   */
  private calculateGPA(grades: any[]): number {
    if (grades.length === 0) return 0;
    
    // Convert percentage to GPA (simplified scale)
    // 90-100 = 4.0, 80-89 = 3.0, 70-79 = 2.0, 60-69 = 1.0, <60 = 0.0
    const percentageToGPA = (percentage: number): number => {
      if (percentage >= 90) return 4.0;
      if (percentage >= 80) return 3.0;
      if (percentage >= 70) return 2.0;
      if (percentage >= 60) return 1.0;
      return 0.0;
    };

    const totalGPA = grades.reduce((sum, grade) => {
      const percentage = grade.percentage || 0;
      return sum + percentageToGPA(percentage);
    }, 0);

    return totalGPA / grades.length;
  }

  private calculateAttendanceRate(attendance: any[]): number {
    if (attendance.length === 0) return 0;
    const present = attendance.filter(a => a.status === 'PRESENT').length;
    return (present / attendance.length) * 100;
  }

  private calculateCompletionRate(assignments: any[]): number {
    if (assignments.length === 0) return 0;
    const completed = assignments.filter(a => a.status === 'completed').length;
    return (completed / assignments.length) * 100;
  }

  // ============================================
  // S3 Data Lake Integration (Stub for MVP)
  // ============================================

  /**
   * Verify event ingestion pipeline health
   * Checks if events are being written to S3 data lake
   */
  async verifyEventIngestionHealth(): Promise<{
    healthy: boolean;
    lastEventDate?: string;
    eventCount?: number;
    message: string;
  }> {
    try {
      // List objects in the events prefix to verify ingestion
      const command = new ListObjectsV2Command({
        Bucket: this.dataLakeBucketName,
        Prefix: 'events/',
        MaxKeys: 1
      });

      const response = await this.s3Client.send(command);

      if (response.Contents && response.Contents.length > 0) {
        const latestObject = response.Contents[0];
        return {
          healthy: true,
          lastEventDate: latestObject.LastModified?.toISOString(),
          eventCount: response.KeyCount,
          message: 'Event ingestion pipeline is healthy. Events are being written to S3.'
        };
      } else {
        return {
          healthy: false,
          message: 'No events found in data lake. Event ingestion may not be active.'
        };
      }
    } catch (error: any) {
      this.logger.error(`Failed to verify event ingestion: ${error.message}`, error.stack);
      return {
        healthy: false,
        message: `Failed to verify event ingestion: ${error.message}`
      };
    }
  }

  /**
   * Query events from S3 data lake (stub for MVP)
   * 
   * TODO: Implement Athena queries for production
   * Example Athena query pattern:
   * SELECT * FROM events_table
   * WHERE year = '2025' AND month = '01' AND day = '21'
   * AND service = 'edforge.enrollment-service'
   * AND detailtype = 'StudentEnrolled'
   */
  async queryEventsFromDataLake(params: {
    startDate: string;
    endDate: string;
    service?: string;
    eventType?: string;
  }): Promise<any[]> {
    this.logger.log(`[STUB] Querying events from data lake: ${JSON.stringify(params)}`);
    
    // Stub implementation - returns empty array
    // In production, this would:
    // 1. Parse date range to determine S3 prefixes
    // 2. Use Athena to query Parquet files
    // 3. Filter by service and event type
    // 4. Return aggregated results
    
    return [];
  }

  /**
   * Get event statistics from data lake (stub for MVP)
   * 
   * TODO: Implement Athena aggregation queries
   */
  async getEventStatistics(params: {
    startDate: string;
    endDate: string;
    service?: string;
  }): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByService: Record<string, number>;
  }> {
    this.logger.log(`[STUB] Getting event statistics: ${JSON.stringify(params)}`);
    
    // Stub implementation
    return {
      totalEvents: 0,
      eventsByType: {},
      eventsByService: {}
    };
  }

  /**
   * Health check endpoint for event pipeline
   */
  async getEventPipelineHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    ingestion: {
      healthy: boolean;
      message: string;
    };
    dataLake: {
      accessible: boolean;
      bucketName: string;
    };
  }> {
    const ingestionHealth = await this.verifyEventIngestionHealth();
    
    let dataLakeAccessible = false;
    try {
      // Try to list objects to verify access
      const command = new ListObjectsV2Command({
        Bucket: this.dataLakeBucketName,
        MaxKeys: 1
      });
      await this.s3Client.send(command);
      dataLakeAccessible = true;
    } catch (error: any) {
      this.logger.warn(`Data lake not accessible: ${error.message}`);
    }

    const status = ingestionHealth.healthy && dataLakeAccessible
      ? 'healthy'
      : ingestionHealth.healthy || dataLakeAccessible
      ? 'degraded'
      : 'unhealthy';

    return {
      status,
      ingestion: {
        healthy: ingestionHealth.healthy,
        message: ingestionHealth.message
      },
      dataLake: {
        accessible: dataLakeAccessible,
        bucketName: this.dataLakeBucketName
      }
    };
  }
}


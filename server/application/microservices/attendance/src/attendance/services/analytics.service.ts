/**
 * Attendance Analytics Service
 * 
 * Provides attendance analytics, trend analysis, and risk assessment
 * Supports data-driven decisions for student interventions
 * 
 * Key Features:
 * - Attendance rate calculation
 * - Chronic absenteeism detection (10%+ absence rate)
 * - Trend analysis (improving/declining/stable)
 * - Risk level assessment (low/medium/high/critical)
 * - Intervention recommendations
 */

import { Injectable } from '@nestjs/common';
import type { AttendanceRecord } from '@edforge/shared-types';

export interface AttendanceTrend {
  status: 'improving' | 'declining' | 'stable';
  consecutiveDays: number;
  consecutiveStatus: 'present' | 'absent' | 'late' | 'excused';
  trendDirection: 'up' | 'down' | 'neutral';
  recentPattern: string;  // e.g., "Present last 5 days", "Absent 3 of last 7 days"
}

export interface AttendanceRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isChronicAbsentee: boolean;
  daysAbsentThisMonth: number;
  daysAbsentThisYear: number;
  attendanceRate: number;
  recommendations: string[];
  interventionRequired: boolean;
  parentNotificationRequired: boolean;
}

export interface AttendanceStatistics {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  unexcusedAbsentDays: number;
  attendanceRate: number;
  latenessRate: number;
  excusedRate: number;
}

@Injectable()
export class AttendanceAnalyticsService {
  
  /**
   * Calculate attendance rate for a student
   * Returns percentage of days present (including late arrivals)
   */
  calculateAttendanceRate(
    records: AttendanceRecord[],
    expectedDays: number
  ): number {
    const presentCount = records.filter(r => 
      r.status === 'present' || r.status === 'late'
    ).length;
    
    return expectedDays > 0 ? Math.round((presentCount / expectedDays) * 100 * 100) / 100 : 0;
  }
  
  /**
   * Determine if student is chronically absent
   * 
   * Definition (US Dept of Education): Missing 10% or more of school days
   * This is a critical early warning indicator for:
   * - Academic struggle
   * - Dropout risk
   * - Social/emotional issues
   */
  isChronicAbsentee(
    records: AttendanceRecord[],
    expectedDays: number
  ): boolean {
    const absentCount = records.filter(r => 
      r.status === 'absent'
    ).length;
    
    const absenteeRate = expectedDays > 0 ? (absentCount / expectedDays) * 100 : 0;
    return absenteeRate >= 10;  // 10% threshold for chronic absenteeism
  }
  
  /**
   * Analyze attendance trend over recent period
   * Helps identify patterns before they become problems
   */
  analyzeAttendanceTrend(
    recentRecords: AttendanceRecord[]
  ): AttendanceTrend {
    if (recentRecords.length < 5) {
      return {
        status: 'stable',
        consecutiveDays: 0,
        consecutiveStatus: 'present',
        trendDirection: 'neutral',
        recentPattern: 'Insufficient data for trend analysis'
      };
    }
    
    // Sort by date descending (most recent first)
    const sorted = [...recentRecords].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    // Count consecutive present/absent days
    let consecutiveDays = 0;
    const firstStatus = sorted[0].status;
    
    for (const record of sorted) {
      if (record.status === firstStatus) {
        consecutiveDays++;
      } else {
        break;
      }
    }
    
    // Analyze last 10 days vs previous 10 days for trend
    const last10 = sorted.slice(0, Math.min(10, sorted.length));
    const prev10 = sorted.slice(10, Math.min(20, sorted.length));
    
    const last10Present = last10.filter(r => r.status === 'present' || r.status === 'late').length;
    const prev10Present = prev10.length > 0 
      ? prev10.filter(r => r.status === 'present' || r.status === 'late').length 
      : last10Present; // If no previous data, assume stable
    
    let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
    let status: 'improving' | 'declining' | 'stable' = 'stable';
    
    // Significant change = 20% difference
    const threshold = 2; // 2 out of 10 days
    if (last10Present > prev10Present + threshold) {
      trendDirection = 'up';
      status = 'improving';
    } else if (last10Present < prev10Present - threshold) {
      trendDirection = 'down';
      status = 'declining';
    }
    
    // Build pattern description
    const last7 = sorted.slice(0, Math.min(7, sorted.length));
    const presentLast7 = last7.filter(r => r.status === 'present' || r.status === 'late').length;
    const absentLast7 = last7.filter(r => r.status === 'absent').length;
    
    let recentPattern = '';
    if (consecutiveDays >= 3) {
      recentPattern = `${firstStatus} for ${consecutiveDays} consecutive days`;
    } else {
      recentPattern = `${presentLast7} present, ${absentLast7} absent in last 7 days`;
    }
    
    // Map status to valid type
    let mappedStatus: 'present' | 'absent' | 'late' | 'excused' = 'present';
    if (firstStatus === 'absent') mappedStatus = 'absent';
    else if (firstStatus === 'late') mappedStatus = 'late';
    else if (firstStatus === 'excused') mappedStatus = 'excused';
    
    return { 
      status, 
      consecutiveDays, 
      consecutiveStatus: mappedStatus,
      trendDirection,
      recentPattern
    };
  }
  
  /**
   * Assess attendance risk and generate interventions
   * 
   * Risk Levels:
   * - Low (<5% absent): No intervention needed
   * - Medium (5-10% absent): Monitor closely
   * - High (10-15% absent): Parent conference required
   * - Critical (>15% absent): Immediate intervention
   */
  assessAttendanceRisk(
    allRecords: AttendanceRecord[],
    expectedDaysThisYear: number,
    expectedDaysThisMonth: number
  ): AttendanceRiskAssessment {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Filter records for current month
    const thisMonthRecords = allRecords.filter(r => 
      new Date(r.date) >= startOfMonth
    );
    
    // Calculate metrics
    const attendanceRate = this.calculateAttendanceRate(allRecords, expectedDaysThisYear);
    const isChronicAbsentee = this.isChronicAbsentee(allRecords, expectedDaysThisYear);
    
    const daysAbsentThisMonth = thisMonthRecords.filter(r => 
      r.status === 'absent'
    ).length;
    
    const daysAbsentThisYear = allRecords.filter(r => 
      r.status === 'absent'
    ).length;
    
    // Note: unexcused absences tracked via excuseReason field absence
    const unexcusedAbsences = allRecords.filter(r => 
      r.status === 'absent' && !r.excuseReason
    ).length;
    
    // Determine risk level based on attendance rate
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    const recommendations: string[] = [];
    let interventionRequired = false;
    let parentNotificationRequired = false;
    
    if (attendanceRate >= 95) {
      riskLevel = 'low';
      recommendations.push('Attendance is satisfactory');
    } else if (attendanceRate >= 90) {
      riskLevel = 'medium';
      recommendations.push('Monitor attendance patterns closely');
      recommendations.push('Consider check-in with student about any barriers to attendance');
    } else if (attendanceRate >= 85) {
      riskLevel = 'high';
      interventionRequired = true;
      parentNotificationRequired = true;
      recommendations.push('Schedule parent/guardian conference');
      recommendations.push('Create attendance improvement plan');
      recommendations.push('Identify and address barriers to attendance');
      recommendations.push('Consider referral to school counselor');
    } else {
      riskLevel = 'critical';
      interventionRequired = true;
      parentNotificationRequired = true;
      recommendations.push('IMMEDIATE parent/guardian contact required');
      recommendations.push('Refer to attendance intervention team');
      recommendations.push('Document truancy concerns');
      recommendations.push('Develop comprehensive support plan');
      recommendations.push('Consider home visit or social services referral');
    }
    
    // Additional flags
    if (isChronicAbsentee) {
      recommendations.push('⚠️ Student meets chronic absenteeism criteria (10%+ absence rate)');
      interventionRequired = true;
    }
    
    if (unexcusedAbsences >= 3) {
      recommendations.push(`${unexcusedAbsences} unexcused absences this year - may require disciplinary action`);
      parentNotificationRequired = true;
    }
    
    if (daysAbsentThisMonth >= 3) {
      recommendations.push(`${daysAbsentThisMonth} absences this month - recent attendance concerns`);
    }
    
    return {
      riskLevel,
      isChronicAbsentee,
      daysAbsentThisMonth,
      daysAbsentThisYear,
      attendanceRate,
      recommendations,
      interventionRequired,
      parentNotificationRequired
    };
  }
  
  /**
   * Calculate comprehensive attendance statistics
   */
  calculateStatistics(records: AttendanceRecord[]): AttendanceStatistics {
    const totalDays = records.length;
    const presentDays = records.filter(r => r.status === 'present').length;
    const absentDays = records.filter(r => r.status === 'absent').length;
    const lateDays = records.filter(r => r.status === 'late' || r.status === 'tardy').length;
    const excusedDays = records.filter(r => r.status === 'excused').length;
    const unexcusedAbsentDays = records.filter(r => r.status === 'absent' && !r.excuseReason).length;
    
    const attendanceRate = totalDays > 0 
      ? Math.round(((presentDays + lateDays) / totalDays) * 100 * 100) / 100 
      : 0;
    
    const latenessRate = totalDays > 0 
      ? Math.round((lateDays / totalDays) * 100 * 100) / 100 
      : 0;
    
    const excusedRate = totalDays > 0 
      ? Math.round((excusedDays / totalDays) * 100 * 100) / 100 
      : 0;
    
    return {
      totalDays,
      presentDays,
      absentDays,
      lateDays,
      excusedDays,
      unexcusedAbsentDays,
      attendanceRate,
      latenessRate,
      excusedRate
    };
  }
  
  /**
   * Get attendance pattern description for reporting
   */
  getAttendancePatternDescription(
    records: AttendanceRecord[],
    days: number = 30
  ): string {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const recentRecords = records.filter(r => 
      new Date(r.date) >= cutoffDate
    ).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    if (recentRecords.length === 0) {
      return 'No attendance data available';
    }
    
    const stats = this.calculateStatistics(recentRecords);
    const patterns: string[] = [];
    
    if (stats.attendanceRate >= 98) {
      patterns.push('Excellent attendance');
    } else if (stats.attendanceRate >= 95) {
      patterns.push('Good attendance');
    } else if (stats.attendanceRate >= 90) {
      patterns.push('Satisfactory attendance with some absences');
    } else if (stats.attendanceRate >= 85) {
      patterns.push('Concerning attendance pattern - intervention recommended');
    } else {
      patterns.push('Critical attendance issues - immediate action required');
    }
    
    if (stats.latenessRate > 20) {
      patterns.push(`Frequent tardiness (${stats.latenessRate}% of days)`);
    }
    
    if (stats.unexcusedAbsentDays > 0) {
      patterns.push(`${stats.unexcusedAbsentDays} unexcused absences`);
    }
    
    return patterns.join('. ');
  }
}


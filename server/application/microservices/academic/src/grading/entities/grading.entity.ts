/*
 * Grading Entity - Represents grades for assignments and overall grade calculations
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#STUDENT#{studentId}#ASSIGNMENT#{assignmentId}#GRADE
 * 
 * GSI1: classroomId#academicYearId -> List all grades for a classroom
 * GSI2: teacherId#academicYearId -> List all grades submitted by a teacher
 * GSI3: studentId#academicYearId -> List all grades for a student
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string;      // Discriminator for entity type
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

// Global Grading System Support
export interface GradingSystem extends BaseEntity {
  entityType: 'GRADING_SYSTEM';
  systemId: string;
  schoolId: string;
  name: string; // "Letter Grades", "Percentage", "Numeric 1-10", "Pass/Fail"
  type: 'letter' | 'percentage' | 'numeric' | 'pass_fail' | 'custom';
  scale: {
    min: number;
    max: number;
    passingGrade: number;
    gradeLabels: Record<string, string>; // "A": "Excellent", "B": "Good"
  };
  isDefault: boolean;
  isActive: boolean;
  
  // GSI Keys
  gsi1pk: string; // schoolId#academicYearId
  gsi1sk: string; // GRADING_SYSTEM#{systemId}
}

// Grade Categories for Weighting
export interface GradeCategory extends BaseEntity {
  entityType: 'GRADE_CATEGORY';
  categoryId: string;
  classroomId: string;
  academicYearId: string;
  schoolId: string;
  name: string; // "Homework", "Tests", "Projects", "Participation"
  weight: number; // Percentage of total grade (0-100)
  color: string; // For UI visualization
  isActive: boolean;
  sortOrder: number;
  
  // GSI Keys
  gsi1pk: string; // classroomId#academicYearId
  gsi1sk: string; // GRADE_CATEGORY#{sortOrder}#{categoryId}
  gsi2pk: string; // schoolId#academicYearId
  gsi2sk: string; // GRADE_CATEGORY#{categoryId}
}

// Academic Terms/Semesters
export interface AcademicTerm extends BaseEntity {
  entityType: 'ACADEMIC_TERM';
  termId: string;
  schoolId: string;
  academicYearId: string;
  name: string; // "Fall Semester", "Spring Term", "Q1", "Q2"
  type: 'semester' | 'quarter' | 'trimester' | 'custom';
  startDate: string;
  endDate: string;
  isActive: boolean;
  weight: number; // Weight in final year grade calculation
  
  // GSI Keys
  gsi1pk: string; // schoolId#academicYearId
  gsi1sk: string; // ACADEMIC_TERM#{startDate}#{termId}
  gsi2pk: string; // academicYearId
  gsi2sk: string; // ACADEMIC_TERM#{termId}
}

export interface Grade extends BaseEntity {
  entityType: 'GRADE';  // Literal type for type safety
  gradeId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  assignmentId?: string; // Optional - can be standalone grade
  studentId: string;
  termId?: string; // Which term/semester this grade belongs to
  
  // Grade details
  score: number;                     // Points earned
  maxPoints: number;                 // Total points possible
  percentage: number;                // Calculated: (score / maxPoints) * 100
  letterGrade?: string;              // e.g., 'A', 'B+', 'C-'
  gradePoints?: number;              // GPA points (4.0 scale)
  
  // Categorization
  categoryId: string;
  categoryName: string;
  categoryWeight: number;
  
  // Submission info
  submittedAt?: string;              // When student submitted
  gradedAt: string;                  // When teacher graded
  gradedByTeacherId: string;
  
  // Late submission
  isLate: boolean;
  daysLate?: number;
  penaltyApplied?: number;           // Percentage penalty applied
  
  // Feedback
  feedback?: string;
  rubricScores?: RubricScore[];
  
  // Status
  status: 'draft' | 'published' | 'revised';
  publishedAt?: string;              // When grade was released to student
  
  // Analytics & Insights
  gradeTrend: 'improving' | 'declining' | 'stable';
  percentile: number;                // Student's percentile in class
  classAverage: number;              // Class average for this grade
  standardDeviation: number;         // Statistical measure
  
  // Compliance & Audit
  lastModifiedBy: string;
  lastModifiedAt: string;
  isExcused: boolean;
  isFinal: boolean;                  // Cannot be changed
  canRetake: boolean;
  retakeCount: number;
  
  // GSI keys for efficient queries
  gsi1pk: string;                    // classroomId#academicYearId
  gsi1sk: string;                    // GRADE#{gradedAt}#{gradeId}
  gsi2pk: string;                    // studentId#academicYearId
  gsi2sk: string;                    // GRADE#{gradedAt}#{gradeId}
  gsi3pk: string;                    // assignmentId#academicYearId (if assignmentId exists)
  gsi3sk: string;                    // GRADE#{gradedAt}#{gradeId}
  gsi4pk: string;                    // categoryId#academicYearId
  gsi4sk: string;                    // GRADE#{gradedAt}#{gradeId}
  gsi5pk: string;                    // termId#academicYearId (if termId exists)
  gsi5sk: string;                    // GRADE#{gradedAt}#{gradeId}
  gsi6pk: string;                    // schoolId#academicYearId
  gsi6sk: string;                    // GRADE#{gradedAt}#{gradeId}
}

export interface RubricScore {
  criteriaName: string;
  maxPoints: number;
  pointsEarned: number;
  feedback?: string;
}

// Grading scale configuration
export interface GradingScale {
  scaleId: string;
  name: string;                      // e.g., "Standard Letter Grade"
  type: 'letter' | 'percentage' | 'points' | 'passfail';
  ranges: GradeRange[];
}

export interface GradeRange {
  min: number;                       // Minimum percentage
  max: number;                       // Maximum percentage
  letter: string;                    // e.g., 'A', 'B+', 'C-'
  gpa?: number;                      // Optional GPA value
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
}

// Grade Analytics for Data-Driven Decisions
export interface GradeAnalytics extends BaseEntity {
  entityType: 'GRADE_ANALYTICS';
  analyticsId: string;
  studentId?: string; // Optional - can be classroom/school level
  classroomId?: string;
  schoolId: string;
  academicYearId: string;
  termId?: string;
  
  // Performance Metrics
  currentAverage: number;
  gradeTrend: 'improving' | 'declining' | 'stable';
  assignmentCompletion: number; // Percentage
  
  // Comparative Analysis
  classRank: number;
  percentile: number;
  gradeDistribution: {
    A: number;
    B: number;
    C: number;
    D: number;
    F: number;
  };
  
  // Predictive Analytics
  predictedFinalGrade: string;
  riskLevel: 'low' | 'medium' | 'high';
  interventionNeeded: boolean;
  
  // Category Breakdown
  categoryAverages: {
    categoryId: string;
    categoryName: string;
    average: number;
    weight: number;
    contribution: number; // Contribution to overall grade
  }[];
  
  // Historical Data
  gradeHistory: {
    date: string;
    grade: number;
    assignment: string;
    category: string;
  }[];
  
  // Insights
  improvementAreas: string[];
  strengths: string[];
  recommendations: string[];
  
  // GSI Keys
  gsi1pk: string; // studentId#academicYearId (if student level)
  gsi1sk: string; // GRADE_ANALYTICS#{analyticsId}
  gsi2pk: string; // classroomId#academicYearId (if classroom level)
  gsi2sk: string; // GRADE_ANALYTICS#{analyticsId}
  gsi3pk: string; // schoolId#academicYearId
  gsi3sk: string; // GRADE_ANALYTICS#{analyticsId}
}

// Teacher Analytics for Classroom Insights
export interface TeacherAnalytics extends BaseEntity {
  entityType: 'TEACHER_ANALYTICS';
  analyticsId: string;
  teacherId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  
  // Classroom Metrics
  totalStudents: number;
  averageGrade: number;
  gradeDistribution: {
    A: number;
    B: number;
    C: number;
    D: number;
    F: number;
  };
  
  // Performance Insights
  strugglingStudents: {
    studentId: string;
    studentName: string;
    currentAverage: number;
    riskLevel: 'low' | 'medium' | 'high';
    lastIntervention: string;
  }[];
  
  excellingStudents: {
    studentId: string;
    studentName: string;
    currentAverage: number;
    strengths: string[];
  }[];
  
  atRiskStudents: {
    studentId: string;
    studentName: string;
    currentAverage: number;
    riskFactors: string[];
    recommendedActions: string[];
  }[];
  
  // Assignment Analysis
  assignmentAverages: {
    assignmentId: string;
    assignmentName: string;
    average: number;
    difficulty: 'easy' | 'medium' | 'hard';
    completionRate: number;
  }[];
  
  // Trends
  gradeTrends: {
    period: string;
    average: number;
    trend: 'up' | 'down' | 'stable';
  }[];
  
  // Recommendations
  improvementSuggestions: string[];
  teachingEffectiveness: number; // 0-100 score
  
  // GSI Keys
  gsi1pk: string; // teacherId#academicYearId
  gsi1sk: string; // TEACHER_ANALYTICS#{analyticsId}
  gsi2pk: string; // classroomId#academicYearId
  gsi2sk: string; // TEACHER_ANALYTICS#{analyticsId}
  gsi3pk: string; // schoolId#academicYearId
  gsi3sk: string; // TEACHER_ANALYTICS#{analyticsId}
}

export class EntityKeyBuilder {
  static grade(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    assignmentId?: string
  ): string {
    const assignmentPart = assignmentId ? `#ASSIGNMENT#${assignmentId}` : '';
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}${assignmentPart}#GRADE`;
  }

  static gradingSystem(schoolId: string, academicYearId: string, systemId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADING_SYSTEM#${systemId}`;
  }

  static gradeCategory(schoolId: string, academicYearId: string, categoryId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADE_CATEGORY#${categoryId}`;
  }

  static academicTerm(schoolId: string, academicYearId: string, termId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ACADEMIC_TERM#${termId}`;
  }

  static gradeAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADE_ANALYTICS#${analyticsId}`;
  }

  static teacherAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#TEACHER_ANALYTICS#${analyticsId}`;
  }
}


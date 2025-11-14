/**
 * Enrollment Service Entity Types
 * 
 * These interfaces represent the entities returned by API responses.
 * Extracted from:
 * server/application/microservices/enrollment/src/common/entities/
 * 
 * Note: Only entities that are exposed via API responses are included here.
 */

import type { BaseEntity } from '../common';

// Re-export BaseEntity for convenience
export type { BaseEntity } from '../common';

/**
 * Address structure
 */
export interface Address {
  street: string;
  city: string;
  state: string;
  country: string; // ISO 3166-1 alpha-2
  postalCode: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Student - Core student entity
 */
export interface Student extends BaseEntity {
  entityType: 'STUDENT';
  studentId: string;
  studentNumber: string; // Unique within tenant: "STU-2024-001"
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string; // ISO date
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  contactInfo: {
    email?: string;
    phone?: string;
    address: Address;
  };
  
  guardians: Array<{
    guardianId: string; // UUID (references Parent entity)
    relationship: 'parent' | 'guardian' | 'emergency_contact';
    isPrimary: boolean;
  }>;
  
  medicalInfo?: {
    allergies?: string[]; // Encrypted
    medications?: string[]; // Encrypted
    emergencyContact: {
      name: string; // Encrypted
      phone: string; // Encrypted
      relationship: string;
    };
  };
  
  currentEnrollment?: {
    schoolId: string;
    academicYearId: string;
    gradeLevel: string;
    status: 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  };
}

/**
 * Enrollment - Student enrollment in a school/year
 */
export interface Enrollment extends BaseEntity {
  entityType: 'ENROLLMENT';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string; // UUID
  
  enrollmentDate: string; // ISO date
  gradeLevel: string; // "K", "1", "2", ..., "12"
  section?: string; // "A", "B", "C"
  
  status: 'pending' | 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';
  statusReason?: string;
  statusDate: string; // When status changed
  
  transferredFrom?: {
    schoolId: string;
    schoolName: string;
    transferDate: string;
  };
  transferredTo?: {
    schoolId: string;
    schoolName: string;
    transferDate: string;
  };
  
  academicStatus: 'on_track' | 'at_risk' | 'probation' | 'honor_roll';
  promotionEligible: boolean;
  graduationDate?: string; // ISO date
}

/**
 * Staff - School staff/teacher entity
 */
export interface Staff extends BaseEntity {
  entityType: 'STAFF';
  staffId: string; // UUID
  employeeNumber: string; // Unique: "EMP-2024-001"
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string; // ISO date
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  
  contactInfo: {
    email: string;
    phone: string;
    address: Address;
  };
  
  employment: {
    hireDate: string; // ISO date
    employmentType: 'full_time' | 'part_time' | 'contract' | 'substitute';
    status: 'active' | 'on_leave' | 'terminated' | 'retired';
    terminationDate?: string;
  };
  
  roles: Array<{
    roleType: 'teacher' | 'principal' | 'vice_principal' | 'counselor' | 'administrator' | 'support_staff';
    schoolId: string;
    departmentId?: string;
    startDate: string;
    endDate?: string;
    isPrimary: boolean;
  }>;
  
  qualifications: {
    education: Array<{
      degree: string;
      institution: string;
      year: number;
    }>;
    certifications: string[];
    licenses: string[];
  };
}

/**
 * Parent - Parent/guardian entity
 */
export interface Parent extends BaseEntity {
  entityType: 'PARENT';
  parentId: string; // UUID
  firstName: string;
  lastName: string;
  middleName?: string;
  
  contactInfo: {
    email: string;
    phone: string;
    alternatePhone?: string;
    address: Address;
  };
  
  children: Array<{
    studentId: string; // References Student entity
    relationship: 'parent' | 'guardian' | 'emergency_contact';
    isPrimary: boolean;
  }>;
  
  accountAccess: {
    portalEnabled: boolean;
    lastLogin?: string; // ISO timestamp
    notificationPreferences: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
  };
}

/**
 * Tuition Configuration - Tuition rates and fees for a school/year
 */
export interface TuitionConfiguration extends BaseEntity {
  entityType: 'TUITION_CONFIG';
  schoolId: string;
  academicYearId: string;
  
  tuitionRates: {
    [gradeLevel: string]: { // "K", "1", "2", ..., "12"
      amount: number;
      currency: string; // ISO 4217
      frequency: 'annual' | 'semester' | 'monthly' | 'quarterly';
      dueDates?: string[]; // ISO dates
      description?: string;
    };
  };
  
  fees: Array<{
    feeId: string; // UUID
    feeName: string;
    feeType: 'registration' | 'technology' | 'activity' | 'lab' | 'sports' | 'field_trip' | 'uniform' | 'other';
    amount: number;
    frequency: 'one_time' | 'annual' | 'semester' | 'monthly' | 'per_course';
    isMandatory: boolean;
    applicableGrades?: string[];
    description?: string;
  }>;
  
  discountPolicies: Array<{
    policyId: string; // UUID
    name: string;
    type: 'sibling' | 'early_payment' | 'scholarship' | 'financial_aid' | 'staff_discount' | 'custom';
    discountPercentage?: number;
    discountAmount?: number;
    conditions: string;
    applicableTo: 'tuition' | 'fees' | 'both';
    maxDiscount?: number;
  }>;
  
  paymentPlans: Array<{
    planId: string; // UUID
    planName: string;
    installmentCount: number;
    installmentAmount: number;
    dueDates: string[]; // ISO dates
  }>;
  
  taxSettings?: {
    taxEnabled: boolean;
    taxRate: number; // Percentage
    taxExemptItems?: string[];
  };
}

/**
 * Student Billing Account - Financial account for a student in a school/year
 */
export interface StudentBillingAccount extends BaseEntity {
  entityType: 'BILLING_ACCOUNT';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string; // UUID
  
  balance: {
    totalDue: number;
    totalPaid: number;
    totalOutstanding: number; // Calculated: totalDue - totalPaid
    currency: string;
    lastUpdated: string; // ISO timestamp
  };
  
  paymentPlan: 'full' | 'installment' | 'custom';
  installmentCount?: number;
  installmentAmount?: number;
  nextDueDate?: string; // ISO date
  
  status: 'active' | 'paid_in_full' | 'overdue' | 'on_hold' | 'cancelled';
}

/**
 * Invoice - Financial invoice for student tuition and fees
 */
export interface Invoice extends BaseEntity {
  entityType: 'INVOICE';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string; // Links to StudentBillingAccount
  invoiceId: string; // UUID
  invoiceNumber: string; // Human-readable: "INV-2024-001"
  
  issueDate: string; // ISO date
  dueDate: string; // ISO date
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'partially_paid';
  
  lineItems: Array<{
    itemId: string; // UUID
    description: string;
    category: 'tuition' | 'fee' | 'discount' | 'adjustment' | 'refund' | 'other';
    quantity: number;
    unitPrice: number;
    amount: number; // quantity × unitPrice
    tax?: number;
    sourceConfig?: {
      tuitionConfigId?: string;
      feeId?: string;
      discountPolicyId?: string;
    };
  }>;
  
  subtotal: number;
  tax: number;
  discounts: number;
  total: number;
  currency: string;
  
  payments: Array<{
    paymentId: string;
    amount: number;
    paymentDate: string; // ISO date
    paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';
    referenceNumber?: string;
    notes?: string;
  }>;
  
  amountPaid: number; // Sum of payments
  amountDue: number; // total - amountPaid
}

/**
 * Payment - Payment record for an invoice
 */
export interface Payment extends BaseEntity {
  entityType: 'PAYMENT';
  invoiceId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  accountId: string;
  paymentId: string; // UUID
  
  amount: number;
  currency: string;
  paymentDate: string; // ISO date
  paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  
  referenceNumber?: string;
  notes?: string;
  receivedBy?: string; // userId
  
  gatewayTransactionId?: string;
  gatewayResponse?: any;
}

/**
 * Response Types
 */

/**
 * Student List Response
 */
export interface StudentListResponse {
  items: Student[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Enrollment List Response
 */
export interface EnrollmentListResponse {
  items: Enrollment[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Staff List Response
 */
export interface StaffListResponse {
  items: Staff[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Parent List Response
 */
export interface ParentListResponse {
  items: Parent[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Invoice List Response
 */
export interface InvoiceListResponse {
  items: Invoice[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Payment List Response
 */
export interface PaymentListResponse {
  items: Payment[];
  nextToken?: string;
  hasMore: boolean;
  total?: number;
}


/**
 * Schedule and Classroom Entities for Academics Service
 * 
 * Schedule Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHEDULE#{schoolId}#{scheduleId}
 * 
 * Classroom Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: CLASSROOM#{schoolId}#{roomId}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';

/**
 * Schedule entity - represents a class schedule
 */
export interface Schedule extends BaseEntity {
  entityType: 'SCHEDULE';
  
  // Identity
  scheduleId: string;
  scheduleName?: string;
  
  // References
  schoolId: string;
  academicYearId: string;
  termId?: string;
  sectionId: string;
  courseId: string;
  
  // Teacher
  teacherId: string;
  substituteTeacherId?: string;
  
  // Room
  roomId?: string;
  
  // Time slots
  slots: ScheduleSlot[];
  
  // Status
  isActive: boolean;
  effectiveFrom: string;
  effectiveUntil?: string;
  
  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // SCHEDULE#{teacherId}
}

/**
 * Schedule time slot
 */
export interface ScheduleSlot {
  dayOfWeek: number;  // 0-6 (Sunday-Saturday)
  periodNumber?: number;
  startTime: string;  // HH:MM format
  endTime: string;
  isRecurring: boolean;
  exceptions?: ScheduleException[];
}

/**
 * Schedule exception (e.g., holiday, special schedule)
 */
export interface ScheduleException {
  date: string;  // ISO date
  type: 'cancelled' | 'rescheduled' | 'modified';
  reason?: string;
  newSlot?: Omit<ScheduleSlot, 'dayOfWeek' | 'isRecurring' | 'exceptions'>;
}

/**
 * Classroom entity - represents a physical room
 */
export interface Classroom extends BaseEntity {
  entityType: 'CLASSROOM';
  
  // Identity
  roomId: string;
  roomNumber: string;
  roomName?: string;
  
  // School
  schoolId: string;
  
  // Location
  building?: string;
  floor?: number;
  wing?: string;
  
  // Capacity
  capacity: number;
  
  // Type
  roomType: RoomType;
  
  // Features
  features?: RoomFeature[];
  
  // Equipment
  equipment?: string[];
  
  // Accessibility
  isAccessible?: boolean;
  accessibilityNotes?: string;
  
  // Status
  isActive: boolean;
  isAvailable: boolean;
  
  // Usage
  primaryUsage?: string;  // e.g., 'Math Department'
  assignedTeacherId?: string;  // If dedicated to a teacher
  
  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // CLASSROOM#{building}#{roomNumber}
}

/**
 * Room type enumeration
 */
export type RoomType = 
  | 'classroom'
  | 'laboratory'
  | 'gymnasium'
  | 'auditorium'
  | 'library'
  | 'cafeteria'
  | 'computer_lab'
  | 'art_room'
  | 'music_room'
  | 'conference'
  | 'office'
  | 'other';

/**
 * Room feature
 */
export type RoomFeature = 
  | 'projector'
  | 'smartboard'
  | 'whiteboard'
  | 'computers'
  | 'ac'
  | 'natural_light'
  | 'audio_system'
  | 'video_conferencing'
  | 'lab_equipment'
  | 'piano'
  | 'stage';

/**
 * Create a new Schedule entity with proper keys
 */
export function createScheduleEntity(
  tenantId: string,
  scheduleId: string,
  schoolId: string,
  data: Omit<Schedule, 'tenantId' | 'entityKey' | 'entityType' | 'scheduleId' | 'schoolId' | 'gsi1pk' | 'gsi1sk'>
): Schedule {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.schedule(schoolId, scheduleId),
    entityType: 'SCHEDULE',
    scheduleId,
    schoolId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `SCHEDULE#${data.teacherId}`,
    ...data,
  };
}

/**
 * Create a new Classroom entity with proper keys
 */
export function createClassroomEntity(
  tenantId: string,
  roomId: string,
  schoolId: string,
  data: Omit<Classroom, 'tenantId' | 'entityKey' | 'entityType' | 'roomId' | 'schoolId' | 'gsi1pk' | 'gsi1sk'>
): Classroom {
  const building = data.building || 'main';
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.classroom(schoolId, roomId),
    entityType: 'CLASSROOM',
    roomId,
    schoolId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `CLASSROOM#${building}#${data.roomNumber}`,
    ...data,
  };
}


/**
 * Identity Service Root Module
 * 
 * Provides authentication, user management, ABAC role assignment, session management,
 * school management, tenant management, and security features.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from '@app/health';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { SessionsModule } from './sessions/sessions.module';
import { SchoolsModule } from './schools/schools.module';
import { TenantsModule } from './tenants/tenants.module';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { SchoolYearsModule } from './school-years/school-years.module';
import { SecurityModule } from './security/security.module';
import { EducationOrganizationsModule } from './education-organizations/education-organizations.module';
import { StaffModule } from './staff/staff.module';
import { CredentialsModule } from './credentials/credentials.module';
import { StaffTrainingsModule } from './staff-trainings/staff-trainings.module';
import { LeaveModule } from './leave/leave.module';
import { AdminModule } from './admin/admin.module';
import { CalendarModule } from './schools/calendar.module';
import { MasterScheduleModule } from './schools/master-schedule.module';
import { IemisModule } from './iemis/iemis.module';
import { HolidaySeedModule } from './holiday-seeds/holiday-seed.module';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityEventsService } from './common/services/identity-events.service';
import { AuditedWriteService } from './common/services/audited-write.service';
import { IdempotencyService } from './common/services/idempotency.service';
import { AnalyticsEventsModule, FeatureUsageInterceptor } from '@app/analytics-events';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    AnalyticsEventsModule, // Layer 4 — global analytics publisher
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    SessionsModule,
    SchoolsModule,
    EducationOrganizationsModule, // EdOrg hierarchy: SEA, LEA, ESC
    TenantsModule,
    AcademicYearsModule,
    SchoolYearsModule,  // Tenant-wide school year aggregation for Shell context
    SecurityModule,     // User security management (password, MFA, sessions, login history)
    StaffModule,           // Staff management with Ed-Fi alignment (NEW)
    CredentialsModule,     // Staff credential/certification management (NEW)
    StaffTrainingsModule,  // Staff professional development / training (Sprint B)
    LeaveModule,           // Staff leave request management (NEW)
    AdminModule,        // Admin operations (cleanup, maintenance)
    CalendarModule,         // Ed-Fi Calendar Domain: Calendar, CalendarDate, AcademicSession
    MasterScheduleModule,   // Ed-Fi Master Schedule: ClassPeriod, Location
    IemisModule,            // Nepal IEMIS (CEHRD) integration — Sprint 1+
    HolidaySeedModule,      // C3.3 — GET /holiday-seeds archetype-aware lookup
  ],
  providers: [
    DynamoDBClientService,
    IdentityEventsService,
    AuditedWriteService, // S0.8 — uniform audit-row emission
    IdempotencyService,  // S0.10 — Idempotency-Key foundation (rollout deferred per endpoint)
    // Layer 4.7 — global FeatureUsage interceptor. Non-GET HTTP requests
    // emit a FeatureUsage analytics event via @app/analytics-events.
    // No-op when ANALYTICS_ENABLED=false.
    { provide: APP_INTERCEPTOR, useClass: FeatureUsageInterceptor },
  ],
  exports: [
    DynamoDBClientService,
    IdentityEventsService,
    AuditedWriteService,
    IdempotencyService,
  ],
})
export class IdentityModule {}


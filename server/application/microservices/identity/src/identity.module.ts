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
import { StaffModule } from './staff/staff.module';
import { CredentialsModule } from './credentials/credentials.module';
import { LeaveModule } from './leave/leave.module';
import { AdminModule } from './admin/admin.module';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { IdentityEventsService } from './common/services/identity-events.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    SessionsModule,
    SchoolsModule,
    TenantsModule,
    AcademicYearsModule,
    SchoolYearsModule,  // Tenant-wide school year aggregation for Shell context
    SecurityModule,     // User security management (password, MFA, sessions, login history)
    StaffModule,        // Staff management with Ed-Fi alignment (NEW)
    CredentialsModule,  // Staff credential/certification management (NEW)
    LeaveModule,        // Staff leave request management (NEW)
    AdminModule,        // Admin operations (cleanup, maintenance)
  ],
  providers: [DynamoDBClientService, IdentityEventsService],
  exports: [DynamoDBClientService, IdentityEventsService],
})
export class IdentityModule {}


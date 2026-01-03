/**
 * Identity Service Root Module
 * 
 * Provides authentication, user management, ABAC role assignment, session management,
 * school management, and tenant management.
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
  ],
  providers: [DynamoDBClientService, IdentityEventsService],
  exports: [DynamoDBClientService, IdentityEventsService],
})
export class IdentityModule {}


/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Schools Module 
 * 
 * PROVIDERS:
 * - SchoolsService: Core school CRUD operations
 * - ValidationService: Input validation and business rules
 * - AcademicYearService: Temporal boundary management
 * - EventService: EventBridge integration for events
 */

import { Module } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { SchoolsController } from './schools.controller';
import { ValidationService } from './services/validation.service';
import { AcademicYearService } from './services/academic-year.service';
import { EventService } from './services/event.service';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ClientFactoryModule
  ],
  controllers: [SchoolsController],
  providers: [
    SchoolsService,
    ValidationService,
    AcademicYearService,
    EventService
  ]
})
export class SchoolsModule {}

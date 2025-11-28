/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

import { NestFactory } from '@nestjs/core';
import { SchoolsModule } from './schools/schools.module';
import * as compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(SchoolsModule);
  app.setGlobalPrefix('/');
  
  // Enable response compression (Gzip) - Phase 5: Performance Optimizations
  app.use(compression({ threshold: 1024 })); // Compress responses > 1KB
  
  app.enableCors({
    allowedHeaders: '*',
    origin: '*',
    methods: '*'
  });
  await app.listen(3010);
}
bootstrap();

/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

import { NestFactory } from '@nestjs/core';
import { SchoolsModule } from './schools/schools.module';

async function bootstrap() {
  const app = await NestFactory.create(SchoolsModule);
  app.setGlobalPrefix('/');
  app.enableCors({
    allowedHeaders: '*',
    origin: '*',
    methods: '*'
  });
  await app.listen(3010);
}
bootstrap();

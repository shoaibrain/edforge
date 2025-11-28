import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable response compression (Gzip) - Phase 5: Performance Optimizations
  app.use(compression({ threshold: 1024 })); // Compress responses > 1KB
  
  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: '*',
  });

  const port = process.env.PORT || 3006;
  await app.listen(port);
  console.log(`💰 Finance Service running on port ${port}`);
}

bootstrap();


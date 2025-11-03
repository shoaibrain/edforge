import { Module } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { ValidationService } from './services/validation.service';
import { AuthModule } from '@app/auth/auth.module';
import { ClientFactoryModule } from '@app/client-factory/client-factory.module';

@Module({
  imports: [AuthModule, ClientFactoryModule],
  controllers: [StreamController],
  providers: [StreamService, ValidationService],
  exports: [StreamService, ValidationService],
})
export class StreamModule {}

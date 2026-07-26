import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}

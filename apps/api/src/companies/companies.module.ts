import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  imports: [UsersModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  // The public API (/v1) calls straight into it.
  exports: [CompaniesService],
})
export class CompaniesModule {}

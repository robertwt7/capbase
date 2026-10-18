import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';

@Module({
  imports: [UsersModule],
  controllers: [InvestorsController],
  providers: [InvestorsService],
  exports: [InvestorsService],
})
export class InvestorsModule {}

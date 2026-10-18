import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { FundsController } from './funds.controller';
import { FundsService } from './funds.service';

@Module({
  imports: [UsersModule],
  controllers: [FundsController],
  providers: [FundsService],
  exports: [FundsService],
})
export class FundsModule {}

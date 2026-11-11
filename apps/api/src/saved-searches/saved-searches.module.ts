import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MfaPolicyModule } from '../auth/mfa/policy';
import { FullAccessService, FullAccessGuard } from './full-access.guard';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesController } from './saved-searches.controller';
@Module({
  imports: [UsersModule, MfaPolicyModule],
  controllers: [SavedSearchesController],
  providers: [FullAccessService, FullAccessGuard, SavedSearchesService],
  exports: [FullAccessService, FullAccessGuard, SavedSearchesService],
})
export class SavedSearchesModule {}

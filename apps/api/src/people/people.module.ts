import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  imports: [UsersModule],
  controllers: [PeopleController],
  providers: [PeopleService],
  // The admin suppression endpoints and the public API (/v1) call straight into it.
  exports: [PeopleService],
})
export class PeopleModule {}

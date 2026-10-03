import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { EntitiesController } from './entities.controller';
import { EntityResolutionService } from './entity-resolution.service';

@Module({
  imports: [CasesModule],
  controllers: [EntitiesController],
  providers: [EntityResolutionService],
  exports: [EntityResolutionService],
})
export class EntitiesModule {}

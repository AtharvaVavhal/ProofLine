import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { EvidenceCleanupScheduler } from './evidence-cleanup.scheduler';
import { EvidenceController } from './evidence.controller';
import { EvidencePresenter } from './evidence.presenter';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [CasesModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidencePresenter, EvidenceCleanupScheduler],
})
export class EvidenceModule {}

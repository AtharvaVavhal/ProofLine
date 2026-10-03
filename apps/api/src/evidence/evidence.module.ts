import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { EvidenceCleanupScheduler } from './evidence-cleanup.scheduler';
import { EvidenceLifecycleService } from './evidence-lifecycle.service';
import { EvidenceController } from './evidence.controller';
import { EvidencePresenter } from './evidence.presenter';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [CasesModule],
  controllers: [EvidenceController],
  providers: [
    EvidenceService,
    EvidencePresenter,
    EvidenceCleanupScheduler,
    EvidenceLifecycleService,
  ],
  exports: [EvidenceLifecycleService],
})
export class EvidenceModule {}

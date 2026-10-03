import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ProcessingModule } from '../processing/processing.module';
import { AnalysisRunsModule } from './analysis-runs.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisWorker } from './analysis-worker';
import { OrchestratorService } from './orchestrator.service';

@Module({
  imports: [CasesModule, EvidenceModule, ProcessingModule, ExtractionModule, AnalysisRunsModule],
  controllers: [AnalysisController],
  providers: [OrchestratorService, AnalysisWorker],
})
export class OrchestratorModule {}

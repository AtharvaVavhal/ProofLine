import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CasesModule } from '../cases/cases.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { AnalysisRunsModule } from '../orchestrator/analysis-runs.module';
import { ProvenanceModule } from '../provenance/provenance.module';
import { ExtractionCorrectionService } from './extraction-correction.service';
import { ExtractionController } from './extraction.controller';
import { ExtractionService } from './extraction.service';

/** `extraction` (04 §4.2): candidates, literal validation, extractions and corrections. */
@Module({
  imports: [AiModule, CasesModule, EvidenceModule, ProvenanceModule, AnalysisRunsModule],
  controllers: [ExtractionController],
  providers: [ExtractionService, ExtractionCorrectionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}

import { Module } from '@nestjs/common';
import { AnalysisRunsService } from './analysis-runs.service';

/** Run creation without the pipeline, so re-entry triggers need not depend on the orchestrator. */
@Module({ providers: [AnalysisRunsService], exports: [AnalysisRunsService] })
export class AnalysisRunsModule {}

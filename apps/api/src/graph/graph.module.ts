import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProvenanceModule } from '../provenance/provenance.module';
import { CorrelationService } from './correlation.service';

@Module({
  imports: [AiModule, ProvenanceModule],
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class GraphModule {}

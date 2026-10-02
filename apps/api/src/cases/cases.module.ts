import { Module } from '@nestjs/common';
import { ProvenanceModule } from '../provenance/provenance.module';
import { CaseAccessService } from './case-access.service';
import { CaseReadModel } from './case-read-model';
import { CaseStateService } from './case-state.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

@Module({
  imports: [ProvenanceModule],
  controllers: [CasesController],
  providers: [CasesService, CaseAccessService, CaseStateService, CaseReadModel],
  exports: [CaseAccessService, CaseStateService],
})
export class CasesModule {}

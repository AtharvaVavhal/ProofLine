import { Module } from '@nestjs/common';
import { ProvenanceService } from './provenance.service';

@Module({ providers: [ProvenanceService], exports: [ProvenanceService] })
export class ProvenanceModule {}

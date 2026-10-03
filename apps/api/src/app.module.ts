import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EvidenceModule } from './evidence/evidence.module';
import { ExtractionModule } from './extraction/extraction.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { ProcessingModule } from './processing/processing.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CommonModule,
    AuditModule,
    StorageModule,
    AuthModule,
    CasesModule,
    EvidenceModule,
    JobsModule,
    ProcessingModule,
    ExtractionModule,
    OrchestratorModule,
    HealthModule,
  ],
})
export class AppModule {}

import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { QueueService } from '../jobs/queue.service';
import { OrchestratorService } from './orchestrator.service';

/** Registers the analysis worker in this process when WORKER_ENABLED (OD-15). */
@Injectable()
export class AnalysisWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: QueueService,
    private readonly orchestrator: OrchestratorService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.workerEnabled) return;
    await this.queue.workAnalysis((job) => this.orchestrator.execute(job));
  }
}

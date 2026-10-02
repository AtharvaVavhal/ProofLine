import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { EvidenceService } from './evidence.service';

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodically removes abandoned UPLOADING registrations (07 §5). A plain in-process timer;
 * the job queue (pg-boss) arrives with processing in Phase 5. Not started under NODE_ENV=test.
 */
@Injectable()
export class EvidenceCleanupScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('EvidenceCleanup');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly evidence: EvidenceService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const removed = await this.evidence.cleanupAbandonedUploads();
      if (removed > 0) this.logger.log(`Removed ${removed} abandoned upload(s)`);
    } catch (error) {
      this.logger.error(
        `Cleanup failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`,
      );
    }
  }
}

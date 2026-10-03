import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import PgBoss from 'pg-boss';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';

/** The one queue in this phase (04 §14.1). Created by `pnpm queue:install`, not at runtime. */
export const ANALYZE_CASE_QUEUE = 'analyze-case';

/** Jobs carry IDs only (07 §25). */
export type AnalyzeCaseJob = { caseId: string; runId: string };

/**
 * pg-boss in the API process (OD-15). The queue schema is installed by the migration role
 * (`pnpm queue:install`), so the runtime role keeps no DDL rights (03 §20): `migrate: false`.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private boss!: PgBoss;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.boss = new PgBoss({
      connectionString: this.config.databaseUrl,
      migrate: false,
      schedule: false,
    });
    this.boss.on('error', (error: Error) =>
      this.logger.error(`Queue error: ${error.constructor.name}`),
    );
    await this.boss.start();
  }

  /**
   * Enqueues inside the caller's transaction, so a run row never exists without its job
   * (04 §24: the pg-boss insert shares the transaction). Singleton per case.
   */
  async enqueueAnalysis(tx: Prisma.TransactionClient, job: AnalyzeCaseJob): Promise<void> {
    await this.boss.send(ANALYZE_CASE_QUEUE, job, {
      singletonKey: job.caseId,
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 15 * 60,
      db: {
        executeSql: async (text: string, values: unknown[]) => ({
          rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
        }),
      },
    });
  }

  async workAnalysis(handler: (job: AnalyzeCaseJob) => Promise<void>): Promise<void> {
    await this.boss.work<AnalyzeCaseJob>(
      ANALYZE_CASE_QUEUE,
      { pollingIntervalSeconds: 0.5, batchSize: 1 },
      async ([job]) => {
        if (job) await handler(job.data);
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }
}

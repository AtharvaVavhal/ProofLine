import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { requestContext } from './common/request-context.middleware';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/env';

/** Body parsing is configured in configureApp (JSON ≤ 64 KB, 05 §3). */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** Browser-facing paths are served under /api through the web rewrite (05 §1). */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestContext);
  app.useBodyParser('json', { limit: '64kb' });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}

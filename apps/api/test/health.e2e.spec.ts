import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_OPTIONS, configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

describe('GET /api/health', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  async function start(prismaOverride?: unknown) {
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (prismaOverride) builder = builder.overrideProvider(PrismaService).useValue(prismaOverride);
    const moduleRef = await builder.compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    configureApp(nest);
    await nest.init();
    app = nest;
  }

  it('is public and returns 200 when PostgreSQL is reachable', async () => {
    await start();
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200, { status: 'ok', database: 'up' });
  });

  it('returns the 503 error envelope when PostgreSQL is unreachable', async () => {
    await start({ isReachable: async () => false });
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

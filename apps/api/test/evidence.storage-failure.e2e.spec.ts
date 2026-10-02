import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_OPTIONS, configureApp } from '../src/app.setup';
import { EMAIL_TRANSPORT } from '../src/auth/email/email-transport';
import {
  OBJECT_STORAGE,
  ObjectStorage,
  StorageUnavailableError,
} from '../src/storage/object-storage';
import { CapturingEmailTransport, ORIGIN, cleanupAuthTestData, signIn } from './auth-app';
import { prisma } from './db';

/** Storage double whose data-plane calls fail like an outage (05 §30: 503, item unchanged). */
const unavailable: ObjectStorage = {
  createSignedUploadUrl: async () => 'http://storage.invalid/signed',
  createSignedDownloadUrl: async () => {
    throw new StorageUnavailableError();
  },
  headObject: async () => {
    throw new StorageUnavailableError();
  },
  getObjectStream: async () => {
    throw new StorageUnavailableError();
  },
  putObject: async () => {
    throw new StorageUnavailableError();
  },
  deleteObject: async () => {
    throw new StorageUnavailableError();
  },
};

describe('evidence with object storage unavailable', () => {
  let app: INestApplication;
  let cookie: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(new CapturingEmailTransport())
      .overrideProvider(OBJECT_STORAGE)
      .useValue(unavailable)
      .compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
    configureApp(nest);
    await nest.listen(0, '127.0.0.1');
    app = nest;
    cookie = (await signIn({ app, mail: moduleRef.get(EMAIL_TRANSPORT), http } as never)).cookie;
  });

  afterAll(async () => {
    await app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  const post = (path: string, body: unknown = {}) =>
    http()
      .post(path)
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send(body as object);

  it('answers 503 on completion, keeps the item UPLOADING and audits the failure', async () => {
    const caseId = (await post('/api/cases').expect(201)).body.id;
    const registered = await post(`/api/cases/${caseId}/evidence`, {
      source: 'FILE',
      filename: 'a.png',
      declaredContentType: 'image/png',
      byteSize: 100,
    }).expect(201);
    const id = registered.body.evidence.id;
    const res = await post(`/api/evidence/${id}/complete`).expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect((await prisma.evidenceItem.findUniqueOrThrow({ where: { id } })).processingStatus).toBe(
      'UPLOADING',
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: id, action: 'EVIDENCE_UPLOADED' },
    });
    expect(audit).toMatchObject({
      outcome: 'FAILED',
      metadata: { evidenceRef: 'E01', code: 'STORAGE_UNAVAILABLE' },
    });
  });

  it('answers 503 for a paste and stores nothing', async () => {
    const caseId = (await post('/api/cases').expect(201)).body.id;
    const res = await post(`/api/cases/${caseId}/evidence`, {
      source: 'PASTE',
      pasteKind: 'MESSAGE',
      content: 'hello',
    }).expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(await prisma.evidenceItem.count({ where: { caseId } })).toBe(0);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('NEW');
  });
});

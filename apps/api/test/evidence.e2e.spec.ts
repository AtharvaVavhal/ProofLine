import { randomUUID } from 'node:crypto';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ObjectNotFoundError } from '../src/storage/object-storage';
import { ORIGIN, TestApp, cleanupAuthTestData, createTestApp, signIn } from './auth-app';
import { prisma } from './db';
import { adminStorage, api, putToStorage, registerFile, sha256, uploadFile } from './evidence-app';
import { encryptedPdf, eml, jpeg, msg, pdf, png, txt } from './fixtures';

const EVIDENCE_KEYS = [
  'byteSize',
  'contentType',
  'createdAt',
  'email',
  'evidenceRef',
  'evidenceType',
  'failure',
  'id',
  'imageHeight',
  'imageWidth',
  'integrity',
  'label',
  'originalFilename',
  'pageCount',
  'pasteKind',
  'processingStatus',
  'sha256',
  'textCharCount',
  'uploadedAt',
].sort();

describe('evidence registration and upload (05 #3, #18, #19, #21, #22)', () => {
  let t: TestApp;
  let alice: { cookie: string; userId: string };
  let bob: { cookie: string; userId: string };

  beforeAll(async () => {
    t = await createTestApp();
    bob = await signIn(t);
  });

  // A fresh owner per test keeps each test inside the real 120/hour upload budget (09 §18).
  beforeEach(async () => {
    alice = await signIn(t);
  });

  afterAll(async () => {
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  async function newCase(cookie = alice.cookie): Promise<string> {
    return (await api(t, cookie).post('/api/cases', {}).expect(201)).body.id;
  }

  const objectExists = async (key: string) => {
    try {
      await adminStorage.headObject(key);
      return true;
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return false;
      throw error;
    }
  };

  const errorCode = (res: { body: { error?: { code: string } } }) => res.body.error?.code;

  describe('authentication and ownership', () => {
    it.each([
      ['post', `/api/cases/${randomUUID()}/evidence`],
      ['get', `/api/cases/${randomUUID()}/evidence`],
      ['post', `/api/evidence/${randomUUID()}/complete`],
      ['get', `/api/evidence/${randomUUID()}/download`],
      ['delete', `/api/evidence/${randomUUID()}?confirm=true`],
    ] as const)('%s %s → 401 without a session', async (method, path) => {
      const res = await t.http()[method](path).set('Origin', ORIGIN).send({});
      expect(res.status).toBe(401);
    });

    it('answers another user’s case and evidence exactly like missing ones', async () => {
      const caseId = await newCase();
      const done = await uploadFile(t, alice.cookie, caseId, 'png', png(10, 10));
      const evidenceId = done.body.id;
      const asBob = api(t, bob.cookie);

      const caseOther = await asBob
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'x',
        })
        .expect(404);
      const caseMissing = await asBob
        .post(`/api/cases/${randomUUID()}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'x',
        })
        .expect(404);
      expect(caseOther.body.error.message).toBe(caseMissing.body.error.message);
      await asBob.get(`/api/cases/${caseId}/evidence`).expect(404);

      for (const [method, path] of [
        ['post', `/api/evidence/${evidenceId}/complete`],
        ['get', `/api/evidence/${evidenceId}/download`],
        ['del', `/api/evidence/${evidenceId}?confirm=true`],
      ] as const) {
        const other = await asBob[method](path).expect(404);
        const missing = await asBob[method](path.replace(evidenceId, randomUUID())).expect(404);
        const malformed = await asBob[method](path.replace(evidenceId, 'not-a-uuid')).expect(404);
        expect(other.body.error).toMatchObject({
          code: 'NOT_FOUND',
          message: "This evidence isn't available.",
        });
        expect(missing.body.error.message).toBe(other.body.error.message);
        expect(malformed.body.error.message).toBe(other.body.error.message);
        expect(other.text).not.toContain(caseId);
      }
      expect(await prisma.evidenceItem.count({ where: { id: evidenceId } })).toBe(1);
    });

    it('ignores ownership claims in the body', async () => {
      const caseId = await newCase();
      const res = await api(t, alice.cookie)
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'x',
          userId: bob.userId,
        })
        .expect(400);
      expect(res.body.error.fieldErrors).toContainEqual({ field: 'userId', code: 'UNKNOWN_FIELD' });
    });
  });

  describe('file upload: register → signed PUT → complete', () => {
    it.each([
      [
        'png',
        () => png(1200, 800),
        { imageWidth: 1200, imageHeight: 800, contentType: 'image/png', evidenceType: 'PNG' },
      ],
      [
        'jpeg',
        () => jpeg(640, 480),
        { imageWidth: 640, imageHeight: 480, contentType: 'image/jpeg', evidenceType: 'JPEG' },
      ],
      ['pdf', () => pdf(2), { pageCount: 2, contentType: 'application/pdf', evidenceType: 'PDF' }],
      ['txt', () => Promise.resolve(txt()), { contentType: 'text/plain', evidenceType: 'TXT' }],
      ['eml', () => Promise.resolve(eml()), { contentType: 'message/rfc822', evidenceType: 'EML' }],
    ] as const)('accepts %s and fingerprints the stored bytes', async (type, make, expected) => {
      const bytes = await make();
      const caseId = await newCase();
      const { evidence, upload } = await registerFile(t, alice.cookie, caseId, type, bytes.length, {
        label: 'my label',
      });

      expect(Object.keys(evidence).sort()).toEqual(EVIDENCE_KEYS);
      expect(evidence).toMatchObject({
        evidenceRef: 'E01',
        processingStatus: 'UPLOADING',
        sha256: null,
        uploadedAt: null,
      });
      expect(upload.method).toBe('PUT');
      expect(upload.headers).toEqual({ 'Content-Type': expected.contentType });
      const ttl = Date.parse(upload.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
      expect(upload.url).not.toContain('chat');
      expect(upload.url).not.toContain(alice.userId);

      expect((await putToStorage(upload, bytes)).status).toBe(200);
      const done = await api(t, alice.cookie)
        .post(`/api/evidence/${evidence.id}/complete`)
        .expect(200);
      expect(done.body).toMatchObject({
        id: evidence.id,
        processingStatus: 'UPLOADED',
        sha256: sha256(bytes),
        byteSize: bytes.length,
        label: 'my label',
        failure: null,
        integrity: { latestResult: 'NOT_YET_VERIFIED', verifiedAt: null },
        ...expected,
      });
      expect(done.body.uploadedAt).toEqual(expect.any(String));

      const stored = await prisma.evidenceItem.findUniqueOrThrow({ where: { id: evidence.id } });
      expect(stored.storageKey).toBe(`cases/${caseId}/evidence/${evidence.id}`);
      expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).status).toBe(
        'INGESTING',
      );

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: evidence.id, action: 'EVIDENCE_UPLOADED' },
      });
      expect(audit).toMatchObject({
        outcome: 'SUCCEEDED',
        metadata: { evidenceRef: 'E01', sha256: sha256(bytes) },
      });
      expect(JSON.stringify(audit)).not.toMatch(
        /my label|chat\.png|sms\.jpg|receipt\.pdf|note\.txt|mail\.eml/,
      );
    });

    it('records the UTF-8 BOM flag for text files', async () => {
      const caseId = await newCase();
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), txt()]);
      await uploadFile(t, alice.cookie, caseId, 'txt', bytes).then((r) =>
        expect(r.status).toBe(200),
      );
      const stored = await prisma.evidenceItem.findFirstOrThrow({ where: { caseId } });
      expect(stored.sourceMetadata).toEqual({ encoding: 'utf-8', had_bom: true });
    });

    it('accepts exactly 10,485,760 bytes', async () => {
      const caseId = await newCase();
      const res = await uploadFile(t, alice.cookie, caseId, 'png', png(10, 10, 10_485_760));
      expect(res.status).toBe(200);
      expect(res.body.byteSize).toBe(10_485_760);
    });

    it('is idempotent and serialises concurrent completions', async () => {
      const caseId = await newCase();
      const bytes = png(20, 20);
      const { evidence, upload } = await registerFile(t, alice.cookie, caseId, 'png', bytes.length);
      await putToStorage(upload, bytes);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          api(t, alice.cookie).post(`/api/evidence/${evidence.id}/complete`),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(new Set(results.map((r) => r.body.uploadedAt)).size).toBe(1);
      const again = await api(t, alice.cookie)
        .post(`/api/evidence/${evidence.id}/complete`)
        .expect(200);
      expect(again.body.sha256).toBe(sha256(bytes));
      expect(
        await prisma.auditLog.count({
          where: { targetId: evidence.id, action: 'EVIDENCE_UPLOADED' },
        }),
      ).toBe(1);
    });

    it('returns 409 EVIDENCE_NOT_UPLOADED before the PUT and keeps the item', async () => {
      const caseId = await newCase();
      const { evidence } = await registerFile(t, alice.cookie, caseId, 'png', 100);
      const res = await api(t, alice.cookie)
        .post(`/api/evidence/${evidence.id}/complete`)
        .expect(409);
      expect(errorCode(res)).toBe('EVIDENCE_NOT_UPLOADED');
      expect(
        (await prisma.evidenceItem.findUniqueOrThrow({ where: { id: evidence.id } }))
          .processingStatus,
      ).toBe('UPLOADING');
    });

    it('scopes the signed URL to one key, the declared type and the declared size', async () => {
      const caseId = await newCase();
      const bytes = png(10, 10);
      const { evidence, upload } = await registerFile(t, alice.cookie, caseId, 'png', bytes.length);
      const key = `cases/${caseId}/evidence/${evidence.id}`;

      expect(
        (
          await fetch(upload.url, {
            method: 'PUT',
            body: bytes,
            headers: { 'Content-Type': 'application/pdf' },
          })
        ).status,
      ).toBe(403);
      expect(
        (await putToStorage(upload, Buffer.concat([bytes, Buffer.from('extra')]))).status,
      ).toBe(403);
      const otherKey = upload.url.replace(evidence.id, randomUUID());
      expect(
        (await fetch(otherKey, { method: 'PUT', body: bytes, headers: upload.headers })).status,
      ).toBe(403);
      expect((await fetch(upload.url, { method: 'GET' })).status).toBe(403);
      expect(await objectExists(key)).toBe(false);

      expect((await putToStorage(upload, bytes)).status).toBe(200);
      const anonymous = new URL(upload.url);
      anonymous.search = '';
      expect((await fetch(anonymous)).status).toBe(403);
    });
  });

  describe('rejections at completion leave no evidence row (G-4)', () => {
    async function expectRejected(
      type: 'png' | 'jpeg' | 'pdf' | 'txt' | 'eml',
      bytes: Buffer,
      status: number,
      code: string,
    ) {
      const caseId = await newCase();
      const { evidence, upload } = await registerFile(t, alice.cookie, caseId, type, bytes.length);
      expect((await putToStorage(upload, bytes)).status).toBe(200);
      const res = await api(t, alice.cookie).post(`/api/evidence/${evidence.id}/complete`);
      expect(res.status).toBe(status);
      expect(errorCode(res)).toBe(code);
      expect(await prisma.evidenceItem.count({ where: { id: evidence.id } })).toBe(0);
      expect(await objectExists(`cases/${caseId}/evidence/${evidence.id}`)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: evidence.id, action: 'EVIDENCE_REJECTED' },
      });
      expect(audit.metadata).toEqual({ evidenceRef: 'E01', code });
      expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('NEW');
      return evidence.id;
    }

    it('rejects a PDF uploaded as PNG (spoofed type)', async () => {
      await expectRejected('png', await pdf(1), 415, 'CONTENT_TYPE_MISMATCH');
    });
    it('rejects a PNG uploaded as PDF', async () => {
      await expectRejected('pdf', png(10, 10), 415, 'CONTENT_TYPE_MISMATCH');
    });
    it('rejects 21 PDF pages and accepts 20', async () => {
      await expectRejected('pdf', await pdf(21), 422, 'PDF_TOO_MANY_PAGES');
      const caseId = await newCase();
      expect((await uploadFile(t, alice.cookie, caseId, 'pdf', await pdf(20))).body.pageCount).toBe(
        20,
      );
    });
    it('rejects password-protected PDFs', async () => {
      await expectRejected('pdf', encryptedPdf(), 422, 'PDF_ENCRYPTED');
    });
    it('rejects 40,000,001 px and accepts 40,000,000 px', async () => {
      await expectRejected('png', png(40_000_001, 1), 422, 'IMAGE_TOO_LARGE');
      const caseId = await newCase();
      expect((await uploadFile(t, alice.cookie, caseId, 'png', png(8000, 5000))).status).toBe(200);
    });
    it('rejects non-UTF-8 text', async () => {
      await expectRejected('txt', Buffer.from([0x50, 0xe9, 0x6e]), 422, 'TEXT_NOT_UTF8');
    });
    it('rejects an Outlook .msg uploaded as .eml', async () => {
      await expectRejected('eml', msg(), 415, 'EMAIL_FORMAT_NOT_SUPPORTED');
    });

    it('rejects oversized and empty objects written around the signed URL', async () => {
      for (const [bytes, status, code] of [
        [png(10, 10, 10_485_761), 413, 'FILE_TOO_LARGE'],
        [Buffer.alloc(0), 422, 'EMPTY_FILE'],
      ] as const) {
        const caseId = await newCase();
        const { evidence } = await registerFile(t, alice.cookie, caseId, 'png', 100);
        await adminStorage.putObject(`cases/${caseId}/evidence/${evidence.id}`, bytes, 'image/png');
        const res = await api(t, alice.cookie).post(`/api/evidence/${evidence.id}/complete`);
        expect([res.status, errorCode(res)]).toEqual([status, code]);
        expect(await prisma.evidenceItem.count({ where: { id: evidence.id } })).toBe(0);
        expect(await objectExists(`cases/${caseId}/evidence/${evidence.id}`)).toBe(false);
      }
    });
  });

  describe('registration validation', () => {
    it.each([
      [
        { filename: 'mail.msg', declaredContentType: 'application/vnd.ms-outlook', byteSize: 10 },
        415,
        'EMAIL_FORMAT_NOT_SUPPORTED',
      ],
      [
        { filename: 'export.mbox', declaredContentType: 'application/mbox', byteSize: 10 },
        415,
        'EMAIL_FORMAT_NOT_SUPPORTED',
      ],
      [
        { filename: 'report.docx', declaredContentType: 'application/msword', byteSize: 10 },
        415,
        'TYPE_NOT_SUPPORTED',
      ],
      [
        { filename: 'page.html', declaredContentType: 'text/html', byteSize: 10 },
        415,
        'TYPE_NOT_SUPPORTED',
      ],
      [
        { filename: 'bundle.zip', declaredContentType: 'application/zip', byteSize: 10 },
        415,
        'TYPE_NOT_SUPPORTED',
      ],
      [
        { filename: 'photo.png', declaredContentType: 'application/pdf', byteSize: 10 },
        415,
        'TYPE_NOT_SUPPORTED',
      ],
      [{ filename: 'photo.png', declaredContentType: 'image/png', byteSize: 0 }, 422, 'EMPTY_FILE'],
      [
        { filename: 'photo.png', declaredContentType: 'image/png', byteSize: 10_485_761 },
        413,
        'FILE_TOO_LARGE',
      ],
      [
        { filename: 'photo.png', declaredContentType: 'image/png', byteSize: 1.5 },
        400,
        'VALIDATION_FAILED',
      ],
      [{ filename: '', declaredContentType: 'image/png', byteSize: 10 }, 400, 'VALIDATION_FAILED'],
      [
        { filename: `${'a'.repeat(252)}.png`, declaredContentType: 'image/png', byteSize: 10 },
        400,
        'VALIDATION_FAILED',
      ],
      [
        {
          filename: 'photo.png',
          declaredContentType: 'image/png',
          byteSize: 10,
          label: 'l'.repeat(101),
        },
        400,
        'VALIDATION_FAILED',
      ],
    ])('rejects %j with %i %s and creates nothing', async (body, status, code) => {
      const caseId = await newCase();
      const res = await api(t, alice.cookie).post(`/api/cases/${caseId}/evidence`, {
        source: 'FILE',
        ...body,
      });
      expect([res.status, errorCode(res)]).toEqual([status, code]);
      expect(await prisma.evidenceItem.count({ where: { caseId } })).toBe(0);
      expect((await prisma.case.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('NEW');
    });

    it('accepts the declared 10,485,760-byte boundary', async () => {
      const caseId = await newCase();
      await registerFile(t, alice.cookie, caseId, 'png', 10_485_760);
    });

    it('refuses registration while an analysis run is active', async () => {
      const caseId = await newCase();
      await prisma.analysisRun.create({
        data: { caseId, kind: 'ANALYSIS', trigger: 'USER_START', status: 'RUNNING' },
      });
      for (const body of [
        { source: 'FILE', filename: 'a.png', declaredContentType: 'image/png', byteSize: 10 },
        { source: 'PASTE', pasteKind: 'MESSAGE', content: 'hello' },
      ]) {
        const res = await api(t, alice.cookie)
          .post(`/api/cases/${caseId}/evidence`, body)
          .expect(409);
        expect(errorCode(res)).toBe('ANALYSIS_IN_PROGRESS');
      }
    });
  });

  describe('pasted evidence (G-3 canonical bytes)', () => {
    const paste = (caseId: string, body: Record<string, unknown>) =>
      api(t, alice.cookie).post(`/api/cases/${caseId}/evidence`, { source: 'PASTE', ...body });

    it('stores, hashes and audits the canonical bytes; never fetches links', async () => {
      const caseId = await newCase();
      const raw = 'Around 12:05 PM a call from 9000000001.\r\nCafé ₹8,500 \r\n';
      const canonical = 'Around 12:05 PM a call from 9000000001.\nCafé ₹8,500 \n';
      const res = await paste(caseId, {
        pasteKind: 'MESSAGE',
        content: raw,
        label: 'My note about the call',
      }).expect(201);
      expect(res.body.upload).toBeUndefined();
      expect(res.body.evidence).toMatchObject({
        evidenceRef: 'E01',
        evidenceType: 'TEXT',
        pasteKind: 'MESSAGE',
        processingStatus: 'UPLOADED',
        sha256: sha256(Buffer.from(canonical, 'utf8')),
        textCharCount: [...canonical].length,
        originalFilename: null,
        contentType: 'text/plain',
      });
      const stored = await prisma.evidenceItem.findUniqueOrThrow({
        where: { id: res.body.evidence.id },
      });
      const object = Buffer.concat(
        await (await adminStorage.getObjectStream(stored.storageKey)).toArray(),
      );
      expect(object.toString('utf8')).toBe(canonical);
      expect(stored.sourceMetadata).toEqual({ canonicalization: 'G3-UTF8-NFC-LF-v1' });

      // Identical text in another line-ending form gives the identical fingerprint.
      const lf = await paste(caseId, { pasteKind: 'MESSAGE', content: canonical }).expect(201);
      expect(lf.body.evidence.sha256).toBe(res.body.evidence.sha256);
      expect(lf.body.evidence.evidenceRef).toBe('E02');
    });

    it('accepts URLs (stored as URL evidence, never opened) and rejects non-URLs', async () => {
      const caseId = await newCase();
      const url = await paste(caseId, {
        pasteKind: 'URL',
        content: 'https://kyc-update-verify.example/kyc?utm_source=sms',
      }).expect(201);
      expect(url.body.evidence).toMatchObject({ evidenceType: 'URL', pasteKind: 'URL' });
      for (const content of ['not a link', ' https://example.test', 'files.unknowntld']) {
        const res = await paste(caseId, { pasteKind: 'URL', content }).expect(422);
        expect(errorCode(res)).toBe('NOT_A_URL');
      }
    });

    it('accepts 20,000 characters (code points, over 64 KB of JSON) and rejects 20,001', async () => {
      const caseId = await newCase();
      await paste(caseId, { pasteKind: 'CHAT_TRANSCRIPT', content: '😀'.repeat(20_000) }).expect(
        201,
      );
      // CRLF counts as one character after canonicalisation.
      await paste(caseId, { pasteKind: 'MESSAGE', content: 'a\r\n'.repeat(10_000) }).expect(201);
      const tooLong = await paste(caseId, {
        pasteKind: 'MESSAGE',
        content: 'a'.repeat(20_001),
      }).expect(413);
      expect(errorCode(tooLong)).toBe('TEXT_TOO_LONG');
      expect(
        errorCode(await paste(caseId, { pasteKind: 'MESSAGE', content: '' }).expect(400)),
      ).toBe('VALIDATION_FAILED');
      expect(errorCode(await paste(caseId, { pasteKind: 'EMAIL', content: 'x' }).expect(400))).toBe(
        'VALIDATION_FAILED',
      );
    });
  });

  describe('20-item limit and references', () => {
    it('never exceeds 20 items under concurrent registration, with unique refs E01–E20', async () => {
      const caseId = await newCase();
      const results = await Promise.all(
        Array.from({ length: 26 }, (_, i) =>
          i % 2 === 0
            ? api(t, alice.cookie).post(`/api/cases/${caseId}/evidence`, {
                source: 'FILE',
                filename: `f${i}.png`,
                declaredContentType: 'image/png',
                byteSize: 10,
              })
            : api(t, alice.cookie).post(`/api/cases/${caseId}/evidence`, {
                source: 'PASTE',
                pasteKind: 'MESSAGE',
                content: `note ${i}`,
              }),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      const full = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(20);
      expect(full).toHaveLength(6);
      expect(full.every((r) => errorCode(r) === 'TOO_MANY_ITEMS')).toBe(true);
      const refs = ok.map((r) => r.body.evidence.evidenceRef as string).sort();
      expect(refs).toEqual(
        Array.from({ length: 20 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`),
      );
      expect(await prisma.evidenceItem.count({ where: { caseId } })).toBe(20);
    });

    it('reuses the lowest freed slot after a removal', async () => {
      const caseId = await newCase();
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(
          (
            await api(t, alice.cookie)
              .post(`/api/cases/${caseId}/evidence`, {
                source: 'PASTE',
                pasteKind: 'MESSAGE',
                content: `n${i}`,
              })
              .expect(201)
          ).body.evidence.id,
        );
      }
      await api(t, alice.cookie).del(`/api/evidence/${ids[1]}?confirm=true`).expect(200);
      const next = await api(t, alice.cookie)
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'n3',
        })
        .expect(201);
      expect(next.body.evidence.evidenceRef).toBe('E02');
    });
  });

  describe('GET /api/cases/:id/evidence', () => {
    it('lists the case’s items in reference order without storage details', async () => {
      const caseId = await newCase();
      await api(t, alice.cookie)
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'first',
        })
        .expect(201);
      await registerFile(t, alice.cookie, caseId, 'png', 100);
      const res = await api(t, alice.cookie).get(`/api/cases/${caseId}/evidence`).expect(200);
      expect(Object.keys(res.body)).toEqual(['items']);
      expect(res.body.items.map((e: { evidenceRef: string }) => e.evidenceRef)).toEqual([
        'E01',
        'E02',
      ]);
      expect(res.body.items.map((e: { processingStatus: string }) => e.processingStatus)).toEqual([
        'UPLOADED',
        'UPLOADING',
      ]);
      expect(res.text).not.toMatch(/storageKey|cases\//);
    });
  });

  describe('GET /api/evidence/:id/download', () => {
    it('issues a 5-minute forced-download URL named by reference, and audits it', async () => {
      const caseId = await newCase();
      const bytes = png(30, 30);
      const done = await uploadFile(t, alice.cookie, caseId, 'png', bytes);
      const res = await api(t, alice.cookie)
        .get(`/api/evidence/${done.body.id}/download`)
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'url']);
      const ttl = Date.parse(res.body.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(4 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);
      expect(res.body.url).not.toContain('chat.png');

      const file = await fetch(res.body.url);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toBe('attachment; filename="E01.png"');
      expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: { targetId: done.body.id, action: 'EVIDENCE_VIEWED' },
        }),
      ).toBe(1);
    });

    it('returns 409 before the upload is complete', async () => {
      const caseId = await newCase();
      const { evidence } = await registerFile(t, alice.cookie, caseId, 'png', 100);
      expect(
        errorCode(
          await api(t, alice.cookie).get(`/api/evidence/${evidence.id}/download`).expect(409),
        ),
      ).toBe('EVIDENCE_NOT_UPLOADED');
    });
  });

  describe('DELETE /api/evidence/:id', () => {
    it.each(['', '?confirm=false', '?confirm=1'])('requires confirm=true (%s)', async (query) => {
      const caseId = await newCase();
      const id = (
        await api(t, alice.cookie)
          .post(`/api/cases/${caseId}/evidence`, {
            source: 'PASTE',
            pasteKind: 'MESSAGE',
            content: 'x',
          })
          .expect(201)
      ).body.evidence.id;
      const res = await api(t, alice.cookie).del(`/api/evidence/${id}${query}`).expect(400);
      expect(errorCode(res)).toBe('CONFIRMATION_REQUIRED');
      expect(await prisma.evidenceItem.count({ where: { id } })).toBe(1);
    });

    it('removes the row and object, audits a tombstone and settles the case state', async () => {
      const caseId = await newCase();
      const first = await uploadFile(t, alice.cookie, caseId, 'png', png(10, 10));
      const second = await api(t, alice.cookie)
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: 'y',
        })
        .expect(201);
      const key = `cases/${caseId}/evidence/${first.body.id}`;
      expect(await objectExists(key)).toBe(true);

      const res = await api(t, alice.cookie)
        .del(`/api/evidence/${first.body.id}?confirm=true`)
        .expect(200);
      expect(res.body).toEqual({
        caseStatus: 'INGESTING',
        reportsInvalidated: 0,
        exportsDeleted: 0,
      });
      expect(await objectExists(key)).toBe(false);
      await api(t, alice.cookie).get(`/api/evidence/${first.body.id}/download`).expect(404);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: first.body.id, action: 'EVIDENCE_DELETED' },
      });
      expect(audit.metadata).toEqual({ evidenceRef: 'E01', sha256: first.body.sha256 });

      const last = await api(t, alice.cookie)
        .del(`/api/evidence/${second.body.evidence.id}?confirm=true`)
        .expect(200);
      expect(last.body.caseStatus).toBe('NEW');
    });

    it('removes stored objects when the whole case is deleted', async () => {
      const caseId = await newCase();
      const done = await uploadFile(t, alice.cookie, caseId, 'png', png(10, 10));
      const key = `cases/${caseId}/evidence/${done.body.id}`;
      await api(t, alice.cookie).del(`/api/cases/${caseId}?confirm=true`).expect(204);
      expect(await objectExists(key)).toBe(false);
    });
  });

  describe('abandoned uploads', () => {
    it('removes UPLOADING rows older than the URL lifetime plus grace, with their objects', async () => {
      const caseId = await newCase();
      const bytes = png(10, 10);
      const { evidence, upload } = await registerFile(t, alice.cookie, caseId, 'png', bytes.length);
      await putToStorage(upload, bytes);
      const fresh = await registerFile(t, alice.cookie, caseId, 'png', 50);
      await prisma.evidenceItem.update({
        where: { id: evidence.id },
        data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      });

      const removed = await t.app.get(EvidenceService).cleanupAbandonedUploads();
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(await prisma.evidenceItem.count({ where: { id: evidence.id } })).toBe(0);
      expect(await prisma.evidenceItem.count({ where: { id: fresh.evidence.id } })).toBe(1);
      expect(await objectExists(`cases/${caseId}/evidence/${evidence.id}`)).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: evidence.id, action: 'EVIDENCE_REJECTED' },
      });
      expect(audit).toMatchObject({
        actorKind: 'SYSTEM',
        metadata: { evidenceRef: 'E01', code: 'TRANSFER_FAILED' },
      });
    });
  });

  describe('rate limiting (09 §18: register/complete 120/hour per user)', () => {
    it('returns 429 after 120 register/complete requests', async () => {
      const carol = await signIn(t);
      for (let batch = 0; batch < 12; batch += 1) {
        const statuses = await Promise.all(
          Array.from({ length: 10 }, () =>
            api(t, carol.cookie)
              .post(`/api/evidence/${randomUUID()}/complete`)
              .then((r) => r.status),
          ),
        );
        expect(statuses.every((s) => s === 404)).toBe(true);
      }
      const res = await api(t, carol.cookie)
        .post(`/api/evidence/${randomUUID()}/complete`)
        .expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // Other routes use the separate default bucket.
      await api(t, carol.cookie).get('/api/cases').expect(200);
    });
  });

  describe('Gate D: one case with every evidence path (Doc 14 Phase 4)', () => {
    it('produces six UPLOADED items whose sha256 matches an independent computation', async () => {
      const caseId = await newCase();
      const files: [Parameters<typeof uploadFile>[3], Buffer][] = [
        ['png', png(1080, 1920)],
        ['png', png(1080, 2340)],
        ['png', png(1440, 900)],
        ['pdf', await pdf(1)],
        ['png', png(1080, 1920)],
      ];
      const expected: string[] = [];
      for (const [type, bytes] of files) {
        const res = await uploadFile(t, alice.cookie, caseId, type, bytes);
        expect(res.status).toBe(200);
        expected.push(sha256(bytes));
      }
      const note = 'Around 12:05 PM I got a call from 9000000001.\n';
      await api(t, alice.cookie)
        .post(`/api/cases/${caseId}/evidence`, {
          source: 'PASTE',
          pasteKind: 'MESSAGE',
          content: note,
          label: 'My note about the call',
        })
        .expect(201);
      expected.push(sha256(Buffer.from(note, 'utf8')));

      const list = await api(t, alice.cookie).get(`/api/cases/${caseId}/evidence`).expect(200);
      expect(list.body.items.map((e: { evidenceRef: string }) => e.evidenceRef)).toEqual([
        'E01',
        'E02',
        'E03',
        'E04',
        'E05',
        'E06',
      ]);
      expect(
        list.body.items.every(
          (e: { processingStatus: string }) => e.processingStatus === 'UPLOADED',
        ),
      ).toBe(true);
      expect(list.body.items.map((e: { sha256: string }) => e.sha256)).toEqual(expected);
      // Each stored object hashes to the recorded fingerprint.
      for (const item of await prisma.evidenceItem.findMany({ where: { caseId } })) {
        const stored = Buffer.concat(
          await (await adminStorage.getObjectStream(item.storageKey)).toArray(),
        );
        expect(sha256(stored)).toBe(item.sha256);
      }
      // Upload never starts analysis (07 N-1).
      expect(await prisma.analysisRun.count({ where: { caseId } })).toBe(0);
    });
  });
});

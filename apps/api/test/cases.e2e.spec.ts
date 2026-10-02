import { randomUUID } from 'node:crypto';
import { ORIGIN, TestApp, cleanupAuthTestData, createTestApp, signIn } from './auth-app';
import { prisma } from './db';

const CASE_KEYS = [
  'caseReference',
  'contact',
  'createdAt',
  'entityCounts',
  'evidence',
  'financialLossReported',
  'id',
  'incidentTime',
  'incidentTimePrecision',
  'incidentType',
  'latestRun',
  'location',
  'report',
  'scamSignals',
  'status',
  'statusChangedAt',
  'summary',
  'updatedAt',
  'urgency',
].sort();
const LIST_ITEM_KEYS = [
  'caseReference',
  'createdAt',
  'evidence',
  'id',
  'incidentType',
  'status',
  'updatedAt',
  'urgency',
];

describe('case management API', () => {
  let t: TestApp;
  let alice: { cookie: string; userId: string };
  let bob: { cookie: string; userId: string };

  beforeAll(async () => {
    t = await createTestApp();
    alice = await signIn(t);
    bob = await signIn(t);
  });

  afterAll(async () => {
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  const as = (cookie: string) => ({
    post: (path: string, body: unknown = {}) =>
      t
        .http()
        .post(path)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send(body as object),
    get: (path: string) => t.http().get(path).set('Cookie', cookie),
    patch: (path: string, body: unknown) =>
      t
        .http()
        .patch(path)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send(body as object),
    del: (path: string) => t.http().delete(path).set('Origin', ORIGIN).set('Cookie', cookie),
  });

  async function createCase(cookie: string, body: unknown = {}) {
    const res = await as(cookie).post('/api/cases', body).expect(201);
    return res.body as { id: string; caseReference: string; [k: string]: unknown };
  }

  /** The 404 body without its request ID, for indistinguishability checks. */
  const notFoundBody = (res: { body: { error: Record<string, unknown> } }) => {
    const { requestId, ...rest } = res.body.error;
    expect(typeof requestId).toBe('string');
    return rest;
  };

  describe('authentication', () => {
    it.each([
      ['post', '/api/cases'],
      ['get', '/api/cases'],
      ['get', `/api/cases/${randomUUID()}`],
      ['patch', `/api/cases/${randomUUID()}`],
      ['delete', `/api/cases/${randomUUID()}?confirm=true`],
      ['get', `/api/cases/${randomUUID()}/audit-log`],
    ] as const)('%s %s → 401 without a session', async (method, path) => {
      const res = await t.http()[method](path).set('Origin', ORIGIN).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('POST /api/cases', () => {
    it('creates an empty case: NEW, server reference, unassessed, owned by the caller', async () => {
      const res = await as(alice.cookie).post('/api/cases', {}).expect(201);
      const body = res.body;
      expect(Object.keys(body).sort()).toEqual(CASE_KEYS);
      expect(body).toMatchObject({
        caseReference: expect.stringMatching(/^CF-\d{5,}$/),
        status: 'NEW',
        incidentTime: null,
        incidentTimePrecision: null,
        contact: null,
        location: null,
        summary: null,
        incidentType: null,
        financialLossReported: null,
        evidence: {
          total: 0,
          byStatus: { UPLOADING: 0, UPLOADED: 0, PROCESSING: 0, PROCESSED: 0, FAILED: 0 },
        },
        latestRun: null,
        scamSignals: [],
        urgency: {
          assessed: false,
          level: null,
          outOfDate: false,
          ruleVersion: null,
          explanation: null,
          disclaimer: null,
          reasons: [],
          computedAt: null,
        },
        entityCounts: {},
        report: null,
      });
      const stored = await prisma.case.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.userId).toBe(alice.userId);
      expect(await prisma.userStatement.count({ where: { caseId: body.id } })).toBe(0);
    });

    it('increments the reference for the next case', async () => {
      const a = await createCase(alice.cookie);
      const b = await createCase(alice.cookie);
      expect(Number(b.caseReference.slice(3))).toBeGreaterThan(Number(a.caseReference.slice(3)));
    });

    it('stores a populated case and records CASE_METADATA statements', async () => {
      const body = {
        incidentTime: '2026-09-24T06:35:00Z',
        incidentTimePrecision: 'APPROXIMATE',
        summary: '  Got a KYC SMS, called the number and paid.  ',
        contact: 'call me after 6',
        location: 'Pune',
      };
      const created = await createCase(alice.cookie, body);
      expect(created).toMatchObject({
        incidentTime: '2026-09-24T06:35:00.000Z',
        incidentTimePrecision: 'APPROXIMATE',
        summary: body.summary, // stored exactly, not trimmed
        contact: body.contact,
        location: body.location,
      });
      const statements = await prisma.userStatement.findMany({ where: { caseId: created.id } });
      expect(statements.map((s) => s.subject).sort()).toEqual([
        'case.contact',
        'case.incident_time',
        'case.location',
        'case.summary',
      ]);
      expect(
        statements.every(
          (s) => s.statementKind === 'CASE_METADATA' && s.authorUserId === alice.userId,
        ),
      ).toBe(true);
      const time = statements.find((s) => s.subject === 'case.incident_time')!;
      expect(time.valueDatetime?.toISOString()).toBe('2026-09-24T06:35:00.000Z');
      expect(time.normalizedValue).toBe('APPROXIMATE');
    });

    it('accepts UNKNOWN with no time', async () => {
      const created = await createCase(alice.cookie, {
        incidentTime: null,
        incidentTimePrecision: 'UNKNOWN',
      });
      expect(created).toMatchObject({ incidentTime: null, incidentTimePrecision: 'UNKNOWN' });
    });

    it.each([
      [{ userId: randomUUID() }, 'userId'],
      [{ caseReference: 'CF-99999' }, 'caseReference'],
      [{ status: 'EXPORTED' }, 'status'],
      [{ incidentType: 'PHISHING' }, 'incidentType'],
      [{ urgency: { level: 'HIGH' } }, 'urgency'],
      [{ financialLossReported: true }, 'financialLossReported'],
    ])('rejects the server-controlled field in %j', async (body, field) => {
      const res = await as(alice.cookie).post('/api/cases', body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.fieldErrors).toContainEqual({ field, code: 'UNKNOWN_FIELD' });
    });

    it.each([
      [{ summary: 'x'.repeat(2001) }, 'summary'],
      [{ contact: 'x'.repeat(201) }, 'contact'],
      [{ location: 'x'.repeat(201) }, 'location'],
      [{ incidentTime: '2026-09-24T06:35:00Z' }, 'incidentTimePrecision'],
      [{ incidentTime: '2026-09-24T06:35:00Z', incidentTimePrecision: 'UNKNOWN' }, 'incidentTime'],
      [{ incidentTimePrecision: 'EXACT' }, 'incidentTime'],
      [{ incidentTime: null, incidentTimePrecision: 'APPROXIMATE' }, 'incidentTime'],
      [{ incidentTime: '24/09/2026 12:05', incidentTimePrecision: 'EXACT' }, 'incidentTime'],
      [
        { incidentTime: '2026-09-24T12:05:00+05:30', incidentTimePrecision: 'EXACT' },
        'incidentTime',
      ],
      [{ incidentTimePrecision: 'ROUGHLY' }, 'incidentTimePrecision'],
      [{ summary: 42 }, 'summary'],
    ])('rejects invalid input %j', async (body, field) => {
      const res = await as(alice.cookie).post('/api/cases', body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.fieldErrors.map((e: { field: string }) => e.field)).toContain(field);
    });

    it('accepts exactly 2,000 summary and 200 contact/location characters (code points)', async () => {
      const created = await createCase(alice.cookie, {
        summary: '₹'.repeat(1999) + '😀',
        contact: 'c'.repeat(200),
        location: 'l'.repeat(200),
      });
      expect([...(created.summary as string)]).toHaveLength(2000);
    });

    it('requires the web Origin', async () => {
      await t.http().post('/api/cases').set('Cookie', alice.cookie).send({}).expect(403);
    });
  });

  describe('GET /api/cases', () => {
    it('lists only the caller’s cases with the permitted fields', async () => {
      const carol = await signIn(t);
      expect((await as(carol.cookie).get('/api/cases').expect(200)).body).toEqual({
        items: [],
        nextCursor: null,
      });

      const mine = await createCase(carol.cookie, { summary: 'private words' });
      await createCase(bob.cookie);
      const res = await as(carol.cookie).get('/api/cases').expect(200);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.items).toHaveLength(1);
      const [item] = res.body.items;
      expect(Object.keys(item).sort()).toEqual(LIST_ITEM_KEYS);
      expect(item).toMatchObject({
        id: mine.id,
        caseReference: mine.caseReference,
        status: 'NEW',
        incidentType: null,
        urgency: { level: null },
        evidence: { total: 0 },
      });
      expect(JSON.stringify(res.body)).not.toContain('private words');
    });

    it('paginates with a stable cursor: default 20, newest update first', async () => {
      const dave = await signIn(t);
      const created: string[] = [];
      for (let i = 0; i < 23; i += 1) created.push((await createCase(dave.cookie)).id);

      const first = await as(dave.cookie).get('/api/cases').expect(200);
      expect(first.body.items).toHaveLength(20);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await as(dave.cookie)
        .get(`/api/cases?cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .expect(200);
      expect(second.body.items).toHaveLength(3);
      expect(second.body.nextCursor).toBeNull();

      const all = [...first.body.items, ...second.body.items] as {
        id: string;
        updatedAt: string;
      }[];
      expect(new Set(all.map((c) => c.id))).toEqual(new Set(created));
      const times = all.map((c) => Date.parse(c.updatedAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));

      const exact = await as(dave.cookie).get('/api/cases?limit=23').expect(200);
      expect(exact.body.items).toHaveLength(23);
      expect(exact.body.nextCursor).toBeNull();
    });

    it('returns exactly one full page with no cursor when there are 20 cases', async () => {
      const erin = await signIn(t);
      for (let i = 0; i < 20; i += 1) await createCase(erin.cookie);
      const res = await as(erin.cookie).get('/api/cases').expect(200);
      expect(res.body.items).toHaveLength(20);
      expect(res.body.nextCursor).toBeNull();
    });

    it('scopes cursors to the caller: another user’s cursor never yields their cases', async () => {
      const frank = await signIn(t);
      for (let i = 0; i < 3; i += 1) await createCase(frank.cookie);
      const page = await as(frank.cookie).get('/api/cases?limit=1').expect(200);
      const viaBob = await as(bob.cookie)
        .get(`/api/cases?cursor=${encodeURIComponent(page.body.nextCursor)}`)
        .expect(200);
      const frankIds = (await prisma.case.findMany({ where: { userId: frank.userId } })).map(
        (c) => c.id,
      );
      expect(viaBob.body.items.some((c: { id: string }) => frankIds.includes(c.id))).toBe(false);
    });

    it.each([
      'limit=0',
      'limit=51',
      'limit=abc',
      'limit=1000000',
      'cursor=not-a-cursor',
      'cursor=' + Buffer.from('["x","y"]').toString('base64url'),
      'userId=' + randomUUID(),
    ])('rejects ?%s with 400', async (query) => {
      const res = await as(alice.cookie).get(`/api/cases?${query}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('allows the maximum limit of 50', async () => {
      await as(alice.cookie).get('/api/cases?limit=50').expect(200);
    });
  });

  describe('GET /api/cases/:id', () => {
    it('returns the owner’s case', async () => {
      const created = await createCase(alice.cookie, { location: 'Pune' });
      const res = await as(alice.cookie).get(`/api/cases/${created.id}`).expect(200);
      expect(res.body).toEqual(created);
    });

    it('answers another user’s case exactly like a missing one', async () => {
      const aliceCase = await createCase(alice.cookie, {
        summary: 'alice secret',
        contact: 'alice contact',
      });
      const unowned = await as(bob.cookie).get(`/api/cases/${aliceCase.id}`).expect(404);
      const missing = await as(bob.cookie).get(`/api/cases/${randomUUID()}`).expect(404);
      const malformed = await as(bob.cookie).get('/api/cases/not-a-uuid').expect(404);
      expect(notFoundBody(unowned)).toEqual({
        code: 'NOT_FOUND',
        message: "This case isn't available.",
      });
      expect(notFoundBody(missing)).toEqual(notFoundBody(unowned));
      expect(notFoundBody(malformed)).toEqual(notFoundBody(unowned));
      for (const text of [aliceCase.caseReference, 'alice secret', 'alice contact', alice.userId]) {
        expect(unowned.text).not.toContain(text);
      }
      expect(Object.keys(unowned.headers).sort()).toEqual(Object.keys(missing.headers).sort());
    });

    it('never exposes owner or internal fields', async () => {
      const created = await createCase(alice.cookie);
      const res = await as(alice.cookie).get(`/api/cases/${created.id}`).expect(200);
      for (const key of ['userId', 'user_id', 'contactText', 'locationText', 'checklistVariant']) {
        expect(res.body).not.toHaveProperty(key);
      }
      expect(res.text).not.toContain(alice.userId);
    });
  });

  describe('PATCH /api/cases/:id', () => {
    it('updates permitted fields, records statements and keeps the status', async () => {
      const created = await createCase(alice.cookie, { summary: 'first' });
      const res = await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, {
          summary: 'second',
          incidentTime: '2026-09-24T06:37:00Z',
          incidentTimePrecision: 'EXACT',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        summary: 'second',
        incidentTime: '2026-09-24T06:37:00.000Z',
        incidentTimePrecision: 'EXACT',
        status: 'NEW',
        caseReference: created.caseReference,
      });
      const summaries = await prisma.userStatement.findMany({
        where: { caseId: created.id, subject: 'case.summary' },
        orderBy: { createdAt: 'asc' },
      });
      expect(summaries.map((s) => s.valueText)).toEqual(['first', 'second']);
      expect(summaries[1]!.supersedesStatementId).toBe(summaries[0]!.id);
    });

    it('clears a value with null and returns to UNKNOWN', async () => {
      const created = await createCase(alice.cookie, {
        contact: 'x',
        incidentTime: '2026-09-24T06:37:00Z',
        incidentTimePrecision: 'EXACT',
      });
      const res = await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, {
          contact: null,
          incidentTime: null,
          incidentTimePrecision: 'UNKNOWN',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        contact: null,
        incidentTime: null,
        incidentTimePrecision: 'UNKNOWN',
      });
    });

    it('validates the merged time pairing', async () => {
      const created = await createCase(alice.cookie, {
        incidentTime: '2026-09-24T06:37:00Z',
        incidentTimePrecision: 'EXACT',
      });
      // Dropping the precision while a time remains would break the pairing.
      await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, { incidentTimePrecision: null })
        .expect(400);
      // Changing only the time keeps the stored precision.
      await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, {
          incidentTime: '2026-09-24T07:00:00Z',
          incidentTimePrecision: 'EXACT',
        })
        .expect(200);
    });

    it('is a no-op for an unchanged body (no statement, no audit)', async () => {
      const created = await createCase(alice.cookie, { location: 'Pune' });
      const res = await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, { location: 'Pune' })
        .expect(200);
      expect(res.body.updatedAt).toBe(created.updatedAt);
      expect(
        await prisma.auditLog.count({ where: { caseId: created.id, action: 'CASE_UPDATED' } }),
      ).toBe(0);
    });

    it.each([
      [{ status: 'EXPORTED' }],
      [{ caseReference: 'CF-1' }],
      [{ userId: randomUUID() }],
      [{ incidentType: 'UPI_FRAUD' }],
      [{ urgency: 'HIGH' }],
      [{ createdAt: '2020-01-01T00:00:00Z' }],
      [{ summary: 'x'.repeat(2001) }],
      [{ contact: 'x'.repeat(201) }],
    ])('rejects %j and changes nothing', async (body) => {
      const created = await createCase(alice.cookie);
      const res = await as(alice.cookie).patch(`/api/cases/${created.id}`, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const stored = await prisma.case.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored).toMatchObject({
        status: 'NEW',
        userId: alice.userId,
        caseReference: created.caseReference,
        incidentType: null,
      });
    });

    it('returns 404 for another user’s case and leaves it untouched', async () => {
      const created = await createCase(alice.cookie, { summary: 'original' });
      const res = await as(bob.cookie)
        .patch(`/api/cases/${created.id}`, { summary: 'hijacked' })
        .expect(404);
      expect(notFoundBody(res).code).toBe('NOT_FOUND');
      expect((await prisma.case.findUniqueOrThrow({ where: { id: created.id } })).summary).toBe(
        'original',
      );
    });
  });

  describe('DELETE /api/cases/:id', () => {
    it.each(['', '?confirm=false', '?confirm=TRUE', '?confirm=1', '?confirm='])(
      'requires confirm=true (%s) and deletes nothing',
      async (query) => {
        const created = await createCase(alice.cookie);
        const res = await as(alice.cookie).del(`/api/cases/${created.id}${query}`).expect(400);
        expect(res.body.error.code).toBe('CONFIRMATION_REQUIRED');
        expect(await prisma.case.count({ where: { id: created.id } })).toBe(1);
      },
    );

    it('deletes the owner’s case and its rows, keeping a content-free tombstone', async () => {
      const created = await createCase(alice.cookie, {
        summary: 'to be deleted',
        contact: 'alice@contact',
      });
      const res = await as(alice.cookie).del(`/api/cases/${created.id}?confirm=true`).expect(204);
      expect(res.text).toBe('');

      await as(alice.cookie).get(`/api/cases/${created.id}`).expect(404);
      await as(alice.cookie).patch(`/api/cases/${created.id}`, { summary: 'x' }).expect(404);
      await as(alice.cookie).del(`/api/cases/${created.id}?confirm=true`).expect(404);
      await as(alice.cookie).get(`/api/cases/${created.id}/audit-log`).expect(404);
      expect(await prisma.case.count({ where: { id: created.id } })).toBe(0);
      expect(await prisma.userStatement.count({ where: { caseId: created.id } })).toBe(0);

      const audit = await prisma.auditLog.findMany({
        where: { caseId: created.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['CASE_CREATED', 'CASE_DELETED']);
      expect(audit[1]).toMatchObject({
        outcome: 'SUCCEEDED',
        actorUserId: alice.userId,
        metadata: { statusFrom: 'NEW' },
      });
      const serialized = JSON.stringify(audit);
      for (const text of ['to be deleted', 'alice@contact', created.caseReference]) {
        expect(serialized).not.toContain(text);
      }
    });

    it('returns 404 for another user’s case and keeps it', async () => {
      const created = await createCase(alice.cookie);
      const res = await as(bob.cookie).del(`/api/cases/${created.id}?confirm=true`).expect(404);
      expect(notFoundBody(res).code).toBe('NOT_FOUND');
      expect(await prisma.case.count({ where: { id: created.id } })).toBe(1);
    });
  });

  describe('GET /api/cases/:id/audit-log', () => {
    it('lists the case’s content-free entries newest first, without actor IDs', async () => {
      const created = await createCase(alice.cookie, { summary: 'words' });
      await as(alice.cookie)
        .patch(`/api/cases/${created.id}`, { summary: 'other words' })
        .expect(200);
      const res = await as(alice.cookie).get(`/api/cases/${created.id}/audit-log`).expect(200);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.entries.map((e: { action: string }) => e.action)).toEqual([
        'CASE_UPDATED',
        'CASE_CREATED',
      ]);
      expect(res.body.entries[0]).toMatchObject({
        actorKind: 'USER',
        actorIsYou: true,
        targetType: 'case',
        targetId: created.id,
        outcome: 'SUCCEEDED',
        metadata: {
          summaryChanged: true,
          contactChanged: false,
          incidentTimeChanged: false,
          locationChanged: false,
        },
      });
      expect(res.body.entries[0]).not.toHaveProperty('actorUserId');
      expect(res.text).not.toContain(alice.userId);
      expect(res.text).not.toContain('words');

      const page = await as(alice.cookie)
        .get(`/api/cases/${created.id}/audit-log?limit=1`)
        .expect(200);
      expect(page.body.entries).toHaveLength(1);
      const next = await as(alice.cookie)
        .get(
          `/api/cases/${created.id}/audit-log?limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`,
        )
        .expect(200);
      expect(next.body.entries[0].action).toBe('CASE_CREATED');
    });

    it('is not readable by another user', async () => {
      const created = await createCase(alice.cookie);
      await as(bob.cookie).get(`/api/cases/${created.id}/audit-log`).expect(404);
    });

    it('rejects limit above 200', async () => {
      const created = await createCase(alice.cookie);
      await as(alice.cookie).get(`/api/cases/${created.id}/audit-log?limit=201`).expect(400);
    });
  });

  describe('rate limiting (09 §18 default: 600/hour per user)', () => {
    it('returns 429 with Retry-After after 600 requests', async () => {
      const greta = await signIn(t);
      const results: number[] = [];
      for (let batch = 0; batch < 60; batch += 1) {
        results.push(
          ...(await Promise.all(
            Array.from({ length: 10 }, () =>
              as(greta.cookie)
                .get('/api/cases?limit=1')
                .then((r) => r.status),
            ),
          )),
        );
      }
      expect(results).toHaveLength(600);
      expect(results.every((s) => s === 200)).toBe(true);
      const res = await as(greta.cookie).get('/api/cases').expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // Another user is unaffected.
      await as(alice.cookie).get('/api/cases?limit=1').expect(200);
    });
  });
});

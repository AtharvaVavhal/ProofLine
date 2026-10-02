import { createHash } from 'node:crypto';
import { REQUEST_CODE_MESSAGE } from '../src/auth/auth.service';
import {
  ORIGIN,
  TestApp,
  cleanupAuthTestData,
  createTestApp,
  nextIp,
  post,
  signIn,
  testEmail,
} from './auth-app';
import { prisma } from './db';

describe('POST /api/auth/request-code', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  it('returns 202 with the non-enumerating message and nothing else', async () => {
    const email = testEmail();
    const res = await post(t, '/api/auth/request-code', { email }).expect(202);
    expect(res.body).toEqual({ message: REQUEST_CODE_MESSAGE });
    expect(REQUEST_CODE_MESSAGE).toBe(
      'If this email can be used, we sent a 6-digit code. It expires in 10 minutes.',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f]{24}$/);
    expect(res.headers['set-cookie']).toBeUndefined();

    const code = t.mail.lastCodeFor(email);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });

  it('gives known and unknown emails the same status and body', async () => {
    const known = await signIn(t);
    const a = await post(t, '/api/auth/request-code', { email: known.email }).expect(202);
    const b = await post(t, '/api/auth/request-code', { email: testEmail() }).expect(202);
    expect(a.body).toEqual(b.body);
    expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
  });

  it('stores only an HMAC of the code, with a 10-minute expiry and 5 attempts', async () => {
    const email = testEmail();
    const ip = nextIp();
    await post(t, '/api/auth/request-code', { email }, ip).expect(202);
    const code = t.mail.lastCodeFor(email);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { email } });

    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.codeHash).not.toContain(code);
    expect(challenge.codeHash).not.toBe(createHash('sha256').update(code).digest('hex'));
    const ttl = challenge.expiresAt.getTime() - challenge.createdAt.getTime();
    expect(Math.abs(ttl - 600_000)).toBeLessThan(2_000);
    expect(challenge.maxAttempts).toBe(5);
    expect(challenge.attemptCount).toBe(0);
    expect(challenge.consumedAt).toBeNull();
    expect(challenge.requesterFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.requesterFingerprint).not.toContain(ip);
  });

  it('normalises the email (trim + lower-case)', async () => {
    const email = testEmail();
    await post(t, '/api/auth/request-code', { email: `  ${email.toUpperCase()} ` }).expect(202);
    expect(await prisma.otpChallenge.count({ where: { email } })).toBe(1);
    expect(t.mail.lastCodeFor(email)).toMatch(/^[0-9]{6}$/);
  });

  it.each([
    [{ email: 'not-an-email' }, 'email', 'INVALID'],
    [{}, 'email', 'INVALID'],
    [{ email: `${'a'.repeat(250)}@x.example` }, 'email', 'INVALID'],
    [{ email: "x' OR '1'='1" }, 'email', 'INVALID'],
    [{ email: 'a@auth-test.example', password: 'hunter2' }, 'password', 'UNKNOWN_FIELD'],
  ])('rejects %j with 400 VALIDATION_FAILED', async (body, field, code) => {
    const res = await post(t, '/api/auth/request-code', body).expect(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.error.fieldErrors).toContainEqual({ field, code });
    expect(typeof res.body.error.requestId).toBe('string');
  });

  it('rejects malformed JSON with the standard envelope', async () => {
    const res = await t
      .http()
      .post('/api/auth/request-code')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected|at /);
  });

  it('requires the web Origin (CSRF check)', async () => {
    const email = testEmail();
    await t.http().post('/api/auth/request-code').send({ email }).expect(403);
    const res = await t
      .http()
      .post('/api/auth/request-code')
      .set('Origin', 'https://evil.example')
      .send({ email })
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(await prisma.otpChallenge.count({ where: { email } })).toBe(0);
  });

  it('supersedes the previous code on resend', async () => {
    const email = testEmail();
    const ip = nextIp();
    await post(t, '/api/auth/request-code', { email }, ip).expect(202);
    const first = t.mail.lastCodeFor(email);
    await post(t, '/api/auth/request-code', { email }, ip).expect(202);
    const second = t.mail.lastCodeFor(email);
    if (first !== second) {
      await post(t, '/api/auth/verify-code', { email, code: first }, ip).expect(422);
    }
    await post(t, '/api/auth/verify-code', { email, code: second }, ip).expect(200);
  });

  it('limits requests to 5 per hour per email, with Retry-After', async () => {
    const email = testEmail();
    for (let i = 0; i < 5; i += 1) {
      await post(t, '/api/auth/request-code', { email }).expect(202);
    }
    const res = await post(t, '/api/auth/request-code', { email }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.message).toBe('Please wait before requesting another code.');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(3600);
    expect(await prisma.otpChallenge.count({ where: { email } })).toBe(5);
  });

  it('limits requests to 20 per hour per client fingerprint', async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i += 1) {
      await post(t, '/api/auth/request-code', { email: testEmail() }, ip).expect(202);
    }
    await post(t, '/api/auth/request-code', { email: testEmail() }, ip).expect(429);
    // Another client is unaffected.
    await post(t, '/api/auth/request-code', { email: testEmail() }).expect(202);
  });

  it('returns 502 PROVIDER_ERROR without leaking provider details when sending fails', async () => {
    t.mail.failing = true;
    try {
      const res = await post(t, '/api/auth/request-code', { email: testEmail() }).expect(502);
      expect(res.body.error).toMatchObject({
        code: 'PROVIDER_ERROR',
        message: "We couldn't send the code. Please try again.",
      });
      expect(JSON.stringify(res.body)).not.toMatch(/smtp|550|mailbox/);
    } finally {
      t.mail.failing = false;
    }
  });

  it('audits the request without the email or code', async () => {
    const email = testEmail();
    const res = await post(t, '/api/auth/request-code', { email }).expect(202);
    const code = t.mail.lastCodeFor(email);
    const rows = await prisma.auditLog.findMany({
      where: { requestId: res.headers['x-request-id'] as string },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'AUTH_CODE_REQUESTED',
      outcome: 'SUCCEEDED',
      actorKind: 'SYSTEM',
      targetType: 'otp_challenge',
      metadata: {},
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(code);
  });
});

import { createHash } from 'node:crypto';
import {
  TestApp,
  cleanupAuthTestData,
  createTestApp,
  nextIp,
  post,
  setCookieHeader,
  signIn,
  testEmail,
} from './auth-app';
import { prisma } from './db';

describe('POST /api/auth/verify-code', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  async function requestCode(email = testEmail(), ip = nextIp()) {
    await post(t, '/api/auth/request-code', { email }, ip).expect(202);
    return { email, ip, code: t.mail.lastCodeFor(email) };
  }

  /** A 6-digit code guaranteed to differ from the real one. */
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

  it('signs in: 200, safe body, and a hardened session cookie', async () => {
    const { email, ip, code } = await requestCode();
    const res = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);

    expect(Object.keys(res.body)).toEqual(['user']);
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id']);
    expect(res.body.user.email).toBe(email);

    const cookie = setCookieHeader(res)!;
    const [pair, ...attributes] = cookie.split(';').map((s) => s.trim());
    const token = pair!.slice('proofline_session='.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attributes).toEqual(
      expect.arrayContaining(['Max-Age=604800', 'Path=/api', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    );
    expect(attributes.some((a) => a.startsWith('Expires='))).toBe(true);
    expect(attributes.some((a) => a.toLowerCase().startsWith('domain='))).toBe(false);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    expect(body).not.toContain(code);

    const session = await prisma.session.findFirstOrThrow({ where: { userId: res.body.user.id } });
    expect(session.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(session.tokenHash).not.toContain(token);
    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(ttl - 7 * 24 * 3600 * 1000)).toBeLessThan(2_000);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(user.lastLoginAt).not.toBeNull();
    const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { email } });
    expect(challenge.consumedAt).not.toBeNull();
  });

  it('creates the user once and a new session on every sign-in (rotation)', async () => {
    const email = testEmail();
    const first = await signIn(t, email);
    const second = await signIn(t, email);
    expect(second.userId).toBe(first.userId);
    expect(second.cookie).not.toBe(first.cookie);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: first.userId, revokedAt: null } })).toBe(
      2,
    );
  });

  it('rejects a wrong code with 422 INVALID_CODE and counts the attempt', async () => {
    const { email, ip, code } = await requestCode();
    const res = await post(t, '/api/auth/verify-code', { email, code: wrong(code) }, ip).expect(
      422,
    );
    expect(res.body.error).toMatchObject({
      code: 'INVALID_CODE',
      details: { attemptsRemaining: 4 },
    });
    expect(setCookieHeader(res)).toBeUndefined();
    expect((await prisma.otpChallenge.findFirstOrThrow({ where: { email } })).attemptCount).toBe(1);
    // The right code still works while attempts remain.
    await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);
  });

  it('locks the challenge after 5 wrong attempts, even for the right code', async () => {
    const { email, ip, code } = await requestCode();
    for (let remaining = 4; remaining >= 1; remaining -= 1) {
      const res = await post(t, '/api/auth/verify-code', { email, code: wrong(code) }, ip).expect(
        422,
      );
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CODE',
        details: { attemptsRemaining: remaining },
      });
    }
    const fifth = await post(t, '/api/auth/verify-code', { email, code: wrong(code) }, ip).expect(
      422,
    );
    expect(fifth.body.error.code).toBe('CODE_EXPIRED');
    const sixth = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(422);
    expect(sixth.body.error.code).toBe('CODE_EXPIRED');
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
  });

  it('rejects an expired code', async () => {
    const { email, ip, code } = await requestCode();
    await prisma.otpChallenge.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 700_000) },
    });
    const res = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('rejects replay of a used code', async () => {
    const { email, ip, code } = await requestCode();
    await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);
    const replay = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(422);
    expect(replay.body.error.code).toBe('CODE_EXPIRED');
    expect(setCookieHeader(replay)).toBeUndefined();
  });

  it('rejects verification when no code was requested', async () => {
    const res = await post(t, '/api/auth/verify-code', {
      email: testEmail(),
      code: '123456',
    }).expect(422);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('has no bypass codes', async () => {
    const { email, ip, code } = await requestCode();
    for (const candidate of ['000000', '123456', '999999']) {
      if (candidate === code) continue;
      await post(t, '/api/auth/verify-code', { email, code: candidate }, ip).expect(422);
    }
  });

  it.each([
    [{ code: '12345' }, 'code'],
    [{ code: '1234567' }, 'code'],
    [{ code: 'abcdef' }, 'code'],
    [{ code: "' OR 1=1 --" }, 'code'],
    [{ code: 123456 }, 'code'],
  ])('rejects malformed input %j with 400', async (patch, field) => {
    const res = await post(t, '/api/auth/verify-code', { email: testEmail(), ...patch }).expect(
      400,
    );
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fieldErrors).toContainEqual({ field, code: 'INVALID' });
  });

  it('treats injection-shaped but valid emails as plain data', async () => {
    const email = `o'brien+x--${Date.now()}@auth-test.example`;
    const { cookie } = await signIn(t, email);
    expect(cookie).toMatch(/^proofline_session=/);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('limits verification to 30 attempts per hour per client fingerprint', async () => {
    const ip = nextIp();
    for (let i = 0; i < 30; i += 1) {
      await post(t, '/api/auth/verify-code', { email: testEmail(), code: '123456' }, ip).expect(
        422,
      );
    }
    const res = await post(
      t,
      '/api/auth/verify-code',
      { email: testEmail(), code: '123456' },
      ip,
    ).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('audits success and failure without secrets', async () => {
    const { email, ip, code } = await requestCode();
    const failed = await post(t, '/api/auth/verify-code', { email, code: wrong(code) }, ip).expect(
      422,
    );
    const ok = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);

    const [failure] = await prisma.auditLog.findMany({
      where: { requestId: failed.headers['x-request-id'] as string },
    });
    expect(failure).toMatchObject({
      action: 'AUTH_SIGN_IN_FAILED',
      outcome: 'FAILED',
      metadata: { code: 'INVALID_CODE' },
    });
    const [success] = await prisma.auditLog.findMany({
      where: { requestId: ok.headers['x-request-id'] as string },
    });
    expect(success).toMatchObject({
      action: 'AUTH_SIGNED_IN',
      outcome: 'SUCCEEDED',
      actorKind: 'USER',
      actorUserId: ok.body.user.id,
      targetType: 'session',
    });
    const serialized = JSON.stringify([failure, success]);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(code);
  });
});

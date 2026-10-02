import { randomBytes } from 'node:crypto';
import {
  ORIGIN,
  TestApp,
  cleanupAuthTestData,
  createTestApp,
  setCookieHeader,
  signIn,
} from './auth-app';
import { prisma } from './db';

const PROTECTED = '/api/test-only/protected';

describe('session guard and logout', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  const get = (cookie?: string) => {
    const req = t.http().get(PROTECTED);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const logout = (cookie?: string) => {
    const req = t.http().post('/api/auth/logout').set('Origin', ORIGIN);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  function expectUnauthenticated(res: { body: { error: Record<string, unknown> } }) {
    expect(res.body.error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Please sign in again.',
      requestId: expect.any(String),
    });
  }

  function expectCleared(res: { headers: Record<string, unknown> }) {
    const header = setCookieHeader(res);
    expect(header).toMatch(/^proofline_session=;/);
    expect(header).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(header).toContain('Path=/api');
  }

  it('allows a valid session and exposes only the user id', async () => {
    const { cookie, userId } = await signIn(t);
    const res = await get(cookie).expect(200);
    expect(res.body).toEqual({ userId });
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect(session.lastSeenAt).not.toBeNull();
  });

  it('returns 401 without a cookie and does not set one', async () => {
    const res = await get().expect(401);
    expectUnauthenticated(res);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it.each([
    ['malformed', 'proofline_session=not-a-token'],
    ['empty', 'proofline_session='],
    ['unknown', `proofline_session=${randomBytes(32).toString('base64url')}`],
    ['injection-shaped', "proofline_session=' OR 1=1 --"],
  ])('returns the same 401 for a %s cookie and clears it', async (_label, cookie) => {
    const res = await get(cookie).expect(401);
    expectUnauthenticated(res);
    expectCleared(res);
  });

  it('returns 401 for an expired session', async () => {
    const { cookie, userId } = await signIn(t);
    await prisma.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 10_000) },
    });
    expectUnauthenticated(await get(cookie).expect(401));
  });

  it('returns 401 for a revoked session', async () => {
    const { cookie, userId } = await signIn(t);
    await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    expectUnauthenticated(await get(cookie).expect(401));
  });

  it('returns 401 for a disabled user', async () => {
    const { cookie, userId } = await signIn(t);
    await prisma.user.update({ where: { id: userId }, data: { authStatus: 'DISABLED' } });
    expectUnauthenticated(await get(cookie).expect(401));
  });

  it('gates the route: no session → 401, session → 200, logout → 401', async () => {
    await get().expect(401);
    const { cookie, userId } = await signIn(t);
    await get(cookie).expect(200);

    const out = await logout(cookie).expect(204);
    expect(out.text).toBe('');
    expectCleared(out);
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect(session.revokedAt).not.toBeNull();

    expectUnauthenticated(await get(cookie).expect(401));
  });

  it('answers a repeated logout with 401 and clears the cookie', async () => {
    const { cookie } = await signIn(t);
    await logout(cookie).expect(204);
    const again = await logout(cookie).expect(401);
    expectUnauthenticated(again);
    expectCleared(again);
    expectUnauthenticated(await logout().expect(401));
  });

  it('revokes only the current session', async () => {
    const first = await signIn(t);
    const second = await signIn(t, first.email);
    await logout(first.cookie).expect(204);
    await get(first.cookie).expect(401);
    await get(second.cookie).expect(200);
  });

  it('requires the web Origin for logout', async () => {
    const { cookie } = await signIn(t);
    const res = await t.http().post('/api/auth/logout').set('Cookie', cookie).expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    await get(cookie).expect(200);
  });

  it('audits logout', async () => {
    const { cookie, userId } = await signIn(t);
    const res = await logout(cookie).expect(204);
    const [row] = await prisma.auditLog.findMany({
      where: { requestId: res.headers['x-request-id'] as string },
    });
    expect(row).toMatchObject({
      action: 'AUTH_SIGNED_OUT',
      outcome: 'SUCCEEDED',
      actorUserId: userId,
      targetType: 'session',
    });
  });

  it('exposes no other auth endpoints', async () => {
    for (const path of [
      'login',
      'register',
      'signup',
      'refresh',
      'me',
      'password-reset',
      'forgot-password',
    ]) {
      const res = await t.http().post(`/api/auth/${path}`).set('Origin', ORIGIN).send({});
      expect([401, 404]).toContain(res.status);
      expect(res.status === 200 || res.status === 201).toBe(false);
    }
  });
});

import { randomUUID } from 'node:crypto';
import { Controller, Get, INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_OPTIONS, configureApp } from '../src/app.setup';
import { EMAIL_TRANSPORT, EmailTransport } from '../src/auth/email/email-transport';
import { CurrentUser } from '../src/auth/current-user.decorator';
import type { AuthenticatedUser } from '../src/common/app-request';
import { prisma } from './db';

export const ORIGIN = 'http://localhost:3000';
export const TEST_EMAIL_DOMAIN = 'auth-test.example';

/** Test-only sink: captures codes in memory so tests can read them. Never used by the app. */
export class CapturingEmailTransport implements EmailTransport {
  readonly sent: { to: string; code: string }[] = [];
  failing = false;

  async sendSignInCode(to: string, code: string): Promise<void> {
    if (this.failing) throw new Error('smtp.example.internal refused: 550 mailbox unavailable');
    this.sent.push({ to, code });
  }

  lastCodeFor(email: string): string {
    const found = [...this.sent].reverse().find((m) => m.to === email);
    if (!found) throw new Error(`no code sent to ${email}`);
    return found.code;
  }
}

/** Minimal protected route used only by tests to prove the global AuthGuard gates requests. */
@Controller('test-only/protected')
export class ProtectedProbeController {
  @Get()
  probe(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.id };
  }
}

export type TestApp = {
  app: INestApplication;
  mail: CapturingEmailTransport;
  http: () => ReturnType<typeof request>;
};

export async function createTestApp(
  controllers: Type[] = [ProtectedProbeController],
): Promise<TestApp> {
  const mail = new CapturingEmailTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(EMAIL_TRANSPORT)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app);
  // Bound once, so concurrent supertest requests share one listener instead of adding one each.
  await app.listen(0, '127.0.0.1');
  return { app, mail, http: () => request(app.getHttpServer()) };
}

let ipCounter = Math.floor(Math.random() * 200);
/** A distinct client address per call site (TRUST_PROXY=1 in .env.test), so limits don't collide. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`;
}

export function testEmail(): string {
  return `${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

export function post(t: TestApp, path: string, body: unknown, ip = nextIp()) {
  return t
    .http()
    .post(path)
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send(body as object);
}

/** Extracts `name=value` from the session Set-Cookie header. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const header = setCookieHeader(res);
  if (!header) throw new Error('no Set-Cookie');
  return header.split(';')[0]!;
}

export function setCookieHeader(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c: string) => c.startsWith('proofline_session='));
}

/** Full sign-in through the real endpoints. Returns the cookie pair and user id. */
export async function signIn(
  t: TestApp,
  email = testEmail(),
  ip = nextIp(),
): Promise<{ email: string; cookie: string; userId: string }> {
  await post(t, '/api/auth/request-code', { email }, ip).expect(202);
  const res = await post(
    t,
    '/api/auth/verify-code',
    { email, code: t.mail.lastCodeFor(email) },
    ip,
  ).expect(200);
  return { email, cookie: sessionCookie(res), userId: res.body.user.id as string };
}

/** Removes the cases, users, sessions and challenges created by these tests (audit rows are append-only). */
export async function cleanupAuthTestData(): Promise<void> {
  const like = { endsWith: `@${TEST_EMAIL_DOMAIN}` };
  await prisma.case.deleteMany({ where: { owner: { email: like } } });
  await prisma.session.deleteMany({ where: { user: { email: like } } });
  await prisma.user.deleteMany({ where: { email: like } });
  await prisma.otpChallenge.deleteMany({ where: { email: like } });
}

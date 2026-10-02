import { Controller, Get, Logger } from '@nestjs/common';
import { AuditMetadataError, AuditService } from '../src/audit/audit.service';
import { Public } from '../src/common/public.decorator';
import {
  ProtectedProbeController,
  TestApp,
  cleanupAuthTestData,
  createTestApp,
  nextIp,
  post,
  sessionCookie,
  testEmail,
} from './auth-app';
import { prisma } from './db';

/** Test-only route that fails with a message resembling a leaked database error. */
@Controller('test-only/boom')
class BoomController {
  @Public()
  @Get()
  boom(): never {
    throw new Error('SELECT * FROM users WHERE email = victim@example.test; password=hunter2');
  }
}

describe('authentication security', () => {
  let t: TestApp;
  const output: string[] = [];
  const spies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    t = await createTestApp([ProtectedProbeController, BoomController]);
    const capture = (chunk: unknown) => {
      output.push(String(chunk));
      return true;
    };
    spies.push(
      jest.spyOn(process.stdout, 'write').mockImplementation(capture),
      jest.spyOn(process.stderr, 'write').mockImplementation(capture),
      ...(['log', 'error', 'warn', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          output.push(args.map(String).join(' '));
        }),
      ),
      ...(['log', 'error', 'warn', 'info', 'debug'] as const).map((level) =>
        jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          output.push(args.map(String).join(' '));
        }),
      ),
    );
  });

  afterAll(async () => {
    spies.forEach((spy) => spy.mockRestore());
    await t.app.close();
    await cleanupAuthTestData();
    await prisma.$disconnect();
  });

  it('never writes codes, tokens, emails or the secret to logs or responses', async () => {
    const email = testEmail();
    const ip = nextIp();
    const responses: string[] = [];
    const keep = (res: { text: string; headers: Record<string, unknown> }) => {
      responses.push(res.text);
      return res;
    };

    keep(await post(t, '/api/auth/request-code', { email }, ip).expect(202));
    const code = t.mail.lastCodeFor(email);
    const wrongCode = code === '000000' ? '000001' : '000000';
    keep(await post(t, '/api/auth/verify-code', { email, code: wrongCode }, ip).expect(422));
    const verified = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);
    const cookie = sessionCookie(verified);
    const token = cookie.split('=')[1]!;
    keep(await t.http().get('/api/test-only/protected').set('Cookie', cookie).expect(200));
    keep(await post(t, '/api/auth/verify-code', { email, code }, ip).expect(422));

    const logs = output.join('\n');
    for (const secret of [code, token, process.env.AUTH_SECRET!, email]) {
      expect(logs).not.toContain(secret);
    }
    for (const body of [...responses, verified.text]) {
      expect(body).not.toContain(code);
      expect(body).not.toContain(token);
    }
  });

  it('sanitises unexpected errors: generic 500 body, class name only in logs', async () => {
    output.length = 0;
    const res = await t.http().get('/api/test-only/boom').expect(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId: res.headers['x-request-id'],
    });
    const everything = res.text + output.join('\n');
    expect(everything).not.toMatch(/SELECT|hunter2|victim@example|at .*\.ts/);
    expect(output.join('\n')).toContain('Unhandled Error');
  });

  it('stores no plaintext code or token anywhere in the auth tables', async () => {
    const email = testEmail();
    const ip = nextIp();
    await post(t, '/api/auth/request-code', { email }, ip).expect(202);
    const code = t.mail.lastCodeFor(email);
    const res = await post(t, '/api/auth/verify-code', { email, code }, ip).expect(200);
    const token = sessionCookie(res).split('=')[1]!;
    const rows = JSON.stringify(
      await Promise.all([
        prisma.otpChallenge.findMany({ where: { email } }),
        prisma.session.findMany({ where: { userId: res.body.user.id } }),
      ]),
    );
    expect(rows).not.toContain(`"${code}"`);
    expect(rows).not.toContain(token);
  });

  it('keeps test emails out of audit metadata', async () => {
    const leaked = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM audit_logs
      WHERE metadata::text ILIKE '%auth-test.example%' OR target_type ILIKE '%@%'`;
    expect(Number(leaked[0]!.n)).toBe(0);
  });
});

describe('AuditService metadata whitelist', () => {
  const audit = new AuditService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects keys outside the per-action whitelist', async () => {
    await expect(
      audit.record(prisma, {
        action: 'AUTH_CODE_REQUESTED',
        outcome: 'SUCCEEDED',
        metadata: { email: 'someone@auth-test.example' },
      }),
    ).rejects.toThrow(AuditMetadataError);
  });

  it('rejects free-text values even for whitelisted keys', async () => {
    await expect(
      audit.record(prisma, {
        action: 'AUTH_SIGN_IN_FAILED',
        outcome: 'FAILED',
        metadata: { code: 'wrong code 123456' },
      }),
    ).rejects.toThrow(AuditMetadataError);
  });

  it('rolls back the audited action when the audit write is rejected', async () => {
    const email = testEmail();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.otpChallenge.create({
          data: { email, codeHash: 'x'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
        });
        await audit.record(tx, {
          action: 'AUTH_CODE_REQUESTED',
          outcome: 'SUCCEEDED',
          metadata: { ip: 'NOT_ALLOWED' },
        });
      }),
    ).rejects.toThrow(AuditMetadataError);
    expect(await prisma.otpChallenge.count({ where: { email } })).toBe(0);
  });
});

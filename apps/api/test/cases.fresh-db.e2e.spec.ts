import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ORIGIN, TestApp, createTestApp, signIn } from './auth-app';

/**
 * Proves the frozen numbering on a brand-new database: migrate a throwaway database, create cases
 * through the API, and check CF-10001 first and no duplicates under concurrency (Doc 15 SEQ-01).
 */
describe('case reference on a fresh database', () => {
  const owner = new URL(process.env.DATABASE_MIGRATION_URL!);
  const app = new URL(process.env.DATABASE_URL!);
  const name = `proofline_test_fresh_${randomBytes(4).toString('hex')}`;
  const admin = new PrismaClient({ datasourceUrl: owner.toString() });
  const saved = { app: process.env.DATABASE_URL, owner: process.env.DATABASE_MIGRATION_URL };
  let t: TestApp;

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    owner.pathname = `/${name}`;
    app.pathname = `/${name}`;
    process.env.DATABASE_MIGRATION_URL = owner.toString();
    process.env.DATABASE_URL = app.toString();
    execFileSync(resolve(__dirname, '../node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: 'pipe',
    });
    t = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await t?.app.close();
    process.env.DATABASE_URL = saved.app;
    process.env.DATABASE_MIGRATION_URL = saved.owner;
    // The owner role cannot terminate the app role's sessions, so wait for the closed pool to
    // drain instead of using DROP ... WITH (FORCE).
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [row] = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity WHERE datname = ${name}`;
      if (Number(row!.n) === 0) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.$disconnect();
  });

  it('starts at CF-10001 and stays unique under concurrent creation', async () => {
    const { cookie } = await signIn(t);
    const create = () =>
      t.http().post('/api/cases').set('Origin', ORIGIN).set('Cookie', cookie).send({});

    const first = await create().expect(201);
    expect(first.body.caseReference).toBe('CF-10001');

    const parallel = await Promise.all(Array.from({ length: 25 }, create));
    expect(parallel.every((r) => r.status === 201)).toBe(true);
    const refs = parallel.map((r) => r.body.caseReference as string);
    expect(refs.every((ref) => /^CF-\d{5}$/.test(ref))).toBe(true);
    expect(new Set(refs).size).toBe(25);
    const numbers = refs.map((ref) => Number(ref.slice(3))).sort((a, b) => a - b);
    expect(numbers[0]).toBeGreaterThan(10001);
    expect(numbers.every((n) => n <= 10026)).toBe(true);
  });
});

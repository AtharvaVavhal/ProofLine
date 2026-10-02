import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Tests run against the database in `.env.test` (CI provides the variables directly).
// Jest gives each test file its own process.env copy, so values are assigned explicitly;
// process.loadEnvFile would only change the parent process. Variables already set win.
const path = resolve(__dirname, '..', '.env.test');
if (existsSync(path)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Guard: test rows (including append-only audit rows) must never reach a non-test database.
const database = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
if (!/test/.test(database)) {
  throw new Error('Tests require DATABASE_URL to point at a dedicated *test* database (.env.test)');
}

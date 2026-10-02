import { loadConfig } from '../src/config/env';

describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:secret@localhost:5432/proofline',
    AUTH_SECRET: 'x'.repeat(48),
    WEB_ORIGIN: 'http://localhost:3000/',
  };

  it('applies defaults and normalises the web origin', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: valid.DATABASE_URL,
      authSecret: valid.AUTH_SECRET,
      webOrigin: 'http://localhost:3000',
      emailTransport: 'console',
      trustProxy: 0,
    });
  });

  it.each(['DATABASE_URL', 'AUTH_SECRET', 'WEB_ORIGIN'])('fails fast when %s is missing', (key) => {
    const env: Record<string, string> = { ...valid };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(new RegExp(key));
  });

  it('rejects non-PostgreSQL URLs and short secrets', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://user@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadConfig({ ...valid, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('refuses the console email transport in production (no sign-in bypass)', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/EMAIL_TRANSPORT/);
    expect(() => loadConfig({ ...valid, EMAIL_TRANSPORT: 'smtp' })).toThrow(/EMAIL_TRANSPORT/);
  });

  it('never echoes secrets in errors', () => {
    try {
      loadConfig({
        ...valid,
        AUTH_SECRET: 'tooshort-hunter2',
        DATABASE_URL: 'postgresql://u:pw-hunter3@',
      });
    } catch (error) {
      expect(String(error)).not.toMatch(/hunter2|hunter3/);
    }
  });
});

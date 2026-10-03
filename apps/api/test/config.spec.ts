import path from 'node:path';
import { loadConfig } from '../src/config/env';

describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:secret@localhost:5432/proofline',
    AUTH_SECRET: 'x'.repeat(48),
    WEB_ORIGIN: 'http://localhost:3000/',
    STORAGE_BUCKET: 'proofline-evidence',
    STORAGE_ACCESS_KEY_ID: 'key',
    STORAGE_SECRET_ACCESS_KEY: 'storage-secret-hunter4',
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
      storage: {
        driver: 's3',
        bucket: 'proofline-evidence',
        region: 'us-east-1',
        endpoint: undefined,
        forcePathStyle: false,
        accessKeyId: 'key',
        secretAccessKey: 'storage-secret-hunter4',
      },
      workerEnabled: true,
      ai: {
        provider: 'none',
        model: null,
        timeoutMs: 20_000,
        demoFallback: 'off',
        syntheticDir: path.resolve(__dirname, '../../../synthetic'),
      },
    });
  });

  it.each([
    'DATABASE_URL',
    'AUTH_SECRET',
    'WEB_ORIGIN',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ])('fails fast when %s is missing', (key) => {
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

  it('parses WORKER_ENABLED', () => {
    expect(loadConfig({ ...valid, WORKER_ENABLED: 'false' }).workerEnabled).toBe(false);
    expect(() => loadConfig({ ...valid, WORKER_ENABLED: 'yes' })).toThrow(/WORKER_ENABLED/);
  });

  it('parses the AI gateway settings (AD-06)', () => {
    const ai = loadConfig({
      ...valid,
      LLM_MODEL: 'some-model',
      LLM_TIMEOUT_MS: '5000',
      DEMO_FALLBACK: 'auto',
      SYNTHETIC_DIR: '/data/synthetic',
    }).ai;
    expect(ai).toEqual({
      provider: 'none',
      model: 'some-model',
      timeoutMs: 5000,
      demoFallback: 'auto',
      syntheticDir: '/data/synthetic',
    });
    // No vendor adapter exists yet (OD-02), so a vendor name is refused rather than ignored.
    expect(() => loadConfig({ ...valid, LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
    expect(() => loadConfig({ ...valid, DEMO_FALLBACK: 'always' })).toThrow(/DEMO_FALLBACK/);
    expect(() => loadConfig({ ...valid, LLM_TIMEOUT_MS: '10' })).toThrow(/LLM_TIMEOUT_MS/);
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
      expect(String(error)).not.toMatch(/hunter2|hunter3|hunter4/);
    }
  });
});

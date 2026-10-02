import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a PostgreSQL connection URL'),
    /** Server secret for OTP and client-fingerprint HMACs (09 §17: ≥ 256 bits). */
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters of random data'),
    /** The web origin allowed to send mutating requests (05 §4.2 Origin check). */
    WEB_ORIGIN: z.string().url(),
    /** Only `console` exists so far; it is refused in production (09 §6). */
    EMAIL_TRANSPORT: z.enum(['console']).default('console'),
    /** Number of trusted reverse-proxy hops in front of the API (client fingerprinting). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** Private S3-compatible bucket for evidence (OD-14; vendor is an implementation choice). */
    STORAGE_DRIVER: z.enum(['s3']).default('s3'),
    STORAGE_BUCKET: z.string().min(3),
    STORAGE_REGION: z.string().min(1).default('us-east-1'),
    /** Omit for AWS S3; set for other S3-compatible services (e.g. the local SeaweedFS). */
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.EMAIL_TRANSPORT === 'console'), {
    path: ['EMAIL_TRANSPORT'],
    message: 'the console transport is not allowed in production',
  });

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  authSecret: string;
  webOrigin: string;
  emailTransport: 'console';
  trustProxy: number;
  storage: {
    driver: 's3';
    bucket: string;
    region: string;
    endpoint: string | undefined;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
};

/**
 * Validates the process environment at boot (04 §30). Error messages name the offending
 * variables only, never their values, because they contain credentials and secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const data = parsed.data;
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    authSecret: data.AUTH_SECRET,
    webOrigin: new URL(data.WEB_ORIGIN).origin,
    emailTransport: data.EMAIL_TRANSPORT,
    trustProxy: data.TRUST_PROXY,
    storage: {
      driver: data.STORAGE_DRIVER,
      bucket: data.STORAGE_BUCKET,
      region: data.STORAGE_REGION,
      endpoint: data.STORAGE_ENDPOINT,
      forcePathStyle: data.STORAGE_FORCE_PATH_STYLE === 'true',
      accessKeyId: data.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: data.STORAGE_SECRET_ACCESS_KEY,
    },
  };
}

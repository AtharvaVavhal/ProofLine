// Creates the evidence bucket if it is missing and allows browser uploads from WEB_ORIGIN only
// (04 §9, 09 §10). Local/CI helper; production buckets are provisioned by the operator.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const env = process.env;
for (const key of [
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'WEB_ORIGIN',
]) {
  if (!env[key]) {
    console.error(`storage:init: ${key} is not set`);
    process.exit(1);
  }
}

const client = new S3Client({
  region: env.STORAGE_REGION ?? 'us-east-1',
  endpoint: env.STORAGE_ENDPOINT,
  forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  },
});
const Bucket = env.STORAGE_BUCKET;

try {
  await client.send(new HeadBucketCommand({ Bucket }));
  console.log(`storage:init: bucket ${Bucket} exists`);
} catch {
  await client.send(new CreateBucketCommand({ Bucket }));
  console.log(`storage:init: created bucket ${Bucket}`);
}

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [new URL(env.WEB_ORIGIN).origin],
            AllowedMethods: ['PUT', 'GET'],
            AllowedHeaders: ['content-type'],
            MaxAgeSeconds: 600,
          },
        ],
      },
    }),
  );
  console.log(`storage:init: CORS limited to ${new URL(env.WEB_ORIGIN).origin}`);
} catch (error) {
  console.warn(`storage:init: could not set CORS (${error.name}); configure it on the provider`);
}

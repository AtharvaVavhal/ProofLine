import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/env';
import { ObjectNotFoundError, ObjectStorage, StorageUnavailableError } from './object-storage';

const isNotFound = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
};

/** S3-compatible adapter (AWS S3, R2, Supabase Storage S3, SeaweedFS, MinIO). */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig['storage']) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Without this the SDK signs a CRC32 of an empty body into presigned PUT URLs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async createSignedUploadUrl(
    key: string,
    contentType: string,
    byteSize: number,
    expiresIn: number,
  ) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: byteSize,
      }),
      // content-length is signed by default; content-type must be listed explicitly.
      { expiresIn, signableHeaders: new Set(['content-type']) },
    );
  }

  async createSignedDownloadUrl(
    key: string,
    options: { contentType: string; downloadName: string; expiresInSeconds: number },
  ) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: `attachment; filename="${options.downloadName}"`,
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }

  async headObject(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { byteSize: head.ContentLength ?? 0 };
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError();
      throw new StorageUnavailableError();
    }
  }

  async getObjectStream(key: string): Promise<Readable> {
    try {
      const object = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return object.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError();
      throw new StorageUnavailableError();
    }
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch {
      throw new StorageUnavailableError();
    }
  }

  async deleteObject(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw new StorageUnavailableError();
    }
  }
}

// S3-compatible provider (MinIO in dev, R2 in prod).
// The @aws-sdk packages are imported LAZILY so the app boots without them
// installed when STORAGE_TYPE=local. forcePathStyle for MinIO/R2 compat.
import { env } from "@/lib/env";
import type { StorageProvider } from "@/lib/storage/types";

// Minimal structural types so this file typechecks without the SDK present.
// The real SDK objects satisfy these shapes.
interface S3ClientLike {
  send(command: unknown): Promise<{ Body?: unknown }>;
}

export class S3StorageProvider implements StorageProvider {
  private readonly bucket: string;
  private clientPromise?: Promise<S3ClientLike>;
  private sdkPromise?: Promise<typeof import("@aws-sdk/client-s3")>;

  constructor(bucket = env.STORAGE_BUCKET) {
    this.bucket = bucket;
  }

  private sdk(): Promise<typeof import("@aws-sdk/client-s3")> {
    this.sdkPromise ??= import("@aws-sdk/client-s3");
    return this.sdkPromise;
  }

  private client(): Promise<S3ClientLike> {
    this.clientPromise ??= this.sdk().then(
      ({ S3Client }) =>
        new S3Client({
          endpoint: env.STORAGE_ENDPOINT,
          region: "auto",
          forcePathStyle: true,
          credentials: {
            accessKeyId: env.STORAGE_ACCESS_KEY,
            secretAccessKey: env.STORAGE_SECRET_KEY,
          },
        }) as unknown as S3ClientLike,
    );
    return this.clientPromise;
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await this.sdk();
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await this.sdk();
    const client = await this.client();
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (!body) throw new Error(`s3 object has no body: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  }

  async deleteObject(key: string): Promise<void> {
    const { DeleteObjectCommand } = await this.sdk();
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, expiresSec: number): Promise<string> {
    const { GetObjectCommand } = await this.sdk();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.client();
    return getSignedUrl(
      client as never,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }) as never,
      { expiresIn: expiresSec },
    );
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await this.sdk();
    const client = await this.client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

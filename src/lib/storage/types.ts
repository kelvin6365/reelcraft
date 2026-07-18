// StorageProvider: the only surface the app uses to touch bytes.
// Implementations: local (dev filesystem) / s3 (MinIO/R2). Keys are opaque
// storage keys (CLAUDE.md #4 — DB stores keys, never URLs).

export interface StorageProvider {
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;
  getObjectBuffer(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  // Time-limited read URL. Local provider returns an app route; s3 presigns.
  getSignedUrl(key: string, expiresSec: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

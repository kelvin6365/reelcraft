// getStorage(): the single accessor for the active provider, chosen by
// STORAGE_TYPE (local for dev, s3 for MinIO/R2). Memoized per process.
import { env } from "@/lib/env";
import { LocalStorageProvider } from "@/lib/storage/local";
import { S3StorageProvider } from "@/lib/storage/s3";
import type { StorageProvider } from "@/lib/storage/types";

let cached: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  cached ??= env.STORAGE_TYPE === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
  return cached;
}

export type { StorageProvider };

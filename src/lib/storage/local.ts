// Local filesystem provider rooted at ./data/storage.
// Path-traversal protection: every key resolves to a path that must stay
// inside the root, else we reject (never trust the key).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageProvider } from "@/lib/storage/types";

export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  // Root is injectable so tests can point at a temp dir.
  constructor(root = "./data/storage") {
    this.root = resolve(root);
  }

  // Resolve a key against the root and verify it cannot escape.
  private safePath(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return full;
  }

  async putObject(key: string, buffer: Buffer, _contentType: string): Promise<void> {
    const full = this.safePath(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, buffer);
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.safePath(key), { force: true });
  }

  async getSignedUrl(key: string, _expiresSec: number): Promise<string> {
    // Local dev has no signing; the route serves by opaque key.
    return `/api/files/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.safePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

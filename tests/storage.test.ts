import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageProvider } from "@/lib/storage/local";

// --- Local provider: put/get/exists/delete + traversal ------------------

describe("LocalStorageProvider", () => {
  let root: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "reelcraft-store-"));
    provider = new LocalStorageProvider(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put then get round-trips bytes into a nested key", async () => {
    const buf = Buffer.from("hello reelcraft");
    await provider.putObject("shots/images/abc.png", buf, "image/png");

    const got = await provider.getObjectBuffer("shots/images/abc.png");
    expect(got.equals(buf)).toBe(true);

    // written under the injected root, not the default ./data/storage
    const onDisk = await readFile(join(root, "shots/images/abc.png"));
    expect(onDisk.equals(buf)).toBe(true);
  });

  it("exists reflects presence", async () => {
    expect(await provider.exists("missing/x.bin")).toBe(false);
    await provider.putObject("a/x.bin", Buffer.from("y"), "application/octet-stream");
    expect(await provider.exists("a/x.bin")).toBe(true);
  });

  it("delete removes the object", async () => {
    await provider.putObject("d/x.bin", Buffer.from("y"), "application/octet-stream");
    await provider.deleteObject("d/x.bin");
    expect(await provider.exists("d/x.bin")).toBe(false);
  });

  it("delete is idempotent on a missing key", async () => {
    await expect(provider.deleteObject("nope/x.bin")).resolves.toBeUndefined();
  });

  it("getSignedUrl returns the local file route", async () => {
    expect(await provider.getSignedUrl("shots/x.png", 60)).toBe("/api/files/shots/x.png");
  });

  it("rejects path-traversal keys", async () => {
    await expect(provider.getObjectBuffer("../escape.txt")).rejects.toThrow(/escapes root/);
    await expect(
      provider.putObject("../../evil.txt", Buffer.from("x"), "text/plain"),
    ).rejects.toThrow(/escapes root/);
    await expect(provider.getObjectBuffer("a/../../b.txt")).rejects.toThrow(/escapes root/);
    // exists is intentionally non-throwing: an escaping key reads as absent, never leaks
    expect(await provider.exists("/etc/passwd")).toBe(false);
  });
});

// --- Media service: sha256 / publicId / storageKey correctness ----------
// getStorage is stubbed to a temp-dir local provider; prisma.create echoes
// its data back so we can assert the computed fields without a database.

const tempRoots: string[] = [];
const storageStub = { provider: null as LocalStorageProvider | null };

vi.mock("@/lib/storage", () => ({
  getStorage: () => storageStub.provider,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mediaObject: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  },
}));

describe("media service createMediaFromBuffer", () => {
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "reelcraft-media-"));
    tempRoots.push(root);
    storageStub.provider = new LocalStorageProvider(root);
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it("computes sha256, publicId, sizeBytes and a keyPrefix-scoped storageKey", async () => {
    const { createMediaFromBuffer, extForMime } = await import("@/lib/media/service");
    const buffer = Buffer.from("frame-bytes-1234");
    const expectedSha = createHash("sha256").update(buffer).digest("hex");

    const row = await createMediaFromBuffer({
      userId: "user-1",
      buffer,
      mimeType: "image/png",
      keyPrefix: "shots/images",
    });

    expect(row.userId).toBe("user-1");
    expect(row.sha256).toBe(expectedSha);
    expect(row.sizeBytes).toBe(BigInt(buffer.byteLength));
    expect(row.mimeType).toBe("image/png");
    expect(row.publicId).toMatch(/^[0-9a-f-]{36}$/);
    // storageKey = `${keyPrefix}/${publicId}.${ext}`
    expect(row.storageKey).toBe(`shots/images/${row.publicId}.${extForMime("image/png")}`);

    // bytes actually landed in storage under that key
    const stored = await storageStub.provider!.getObjectBuffer(row.storageKey as string);
    expect(stored.equals(buffer)).toBe(true);
  });

  it("maps mime to extension, falling back to bin", async () => {
    const { extForMime } = await import("@/lib/media/service");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("audio/mpeg")).toBe("mp3");
    expect(extForMime("video/mp4")).toBe("mp4");
    expect(extForMime("application/x-unknown")).toBe("bin");
  });
});

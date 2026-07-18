import { beforeAll, describe, expect, it } from "vitest";

// env.ts fail-fasts on missing vars at import time; populate the required ones
// before the (dynamic) import of crypto-keys so it can derive the master key.
process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

let encryptKey: (p: string) => string;
let decryptKey: (e: string) => string;
let last4: (p: string) => string;

beforeAll(async () => {
  const mod = await import("@/lib/crypto-keys");
  encryptKey = mod.encryptKey;
  decryptKey = mod.decryptKey;
  last4 = mod.last4;
});

describe("crypto-keys — round trip", () => {
  it("decrypts back to the original plaintext", () => {
    const plain = "sk-or-v1-abcdef0123456789";
    expect(decryptKey(encryptKey(plain))).toBe(plain);
  });

  it("handles unicode and long keys", () => {
    const plain = "金鑰-🔑-" + "x".repeat(500);
    expect(decryptKey(encryptKey(plain))).toBe(plain);
  });

  it("produces the documented iv:authTag:cipher hex shape", () => {
    const parts = encryptKey("hello").split(":");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[0-9a-f]+$/);
    expect(parts[0]).toHaveLength(24); // 12-byte IV
    expect(parts[1]).toHaveLength(32); // 16-byte GCM tag
  });

  it("uses a fresh IV each call (ciphertext differs, plaintext matches)", () => {
    const a = encryptKey("same-input");
    const b = encryptKey("same-input");
    expect(a).not.toBe(b);
    expect(decryptKey(a)).toBe("same-input");
    expect(decryptKey(b)).toBe("same-input");
  });
});

describe("crypto-keys — tamper detection", () => {
  it("rejects a flipped ciphertext byte (auth tag fails)", () => {
    const env = encryptKey("sensitive-key");
    const [iv, tag, cipher] = env.split(":");
    const flipped = cipher.slice(0, -1) + (cipher.at(-1) === "0" ? "1" : "0");
    expect(() => decryptKey(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("rejects a flipped auth tag", () => {
    const env = encryptKey("sensitive-key");
    const [iv, tag, cipher] = env.split(":");
    const flipped = tag.slice(0, -1) + (tag.at(-1) === "0" ? "1" : "0");
    expect(() => decryptKey(`${iv}:${flipped}:${cipher}`)).toThrow();
  });

  it("rejects a malformed envelope", () => {
    expect(() => decryptKey("nonsense")).toThrow();
    expect(() => decryptKey("aa:bb")).toThrow();
  });
});

describe("crypto-keys — last4", () => {
  it("returns the last four characters", () => {
    expect(last4("sk-or-v1-abcd1234")).toBe("1234");
  });
  it("returns the whole string when 4 chars or fewer", () => {
    expect(last4("ab")).toBe("ab");
  });
});

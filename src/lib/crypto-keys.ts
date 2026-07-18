// AES-256-GCM envelope encryption for BYO provider keys (M3-T2).
// The master key is derived once from API_ENCRYPTION_KEY via scrypt — a fixed
// salt is fine here: the salt exists to bind the KDF to this app, not to defend
// against rainbow tables on a high-entropy secret. Envelope format is
// `iv:authTag:ciphertext`, all hex. GCM's auth tag makes tampering detectable
// (decrypt throws) — so a corrupted or truncated envelope never yields a
// silently-wrong plaintext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "@/lib/env";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce length
const KDF_SALT = "reelcraft-byok-v1";

// Derived once at module load — scrypt is deliberately expensive, so we do NOT
// want to run it per encrypt/decrypt call.
const masterKey = scryptSync(env.API_ENCRYPTION_KEY, KDF_SALT, KEY_LEN);

export function encryptKey(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptKey(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 3) throw new Error("[crypto-keys] malformed envelope");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(dataHex, "hex");
  if (iv.length !== IV_LEN) throw new Error("[crypto-keys] bad iv length");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  // .final() throws if the auth tag doesn't verify → tamper detection.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Last 4 chars of the plaintext key, for masked display (••••abcd). Short keys
// (< 4 chars, only in tests) fall back to the whole string.
export function last4(plaintext: string): string {
  return plaintext.length <= 4 ? plaintext : plaintext.slice(-4);
}

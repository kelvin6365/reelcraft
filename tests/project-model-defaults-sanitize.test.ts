// sanitizeProjectModelDefaults — PATCH /api/projects/:id validation (design doc
// 2026-07-19-provider-model-defaults, PR3). Pure logic wrapping
// validateDefaultsPatch, so no DB — env.ts fail-fasts at import though, so seed
// required vars before the dynamic import (mirrors model-defaults.test.ts).
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

type Mod = typeof import("@/lib/model-defaults/sanitize");
let S: Mod;

const IMAGE = "fal::fal-ai/nano-banana-pro";
const VIDEO = "fal::fal-ai/kling-video/v3/standard/image-to-video";

beforeAll(async () => {
  S = await import("@/lib/model-defaults/sanitize");
});

describe("sanitizeProjectModelDefaults", () => {
  it("passes a valid multi-slot patch through unchanged", () => {
    const r = S.sanitizeProjectModelDefaults({ image: IMAGE, video: VIDEO });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ image: IMAGE, video: VIDEO });
  });

  it("400s (ok:false) on an unknown slot key", () => {
    const r = S.sanitizeProjectModelDefaults({ audio: IMAGE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_MODEL_DEFAULTS");
  });

  it("400s when a value's apiType doesn't match its slot", () => {
    const r = S.sanitizeProjectModelDefaults({ image: VIDEO }); // a video model in the image slot
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/not image/);
  });

  it("400s on a model key not in the catalog", () => {
    const r = S.sanitizeProjectModelDefaults({ image: "fal::not-a-real-model" });
    expect(r.ok).toBe(false);
  });

  it("400s on a malformed (non provider::modelId) key", () => {
    const r = S.sanitizeProjectModelDefaults({ image: "garbage" });
    expect(r.ok).toBe(false);
  });

  it("400s when the patch itself isn't an object", () => {
    expect(S.sanitizeProjectModelDefaults("not-an-object").ok).toBe(false);
    expect(S.sanitizeProjectModelDefaults(null).ok).toBe(false);
    expect(S.sanitizeProjectModelDefaults(["array"]).ok).toBe(false);
  });

  it('strips ""-valued (clear-override) keys before persisting — project layer stores only real overrides', () => {
    const r = S.sanitizeProjectModelDefaults({ image: IMAGE, video: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ image: IMAGE });
      expect("video" in r.value).toBe(false);
    }
  });

  it("an all-clear patch sanitizes to an empty object, not an error", () => {
    const r = S.sanitizeProjectModelDefaults({ text: "", image: "", video: "", tts: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
});

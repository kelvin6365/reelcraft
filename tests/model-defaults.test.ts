// Three-layer model-defaults resolver + patch validator. Pure logic (the user
// layer is a {} stub in PR1 and resolveModelDefaults takes the project object
// directly), so no DB — but env.ts fail-fasts at import, so seed required vars
// before the dynamic import, mirroring provider-keys.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The user layer now reads prisma.userModelDefaults.findUnique. Mock @/lib/db so
// these stay fast, DB-free unit tests; `userRow` is the mutable stand-in for the
// caller's stored row (null = no row → empty user layer).
const dbState = vi.hoisted(() => ({ userRow: null as null | { defaults: unknown } }));
vi.mock("@/lib/db", () => ({
  prisma: { userModelDefaults: { findUnique: vi.fn(async () => dbState.userRow) } },
}));

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.STORAGE_BUCKET ??= "test";
process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY = "unit-test-encryption-key-0123456789";

type Mod = typeof import("@/lib/model-defaults/resolve");
let M: Mod;

const U = "user-1";

const SYSTEM = {
  text: "openrouter::google/gemini-2.5-flash-lite",
  image: "fal::fal-ai/nano-banana",
  video: "atlascloud::bytedance/seedance-2.0-mini/image-to-video",
  tts: "fal::fal-ai/minimax/speech-02-hd",
} as const;

beforeAll(async () => {
  M = await import("@/lib/model-defaults/resolve");
});

beforeEach(() => {
  dbState.userRow = null; // default: no user override
});

describe("resolveModelDefaults — precedence", () => {
  it("returns the system defaults when there is no project", async () => {
    const r = await M.resolveModelDefaults(U, null);
    expect({ text: r.text, image: r.image, video: r.video, tts: r.tts }).toEqual(SYSTEM);
    expect(r.source).toEqual({ text: "system", image: "system", video: "system", tts: "system" });
  });

  it("treats an empty modelDefaults object the same as no project", async () => {
    const r = await M.resolveModelDefaults(U, { modelDefaults: {} });
    expect(r.image).toBe(SYSTEM.image);
    expect(r.source.image).toBe("system");
  });

  it("lets a project override win per-modality, independently", async () => {
    const r = await M.resolveModelDefaults(U, {
      modelDefaults: { image: "fal::fal-ai/bytedance/seedream/v4/text-to-image" },
    });
    // overridden slot comes from project…
    expect(r.image).toBe("fal::fal-ai/bytedance/seedream/v4/text-to-image");
    expect(r.source.image).toBe("project");
    // …every other slot is untouched (still system).
    expect(r.text).toBe(SYSTEM.text);
    expect(r.video).toBe(SYSTEM.video);
    expect(r.tts).toBe(SYSTEM.tts);
    expect(r.source.video).toBe("system");
  });
});

describe("resolveModelDefaults — illegal entries fall through to system, never fake", () => {
  it("skips an unparseable project value", async () => {
    const r = await M.resolveModelDefaults(U, { modelDefaults: { image: "not-a-model-key" } });
    expect(r.image).toBe(SYSTEM.image);
    expect(r.source.image).toBe("system");
  });

  it("skips a well-formed key that isn't in the catalog", async () => {
    const r = await M.resolveModelDefaults(U, { modelDefaults: { video: "fal::fal-ai/totally-made-up" } });
    expect(r.video).toBe(SYSTEM.video);
    expect(r.source.video).toBe("system");
  });

  it("skips a catalog key whose apiType doesn't match the slot", async () => {
    // a real text model dropped into the image slot must not be accepted
    const r = await M.resolveModelDefaults(U, { modelDefaults: { image: SYSTEM.text } });
    expect(r.image).toBe(SYSTEM.image);
    expect(r.source.image).toBe("system");
  });

  it("never returns a fake::* key (and never the fake::pipeline phantom) without the preset", async () => {
    const r = await M.resolveModelDefaults(U, {
      modelDefaults: { text: "garbage", image: "", video: "fake::nope", tts: "openrouter::x" },
    });
    for (const key of [r.text, r.image, r.video, r.tts]) {
      expect(key.startsWith("fake::")).toBe(false);
    }
    expect(r.text).not.toBe("fake::pipeline");
  });
});

describe("validateDefaultsPatch", () => {
  it("accepts a valid single-modality patch", () => {
    const r = M.validateDefaultsPatch({ image: "fal::fal-ai/nano-banana" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ image: "fal::fal-ai/nano-banana" });
  });

  it("accepts an empty-string clear-override and preserves it", () => {
    const r = M.validateDefaultsPatch({ image: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ image: "" });
  });

  it("rejects an unknown key name", () => {
    const r = M.validateDefaultsPatch({ audio: "fal::whatever" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_MODEL_DEFAULTS");
  });

  it("rejects a malformed model key", () => {
    expect(M.validateDefaultsPatch({ text: "no-separator" }).ok).toBe(false);
  });

  it("rejects a well-formed key that isn't in the catalog", () => {
    expect(M.validateDefaultsPatch({ text: "openrouter::not-a-real-model" }).ok).toBe(false);
  });

  it("rejects a key whose apiType doesn't match its slot", () => {
    // gemini-flash-lite is a text model, not an image model
    expect(M.validateDefaultsPatch({ image: SYSTEM.text }).ok).toBe(false);
  });

  it("rejects non-object and non-string shapes", () => {
    expect(M.validateDefaultsPatch(null).ok).toBe(false);
    expect(M.validateDefaultsPatch(["fal::x"]).ok).toBe(false);
    expect(M.validateDefaultsPatch("nope").ok).toBe(false);
    expect(M.validateDefaultsPatch({ text: 123 }).ok).toBe(false);
  });
});

describe("resolveModelDefaults — user layer (system < user < project)", () => {
  it("lets a stored user default beat the system layer, per-modality", async () => {
    dbState.userRow = { defaults: { image: "fal::fal-ai/nano-banana" } };
    const r = await M.resolveModelDefaults(U, null);
    expect(r.image).toBe("fal::fal-ai/nano-banana");
    expect(r.source.image).toBe("user");
    // untouched slots still fall to system
    expect(r.text).toBe(SYSTEM.text);
    expect(r.source.text).toBe("system");
  });

  it("lets a project override beat the user layer", async () => {
    dbState.userRow = { defaults: { image: "fal::fal-ai/nano-banana" } };
    const r = await M.resolveModelDefaults(U, {
      modelDefaults: { image: "fal::fal-ai/bytedance/seedream/v4/text-to-image" },
    });
    expect(r.image).toBe("fal::fal-ai/bytedance/seedream/v4/text-to-image");
    expect(r.source.image).toBe("project");
  });

  it("falls through an illegal user value to system, never fake", async () => {
    dbState.userRow = { defaults: { video: "fal::fal-ai/totally-made-up" } };
    const r = await M.resolveModelDefaults(U, null);
    expect(r.video).toBe(SYSTEM.video);
    expect(r.source.video).toBe("system");
  });

  it('treats a stored "" (empty string) slot as absent, not a value', async () => {
    // "" should never be persisted, but if a legacy/hand-edited row has one the
    // resolver must ignore it and fall back — not crash or downgrade.
    dbState.userRow = { defaults: { image: "" } };
    const r = await M.resolveModelDefaults(U, null);
    expect(r.image).toBe(SYSTEM.image);
    expect(r.source.image).toBe("system");
  });
});

describe("mergeUserDefaults", () => {
  let merge: typeof import("@/lib/user/model-defaults").mergeUserDefaults;
  beforeAll(async () => {
    ({ mergeUserDefaults: merge } = await import("@/lib/user/model-defaults"));
  });

  it("sets a new slot without disturbing the others", () => {
    expect(merge({ text: "openrouter::google/gemini-2.5-flash" }, { image: "fal::fal-ai/nano-banana" })).toEqual({
      text: "openrouter::google/gemini-2.5-flash",
      image: "fal::fal-ai/nano-banana",
    });
  });

  it('deletes the slot when the patch value is "" (clear override)', () => {
    expect(merge({ image: "fal::fal-ai/nano-banana", text: "openrouter::google/gemini-2.5-flash" }, { image: "" })).toEqual({
      text: "openrouter::google/gemini-2.5-flash",
    });
  });

  it("never stores an empty string", () => {
    const out = merge({ image: "fal::fal-ai/nano-banana" }, { image: "" });
    expect("image" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('""');
  });

  it("does not mutate the existing object", () => {
    const existing = { image: "fal::fal-ai/nano-banana" };
    merge(existing, { image: "" });
    expect(existing).toEqual({ image: "fal::fal-ai/nano-banana" });
  });
});

describe("MODEL_DEFAULTS_PRESET=fake", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.MODEL_DEFAULTS_PRESET;
  });

  it("replaces the system layer with fake::* (explicit dev override, source stays system)", async () => {
    vi.resetModules();
    process.env.MODEL_DEFAULTS_PRESET = "fake";
    const fake = await import("@/lib/model-defaults/resolve");
    const r = await fake.resolveModelDefaults(U, null);
    expect({ text: r.text, image: r.image, video: r.video, tts: r.tts }).toEqual({
      text: "fake::text",
      image: "fake::image",
      video: "fake::video",
      tts: "fake::tts",
    });
    expect(r.source).toEqual({ text: "system", image: "system", video: "system", tts: "system" });
  });

  it("still lets a legal project override beat the fake system layer", async () => {
    vi.resetModules();
    process.env.MODEL_DEFAULTS_PRESET = "fake";
    const fake = await import("@/lib/model-defaults/resolve");
    const r = await fake.resolveModelDefaults(U, { modelDefaults: { image: "fal::fal-ai/nano-banana" } });
    expect(r.image).toBe("fal::fal-ai/nano-banana");
    expect(r.source.image).toBe("project");
  });
});

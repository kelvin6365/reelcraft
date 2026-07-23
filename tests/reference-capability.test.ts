import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pw@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.STORAGE_ENDPOINT ??= "http://localhost:9000";
process.env.STORAGE_BUCKET ??= "test";
process.env.STORAGE_ACCESS_KEY ??= "test";
process.env.STORAGE_SECRET_KEY ??= "test";
process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.API_ENCRYPTION_KEY ??= "y".repeat(32);

vi.mock("@/lib/ai/outbound-image", () => ({
  normalizeReferenceImages: vi.fn(async (ids: string[]) => ids.map(() => "data:image/jpeg;base64,AA==")),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

type Caps = typeof import("@/lib/ai/capabilities");
type Media = typeof import("@/lib/ai/generate-media");
let caps: Caps;
let media: Media;

beforeAll(async () => {
  caps = await import("@/lib/ai/capabilities");
  media = await import("@/lib/ai/generate-media");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("supportsReferenceImages catalog", () => {
  it("is declared explicitly on every image model", () => {
    const images = caps.listCapabilityEntries().filter((e) => e.apiType === "image");
    expect(images.length).toBeGreaterThan(0);
    for (const e of images) {
      expect(typeof e.capabilities?.supportsReferenceImages, `${e.modelKey} must declare it`).toBe("boolean");
    }
  });

  it("keeps the fake dev model reference-capable", () => {
    expect(caps.getCapabilities("fake::image")?.supportsReferenceImages).toBe(true);
  });
});

describe("generateImage reference gate", () => {
  const ctx = { userId: "u1", projectId: "p1" };
  const req = {
    prompt: "a shot",
    aspectRatio: "9:16",
    keyPrefix: "projects/p1/shots/s1",
  };

  it("refuses a model that cannot take references, without calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      media.generateImage(ctx as never, {
        ...req,
        modelKey: "atlascloud::seedream-3.0",
        referenceMediaIds: ["media-1"],
      } as never),
    ).rejects.toMatchObject({ code: "MODEL_NO_REFERENCE_SUPPORT", retryable: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a reference-capable model through the gate", async () => {
    const err = await media
      .generateImage(ctx as never, {
        ...req,
        modelKey: "fake::image",
        referenceMediaIds: ["media-1"],
      } as never)
      .then(() => null)
      .catch((e: { code?: string }) => e);
    expect(err?.code).not.toBe("MODEL_NO_REFERENCE_SUPPORT");
  });

  it("does not gate calls that send no references", async () => {
    const err = await media
      .generateImage(ctx as never, { ...req, modelKey: "atlascloud::seedream-3.0" } as never)
      .then(() => null)
      .catch((e: { code?: string }) => e);
    expect(err?.code).not.toBe("MODEL_NO_REFERENCE_SUPPORT");
  });

  it("passes when the /edit swap rescues a text-to-image key", () => {
    const effective = media.effectiveImageModelKey("atlascloud::google/nano-banana-2/text-to-image", true);
    expect(effective).toBe("atlascloud::google/nano-banana-2/edit");
    expect(caps.getCapabilities(effective)?.supportsReferenceImages).toBe(true);
  });
});

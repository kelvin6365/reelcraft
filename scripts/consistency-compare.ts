// Real-fal A/B: does reference-image conditioning fix character consistency?
// A (OLD): 3 shots generated from TEXT only — each a fresh face.
// B (NEW): generate 1 locked reference portrait, then 3 shots conditioned on it.
// Writes all images to /tmp/consistency/ for eyeball comparison.
import { mkdir, writeFile } from "node:fs/promises";
import { falImage } from "../src/lib/ai/adapters/fal";

const KEY = process.env.FAL_KEY!;
const MODEL = "fal-ai/nano-banana";
const OUT = "/tmp/consistency";

const CHAR = "一個二十多歲的亞洲女性，及肩黑色直髮，杏眼，膚色白皙，穿白色襯衫";
const SHOTS = [
  "推開咖啡店的門走進來，全景，雨夜",
  "坐在窗邊低頭看一封信，近景，暖黃燈光",
  "抬頭望向對面，中景，神情平靜",
];

async function fetchTo(url: string, path: string) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(path, buf);
  return buf.length;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log("[compare] === A: OLD (text-only, no reference) ===");
  for (let i = 0; i < SHOTS.length; i++) {
    const { url } = await falImage({
      modelId: MODEL,
      prompt: `${CHAR}，${SHOTS[i]}，photorealistic, cinematic`,
      aspectRatio: "9:16",
      apiKey: KEY,
    });
    const kb = Math.round((await fetchTo(url, `${OUT}/A-shot${i + 1}.png`)) / 1024);
    console.log(`  A shot${i + 1}: ${kb}KB (fresh face each time)`);
  }

  console.log("[compare] === B: NEW (locked reference → img2img) ===");
  // 1) canonical reference portrait (reference-optimized framing, like our M2b handler)
  const ref = await falImage({
    modelId: MODEL,
    prompt: `${CHAR}. character reference sheet, front-facing, neutral even lighting, plain light-grey background, full head and upper body clearly visible, sharp focus on face`,
    aspectRatio: "9:16",
    apiKey: KEY,
  });
  const refDataUri = `data:image/png;base64,${(await (await fetch(ref.url)).arrayBuffer().then((b) => Buffer.from(b))).toString("base64")}`;
  await fetchTo(ref.url, `${OUT}/B-reference.png`);
  console.log("  B reference portrait saved");

  // 2) each shot conditioned on the reference (edit endpoint via referenceImages)
  for (let i = 0; i < SHOTS.length; i++) {
    const { url } = await falImage({
      modelId: MODEL,
      prompt: `the woman in the reference image, ${SHOTS[i]}, photorealistic, cinematic. Match the reference image exactly for face, hairstyle and wardrobe. Only framing, camera angle, action and expression may change.`,
      aspectRatio: "9:16",
      apiKey: KEY,
      referenceImages: [refDataUri],
    });
    const kb = Math.round((await fetchTo(url, `${OUT}/B-shot${i + 1}.png`)) / 1024);
    console.log(`  B shot${i + 1}: ${kb}KB (conditioned on reference)`);
  }

  console.log(`\n[compare] ✅ done — open ${OUT}/ to compare A-* (should drift) vs B-* (should match B-reference)`);
}

main().catch((e) => {
  console.error("[compare] ❌", e);
  process.exit(1);
});

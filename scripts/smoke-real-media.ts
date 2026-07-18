// Real-provider media smoke: 1 fal image + 1 short fal TTS (cheap, ~US$0.05
// total). Verifies the fal adapter assumptions flagged in M2-T1. Video (i2v,
// ~$1.4/5s) only runs with --video.
import { prisma } from "../src/lib/db";
import { newId } from "../src/lib/ids";
import { generateImage, generateTts, generateVideo } from "../src/lib/ai/generate-media";

async function main() {
  const withVideo = process.argv.includes("--video");
  const email = "smoke@reelcraft.local";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await prisma.user.create({ data: { id: newId(), name: "smoke", email } });
  const ctx = { userId: user.id };

  console.log("[real] 1/3 fal image (nano-banana, ~$0.039)…");
  const img = await generateImage(ctx, {
    modelKey: "fal::fal-ai/nano-banana",
    prompt: "a young woman pushing open the door of a cozy cafe at night, warm cinematic lighting, photorealistic",
    aspectRatio: "9:16",
    keyPrefix: "smoke/real",
  });
  console.log("  ✓ image", { id: img.id, bytes: Number(img.sizeBytes), mime: img.mimeType });

  console.log("[real] 2/3 fal TTS (minimax speech-02-hd, ~$0.001)…");
  const tts = await generateTts(ctx, {
    modelKey: "fal::fal-ai/minimax/speech-02-hd",
    text: "歡迎使用 ReelCraft。",
    keyPrefix: "smoke/real",
  });
  console.log("  ✓ tts", { id: tts.id, bytes: Number(tts.sizeBytes), mime: tts.mimeType });

  if (withVideo) {
    console.log("[real] 3/3 fal video (kling v3 5s, ~$1.40)…");
    const vid = await generateVideo(ctx, {
      modelKey: "fal::fal-ai/kling-video/v3/standard/image-to-video",
      prompt: "she steps inside, the door swings closed behind her, warm light",
      sourceImageMediaId: img.id,
      durationSec: 5,
      aspectRatio: "9:16",
      keyPrefix: "smoke/real",
    });
    console.log("  ✓ video", { id: vid.id, bytes: Number(vid.sizeBytes), mime: vid.mimeType });
  } else {
    console.log("[real] 3/3 video skipped (run with --video, costs ~$1.40)");
  }

  const rows = await prisma.aiCallLog.findMany({ orderBy: { id: "desc" }, take: withVideo ? 3 : 2 });
  console.log("[real] AiCallLog:");
  for (const r of rows.reverse()) {
    console.log(` ${r.modelKey} ${r.status} qty=${r.quantity}${r.unit} est=$${r.estCostUsd} ${r.latencyMs}ms ${r.errorCode ?? ""}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[real] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});

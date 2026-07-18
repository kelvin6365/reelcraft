// M0 acceptance: "AiCallLog has its first row".
// Creates a smoke user if needed, calls callModel() (real OpenRouter if key set,
// otherwise the fake adapter), then prints the latest AiCallLog row.
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { newId } from "../src/lib/ids";
import { callModel } from "../src/lib/ai/call-model";
import { audit } from "../src/lib/audit";

async function main() {
  const email = "smoke@reelcraft.local";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { id: newId(), name: "smoke", email },
    });
  }

  const modelKey = env.OPENROUTER_API_KEY
    ? "openrouter::google/gemini-2.5-flash-lite"
    : "fake::echo-1";

  console.log(`[smoke] calling ${modelKey} …`);
  const result = await callModel(
    { userId: user.id, promptId: "smoke", promptVersion: "0" },
    {
      modelKey: modelKey as `${string}::${string}`,
      messages: [{ role: "user", content: "Reply with exactly: REELCRAFT-M0-OK" }],
      maxTokens: 20,
    },
  );
  console.log(`[smoke] response: ${result.text.trim().slice(0, 100)}`);

  audit(user.id, "smoke.ai", { source: "system", metadata: { modelKey } });

  // fire-and-forget logs need a beat to land
  await new Promise((r) => setTimeout(r, 500));

  const row = await prisma.aiCallLog.findFirst({ orderBy: { id: "desc" } });
  if (!row) throw new Error("M0 FAIL: no AiCallLog row found");
  console.log("[smoke] ✅ M0 acceptance — latest AiCallLog row:");
  console.log({
    id: String(row.id),
    modelKey: row.modelKey,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
    at: row.at.toISOString(),
  });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[smoke] ❌", err);
  await prisma.$disconnect();
  process.exit(1);
});

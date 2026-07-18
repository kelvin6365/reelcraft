// Deterministic fake adapter for tests/smoke — never available in production.
// Only call-model.ts may import this (guard: no-ai-bypass).
import type { TextAdapter, TextRequest, TextResult } from "@/lib/ai/types";

export const fakeAdapter: TextAdapter = {
  provider: "fake",

  async complete(req: TextRequest): Promise<TextResult> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const echo = lastUser?.content ?? "";
    return {
      text: `[fake] ${echo}`,
      usage: { inputTokens: Math.ceil(echo.length / 4), outputTokens: 8 },
      providerRequestId: `fake-${Date.now()}`,
    };
  },
};

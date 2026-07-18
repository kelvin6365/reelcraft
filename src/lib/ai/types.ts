import type { ApiType, ModelKey } from "@/lib/ai/model-key";

export interface CallContext {
  userId: string;
  taskId?: string;
  projectId?: string;
  episodeId?: string;
  promptId?: string;
  promptVersion?: string;
}

// ---------- text ----------

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextRequest {
  modelKey: ModelKey;
  messages: TextMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface TextUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult {
  text: string;
  usage: TextUsage; // adapters MUST return usage — callModel depends on it for AiCallLog
  providerRequestId?: string;
}

export interface AdapterMeta {
  promptId?: string; // lets dev/test adapters return schema-shaped canned output
}

export interface TextAdapter {
  readonly provider: string;
  complete(req: TextRequest, apiKey: string, meta?: AdapterMeta): Promise<TextResult>;
}

// ---------- media (M1: fal / atlascloud implement this) ----------

export interface MediaResult {
  resultUrl: string;
  quantity: number; // images: count / video: seconds / tts: characters
  unit: "image" | "second" | "character";
  providerRequestId?: string;
}

export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type { ApiType, ModelKey };

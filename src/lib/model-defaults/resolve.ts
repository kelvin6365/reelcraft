// Three-layer model-defaults resolver (design doc 2026-07-19-provider-model-defaults).
//
//   system default (code constant, real models)
//     ← user default   (per-user, PR2 table — stubbed to {} here)
//       ← project override (projects.modelDefaults)
//
// Resolved per apiType (text/image/video/tts): the MOST SPECIFIC *legal* layer
// wins. An illegal entry (not parseable / not in catalog / apiType mismatch) is
// logged and skipped, falling back to the next-more-general layer — never to
// fake (CLAUDE.md #3: no silent downgrade). The only way to reach fake is the
// explicit MODEL_DEFAULTS_PRESET=fake dev override, which replaces the *system*
// layer wholesale (source stays "system").
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { parseModelKeyStrict, type ApiType, type ModelKey } from "@/lib/ai/model-key";
import { getCapabilityEntry } from "@/lib/ai/capabilities";
import type { Project } from "@prisma/client";

// The four model slots a project/user/system can configure. Centralized here
// (was duplicated in workers/handlers/shared.ts) and re-exported for callers.
export interface ModelDefaults {
  text: string;
  image: string;
  video: string;
  tts: string;
}

export type DefaultsSource = "system" | "user" | "project";

export interface ResolvedModelDefaults {
  text: ModelKey;
  image: ModelKey;
  video: ModelKey;
  tts: ModelKey;
  // which layer won for each slot — worker logs this, billing ignores it.
  source: Record<ApiType, DefaultsSource>;
}

const API_TYPES: readonly ApiType[] = ["text", "image", "video", "tts"];

// Real-model system floor. Every value is verified present in
// standards/capabilities.json with a matching apiType by the
// provider-registry-check guard.
export const SYSTEM_MODEL_DEFAULTS: ModelDefaults = {
  text: "openrouter::google/gemini-2.5-flash-lite",
  // Cheapest ref-proven image path: fal nano-banana is $0.039 flat INCLUDING the
  // /edit (reference) calls the shot pipeline lives on. Atlas NB2 t2i is $0.013
  // but its edit variant is $0.08 — pickable per-project, not the floor.
  image: "fal::fal-ai/nano-banana",
  // Cheapest Seedance (user decision 2026-07-21): Atlas Mini i2v $0.056/s.
  video: "atlascloud::bytedance/seedance-2.0-mini/image-to-video",
  tts: "fal::fal-ai/minimax/speech-02-hd",
};

// Explicit dev/CI override (NOT a downgrade — see module header). Kept as a
// standalone literal so the guard's fake-fallback scan never has to special-case
// a `?? "fake::"` pattern.
const FAKE_MODEL_DEFAULTS: ModelDefaults = {
  text: "fake::text",
  image: "fake::image",
  video: "fake::video",
  tts: "fake::tts",
};

function systemLayer(): ModelDefaults {
  return env.MODEL_DEFAULTS_PRESET === "fake" ? FAKE_MODEL_DEFAULTS : SYSTEM_MODEL_DEFAULTS;
}

// The effective system layer — the real floor, or the explicit fake preset when
// MODEL_DEFAULTS_PRESET=fake. Exposed for the settings API's "what you'd fall
// back to" view; resolution itself uses the private systemLayer().
export function effectiveSystemDefaults(): ModelDefaults {
  return systemLayer();
}

// A candidate value is legal for a slot iff it is a strict provider::modelId,
// exists in the pricing/capability catalog, and that catalog entry's apiType
// matches the slot it's filling.
function isLegalForSlot(value: unknown, apiType: ApiType): value is ModelKey {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!parseModelKeyStrict(value)) return false;
  const entry = getCapabilityEntry(value);
  return entry !== null && entry.apiType === apiType;
}

// The user layer: the caller's row in user_model_defaults, or {} when unset. A
// cleared slot is stored as *absent* (the PUT route deletes the key rather than
// writing ""), so the resolver never has to special-case an empty string here —
// but isLegalForSlot still guards against a legacy/hand-edited "" or bad value.
export async function getUserLayer(userId: string): Promise<Partial<ModelDefaults>> {
  const row = await prisma.userModelDefaults.findUnique({
    where: { userId },
    select: { defaults: true },
  });
  return (row?.defaults ?? {}) as Partial<ModelDefaults>;
}

// Resolve the effective model for every apiType. `project` may be null (e.g. a
// project-less text task) — then only system ← user apply.
export async function resolveModelDefaults(
  userId: string,
  project?: Pick<Project, "modelDefaults"> | null,
): Promise<ResolvedModelDefaults> {
  const system = systemLayer();
  const user = await getUserLayer(userId);
  const projectLayer = (project?.modelDefaults ?? {}) as Partial<ModelDefaults>;

  const resolved = {} as Record<ApiType, ModelKey>;
  const source = {} as Record<ApiType, DefaultsSource>;

  for (const apiType of API_TYPES) {
    // most-specific-legal-wins: project → user → system.
    if (isLegalForSlot(projectLayer[apiType], apiType)) {
      resolved[apiType] = projectLayer[apiType] as ModelKey;
      source[apiType] = "project";
    } else if (isLegalForSlot(user[apiType], apiType)) {
      resolved[apiType] = user[apiType] as ModelKey;
      source[apiType] = "user";
    } else {
      // system is guaranteed legal (guard-enforced); the else branch also
      // absorbs any illegal project/user entries we skipped.
      resolved[apiType] = system[apiType] as ModelKey;
      source[apiType] = "system";
    }

    // surface skipped-because-illegal overrides so a bad project/user value is
    // debuggable rather than silently ignored. An empty string is the intentional
    // "cleared" sentinel, not a mistake — don't warn on it.
    if (source[apiType] === "system") {
      const p = projectLayer[apiType];
      const u = user[apiType];
      if (p !== undefined && p !== "" && !isLegalForSlot(p, apiType)) {
        console.warn(`[model-resolve] skipped illegal project ${apiType}=${JSON.stringify(p)} → falling back`);
      } else if (u !== undefined && u !== "" && !isLegalForSlot(u, apiType)) {
        console.warn(`[model-resolve] skipped illegal user ${apiType}=${JSON.stringify(u)} → falling back`);
      }
    }
  }

  return { text: resolved.text, image: resolved.image, video: resolved.video, tts: resolved.tts, source };
}

export interface DefaultsPatchOk {
  ok: true;
  value: Partial<ModelDefaults>;
}
export interface DefaultsPatchErr {
  ok: false;
  error: { code: "INVALID_MODEL_DEFAULTS"; message: string };
}

// Validate a PATCH to modelDefaults (used by the project/user settings routes in
// later PRs). Accepts an object whose keys ⊆ the four slots. Each value is a
// string; an empty string is the "clear this override" sentinel — it is allowed
// and PRESERVED as "" in the returned value so the persistence layer can delete
// that key when merging (distinguishing "clear" from "absent"). Any non-empty
// value must pass the same legality checks the resolver applies.
export function validateDefaultsPatch(patch: unknown): DefaultsPatchOk | DefaultsPatchErr {
  const err = (message: string): DefaultsPatchErr => ({ ok: false, error: { code: "INVALID_MODEL_DEFAULTS", message } });

  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return err("modelDefaults must be an object");
  }

  const value: Partial<ModelDefaults> = {};
  for (const [key, raw] of Object.entries(patch)) {
    if (!(API_TYPES as readonly string[]).includes(key)) {
      return err(`unknown key "${key}" — allowed: ${API_TYPES.join(", ")}`);
    }
    const apiType = key as ApiType;
    if (typeof raw !== "string") {
      return err(`${key} must be a string model key (or "" to clear)`);
    }
    if (raw === "") {
      value[apiType] = ""; // clear-override sentinel, preserved for the caller
      continue;
    }
    if (!parseModelKeyStrict(raw)) {
      return err(`${key}="${raw}" is not a valid provider::modelId key`);
    }
    const entry = getCapabilityEntry(raw);
    if (!entry) return err(`${key}="${raw}" is not in the model catalog`);
    if (entry.apiType !== apiType) {
      return err(`${key}="${raw}" is a ${entry.apiType} model, not ${apiType}`);
    }
    value[apiType] = raw;
  }
  return { ok: true, value };
}

// Pure helper for PATCH /api/projects/:id — the project layer of the 3-layer
// resolver (design doc 2026-07-19-provider-model-defaults, PR3). Unlike the user
// layer's PUT (which merges a patch into a stored row), the project route writes
// modelDefaults wholesale: the client always sends the full desired object. This
// helper validates that object with the shared validateDefaultsPatch, then strips
// any ""-valued (clear-override sentinel) keys before persisting — the project
// layer should only ever store real overrides, never explicit "unset" markers,
// so the resolver's isLegalForSlot never has to see them.
import { validateDefaultsPatch, type ModelDefaults, type DefaultsPatchErr } from "./resolve";

export interface SanitizeOk {
  ok: true;
  value: Partial<ModelDefaults>;
}

export function sanitizeProjectModelDefaults(patch: unknown): SanitizeOk | DefaultsPatchErr {
  const parsed = validateDefaultsPatch(patch);
  if (!parsed.ok) return parsed;

  const value: Partial<ModelDefaults> = {};
  for (const [key, v] of Object.entries(parsed.value) as [keyof ModelDefaults, string][]) {
    if (v !== "") value[key] = v;
  }
  return { ok: true, value };
}

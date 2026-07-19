// Pure helpers for the user model-defaults API. Kept free of Next/Prisma so the
// merge semantics are unit-testable in isolation (mirrors lib/user/provider-keys).
import type { ModelDefaults } from "@/lib/model-defaults/resolve";

// Apply a validated patch to the stored user defaults. validateDefaultsPatch has
// already vetted every value; here we only fold the patch in:
//   - "" (the clear-override sentinel) DELETES that slot, so the resolver falls
//     back to the system layer instead of persisting an empty string,
//   - any other value overwrites the slot,
//   - slots absent from the patch are left untouched.
// Returns a fresh object (never mutates `existing`).
export function mergeUserDefaults(
  existing: Partial<ModelDefaults>,
  patch: Partial<ModelDefaults>,
): Partial<ModelDefaults> {
  const merged: Partial<ModelDefaults> = { ...existing };
  for (const [key, value] of Object.entries(patch) as [keyof ModelDefaults, string][]) {
    if (value === "") {
      delete merged[key]; // clear → absent, not ""
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

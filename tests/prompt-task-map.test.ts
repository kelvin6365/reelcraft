import { describe, expect, it } from "vitest";
import { listCatalog } from "@/lib/prompts/build-prompt";
import { PROMPT_TASK } from "@/lib/prompts/prompt-task-map";
import { TASK_TYPE } from "@/lib/task/types";

const REAL_STAGES = new Set(["input", "assets", "script", "storyboard", "images", "videos", "voice", "export"]);
const REAL_TASK_TYPES = new Set(Object.values(TASK_TYPE));

describe("PROMPT_TASK exhaustiveness", () => {
  it("has an entry for every catalog prompt id", () => {
    for (const entry of listCatalog()) {
      expect(PROMPT_TASK[entry.id], `missing PROMPT_TASK entry for ${entry.id}`).toBeDefined();
    }
  });

  it("does not have stale entries for ids no longer in the catalog", () => {
    const catalogIds = new Set(listCatalog().map((e) => e.id));
    for (const id of Object.keys(PROMPT_TASK)) {
      expect(catalogIds.has(id), `PROMPT_TASK has a stale entry for ${id}`).toBe(true);
    }
  });

  it("every taskType is a real TASK_TYPE value", () => {
    for (const [id, entry] of Object.entries(PROMPT_TASK)) {
      expect(REAL_TASK_TYPES.has(entry.taskType), `${id}: unknown taskType ${entry.taskType}`).toBe(true);
    }
  });

  it("every stage is a real StageKey value", () => {
    for (const [id, entry] of Object.entries(PROMPT_TASK)) {
      expect(REAL_STAGES.has(entry.stage), `${id}: unknown stage ${entry.stage}`).toBe(true);
    }
  });

  it("every scope is one of episode/project/shot", () => {
    for (const [id, entry] of Object.entries(PROMPT_TASK)) {
      expect(["episode", "project", "shot"], `${id}: unknown scope ${entry.scope}`).toContain(entry.scope);
    }
  });
});

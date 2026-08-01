import { describe, expect, it, vi, afterEach } from "vitest";
import { MAX_SHOT_CHARACTERS, warnCrowdedShots } from "@/lib/workers/handlers/text-handlers";

// 同框 ≥3 個角色實測必崩（換面、串衫），而下游每鏡最多只送 2 張角色參考圖。
// 規則寫喺 prompt，呢層**只留痕唔硬擋**：schema .max(2) 會令成個 scene 重試三次然後
// fail，重演「整集靜默殘缺」嗰條路。以下測試就係鎖住「放行 + 留痕」呢個決定。
describe("warnCrowdedShots", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays silent when every shot is within the cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const crowded = warnCrowdedShots("s1", [
      { index: 1, characters: [] },
      { index: 2, characters: ["夏牧"] },
      { index: 3, characters: ["夏牧", "阿May"] },
    ]);
    expect(crowded).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per crowded shot with scene id, shot index and character names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const crowded = warnCrowdedShots("scene-42", [
      { index: 1, characters: ["夏牧", "阿May"] },
      { index: 2, characters: ["夏牧", "阿May", "阿Ken", "老陳"] },
      { index: 3, characters: ["夏牧", "阿May", "阿Ken"] },
    ]);
    expect(crowded).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    const first = warn.mock.calls[0][0] as string;
    expect(first).toContain("scene-42");
    expect(first).toContain("shot=2");
    expect(first).toContain("老陳");
    expect(first).toContain(String(MAX_SHOT_CHARACTERS));
  });

  it("treats a missing characters field as empty rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnCrowdedShots("s1", [{ index: 1 }])).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never throws — a crowded shot must still be written, not fail the scene", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => warnCrowdedShots("s1", [{ index: 1, characters: ["a", "b", "c", "d", "e"] }])).not.toThrow();
  });
});

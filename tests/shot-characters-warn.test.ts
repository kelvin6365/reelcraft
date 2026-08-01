import { describe, expect, it, vi, afterEach } from "vitest";
import { MAX_SHOT_CHARACTERS, capCrowdedShots } from "@/lib/workers/handlers/text-handlers";

// 同框 ≥3 個角色實測必崩（換面、串衫、法杖掛錯人），而下游每鏡最多只送 2 張角色參考圖。
// 規則寫喺 prompt 但實測違反率 13.5%，所以呢層做**確定性降級**：截頭 2 個 + 剝走
// subject 提到被截角色嘅子句。但仍然唔准硬擋：schema .max(2) 會令成個 scene 重試三次
// 然後 fail，重演「整集靜默殘缺」嗰條路。以下測試鎖住「降級 + 放行 + 留痕」呢個決定。
describe("capCrowdedShots", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays silent and untouched when every shot is within the cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 1, characters: [], subject: "空鏡：雨後的巷口" },
      { index: 2, characters: ["夏牧"], subject: "夏牧推門而入" },
      { index: 3, characters: ["夏牧", "阿May"], subject: "夏牧同阿May對望" },
    ];
    expect(capCrowdedShots("s1", shots)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(shots[2].characters).toEqual(["夏牧", "阿May"]);
    expect(shots[2].subject).toBe("夏牧同阿May對望");
  });

  it("warns once per crowded shot with scene id, shot index and character names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const crowded = capCrowdedShots("scene-42", [
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
    expect(first).toContain("已降級");
  });

  it("truncates characters to the first two", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 5, characters: ["王楚", "李雪晴", "安吉拉", "艾琳"], subject: "王楚舉起藥水" }];
    capCrowdedShots("s1", shots);
    expect(shots[0].characters).toEqual(["王楚", "李雪晴"]);
  });

  it("strips subject clauses that mention a dropped character", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      {
        index: 5,
        characters: ["王楚", "李雪晴", "安吉拉", "艾琳"],
        subject: "王楚制作药水；安吉拉紧握法杖；艾琳扬头",
      },
    ];
    capCrowdedShots("s1", shots);
    expect(shots[0].subject).toBe("王楚制作药水");
  });

  it("leaves the subject alone when it never mentions a dropped character", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 5, characters: ["王楚", "李雪晴", "安吉拉"], subject: "王楚同李雪晴並肩站喺洞口" }];
    capCrowdedShots("s1", shots);
    expect(shots[0].subject).toBe("王楚同李雪晴並肩站喺洞口");
  });

  it("never leaves an empty subject when every clause mentions a dropped character", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 5, characters: ["王楚", "李雪晴", "安吉拉", "艾琳"], subject: "安吉拉紧握法杖，艾琳扬头" },
    ];
    capCrowdedShots("s1", shots);
    expect(shots[0].subject).toBe("王楚、李雪晴在場，畫面只影佢哋");
    expect(shots[0].subject).not.toBe("");
  });

  it("does not strip a kept character's clause when a dropped name is a substring of it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 5, characters: ["王楚天", "李雪晴", "王楚"], subject: "王楚天舉劍；李雪晴退後" },
    ];
    capCrowdedShots("s1", shots);
    expect(shots[0].subject).toBe("王楚天舉劍；李雪晴退後");
  });

  it("treats a missing characters field as empty rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(capCrowdedShots("s1", [{ index: 1 }])).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never throws — a crowded shot must still be written, not fail the scene", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => capCrowdedShots("s1", [{ index: 1, characters: ["a", "b", "c", "d", "e"] }])).not.toThrow();
  });

  it("never throws on a crowded shot with no subject at all", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, characters: ["a", "b", "c"] }];
    expect(() => capCrowdedShots("s1", shots)).not.toThrow();
    expect(shots[0].characters).toEqual(["a", "b"]);
  });
});

describe("capCrowdedShots — subject 提到但漏咗入 characters 嘅角色", () => {
  // 實測鏡 31：subject「陈琳娜看見門外的王楚」但 characters 只有 [陈琳娜]。
  // 王楚係真係要入鏡嘅，補返佢入去先攞到參考圖；剝走佢就拆散咗個鏡頭。
  it("adopts a subject-only character when there is room", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "陈琳娜看見門外的王楚，表情驚訝", characters: ["陈琳娜"] }];
    capCrowdedShots("s1", shots, ["陈琳娜", "王楚", "李雪晴"]);
    expect(shots[0].characters).toEqual(["陈琳娜", "王楚"]);
    expect(shots[0].subject).toBe("陈琳娜看見門外的王楚，表情驚訝");
  });

  // 實測鏡 3：模型自己寫 2 個 characters（守到 ≤2）但 subject 寫咗 5 個人。
  // cap 唔會觸發，所以舊版由頭到尾冇檢查過 subject —— 呢個就係「多咗三個唔知
  // 邊度嚟嘅雜兵」嘅根因。補唔落嘅一定要由 subject 剝走。
  it("strips subject-only characters when characters is already full", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 3, subject: "王楚上前；鄭夏雨、李雪晴、安吉拉對視後皺眉", characters: ["王楚", "鄭夏雨"] },
    ];
    capCrowdedShots("s1", shots, ["王楚", "鄭夏雨", "李雪晴", "安吉拉"]);
    expect(shots[0].characters).toEqual(["王楚", "鄭夏雨"]);
    expect(shots[0].subject).toBe("王楚上前");
  });

  it("leaves shots alone when subject only names listed characters", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "王楚低頭看手腕", characters: ["王楚"] }];
    expect(capCrowdedShots("s1", shots, ["王楚", "鄭夏雨"])).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(shots[0].characters).toEqual(["王楚"]);
  });
});

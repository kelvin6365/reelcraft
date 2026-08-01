import { describe, expect, it, vi } from "vitest";
import { filterAppearancePrompt, safeAppearancePrompt } from "@/lib/prompts/appearance-filter";

describe("filterAppearancePrompt — 剝走審查詞", () => {
  it("剝走實際撞板嗰句：露出许多皮肤（尤其是腰部）", () => {
    const raw = "二十岁少女，黑色长发，红色改良旗袍，露出许多皮肤（尤其是腰部），腰间挂着玉佩";
    const { text, removed } = filterAppearancePrompt(raw);
    expect(text).not.toContain("皮肤");
    expect(removed).toContain("露出许多皮肤（尤其是腰部）");
    // 身份錨全部保住
    expect(text).toContain("黑色长发");
    expect(text).toContain("红色改良旗袍");
    expect(text).toContain("腰间挂着玉佩");
  });

  it("剝句之後唔會留低孤兒逗號", () => {
    const { text } = filterAppearancePrompt("黑色长发，露出许多皮肤，红色旗袍");
    expect(text).toBe("黑色长发，红色旗袍");
  });

  it("句首就係審查句時，唔會留低前導標點", () => {
    const { text } = filterAppearancePrompt("裸露上身，肌肉线条分明");
    expect(text).toBe("肌肉线条分明");
  });

  it("捉到各種裸露措辭", () => {
    for (const bad of ["半裸", "赤裸上身", "衣不蔽体", "事业线明显", "乳沟", "袒露腹部", "大面积露肤"]) {
      const { removed } = filterAppearancePrompt(`黑色长发，${bad}，红色旗袍`);
      expect(removed, bad).toHaveLength(1);
    }
  });

  it("捉到英文措辭", () => {
    for (const bad of ["revealing outfit", "scantily clad", "exposed midriff", "deep cleavage", "skimpy top"]) {
      const { removed } = filterAppearancePrompt(`black long hair, ${bad}, red qipao`);
      expect(removed, bad).toHaveLength(1);
    }
  });
});

describe("filterAppearancePrompt — 只刮形容詞，保住整句", () => {
  it("『性感的黑色旗袍』只掉『性感的』，旗袍留低", () => {
    const { text, removed } = filterAppearancePrompt("穿着性感的黑色旗袍");
    expect(text).toBe("穿着黑色旗袍");
    expect(removed).toContain("性感的");
  });

  it("英文形容詞同樣只刮走個詞", () => {
    const { text } = filterAppearancePrompt("a seductive red qipao with gold embroidery");
    expect(text).toBe("a red qipao with gold embroidery");
  });
});

describe("filterAppearancePrompt — 唔准誤傷正常外貌", () => {
  const clean = [
    "二十岁，黑色长发盘起，白色棉麻长裙，脚踩草鞋",
    "中年男性，灰白胡须，深蓝色劲装，腰佩长剑",
    "少年，短发，破旧粗布短打，赤脚，手臂有旧伤疤",
    "black long hair, silver hairpin, layered blue robe, leather boots",
    "皮肤白皙，眉目清秀，藕荷色襦裙",
  ];
  for (const s of clean) {
    it(`原封不動：${s}`, () => {
      const { text, removed } = filterAppearancePrompt(s);
      expect(removed).toEqual([]);
      expect(text).toBe(s);
    });
  }

  it("空字串安全", () => {
    expect(filterAppearancePrompt("")).toEqual({ text: "", removed: [] });
  });

  it("全句都係審查詞時返空字串，唔會拋錯", () => {
    expect(filterAppearancePrompt("裸露皮肤").text).toBe("");
  });
});

describe("safeAppearancePrompt", () => {
  it("剝到嘢就 console.warn 留痕，帶住 label", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = safeAppearancePrompt("郑夏雨", "黑色长发，露出许多皮肤，红色旗袍");
    expect(out).toBe("黑色长发，红色旗袍");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("郑夏雨");
    spy.mockRestore();
  });

  it("冇嘢剝就唔嘈", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(safeAppearancePrompt("张三", "灰白胡须，深蓝色劲装")).toBe("灰白胡须，深蓝色劲装");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

import { describe, expect, it } from "vitest";
import {
  auditShotPrompt,
  dropOrphanRefs,
  hasIssues,
  missingCharacterNames,
  referencedImageIndexes,
} from "@/lib/prompts/shot-prompt-audit";

const ref = (label: string) => ({ label });

describe("referencedImageIndexes", () => {
  it("認到 Image N，唔理空格", () => {
    expect(referencedImageIndexes("王楚（Image 3 中的黑髮少年）同 Image1 對望")).toEqual(new Set([3, 1]));
  });

  it("唔會把 Image 當成編號嘅字認錯", () => {
    expect(referencedImageIndexes("reference images only, no Images here")).toEqual(new Set());
  });
});

describe("dropOrphanRefs", () => {
  it("全部有引用就原樣返回", () => {
    const refs = [ref("場景"), ref("鄭夏雨"), ref("王楚")];
    const out = dropOrphanRefs("Image 1 背景，Image 2 企右，Image 3 企左", refs);
    expect(out.droppedLabels).toEqual([]);
    expect(out.refs).toHaveLength(3);
    expect(out.prompt).toContain("Image 3");
  });

  // 鏡 25 實測事故：郑夏雨（Image 2）完全冇喺 prompt 出現，張金髮紅甲身份圖照樣送咗出去，
  // 生圖模型攞去貼咗四次落「幾名女性隊員」度。
  it("剝走孤兒參考圖，並把餘下嘅重新編號", () => {
    const refs = [ref("巢穴外"), ref("鄭夏雨"), ref("王楚")];
    const out = dropOrphanRefs("Image 1 嘅巢穴外，王楚（Image 3 中的黑髮黑瞳少年）抬手", refs);

    expect(out.droppedLabels).toEqual(["鄭夏雨"]);
    expect(out.refs.map((r) => r.label)).toEqual(["巢穴外", "王楚"]);
    // 王楚由第 3 張變成送出去嘅第 2 張，prompt 要跟住改，否則由「指錯人」變「指去空氣」
    expect(out.prompt).toBe("Image 1 嘅巢穴外，王楚（Image 2 中的黑髮黑瞳少年）抬手");
  });

  it("重新編號係單次替換，唔會連鎖改寫", () => {
    const refs = [ref("a"), ref("b"), ref("c"), ref("d")];
    // 保留 2、4 → 應該變成 1、2；如果逐個 index 循環替換，2→1 之後 4→2 會再被當成 2 改一次
    const out = dropOrphanRefs("先睇 Image 2，再睇 Image 4", refs);
    expect(out.prompt).toBe("先睇 Image 1，再睇 Image 2");
    expect(out.refs.map((r) => r.label)).toEqual(["b", "d"]);
  });

  it("記低模型作出嚟、根本唔存在嘅編號", () => {
    const refs = [ref("場景")];
    const out = dropOrphanRefs("Image 1 背景，Image 5 個角色", refs);
    expect(out.strayIndexes).toEqual([5]);
    expect(out.droppedLabels).toEqual([]);
  });

  it("一個都冇引用就全部剝走", () => {
    const refs = [ref("場景"), ref("王楚")];
    const out = dropOrphanRefs("一個少年抬起手", refs);
    expect(out.refs).toEqual([]);
    expect(out.droppedLabels).toEqual(["場景", "王楚"]);
  });
});

describe("missingCharacterNames", () => {
  it("揀出完全冇出現嘅角色名", () => {
    expect(missingCharacterNames("王楚抬手，鄭夏雨企喺右邊", ["王楚", "鄭夏雨", "李雪晴"])).toEqual(["李雪晴"]);
  });

  it("空名唔計", () => {
    expect(missingCharacterNames("王楚抬手", ["", "  "])).toEqual([]);
  });
});

describe("auditShotPrompt", () => {
  it("孤兒圖同漏寫角色分開報", () => {
    const refs = [ref("場景"), ref("鄭夏雨")];
    const issues = auditShotPrompt("Image 1 巢穴外，王楚抬手", refs, ["陳阿姨"], { checkNames: true });
    expect(issues.orphanLabels).toEqual(["鄭夏雨"]);
    expect(issues.missingNames).toEqual(["陳阿姨"]);
    expect(hasIssues(issues)).toBe(true);
  });

  // 英文輸出之下角色名寫成羅馬拼音（Zheng Xiayu），中文名一定 miss —— 逐個當成漏寫
  // 就會無限重試。有參考圖嗰批照樣靠 Image N 守住，語言無關。
  it("checkNames=false 時唔做名比對", () => {
    const refs = [ref("Zheng Xiayu")];
    const issues = auditShotPrompt("Zheng Xiayu (Image 1) raises her sword", refs, ["陳阿姨"], { checkNames: false });
    expect(issues.missingNames).toEqual([]);
    expect(issues.orphanLabels).toEqual([]);
    expect(hasIssues(issues)).toBe(false);
  });
});

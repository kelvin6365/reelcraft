import { describe, expect, it, vi, afterEach } from "vitest";
import { anonymizeCrowdSubjects, capCrowdedShots, collapseMultiMomentShots } from "@/lib/workers/handlers/text-handlers";

// 單幀生圖模型冇時間軸：subject 塞咗兩個時刻，模型唯一嘅出路就係並排畫入同一張圖
// （實測鏡 16 出 2×2 拼貼）。prompt 明文禁止但同 ≤2 上限一樣擋唔住，所以呢層做確定性
// 剝除。同 capCrowdedShots 一樣：降級 + 放行 + 留痕，唔准 throw、唔准令 scene fail。
describe("collapseMultiMomentShots", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays silent and untouched on a single-moment subject", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 1, subject: "王楚低頭看手腕", characters: ["王楚"] },
      { index: 2, subject: "雨後的巷口，地上一攤積水", characters: [] },
    ];
    expect(collapseMultiMomentShots("s1", shots, ["王楚"])).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(shots[0].subject).toBe("王楚低頭看手腕");
  });

  // 同一刻嘅兩個細節（A 做緊咩、B 做緊咩）唔係兩個時刻 —— 斬走就係無端刪戲。
  // 呢個 case 界定咗「保留第一個子句」唔可以無條件執行。
  it("keeps every clause when they describe one moment shared by two characters", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "王楚舉劍；李雪晴退後半步", characters: ["王楚", "李雪晴"] }];
    expect(collapseMultiMomentShots("s1", shots, ["王楚", "李雪晴"])).toBe(0);
    expect(shots[0].subject).toBe("王楚舉劍；李雪晴退後半步");
  });

  it("cuts everything from the first temporal connective onwards", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 7, subject: "王楚把藥水倒入瓶中，隨後在副本門口舉起長劍", characters: ["王楚"] }];
    expect(collapseMultiMomentShots("scene-9", shots, ["王楚"])).toBe(1);
    expect(shots[0].subject).toBe("王楚把藥水倒入瓶中");
    const first = warn.mock.calls[0][0] as string;
    expect(first).toContain("scene-9");
    expect(first).toContain("shot=7");
    expect(first).toContain("只保留第一個瞬間");
  });

  // 「兩年之後」係時間狀語唔係時序連接：喺句中間切落去只會剩返「兩年」。
  it("does not cut at a temporal word that is not at a clause boundary", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "兩年之後的王楚站在排行榜前", characters: ["王楚"] }];
    expect(collapseMultiMomentShots("s1", shots, ["王楚"])).toBe(0);
    expect(shots[0].subject).toBe("兩年之後的王楚站在排行榜前");
  });

  // 實測鏡 16：「夏雨战队」唔係已知角色名，adoptSubjectOnlyCharacters 捉唔到，
  // 冇參考圖 → 模型作咗四個一模一樣嘅金髮騎士。
  it("drops a crowd-noun clause that names nobody in the shot", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 16, subject: "王楚制作药水和附魔；夏雨战队在副本中胜利", characters: ["王楚"] }];
    expect(collapseMultiMomentShots("s1", shots, ["王楚"])).toBe(1);
    expect(shots[0].subject).toBe("王楚制作药水和附魔");
  });

  // 群眾同在鏡角色喺同一句 = 同一個畫面，唔係另一個時刻；交畀生圖 prompt 嘅
  // 「無名群眾」規則處理成遠景／背影／失焦剪影就夠。
  it("keeps a crowd-noun clause when a known character shares it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "王楚站在人群前方，眾人在他背後歡呼", characters: ["王楚"] }];
    expect(collapseMultiMomentShots("s1", shots, ["王楚"])).toBe(0);
  });

  it("never drops the first clause, even when it is a crowd-noun clause", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "夏雨戰隊在副本中勝利", characters: [] }];
    expect(collapseMultiMomentShots("s1", shots, ["王楚"])).toBe(0);
    expect(shots[0].subject).toBe("夏雨戰隊在副本中勝利");
  });

  it("never leaves an empty subject", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 1, subject: "，隨後夏雨戰隊慶祝", characters: [] },
      { index: 2, subject: "眾人歡呼；隊員們舉杯", characters: [] },
    ];
    collapseMultiMomentShots("s1", shots, []);
    expect(shots[0].subject).not.toBe("");
    expect(shots[1].subject).not.toBe("");
  });

  // 留低一個已經唔喺畫面嘅名 = 生圖照掛參考圖、照寫外貌，第二個時刻用另一種方式返嚟。
  it("drops characters that only appeared in the removed moment", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      { index: 3, subject: "王楚倒藥水，隨後李雪晴推門而入", characters: ["王楚", "李雪晴"] },
    ];
    collapseMultiMomentShots("s1", shots, ["王楚", "李雪晴"]);
    expect(shots[0].subject).toBe("王楚倒藥水");
    expect(shots[0].characters).toEqual(["王楚"]);
  });

  it("keeps a character whose name is a substring of a surviving name", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 3, subject: "王楚天舉劍，隨後眾人退場", characters: ["王楚天", "王楚"] }];
    collapseMultiMomentShots("s1", shots, ["王楚天", "王楚"]);
    expect(shots[0].characters).toEqual(["王楚天", "王楚"]);
  });

  it("never throws on missing subject or characters", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => collapseMultiMomentShots("s1", [{ index: 1 }, { index: 2, subject: "" }])).not.toThrow();
    expect(() =>
      collapseMultiMomentShots("s1", [{ index: 3, subject: "王楚倒藥水，隨後眾人歡呼" }]),
    ).not.toThrow();
  });
});

// 兩個函數都改 subject，次序有實質分別：先縮瞬間，cap 就唔會用 ≤2 個名額其中一個
// 去補一個只存在於「第二個時刻」嘅角色。
describe("collapseMultiMomentShots → capCrowdedShots 次序", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not spend a character slot on someone who only exists in the dropped moment", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const known = ["王楚", "李雪晴", "安吉拉"];
    const shots = [{ index: 1, subject: "王楚倒藥水，隨後李雪晴同安吉拉喺門口對望", characters: ["王楚"] }];
    collapseMultiMomentShots("s1", shots, known);
    capCrowdedShots("s1", shots, known);
    expect(shots[0].subject).toBe("王楚倒藥水");
    expect(shots[0].characters).toEqual(["王楚"]);
  });

  it("still caps and strips when the surviving moment is over the character limit", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const known = ["王楚", "李雪晴", "安吉拉"];
    const shots = [
      {
        index: 2,
        subject: "王楚上前；李雪晴皺眉；安吉拉握杖。隨後夏雨戰隊慶祝",
        characters: ["王楚", "李雪晴", "安吉拉"],
      },
    ];
    collapseMultiMomentShots("s1", shots, known);
    capCrowdedShots("s1", shots, known);
    expect(shots[0].characters).toEqual(["王楚", "李雪晴"]);
    expect(shots[0].subject).toBe("王楚上前；李雪晴皺眉");
  });
});

// 集體名詞喺第一個子句嗰陣，keepFirstMoment 一定唔會剝（第一子句係「subject 唔會變空」
// 嘅結構性保證）。所以要有第三層：改寫個名詞，唔郁句戲。
describe("anonymizeCrowdSubjects", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rewrites the crowd noun in the FIRST clause — the one collapse can never strip", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [
      {
        index: 16,
        subject: "王楚的想象：夏雨战队在副本中不断胜利的画面，王楚在后方提供支持",
        characters: ["王楚"],
      },
    ];
    expect(anonymizeCrowdSubjects("s1", shots, ["王楚", "陈琳娜"])).toBe(1);
    expect(shots[0].subject).toContain("夏雨战队"); // 原句保留，指令另外附加
    expect(shots[0].subject).toContain("看不清面孔");
    // 改寫唔係刪除：兩截真戲都要仲喺度
    expect(shots[0].subject).toContain("王楚的想象");
    expect(shots[0].subject).toContain("王楚在后方提供支持");
    expect(warn.mock.calls[0][0]).toContain("shot=16");
  });

  it("leaves crowd nouns alone when they map to a locked asset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "夏雨战队举杯", characters: [] }];
    expect(anonymizeCrowdSubjects("s1", shots, ["夏雨战队"])).toBe(0);
    expect(shots[0].subject).toBe("夏雨战队举杯");
    expect(warn).not.toHaveBeenCalled();
  });

  it("catches bare and quantified crowd nouns", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const bad of ["王楚看着众人", "一群士兵冲上来", "幾名玩家在旁邊", "人群散開", "村民围观"]) {
      const shots = [{ index: 1, subject: bad, characters: [] }];
      expect(anonymizeCrowdSubjects("s1", shots, ["王楚"]), bad).toBe(1);
      expect(shots[0].subject, bad).toContain("看不清面孔");
    }
  });

  it("stays silent on a subject with no crowd noun", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "王楚低頭看手腕", characters: ["王楚"] }];
    expect(anonymizeCrowdSubjects("s1", shots, ["王楚"])).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  // 同前兩層一樣嘅硬性保證：鏡頭寧願降級都一定要寫得入 DB。
  it("never throws — a crowd-only shot must still be written, not fail the scene", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1 }, { index: 2, subject: "" }, { index: 3, subject: "众人" }];
    expect(() => anonymizeCrowdSubjects("s1", shots, [])).not.toThrow();
    expect(shots[2].subject).toBeTruthy();
  });
});

describe("anonymizeCrowdSubjects — 引號內唔郁", () => {
  // 實測鏡 33：subject「王楚的腕表上顯示『您已被踢出夏雨戰隊』的訊息」，舊版盲目換咗
  // 引號入面嗰個「戰隊」，砌出「您已被踢出夏雨遠處數個看不清面孔的模糊身影」呢句廢話。
  // 引號內係被引述嘅文字（系統訊息／對白／招牌），唔係畫面上企緊嘅人。
  it("leaves crowd nouns inside quotes untouched", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const subject = "王楚的腕表上顯示「您已被踢出夏雨戰隊」的訊息";
    const shots = [{ index: 1, subject, characters: ["王楚"] }];
    expect(anonymizeCrowdSubjects("s1", shots, ["王楚", "郑夏雨"])).toBe(0);
    expect(shots[0].subject).toBe(subject);
  });

  // 引號外照樣要改寫，而且要連前綴一齊食走 —— 舊版個 lookbehind 令「夏雨戰隊」淨係
  // 換到「戰隊」，剩返「夏雨」黐喺改寫句前面。
  it("replaces the whole team name outside quotes, not just the head noun", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const shots = [{ index: 1, subject: "夏雨戰隊在副本中不斷勝利", characters: [] as string[] }];
    expect(anonymizeCrowdSubjects("s1", shots, ["王楚"])).toBe(1);
    expect(shots[0].subject).toContain("夏雨戰隊在副本中不斷勝利");
    expect(shots[0].subject).toContain("看不清面孔");
  });
});

// 原文相鄰兩個命中（「幾名女性隊員」= 「幾名」＋「女性隊員」）唔可以貼出兩句改寫。
// 實測鏡 31：「…遠處數個看不清面孔的模糊身影遠處數個看不清面孔的模糊身影之間…」
it("collapses adjacent duplicate crowd replacements", () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const shots = [{ index: 1, subject: "幾名女性隊員之間的魔法鏈接破碎", characters: [] as string[] }];
  anonymizeCrowdSubjects("s1", shots, ["王楚"]);
  expect(shots[0].subject).toContain("幾名女性隊員之間的魔法鏈接破碎");
  expect((shots[0].subject!.match(/看不清面孔/g) ?? []).length).toBe(1);
});

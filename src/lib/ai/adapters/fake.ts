// Deterministic fake text adapter for tests/offline dev — never available in production.
// With meta.promptId it returns schema-valid canned JSON so the whole pipeline can
// run end-to-end without API keys (anchors won't match → handlers use fallbacks).
// Only call-model.ts may import this (guard: no-ai-bypass).
import type { AdapterMeta, TextAdapter, TextRequest, TextResult } from "@/lib/ai/types";

const canned: Record<string, unknown> = {
  episode_split: {
    // anchors match the standard smoke novel (雨夜咖啡店) so offline slicing yields
    // real multi-episode output; ep 2 is intentionally flagged for review-by-exception.
    episodes: [
      {
        index: 1,
        title: "雨夜重逢",
        startAnchor: "雨夜，林知夏推開咖啡店的門",
        endAnchor: "路上有事。",
        summary: "林知夏冒雨赴約，與陳沉在咖啡店重逢",
        hook: "兩人之間的沉默，藏著未說的過去",
        risk: { level: "ok", flags: [], note: "" },
      },
      {
        index: 2,
        title: "兩清",
        startAnchor: "沉默在兩人之間蔓延",
        endAnchor: "很久都沒有動。",
        summary: "林知夏拿出文件要求了斷，陳沉遲疑",
        hook: "他會不會簽？",
        risk: { level: "review", flags: ["too_short"], note: "偏短，可考慮合併" },
      },
    ],
  },
  extract_characters: {
    characters: [
      { name: "林知夏", aliases: [], level: "lead", appearance: "二十多歲女性，及肩黑髮，眼神倔強，白色襯衫", wardrobe: "白襯衫深色長褲", note: "", age: "26歲", occupation: "編輯", personality: "外冷內熱，嘴硬心軟", painPoint: "怕再一次被重要的人放棄", backstory: "三年前與陳沉不辭而別，此後獨自在城市打拼。" },
      { name: "陳沉", aliases: [], level: "supporting", appearance: "三十歲男性，短髮，灰色大衣，神情疏離", wardrobe: "灰大衣", note: "", age: "30歲", occupation: "建築師", personality: "沉默寡言，習慣把虧欠藏在心裡", painPoint: "說不出口的愧疚", backstory: "當年為家事遠走，欠林知夏一個解釋。" },
    ],
  },
  extract_locations: {
    locations: [{ name: "咖啡店", timeOfDay: "夜", description: "昏黃燈光的小咖啡店，窗外有雨", note: "" }],
  },
  extract_props: {
    props: [
      {
        name: "玉佩",
        tier: "key",
        description: "溫潤羊脂白玉雕成的圓形玉佩，邊緣刻有纏枝紋，繫著暗紅色絲繩",
        material: "羊脂白玉",
        dimensions: "直徑約5公分",
        note: "阿媽留低嘅信物",
        sceneName: "",
        physicalParams: "",
        views: [
          { label: "正面", prompt: "玉佩正面，纏枝紋清晰可見，暗紅絲繩自然垂落" },
          { label: "反面", prompt: "玉佩反面，光滑無紋，可見輕微天然瑕紋" },
          { label: "側面", prompt: "玉佩側面，展示厚度與弧度" },
          { label: "細節特寫", prompt: "邊緣纏枝紋雕工特寫，質感通透" },
        ],
      },
      {
        name: "咖啡杯",
        tier: "scene",
        description: "白瓷咖啡杯連碟，杯身簡約無花紋",
        material: "白瓷",
        dimensions: "口徑約8公分",
        note: "",
        sceneName: "咖啡店",
        physicalParams: "",
        views: [],
      },
      {
        name: "能量光球",
        tier: "effect",
        description: "掌心浮現嘅藍白色球狀能量光效，邊緣有細碎光粒散落",
        material: "",
        dimensions: "直徑約15公分",
        note: "",
        sceneName: "",
        physicalParams: "亮度高、藍白色漸層、持續約2秒、由掌心中心向外擴散並伴隨光粒飄散",
        views: [{ label: "靜態關鍵幀", prompt: "掌心懸浮嘅藍白色能量球，中心最亮，邊緣光粒逐漸消散" }],
      },
    ],
  },
  build_scenes: {
    scenes: [
      { index: 1, startAnchor: "@@s1@@", endAnchor: "@@e1@@", summary: "開場相遇", location: "咖啡店", timeOfDay: "夜" },
      { index: 2, startAnchor: "@@s2@@", endAnchor: "@@e2@@", summary: "衝突爆發", location: "咖啡店", timeOfDay: "夜" },
    ],
  },
  storyboard_plan: {
    blocking: {
      cameraAxis: "鏡頭一律在窗一側，不越軸",
      positions: [
        { name: "林知夏", screenSide: "left", facing: "面向畫面右", placement: "坐窗邊桌左側" },
        { name: "陳沉", screenSide: "right", facing: "面向畫面左", placement: "坐窗邊桌右側" },
      ],
      keyProps: ["桌上有咖啡杯", "桌中央有文件"],
    },
    shots: [
      { index: 1, source_text: "她推門走進咖啡店", subject: "林知夏推門入店", beat: "開場", characters: ["林知夏"], dialogue: "" },
      { index: 2, source_text: "他抬起頭", subject: "陳沉抬頭對視", beat: "對視", characters: ["陳沉"], dialogue: "" },
      { index: 3, source_text: "「你遲到了。」", subject: "林知夏開口", beat: "對白", characters: ["林知夏"], dialogue: "你遲到了。" },
    ],
  },
  storyboard_photography: {
    shots: [
      { index: 1, lighting: "暖黃側光", dof: "medium", focusFace: "", tone: "暖", note: "" },
      { index: 2, lighting: "窗外冷光", dof: "shallow", focusFace: "陳沉", tone: "冷", note: "" },
      { index: 3, lighting: "暖黃側光", dof: "shallow", focusFace: "林知夏", tone: "暖", note: "" },
    ],
  },
  storyboard_acting: {
    shots: [
      { index: 1, expression: "抿唇", bodyAction: "快步推門", eyeline: "直視前方", note: "" },
      { index: 2, expression: "微怔", bodyAction: "放下杯子抬頭", eyeline: "看向門口", note: "" },
      { index: 3, expression: "強裝平靜", bodyAction: "拉椅坐下", eyeline: "看向對方", note: "" },
    ],
  },
  storyboard_detail: {
    shots: [
      { index: 1, shotSize: "全景", angle: "平視", camera: "固定", video_prompt: "the young woman pushes the cafe door open and steps inside, static camera, single continuous shot, natural motion, no morphing", note: "" },
      { index: 2, shotSize: "近景", angle: "微仰", camera: "緩推", video_prompt: "the man in his thirties raises his head and meets her eyes, slow push in, speaking, single continuous shot, natural motion, no morphing", note: "" },
      { index: 3, shotSize: "中景", angle: "平視", camera: "固定", video_prompt: "the young woman sits down and speaks quietly, silent man across her, static camera, single continuous shot, natural motion, no morphing", note: "" },
    ],
  },
  voice_analyze: {
    lines: [
      { index: 1, text: "你遲到了。", speaker: "林知夏", lineType: "dialogue", cue: "壓低聲線", emotion: "壓抑的不滿", emotionStrength: 0.4, matchedShotIndex: 3 },
      { index: 2, text: "路上有事。", speaker: "陳沉", lineType: "dialogue", cue: "", emotion: "平淡", emotionStrength: 0.2, matchedShotIndex: 2 },
      { index: 3, text: "他遲到的理由，我其實早就知道了。", speaker: "林知夏", lineType: "vo", cue: "苦笑", emotion: "無奈", emotionStrength: 0.3, matchedShotIndex: 1 },
    ],
  },
  script_review: {
    scenes: [
      { index: 1, label: "第1場・咖啡店", risk: { level: "ok", flags: [], note: "" } },
      { index: 2, label: "第2場・咖啡店", risk: { level: "review", flags: ["weak_hook"], note: "結尾停在遞文件，建議補一句懸念" } },
    ],
    overall: { level: "review", flags: ["weak_hook"], note: "整體節奏穩，第2場結尾鉤子偏弱" },
  },
  image_prompt_shot: {
    prompt: "a young woman pushing open the door of a dim cozy cafe at night, warm side lighting, cinematic still",
    negativePrompt: "",
    referencedAssets: ["林知夏"],
  },
};

export const fakeAdapter: TextAdapter = {
  provider: "fake",

  async complete(req: TextRequest, _apiKey: string, meta?: AdapterMeta): Promise<TextResult> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const echo = lastUser?.content ?? "";

    let text: string;
    if (meta?.promptId && canned[meta.promptId]) {
      text = JSON.stringify(canned[meta.promptId]);
    } else if (meta?.promptId === "rewrite_script") {
      // 帶埋一行【廣播】：非人物聲源嘅方括號標記係劇本層契約（rewrite_script），
      // fake 模式行落去嘅分鏡／配音都要食到呢個格式先反映到真實 pipeline。
      text =
        "【第1場】咖啡店·夜\n林知夏推門而入，雨聲隨門縫灌進來。\n林知夏（壓低聲線）：「你遲到了。」\n陳沉：「路上有事。」\n【廣播】：本店將於十一時結業。\n林知夏（VO・苦笑）：他遲到的理由，我其實早就知道了。\n（兩人對視，沉默三秒）";
    } else {
      text = `[fake] ${echo.slice(0, 200)}`;
    }

    return {
      text,
      // providerCostUsd: 0 exercises the real-cost recording path for free.
      usage: { inputTokens: Math.ceil(echo.length / 4), outputTokens: Math.ceil(text.length / 4), cachedInputTokens: 0, providerCostUsd: 0 },
      providerRequestId: `fake-${Date.now()}`,
    };
  },
};

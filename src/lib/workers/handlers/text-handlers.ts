import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { callModel } from "@/lib/ai/call-model";
import { resolvePrompt } from "@/lib/prompts/resolve-prompt";
import { submitTask } from "@/lib/task/submit";
import { TASK_TYPE, TaskError } from "@/lib/task/types";
import { parseSrt } from "@/lib/srt";
import { matchReusableAudio } from "@/lib/voice/reuse-audio";
import { planResume } from "@/lib/storyboard/resume";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import {
  resolveTaskModels,
  loadEpisodeWithProject,
  sliceByAnchors,
  textCallJson,
  promptOverridesFromTask,
} from "@/lib/workers/handlers/shared";
import type { Character, Prisma } from "@prisma/client";
import { DEFAULT_CHARACTER_VIEWS } from "@/lib/prompts/character-views";

// 分鏡三個補完階段（攝影／表演／細節）各自獨立呼叫，逐鏡對應 plan 嘅 index。
// 模型少交鏡時下面會寫入 null，該鏡就冇布光／表演／景別依據 —— 生圖階段唯有自己作，
// 成集光影唔連戲。呢種缺口一直係完全靜默嘅，起碼要喺 worker log 見到。
function warnIncompleteStages(sceneId: string, planned: number, stages: [string, number][]): void {
  for (const [name, covered] of stages) {
    if (covered >= planned) continue;
    console.warn(
      `[storyboard] scene=${sceneId} ${name} 只覆蓋 ${covered}/${planned} 鏡 — ` +
        `欠嗰 ${planned - covered} 鏡會寫入 null，生圖冇依據`,
    );
  }
}

// 每鏡同框角色上限。參考圖生圖模型同時綁定 3 個以上人物身份就會屬性互相污染，
// 而 buildShotRefAssets 本身最多只送 2 張角色參考圖 —— 第 3 個角色根本冇圖可依。
// prompt 已經明文寫死 ≤2，但實測違反率 13.5%（5/37 鏡），軟約束擋唔住，所以呢層做
// **確定性降級**：截頭 2 個 + 剝走 subject 入面提到被截角色嘅子句。
// 唔准 throw、唔准令 scene fail —— schema .max(2) 會令成個 scene 重試三次然後 fail，
// 重演「整集靜默殘缺」嗰條路。降級 + 留痕，鏡頭一定要寫得入 DB。
export const MAX_SHOT_CHARACTERS = 2;

// subject 嘅子句分隔符。storyboard_plan 明文要求用「；」分隔（禁止換行），
// 但模型偶爾會用半形 ; 或者句號，一併當分隔符處理。
const SUBJECT_CLAUSE_SEPARATOR = /[；;。]/;

interface CappableShot {
  index: number;
  subject?: string;
  characters?: string[];
}

// 由 subject 剝走提到 dropped 角色嘅子句。三層降級，保證唔會回傳空字串：
// ① 淨低唔提 dropped 角色嘅子句 → 直接接返；
// ② 全部子句都提到 dropped（例如單子句「安吉拉紧握法杖，艾琳扬头」）→ 用保留角色
//    砌一句最低限度、唔會憑空作人嘅 subject；
// ③ 連保留角色都冇（理論上唔會，characters > 2 先會行到呢度）→ 原句照留。
function stripDroppedFromSubject(subject: string, dropped: string[], kept: string[]): string {
  const original = subject.trim();
  // 被截角色名如果係保留角色名嘅一部分（「王楚」vs「王楚天」），用 includes 會誤剝
  // 保留角色嗰句戲 —— 呢類名唔可以攞嚟做剝除依據。
  const strippable = dropped.filter((name) => name.length > 0 && !kept.some((k) => k !== name && k.includes(name)));
  if (!original || strippable.length === 0) return original;

  const survivors = original
    .split(SUBJECT_CLAUSE_SEPARATOR)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !strippable.some((name) => clause.includes(name)));
  if (survivors.length > 0) return survivors.join("；");

  if (kept.length > 0) return `${kept.join("、")}在場，畫面只影佢哋`;
  return original;
}

// subject 提到咗但冇入 characters 嘅角色 → 補返入去（仲有位嘅話）。
//
// 點解要補而唔係一律剝：實測鏡 31 subject 係「陈琳娜看見門外的王楚，表情驚訝」而
// characters 只有 [陈琳娜]。王楚係真係要入鏡嘅，剝走佢就拆散咗個鏡頭；補返佢入
// characters 反而令佢攞到參考圖。淨係喺補唔落（已經滿 2 個）先至交畀下面剝走。
//
// ⚠️ 呢個補位一定要喺 cap 之前行：模型自己寫 2 個 characters 但 subject 寫 5 個人
// 嗰陣（實測鏡 3），cap 唔會觸發，subject 就永遠冇被檢查過——而生圖 prompt 照樣會
// 叫模型畫嗰 5 個人，冇參考圖嘅就憑空作。呢個正正係「多咗三個唔知邊度嚟嘅雜兵」嘅根因。
function adoptSubjectOnlyCharacters(shot: CappableShot, known: string[]): string[] {
  const subject = shot.subject ?? "";
  const current = shot.characters ?? [];
  if (!subject) return [];
  const mentioned = known.filter((n) => n.length > 0 && subject.includes(n) && !current.includes(n));
  if (mentioned.length === 0) return [];
  const room = Math.max(0, MAX_SHOT_CHARACTERS - current.length);
  const adopted = mentioned.slice(0, room);
  if (adopted.length > 0) shot.characters = [...current, ...adopted];
  // 補唔落嘅照樣要交出去——下面會連同佢哋喺 subject 嘅子句一齊剝走。
  return mentioned.slice(room);
}

// 回傳被降級（characters 超標或 subject 提到參考圖外角色）嘅鏡頭數。shots 就地改寫。
// known = 本 project 已知角色名，用嚟認出 subject 入面「有名有姓但冇入 characters」嗰啲。
export function capCrowdedShots(sceneId: string, shots: CappableShot[], known: string[] = []): number {
  let crowded = 0;
  for (const shot of shots) {
    const orphans = adoptSubjectOnlyCharacters(shot, known);
    const names = shot.characters ?? [];
    if (names.length <= MAX_SHOT_CHARACTERS && orphans.length === 0) continue;
    crowded++;

    const kept = names.slice(0, MAX_SHOT_CHARACTERS);
    const dropped = [...names.slice(MAX_SHOT_CHARACTERS), ...orphans];
    shot.characters = kept;

    const before = shot.subject ?? "";
    const after = stripDroppedFromSubject(before, dropped, kept);
    if (after !== before) shot.subject = after;

    console.warn(
      `[storyboard] scene=${sceneId} shot=${shot.index} 已降級（上限 ${MAX_SHOT_CHARACTERS}）：characters=${names.join("、") || "（空）"}` +
        (orphans.length > 0 ? `，subject 另外提到參考圖外嘅 ${orphans.join("、")}` : "") +
        ` — 保留 ${kept.join("、") || "（無）"}，剝走 ${dropped.join("、")}` +
        (after === before ? "（subject 冇提到佢哋，原文保留）" : `，subject 改寫為「${after}」`),
    );
  }
  return crowded;
}

// 時序連接詞：明確表示「跟住先發生」。單幀生圖模型冇時間軸，收到兩個時刻就唯有把
// 兩個時刻並排畫入同一張圖 —— 實測鏡 16 出咗個 2×2 格拼貼，而拼貼喺短劇入面係廢鏡
// （剪唔入、i2v 動唔到、連唔到戲）。生圖 prompt 尾嗰句 `not a character sheet, grid
// or collage` 完全擋唔住，因為 prompt 自己就要求咗兩件事。
//
// 必須跟住一個標點先當時序詞：「兩年之後」呢類係時間狀語唔係時序連接，喺句中間切
// 落去只會剩返「兩年」呢種爛頭。同樣理由唔收「再」——「再次確認」「一再退讓」全部
// 係同一刻，收咗誤傷率太高；「再」留畀 prompt 層軟性禁止就夠。
const TEMPORAL_CUT =
  /[，,、；;。]\s*(?:隨後|随后|然後|然后|之後|之后|其後|其后|接著|接着|接住|跟住|稍後|稍后|後來|后来|繼而|继而)/;

// 集體名詞：呢類「人」冇對應資產、冇參考圖，模型一定會憑空作 —— 實測「夏雨战队」
// 出咗四個一模一樣嘅金髮騎士（用戶原話：多左 3 個唔知乜水），而下一鏡又係另一批樣。
// adoptSubjectOnlyCharacters 捉唔到佢哋，因為佢淨係認 project 已知角色名。
const CROWD_NOUN =
  /(戰隊|战队|隊伍|队伍|隊員|队员|眾人|众人|大家|人群|一群|幾名|几名|數名|数名|村民|士兵|守衛|守卫|圍觀|围观|們|们)/;

// 由 subject 剝走「第一個瞬間」以外嘅嘢，兩刀：
// ① 時序詞之後全部剝走 —— 嗰啲係第二個時刻。
// ② 提到集體名詞、但一個已知角色都冇提嘅**非首個**子句剝走 —— 呢類子句幾乎一定係
//    另一組人喺另一個地方做緊另一件事（「…；夏雨战队在副本中胜利」）。
//
// 第一個子句永遠留低：呢個係「subject 唔可以變空」嘅結構性保證，唔使靠 fallback 句。
// 注意呢度**唔會**淨係「保留第一個子句」—— 「王楚舉劍；李雪晴退後」係同一刻嘅兩個
// 細節，斬咗就係無端刪戲。分辨準則係「呢個子句講緊另一組人／另一刻」，唔係「有冇；」。
function keepFirstMoment(subject: string, known: string[]): string {
  const cut = TEMPORAL_CUT.exec(subject);
  const head = cut ? subject.slice(0, cut.index).trim() : subject;
  const base = head.length > 0 ? head : subject;

  const clauses = base
    .split(SUBJECT_CLAUSE_SEPARATOR)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const survivors = clauses.filter(
    (clause, i) => i === 0 || !(CROWD_NOUN.test(clause) && !known.some((n) => n.length > 0 && clause.includes(n))),
  );
  // 冇剝到子句就唔好重砌字串：split/join 會把「。」正規化成「；」，淨係咁就當改咗，
  // 會出一條誤導人嘅 warn。
  if (survivors.length === clauses.length) return cut ? base : subject;
  return survivors.join("；");
}

// subject 縮到第一個瞬間之後，只喺被剝走嗰段出現過嘅角色要一齊由 characters 除名。
// 點解一定要做：buildShotRefAssets 係照 characters 掛參考圖，而生圖 prompt 明文要求
// 「本鏡每個出鏡角色都要寫外貌」—— 留低一個已經唔喺畫面嘅名，等於叫模型把佢畫返
// 入去，第二個時刻就用另一種方式返嚟。
// 名字互為子串（「王楚」vs「王楚天」）時 after.includes 會判成仍在場，方向保守（留低），
// 可接受：多一張參考圖遠好過剝走一個真係喺畫面嘅角色。
// characters 可以被清空 —— 空 characters 係合法嘅空鏡／物件鏡，唔係錯誤。
function pruneVanishedCharacters(shot: CappableShot, before: string, after: string): string[] {
  const names = shot.characters ?? [];
  const gone = names.filter((n) => n.length > 0 && before.includes(n) && !after.includes(n));
  if (gone.length === 0) return [];
  shot.characters = names.filter((n) => !gone.includes(n));
  return gone;
}

// 回傳被縮成單一瞬間嘅鏡頭數。shots 就地改寫。
//
// ⚠️ 必須喺 capCrowdedShots **之前**行。兩者都會改 subject，次序有實質分別：
// 先縮瞬間，capCrowdedShots 嘅 adoptSubjectOnlyCharacters 就唔會攞 ≤2 個名額嘅其中
// 一個去補一個只存在於「第二個時刻」嘅角色（補完個鏡頭都唔會出現佢），而剝除亦只需
// 要處理真係喺畫面嗰段文字。倒轉次序嘅話 cap 會對住一段之後會被刪走嘅文字做決定。
// 兩者嘅剝除邏輯亦唔重疊：cap 剝「參考圖外嘅已知角色」，呢度剝「另一個時刻／無名群眾」。
//
// 同 capCrowdedShots 一樣：唔准 throw、唔准令 scene fail。鏡頭寧願降級都一定要寫得入
// DB —— 硬擋只會令成個 scene 重試三次然後 fail，重演「整集靜默殘缺」嗰條路。
export function collapseMultiMomentShots(sceneId: string, shots: CappableShot[], known: string[] = []): number {
  let collapsed = 0;
  for (const shot of shots) {
    const before = (shot.subject ?? "").trim();
    if (!before) continue;
    const after = keepFirstMoment(before, known);
    if (after === before || after.length === 0) continue;
    collapsed++;
    shot.subject = after;
    const gone = pruneVanishedCharacters(shot, before, after);
    console.warn(
      `[storyboard] scene=${sceneId} shot=${shot.index} subject 有多過一個時刻／無名群眾 — ` +
        `只保留第一個瞬間：「${before}」→「${after}」` +
        (gone.length > 0 ? `，characters 除名 ${gone.join("、")}（只喺被剝走嗰段出現）` : ""),
    );
  }
  return collapsed;
}

interface CharacterBioJson { age?: string; occupation?: string; personality?: string; painPoint?: string; backstory?: string }
function formatCharacterBios(characters: Character[]): string {
  return characters
    .map((c) => {
      const b = (c.bio ?? {}) as CharacterBioJson;
      const parts = [
        c.profile && `外貌：${c.profile}`,
        b.age && `年齡：${b.age}`,
        b.occupation && `職業：${b.occupation}`,
        b.personality && `性格：${b.personality}`,
        b.painPoint && `痛點：${b.painPoint}`,
        b.backstory && `前史：${b.backstory}`,
      ].filter(Boolean);
      return parts.length ? `- ${c.name}：${parts.join("；")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export const rewriteScriptHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  if (!episode.rawText) throw new TaskError("NO_SOURCE", "episode has no rawText", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const bios = formatCharacterBios(await prisma.character.findMany({ where: { projectId: project.id } }));
  const variables = {
    novel_text: episode.rawText.slice(0, 30_000),
    style_note: project.stylePackId,
    theme: project.theme.trim() || "（未設定，按原文精神改寫）",
    character_bios: bios || "（暫無，首集由你根據原文塑造）",
  };
  const oneOff = promptOverridesFromTask(task);
  const p = await resolvePrompt("rewrite_script", variables, {
    userId: task.userId,
    projectId: project.id,
    oneOffText: oneOff.rewrite_script,
  });
  const result = await callModel(
    {
      userId: task.userId,
      taskId: task.id,
      projectId: project.id,
      episodeId: episode.id,
      promptId: "rewrite_script",
      promptVersion: p.version,
      promptSource: p.source,
      renderedPrompt: p.text,
    },
    { modelKey: models.text as `${string}::${string}`, messages: [{ role: "user", content: p.text }] },
  );
  if (!result.text.trim()) throw new TaskError("LLM_OUTPUT_INVALID", "empty script", true);

  let script = result.text.trim();
  const firstScene = script.indexOf("【第");
  if (firstScene > 0) script = script.slice(firstScene);

  reportProgress(90);
  await prisma.episode.update({ where: { id: episode.id }, data: { scriptText: script, scriptReview: {} } });
  return { chars: result.text.length };
};

export const scriptReviewHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  if (!episode.scriptText) throw new TaskError("NO_SOURCE", "episode has no scriptText", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "script_review",
    { script_text: episode.scriptText.slice(0, 30_000) },
  );

  reportProgress(90);
  await prisma.episode.update({ where: { id: episode.id }, data: { scriptReview: out as object } });
  return { scenes: out.scenes.length, overall: out.overall.level };
};

export const extractAssetsHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "extract_assets",
    { script_text: source.slice(0, 30_000), raw_text: episode.rawText.slice(0, 30_000) },
  );

  reportProgress(60);
  let created = 0;
  for (const c of out.characters) {
    const bio = { age: c.age, occupation: c.occupation, personality: c.personality, painPoint: c.painPoint, backstory: c.backstory, note: c.note };
    const existing = await prisma.character.findFirst({ where: { projectId: project.id, name: c.name } });
    if (existing) {
      await prisma.character.update({
        where: { id: existing.id },
        data: { profile: c.appearance, appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim(), aliases: c.aliases, bio },
      });
    } else {
      await prisma.character.create({
        data: {
          id: newId(),
          userId: task.userId,
          projectId: project.id,
          name: c.name,
          aliases: c.aliases,
          profile: c.appearance,
          appearancePrompt: `${c.appearance} ${c.wardrobe}`.trim(),
          bio,
          views: DEFAULT_CHARACTER_VIEWS as unknown as Prisma.InputJsonValue,
        },
      });
      created++;
    }
  }
  for (const l of out.locations) {
    const name = `${l.name}·${l.timeOfDay}`;
    const existing = await prisma.location.findFirst({ where: { projectId: project.id, name } });
    if (!existing) {
      await prisma.location.create({
        data: {
          id: newId(),
          userId: task.userId,
          projectId: project.id,
          name,
          summary: l.description,
          prompt: l.description,
          angles: l.angles.map((a) => ({ ...a, mediaId: null })),
        },
      });
      created++;
    }
    // existing: skip — 唔覆寫用戶已改嘅 angles／已生成圖
  }
  reportProgress(95);
  return { characters: out.characters.length, locations: out.locations.length, created };
};

// key tier 要求剛好 4 個 view label（正/反/側/細節特寫）——views 數量直接影響下游 UI
// 顯示格數，唔可以好似 characters 嘅外貌字數量化咁靠 prompt 自律，要 app 層兜底補齊。
// prompt 留空——固定嘅角度指示（front/back/side/detail）喺 prop-views.ts 嘅
// VIEW_ANGLE_HINTS 憑 label 提供，唔使靠呢度重複塞一次；view.prompt 淨係用嚟裝
// AI／用戶額外補充嘅具體細節（例如「反面刻有龍紋」），真係有需要先打，唔打都唔會
// 冇咗「呢個係邊個角度」嘅核心指示。
const KEY_TIER_VIEW_LABELS = ["正面", "反面", "側面", "細節特寫"];

export const extractPropsHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = await resolveTaskModels(task, project);

  const targetName = (task.payload as { targetName?: string }).targetName?.trim() || "";

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "extract_props",
    { script_text: source.slice(0, 30_000), target_name: targetName },
  );

  if (targetName && out.props.length === 0) {
    throw new TaskError("PROP_NOT_FOUND", `劇本入面搵唔到「${targetName}」嘅相關描述`, false);
  }

  reportProgress(60);
  // orderBy: 場景名相同、唔同時段（「咖啡店·夜」／「咖啡店·日」）先揀邊個要穩定，
  // 唔可以靠 DB 未指定排序嘅隱含順序（會隨查詢執行方式變動）。
  const locations = await prisma.location.findMany({ where: { projectId: project.id }, select: { id: true, name: true }, orderBy: { id: "asc" } });

  let created = 0;
  for (const p of out.props) {
    const existing = await prisma.prop.findFirst({ where: { projectId: project.id, name: p.name } });
    if (existing) continue; // skip — 唔覆寫用戶已改嘅 views／已生成圖（同 locations 一致）

    let views = p.views.map((v) => ({ ...v, mediaId: null as string | null }));
    if (p.tier === "key" && views.length < 4) {
      views = KEY_TIER_VIEW_LABELS.map((label, i) => views[i] ?? { label, prompt: "", mediaId: null });
    }

    const matchedLocation = p.sceneName ? locations.find((l) => l.name.startsWith(p.sceneName)) : undefined;

    await prisma.prop.create({
      data: {
        id: newId(),
        userId: task.userId,
        projectId: project.id,
        name: p.name,
        tier: p.tier,
        summary: p.description,
        prompt: p.description,
        material: p.material,
        dimensions: p.dimensions,
        physicalParams: p.physicalParams,
        locationId: matchedLocation?.id,
        views,
      },
    });
    created++;
  }
  reportProgress(95);
  return { props: out.props.length, created };
};

export const buildScenesHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const source = episode.scriptText || episode.rawText;
  if (!source) throw new TaskError("NO_SOURCE", "episode has no script/raw text", false);
  const models = await resolveTaskModels(task, project);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "build_scenes",
    { script_text: source.slice(0, 30_000) },
  );

  reportProgress(60);
  const slices = sliceByAnchors(source, out.scenes);
  await prisma.scene.deleteMany({ where: { episodeId: episode.id } });
  for (let i = 0; i < slices.length; i++) {
    const meta = out.scenes[i];
    await prisma.scene.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        sceneIndex: i + 1,
        summary: meta?.summary ?? "",
        content: slices[i].content,
        anchorStart: slices[i].anchorStart,
        anchorEnd: slices[i].anchorEnd,
        // 模型輸出嘅地點／時段——落 DB 做每鏡揀場景參考圖嘅權威來源（Scene.location 註釋）
        location: meta?.location ?? "",
        timeOfDay: meta?.timeOfDay ?? "",
      },
    });
  }
  reportProgress(95);

  const then = (task.payload as { then?: string }).then;
  if (then === TASK_TYPE.STORYBOARD_RUN) {
    await submitTask({
      userId: task.userId,
      type: TASK_TYPE.STORYBOARD_RUN,
      targetType: "episode",
      targetId: episode.id,
      projectId: project.id,
      episodeId: episode.id,
      payload: { chainedFrom: task.id },
    });
  }
  return { scenes: slices.length, chained: then === TASK_TYPE.STORYBOARD_RUN };
};

export const storyboardRunHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = await resolveTaskModels(task, project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  if (scenes.length === 0) throw new TaskError("NO_SCENES", "run BUILD_SCENES first", false);

  const ctx = { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) };

  const payload = (task.payload ?? {}) as { doneSceneIds?: string[] };
  const doneSceneIds = Array.isArray(payload.doneSceneIds) ? payload.doneSceneIds : [];
  const { toBuild, keepSceneIds, skipped } = planResume(scenes, doneSceneIds);
  await prisma.shot.deleteMany({ where: { episodeId: episode.id, sceneId: { notIn: keepSceneIds } } });
  if (skipped > 0) console.log(`[storyboard] task=${task.id} resuming — ${skipped}/${scenes.length} scenes already built`);

  // 認出 subject 入面「有名有姓但冇入 characters」嗰啲角色——長名行先，
  // 免得「王楚」喺「王楚天」出現時搶先命中。
  const knownCharacterNames = (await prisma.character.findMany({ where: { projectId: project.id }, select: { name: true } }))
    .map((c) => c.name)
    .filter((n) => n.trim() !== "")
    .sort((a, b) => b.length - a.length);

  let globalIndex = await prisma.shot.count({ where: { episodeId: episode.id } });
  for (let s = 0; s < toBuild.length; s++) {
    const scene = toBuild[s];
    const base = ((skipped + s) / scenes.length) * 100;
    const span = 100 / scenes.length;

    const plan = await textCallJson(ctx, models.text, "storyboard_plan", { scene_text: scene.content.slice(0, 12_000) });
    // 就地降級，次序有意：先把 subject 縮返一個凝固瞬間（剝走第二個時刻同無名群眾），
    // 再做同框上限（補返漏咗嘅角色、截頭 2 個、剝走剩低嗰啲嘅子句）—— 咁 cap 係對住
    // 真係會入畫嗰段文字做決定。兩者都必須喺 shotListJson / prisma.shot.create 之前做，
    // 令攝影／表演／細節三個階段同埋生圖都食到降級後嘅版本。
    collapseMultiMomentShots(scene.id, plan.shots, knownCharacterNames);
    capCrowdedShots(scene.id, plan.shots, knownCharacterNames);
    await prisma.scene.update({ where: { id: scene.id }, data: { blocking: plan.blocking as object } });
    reportProgress(base + span * 0.4);

    const shotListJson = JSON.stringify(plan.shots);
    const [photo, acting] = await Promise.all([
      textCallJson(ctx, models.text, "storyboard_photography", { shot_list_json: shotListJson }),
      textCallJson(ctx, models.text, "storyboard_acting", { shot_list_json: shotListJson }),
    ]);
    reportProgress(base + span * 0.7);

    const detail = await textCallJson(ctx, models.text, "storyboard_detail", {
      shot_list_json: shotListJson,
      scene_type: scene.summary.slice(0, 40) || "daily",
    });
    reportProgress(base + span * 0.9);

    const photoByIdx = new Map(photo.shots.map((x) => [x.index, x]));
    const actingByIdx = new Map(acting.shots.map((x) => [x.index, x]));
    const detailByIdx = new Map(detail.shots.map((x) => [x.index, x]));

    // 三個階段各自獨立呼叫，模型有機會少交鏡（觀察過：26 鏡嘅場景 photography 只返 6 鏡）。
    // 少交嘅鏡下面會寫入 null，生圖階段就冇布光／表演依據，靠模型自己作 —— 成集光影唔連戲。
    // adapter 而家會擋截斷，所以行到呢度嘅缺口係模型真係少交，唔會自己好返：一定要留痕。
    warnIncompleteStages(scene.id, plan.shots.length, [
      ["photography", photoByIdx.size],
      ["acting", actingByIdx.size],
      ["detail", detailByIdx.size],
    ]);

    for (const shot of plan.shots) {
      globalIndex++;
      await prisma.shot.create({
        data: {
          id: newId(),
          userId: task.userId,
          episodeId: episode.id,
          sceneId: scene.id,
          shotIndex: globalIndex,
          durationMs: 3000,
          storyboardJson: {
            plan: shot,
            photography: photoByIdx.get(shot.index) ?? null,
            acting: actingByIdx.get(shot.index) ?? null,
            detail: detailByIdx.get(shot.index) ?? null,
          } as object,
        },
      });
    }

    doneSceneIds.push(scene.id);
    await prisma.task.update({ where: { id: task.id }, data: { payload: { ...payload, doneSceneIds } } });
  }
  return { shots: globalIndex, scenes: scenes.length, resumedFrom: skipped };
};

export const srtBuildHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode } = await loadEpisodeWithProject(task);
  if (!episode.rawText) throw new TaskError("NO_SOURCE", "episode has no rawText", false);

  const cues = parseSrt(episode.rawText);
  reportProgress(20);

  await prisma.voiceLine.deleteMany({ where: { episodeId: episode.id } });
  await prisma.shot.deleteMany({ where: { episodeId: episode.id } });
  await prisma.scene.deleteMany({ where: { episodeId: episode.id } });

  const scene = await prisma.scene.create({
    data: {
      id: newId(),
      userId: task.userId,
      episodeId: episode.id,
      sceneIndex: 1,
      summary: "SRT",
      content: cues.map((c) => c.text).join("\n"),
    },
  });

  reportProgress(40);
  for (const cue of cues) {
    const shotId = newId();
    const durationMs = Math.min(15_000, Math.max(1000, cue.endMs - cue.startMs));
    await prisma.shot.create({
      data: {
        id: shotId,
        userId: task.userId,
        episodeId: episode.id,
        sceneId: scene.id,
        shotIndex: cue.index,
        durationMs,
        storyboardJson: { plan: { source_text: cue.text, subject: cue.text.slice(0, 50), index: cue.index } } as object,
      },
    });
    await prisma.voiceLine.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        lineIndex: cue.index,
        speaker: "旁白",
        content: cue.text,
        emotionStrength: 0.3,
        matchedShotId: shotId,
      },
    });
  }
  reportProgress(95);
  return { cues: cues.length, shots: cues.length, voiceLines: cues.length };
};

export const voiceAnalyzeHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const models = await resolveTaskModels(task, project);
  const scenes = await prisma.scene.findMany({ where: { episodeId: episode.id }, orderBy: { sceneIndex: "asc" } });
  const shots = await prisma.shot.findMany({ where: { episodeId: episode.id }, orderBy: { shotIndex: "asc" } });
  if (shots.length === 0) throw new TaskError("NO_SHOTS", "run STORYBOARD_RUN first", false);

  const shotList = shots.map((sh) => ({ index: sh.shotIndex, ...(sh.storyboardJson as { plan?: object }).plan }));
  const sceneText = scenes.map((s) => s.content).join("\n").slice(0, 20_000);

  reportProgress(10);
  const out = await textCallJson(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
    models.text,
    "voice_analyze",
    { scene_text: sceneText, shot_list_json: JSON.stringify(shotList) },
  );

  reportProgress(60);
  const shotByIndex = new Map(shots.map((sh) => [sh.shotIndex, sh]));
  const characters = await prisma.character.findMany({ where: { projectId: project.id } });

  // Reuse must key on the same fields TTS actually consumes (text + speaker +
  // emotion + strength) and compare the strength as it is STORED (capped), so a
  // line whose only change is emotion is correctly re-synthesized.
  const capStrength = (s: number) => Math.min(0.5, s);
  const previous = await prisma.voiceLine.findMany({
    where: { episodeId: episode.id },
    orderBy: { lineIndex: "asc" },
    select: { speaker: true, content: true, emotion: true, emotionStrength: true, audioMediaId: true },
  });
  const inherited = matchReusableAudio(
    previous,
    out.lines.map((l) => ({
      speaker: l.speaker,
      content: l.text,
      emotion: l.emotion,
      emotionStrength: capStrength(l.emotionStrength),
    })),
  );
  await prisma.voiceLine.deleteMany({ where: { episodeId: episode.id } });

  let created = 0;
  for (const [i, line] of out.lines.entries()) {
    const matched = shotByIndex.get(line.matchedShotIndex);
    const character = characters.find((c) => c.name === line.speaker);
    await prisma.voiceLine.create({
      data: {
        id: newId(),
        userId: task.userId,
        episodeId: episode.id,
        lineIndex: ++created,
        speaker: line.speaker,
        content: line.text,
        characterId: character?.id,
        lineType: line.lineType,
        cue: line.cue,
        emotion: line.emotion,
        emotionStrength: capStrength(line.emotionStrength),
        matchedShotId: matched?.id,
        audioMediaId: inherited[i],
      },
    });
  }

  reportProgress(85);
  const lines = await prisma.voiceLine.findMany({ where: { episodeId: episode.id, audioMediaId: null } });
  for (const line of lines) {
    await submitTask({
      userId: task.userId,
      type: TASK_TYPE.TTS_LINE,
      targetType: "voiceLine",
      targetId: line.id,
      projectId: project.id,
      episodeId: episode.id,
    });
  }
  return { lines: created, reusedAudio: created - lines.length };
};

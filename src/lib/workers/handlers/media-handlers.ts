import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";
import { generateImage, generateTts, generateVideo } from "@/lib/ai/generate-media";
import { getStorage } from "@/lib/storage";
import { createMediaFromBuffer } from "@/lib/media/service";
import { composeShot, concatAudio, concatShots, imageToVideoClip, probeDurationMs } from "@/lib/video/ffmpeg";
import { TaskError } from "@/lib/task/types";
import type { TaskHandler } from "@/lib/workers/lifecycle";
import { resolveTaskModels, loadEpisodeWithProject, textCallJson, promptOverridesFromTask } from "@/lib/workers/handlers/shared";
import { mergeNegatives } from "@/lib/prompts/negatives";
import { buildShotRefAssets, matchShotCharacters, matchShotProps, pickShotLocation } from "@/lib/prompts/shot-assets";
import { buildAngleImagePrompt, buildAngleNegativePrompt, buildLocationMainPrompt, mergeAngleMediaId, type LocationAngle } from "@/lib/prompts/location-angles";
import { buildPropMainPrompt, buildPropViewPrompt, buildPropNegativePrompt, type PropTier } from "@/lib/prompts/prop-views";
import { buildCharacterMainPrompt, buildCharacterViewPrompt, buildCharacterNegativePrompt, buildCharacterFacePrompt, REF_FACE_MATCH_PROMPT } from "@/lib/prompts/character-views";
import { loadStyle } from "@/lib/prompts/style-pack";
import { filterBlockingForShot, formatBlocking } from "@/lib/prompts/shot-blocking";
import { auditShotPrompt, dropOrphanRefs, hasIssues } from "@/lib/prompts/shot-prompt-audit";
import { OUTPUT_LANGUAGE_LABEL, resolveOutputLanguage } from "@/lib/prompts/output-language";

const CANDIDATE_COUNT = 3;

function assetImageHandler(kind: "character" | "location" | "prop"): TaskHandler {
  return async ({ task, reportProgress }) => {
    const model = kind === "character" ? prisma.character : kind === "location" ? prisma.location : prisma.prop;
    const row = await (model as typeof prisma.character).findFirst({ where: { id: task.targetId, userId: task.userId } });
    if (!row) throw new TaskError("NOT_FOUND", `${kind} ${task.targetId} not found`, false);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: row.projectId } });
    const models = await resolveTaskModels(task, project);
    const style = await loadStyle(project.stylePackId);

    const basePrompt = "appearancePrompt" in row && row.appearancePrompt ? row.appearancePrompt : ((row as { prompt?: string }).prompt ?? "");

    // Prop 生圖同 character/location 嘅框景邏輯差太遠（一律純白背景、tier 分支、
    // scene tier 帶場景鎖圖做參考）——早分支獨立處理，唔夾埋落面 character/location 嘅通用路徑。
    if (kind === "prop") {
      const propRow = row as unknown as { tier: string; material: string; dimensions: string; locationId: string | null; lockedImageMediaId: string | null; views: unknown[] };
      const tier = propRow.tier as PropTier;

      if (typeof (task.payload as { view?: number }).view === "number") {
        const viewIndex = (task.payload as { view: number }).view;
        if (!propRow.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the main image before generating a view", false);
        const views = (propRow.views ?? []) as LocationAngle[];
        const view = views[viewIndex];
        if (!view) throw new TaskError("ANGLE_OUT_OF_RANGE", `view ${viewIndex} out of range for prop ${row.id}`, false);
        const media = await generateImage(
          { userId: task.userId, taskId: task.id, projectId: project.id },
          {
            modelKey: models.image,
            prompt: buildPropViewPrompt(basePrompt, view, tier, style),
            negativePrompt: buildPropNegativePrompt(style),
            aspectRatio: "1:1",
            resolution: "4K",
            keyPrefix: `projects/${project.id}/props/${row.id}`,
            referenceMediaIds: [propRow.lockedImageMediaId],
          },
        );
        const fresh = await prisma.prop.findFirst({ where: { id: row.id, userId: task.userId } });
        if (!fresh) throw new TaskError("NOT_FOUND", `prop ${row.id} not found`, false);
        const freshViews = ((fresh as { views?: unknown[] }).views ?? []) as LocationAngle[];
        let nextViews: LocationAngle[];
        try {
          nextViews = mergeAngleMediaId(freshViews, viewIndex, media.id);
        } catch {
          throw new TaskError("ANGLE_OUT_OF_RANGE", `view ${viewIndex} out of range for prop ${row.id}`, false);
        }
        await prisma.prop.update({ where: { id: row.id }, data: { views: nextViews as unknown as Prisma.InputJsonValue } });
        return { view: viewIndex, mediaId: media.id };
      }

      // tier=scene 帶所屬場景嘅鎖圖做參考，統一材質/光影邏輯——但輸出構圖照樣強制純白背景。
      const sceneRef =
        tier === "scene" && propRow.locationId
          ? (await prisma.location.findFirst({ where: { id: propRow.locationId } }))?.lockedImageMediaId
          : null;

      const mediaIds: string[] = [];
      for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const media = await generateImage(
          { userId: task.userId, taskId: task.id, projectId: project.id },
          {
            modelKey: models.image,
            prompt: buildPropMainPrompt(basePrompt, propRow.material, propRow.dimensions, tier, style),
            negativePrompt: buildPropNegativePrompt(style),
            aspectRatio: "1:1",
            resolution: "4K",
            keyPrefix: `projects/${project.id}/props/${row.id}`,
            referenceMediaIds: sceneRef ? [sceneRef] : undefined,
          },
        );
        mediaIds.push(media.id);
        reportProgress(((i + 1) / CANDIDATE_COUNT) * 95);
      }
      await prisma.prop.update({ where: { id: row.id }, data: { candidates: mediaIds } });
      return { candidates: mediaIds.length };
    }

    // character = 一張正面全身，location/prop 保持 3 張候選任揀。
    const candidateCount = kind === "character" ? 1 : CANDIDATE_COUNT;

    if (kind === "character" && (task.payload as { face?: boolean }).face === true) {
      if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the front view before generating the face close-up", false);
      const facePrompt = buildCharacterFacePrompt(basePrompt, style);
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: facePrompt,
          // 面部特寫係圖生圖（以鎖定主圖做唯一參考），同 view 圖一樣要帶身份類負面詞 ——
          // 佢係之後每一鏡嘅首選 identity anchor，喺呢一格走樣就成集走樣。
          negativePrompt: buildCharacterNegativePrompt(style),
          aspectRatio: "1:1",
          resolution: "4K",
          keyPrefix: `projects/${project.id}/characters/${row.id}`,
          // ⚠️ 一定要 identityAnchor + cropAnchor:"top"。鎖定圖係 9:16 全身站姿
          // （768×1344），近臉出圖係 1:1 —— 唔標就會行 center-crop，攞到 768×768
          // 中段腰腹，**完全冇頭冇臉**，而 prompt 同時叫模型照抄參考圖嘅臉同髮型。
          // 模型冇臉可抄唯有作，實測近臉同主圖眼色／髮長／服裝全部唔同（走哂樣）。
          referenceMediaIds: [{ mediaId: row.lockedImageMediaId, identityAnchor: true, cropAnchor: "top" as const }],
        },
      );
      await prisma.character.update({ where: { id: row.id }, data: { faceImageMediaId: media.id } });
      return { face: media.id };
    }
    if (kind === "location" && typeof (task.payload as { angle?: number }).angle === "number") {
      const angleIndex = (task.payload as { angle: number }).angle;
      if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the main image before generating an angle view", false);
      const angles = ((row as { angles?: unknown[] }).angles ?? []) as LocationAngle[];
      const angle = angles[angleIndex];
      if (!angle) throw new TaskError("ANGLE_OUT_OF_RANGE", `angle ${angleIndex} out of range for location ${row.id}`, false);
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: buildAngleImagePrompt(angle),
          negativePrompt: buildAngleNegativePrompt(style),
          // 跟成品比例，唔好硬編 16:9。視角圖係圖生圖、以主圖做唯一參考（下面 referenceMediaIds），
          // 主圖而家係 project.videoRatio（見下面 assetRatio 嗰段註釋）。9:16 主圖配 16:9 目標，
          // 等於逼模型將一張豎圖塞入橫框 → 視角圖自己 letterbox，跟住成張黑邊圖再做鏡頭參考。
          aspectRatio: project.videoRatio,
          resolution: "4K",
          keyPrefix: `projects/${project.id}/locations/${row.id}`,
          referenceMediaIds: [row.lockedImageMediaId],
        },
      );
      // Re-read before writing back — the user may have edited an angle's
      // label/prompt mid-flight; merging into a fresh snapshot avoids clobbering that.
      const fresh = await prisma.location.findFirst({ where: { id: row.id, userId: task.userId } });
      if (!fresh) throw new TaskError("NOT_FOUND", `location ${row.id} not found`, false);
      const freshAngles = ((fresh as { angles?: unknown[] }).angles ?? []) as LocationAngle[];
      let nextAngles: LocationAngle[];
      try {
        nextAngles = mergeAngleMediaId(freshAngles, angleIndex, media.id);
      } catch {
        throw new TaskError("ANGLE_OUT_OF_RANGE", `angle ${angleIndex} out of range for location ${row.id}`, false);
      }
      await prisma.location.update({ where: { id: row.id }, data: { angles: nextAngles as unknown as Prisma.InputJsonValue } });
      return { angle: angleIndex, mediaId: media.id };
    }

    if (kind === "character" && typeof (task.payload as { view?: number }).view === "number") {
      const viewIndex = (task.payload as { view: number }).view;
      if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the front view before generating a view", false);
      const views = ((row as { views?: unknown[] }).views ?? []) as LocationAngle[];
      const view = views[viewIndex];
      if (!view) throw new TaskError("ANGLE_OUT_OF_RANGE", `view ${viewIndex} out of range for character ${row.id}`, false);
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: buildCharacterViewPrompt(basePrompt, view, style),
          negativePrompt: buildCharacterNegativePrompt(style),
          aspectRatio: "9:16",
          resolution: "4K",
          keyPrefix: `projects/${project.id}/characters/${row.id}`,
          referenceMediaIds: [row.lockedImageMediaId],
        },
      );
      const fresh = await prisma.character.findFirst({ where: { id: row.id, userId: task.userId } });
      if (!fresh) throw new TaskError("NOT_FOUND", `character ${row.id} not found`, false);
      const freshViews = ((fresh as { views?: unknown[] }).views ?? []) as LocationAngle[];
      let nextViews: LocationAngle[];
      try {
        nextViews = mergeAngleMediaId(freshViews, viewIndex, media.id);
      } catch {
        throw new TaskError("ANGLE_OUT_OF_RANGE", `view ${viewIndex} out of range for character ${row.id}`, false);
      }
      await prisma.character.update({ where: { id: row.id }, data: { views: nextViews as unknown as Prisma.InputJsonValue } });
      return { view: viewIndex, mediaId: media.id };
    }

    // 場景主圖跟 project.videoRatio，唔再硬編 16:9——推翻 commit d204865（當時設 16:9
    // 做「establishing 廣角橫構圖」，冇任何設計文檔，理由只留喺 commit message）。
    //
    // ⚠️ 唔好見到「參考圖比例」就以為呢度可以改返轉：**問題唔係比例，係構圖。**
    // outbound-image 嘅 planEncode 一直都已經將非 identityAnchor 嘅參考圖 crop 到目標比例
    // （實測 1344×768 → 432×768），所以送出去嗰張本來就係 9:16。真正殺人嘅係橫向 vista
    // 被中央裁切丟走 68% 畫面，模型收到半截構圖之後會自己重建個開闊場景再 letterbox。
    // 隔離實驗（同一鏡、同 prompt、只換參考圖）：冇參考圖 472px 黑邊／16:9 場景圖裁成 9:16
    // 327px 黑邊／原生 9:16 場景圖 0px。所以要嘅係**原生豎構圖**，唔係事後裁切。
    // 角色／道具維持原狀（角色 9:16、道具 1:1，見上面各自分支）。
    const assetRatio = kind === "location" ? project.videoRatio : "9:16";
    // 墊臉 — user-uploaded reference face, only relevant to characters. Feeding
    // it as a reference lets the model lock the face while generating the front
    // view; see ref-face route for upload/removal.
    const refFace = kind === "character" ? row.refFaceMediaId : null;
    const refs = [refFace].filter((v): v is string => Boolean(v));

    const refFacePrompt = refFace ? REF_FACE_MATCH_PROMPT : "";
    const refFaceNote = kind === "character" ? row.refFaceNote : "";
    const fullPrompt =
      kind === "character"
        ? buildCharacterMainPrompt(basePrompt, style, [refFacePrompt, refFaceNote].filter(Boolean))
        : buildLocationMainPrompt(basePrompt, style);
    // 角色正面全身主圖係**設計**呢個角色嗰一步 —— 交付標準嘅美學塑形詞（幼態臉、
    // 醜化畸形）只喺呢度生效。之後嘅近臉特寫同側／背視角都係照抄呢張圖，帶住美學
    // 壓力就會蓋過身份鎖（見 style-pack.ts designNegativePrompt）。
    const negativePrompt =
      kind === "location" ? buildAngleNegativePrompt(style) : buildCharacterNegativePrompt(style, { design: true });

    const mediaIds: string[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const media = await generateImage(
        { userId: task.userId, taskId: task.id, projectId: project.id },
        {
          modelKey: models.image,
          prompt: fullPrompt,
          negativePrompt,
          aspectRatio: assetRatio,
          resolution: "4K",
          keyPrefix: `projects/${project.id}/${kind}s/${row.id}`,
          referenceMediaIds: refs.length ? refs : undefined,
        },
      );
      mediaIds.push(media.id);
      reportProgress(((i + 1) / candidateCount) * 95);
    }

    await (model as typeof prisma.character).update({ where: { id: row.id }, data: { candidates: mediaIds } });
    return { candidates: mediaIds.length };
  };
}

export const imageCharacterHandler = assetImageHandler("character");
export const imageLocationHandler = assetImageHandler("location");
export const imagePropHandler = assetImageHandler("prop");

// tier=effect 專屬：先鎖定靜態白底參考圖，再合成一段動態參考片段（physicalParams 描述強度/顏色/持續時間）。
export const propEffectVideoHandler: TaskHandler = async ({ task }) => {
  const row = await prisma.prop.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!row) throw new TaskError("NOT_FOUND", `prop ${task.targetId} not found`, false);
  // Handler-level re-check, not just the API route — same pattern as ANGLE_OUT_OF_RANGE
  // being re-validated in the handler even though the route also checks range.
  if (row.tier !== "effect") throw new TaskError("NOT_EFFECT_TIER", `prop ${row.id} is tier=${row.tier}, not effect`, false);
  if (!row.lockedImageMediaId) throw new TaskError("NOT_LOCKED", "lock the reference image before generating the effect clip", false);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: row.projectId } });
  const models = await resolveTaskModels(task, project);

  const videoPrompt = [row.prompt, row.physicalParams].filter(Boolean).join(". ").trim();
  const media = await generateVideo(
    { userId: task.userId, taskId: task.id, projectId: project.id },
    {
      modelKey: models.video,
      prompt: videoPrompt,
      sourceImageMediaId: row.lockedImageMediaId,
      durationSec: 3,
      aspectRatio: "1:1",
      keyPrefix: `projects/${project.id}/props/${row.id}`,
    },
  );
  await prisma.prop.update({ where: { id: row.id }, data: { refVideoMediaId: media.id } });
  return { mediaId: media.id };
};

export const imageShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  // Deleted before we could start (cancel raced the delete) — moot, not a failure.
  if (!shot) {
    console.warn(`[IMAGE_SHOT] shot ${task.targetId} gone before start — skipping`);
    return { skipped: "shot-deleted" };
  }
  const scene = await prisma.scene.findUnique({
    where: { id: shot.sceneId },
    select: { blocking: true, summary: true, content: true, location: true },
  });
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = await resolveTaskModels(task, project);
  const style = await loadStyle(project.stylePackId);

  const lockedCharacters = await prisma.character.findMany({ where: { projectId: project.id, locked: true } });
  const lockedLocations = await prisma.location.findMany({ where: { projectId: project.id, locked: true } });
  const lockedProps = await prisma.prop.findMany({ where: { projectId: project.id, locked: true } });

  const plan = (shot.storyboardJson as { plan?: { characters?: string[] } }).plan;
  const shotCharNames = plan?.characters ?? [];
  const shotCharacters = matchShotCharacters(
    shotCharNames,
    lockedCharacters.map((c) => ({ name: c.name, aliases: c.aliases as string[] })),
  ).map((m) => lockedCharacters.find((c) => c.name === m.name)!);
  // 閃回鏡（storyboardRunHandler 逐鏡標記，見 src/lib/storyboard/flashback.ts）唔屬於
  // 母場嘅時空：唔可以攞母場嘅場景參考圖，亦唔受母場空間契約約束。兩層都喺下面處理。
  const shotLocation = pickShotLocation(
    `${scene?.summary ?? ""}\n${scene?.content ?? ""}`,
    lockedLocations,
    scene?.location,
    { episodeId: shot.episodeId, sceneId: shot.sceneId, shotId: shot.id, flashback: shot.flashback },
  );
  // 空間契約逐鏡收窄（見 shot-blocking.ts）：契約係一場一份，塞成份入單鏡 prompt 等於
  // 叫模型硬性遵守五個人嘅落位同五件道具嘅狀態，繞過咗 characters 層所有防線。
  // 必須喺 matchShotProps 之前做 —— 未過濾嘅 keyProps 會連唔喺本鏡嘅道具（「艾琳的弓」）
  // 都掛埋參考圖入嚟，即係 blocking 除咗餵文字，仲會偷偷影響送出去嘅圖。
  const {
    blocking: shotBlocking,
    droppedPositions,
    droppedProps,
  } = filterBlockingForShot(
    scene?.blocking,
    shotCharNames,
    lockedCharacters.map((c) => c.name),
    { flashback: shot.flashback },
  );
  if (droppedPositions.length > 0 || droppedProps.length > 0) {
    console.warn(
      `[IMAGE_SHOT] shot=${shot.id} 空間契約逐鏡收窄${shot.flashback ? "（閃回鏡：成份契約剝走，連軸線）" : ""} — ` +
        `本鏡角色 [${shotCharNames.join("、") || "（無）"}]；` +
        `剝走落位 [${droppedPositions.join("、") || "（無）"}]、` +
        `剝走道具 [${droppedProps.join("、") || "（無）"}]（提到唔在本鏡嘅角色）`,
    );
  }
  const blockingKeyProps = shotBlocking.keyProps ?? [];
  const shotProps = matchShotProps(
    blockingKeyProps,
    lockedProps.map((p) => ({ name: p.name, prompt: p.prompt, lockedImageMediaId: p.lockedImageMediaId, views: p.views })),
  );

  const { refs, droppedCharacters } = buildShotRefAssets(shotCharacters, shotLocation, shotProps);

  // Legend 用英文 `Image N`，唔再用 `@图N`/`图片N`：命名 token（@name）只有 Runway
  // 支援，而且係 API 一級欄位；Gemini / FLUX / Seedream / Qwen 全部認英文序數
  // （"the woman in the first image" / "Image 1"）。我哋舊格式係兩個家族嘅混種，
  // 而且喺英文 prompt 插中文 token，指涉力再打折。
  const charNames = new Set(shotCharacters.map((c) => c.name));
  const baseLabel = (label: string) => label.split("（")[0] ?? label;
  const kindOf = (label: string) => (charNames.has(baseLabel(label)) ? "identity reference" : "location reference");
  const referenceLegend = refs.map((a, i) => `Image ${i + 1}: ${a.label} — ${kindOf(a.label)}`).join("\n") || "(no reference images)";

  // Identity block：外貌描述由 handler 逐字帶入，模板規則要求 term-for-term 照譯、
  // 唔准每鏡重新措辭。實測 37 鏡 imagePrompt 提到盔甲 0/37、髮色 1/37——text model
  // 收咗 locked_assets 但淨係寫個名就算，身份 100% 押喺一張參考圖上。
  // droppedCharacters（參考圖配額用完）照樣入 block，但明確標明冇圖，
  // 模板規則會禁止用 Image N 指佢哋，逼模型用全文字外貌描述。
  //
  // 外貌文本**原文照送，一個字都唔改**（用戶決定，2026-08-02）：審查交返畀 provider。
  // 舊版喺呢度過一層 appearance-filter 剝走審查詞，已經整個模組刪走。取捨要知：
  // 外貌描述帶審查詞嗰啲鏡（實測「露出许多皮肤」「前凸后翘」各一鏡）會直接食
  // HTTP_422 content_policy_violation 而 fail —— 用戶明知，寧願 fail 都唔要被改寫過嘅外貌。
  //
  // 輸出語言跟第 1 站原文：中文小說 → 中文 prompt。locked_assets 本身係中文，輸出
  // 同語言即係連翻譯呢一步都冇，凍結文本可以原樣照抄——「照譯勿改寫」只係把漂移
  // 推到翻譯層（同一個特徵詞每鏡可以譯成唔同英文），照抄先係真正消除。
  const outputLanguage = resolveOutputLanguage([episode.rawText, episode.scriptText]);
  const frozenNote = outputLanguage === "zh" ? "凍結文本，原樣照抄勿改" : "凍結文本，照譯勿改寫";
  const lockedAssets =
    [
      ...refs.map((a, i) => `${a.label} — Image ${i + 1} — 外貌（${frozenNote}）: ${a.prompt || "（無描述）"}`),
      ...droppedCharacters.map(
        (c) => `${c.name} — NO REFERENCE IMAGE — 外貌（${frozenNote}；唔准用 Image N 指佢）: ${c.appearancePrompt || "（無描述）"}`,
      ),
    ].join("\n") || "（無鎖定資產）";

  reportProgress(10);
  const callImagePrompt = () =>
    textCallJson(
      { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id, oneOff: promptOverridesFromTask(task) },
      models.text,
      "image_prompt_shot",
      {
        shot_json: JSON.stringify(shot.storyboardJson),
        // 閃回鏡冇場景參考圖，環境完全押喺呢段文字上面（見 shot-blocking.ts flashbackLine）
        scene_blocking: formatBlocking(shotBlocking, { flashback: shot.flashback, locationOverride: shot.locationOverride }),
        locked_assets: lockedAssets,
        reference_legend: referenceLegend,
        style_suffix: style.prefix ?? "",
        output_language: OUTPUT_LANGUAGE_LABEL[outputLanguage],
      },
    );

  let out = await callImagePrompt();

  // L2 確定性守衛（根因同實測事故見 shot-prompt-audit.ts 頂部）。
  // 先原樣重試一次：漏寫角色係隨機性失敗，唔係 prompt 寫錯，重試成本遠低過出錯一張圖。
  // 重試都唔掂先至剝圖 —— 剝圖保住咗「唔會亂認人」，但補唔返個角色，所以係下策唔係首選。
  const textOnlyNames = droppedCharacters.map((c) => c.name);
  const auditOpts = { checkNames: outputLanguage === "zh" };
  let issues = auditShotPrompt(out.prompt, refs, textOnlyNames, auditOpts);
  if (hasIssues(issues)) {
    console.warn(
      `[IMAGE_SHOT] shot=${shot.id} prompt 審計唔過 — ` +
        `孤兒參考圖 [${issues.orphanLabels.join("、") || "（無）"}]、` +
        `漏寫角色 [${issues.missingNames.join("、") || "（無）"}] — 原樣重試一次`,
    );
    const retry = await callImagePrompt();
    const retryIssues = auditShotPrompt(retry.prompt, refs, textOnlyNames, auditOpts);
    // 只喺重試真係好過原本先換 —— 唔好用一份更差嘅輸出蓋走一份冇咁差嘅。
    if (retryIssues.orphanLabels.length + retryIssues.missingNames.length < issues.orphanLabels.length + issues.missingNames.length) {
      out = retry;
      issues = retryIssues;
    }
  }

  // 孤兒參考圖一律剝走並重新編號：送一張冇文字錨定嘅身份圖，比唔送差好多 ——
  // 冇圖模型會照文字描述畫，有孤兒圖就會攞去亂認人（鏡 25 四個複製人）。
  const audited = dropOrphanRefs(out.prompt, refs);
  if (audited.droppedLabels.length > 0 || audited.strayIndexes.length > 0) {
    console.warn(
      `[IMAGE_SHOT] shot=${shot.id} 剝走孤兒參考圖 [${audited.droppedLabels.join("、") || "（無）"}]（prompt 冇 Image N 綁住）` +
        (audited.strayIndexes.length > 0
          ? `；prompt 引用咗唔存在嘅編號 [${audited.strayIndexes.map((n) => `Image ${n}`).join("、")}]`
          : ""),
    );
  }
  if (issues.missingNames.length > 0) {
    console.warn(
      `[IMAGE_SHOT] shot=${shot.id} 重試後仍然漏寫角色 [${issues.missingNames.join("、")}]（呢批冇參考圖，身份只能靠文字交代）`,
    );
  }

  // 帶住 identityAnchor 落 outbound-image：近臉特寫走高解析／低壓縮路徑（2048 / q92 /
  // 4:4:4），唔會壓落 1024。塊臉係身份訊號嘅唯一載體 —— 壓完 IED 剩返 30-40px，
  // 低過 ISO/IEC 39794-5 最低 90px 一半，等於送咗張圖但鎖唔到身份。
  const referenceMediaIds = audited.refs.map((a) => ({ mediaId: a.mediaId, identityAnchor: a.identityAnchor === true }));

  reportProgress(40);
  const media = await generateImage(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.image,
      prompt: audited.prompt,
      negativePrompt: mergeNegatives(out.negativePrompt, style.negativePrompt, style.bannedWords),
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
      referenceMediaIds,
    },
  );

  // updateMany, not update: the shot can be deleted (蒙太奇刪鏡 / storyboard regen)
  // during the generation window. A vanished shot is not a failure — the user
  // removed it — so complete quietly rather than crashing on "record not found".
  const saved = await prisma.shot.updateMany({
    where: { id: shot.id },
    // 存審計後嘅 prompt：DB 入面嗰條要同真正送出去嗰條一致，否則之後查事故會對唔上 Image N。
    data: { imagePrompt: audited.prompt, imageMediaId: media.id, status: "ready" },
  });
  if (saved.count === 0) {
    console.warn(`[IMAGE_SHOT] shot ${shot.id} deleted mid-generation — media ${media.id} orphaned`);
    return { skipped: "shot-deleted" };
  }
  return { mediaId: media.id };
};

export const videoShotHandler: TaskHandler = async ({ task, reportProgress }) => {
  const shot = await prisma.shot.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!shot) {
    console.warn(`[VIDEO_SHOT] shot ${task.targetId} gone before start — skipping`);
    return { skipped: "shot-deleted" };
  }
  if (!shot.imageMediaId) throw new TaskError("NO_IMAGE", "generate the shot image first", false);
  const { episode, project } = await loadEpisodeWithProject({ ...task, episodeId: shot.episodeId });
  const models = await resolveTaskModels(task, project);

  const sb = shot.storyboardJson as { plan?: { subject?: string }; detail?: { video_prompt?: string } };
  const durationSec = Math.max(2, Math.round(shot.durationMs / 1000) || 3);
  const videoPrompt = shot.videoPrompt || sb.detail?.video_prompt || sb.plan?.subject || shot.imagePrompt;

  reportProgress(20);
  const media = await generateVideo(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: episode.id },
    {
      modelKey: models.video,
      prompt: videoPrompt,
      sourceImageMediaId: shot.imageMediaId,
      durationSec,
      aspectRatio: project.videoRatio,
      keyPrefix: `projects/${project.id}/shots/${shot.id}`,
    },
  );

  const saved = await prisma.shot.updateMany({ where: { id: shot.id }, data: { videoMediaId: media.id } });
  if (saved.count === 0) {
    console.warn(`[VIDEO_SHOT] shot ${shot.id} deleted mid-generation — media ${media.id} orphaned`);
    return { skipped: "shot-deleted" };
  }
  return { mediaId: media.id };
};

export const ttsLineHandler: TaskHandler = async ({ task }) => {
  const line = await prisma.voiceLine.findFirst({ where: { id: task.targetId, userId: task.userId } });
  if (!line) throw new TaskError("NOT_FOUND", `voiceLine ${task.targetId} not found`, false);
  const { project } = await loadEpisodeWithProject({ ...task, episodeId: line.episodeId });
  const models = await resolveTaskModels(task, project);

  // Character's voice clip (a MediaObject id) drives the provider's voice — this
  // is what keeps one character on one voice across the episode (火豹 #85「同一
  // 個人上下鏡頭音色變了」). Null until a voice is assigned; the provider then
  // uses its default, same as before.
  const voiceId = line.characterId
    ? (await prisma.character.findUnique({ where: { id: line.characterId }, select: { voiceId: true } }))?.voiceId ?? undefined
    : undefined;

  const media = await generateTts(
    { userId: task.userId, taskId: task.id, projectId: project.id, episodeId: line.episodeId },
    {
      modelKey: models.tts,
      text: line.content,
      voiceId,
      emotionStrength: line.emotionStrength,
      keyPrefix: `projects/${project.id}/voice/${line.id}`,
    },
  );

  await prisma.voiceLine.update({ where: { id: line.id }, data: { audioMediaId: media.id } });
  return { mediaId: media.id };
};

export const composeEpisodeHandler: TaskHandler = async ({ task, reportProgress }) => {
  const { episode, project } = await loadEpisodeWithProject(task);
  const shots = await prisma.shot.findMany({
    where: { episodeId: episode.id },
    orderBy: { shotIndex: "asc" },
    include: { voiceLines: { orderBy: { lineIndex: "asc" } } },
  });
  if (shots.length === 0) throw new TaskError("NO_SHOTS", "nothing to compose", false);

  const storage = getStorage();
  const dir = await mkdtemp(join(tmpdir(), "rc-compose-"));
  try {
    const composedPaths: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      let clipPath = join(dir, `src-${i}.mp4`);

      if (shot.videoMediaId) {
        const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: shot.videoMediaId } });
        await writeFile(clipPath, await storage.getObjectBuffer(media.storageKey));
      } else if (shot.imageMediaId) {
        const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: shot.imageMediaId } });
        const imgPath = join(dir, `img-${i}.png`);
        await writeFile(imgPath, await storage.getObjectBuffer(media.storageKey));
        await imageToVideoClip(imgPath, Math.max(2, Math.round(shot.durationMs / 1000) || 3), clipPath, project.videoRatio);
      } else {
        continue;
      }

      const linesWithAudio = shot.voiceLines.filter((l) => l.audioMediaId);
      let audioPath: string | undefined;
      if (linesWithAudio.length > 0) {
        const partPaths: string[] = [];
        for (let k = 0; k < linesWithAudio.length; k++) {
          const media = await prisma.mediaObject.findUniqueOrThrow({ where: { id: linesWithAudio[k].audioMediaId! } });
          const p = join(dir, `aud-${i}-${k}.m4a`);
          await writeFile(p, await storage.getObjectBuffer(media.storageKey));
          partPaths.push(p);
        }
        if (partPaths.length === 1) {
          audioPath = partPaths[0];
        } else {
          audioPath = join(dir, `aud-${i}.m4a`);
          await concatAudio(partPaths, audioPath);
        }
      }
      const subtitle = linesWithAudio.map((l) => l.content).join(" ") || undefined;

      const outPath = join(dir, `composed-${i}.mp4`);
      await composeShot({ videoPath: clipPath, audioPath, subtitle }, outPath);
      composedPaths.push(outPath);
      reportProgress((i / shots.length) * 80);
    }

    if (composedPaths.length === 0) throw new TaskError("NO_VISUALS", "no shots had image/video to compose", false);

    reportProgress(85);
    const finalPath = join(dir, "episode.mp4");
    await concatShots(composedPaths, finalPath);
    const durationMs = await probeDurationMs(finalPath);

    const media = await createMediaFromBuffer({
      userId: task.userId,
      buffer: await readFile(finalPath),
      mimeType: "video/mp4",
      keyPrefix: `projects/${project.id}/exports/${episode.id}`,
    });
    await prisma.episode.update({ where: { id: episode.id }, data: { exportMediaId: media.id, status: "done" } });
    return { mediaId: media.id, shots: composedPaths.length, durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

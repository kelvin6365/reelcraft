// 首尾幀鏈接判定 —— 邊兩個相鄰鏡頭可以做尾幀錨定。
//
// 【尾幀錨定做緊咩】
// 生 shot N 條片時，起幀＝shot N 自己嘅分鏡圖，尾幀＝shot N+1 嘅分鏡圖。跟住 shot N+1
// 條片由同一張圖開始 —— 接口嗰格完全一樣，剪埋一齊零跳。
//
// 【點解唔係全部相鄰鏡頭都鏈】
// 接口嗰格一樣，觀眾睇落就唔再係一個 cut，而係鏡頭一路搖／推過去。呢個對「中景推入
// 變近景」係靚嘢，但對正反打對話戲係災難：你想要硬切，佢會變成鏡頭喺 shot N 中途甩開
// 自己嘅構圖游去 N+1 嗰邊，兩個鏡頭嘅構圖同時報廢。所以判定刻意收窄到「shot N 本身
// 已經係運動鏡頭」——佢本來就要郁，郁到啱啱好落喺下一鏡嘅構圖上先叫順。
//
// 【點解落 code 而唔係問 LLM】
// 同 flashback.ts 頂部嗰條教訓一樣：prompt 規則係軟約束，凡係唔可以飄嘅嘢最終都要落
// code 硬做。接錯兩個唔相干嘅鏡係靜默壞掉 —— 冇錯誤訊息，要睇到成片先發現。

/** 判定所需嘅最小鏡頭形狀（camera 來自 storyboard_detail）。 */
export interface ChainShot {
  sceneId: string;
  shotIndex: number;
  /** 運鏡：固定／推／拉／搖／移／跟／手持（storyboard_detail 七選一，但模型會飄） */
  camera: string;
  flashback: boolean;
  locationOverride: string;
}

// 運動鏡頭：鏡頭本身就要郁，收喺下一鏡嘅構圖上係自然嘅落點。
const MOVING = ["推", "拉", "搖", "移", "跟"];
// 一票否決：固定鏡頭嘅構圖唔應該喺鏡頭中途游走；手持本身就抖，同尾幀錨定打交。
// 放喺 MOVING 之前檢查，因為「手持跟拍」呢類混合寫法含住「跟」字。
const NEVER_CHAIN = ["固定", "手持"];

/** 呢個運鏡係咪適合做尾幀錨定。 */
export function isMovingCamera(camera: string): boolean {
  const c = camera.trim();
  if (!c) return false;
  if (NEVER_CHAIN.some((k) => c.includes(k))) return false;
  return MOVING.some((k) => c.includes(k));
}

/**
 * current 條片可唔可以用 next 嘅分鏡圖做尾幀。
 * next 為 undefined（一場戲最後一鏡）一律 false。
 */
export function shouldLinkToNext(current: ChainShot, next: ChainShot | undefined): boolean {
  if (!next) return false;
  // 跨場硬切：另一場戲＝另一個空間契約，構圖之間冇連續性可言。
  if (current.sceneId !== next.sceneId) return false;
  if (next.shotIndex !== current.shotIndex + 1) return false;
  // 跨時空／跨地點硬切：閃回同現在之間、兩個唔同閃回地點之間，鏡頭唔應該連續移動過去。
  if (current.flashback !== next.flashback) return false;
  if (current.locationOverride !== next.locationOverride) return false;
  return isMovingCamera(current.camera);
}

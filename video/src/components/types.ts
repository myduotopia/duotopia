// Manifest schema v2（向下相容 v1：舊欄位全保留，新欄位皆選填）
export type Box = { x: number; y: number; w: number; h: number };

export type SfxEvent = {
  t: number; // 場景內秒數
  type: "click" | "ding" | "whoosh" | "success";
  box?: Box; // click 事件的目標框（點擊前狀態；預點擊標記/QA 置中驗算用）
};

export type StepInfo = {
  index: number; // 1-based
  total: number;
  label: string;
  prefix?: string; // 徽章前綴，預設「步驟」；EP2 用「做法」
};

export type SceneT = {
  id: string;
  kind: "title" | "shot" | "steps";
  audio: string;
  durationSec: number;
  narration: string;
  // title 場景
  title?: string;
  subtitle?: string;
  progressDots?: boolean; // 片尾字卡顯示系列進度點（吃 manifest.episode/episodesTotal）
  // steps 場景（集頭「本集 N 步驟」總覽卡）
  steps?: string[];
  stepTimes?: number[]; // 每個 step 在旁白中被唸到的秒數；有則卡片逐項晃動同步旁白（無則沿用 stagger 進場）
  // shot 場景（v1）
  shot?: string;
  caption?: string;
  highlights?: Box[];
  zoom?: number;
  zoomStatic?: boolean;
  mask?: boolean;
  // shot 場景（v2）
  clip?: string; // 有 clip 走影片播放，否則靜態截圖
  clipDurationSec?: number;
  freezeShot?: string; // clip 播完後定格用的尾幀
  page?: string; // LocationChip 文字，例「班級管理 › 指定班級」
  step?: StepInfo; // 右上角步驟徽章
  stepDone?: boolean; // 本場景結束時該步驟完成（徽章打勾 + SuccessBurst）
  spotlight?: Box; // 指定則 focus 區外壓暗
  hlAtSec?: number; // highlight/spotlight 幾秒後才出現（clip 預設 = clipDurationSec）
  hlOffSec?: number; // highlight/spotlight 幾秒後退場（點擊後畫面會變，框不得殘留；manifest_v3 自動設為點擊+0.8）
  sfx?: SfxEvent[];
  transition?: "slide" | "fade" | "none"; // 進入本場景的轉場，預設 slide
  // v2.2 運鏡群組：同一畫面連續講不同區塊 → 一鏡到底（無轉場，攝影機 pan/zoom 移動焦點）
  sameScreen?: boolean; // true = 與前一景同畫面，併入同一運鏡群組
  camera?: Box; // 攝影機焦點覆寫（預設 spotlight ?? highlights[0] ?? 全幅）
  // EP4 手機直式：clip/shot 為 390×844 直式，改渲染在手機「入鏡框」內（置中）＋
  // 框外模糊放大截圖背景；highlights 座標為 390×844 手機像素（toPhone 映射）。
  mobile?: boolean;
};

export type ManifestT = {
  fps: number;
  width: number;
  height: number;
  episode?: number; // 1-based，進度點用
  episodesTotal?: number; // 預設 7
  bgm?: string; // 例 "bgm/track.mp3"
  bgmVolume?: number;
  scenes: SceneT[];
};

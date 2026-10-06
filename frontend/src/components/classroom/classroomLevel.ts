/**
 * classroomLevel — 班級 CEFR 等級共用常數與工具（#1097）
 *
 * - CEFR_LEVELS：選項（value 與後端 ProgramLevel 一致："preA"、"A1"…"C2"；Pre-A 顯示為「Pre-A」）
 * - LEVEL_ORDER：排序用權重（Pre-A < A1 < … < C2）
 * - normalizeLevel：把 "PREA"／"pre-a"／"a1" 等寫法轉成標準 value；無法辨識回 null
 *   （規則同後端 normalize_program_level）
 * - getLevelLabel／getLevelBadgeClass：徽章文字與顏色（含深色模式）；元件見 LevelBadge.tsx
 * - computeLevelAdjust：批次調整等級的預覽（哪些班會變、哪些已是目標等級而略過；AdjustLevelDialog 用）
 *
 * 「我的班級」（TeacherClassrooms）與機構後台班級列表（ClassroomListTable）共用。
 */

export type ClassroomLevel = "preA" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: readonly { value: ClassroomLevel; label: string }[] =
  [
    { value: "preA", label: "Pre-A" },
    { value: "A1", label: "A1" },
    { value: "A2", label: "A2" },
    { value: "B1", label: "B1" },
    { value: "B2", label: "B2" },
    { value: "C1", label: "C1" },
    { value: "C2", label: "C2" },
  ];

/** 未設定等級時的預設（與後端建立班級的預設一致） */
export const DEFAULT_LEVEL: ClassroomLevel = "A1";

/** 排序權重：Pre-A=0 … C2=6 */
export const LEVEL_ORDER: Readonly<Record<ClassroomLevel, number>> = {
  preA: 0,
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
};

/** 等級字串 → 標準 value；大小寫、"-"、"_" 不拘；無法辨識（含空值）回 null */
export function normalizeLevel(
  raw: string | null | undefined,
): ClassroomLevel | null {
  if (raw == null) return null;
  const key = String(raw).trim().toUpperCase().replace(/[-_]/g, "");
  if (!key) return null;
  const match = CEFR_LEVELS.find((l) => l.value.toUpperCase() === key);
  return match ? match.value : null;
}

/** 排序權重；未設定或無法辨識的等級排在最後 */
export function getLevelSortValue(raw: string | null | undefined): number {
  const level = normalizeLevel(raw);
  return level ? LEVEL_ORDER[level] : Number.MAX_SAFE_INTEGER;
}

/** 徽章文字：可辨識 → 標準標籤（"Pre-A"／"A1"…）；空值 → 預設 A1；無法辨識 → 原字串 */
export function getLevelLabel(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return DEFAULT_LEVEL;
  const level = normalizeLevel(raw);
  if (!level) return String(raw);
  return CEFR_LEVELS.find((l) => l.value === level)?.label ?? level;
}

const NEUTRAL_BADGE_CLASS =
  "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

const LEVEL_BADGE_CLASS: Readonly<Record<ClassroomLevel, string>> = {
  preA: NEUTRAL_BADGE_CLASS,
  A1: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  A2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  B1: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  B2: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  C1: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  C2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

/** 徽章顏色 class：空值視為預設 A1；無法辨識 → 灰色 */
export function getLevelBadgeClass(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) {
    return LEVEL_BADGE_CLASS[DEFAULT_LEVEL];
  }
  const level = normalizeLevel(raw);
  return level ? LEVEL_BADGE_CLASS[level] : NEUTRAL_BADGE_CLASS;
}

export interface LevelAdjustClassroom<Id> {
  id: Id;
  name: string;
  level?: string | null;
}

export interface LevelChange<Id> {
  id: Id;
  name: string;
  /** 目前等級的顯示文字（getLevelLabel） */
  fromLabel: string;
  to: ClassroomLevel;
}

export interface LevelAdjustResult<Id> {
  changes: LevelChange<Id>[];
  /** 已是目標等級的班級 */
  skipped: { id: Id; name: string }[];
}

/**
 * 批次把班級設成同一個目標等級：已是該等級（正規化後相同）者略過，其餘列為變更。
 * 未設定等級的班級視為預設 A1（與徽章顯示一致）。target 為 null 時沒有任何變更。
 */
export function computeLevelAdjust<Id>(
  classrooms: readonly LevelAdjustClassroom<Id>[],
  target: ClassroomLevel | null,
): LevelAdjustResult<Id> {
  const result: LevelAdjustResult<Id> = { changes: [], skipped: [] };
  if (!target) return result;
  for (const c of classrooms) {
    const blank = c.level == null || !String(c.level).trim();
    const current = blank ? DEFAULT_LEVEL : normalizeLevel(c.level);
    if (current === target) {
      result.skipped.push({ id: c.id, name: c.name });
    } else {
      result.changes.push({
        id: c.id,
        name: c.name,
        fromLabel: getLevelLabel(c.level),
        to: target,
      });
    }
  }
  return result;
}

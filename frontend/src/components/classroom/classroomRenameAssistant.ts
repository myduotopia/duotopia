/**
 * classroomRenameAssistant — 批次編輯 AI 助手（ClassroomRenameAssistantPanel）的純邏輯（#1139 第二階段）
 *
 * - toAiRequestClassrooms：把表格「當下」的列（含人工剛改的值）轉成 AI 端點的輸入
 *   （id 轉數字；機構頁的班級 id 是字串）。
 * - buildAiHistory：對話紀錄只送最近 AI_HISTORY_TURNS 輪（使用者＋助手各一則＝一輪），
 *   失敗訊息（AI 沒回應）不送（D10）。
 * - mapAiChanges：把 AI 回傳的數字 id 對回表格的 id（字串或數字），不在表格的丟掉；
 *   名稱／年級的最終把關仍是 applyBatchEditChanges（只改名稱與年級、年級不能清回未設定）。
 * - describeAiChange：產生「原 → 新」清單的一列（名稱、年級前後值；用套用前的快照當原值）。
 */
import type { BatchEditChange, BatchEditRow } from "./batchEditClassrooms";
import { CLASSROOM_NAME_MAX_LENGTH } from "./batchEditClassrooms";

/** 前端每次送最近幾輪對話（D10） */
export const AI_HISTORY_TURNS = 10;

export type AssistantRole = "user" | "assistant";

export interface AssistantHistoryMessage {
  role: AssistantRole;
  content: string;
  /** true＝AI 沒回應的錯誤提示，不送給 AI */
  error?: boolean;
}

export interface AiRequestClassroom {
  id: number;
  name: string;
  grade: number | null;
}

export interface AiChange {
  id: number;
  name?: string;
  grade?: number;
}

export interface AiChangeDescription {
  fromName: string;
  toName: string;
  nameChanged: boolean;
  fromGrade: number | null;
  toGrade: number | null;
  gradeChanged: boolean;
}

export function toAiRequestClassrooms<Id>(
  rows: readonly BatchEditRow<Id>[],
): AiRequestClassroom[] {
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name.slice(0, CLASSROOM_NAME_MAX_LENGTH),
    grade: row.grade,
  }));
}

export function buildAiHistory(
  messages: readonly AssistantHistoryMessage[],
): { role: AssistantRole; content: string }[] {
  return messages
    .filter((m) => !m.error && m.content.trim() !== "")
    .slice(-AI_HISTORY_TURNS * 2)
    .map(({ role, content }) => ({ role, content }));
}

export function mapAiChanges<Id>(
  rows: readonly BatchEditRow<Id>[],
  changes: readonly AiChange[],
): BatchEditChange<Id>[] {
  const idByKey = new Map<string, Id>(rows.map((r) => [String(r.id), r.id]));
  const out: BatchEditChange<Id>[] = [];
  for (const change of changes) {
    const id = idByKey.get(String(change.id));
    if (id === undefined) continue;
    const mapped: BatchEditChange<Id> = { id };
    if (typeof change.name === "string") mapped.name = change.name;
    if (typeof change.grade === "number") mapped.grade = change.grade;
    if (mapped.name === undefined && mapped.grade === undefined) continue;
    out.push(mapped);
  }
  return out;
}

export function describeAiChange<Id>(
  before: BatchEditRow<Id>,
  change: BatchEditChange<Id>,
): AiChangeDescription {
  const toName = change.name ?? before.name;
  const toGrade = change.grade === undefined ? before.grade : change.grade;
  return {
    fromName: before.name,
    toName,
    nameChanged: toName.trim() !== before.name.trim(),
    fromGrade: before.grade,
    toGrade,
    gradeChanged: toGrade !== before.grade,
  };
}

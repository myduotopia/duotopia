/**
 * 考題來源 ↔ CreatableCombobox 的轉換與 API 呼叫（Issue #1064）。
 * 新增面板的左欄與編輯模式的精簡設定列共用。
 */
import { apiClient } from "@/lib/api";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import type { QuestionSource } from "@/types/questionBank";

export function sourceToItem(s: QuestionSource): ComboboxItem {
  const meta = [s.source_type === "exam" ? "考試" : "出版社", s.year]
    .filter(Boolean)
    .join(" · ");
  return { id: s.id, label: s.name, meta };
}

export async function searchSources(q: string): Promise<ComboboxItem[]> {
  return (await apiClient.listSources(q || undefined)).items.map(sourceToItem);
}

/** 建到機構題庫時 organizationId 有值 → 來源也建成機構來源 */
export function makeCreateSource(organizationId?: string) {
  return async (name: string): Promise<ComboboxItem> =>
    sourceToItem(
      await apiClient.createSource({
        source_type: "exam",
        name,
        organization_id: organizationId ?? null,
      }),
    );
}

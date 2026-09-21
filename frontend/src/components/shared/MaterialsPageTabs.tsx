/**
 * 教材頁頂部的 tab 列（Issue #1061 / #1063）：「我的教材｜我的題庫」、「機構教材｜機構題庫」。
 *
 * 「我的教材」與「機構教材」仍是兩個獨立頁面（各自由 sidebar 依 workspace 切換），
 * 這裡只在頁內加 tab 把「教材」與「題庫」並列，不合併兩頁。tab 狀態由呼叫端
 * 存在 URL query（?tab=questions），重整後保留。
 */

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type MaterialsPageTab = "materials" | "questions";

export const MATERIALS_TAB_PARAM = "tab";

/** 從 URLSearchParams 讀 tab；不是 "questions" 一律當 materials */
export function readMaterialsTab(params: URLSearchParams): MaterialsPageTab {
  return params.get(MATERIALS_TAB_PARAM) === "questions"
    ? "questions"
    : "materials";
}

/** 回傳寫入 tab 後的新 params（materials 是預設，不留 query 保持網址乾淨） */
export function withMaterialsTab(
  params: URLSearchParams,
  tab: MaterialsPageTab,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (tab === "questions") next.set(MATERIALS_TAB_PARAM, "questions");
  else next.delete(MATERIALS_TAB_PARAM);
  return next;
}

interface MaterialsPageTabsProps {
  value: MaterialsPageTab;
  onChange: (tab: MaterialsPageTab) => void;
  materialsLabel: string;
  questionsLabel: string;
}

const TRIGGER_CLASS =
  "rounded-none px-0 pb-2 text-[22px] font-bold text-gray-400 shadow-none border-b-2 border-transparent -mb-px " +
  "data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none data-[state=active]:border-blue-600 hover:text-gray-700";

export default function MaterialsPageTabs({
  value,
  onChange,
  materialsLabel,
  questionsLabel,
}: MaterialsPageTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as MaterialsPageTab)}
      className="w-full"
    >
      {/* tab 本身就是頁面標頭：字級同原本的 h2（22px 粗體），選中深色＋底線、未選灰色 */}
      <TabsList className="h-auto justify-start gap-6 rounded-none bg-transparent p-0 border-b border-gray-200">
        <TabsTrigger
          value="materials"
          className={TRIGGER_CLASS}
          data-testid="materials-tab-materials"
        >
          {materialsLabel}
        </TabsTrigger>
        <TabsTrigger
          value="questions"
          className={TRIGGER_CLASS}
          data-testid="materials-tab-questions"
        >
          {questionsLabel}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/**
 * MaterialsToolbar - 教材頁面共用工具列
 *
 * 包含：標題、新增按鈕（可選）、搜尋框、條列式/資料夾式 view toggle
 * 用於：我的教材、機構教材、組織管理教材
 */

import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Search, FolderPlus, List, LayoutGrid } from "lucide-react";

export type ViewMode = "tree" | "folder";

export interface MaterialsToolbarProps {
  title: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAdd?: () => void;
  addButtonText?: string;
}

export default function MaterialsToolbar({
  title,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  viewMode,
  onViewModeChange,
  onAdd,
  addButtonText,
}: MaterialsToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
      <h2 className="text-[22px] font-bold text-gray-900 whitespace-nowrap">
        {title}
      </h2>

      {/* Spacer (desktop only) */}
      <div className="hidden lg:block flex-1" />

      {/* Add + Search + View toggle */}
      <div className="flex items-center gap-3">
        {onAdd && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 sm:px-3.5 sm:py-2 sm:bg-white sm:border sm:border-gray-200 sm:rounded-lg text-gray-700 text-[13px] font-medium sm:hover:bg-gray-50 transition-colors shrink-0"
          >
            <FolderPlus size={20} className="sm:hidden" />
            <FolderPlus size={16} className="hidden sm:block" />
            {addButtonText && (
              <span className="hidden sm:inline">{addButtonText}</span>
            )}
          </button>
        )}
        <div className="relative flex-1 md:w-60 md:flex-none">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <Input
            placeholder={
              searchPlaceholder ??
              t(
                "teacherTemplatePrograms.toolbar.searchPlaceholder",
                "搜尋教材...",
              )
            }
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9 text-[13px] border-gray-200 rounded-lg"
          />
        </div>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden shrink-0">
          <button
            onClick={() => onViewModeChange("tree")}
            className={`p-2 transition-colors ${
              viewMode === "tree"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-500 hover:bg-gray-100"
            }`}
            title={t("teacherTemplatePrograms.toolbar.treeView", "條列式")}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => onViewModeChange("folder")}
            className={`p-2 transition-colors ${
              viewMode === "folder"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-500 hover:bg-gray-100"
            }`}
            title={t("teacherTemplatePrograms.toolbar.folderView", "資料夾式")}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

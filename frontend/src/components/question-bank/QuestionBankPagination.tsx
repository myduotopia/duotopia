/**
 * 題庫列表分頁列（#1082 自 QuestionBankTab 拆出）：每頁筆數、頁碼、上一頁／下一頁。
 * 只有超過一頁或每頁筆數不是預設值時才顯示。
 */

import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export interface QuestionBankPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChangePage: (page: number) => void;
  onChangePageSize: (size: number) => void;
}

export default function QuestionBankPagination({
  page,
  pageSize,
  total,
  onChangePage,
  onChangePageSize,
}: QuestionBankPaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (!(total > pageSize || pageSize !== DEFAULT_PAGE_SIZE)) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
      <Select
        value={String(pageSize)}
        onValueChange={(v) => onChangePageSize(Number(v))}
      >
        <SelectTrigger
          className="h-8 w-28 text-xs"
          data-testid="question-bank-page-size"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {t("questionBank.list.pageSize", { count: n })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>{t("questionBank.pagination", { page, totalPages, total })}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChangePage(page - 1)}
        aria-label={t("questionBank.buttons.prevPage")}
      >
        <ChevronLeft size={16} />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChangePage(page + 1)}
        aria-label={t("questionBank.buttons.nextPage")}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}

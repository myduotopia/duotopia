/**
 * CreatableCombobox — 可打字的下拉（共用元件）：能選、能搜尋、也能新增。
 *
 * 專案沒有 cmdk，用 Popover + Input + 清單自建。輸入關鍵字時呼叫 `onSearch`（呼叫端
 * 自行 debounce／打 API），清單沒有完全符合的項目時最後一列顯示「新增「xxx」」，
 * 按下呼叫 `onCreate` 並把結果加入已選。多選，已選顯示成 chip 可移除。
 * 題庫的「考題來源」用它；未來其他可自建的標籤型欄位也可直接用。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ComboboxItem {
  id: number;
  label: string;
  /** 顯示在 label 右側的小字（例如來源型別、年份） */
  meta?: string;
}

export interface CreatableComboboxProps {
  value: ComboboxItem[];
  onChange: (next: ComboboxItem[]) => void;
  /** 依關鍵字回傳候選；空字串代表列出全部 */
  onSearch: (query: string) => Promise<ComboboxItem[]>;
  /** 沒傳 = 不可新增 */
  onCreate?: (label: string) => Promise<ComboboxItem>;
  disabled?: boolean;
  triggerLabel: string;
  searchPlaceholder: string;
  emptyText: string;
  /** 「新增「{{name}}」」 */
  createLabel: (name: string) => string;
  /** 自訂觸發元素（表格格子）：不渲染預設按鈕與 chip 列，由呼叫端顯示已選值 */
  renderTrigger?: () => React.ReactNode;
  /** 選一個（或新增一個）就關閉選單 */
  closeOnSelect?: boolean;
  "data-testid"?: string;
}

export function CreatableCombobox({
  value,
  onChange,
  onSearch,
  onCreate,
  disabled = false,
  triggerLabel,
  searchPlaceholder,
  emptyText,
  createLabel,
  renderTrigger,
  closeOnSelect = false,
  "data-testid": testId = "creatable-combobox",
}: CreatableComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<ComboboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(h);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    onSearch(debounced)
      .then((res) => {
        if (!cancelled) setItems(res);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debounced, onSearch]);

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const exactExists = useMemo(
    () =>
      !!debounced &&
      items.some((i) => i.label.toLowerCase() === debounced.toLowerCase()),
    [items, debounced],
  );
  const canCreate = !!onCreate && !!debounced && !exactExists && !creating;

  const toggle = (item: ComboboxItem) => {
    if (selectedIds.has(item.id)) {
      onChange(value.filter((v) => v.id !== item.id));
    } else {
      onChange([...value, item]);
    }
    if (closeOnSelect) setOpen(false);
  };

  const handleCreate = async () => {
    if (!onCreate || !canCreate) return;
    setCreating(true);
    try {
      const created = await onCreate(debounced);
      if (!selectedIds.has(created.id)) onChange([...value, created]);
      setItems((prev) =>
        prev.some((i) => i.id === created.id) ? prev : [created, ...prev],
      );
      setQuery("");
      if (closeOnSelect) setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      {!renderTrigger && value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Badge
              key={item.id}
              variant="secondary"
              className="font-normal gap-1 pr-1"
              data-testid={`${testId}-chip-${item.id}`}
            >
              {item.label}
              {item.meta && (
                <span className="text-gray-400 text-[10px]">{item.meta}</span>
              )}
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full hover:bg-gray-300/60 p-0.5"
                  onClick={() => toggle(item)}
                  aria-label={t("common.remove", "移除")}
                >
                  <X size={12} />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (disabled && o) return;
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          {renderTrigger ? (
            <div
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled || undefined}
              className={disabled ? "cursor-default" : "cursor-pointer"}
              data-testid={`${testId}-trigger`}
            >
              {renderTrigger()}
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="gap-1.5 text-[13px] w-full justify-between"
              data-testid={`${testId}-trigger`}
            >
              {triggerLabel}
              <ChevronDown size={14} />
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder={searchPlaceholder}
            className="h-8 text-[13px] mb-2"
            data-testid={`${testId}-search`}
          />
          <div className="max-h-64 overflow-y-auto text-sm">
            {loading ? (
              <div className="py-4 text-center text-gray-500">
                {t("common.loading")}
              </div>
            ) : (
              <>
                {items.length === 0 && !canCreate && (
                  <div className="py-4 text-center text-gray-500">
                    {emptyText}
                  </div>
                )}
                {items.map((item) => {
                  const selected = selectedIds.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item)}
                      className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-100 ${
                        selected ? "text-blue-700" : "text-gray-800"
                      }`}
                      data-testid={`${testId}-option-${item.id}`}
                    >
                      <span className="w-4 shrink-0">
                        {selected && <Check size={14} />}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.meta && (
                        <span className="text-xs text-gray-400 shrink-0">
                          {item.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-blue-700 hover:bg-blue-50 border-t border-gray-100 mt-1"
                    data-testid={`${testId}-create`}
                  >
                    {creating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    <span className="truncate">{createLabel(debounced)}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

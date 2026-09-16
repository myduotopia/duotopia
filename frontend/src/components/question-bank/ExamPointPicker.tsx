/**
 * 考點選擇器（Issue #1061 / #1064）。
 *
 * 專案沒有 cmdk / combobox，用 Popover + Input + 清單自建。
 * 輸入關鍵字打 `GET /api/question-bank/exam-points?q=`，命中 alias（「現完式」）
 * 也會回傳正式考點（「現在完成式」），清單上顯示正式名稱並附上命中的 alias。
 * 不輸入時顯示整棵樹（縮排表示階層）。已選的顯示成 chip，可移除。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, X } from "lucide-react";

import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { examPointLabel, type ExamPoint } from "@/types/questionBank";

export interface ExamPointPickerProps {
  value: ExamPoint[];
  onChange: (next: ExamPoint[]) => void;
  disabled?: boolean;
}

/** 依 parent_id 算出每個考點的深度（樹狀縮排用） */
function withDepth(points: ExamPoint[]): (ExamPoint & { depth: number })[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const depthOf = (p: ExamPoint): number => {
    let d = 0;
    let cur = p;
    while (cur.parent_id !== null && byId.has(cur.parent_id) && d < 10) {
      cur = byId.get(cur.parent_id)!;
      d += 1;
    }
    return d;
  };
  return points.map((p) => ({ ...p, depth: depthOf(p) }));
}

export default function ExamPointPicker({
  value,
  onChange,
  disabled,
}: ExamPointPickerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [points, setPoints] = useState<ExamPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(h);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    apiClient
      .listExamPoints(debounced || undefined)
      .then((res) => {
        if (!cancelled) setPoints(res.items);
      })
      .catch((err) => {
        console.error("Failed to load exam points", err);
        if (!cancelled) setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);
  const rows = useMemo(() => withDepth(points), [points]);
  const needle = debounced.toLowerCase();

  const toggle = (ep: ExamPoint) => {
    if (selectedIds.has(ep.id)) {
      onChange(value.filter((v) => v.id !== ep.id));
    } else {
      onChange([...value, ep]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((ep) => (
          <Badge
            key={ep.id}
            variant="secondary"
            className="font-normal gap-1 pr-1"
            data-testid={`exam-point-chip-${ep.id}`}
          >
            {examPointLabel(ep, lang)}
            {!disabled && (
              <button
                type="button"
                className="rounded-full hover:bg-gray-300/60 p-0.5"
                onClick={() => toggle(ep)}
                aria-label={t("questionBank.form.removeExamPoint", {
                  name: examPointLabel(ep, lang),
                })}
              >
                <X size={12} />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-1.5 text-[13px]"
            data-testid="exam-point-picker-trigger"
          >
            {t("questionBank.form.pickExamPoints")}
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("questionBank.form.examPointSearchPlaceholder")}
            className="h-8 text-[13px] mb-2"
            data-testid="exam-point-search"
          />
          <div className="max-h-64 overflow-y-auto text-sm">
            {loading ? (
              <div className="py-4 text-center text-gray-500">
                {t("common.loading")}
              </div>
            ) : rows.length === 0 ? (
              <div className="py-4 text-center text-gray-500">
                {t("questionBank.form.noExamPoints")}
              </div>
            ) : (
              rows.map((ep) => {
                const selected = selectedIds.has(ep.id);
                // 關鍵字命中的是 alias 而非正式名稱時，附註讓老師知道為何出現
                const hitAlias =
                  needle &&
                  !examPointLabel(ep, lang).toLowerCase().includes(needle)
                    ? ep.aliases.find((a) => a.toLowerCase().includes(needle))
                    : undefined;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => toggle(ep)}
                    className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-100 ${
                      selected ? "text-blue-700" : "text-gray-800"
                    }`}
                    style={{
                      paddingLeft: `${8 + (needle ? 0 : ep.depth) * 14}px`,
                    }}
                    data-testid={`exam-point-option-${ep.id}`}
                  >
                    <span className="w-4 shrink-0">
                      {selected && <Check size={14} />}
                    </span>
                    <span className="flex-1 truncate">
                      {examPointLabel(ep, lang)}
                      {hitAlias && (
                        <span className="ml-1 text-xs text-gray-400">
                          ({hitAlias})
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * ScenarioContextCard — 情境對話的情境卡（題組文章＋圖），可收合（#1133）。
 *
 * - 展開：圖片在上（多張 → ImageCarousel compact 左右滑動、圓點、點圖放大），文章在下。
 * - 收合：一行＝第一張小縮圖（多張顯示「+N」）＋情境標題＋展開箭頭。
 * - `pinnedOpen`：電腦／平板橫式左欄常駐展開，不顯示收合鈕。
 * - 沒有文章也沒有圖（情境 C）時由外層決定不渲染。
 * 紫色（情境對話分類色，lib/practiceMode.ts）只用在這張卡與標題列的點綴。
 *
 * 另匯出 `RubricBar`：作答要求（global_rubric）一行，可收合，所有情境都顯示。
 */

import { useState } from "react";
import { BookOpen, ChevronDown, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ImageCarousel } from "@/components/ImageCarousel";
import { cn } from "@/lib/utils";
import type { ScenarioChatContext } from "./types";

interface Props {
  context: ScenarioChatContext;
  collapsed: boolean;
  onToggle: () => void;
  pinnedOpen?: boolean;
  className?: string;
}

export function hasContextCard(ctx: ScenarioChatContext) {
  return Boolean(ctx.content?.trim()) || ctx.images.length > 0;
}

export function ScenarioContextCard({
  context,
  collapsed,
  onToggle,
  pinnedOpen = false,
  className,
}: Props) {
  const { t } = useTranslation();
  const open = pinnedOpen || !collapsed;
  const first = context.images[0];
  const extra = context.images.length - 1;
  // 常駐展開（左欄）時標題列不可點，用 div 而非停用的按鈕
  const HeaderTag = pinnedOpen ? "div" : "button";
  // 收合時顯示文章第一句當預覽，展開時顯示標題
  // （不用 lookbehind regex：舊版 iOS Safari 不支援，會讓整包解析失敗）
  const para = context.content?.trim().split("\n")[0] ?? "";
  const firstLine = (para.match(/^.*?[.!?。！？](\s|$)/)?.[0] ?? para).trim();
  const rowText = open ? context.title : firstLine || context.title;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-purple-200 bg-white",
        className,
      )}
      aria-label={t("scenarioDialogue.chat.scenario")}
    >
      <HeaderTag
        {...(pinnedOpen
          ? {}
          : {
              type: "button" as const,
              onClick: onToggle,
              "aria-expanded": open,
            })}
        className="flex min-h-12 w-full items-center gap-3 bg-purple-50 px-3 py-2 text-left"
      >
        {!open && first && (
          <span className="relative h-10 w-14 shrink-0 overflow-hidden rounded-md border border-purple-100 bg-white">
            <img
              src={first.src}
              alt=""
              className="h-full w-full object-cover"
            />
            {extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-gray-900/50 text-xs font-semibold text-white">
                +{extra}
              </span>
            )}
          </span>
        )}
        {(open || !first) && (
          <BookOpen className="h-5 w-5 shrink-0 text-purple-600" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-purple-600">
            {t("scenarioDialogue.chat.scenario")}
          </span>
          <span className="block truncate font-semibold text-gray-900">
            {rowText}
          </span>
        </span>
        {!pinnedOpen && (
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-purple-600 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </HeaderTag>

      {open && (
        <div className="space-y-3 p-3">
          {context.images.length > 0 && (
            <ImageCarousel
              compact
              zoomable
              images={context.images.map((im) => ({
                src: im.src,
                caption: im.alt,
              }))}
              imageClassName="max-h-64 object-contain bg-gray-50"
              ariaLabel={t("scenarioDialogue.chat.scenarioImages")}
            />
          )}
          {context.content && (
            <p className="whitespace-pre-line text-base leading-relaxed text-gray-800">
              {context.content}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function RubricBar({ rubric }: { rubric: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ClipboardList className="h-4 w-4 shrink-0 text-gray-500" />
        <span className="shrink-0 font-medium text-gray-700">
          {t("scenarioDialogue.chat.rubric")}
        </span>
        <span
          className={cn("min-w-0 flex-1 text-gray-600", !open && "truncate")}
        >
          {open ? "" : rubric}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-gray-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <p className="whitespace-pre-line px-3 pb-3 text-sm text-gray-700">
          {rubric}
        </p>
      )}
    </div>
  );
}

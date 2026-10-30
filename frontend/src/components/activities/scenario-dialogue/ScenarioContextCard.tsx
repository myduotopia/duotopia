/**
 * 情境對話的說明卡（#1133）：作答要求卡、情境卡，以及開始後收合成的一條膠囊列。
 *
 * - `RubricCard`：作答要求（global_rubric）。UI 規範資訊色（藍色淺底＋左側粗藍邊＋📋），
 *   標題加粗，內文字級同題目（`.quiz-input-font`），不收合。
 * - `ScenarioContextCard`：情境（題組文章＋圖）。圖片在上（多張 → ImageCarousel compact
 *   左右滑動、圓點、點圖放大），文章在下。紫色（情境對話分類色，lib/practiceMode.ts）
 *   只用在這張卡與標題列的點綴。沒有文章也沒有圖（情境 C）時外層不渲染。
 * - `InfoStrip`：按「開始對話」後兩張卡收合成上方一條，內有 `[📋 作答要求] [📖 情境]`
 *   小膠囊，點哪個展開哪個（再點收起）；情境 C 只有作答要求膠囊。開啟中的膠囊用切換鈕的
 *   次要樣式（淺藍底藍字＋藍框，與 RevealCapsules 同一份 TOGGLE_ON_CLASS，#1158 E4）。
 * - 情境圖：`context.images` 來自 `scenario_settings.scenario_images`（fromApi，#1158 E5），
 *   學生頁、派發預覽、批改頁都用這張卡顯示；圖固定在卡片頂部，切換時不跳位。
 *
 * 開始前：手機在對話區依序顯示 作答要求卡 → 情境卡 → 底部「開始對話」；
 * 電腦（≥ lg）左欄同樣上下兩張卡、常駐展開（由 ScenarioChatActivity 排版）。
 */

import { BookOpen, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ImageCarousel } from "@/components/ImageCarousel";
import { cn } from "@/lib/utils";
import { TOGGLE_ON_CLASS } from "./RevealCapsules";
import type { ScenarioChatContext } from "./types";

export function hasContextCard(ctx: ScenarioChatContext) {
  return Boolean(ctx.content?.trim()) || ctx.images.length > 0;
}

export function RubricCard({ rubric }: { rubric: string }) {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-lg border border-l-4 border-blue-200 border-l-blue-600 bg-blue-50 p-3"
      aria-label={t("scenarioDialogue.chat.rubric")}
    >
      <h2 className="flex items-center gap-2 font-bold text-blue-800">
        <ClipboardList className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
        {t("scenarioDialogue.chat.rubric")}
      </h2>
      <p className="quiz-input-font mt-1 whitespace-pre-line leading-snug text-gray-900">
        {rubric}
      </p>
    </section>
  );
}

interface CardProps {
  context: ScenarioChatContext;
  className?: string;
}

export function ScenarioContextCard({ context, className }: CardProps) {
  const { t } = useTranslation();
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-purple-200 bg-white",
        className,
      )}
      aria-label={t("scenarioDialogue.chat.scenario")}
    >
      <div className="flex min-h-12 items-center gap-3 bg-purple-50 px-3 py-2">
        <BookOpen className="h-5 w-5 shrink-0 text-purple-600" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-purple-600">
            {t("scenarioDialogue.chat.scenario")}
          </span>
          <span className="block truncate font-semibold text-gray-900">
            {context.title}
          </span>
        </span>
      </div>
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
    </section>
  );
}

export type InfoPanel = "rubric" | "scenario" | null;

interface StripProps {
  context: ScenarioChatContext;
  showScenario: boolean;
  open: InfoPanel;
  onOpenChange: (panel: InfoPanel) => void;
}

/** 開始後的收合列（只在 < lg 使用）；展開的卡片限制高度、可捲動 */
export function InfoStrip({
  context,
  showScenario,
  open,
  onOpenChange,
}: StripProps) {
  const { t } = useTranslation();
  const toggle = (p: Exclude<InfoPanel, null>) =>
    onOpenChange(open === p ? null : p);
  const pill = "h-11 rounded-full px-3";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {context.rubric && (
          <Button
            type="button"
            variant="outline"
            className={cn(pill, open === "rubric" && TOGGLE_ON_CLASS)}
            onClick={() => toggle("rubric")}
            aria-expanded={open === "rubric"}
          >
            <ClipboardList className="mr-1 h-4 w-4" />
            {t("scenarioDialogue.chat.rubric")}
          </Button>
        )}
        {showScenario && (
          <Button
            type="button"
            variant="outline"
            className={cn(pill, open === "scenario" && TOGGLE_ON_CLASS)}
            onClick={() => toggle("scenario")}
            aria-expanded={open === "scenario"}
          >
            <BookOpen className="mr-1 h-4 w-4" />
            {t("scenarioDialogue.chat.scenario")}
          </Button>
        )}
      </div>
      {open && (
        <div className="max-h-[45dvh] overflow-y-auto rounded-xl">
          {open === "rubric" && context.rubric ? (
            <RubricCard rubric={context.rubric} />
          ) : (
            <ScenarioContextCard context={context} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * QuestionBubble — 情境對話聊天流中的「AI 提問」氣泡（#1133）。
 *
 * 單層氣泡（#1158 E-2 A 方案）：沒有外框線，只有淡灰底；翻譯直接灰字排在英文下面，不加框。
 * 先聽後看：`[🔊] [Aa 英] [中]` 小膠囊（RevealCapsules），英／翻譯可切換顯示、收起；
 * 翻譯鈕只在 showTranslation（老師開翻譯＋翻譯語言＝學生介面語言，由外層算好）且英文已打開時
 * 出現，否則不渲染。老師設定「文字預設顯示」時英文一開始就打開（由 visible 帶入）。
 * 題目圖片固定在氣泡頂部（多張 → ImageCarousel compact 輪播、點圖放大）。
 * 關鍵字一律可見；rubric_note 作答提示預設收合。
 * 老師預覽另有：參考答案開關、「本題平均」徽章、「略過」標記。
 * 重答改由每題最後一則建議氣泡的「再試一次」處理（FeedbackBubble），這裡不放按鈕。
 */

import { useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ImageCarousel } from "@/components/ImageCarousel";
import { cn } from "@/lib/utils";
import { RevealCapsules } from "./RevealCapsules";
import { AiRow } from "./TypingIndicator";
import type { ScenarioChatItem, TextRevealState } from "./types";

interface Props {
  index: number;
  total: number;
  item: ScenarioChatItem;
  /** 英／中目前是否顯示 */
  visible: TextRevealState;
  /** 本題可以看翻譯（老師開翻譯＋翻譯語言＝學生介面語言＋有翻譯文字） */
  showTranslation: boolean;
  isPreviewMode: boolean;
  skipped: boolean;
  averageScore: number | null;
  onPlay: () => void;
  onToggle: (which: "en" | "zh") => void;
}

export function QuestionBubble({
  index,
  total,
  item,
  visible,
  showTranslation,
  isPreviewMode,
  skipped,
  averageScore,
  onPlay,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const [hintOpen, setHintOpen] = useState(false);
  const [showRef, setShowRef] = useState(false);

  return (
    <AiRow>
      <div
        className="max-w-[min(100%,36rem)] overflow-hidden rounded-2xl rounded-tl-sm bg-gray-100"
        data-testid="scenario-question"
      >
        {item.images.length > 0 && (
          <div className="p-2 pb-0">
            <ImageCarousel
              compact
              zoomable
              images={item.images.map((im) => ({
                src: im.src,
                caption: im.alt,
              }))}
              imageClassName="max-h-56 rounded-lg object-contain bg-white"
              ariaLabel={t("scenarioDialogue.chat.questionImages")}
            />
          </div>
        )}

        <div className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              {t("scenarioDialogue.chat.questionNo", {
                no: index + 1,
                total,
              })}
            </span>
            {skipped && (
              <Badge variant="outline" className="text-gray-500">
                {t("scenarioDialogue.chat.skipped")}
              </Badge>
            )}
            {isPreviewMode && averageScore !== null && (
              <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                {t("scenarioDialogue.chat.averageScore", {
                  score: averageScore,
                })}
              </Badge>
            )}
          </div>

          <RevealCapsules
            enOn={visible.en}
            zhOn={visible.zh}
            showTranslation={showTranslation}
            onPlay={onPlay}
            onToggleEn={() => onToggle("en")}
            onToggleZh={() => onToggle("zh")}
          />

          {visible.en && (
            <p className="quiz-input-font font-medium leading-snug text-gray-900">
              {item.text}
            </p>
          )}
          {visible.en && visible.zh && showTranslation && (
            <p className="quiz-translation-font text-gray-600">
              {item.translation}
            </p>
          )}

          {item.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">
                {t("scenarioDialogue.chat.keywords")}
              </span>
              {item.keywords.map((k) => (
                <Badge key={k} variant="outline" className="bg-white">
                  {k}
                </Badge>
              ))}
            </div>
          )}

          {item.rubricNote && (
            <div className="rounded-lg bg-amber-50">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-1.5 px-3 text-left text-sm font-medium text-amber-800"
                onClick={() => setHintOpen((o) => !o)}
                aria-expanded={hintOpen}
              >
                <Lightbulb className="h-4 w-4 shrink-0" />
                <span className="flex-1">
                  {t("scenarioDialogue.chat.hint")}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    hintOpen && "rotate-180",
                  )}
                />
              </button>
              {hintOpen && (
                <p className="whitespace-pre-line px-3 pb-3 text-sm text-amber-900">
                  {item.rubricNote}
                </p>
              )}
            </div>
          )}

          {isPreviewMode && item.referenceAnswer && (
            <div className="space-y-1.5 border-t border-gray-100 pt-2">
              <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
                <Switch checked={showRef} onCheckedChange={setShowRef} />
                {t("scenarioDialogue.chat.referenceAnswer")}
              </label>
              {showRef && (
                <p className="rounded-lg bg-green-50 p-2 text-sm text-green-900">
                  {item.referenceAnswer}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </AiRow>
  );
}

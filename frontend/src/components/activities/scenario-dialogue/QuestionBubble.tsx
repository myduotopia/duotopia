/**
 * QuestionBubble — 情境對話聊天流中的「AI 提問」氣泡（#1133）。
 *
 * 先聽後看（三段式）：預設只有播放鈕 →「看英文」顯示題目 → 英文出現後才有「看中文」
 * （老師沒開翻譯就不出現）。老師設定「文字預設顯示」時英文一開始就展開（由 reveal 帶入）。
 * 題目圖片固定在氣泡頂部（多張 → ImageCarousel compact 輪播、點圖放大）。
 * 關鍵字一律可見；rubric_note 作答提示預設收合。
 * 老師預覽另有：參考答案開關、「本題平均」徽章、「略過」標記。
 */

import { useState } from "react";
import { ChevronDown, Eye, Languages, Lightbulb, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ImageCarousel } from "@/components/ImageCarousel";
import { cn } from "@/lib/utils";
import { AiRow } from "./TypingIndicator";
import type { ScenarioChatItem, TextRevealState } from "./types";

interface Props {
  index: number;
  total: number;
  item: ScenarioChatItem;
  reveal: TextRevealState;
  showTranslation: boolean;
  isPreviewMode: boolean;
  skipped: boolean;
  averageScore: number | null;
  onPlay: () => void;
  onReveal: (which: "en" | "zh") => void;
  /** 結束後可補答時才傳 */
  onReanswer?: () => void;
}

export function QuestionBubble({
  index,
  total,
  item,
  reveal,
  showTranslation,
  isPreviewMode,
  skipped,
  averageScore,
  onPlay,
  onReveal,
  onReanswer,
}: Props) {
  const { t } = useTranslation();
  const [hintOpen, setHintOpen] = useState(false);
  const [showRef, setShowRef] = useState(false);

  return (
    <AiRow>
      <div className="max-w-[min(100%,36rem)] overflow-hidden rounded-2xl rounded-tl-sm border border-gray-200 bg-white">
        {item.images.length > 0 && (
          <div className="border-b border-gray-100 bg-gray-50 p-2">
            <ImageCarousel
              compact
              zoomable
              images={item.images.map((im) => ({
                src: im.src,
                caption: im.alt,
              }))}
              imageClassName="max-h-56 object-contain bg-white"
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onPlay}
              aria-label={t("scenarioDialogue.chat.playQuestion")}
            >
              <Volume2 className="mr-1 h-5 w-5" />
              {t("scenarioDialogue.chat.listen")}
            </Button>
            {!reveal.en && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => onReveal("en")}
              >
                <Eye className="mr-1 h-4 w-4" />
                {t("scenarioDialogue.chat.showEnglish")}
              </Button>
            )}
            {reveal.en && showTranslation && !reveal.zh && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => onReveal("zh")}
              >
                <Languages className="mr-1 h-4 w-4" />
                {t("scenarioDialogue.chat.showChinese")}
              </Button>
            )}
          </div>

          {reveal.en && (
            <p className="quiz-input-font font-medium leading-snug text-gray-900">
              {item.text}
            </p>
          )}
          {reveal.en && showTranslation && reveal.zh && item.translation && (
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
                <Badge key={k} variant="outline" className="bg-gray-50">
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

          {onReanswer && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onReanswer}
            >
              {t("scenarioDialogue.chat.reanswer")}
            </Button>
          )}
        </div>
      </div>
    </AiRow>
  );
}

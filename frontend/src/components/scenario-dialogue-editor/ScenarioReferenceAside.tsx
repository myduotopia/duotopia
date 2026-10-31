/**
 * 右欄的情境區（Issue #1158 C commit 4，由 #1146 題目清單左欄的唯讀對照
 * `ScenarioReferenceAside` 改寫；檔名沿用）。
 *
 * 同頁版面（規格第 0、1 點）：情境在對話裡建立，老師按「用這篇情境」後，對話只留一句
 * 「已確認情境」，情境改固定顯示在右欄題目上方，就是這一塊。
 *
 * - 預設展開、可收合（收合後只剩標題列）。
 * - 「編輯」原地修改：文章框可改；情境圖可刪除、補傳、AI 生圖、重新裁切（共用
 *   `ScenarioImageStrip`）；AI 寫的文章另有「訓練目標」欄、文章難度和「重寫」鈕，按重寫
 *   先確認「會重寫情境文章」（`ConfirmDialog`，文字見 `scenarioSteps.REWRITE_ARTICLE_CONFIRM`）。
 *   按「完成」回到唯讀。
 * - 原本對照區的作答指引、整體評分標準（時態、語態）和「回對話修改」都拿掉了，改到左上
 *   「設定」標籤的小框裡（規格第 1 點）。
 * - 左上「情境」標籤小框的「編輯情境內容」會把畫面帶到這裡並打開編輯（面板用 `ref`
 *   捲過來；窄版先切到「題目」分頁）。
 */
import { forwardRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { CefrChips } from "@/components/shared/guided-chat/CefrChips";
import { resolveText } from "@/components/shared/guided-chat/flowEngine";
import { ScenarioImageStrip } from "./ScenarioImageStrip";
import { REWRITE_ARTICLE_CONFIRM, type ScenarioMode } from "./scenarioSteps";
import type { ScenarioImageActions } from "./useScenarioImages";

export interface ScenarioReferenceAsideProps {
  mode: ScenarioMode;
  scenarioContent: string;
  onScenarioContentChange: (value: string) => void;
  imageActions: ScenarioImageActions;
  /** AI 寫的文章才有：訓練目標、文章難度、重寫 */
  goal: string;
  onGoalChange: (value: string) => void;
  articleLevel: string;
  onArticleLevelChange: (value: string) => void;
  /** 老師確認過「會重寫情境文章」之後才呼叫 */
  onRewrite: () => void;
  rewriting: boolean;
  /** 其他 AI 工作進行中（擷取、情境圖），重寫鈕要擋 */
  busy: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

export const ScenarioReferenceAside = forwardRef<
  HTMLElement,
  ScenarioReferenceAsideProps
>(function ScenarioReferenceAside(props, ref) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const { editing } = props;
  // 打開編輯時一定要看得到內容
  const open = expanded || editing;

  return (
    <section
      ref={ref}
      data-testid="scenario-context-section"
      aria-label={t("scenarioDialogue.context.title")}
      className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold text-gray-800">
          {t("scenarioDialogue.context.title")}
        </span>
        {editing ? (
          <Button size="sm" onClick={() => props.onEditingChange(false)}>
            {t("scenarioDialogue.context.done")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            onClick={() => props.onEditingChange(true)}
          >
            {t("scenarioDialogue.context.edit")}
          </Button>
        )}
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-gray-500"
            aria-expanded={open}
            aria-label={
              open
                ? t("scenarioDialogue.buttons.collapseScenario")
                : t("scenarioDialogue.buttons.expandScenario")
            }
            onClick={() => setExpanded((v) => !v)}
          >
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {open && !editing && (
        <div className="rounded-md border border-blue-100 bg-white p-2.5 space-y-3">
          {props.scenarioContent.trim() ? (
            <p
              data-testid="reference-scenario-text"
              className="text-sm text-gray-700 whitespace-pre-wrap break-words"
            >
              {props.scenarioContent}
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              {t("scenarioDialogue.hints.noContextYet")}
            </p>
          )}
          <ScenarioImageStrip actions={props.imageActions} readOnly />
        </div>
      )}

      {editing && (
        <div className="rounded-md border border-blue-100 bg-white p-2.5 space-y-3">
          {props.mode === "ai" && (
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="block text-xs font-semibold text-gray-700">
                  {t("scenarioDialogue.labels.goal")}
                </span>
                <Textarea
                  value={props.goal}
                  onChange={(e) => props.onGoalChange(e.target.value)}
                  rows={2}
                  placeholder={t("scenarioDialogue.placeholders.goal")}
                  className="min-h-0 resize-y"
                />
              </label>
              <div>
                <span className="mb-1 block text-xs font-semibold text-gray-700">
                  {t("scenarioDialogue.labels.articleLevel")}
                </span>
                <CefrChips
                  value={props.articleLevel}
                  onChange={props.onArticleLevelChange}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRewrite(true)}
                  disabled={props.rewriting || props.busy || !props.goal.trim()}
                >
                  {props.rewriting ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                  )}
                  {props.rewriting
                    ? t("scenarioDialogue.context.rewriting")
                    : t("scenarioDialogue.context.rewrite")}
                </Button>
                <span className="text-xs text-gray-500">
                  {t("scenarioDialogue.context.rewriteHint")}
                </span>
              </div>
            </div>
          )}
          <label className="block space-y-1">
            <span className="block text-xs font-semibold text-gray-700">
              {t("scenarioDialogue.labels.scenarioContent")}
            </span>
            <Textarea
              value={props.scenarioContent}
              onChange={(e) => props.onScenarioContentChange(e.target.value)}
              rows={6}
              placeholder={t("scenarioDialogue.placeholders.scenarioContent")}
              aria-label={t("scenarioDialogue.labels.scenarioText")}
              className="min-h-0 max-h-[60vh] resize-y overflow-y-auto"
            />
          </label>
          <ScenarioImageStrip
            actions={props.imageActions}
            scenarioContent={props.scenarioContent}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmRewrite}
        onOpenChange={setConfirmRewrite}
        title={resolveText(REWRITE_ARTICLE_CONFIRM.title, t)}
        description={resolveText(REWRITE_ARTICLE_CONFIRM.description, t)}
        confirmText={resolveText(REWRITE_ARTICLE_CONFIRM.confirmLabel, t)}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={() => {
          setConfirmRewrite(false);
          props.onRewrite();
        }}
      />
    </section>
  );
});

/**
 * 情境對話的引導式對話（Issue #1146）—— 取代舊的 Step 1 設定頁。
 *
 * 一次問一件事，選項是按鈕；老師打字只當作「當下那一步」的答案（流程見 `setupFlow.ts`）。
 *
 * - 已答的步驟顯示成「問句＋老師的回答」，旁邊有「改選」。後面還有已答步驟時先跳確認
 *   「後面的設定會清空，已產生的題目保留」（`ConfirmDialog`）。
 * - 目前這一步下方有「回上一步」。
 * - 答非所問：AI 寫情境（訓練目標）與 AI 出題（出題方向）由同一次 AI 呼叫判斷，不可用就
 *   在該步驟顯示重問句（`goalReask` / `directionReask`），不產內容。
 * - 產生前的確認句帶出老師原話。
 *
 * state 全部由面板持有（存檔、題目清單都要用），這個元件只負責畫與回報老師的選擇。
 */
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { CEFR_LEVELS } from "./constants";
import { ScenarioImageStrip } from "./ScenarioImageStrip";
import type { ScenarioImageActions } from "./useScenarioImages";
import {
  QUESTION_SOURCES,
  SCENARIO_MODES,
  activeStep,
  isAnswered,
  needsReopenConfirm,
  previousStep,
  stepsFor,
  type QuestionSource,
  type ScenarioMode,
  type SetupAnswers,
  type SetupStep,
} from "./setupFlow";

export interface ScenarioSetupChatProps {
  answers: SetupAnswers;
  /** 重開某一步（已確認過）。面板負責清掉對應資料 */
  onReopen: (step: SetupStep) => void;
  onChooseMode: (mode: ScenarioMode) => void;
  onChooseSource: (source: QuestionSource) => void;
  onScenarioDone: () => void;
  onDirectionDone: () => void;

  scenarioContent: string;
  onScenarioContentChange: (value: string) => void;
  goal: string;
  onGoalChange: (value: string) => void;
  articleLevel: string;
  onArticleLevelChange: (value: string) => void;
  direction: string;
  onDirectionChange: (value: string) => void;
  goalReask: string;
  directionReask: string;

  imageActions: ScenarioImageActions;
  generatingArticle: boolean;
  extracting: boolean;
  onGenerateArticle: () => void;
  onExtractFiles: (files: File[]) => void;

  /** 出題設定卡（面板組好傳進來，參數太多不在這裡轉手） */
  settingsCard: ReactNode;
  hasQuestions: boolean;
  onViewList: () => void;
}

function BotBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
        <Bot className="h-4 w-4" />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

function TeacherBubble({
  children,
  onChange,
}: {
  children: ReactNode;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-2">
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-xs text-blue-600 hover:underline"
        >
          {t("scenarioDialogue.setup.change")}
        </button>
      )}
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

export function ScenarioSetupChat(props: ScenarioSetupChatProps) {
  const { t } = useTranslation();
  const { answers } = props;
  const [pendingReopen, setPendingReopen] = useState<SetupStep | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const steps = stepsFor(answers);
  const current = activeStep(answers);
  const prev = previousStep(answers);
  const busy =
    props.generatingArticle || props.extracting || props.imageActions.busy;

  const requestReopen = (step: SetupStep) => {
    if (busy) return;
    if (needsReopenConfirm(step, answers)) setPendingReopen(step);
    else props.onReopen(step);
  };

  const question = (step: SetupStep) => {
    if (step === "scenario") {
      return answers.scenarioMode === "ai"
        ? t("scenarioDialogue.setup.q.scenarioAi")
        : t("scenarioDialogue.setup.q.scenarioExisting");
    }
    return t(`scenarioDialogue.setup.q.${step}`);
  };

  const answerText = (step: SetupStep): string => {
    switch (step) {
      case "mode":
        return t(`scenarioDialogue.setup.modes.${answers.scenarioMode}`);
      case "goal":
        return t("scenarioDialogue.setup.answers.goal", {
          goal: props.goal.trim(),
          level: props.articleLevel,
        });
      case "scenario":
        return t("scenarioDialogue.setup.answers.scenario", {
          chars: props.scenarioContent.trim().length,
          images: props.imageActions.images.length,
        });
      case "source":
        return t(`scenarioDialogue.setup.sources.${answers.questionSource}`);
      case "direction":
        return `「${props.direction.trim()}」`;
      default:
        return "";
    }
  };

  const scenarioReady =
    !!props.scenarioContent.trim() || props.imageActions.images.length > 0;

  const renderActive = (step: SetupStep) => {
    switch (step) {
      case "mode":
        return (
          <div className="flex flex-wrap gap-2 pl-9">
            {SCENARIO_MODES.map((mode) => (
              <Button
                key={mode}
                variant="outline"
                onClick={() => props.onChooseMode(mode)}
              >
                {t(`scenarioDialogue.setup.modes.${mode}`)}
              </Button>
            ))}
          </div>
        );

      case "goal":
        return (
          <div className="space-y-3 pl-9">
            {props.goalReask && <BotBubble>{props.goalReask}</BotBubble>}
            <textarea
              value={props.goal}
              onChange={(e) => props.onGoalChange(e.target.value)}
              rows={2}
              placeholder={t("scenarioDialogue.placeholders.goal")}
              aria-label={t("scenarioDialogue.labels.goal")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <div>
              <span className="text-xs text-gray-600 mb-1 block">
                {t("scenarioDialogue.labels.articleLevel")}
              </span>
              <div className="flex flex-wrap gap-1">
                {CEFR_LEVELS.map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    aria-pressed={props.articleLevel === lv}
                    onClick={() => props.onArticleLevelChange(lv)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      props.articleLevel === lv
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            </div>
            {props.generatingArticle && (
              <BotBubble>
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("scenarioDialogue.setup.writingArticle", {
                    goal: props.goal.trim(),
                    level: props.articleLevel,
                  })}
                </span>
              </BotBubble>
            )}
            <Button
              onClick={props.onGenerateArticle}
              disabled={busy || !props.goal.trim()}
            >
              <Sparkles className="mr-1 h-4 w-4" />
              {t("scenarioDialogue.setup.writeArticle")}
            </Button>
          </div>
        );

      case "scenario":
        return (
          <div className="space-y-3 pl-9">
            {answers.scenarioMode === "existing" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  {props.extracting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {props.extracting
                    ? t("scenarioDialogue.setup.extracting")
                    : t("scenarioDialogue.setup.uploadFile")}
                </Button>
                <span className="text-xs text-gray-400">
                  {t("scenarioDialogue.setup.uploadHint")}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length) props.onExtractFiles(Array.from(files));
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <textarea
              value={props.scenarioContent}
              onChange={(e) => props.onScenarioContentChange(e.target.value)}
              rows={6}
              placeholder={t("scenarioDialogue.placeholders.scenarioContent")}
              aria-label={t("scenarioDialogue.labels.scenarioText")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <ScenarioImageStrip actions={props.imageActions} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={props.onScenarioDone}
                disabled={busy || !scenarioReady}
              >
                {t("scenarioDialogue.setup.next")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        );

      case "source":
        return (
          <div className="flex flex-wrap gap-2 pl-9">
            {QUESTION_SOURCES.map((source) => (
              <Button
                key={source}
                variant="outline"
                onClick={() => props.onChooseSource(source)}
              >
                {t(`scenarioDialogue.setup.sources.${source}`)}
              </Button>
            ))}
          </div>
        );

      case "direction":
        return (
          <div className="space-y-3 pl-9">
            {props.directionReask && (
              <BotBubble>{props.directionReask}</BotBubble>
            )}
            <textarea
              value={props.direction}
              onChange={(e) => props.onDirectionChange(e.target.value)}
              rows={2}
              placeholder={t("scenarioDialogue.setup.directionPlaceholder")}
              aria-label={t("scenarioDialogue.setup.q.direction")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm resize-y focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <Button
              onClick={props.onDirectionDone}
              disabled={!props.direction.trim()}
            >
              {t("scenarioDialogue.setup.next")}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        );

      case "settings":
        return <div className="pl-9">{props.settingsCard}</div>;
    }
  };

  const settingsIntro =
    answers.scenarioMode === "none" && props.direction.trim()
      ? t("scenarioDialogue.setup.q.settingsWithDirection", {
          direction: props.direction.trim(),
        })
      : t("scenarioDialogue.setup.q.settings");

  return (
    <div className="flex-1 min-h-0">
      <div className="max-w-3xl space-y-4" data-testid="scenario-setup-chat">
        {steps.map((step) => {
          const answered = isAnswered(step, answers);
          const isCurrent = step === current;
          if (!answered && !isCurrent) return null;
          return (
            <div key={step} className="space-y-2" data-step={step}>
              <BotBubble>
                {step === "settings" ? settingsIntro : question(step)}
              </BotBubble>
              {answered ? (
                <TeacherBubble onChange={() => requestReopen(step)}>
                  {answerText(step)}
                </TeacherBubble>
              ) : (
                renderActive(step)
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
          {prev && current && (
            <Button
              variant="outline"
              onClick={() => requestReopen(prev)}
              disabled={busy}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("scenarioDialogue.setup.back")}
            </Button>
          )}
          <span className="flex-1" />
          {/* 回到對話改設定後，不必重產也要能回題目清單（已產生的題目保留） */}
          {(props.hasQuestions || current === null) &&
            current !== "settings" && (
              <Button
                variant={current === null ? "default" : "outline"}
                onClick={props.onViewList}
                disabled={busy}
              >
                {t("scenarioDialogue.buttons.viewQuestions")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingReopen !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReopen(null);
        }}
        title={t("scenarioDialogue.setup.reopenConfirmTitle")}
        description={t("scenarioDialogue.setup.reopenConfirmDescription")}
        confirmText={t("scenarioDialogue.setup.reopenConfirm")}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={() => {
          if (pendingReopen) props.onReopen(pendingReopen);
          setPendingReopen(null);
        }}
      />
    </div>
  );
}

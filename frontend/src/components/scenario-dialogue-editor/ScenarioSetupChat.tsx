/**
 * 情境對話的引導式對話（Issue #1146）—— 取代舊的 Step 1 設定頁。
 *
 * 一次問一件事，選項是按鈕；老師打字只當作「當下那一步」的答案（流程見 `setupFlow.ts`）。
 *
 * - 已答的步驟顯示成「問句＋老師的回答」，旁邊有「改選」。後面還有已答步驟時先跳確認
 *   「後面的設定會清空，已產生的題目保留」（`ConfirmDialog`）。
 * - 底部操作列（修正第 2 輪；第 4 輪起固定在 sheet 最底端，見 `ScenarioSheetLayout`）：
 *   左＝「回上一步」，右＝目前這一步的主要動作（請 AI 寫情境／下一步／開始產生，同一時間
 *   只有一個主按鈕）。選項型步驟（需要情境嗎？、題目怎麼來？）沒有主要動作，右側只在已有
 *   題目時放「查看題目清單」；左右都沒有按鈕時（第一步）不畫操作列。手機上「回上一步」
 *   只留圖示（名稱放 aria-label），讓操作列維持一排。
 *   已有題目、停在設定卡（從題目清單回來改設定）或全部答完時，主按鈕＝「查看題目清單」，
 *   「再產一批」降為次要（第 3 輪）。從清單回來時把捲動區捲到最新一步的開頭（操作列固定
 *   在底端本來就看得到，第 4 輪）。
 * - 對話內容從上往下排（不做由下往上堆）；內容短時中間留白。AI 額度提示小字放在捲動區
 *   設定卡下方，不塞進操作列。
 * - 選項型步驟用直排選項卡（`ChoiceCards`，第 3 輪）：等寬、左對齊、粗體主句＋可選灰色
 *   說明行（說明以 aria-describedby 掛上，按鈕名稱＝主句）；老師泡泡只顯示主句。
 * - 版面：對話區撐滿 sheet 寬，老師泡泡貼右（像一般聊天）；每一步的輸入區另限 `max-w-3xl`，
 *   免得文字框在寬螢幕被拉得太長。sm 以上輸入區內縮 `pl-9` 對齊機器人泡泡，手機不內縮
 *   （第 3 輪，免得欄位被擠窄）。情境框依內容自動長高，上限 60vh 之後內捲
 *   （高度含上下邊框；只在內容變時重算，不掛 ResizeObserver，第 3b 輪）。
 *   右側浮動工具列的留白與手機鍵盤跳出時的欄位捲動由 `ScenarioSheetLayout` 處理。
 * - 答非所問：AI 寫情境（訓練目標）與 AI 出題（出題方向）由同一次 AI 呼叫判斷，不可用就
 *   在該步驟顯示重問句（`goalReask` / `directionReask`），不產內容。
 * - 產生前的確認句帶出老師原話。
 *
 * state 全部由面板持有（存檔、題目清單都要用），這個元件只負責畫與回報老師的選擇。
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import { CEFR_LEVELS } from "./constants";
import { ScenarioImageStrip } from "./ScenarioImageStrip";
import { ScenarioActionBar, ScenarioScrollArea } from "./ScenarioSheetLayout";
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
  /**
   * 選這個答案會不會清掉已填的情境（情境框文字、情境圖）。會的話先跳確認（review 2）
   * —— 老師停在情境那一步、打好字還沒按下一步就回頭改選時，後面沒有已答步驟，
   * 只靠「改選」的確認擋不到。
   */
  wouldClearScenario: (mode: ScenarioMode) => boolean;
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

  /** 出題設定卡（只有設定欄位；面板組好傳進來，參數太多不在這裡轉手） */
  settingsCard: ReactNode;
  /** 設定卡那一步的「開始產生」放在底部列，由這裡畫 */
  generating: boolean;
  /** 清單已滿 10 題時不能再產；給原因（按鈕停用要說明） */
  generateBlockedReason: string | null;
  onGenerate: () => void;
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

/** 有灰色說明行的情境選項（其餘選項只有主句） */
const MODE_HINTS: ReadonlySet<ScenarioMode> = new Set(["existing"]);

interface ChoiceOption<T extends string> {
  value: T;
  /** 粗體主句 —— 也是按鈕的無障礙名稱，選完後老師泡泡只顯示這一句 */
  label: string;
  /** 選填的灰色說明行（以 aria-describedby 掛上，不併入按鈕名稱） */
  hint?: string;
}

/**
 * 選項型步驟的直排選項卡（第 3 輪）：等寬、左對齊、粗體主句＋可選灰色說明行。
 * 選項文字變長後橫排按鈕會換行換得很亂，直排比較好讀。
 * 「需要情境嗎？」與「題目怎麼來？」共用，兩步的外觀一致。
 */
function ChoiceCards<T extends string>({
  options,
  onChoose,
}: {
  options: ChoiceOption<T>[];
  onChoose: (value: T) => void;
}) {
  const idPrefix = useId();
  return (
    <div className="flex max-w-xl flex-col gap-2 sm:pl-9">
      {options.map((opt) => {
        const hintId = opt.hint ? `${idPrefix}-${opt.value}` : undefined;
        return (
          <Button
            key={opt.value}
            variant="outline"
            aria-label={opt.label}
            aria-describedby={hintId}
            onClick={() => onChoose(opt.value)}
            className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-gray-800">
              {opt.label}
            </span>
            {opt.hint && (
              <span id={hintId} className="text-xs font-normal text-gray-500">
                {opt.hint}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}

export function ScenarioSetupChat(props: ScenarioSetupChatProps) {
  const { t } = useTranslation();
  const { answers } = props;
  const [pendingReopen, setPendingReopen] = useState<SetupStep | null>(null);
  const [pendingMode, setPendingMode] = useState<ScenarioMode | null>(null);
  /**
   * 剛確認過「改選需要情境嗎？」（說明已經講了後面會清空）時，接著選不同答案就不再
   * 問第二次；選完就歸零。
   */
  const modeReopenConfirmedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 情境框依內容自動長高（上限 60vh 由 CSS 限制，超過才內捲） */
  const scenarioBoxRef = useRef<HTMLTextAreaElement>(null);
  /** 捲動區：從題目清單回到對話時，捲到最新一步的開頭 */
  const scrollRef = useRef<HTMLDivElement>(null);

  // 用 useLayoutEffect：在瀏覽器畫出來之前量好高度，打字時不會先閃一下捲軸。
  // scrollHeight 不含邊框，而 Textarea 是 border-box，所以要補上
  // offsetHeight - clientHeight（上下邊框），否則末行會被切掉、提早出現捲軸。
  // 刻意只在內容（或情境框重新出現）時重算，不掛 ResizeObserver：視窗寬度改變造成的
  // 換行差異，老師下一次打字就會修正，不值得為此多一個常駐監聽。
  useLayoutEffect(() => {
    const el = scenarioBoxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [props.scenarioContent, answers.scenarioMode, answers.scenarioDone]);

  // 只在掛載時跑：已有題目＝老師是從題目清單按「上一步」回來的。
  // 操作列固定在底端本來就看得到，所以捲到最新一步（通常是設定卡）的開頭，
  // 老師一眼看到問句與要改的欄位（第 4 輪）。
  useEffect(() => {
    if (props.hasQuestions) {
      const blocks = scrollRef.current?.querySelectorAll("[data-step]");
      blocks?.[blocks.length - 1]?.scrollIntoView?.({ block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const chooseMode = (mode: ScenarioMode) => {
    const confirmed = modeReopenConfirmedRef.current;
    modeReopenConfirmedRef.current = false;
    if (!confirmed && props.wouldClearScenario(mode)) setPendingMode(mode);
    else props.onChooseMode(mode);
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
          <ChoiceCards
            options={SCENARIO_MODES.map((mode) => ({
              value: mode,
              label: t(`scenarioDialogue.setup.modes.${mode}`),
              hint: MODE_HINTS.has(mode)
                ? t(`scenarioDialogue.setup.modeHints.${mode}`)
                : undefined,
            }))}
            onChoose={chooseMode}
          />
        );

      case "goal":
        return (
          <div className="max-w-3xl space-y-3 sm:pl-9">
            {props.goalReask && <BotBubble>{props.goalReask}</BotBubble>}
            <Textarea
              value={props.goal}
              onChange={(e) => props.onGoalChange(e.target.value)}
              rows={2}
              placeholder={t("scenarioDialogue.placeholders.goal")}
              aria-label={t("scenarioDialogue.labels.goal")}
              className="min-h-0 resize-y"
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
          </div>
        );

      case "scenario":
        return (
          <div className="max-w-3xl space-y-3 sm:pl-9">
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
            <Textarea
              ref={scenarioBoxRef}
              value={props.scenarioContent}
              onChange={(e) => props.onScenarioContentChange(e.target.value)}
              rows={6}
              placeholder={t("scenarioDialogue.placeholders.scenarioContent")}
              aria-label={t("scenarioDialogue.labels.scenarioText")}
              className="min-h-0 max-h-[60vh] resize-y overflow-y-auto"
            />
            <ScenarioImageStrip actions={props.imageActions} />
          </div>
        );

      case "source":
        return (
          <ChoiceCards
            options={QUESTION_SOURCES.map((source) => ({
              value: source,
              label: t(`scenarioDialogue.setup.sources.${source}`),
            }))}
            onChoose={props.onChooseSource}
          />
        );

      case "direction":
        return (
          <div className="max-w-3xl space-y-3 sm:pl-9">
            {props.directionReask && (
              <BotBubble>{props.directionReask}</BotBubble>
            )}
            <Textarea
              value={props.direction}
              onChange={(e) => props.onDirectionChange(e.target.value)}
              rows={2}
              placeholder={t("scenarioDialogue.setup.directionPlaceholder")}
              aria-label={t("scenarioDialogue.setup.q.direction")}
              className="min-h-0 resize-y"
            />
          </div>
        );

      case "settings":
        return (
          <div className="max-w-3xl space-y-2 sm:pl-9">
            {props.settingsCard}
            {/* 額度提示放捲動區（不塞進固定操作列，手機上操作列才維持一排） */}
            <p className="text-right text-xs text-gray-400">
              {t("scenarioDialogue.hints.rateLimit")}
            </p>
          </div>
        );
    }
  };

  /**
   * 「查看題目清單」是不是這一刻的主按鈕（第 3 輪）：全部答完（自己出題），或已經有題目、
   * 停在設定卡（從題目清單回來改設定）。這時「再產一批」降為次要，同時只有一個主按鈕。
   */
  const listIsPrimary =
    current === null || (current === "settings" && props.hasQuestions);

  /** 底部列右側：目前這一步的主要動作（同一時間只有一個主按鈕） */
  const renderPrimaryAction = () => {
    switch (current) {
      case "goal":
        return (
          <Button
            onClick={props.onGenerateArticle}
            disabled={busy || !props.goal.trim()}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {t("scenarioDialogue.setup.writeArticle")}
          </Button>
        );
      case "scenario":
        return (
          <Button
            onClick={props.onScenarioDone}
            disabled={busy || !scenarioReady}
          >
            {t("scenarioDialogue.setup.next")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        );
      case "direction":
        return (
          <Button
            onClick={props.onDirectionDone}
            disabled={!props.direction.trim()}
          >
            {t("scenarioDialogue.setup.next")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        );
      case "settings":
        return (
          <Button
            variant={listIsPrimary ? "outline" : "default"}
            onClick={props.onGenerate}
            disabled={props.generating || !!props.generateBlockedReason}
            title={props.generateBlockedReason ?? undefined}
          >
            {props.generating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {props.generating
              ? t("scenarioDialogue.buttons.generating")
              : props.hasQuestions
                ? t("scenarioDialogue.buttons.generateAnother")
                : t("scenarioDialogue.setup.startGenerate")}
          </Button>
        );
      default:
        return null;
    }
  };

  const settingsIntro =
    answers.scenarioMode === "none" && props.direction.trim()
      ? t("scenarioDialogue.setup.q.settingsWithDirection", {
          direction: props.direction.trim(),
        })
      : t("scenarioDialogue.setup.q.settings");

  const showBack = !!(prev && current);
  const showList = props.hasQuestions || current === null;
  const primaryAction = renderPrimaryAction();

  return (
    <>
      <ScenarioScrollArea ref={scrollRef}>
        <div className="space-y-4" data-testid="scenario-setup-chat">
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
        </div>
      </ScenarioScrollArea>

      {/* 固定在 sheet 最底端的操作列（第 4 輪）；左右都沒有按鈕時不畫 */}
      {(showBack || showList || primaryAction) && (
        <ScenarioActionBar
          left={
            showBack &&
            prev && (
              <Button
                variant="outline"
                onClick={() => requestReopen(prev)}
                disabled={busy}
                aria-label={t("scenarioDialogue.setup.back")}
              >
                <ArrowLeft className="h-4 w-4 sm:mr-1" />
                {/* 手機只留圖示，操作列維持一排 */}
                <span className="hidden sm:inline">
                  {t("scenarioDialogue.setup.back")}
                </span>
              </Button>
            )
          }
          right={
            <>
              {current === "settings" && props.generateBlockedReason && (
                <span className="hidden text-xs text-gray-500 sm:inline">
                  {props.generateBlockedReason}
                </span>
              )}
              {/* 主按鈕一律放最右：清單是主按鈕時，「再產一批」排在它左邊 */}
              {listIsPrimary && primaryAction}
              {/* 回到對話改設定後，不必重產也要能回題目清單（已產生的題目保留） */}
              {showList && (
                <Button
                  variant={listIsPrimary ? "default" : "outline"}
                  onClick={props.onViewList}
                  disabled={busy}
                >
                  {t("scenarioDialogue.buttons.viewQuestions")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              )}
              {!listIsPrimary && primaryAction}
            </>
          }
        />
      )}

      <ConfirmDialog
        open={pendingReopen !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReopen(null);
        }}
        title={t("scenarioDialogue.setup.reopenConfirmTitle")}
        description={
          // 重開「需要情境嗎？」而情境框／情境圖有內容：改選後情境也會清掉，要講清楚（review 2-2）
          pendingReopen === "mode" && scenarioReady
            ? t("scenarioDialogue.setup.modeChangeConfirmDescription")
            : t("scenarioDialogue.setup.reopenConfirmDescription")
        }
        confirmText={t("scenarioDialogue.setup.reopenConfirm")}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={() => {
          if (pendingReopen) {
            modeReopenConfirmedRef.current = pendingReopen === "mode";
            props.onReopen(pendingReopen);
          }
          setPendingReopen(null);
        }}
      />

      <ConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMode(null);
        }}
        title={t("scenarioDialogue.setup.modeChangeConfirmTitle")}
        description={t("scenarioDialogue.setup.modeChangeConfirmDescription")}
        confirmText={t("scenarioDialogue.setup.reopenConfirm")}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={() => {
          if (pendingMode) props.onChooseMode(pendingMode);
          setPendingMode(null);
        }}
      />
    </>
  );
}

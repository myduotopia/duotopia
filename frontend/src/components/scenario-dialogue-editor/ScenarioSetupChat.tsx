/**
 * 情境對話的引導式對話（Issue #1146；#1158 C commit 4 改成同頁版面的左欄）。
 *
 * 由上到下三塊（左欄高度撐滿，只有中間捲動）：
 *
 * 1. **已選項目列**（`SelectedChipsBar`，固定在頂端、不隨對話捲動）：情境／來源／方向／設定
 *    四種標籤，出現條件由 `scenarioSteps.ts` 決定（`chipsFor`）。點標籤跳 Popover 原地修改：
 *    - 情境：三個方式選項＋「編輯情境內容」（情境確認後才有，把畫面帶到右欄情境區）。
 *    - 來源：兩個選項。只在還沒有題目時出現；萬一不能改（引擎回 `CHANGE_BLOCKED`）就停用
 *      並寫原因，不跳確認框。
 *    - 方向：文字框＋「確定」。
 *    - 設定：精簡版出題設定卡（不放題數）＋「確定」。
 *    改情境方式（情境有內容時）、改來源（後面有東西會清時）先跳 `ConfirmDialog`，文字由
 *    步驟設定給（「情境會清空，題目和設定保留」等）。改完對話紀錄只往下加一句
 *    「已把○○改成：…」。改方向、改設定不清除、不重產。
 *    **AI 工作進行中**（寫情境、擷取、情境圖、產題、compose：`ctx.pending` 非 null、
 *    `setup.busy`、`generating`）整列停用，標籤的 `title` 與列尾小字寫「產生中，請稍候…」
 *    （#1158 修正 C4，和產生中對話框停用一致）。
 *
 * 2. **對話捲動區**：連續的對話紀錄（`setup.log`，舊的泡泡、卡片摘要都唯讀，沒有「改選」），
 *    最後是目前這一步：問句（答非所問時換成重問句）＋這一步的輸入：
 *    - 選項步驟：直排選項卡（`ChoiceCards`）。
 *    - 訓練目標：文章難度小方塊（打字在底部對話框）。
 *    - 情境卡：上傳擷取（既有教材）、情境框、情境圖列，卡片自帶「用這篇情境」。按下去後
 *      對話只留「已確認情境」，情境改固定顯示在右欄。
 *    - 出題設定卡：設定欄位＋「開始產生」（卡片自帶確認鈕）。題數上限＝剩餘名額，已滿時
 *      「開始產生」停用，旁邊寫「已滿 10 題」。
 *    新內容出現時自動捲到最底。
 *
 * 3. **底部對話框**（`ChatComposer`，固定在底端）：灰字依步驟換（`composerState`）。
 *    - 選項步驟：送出不呼叫 AI，只回「請點選上面的選項」。
 *    - 訓練目標：送出＝請 AI 寫情境；出題方向：送出＝記下方向。
 *    - 卡片未完成、產生中：停用，灰字說明原因。
 *    - 「自己打題目」與「題目已產生」要交給 AI 判斷意圖（compose），C 段第 5 段才接上：
 *      呼叫端沒給 `onComposeSubmit` 時，這兩個情境的對話框停用，灰字是該步驟的提示。
 *    - Enter＝換行，只能按送出鈕送出（使用者 10/30 決定，`submitOnEnter` 關）。
 *
 * Beta 標籤和「測試版本，可能會有錯誤」從 #1158 C commit 4 起移到 sheet 標題列
 * （`ScenarioDialogueEditorSheet`），對話裡不再放。
 *
 * state 全部在 `useScenarioSetup`（由面板持有，存檔、題目清單都要用），這個元件只負責畫與
 * 回報老師的操作。
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import {
  BotBubble,
  TeacherBubble,
} from "@/components/shared/guided-chat/ChatBubbles";
import { ChoiceCards } from "@/components/shared/guided-chat/ChoiceCards";
import { CefrChips } from "@/components/shared/guided-chat/CefrChips";
import { ChatComposer } from "@/components/shared/guided-chat/ChatComposer";
import {
  ChipOptionList,
  ChipTextEditor,
  SelectedChipsBar,
} from "@/components/shared/guided-chat/SelectedChipsBar";
import {
  CHANGE_BLOCKED,
  chipsFor,
  findStep,
  resolveText,
  type ConfirmSpec,
  type FlowLogEntry,
  type TextRef,
} from "@/components/shared/guided-chat/flowEngine";
import { MAX_ITEMS } from "./constants";
import { ScenarioImageStrip } from "./ScenarioImageStrip";
import { ScenarioScrollArea } from "./ScenarioSheetLayout";
import {
  EDIT_SCENARIO_ACTION,
  QUESTION_SOURCES,
  SCENARIO_FLOW,
  SCENARIO_MODES,
  type QuestionSource,
  type ScenarioMode,
  type ScenarioStepId,
} from "./scenarioSteps";
import type { ScenarioSetupState } from "./useScenarioSetup";

const P = "scenarioDialogue.setup";

export interface ScenarioSetupChatProps {
  setup: ScenarioSetupState;
  /** 出題設定卡（只有設定欄位；面板組好傳進來） */
  settingsCard: ReactNode;
  /** 「設定」標籤小框的精簡設定（不放題數） */
  settingsPopover: ReactNode;
  /** 剩餘名額（10 − 已有非空白題數）；0 時「開始產生」停用並說明 */
  remaining: number;
  generating: boolean;
  onGenerate: () => void;
  /** 「編輯情境內容」：把畫面帶到右欄情境區（窄版先切到題目分頁） */
  onEditScenario: () => void;
  /**
   * 「自己打題目」與「題目已產生」時，老師在對話框打的字交給 compose 判斷意圖
   * （C 段第 5 段接上）。沒給時這兩個情境的對話框停用。
   */
  onComposeSubmit?: (text: string) => void;
}

/** 有灰色說明行的情境選項（其餘選項只有主句） */
const MODE_HINTS: ReadonlySet<ScenarioMode> = new Set(["existing"]);

interface PendingChange {
  stepId: ScenarioStepId;
  value: unknown;
  spec: ConfirmSpec;
}

export function ScenarioSetupChat(props: ScenarioSetupChatProps) {
  const { t } = useTranslation();
  const { setup } = props;
  const { answers, ctx, current, composer } = setup;
  const r = (ref: TextRef | string) =>
    typeof ref === "string" ? ref : resolveText(ref, t);

  const [draft, setDraft] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(
    null,
  );
  /** 標籤小框裡按了不能改的選項：停用選項並寫原因 */
  const [blockedStep, setBlockedStep] = useState<ScenarioStepId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 情境框依內容自動長高（上限 60vh 由 CSS 限制，超過才內捲） */
  const scenarioBoxRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 用 useLayoutEffect：在瀏覽器畫出來之前量好高度，打字時不會先閃一下捲軸。
  // scrollHeight 不含邊框，而 Textarea 是 border-box，所以要補上
  // offsetHeight - clientHeight（上下邊框），否則末行會被切掉、提早出現捲軸。
  // 刻意只在內容（或情境框重新出現）時重算，不掛 ResizeObserver。
  useLayoutEffect(() => {
    const el = scenarioBoxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [setup.scenarioContent, current?.id]);

  // 對話往下長（新的紀錄、換到下一步）時捲到最底，老師一眼看到現在要做什麼
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [setup.log.length, current?.id]);

  const busy = setup.busy || props.generating;
  /** AI 工作進行中：已選項目列整列停用（修正 C4） */
  const chipsLocked = ctx.pending !== null || busy;
  const scenarioReady = setup.hasScenarioMaterial;

  // ===== 已選項目列 =====

  const modeOptions = SCENARIO_MODES.map((mode) => ({
    value: mode,
    label: t(`${P}.modes.${mode}`),
    hint: MODE_HINTS.has(mode) ? t(`${P}.modeHints.${mode}`) : undefined,
  }));
  const sourceOptions = QUESTION_SOURCES.map((source) => ({
    value: source,
    label: t(`${P}.sources.${source}`),
  }));

  /** 標籤小框裡改答案：不能改 → 寫原因；要確認 → 跳確認框；其餘直接套用 */
  const requestChange = (
    stepId: ScenarioStepId,
    value: unknown,
    close: () => void,
  ) => {
    const check = setup.checkChange(stepId, value);
    if (check === CHANGE_BLOCKED) {
      setBlockedStep(stepId);
      return;
    }
    close();
    if (check) {
      setPendingChange({ stepId, value, spec: check });
      return;
    }
    setup.changeFromChip(stepId, value);
  };

  const chips = chipsFor(SCENARIO_FLOW, answers, ctx).map((c) => ({
    id: c.stepId,
    label: r(c.label),
    value: c.value === null ? null : r(c.value),
  }));

  const renderChipContent = (chipId: string, close: () => void) => {
    const blockedReason =
      blockedStep === chipId && chipId === "source"
        ? t(`${P}.sourceLocked`)
        : null;
    switch (chipId as ScenarioStepId) {
      case "mode":
        return (
          <ChipOptionList
            options={modeOptions}
            current={answers.mode}
            onChoose={(v) => requestChange("mode", v, close)}
            actions={
              // 情境確認過、固定在右欄之後，才有「編輯情境內容」
              answers.scenario === true
                ? [
                    {
                      id: EDIT_SCENARIO_ACTION,
                      label: t(`${P}.chips.editScenario`),
                    },
                  ]
                : []
            }
            onAction={(id) => {
              if (id === EDIT_SCENARIO_ACTION) {
                close();
                props.onEditScenario();
              }
            }}
          />
        );
      case "source":
        return (
          <ChipOptionList
            options={sourceOptions}
            current={answers.source}
            onChoose={(v) => requestChange("source", v, close)}
            disabledReason={blockedReason}
          />
        );
      case "direction":
        return (
          <ChipTextEditor
            initialValue={setup.direction}
            placeholder={t(`${P}.directionPlaceholder`)}
            ariaLabel={t(`${P}.q.direction`)}
            onSubmit={(v) => {
              setup.changeFromChip("direction", v);
              close();
            }}
          />
        );
      case "settings":
        return (
          <div className="flex flex-col gap-2">
            {props.settingsPopover}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  setup.logSettingsChanged();
                  close();
                }}
              >
                {t("guidedChat.chips.apply")}
              </Button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // ===== 對話紀錄 =====

  const renderLogEntry = (entry: FlowLogEntry) => {
    const content = r(entry.text);
    if (entry.role === "bot") return <BotBubble>{content}</BotBubble>;
    if (entry.role === "teacher")
      return <TeacherBubble>{content}</TeacherBubble>;
    return <p className="text-center text-xs text-gray-500">{content}</p>;
  };

  // ===== 目前這一步 =====

  const renderActive = (): ReactNode => {
    if (!current) return null;
    const id = current.id as ScenarioStepId;
    const question =
      id === "goal" && setup.goalReask
        ? setup.goalReask
        : id === "direction" && setup.directionReask
          ? setup.directionReask
          : r(findStep(SCENARIO_FLOW, id).question(answers, ctx));

    let body: ReactNode = null;
    switch (id) {
      case "mode":
        body = (
          <ChoiceCards
            options={modeOptions}
            onChoose={(v: ScenarioMode) => setup.answerChoice("mode", v)}
          />
        );
        break;
      case "source":
        body = (
          <ChoiceCards
            options={sourceOptions}
            onChoose={(v: QuestionSource) => setup.answerChoice("source", v)}
          />
        );
        break;
      case "goal":
        body = (
          <div className="space-y-2 sm:pl-9">
            <div>
              <span className="mb-1 block text-xs text-gray-600">
                {t("scenarioDialogue.labels.articleLevel")}
              </span>
              <CefrChips
                value={setup.articleLevel}
                onChange={setup.setArticleLevel}
              />
            </div>
            {setup.generatingArticle && (
              <BotBubble>
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t(`${P}.writingArticle`, {
                    goal: setup.goal.trim(),
                    level: setup.articleLevel,
                  })}
                </span>
              </BotBubble>
            )}
          </div>
        );
        break;
      case "scenario":
        body = (
          <div
            className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 sm:ml-9"
            data-testid="scenario-card"
          >
            {answers.mode === "existing" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  {setup.extracting ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {setup.extracting
                    ? t(`${P}.extracting`)
                    : t(`${P}.uploadFile`)}
                </Button>
                <span className="text-xs text-gray-400">
                  {t(`${P}.uploadHint`)}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files?.length)
                      void setup.extractFiles(Array.from(files));
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <Textarea
              ref={scenarioBoxRef}
              value={setup.scenarioContent}
              onChange={(e) => setup.setScenarioContent(e.target.value)}
              rows={6}
              placeholder={t("scenarioDialogue.placeholders.scenarioContent")}
              aria-label={t("scenarioDialogue.labels.scenarioText")}
              className="min-h-0 max-h-[60vh] resize-y overflow-y-auto"
            />
            <ScenarioImageStrip
              actions={setup.imageActions}
              scenarioContent={setup.scenarioContent}
            />
            <div className="flex justify-end">
              {/* 沒有情境內容時按不下去（表單驗證，不另外說明） */}
              <Button
                onClick={setup.confirmScenario}
                disabled={busy || !scenarioReady}
              >
                {t(`${P}.useScenario`)}
              </Button>
            </div>
          </div>
        );
        break;
      case "settings": {
        const full = props.remaining <= 0;
        body = (
          <div className="space-y-2 sm:pl-9">
            {props.settingsCard}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {full && (
                <span
                  data-testid="generate-blocked-reason"
                  className="text-xs text-gray-500"
                >
                  {t(`${P}.fullReason`, { max: MAX_ITEMS })}
                </span>
              )}
              <Button
                onClick={props.onGenerate}
                disabled={props.generating || full}
                title={
                  full ? t(`${P}.fullReason`, { max: MAX_ITEMS }) : undefined
                }
              >
                {props.generating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                {props.generating
                  ? t("scenarioDialogue.buttons.generating")
                  : t(`${P}.startGenerate`)}
              </Button>
            </div>
            <p className="text-right text-xs text-gray-400">
              {t("scenarioDialogue.hints.rateLimit")}
            </p>
          </div>
        );
        break;
      }
      default:
        body = null;
    }

    return (
      <div className="space-y-2" data-step={id}>
        <BotBubble>{question}</BotBubble>
        {body}
      </div>
    );
  };

  // ===== 底部對話框 =====

  /** 要交給 compose 的情境（自己打題目、題目已產生），還沒接上就停用 */
  const composeUnwired = composer.intent && !props.onComposeSubmit;
  const composerDisabled = composer.disabled || composeUnwired;

  const submit = async () => {
    const value = draft;
    if (!value.trim()) return;
    if (composer.phase === "choice") {
      setup.replyChooseOption(value.trim());
      setDraft("");
      return;
    }
    if (composer.stepId === "goal") {
      setup.setGoal(value.trim());
      if (await setup.generateArticle(value, "chat")) setDraft("");
      return;
    }
    if (composer.stepId === "direction") {
      setup.submitDirection(value);
      setDraft("");
      return;
    }
    if (composer.intent && props.onComposeSubmit) {
      props.onComposeSubmit(value);
      setDraft("");
    }
  };

  return (
    <>
      <SelectedChipsBar
        chips={chips}
        disabled={chipsLocked}
        disabledReason={t("guidedChat.placeholders.pending")}
        renderContent={renderChipContent}
        popoverClassName={(id) =>
          id === "settings"
            ? "w-[min(32rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto"
            : undefined
        }
      />

      <ScenarioScrollArea ref={scrollRef}>
        <div className="space-y-4" data-testid="scenario-setup-chat">
          {setup.log.map((entry) => (
            <div key={entry.id} data-log-role={entry.role}>
              {renderLogEntry(entry)}
            </div>
          ))}
          {renderActive()}
        </div>
      </ScenarioScrollArea>

      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void submit()}
        placeholder={r(composer.placeholder)}
        disabled={composerDisabled}
        busy={composer.phase === "pending"}
      />

      <ConfirmDialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null);
        }}
        title={pendingChange ? r(pendingChange.spec.title) : ""}
        description={pendingChange ? r(pendingChange.spec.description) : ""}
        confirmText={pendingChange ? r(pendingChange.spec.confirmLabel) : ""}
        cancelText={t("contentEditor.buttons.cancel")}
        onConfirm={() => {
          if (pendingChange) {
            setup.changeFromChip(pendingChange.stepId, pendingChange.value);
          }
          setPendingChange(null);
        }}
      />
    </>
  );
}

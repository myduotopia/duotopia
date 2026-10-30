/**
 * ScenarioDialogueGradingPanel — 批改頁中間欄：情境對話（Issue #1031）
 *
 * 對應 `practice_mode = "scenario_dialogue"`（學生看情境與題目後開口錄音回答）。
 *
 * ## 與朗讀批改的關鍵差別：AI 是「建議」，不是分數
 *
 * 朗讀類有 Azure 發音評測的 accuracy / fluency / pronunciation 分數可看，因為題目
 * 本身就是「該唸出來的那句話」。情境對話是**開放式回答** —— 學生講什麼因人而異，
 * 沒有可比對的正解，那套硬套上來會把「講得跟範例不同」判成錯。
 *
 * 所以這裡走另一條路（#1035）：老師按下按鈕才把錄音交給 Gemini，拿回逐字稿與四個
 * 語言特徵分數（資訊完整度／時態句型／用字水準／必用字詞）。**它只是建議** ——
 * 通過與否、評語仍然是老師自己按、自己寫，AI 不會替老師定案。
 *
 * ## 參考答案是「示範」不是「正解」
 *
 * `reference_answer` 只出現在老師端（學生端的 `public_item_view` 會濾掉）。它的用途
 * 是讓老師快速抓到**語言特徵**該長什麼樣（時態、句型、用字水準、資訊完整度），
 * **不是拿來逐字比對** —— 同一題每個學生講的內容本來就不同（#864 規格 3-3）。
 * 所以畫面上它被標示為「參考」而不是「答案」，並與必用字詞、本題說明放在一起。
 *
 * ## 情境卡（#1158 E5）
 *
 * 題目常是「圖中的人在做什麼？」這類只看題目答不出來的問題，老師批改也要看得到情境文章
 * 與情境圖。批改 API 不帶整份情境設定，所以用目前這組的 `content_id` 抓老師端內容詳情
 * （`GET /api/teachers/contents/{id}`，作業副本也有權限），經 `scenarioChatFromTeacherContent`
 * 轉成和學生頁同一份資料形狀，用學生頁同一張 `ScenarioContextCard` 顯示（圖在上、文章在下，
 * 點圖放大）。抓不到或沒有情境（情境 C）就不顯示，不影響批改。
 *
 * 詳見 docs/design/grading-page-architecture.md
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api";
import type { ScenarioContentDetail } from "@/lib/scenarioDialogue";
import {
  ScenarioContextCard,
  hasContextCard,
} from "@/components/activities/scenario-dialogue/ScenarioContextCard";
import { scenarioChatFromTeacherContent } from "@/components/activities/scenario-dialogue/fromApi";
import type { ScenarioChatContext } from "@/components/activities/scenario-dialogue/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CheckCircle,
  X,
  ChevronDown,
  ChevronUp,
  Mic,
  Sparkles,
  Loader2,
} from "lucide-react";
import type {
  StudentSubmission,
  ItemFeedback,
  SubmissionItem,
  ScenarioGradingSuggestion,
} from "@/pages/teacher/GradingPage";

interface ScenarioDialogueGradingPanelProps {
  submission: StudentSubmission;
  selectedGroupIndex: number;
  expandedRows: Set<number>;
  activeTab: "students" | "content" | "grading";
  itemFeedbacks: ItemFeedback;
  onToggleRow: (globalIndex: number) => void;
  onTogglePassed: (globalIndex: number, passed: boolean) => Promise<void>;
  onItemFeedbackChange: (globalIndex: number, feedback: string) => void;
  onAutoSave: () => Promise<void>;
  /** 正在跑 AI 建議的 item_progress_id。 */
  gradingItems: Set<number>;
  /** 要 AI 建議；force=true 代表老師要重跑（會再燒一次額度）。 */
  onAiGrade: (itemProgressId: number, force?: boolean) => Promise<void>;
  // 為相容 GradingPage 的 panelProps spread 而保留，此 panel 並不使用
  // （同 SentenceRearrangementPanel 的作法；#1034 review 指出原本是無註解的死 prop）：
  // 分組切換由左欄與共用元件負責，這個 Panel 只渲染當前組。
  onSelectGroup?: (idx: number) => void;
}

/** 依 content_id 抓情境（文章＋情境圖）；失敗或沒有情境就回 null（見檔頭「情境卡」） */
function useScenarioContext(
  contentId: number | undefined,
): ScenarioChatContext | null {
  const [ctx, setCtx] = useState<{
    id: number;
    context: ScenarioChatContext;
  } | null>(null);
  useEffect(() => {
    if (contentId == null) return;
    let cancelled = false;
    apiClient
      .getContentDetail(contentId)
      .then((data) => {
        if (cancelled) return;
        const { context } = scenarioChatFromTeacherContent(
          data as ScenarioContentDetail,
        );
        setCtx({ id: contentId, context });
      })
      .catch(() => {
        // 情境卡只是輔助資訊，抓不到不擋批改
      });
    return () => {
      cancelled = true;
    };
  }, [contentId]);
  if (!ctx || ctx.id !== contentId || !hasContextCard(ctx.context)) return null;
  return ctx.context;
}

/** 時態／語態的穩定代碼 → 顯示字串。空值代表老師沒指定，就不顯示這個 chip。 */
function useCodeLabels() {
  const { t } = useTranslation();
  return {
    tense: (tense?: { time: string; aspect: string }) => {
      if (!tense?.time || !tense?.aspect) return "";
      return t("scenarioDialogue.tenseCombo", {
        time: t(`scenarioDialogue.tenseTimes.${tense.time}`),
        aspect: t(`scenarioDialogue.tenseAspects.${tense.aspect}`),
      });
    },
    voice: (voice?: string) =>
      voice ? t(`scenarioDialogue.voices.${voice}`) : "",
  };
}

/** 四個面向的顯示順序 —— 與後端 SCORE_KEYS 一致。 */
const SCORE_KEYS = ["content", "grammar", "vocabulary", "keywords"] as const;

/**
 * AI 建議區塊。
 *
 * 刻意長得跟老師的評分欄不一樣（灰底、標「AI 建議」、分數是小字），因為它就不是成績。
 * 沒評到的面向顯示「—」而不是 0 分：0 分是「答得很差」，沒評到是「這次沒有這個面向
 * 的資訊」，對老師的意思完全不同。
 */
function AiSuggestion({
  suggestion,
}: {
  suggestion: ScenarioGradingSuggestion;
}) {
  const { t } = useTranslation();

  return (
    <div className="text-xs bg-indigo-50/60 border border-indigo-100 rounded p-2 space-y-2">
      <p className="font-semibold text-indigo-700 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        {t("gradingPage.scenarioDialogue.aiSuggestionTitle")}
      </p>

      {suggestion.transcript && (
        <p className="text-gray-700">
          <span className="text-gray-500">
            {t("gradingPage.scenarioDialogue.transcript")}：
          </span>
          {suggestion.transcript}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {SCORE_KEYS.map((key) => {
          const value = suggestion.scores?.[key];
          return (
            <span
              key={key}
              className="px-2 py-0.5 rounded-full bg-white border border-indigo-100 text-indigo-700"
            >
              {t(`gradingPage.scenarioDialogue.aspects.${key}`)}{" "}
              {value == null ? "—" : value}
            </span>
          );
        })}
      </div>

      {suggestion.feedback && (
        <p className="text-gray-600">{suggestion.feedback}</p>
      )}

      {/* 這一行不是裝飾：AI 沒有幫老師定案，上面的通過／不通過還是要老師自己按 */}
      <p className="text-[11px] text-gray-400">
        {t("gradingPage.scenarioDialogue.aiSuggestionHint")}
      </p>
    </div>
  );
}

export function ScenarioDialogueGradingPanel({
  submission,
  selectedGroupIndex,
  expandedRows,
  activeTab,
  itemFeedbacks,
  onToggleRow,
  onTogglePassed,
  onItemFeedbackChange,
  onAutoSave,
  gradingItems,
  onAiGrade,
}: ScenarioDialogueGradingPanelProps) {
  const { t } = useTranslation();
  const labels = useCodeLabels();

  // 分組與 globalIndex 的算法與 SentenceRearrangementPanel 一致：content_groups 各自
  // 帶著自己的 submissions，globalIndex 是前面各組長度的累加（itemFeedbacks 以它為 key）
  const currentGroup = submission.content_groups
    ? submission.content_groups[selectedGroupIndex]
    : null;

  let startIndex = 0;
  if (submission.content_groups) {
    for (let i = 0; i < selectedGroupIndex; i++) {
      startIndex += submission.content_groups[i].submissions.length;
    }
  }

  const items: SubmissionItem[] = currentGroup
    ? currentGroup.submissions
    : submission.submissions;
  const scenarioContext = useScenarioContext(currentGroup?.content_id);

  return (
    <div
      className={`col-span-12 lg:col-span-6 ${
        activeTab === "content" ? "block" : "hidden lg:block"
      }`}
    >
      <Card className="p-4 space-y-3">
        {scenarioContext && <ScenarioContextCard context={scenarioContext} />}
        {items.length === 0 && (
          <p className="text-sm text-gray-500">
            {t("gradingPage.messages.noItems")}
          </p>
        )}

        {items.map((item, localIndex) => {
          const globalIndex = startIndex + localIndex;
          const itemFeedback = itemFeedbacks[globalIndex];
          const expanded = expandedRows.has(globalIndex);
          const scenario = item.scenario_dialogue;
          const tenseLabel = labels.tense(scenario?.tense);
          const voiceLabel = labels.voice(scenario?.voice);
          const suggestion = item.scenario_grading;
          const itemProgressId = item.item_progress_id;
          const grading =
            itemProgressId != null && gradingItems.has(itemProgressId);

          return (
            <div
              key={globalIndex}
              className="border rounded-lg p-3 space-y-2 bg-white"
            >
              <div className="flex items-start gap-3">
                {/* 通過 / 不通過 —— 情境對話沒有 AI 分數，全靠老師判定 */}
                <div
                  className="flex flex-col gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant={
                      itemFeedback?.passed === true ? "default" : "outline"
                    }
                    className={`p-1 h-7 w-7 ${
                      itemFeedback?.passed === true
                        ? "bg-green-600 hover:bg-green-700"
                        : ""
                    }`}
                    onClick={() => onTogglePassed(globalIndex, true)}
                    disabled={submission?.status === "GRADED"}
                    aria-label={t("gradingPage.labels.pass")}
                  >
                    <CheckCircle className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      itemFeedback?.passed === false ? "default" : "outline"
                    }
                    className={`p-1 h-7 w-7 ${
                      itemFeedback?.passed === false
                        ? "bg-red-600 hover:bg-red-700"
                        : ""
                    }`}
                    onClick={() => onTogglePassed(globalIndex, false)}
                    disabled={submission?.status === "GRADED"}
                    aria-label={t("gradingPage.labels.fail")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-semibold text-gray-500 mt-1">
                      {localIndex + 1}.
                    </span>
                    <div className="flex-1">
                      <p className="font-medium text-sm">
                        {item.question_text}
                      </p>
                      {item.question_translation && (
                        <p className="text-xs text-gray-500 mt-1">
                          {item.question_translation}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 學生錄音 —— 這是批改情境對話唯一的作答內容 */}
                  <div className="mt-2">
                    {item.audio_url ? (
                      <audio
                        controls
                        preload="none"
                        src={item.audio_url}
                        className="w-full h-8"
                      />
                    ) : (
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <Mic className="h-3 w-3" />
                        {t("gradingPage.scenarioDialogue.noRecording")}
                      </p>
                    )}
                  </div>

                  {/* 出題設定：老師批改時的判斷依據 */}
                  {(scenario?.keywords?.length || tenseLabel || voiceLabel) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tenseLabel && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          {tenseLabel}
                        </span>
                      )}
                      {voiceLabel && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                          {voiceLabel}
                        </span>
                      )}
                      {scenario?.keywords?.map((word) => (
                        <span
                          key={word}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700"
                        >
                          {word}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onToggleRow(globalIndex)}
                    className="mt-2 text-xs text-blue-600 flex items-center gap-1"
                  >
                    {expanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {t("gradingPage.scenarioDialogue.toggleDetail")}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="pl-10 space-y-2">
                  {scenario?.rubric_note && (
                    <p className="text-xs text-gray-600">
                      <span className="font-semibold">
                        {t("gradingPage.scenarioDialogue.rubricNote")}：
                      </span>
                      {scenario.rubric_note}
                    </p>
                  )}

                  {scenario?.reference_answer && (
                    <div className="text-xs bg-gray-50 rounded p-2">
                      <p className="font-semibold text-gray-600">
                        {t("gradingPage.scenarioDialogue.referenceAnswer")}
                      </p>
                      <p className="text-gray-700 mt-1">
                        {scenario.reference_answer}
                      </p>
                      {/* 這一行不是裝飾 —— 沒有它，老師很容易把參考答案當成標準答案
                          去逐字比對，而口說同一題每個學生講的內容本來就不同 */}
                      <p className="text-[11px] text-gray-400 mt-1">
                        {t("gradingPage.scenarioDialogue.referenceHint")}
                      </p>
                    </div>
                  )}

                  {/* AI 建議：沒有錄音就沒得評，也就不顯示按鈕 —— 一個按了必定
                      失敗的按鈕只會讓老師以為是系統壞了 */}
                  {itemProgressId != null && item.audio_url && (
                    <div className="space-y-2">
                      {suggestion && <AiSuggestion suggestion={suggestion} />}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        // 已完成批改的作業不再燒 token，與上面的通過／不通過同一條規則
                        disabled={grading || submission?.status === "GRADED"}
                        onClick={() =>
                          void onAiGrade(itemProgressId, Boolean(suggestion))
                        }
                      >
                        {grading ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        {t(
                          suggestion
                            ? "gradingPage.scenarioDialogue.aiGradeAgain"
                            : "gradingPage.scenarioDialogue.aiGrade",
                        )}
                      </Button>
                    </div>
                  )}

                  <textarea
                    value={itemFeedback?.feedback ?? ""}
                    onChange={(e) =>
                      onItemFeedbackChange(globalIndex, e.target.value)
                    }
                    onBlur={() => void onAutoSave()}
                    disabled={submission?.status === "GRADED"}
                    placeholder={t(
                      "gradingPage.scenarioDialogue.feedbackPlaceholder",
                    )}
                    className="w-full text-xs border rounded p-2 min-h-[60px]"
                  />
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

export default ScenarioDialogueGradingPanel;

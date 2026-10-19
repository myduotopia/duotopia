/**
 * ScenarioDialoguePreview — 派發 sheet 內的情境對話學生畫面預覽
 *
 * ⚠️ 改動前必讀：`docs/design/preview-architecture.md`
 *
 * ## 為什麼是這條路徑
 *
 * 那份 doc 列了兩種預覽做法。情境對話只能走「ByContent」這一種：
 *
 * * **demo 路徑不可行** —— 沒有公開的 demo 情境對話作業可借，而且 demo 路徑的設定來自
 *   demo 作業自己存的值，不會跟著老師當下調的 toggle 變。
 * * **previewItems 路徑不適用** —— 情境對話的學生畫面不是獨立 Activity 元件，而是
 *   `StudentActivityPageContent` 裡複用 `GroupedQuestionsTemplate` 再加上情境區塊
 *   （#1031），餵題目的入口就是整個 Activity 物件。
 *
 * 所以做法同 `ReadingPreview` 的 ByContent 分支：抓老師端 content detail，組成學生端
 * 的 `Activity`，交給學生元件自己渲染 —— 老師看到的就是學生會看到的那個元件。
 *
 * ## 沒有「未選教材」的 fallback
 *
 * 單字類模式在購物車為空時會借一份示範單字集（`PREVIEW_VOCAB_CONTENT_ID`）。情境對話
 * 不行：它只吃自己的資料集（`practiceMode.ts` 的 `supportedDatasets`），借單字集來預覽
 * 等於顯示一個永遠派不出去的畫面。缺 `contentId` 就說明原因。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api";
import type { ScenarioContentDetail } from "@/lib/scenarioDialogue";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

const PM = "dialogs.assignmentDialog.practiceMode";

export interface ScenarioDialoguePreviewProps {
  /** 購物車第一筆情境對話教材；沒有就無法預覽（見檔頭說明）。 */
  contentId?: number;
  /** 老師當下調的每題秒數，預覽即時跟著變。 */
  timeLimitPerQuestion?: number;
  /** 老師當下調的「顯示題目翻譯」開關。 */
  showTranslation?: boolean;
}

/**
 * 老師端 content detail → 學生端 `Activity`。
 *
 * **只帶學生端真的會看到的欄位**，理由與後端 `utils/scenario_dialogue.public_item_view`
 * ／`public_settings_view` 一致：老師端端點會回 `reference_answer`（給 AI 當語言特徵
 * 對照）與 `image_prompt`（內部生圖用），學生看到就變成照著唸。預覽共用的是學生元件
 * 本身，所以這一步得畫同一條界線 —— 不然哪天學生元件多渲染一個欄位，預覽就漏了。
 *
 * 逐題的 `tense` / `voice` 刻意不帶：「沿用整體」的解析規則唯一判定處在後端
 * （`resolve_effective_tense` / `resolve_effective_voice`），前端不複製一份；而學生畫面
 * 本來就不顯示這兩個，少帶不會有視覺差異。
 *
 * 匯出給測試用（整個學生頁太重，不適合在這一層渲染驗證）。
 */
export function buildScenarioPreviewActivity(
  detail: ScenarioContentDetail,
): Activity {
  const settings = detail.scenario_settings || {};
  return {
    id: 0,
    content_id: detail.id ?? 0,
    order: 1,
    type: "SCENARIO_DIALOGUE",
    title: detail.title ?? "",
    content: "",
    target_text: "",
    duration: 0,
    points: 100,
    status: "NOT_STARTED",
    score: null,
    completed_at: null,
    // 空題目不自己濾掉：學生端後端對情境對話是原樣回傳，濾掉會讓預覽與實際題數不一致
    items: (detail.items ?? []).map((item) => ({
      id: item.id,
      text: item.text ?? "",
      translation: item.translation ?? "",
      audio_url: item.audio_url ?? undefined,
      scenario_dialogue: {
        keywords: [...(item.scenario_dialogue?.keywords ?? [])],
        rubric_note: item.scenario_dialogue?.rubric_note ?? "",
      },
    })),
    scenario_settings: {
      scenario_content: settings.scenario_content ?? "",
      global_rubric: settings.global_rubric ?? "",
      translate_language: settings.translate_language ?? "",
    },
  };
}

export default function ScenarioDialoguePreview({
  contentId,
  timeLimitPerQuestion,
  showTranslation,
}: ScenarioDialoguePreviewProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ScenarioContentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (contentId == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getContentDetail(contentId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data as ScenarioContentDetail);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contentId]);

  const activity = useMemo(
    () => (detail ? buildScenarioPreviewActivity(detail) : null),
    [detail],
  );

  if (contentId == null) {
    return <PreviewNote text={t(`${PM}.scenarioPreviewNeedsContent`)} />;
  }
  if (loading) {
    return <PreviewNote text={t(`${PM}.previewLoading`)} />;
  }
  if (error || !activity) {
    return (
      <PreviewNote
        text={`${t(`${PM}.previewLoadFailed`)}${error ? `：${error}` : ""}`}
        tone="error"
      />
    );
  }
  if ((activity.items ?? []).length === 0) {
    return <PreviewNote text={t(`${PM}.scenarioPreviewEmpty`)} />;
  }

  return (
    <StudentActivityPageContent
      activities={[activity]}
      assignmentTitle={activity.title}
      assignmentId={0}
      practiceMode="scenario_dialogue"
      showTranslation={showTranslation ?? true}
      timeLimitPerQuestion={timeLimitPerQuestion ?? 0}
      isDemoMode={true}
      isPreviewMode={true}
      // 預覽不打 AI 分析端點（不扣老師點數）；情境對話的學生端本來也不跑發音評測
      canUseAiAnalysis={false}
      onBack={() => {}}
      onSubmit={async () => {}}
    />
  );
}

function PreviewNote({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={
        tone === "error"
          ? "rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          : "flex h-full items-center justify-center rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400"
      }
    >
      {text}
    </div>
  );
}

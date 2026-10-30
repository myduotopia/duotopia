/**
 * ScenarioDialoguePreview — 派發 sheet 內的情境對話學生畫面預覽
 *
 * ⚠️ 改動前必讀：`docs/design/preview-architecture.md`
 *
 * ## 這一版改成對話式 UI（#1140 Stage 2）
 *
 * #1132 這支預覽原本塞 `StudentActivityPageContent`（當時學生端走
 * `GroupedQuestionsTemplate`）。#1133／PR #1138 做出了情境對話專屬的訊息對話式
 * 作答畫面，學生端也會換過去（Stage 3），所以預覽先換 —— 預覽的全部意義是
 * 「老師看到的＝學生會看到的」，兩邊不同步就等於沒有預覽。
 *
 * 用的是學生端**同一個元件** `ScenarioChatActivity`，不另做一份 mock UI，與那份
 * doc 的方案選擇一致。
 *
 * ## 預覽不打 AI
 *
 * `getFeedback` 回的是一則**明確標示為預覽**的訊息，不呼叫 Stage 1 的端點：
 *
 * * 預覽不該扣老師點數（preview-architecture.md 的既有規則）；
 * * 預覽裡沒有學生的錄音可以評 —— 老師是在看流程長什麼樣子。
 *
 * 刻意**不給假分數**（`ScenarioFeedback.score` 留空）。設計稿的預覽模式會顯示 mock
 * 分數，那是設計稿在示意；真實預覽給老師一個假分數，他在批改頁看到的又是另一個真
 * 分數，只會互相干擾。建議說法則用老師自己寫的參考答案 —— 那是他寫的，給他看合理。
 *
 * ## 沒有「未選教材」的 fallback
 *
 * 情境對話只吃自己的資料集（`practiceMode.ts` 的 `supportedDatasets`），借示範單字集
 * 來預覽等於顯示一個永遠派不出去的畫面。缺 `contentId` 就說明原因。
 *
 * ## 預覽欄版面（#1158 E2）
 *
 * * 傳 `layout="compact"`：預覽欄很窄，不管螢幕多寬都用單欄；高度跟著外層（派發 sheet 的
 *   預覽 Card 在情境對話時撐滿欄高，見 AssignmentDialog）。
 * * 右側留白用引導式對話外框同一個 `TOOLBAR_GUTTER_CLASS`：老師後台右緣的數位教學工具列
 *   （fixed、z-[150]）疊在派發 sheet 上，預覽欄貼著右緣，不留白會被它蓋住。工具列在 sheet
 *   之外的層，預覽欄自己的 z-index 拉不過它，所以用留白讓開，而不是拉高整個 sheet 的層級
 *   （那會連其他作業類型的派發畫面都一起蓋掉工具列）。
 * * 「提交作業」由 ScenarioChatActivity 依 isPreviewMode 停用，寫明「預覽不會送出」。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TOOLBAR_GUTTER_CLASS } from "@/components/shared/guided-chat/GuidedChatLayout";
import type { ScenarioContentDetail } from "@/lib/scenarioDialogue";
import { ScenarioChatActivity } from "./scenario-dialogue/ScenarioChatActivity";
import {
  scenarioChatFromTeacherContent,
  scenarioChatSettings,
} from "./scenario-dialogue/fromApi";
import { createPreviewScenarioAdapters } from "./scenario-dialogue/studentAdapters";

const PM = "dialogs.assignmentDialog.practiceMode";

export interface ScenarioDialoguePreviewProps {
  /** 購物車第一筆情境對話教材；沒有就無法預覽（見檔頭說明）。 */
  contentId?: number;
  /** 老師當下調的「顯示題目翻譯」開關。 */
  showTranslation?: boolean;
}

export default function ScenarioDialoguePreview({
  contentId,
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

  // 老師預覽帶參考答案（他自己寫的示範回答），學生端那條路徑不會帶
  const chat = useMemo(
    () =>
      detail
        ? scenarioChatFromTeacherContent(detail, { withReferenceAnswer: true })
        : null,
    [detail],
  );

  // 預覽用的 adapters 與學生頁（老師預覽真實作業那條）共用同一個工廠 ——
  // 「預覽不打 AI、不扣點數」只能有一份實作，兩份一定會漂移。
  const previewComment = t(`${PM}.scenarioPreviewFeedback`);
  const adapters = useMemo(
    () => createPreviewScenarioAdapters(previewComment),
    [previewComment],
  );

  const settings = useMemo(
    () =>
      scenarioChatSettings({
        showTranslation: showTranslation ?? true,
        isPreviewMode: true,
      }),
    [showTranslation],
  );

  if (contentId == null) {
    return <PreviewNote text={t(`${PM}.scenarioPreviewNeedsContent`)} />;
  }
  if (loading) {
    return <PreviewNote text={t(`${PM}.previewLoading`)} />;
  }
  if (error || !chat) {
    return (
      <PreviewNote
        text={`${t(`${PM}.previewLoadFailed`)}${error ? `：${error}` : ""}`}
        tone="error"
      />
    );
  }
  if (chat.items.length === 0) {
    return <PreviewNote text={t(`${PM}.scenarioPreviewEmpty`)} />;
  }

  return (
    <div
      className={cn("min-h-0 flex-1", TOOLBAR_GUTTER_CLASS)}
      data-testid="scenario-preview-frame"
    >
      <ScenarioChatActivity
        // 換教材要重新開始。**今天真正讓它歸零的是 loading 分支**：contentId 一變就
        // 先 render PreviewNote，對話元件被 unmount，狀態跟著消失。
        //
        // 那為什麼還要 key？因為 `useScenarioChat` 的狀態是用 items 做 useState 的初值、
        // **沒有任何 effect 在 items 變動時重置**。哪天有人為了少一次閃爍，改成「重新抓
        // 資料時先留著舊畫面」，舊教材的對話就會立刻接到新題目上 —— 而那是個不會有人
        // 察覺的錯。key 讓那個改動不會變成 bug（PR #1142 review 第 3 點）。
        key={contentId}
        context={chat.context}
        items={chat.items}
        settings={settings}
        adapters={adapters}
        onSubmit={() => {}}
        layout="compact"
      />
    </div>
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

/**
 * 「AI 生圖」對話框（Issue #1158）—— 情境圖與題目圖共用。
 *
 * 流程：打開時預填描述（老師可改）→ 按「生成」→ 生完關閉。
 * - 情境圖：`suggestFrom` 帶情境文章，打開時呼叫 `/suggest-image-description` 請 AI 先擬
 *   （不計任何次數）。擬不出來就留白讓老師自己寫。
 * - 題目圖：`initialDescription` 直接帶該題的 `imagePrompt`，沒有就用題目本文，不呼叫 AI。
 *
 * 額度：打開時讀 `/image-quota`，依計費方式顯示剩餘張數或每張約扣幾點；訂閱制註明
 * 「超過每月 60 張後會用到方案點數」。`can_generate=false` 時「生成」停用，原因寫在
 * 按鈕上方（REVIEW.md 按鈕層級第 3 條）。
 *
 * 錯誤（以狀態碼區分，訊息顯示在對話框內，老師不用重打描述）：
 * 402 額度用完、409 上一張還在生成、422 被安全過濾擋下（換描述）、其他（含 502）稍後再試。
 * 422 的 detail 若是陣列（Pydantic 欄位驗證錯誤），不是安全過濾，歸為「稍後再試」。
 *
 * 生成中不能關閉（#1158 修正 B1）：「取消」、✕、Esc、點遮罩都擋下，並在按鈕旁說明
 * 「圖片生成中，完成後可關閉」。避免老師關掉後又上傳別張，AI 圖回來把它蓋掉，或情境圖
 * 已滿 5 張時的競態。
 *
 * 實際生圖與放進畫面由呼叫端的 `onGenerate` 處理（情境圖要先預留 5 張名額，題目圖要換掉
 * 舊圖），失敗時丟出原本的錯誤，這裡負責轉成訊息。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  apiClient,
  type ScenarioImageKind,
  type ScenarioImageQuota,
} from "@/lib/api";

/** 後端 `_ImageDescription` 的上限 */
export const MAX_IMAGE_DESCRIPTION_CHARS = 1000;

/** 409 的錯誤碼（後端 `scenario_image_billing.IN_PROGRESS_ERROR`） */
const IN_PROGRESS_ERROR = "SCENARIO_IMAGE_IN_PROGRESS";

/** 錯誤 → i18n key（依狀態碼，不比對訊息字串） */
export function imageGenerateErrorKey(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 402) return "scenarioDialogue.imageGen.errors.quota";
  if (status === 409) {
    const detail = error instanceof ApiError ? error.detail : null;
    const code =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? (detail as { error?: string }).error
        : undefined;
    // 409 目前只有「上一張還在生成」；其他 409 一律當暫時性錯誤
    if (!code || code === IN_PROGRESS_ERROR) {
      return "scenarioDialogue.imageGen.errors.inProgress";
    }
  }
  if (status === 422) {
    // 陣列 detail 是 Pydantic 驗證錯誤（描述太長、欄位缺漏），換描述沒用，不算被安全過濾擋
    const detail = error instanceof ApiError ? error.detail : null;
    if (Array.isArray(detail)) return "scenarioDialogue.imageGen.errors.failed";
    return "scenarioDialogue.imageGen.errors.blocked";
  }
  return "scenarioDialogue.imageGen.errors.failed";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ScenarioImageKind;
  /** 直接預填的描述（題目圖：imagePrompt 或題目本文）。有值就不呼叫 AI 擬 */
  initialDescription?: string;
  /** 沒有 initialDescription 時，打開就請 AI 依這些內容擬描述（情境圖） */
  suggestFrom?: { scenario_content?: string; question?: string };
  /** 實際生圖；失敗時丟出錯誤（ApiError） */
  onGenerate: (description: string) => Promise<void>;
}

export function AiImageGenerateDialog({
  open,
  onOpenChange,
  kind,
  initialDescription,
  suggestFrom,
  onGenerate,
}: Props) {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quota, setQuota] = useState<ScenarioImageQuota | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** 每次打開換一個序號：關掉又打開時，上一輪還沒回來的請求不能蓋掉新的狀態 */
  const sessionRef = useRef(0);

  const loadQuota = (session: number) =>
    apiClient
      .getScenarioImageQuota()
      .then((q) => {
        if (sessionRef.current === session) setQuota(q);
      })
      .catch((err) => {
        // 讀不到額度不擋生圖，後端仍會把關
        console.error("Failed to load image quota:", err);
      });

  useEffect(() => {
    if (!open) return;
    const session = ++sessionRef.current;
    setErrorKey(null);
    setGenerating(false);
    setQuota(null);
    void loadQuota(session);

    const preset = (initialDescription || "").trim();
    setDescription(preset.slice(0, MAX_IMAGE_DESCRIPTION_CHARS));
    const scenario = suggestFrom?.scenario_content?.trim() || "";
    const question = suggestFrom?.question?.trim() || "";
    if (preset || (!scenario && !question)) {
      setSuggesting(false);
      return;
    }
    setSuggesting(true);
    apiClient
      .suggestScenarioImageDescription({
        scenario_content: scenario,
        question,
      })
      .then(({ description: suggested }) => {
        if (sessionRef.current !== session) return;
        // 老師在等待時已經自己開始打字，就不覆蓋
        setDescription((current) =>
          current.trim()
            ? current
            : (suggested || "").slice(0, MAX_IMAGE_DESCRIPTION_CHARS),
        );
      })
      .catch((err) => {
        console.error("Failed to suggest image description:", err);
        if (sessionRef.current === session) {
          setErrorKey("scenarioDialogue.imageGen.suggestFailed");
        }
      })
      .finally(() => {
        if (sessionRef.current === session) setSuggesting(false);
      });
    // 只在打開時預填一次；內容變動不重擬
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const quotaText = (() => {
    if (!quota) return t("scenarioDialogue.imageGen.quotaLoading");
    const points = quota.points_per_image_estimate;
    switch (quota.billing) {
      case "admin":
        return t("scenarioDialogue.imageGen.billing.admin");
      case "org":
        return t("scenarioDialogue.imageGen.billing.org", { points });
      case "points":
        return t("scenarioDialogue.imageGen.billing.points", { points });
      case "subscription":
        return t("scenarioDialogue.imageGen.billing.subscription", {
          remaining: quota.remaining ?? 0,
          limit: quota.limit ?? 0,
          points,
        });
      case "free_daily":
      default:
        return t("scenarioDialogue.imageGen.billing.free_daily", {
          remaining: quota.remaining ?? 0,
          limit: quota.limit ?? 0,
        });
    }
  })();

  /** 額度不夠時「生成」停用的原因（看得見，不藏在 tooltip 裡） */
  const blockedReason =
    quota && !quota.can_generate
      ? t(`scenarioDialogue.imageGen.blocked.${quota.billing}`, {
          limit: quota.limit ?? 0,
        })
      : null;

  const trimmed = description.trim();
  const canSubmit = !!trimmed && !generating && !suggesting && !blockedReason;

  const submit = async () => {
    if (!canSubmit) return;
    const session = sessionRef.current;
    setErrorKey(null);
    setGenerating(true);
    try {
      await onGenerate(trimmed);
      if (sessionRef.current === session) onOpenChange(false);
    } catch (err) {
      console.error("Failed to generate image:", err);
      if (sessionRef.current !== session) return;
      setErrorKey(imageGenerateErrorKey(err));
      // 額度可能剛好用完（402）或被別的請求用掉，重讀一次讓說明跟著更新
      void loadQuota(session);
    } finally {
      if (sessionRef.current === session) setGenerating(false);
    }
  };

  /** 生成中擋下所有關閉途徑（取消、✕、Esc、點遮罩都會走到這裡） */
  const handleOpenChange = (next: boolean) => {
    if (!next && generating) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="ai-image-generate-dialog"
        onEscapeKeyDown={(e) => {
          if (generating) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (generating) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {kind === "scenario"
              ? t("scenarioDialogue.imageGen.titleScenario")
              : t("scenarioDialogue.imageGen.titleQuestion")}
          </DialogTitle>
          <DialogDescription>
            {t("scenarioDialogue.imageGen.hint")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label
            htmlFor="ai-image-description"
            className="text-sm font-medium text-gray-700"
          >
            {t("scenarioDialogue.imageGen.descriptionLabel")}
          </label>
          <div className="relative">
            <Textarea
              id="ai-image-description"
              value={description}
              onChange={(e) =>
                setDescription(
                  e.target.value.slice(0, MAX_IMAGE_DESCRIPTION_CHARS),
                )
              }
              rows={5}
              maxLength={MAX_IMAGE_DESCRIPTION_CHARS}
              disabled={generating}
              placeholder={
                suggesting
                  ? t("scenarioDialogue.imageGen.suggesting")
                  : t("scenarioDialogue.imageGen.placeholder")
              }
              className="resize-y"
            />
            {suggesting && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("scenarioDialogue.imageGen.suggesting")}
              </span>
            )}
          </div>
          <p
            className="text-xs text-gray-500"
            data-testid="ai-image-quota-text"
          >
            {quotaText}
          </p>
          {blockedReason && (
            <p
              className="text-xs font-medium text-amber-700"
              data-testid="ai-image-blocked-reason"
            >
              {blockedReason}
            </p>
          )}
          {errorKey && (
            <p role="alert" className="text-sm text-red-600">
              {t(errorKey)}
            </p>
          )}
          {generating && (
            <p className="inline-flex items-center gap-1.5 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              {t("scenarioDialogue.imageGen.generatingHint")}
            </p>
          )}
        </div>

        <DialogFooter className="sm:items-center">
          {generating && (
            <p
              className="text-xs text-gray-500 sm:mr-auto"
              data-testid="ai-image-close-locked"
            >
              {t("scenarioDialogue.imageGen.closeLocked")}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={generating}
            title={
              generating
                ? t("scenarioDialogue.imageGen.closeLocked")
                : undefined
            }
          >
            {t("contentEditor.buttons.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            title={blockedReason ?? undefined}
          >
            {generating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {generating
              ? t("scenarioDialogue.imageGen.generating")
              : t("scenarioDialogue.imageGen.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 情境圖列（Issue #1146）：縮圖、刪除、補傳、調整裁切。
 *
 * 一份情境最多 5 張。縮圖點下去開重裁對話框（`ScenarioImageCropDialog`）；存檔後重開的
 * 圖沒有原圖可裁，「調整裁切」停用並說明原因（REVIEW.md 按鈕層級第 3 條）。
 *
 * `readOnly` 給題目清單左欄的對照區用：只看不改（修改要回對話）。
 *
 * #1158：新增鈕旁加「AI 生圖」（`FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION`），開共用的
 * `AiImageGenerateDialog`，打開時依情境文章請 AI 擬描述。AI 生的圖沒有原圖，不顯示
 * 「調整裁切」。已滿 5 張時停用並說明原因。
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crop, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { AiImageGenerateDialog } from "./AiImageGenerateDialog";
import { ScenarioImageCropDialog } from "./ScenarioImageCropDialog";
import { MAX_SCENARIO_IMAGES } from "./scenarioImages";
import type { ScenarioImageActions } from "./useScenarioImages";

interface Props {
  actions: ScenarioImageActions;
  readOnly?: boolean;
  /** 情境文章：AI 生圖時依它擬預填描述（#1158） */
  scenarioContent?: string;
}

export function ScenarioImageStrip({
  actions,
  readOnly = false,
  scenarioContent = "",
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const imageGenerationEnabled = FEATURE_FLAGS.SCENARIO_IMAGE_GENERATION;
  const { images, busy } = actions;
  const full = images.length >= MAX_SCENARIO_IMAGES;

  if (readOnly && images.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="scenario-image-strip">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-gray-700">
          {t("scenarioDialogue.images.label")}
        </span>
        <span className="text-xs text-gray-400 tabular-nums">
          {images.length} / {MAX_SCENARIO_IMAGES}
        </span>
        {!readOnly && (
          <span className="text-xs text-gray-400">
            {t("scenarioDialogue.images.hint")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <div
            key={image.id}
            className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-100"
          >
            <img
              src={image.url}
              alt={t("scenarioDialogue.images.alt", { n: index + 1 })}
              className="h-full w-full object-cover"
            />
            {!readOnly && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-0.5">
                {image.generated ? (
                  // AI 生的圖沒有原圖可裁，不顯示裁切鈕；刪除鈕維持靠右
                  <span />
                ) : (
                  <button
                    type="button"
                    onClick={() => actions.setCropping(image)}
                    disabled={busy || !image.source}
                    title={
                      image.source
                        ? t("scenarioDialogue.images.crop")
                        : t("scenarioDialogue.images.cropUnavailable")
                    }
                    aria-label={t("scenarioDialogue.images.crop")}
                    className="rounded p-0.5 text-white hover:bg-white/20 disabled:opacity-40"
                  >
                    <Crop className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => actions.remove(image.id)}
                  disabled={busy}
                  title={t("scenarioDialogue.images.remove")}
                  aria-label={t("scenarioDialogue.images.remove")}
                  className="rounded p-0.5 text-red-200 hover:bg-white/20 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}

        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy || full}
              title={
                full
                  ? t("scenarioDialogue.images.full", {
                      max: MAX_SCENARIO_IMAGES,
                    })
                  : t("scenarioDialogue.images.add")
              }
              className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-gray-300 bg-white text-xs text-gray-500 hover:border-blue-400 disabled:opacity-50 disabled:hover:border-gray-300"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              {full
                ? t("scenarioDialogue.images.fullShort")
                : t("scenarioDialogue.images.add")}
            </button>
            {imageGenerationEnabled && (
              <button
                type="button"
                onClick={() => setGenerateOpen(true)}
                disabled={busy || full}
                title={
                  full
                    ? t("scenarioDialogue.images.fullGenerate", {
                        max: MAX_SCENARIO_IMAGES,
                      })
                    : t("scenarioDialogue.images.generate")
                }
                data-testid="scenario-image-generate"
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-gray-300 bg-white text-xs text-gray-500 hover:border-blue-400 disabled:opacity-50 disabled:hover:border-gray-300"
              >
                <Sparkles className="h-5 w-5" />
                {full
                  ? t("scenarioDialogue.images.fullShort")
                  : t("scenarioDialogue.images.generate")}
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) void actions.addManual(Array.from(files));
                // 清空才能連續選同一個檔案
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {!readOnly && imageGenerationEnabled && (
        <AiImageGenerateDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          kind="scenario"
          suggestFrom={{ scenario_content: scenarioContent }}
          onGenerate={actions.addGenerated}
        />
      )}

      {!readOnly && (
        <ScenarioImageCropDialog
          image={actions.cropping}
          busy={busy}
          onOpenChange={(open) => {
            if (!open) actions.setCropping(null);
          }}
          onApply={(box) => void actions.applyCrop(box)}
        />
      )}
    </div>
  );
}

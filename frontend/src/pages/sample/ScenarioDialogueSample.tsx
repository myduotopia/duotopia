/**
 * ScenarioDialogueSample — 情境對話「訊息對話式」作答 UI 設計稿（#1133）。
 *
 * 純前端、全 mock（不需登入、不連後端）：題目與建議說法朗讀用瀏覽器 speechSynthesis，
 * 錄音只存在本機 blob URL，AI 建議與分數是固定規則的 mock。
 * 路由：/sample/scenario-dialogue（App.tsx 只在 ENABLE_SCENARIO_DIALOGUE 開時註冊）。
 *
 * 右上角浮動「Sample 控制面板」切換：教材 #648／#650、情境 A/B/C、情境圖張數、
 * 題目配圖、回覆方式、身分（學生／老師預覽）、題目文字預設、翻譯、學生介面語言（中文／英文）、重置；
 * 並顯示每題「是否點開文字」的紀錄（點開過一次就算，收回不取消）。任何設定變動都會重新開始一輪。
 * AI 回饋是固定 mock（第 1 次可以更好、第 2 次起很棒），不會判斷內容；面板上有一行小字說明。
 * 「學生介面語言」只傳給情境對話元件的 uiLanguage（決定翻譯鈕是否出現），不切換整頁 i18n；
 * 英文介面沒有翻譯鈕。日韓系統有預留但 sample 不示範。
 * 控制面板文字只寫中文（設計稿用，不進 i18n）。
 * 對話元件的高度跟著外層（#1158 E 段），這裡用 h-[100dvh] 的外框撐滿整頁；上方放一列和
 * 正式作答頁同規則的題號方格（ScenarioQuestionNav，#1158 E-1 修正）。
 */

import { useMemo, useState } from "react";
import { Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScenarioChatActivity } from "@/components/activities/scenario-dialogue/ScenarioChatActivity";
import {
  ScenarioQuestionNav,
  useScenarioNavBridge,
} from "@/components/activities/scenario-dialogue/ScenarioQuestionNav";
import type {
  ReplyMode,
  TextRevealState,
} from "@/components/activities/scenario-dialogue/types";
import {
  buildSample,
  createMockAdapters,
  stopSpeech,
  type MaterialId,
  type QuestionImageMode,
  type ScenarioKind,
} from "./scenarioDialogueSampleData";

interface Option<T> {
  value: T;
  label: string;
  disabledReason?: string;
}

function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const disabled = Boolean(o.disabledReason);
          return (
            <Button
              key={String(o.value)}
              type="button"
              size="sm"
              variant={value === o.value ? "default" : "outline"}
              disabled={disabled}
              title={o.disabledReason}
              className="h-9"
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {options.some((o) => o.disabledReason) && (
        <p className="text-[11px] text-gray-400">
          {options.find((o) => o.disabledReason)?.disabledReason}
        </p>
      )}
    </div>
  );
}

export default function ScenarioDialogueSample() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [material, setMaterial] = useState<MaterialId>(650);
  const [kind, setKind] = useState<ScenarioKind>("C");
  const [ctxCount, setCtxCount] = useState<1 | 3>(3);
  const [imageMode, setImageMode] = useState<QuestionImageMode>("mixed");
  const [replyMode, setReplyMode] = useState<ReplyMode>("voice");
  const [isPreview, setIsPreview] = useState(false);
  const [textHidden, setTextHidden] = useState(true);
  const [translation, setTranslation] = useState(true);
  const [uiLanguage, setUiLanguage] = useState<"zh-TW" | "en">("zh-TW");
  const [resetKey, setResetKey] = useState(0);
  const [reveal, setReveal] = useState<TextRevealState[]>([]);

  const effectiveKind: ScenarioKind = material === 650 ? "C" : kind;

  const { context, items } = useMemo(
    () =>
      buildSample({
        material,
        kind: effectiveKind,
        contextImageCount: ctxCount,
        imageMode,
        isPreview,
      }),
    [material, effectiveKind, ctxCount, imageMode, isPreview],
  );
  const adapters = useMemo(() => createMockAdapters(material), [material]);
  const navBridge = useScenarioNavBridge();

  const runKey = [
    material,
    effectiveKind,
    ctxCount,
    imageMode,
    replyMode,
    isPreview,
    textHidden,
    translation,
    uiLanguage,
    resetKey,
  ].join("|");

  const reset = () => {
    stopSpeech();
    setResetKey((k) => k + 1);
  };

  const pickMaterial = (m: MaterialId) => {
    setMaterial(m);
    setKind(m === 650 ? "C" : "A");
  };

  const handleSubmit = () => {
    toast.success("（Sample）已提交");
    reset();
  };

  return (
    <div className="relative flex h-[100dvh] flex-col">
      <ScenarioQuestionNav
        key={`nav-${runKey}`}
        count={items.length}
        nav={navBridge.nav}
        answered={navBridge.answered}
        navigateRef={navBridge.navigateRef}
        className="shrink-0 border-b border-gray-200 bg-white px-4 py-2"
      />
      <div className="min-h-0 flex-1">
        <ScenarioChatActivity
          key={runKey}
          context={context}
          items={items}
          adapters={adapters}
          settings={{
            replyMode,
            textDefaultHidden: textHidden,
            showTranslation: translation,
            isPreviewMode: isPreview,
            maxAttempts: 3,
          }}
          onSubmit={handleSubmit}
          onRevealChange={setReveal}
          uiLanguage={uiLanguage}
          onNavChange={navBridge.setNav}
          onProgressChange={navBridge.setAnswered}
          navigateRef={navBridge.navigateRef}
        />
      </div>

      {/* Sample 控制面板 */}
      {/* 放在標題列下方，避免蓋住徽章 */}
      <div className="fixed right-2 top-14 z-50 flex flex-col items-end">
        <Button
          type="button"
          variant="outline"
          className={cn("h-11 bg-white/95 shadow", panelOpen && "hidden")}
          onClick={() => setPanelOpen(true)}
        >
          <Settings2 className="mr-1 h-4 w-4" />
          Sample
        </Button>
        {panelOpen && (
          <div className="max-h-[85dvh] w-[min(20rem,calc(100vw-1rem))] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">
                Sample 控制面板
              </span>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-9 p-0"
                onClick={() => setPanelOpen(false)}
                aria-label="收起控制面板"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-gray-500">
              AI 回饋為示意，不會判斷內容（第 1 次「可以更好」、第 2
              次起「很棒」）。
            </p>

            <Segmented
              label="教材"
              value={material}
              onChange={pickMaterial}
              options={[
                { value: 648, label: "#648 上課口說" },
                { value: 650, label: "#650 暑假旅行" },
              ]}
            />
            <Segmented
              label="情境類型"
              value={effectiveKind}
              onChange={setKind}
              options={[
                {
                  value: "A",
                  label: "A 文章＋圖",
                  disabledReason:
                    material === 650
                      ? "#650 沒有情境文章，固定為情境 C"
                      : undefined,
                },
                {
                  value: "B",
                  label: "B 文章無圖",
                  disabledReason:
                    material === 650
                      ? "#650 沒有情境文章，固定為情境 C"
                      : undefined,
                },
                {
                  value: "C",
                  label: "C 無文章無圖",
                  disabledReason:
                    material === 648
                      ? "#648 有情境文章，只能選 A／B"
                      : undefined,
                },
              ]}
            />
            <Segmented
              label="情境圖張數"
              value={ctxCount}
              onChange={setCtxCount}
              options={([1, 3] as const).map((n) => ({
                value: n,
                label: `${n} 張`,
                disabledReason:
                  effectiveKind !== "A" ? "只有情境 A 有情境圖" : undefined,
              }))}
            />
            <Segmented
              label="題目配圖"
              value={imageMode}
              onChange={setImageMode}
              options={[
                { value: "none", label: "無" },
                { value: "one", label: "1 張" },
                { value: "many", label: "多張" },
                { value: "mixed", label: "混合" },
              ]}
            />
            <Segmented
              label="回覆方式"
              value={replyMode}
              onChange={setReplyMode}
              options={[
                { value: "voice", label: "語音" },
                { value: "text", label: "打字" },
              ]}
            />
            <Segmented
              label="身分"
              value={isPreview}
              onChange={setIsPreview}
              options={[
                { value: false, label: "學生" },
                { value: true, label: "老師預覽" },
              ]}
            />
            <Segmented
              label="題目文字預設"
              value={textHidden}
              onChange={setTextHidden}
              options={[
                { value: true, label: "隱藏（先聽）" },
                { value: false, label: "顯示" },
              ]}
            />
            <Segmented
              label="翻譯"
              value={translation}
              onChange={setTranslation}
              options={[
                { value: true, label: "開" },
                { value: false, label: "關" },
              ]}
            />
            <Segmented
              label="學生介面語言"
              value={uiLanguage}
              onChange={setUiLanguage}
              options={[
                { value: "zh-TW", label: "中文" },
                { value: "en", label: "英文（無翻譯鈕）" },
              ]}
            />

            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-500">
                是否點開文字（紀錄）
              </div>
              <ul className="space-y-0.5 text-xs text-gray-700">
                {reveal.map((r, i) => (
                  <li key={i}>
                    第 {i + 1} 題：
                    {r.zh ? "已看中文" : r.en ? "已看英文" : "未看文字"}
                  </li>
                ))}
              </ul>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              onClick={reset}
            >
              重置
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * MagicPasteInput — 魔術貼上的核心輸入（issue #891）
 *
 * 上傳 1 張圖片/PDF → 後端 AI 擷取（只抄圖上有的）→ 預覽/勾選/微調 → 回傳選取項目。
 * 不含 Dialog 外殼，供兩種場景共用：
 * - 桌面：內嵌 BatchWorkPanel 的「圖片 / PDF」tab
 * - 手機：由 MagicPasteDialog 包在 Dialog 裡
 *
 * 只負責「擷取 + 預覽 + 回傳」；插入後的翻譯/例句/語音補洞由呼叫端處理。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiClient } from "@/lib/api";

export interface MagicPasteItem {
  text: string;
  translation: string;
  part_of_speech: string;
  example_sentence: string;
  example_sentence_translation: string;
}

/**
 * 擷取模式（依教材類型）：
 * - vocabulary：單字集 → 一列 = 單字 + 翻譯 + 詞性 + 例句
 * - sentence  ：例句集 / 朗讀評測 → 一列 = 句子 + 翻譯
 */
export type MagicPasteExtractMode = "vocabulary" | "sentence";

interface QuotaState {
  free_remaining: number;
  free_limit: number;
  can_use: boolean;
}

interface MagicPasteInputProps {
  onInsert: (items: MagicPasteItem[]) => void;
  /** CEFR 程度（僅 vocabulary 模式參考） */
  level?: string;
  /** 擷取模式，預設 vocabulary（單字集） */
  extractMode?: MagicPasteExtractMode;
  /** 若提供，插入後呼叫（例如關閉 Dialog）；tab 內嵌時可省略 */
  onAfterInsert?: () => void;
  /** 若提供，額外顯示一顆取消按鈕（Dialog 用） */
  onCancel?: () => void;
  /** 重置訊號改變時清空狀態（開啟 Dialog / 切到本 tab 時用） */
  resetSignal?: unknown;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

export default function MagicPasteInput({
  onInsert,
  level = "A1",
  extractMode = "vocabulary",
  onAfterInsert,
  onCancel,
  resetSignal,
}: MagicPasteInputProps) {
  const isSentenceMode = extractMode === "sentence";
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MagicPasteItem[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [overLimit, setOverLimit] = useState(false);

  // 重置 + 抓配額（resetSignal 改變時，例如開啟 Dialog / 切到此 tab）
  useEffect(() => {
    setFile(null);
    setItems([]);
    setSelected({});
    setOverLimit(false);
    apiClient
      .getMagicPasteQuota()
      .then((q) => setQuota(q))
      .catch(() => setQuota(null));
  }, [resetSignal]);

  const handleFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("檔案過大（上限 10MB）");
      return;
    }
    setFile(f);
    setItems([]);
    setSelected({});
  };

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setOverLimit(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("level", level);
      formData.append("extract_mode", extractMode);
      const result = await apiClient.magicPasteExtract(formData);
      if (!result.items.length) {
        toast.error(
          isSentenceMode
            ? "這張圖片沒有擷取到句子，請換一張試試"
            : "這張圖片沒有擷取到單字，請換一張試試",
        );
      }
      setItems(result.items);
      setSelected(Object.fromEntries(result.items.map((_, i) => [i, true])));
      setQuota((prev) => ({
        free_limit: prev?.free_limit ?? result.quota.free_limit,
        free_remaining: result.quota.free_remaining,
        can_use: result.quota.can_use,
      }));
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err.status === 402) {
        setOverLimit(true);
      } else {
        toast.error(err.message || "AI 擷取失敗，請稍後再試");
      }
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<MagicPasteItem>) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  };

  const selectedItems = items.filter((_, i) => selected[i]);

  const handleInsert = () => {
    if (!selectedItems.length) {
      toast.error("請至少勾選一個項目");
      return;
    }
    onInsert(selectedItems);
    setFile(null);
    setItems([]);
    setSelected({});
    onAfterInsert?.();
  };

  return (
    <div className="space-y-3">
      {/* 配額提示 */}
      {quota && (
        <p className="text-xs text-gray-500">
          本月免費剩餘{" "}
          <span className="font-semibold text-purple-600">
            {quota.free_remaining}
          </span>{" "}
          / {quota.free_limit} 張，超額以點數計費
        </p>
      )}

      {/* 上傳區 */}
      <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-purple-400">
        <input
          type="file"
          accept={ACCEPT}
          className="hidden"
          data-testid="magic-paste-file-input"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <Upload className="h-5 w-5 text-gray-400 mb-1" />
        <span className="text-xs text-gray-600 text-center break-all">
          {file ? file.name : "選擇圖片或 PDF（一次一張）"}
        </span>
      </label>

      <p className="text-[11px] text-gray-400 leading-snug">
        擷取後依上方「AI 翻譯 / 語音 / 例句」設定，在插入時自動補齊缺少的欄位。
      </p>

      {/* 超額提示 */}
      {overLimit && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            本月免費次數已用完且點數不足，請
            <a href="/pricing" className="underline font-medium mx-1">
              訂閱方案或購買點數
            </a>
            後再使用。
          </span>
        </div>
      )}

      {/* 擷取結果預覽 */}
      {items.length > 0 && (
        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          <p className="text-xs font-medium text-gray-700">
            擷取結果（勾選要插入的，可直接改）
          </p>
          {items.map((it, i) => (
            <div
              key={i}
              className="flex items-start gap-2 border rounded-md p-1.5"
            >
              <Checkbox
                checked={!!selected[i]}
                onCheckedChange={(c) =>
                  setSelected((s) => ({ ...s, [i]: !!c }))
                }
                className="mt-1.5"
              />
              <div className="flex-1 grid grid-cols-2 gap-1.5 min-w-0">
                <input
                  className={`border rounded px-1.5 py-1 text-xs min-w-0 ${
                    isSentenceMode ? "col-span-2" : ""
                  }`}
                  value={it.text}
                  placeholder={isSentenceMode ? "句子" : "單字"}
                  onChange={(e) => updateItem(i, { text: e.target.value })}
                />
                <input
                  className={`border rounded px-1.5 py-1 text-xs min-w-0 ${
                    isSentenceMode ? "col-span-2" : ""
                  }`}
                  value={it.translation}
                  placeholder="翻譯"
                  onChange={(e) =>
                    updateItem(i, { translation: e.target.value })
                  }
                />
                {!isSentenceMode && (
                  <input
                    className="border rounded px-1.5 py-1 text-xs col-span-2 min-w-0"
                    value={it.example_sentence}
                    placeholder="例句"
                    onChange={(e) =>
                      updateItem(i, { example_sentence: e.target.value })
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 動作按鈕 */}
      <div className="flex gap-2">
        {items.length === 0 ? (
          <Button
            onClick={handleExtract}
            disabled={!file || loading || (quota ? !quota.can_use : false)}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                擷取中…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                開始擷取
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={handleInsert}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
          >
            插入 {selectedItems.length} 個項目
          </Button>
        )}
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </div>
  );
}

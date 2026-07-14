/**
 * MagicPasteDialog — 教材內容魔術貼上（issue #891）
 *
 * 共用元件：上傳 1 張圖片/PDF → 後端 AI 擷取單字內容 → 預覽/勾選/微調 → 插入編輯器。
 * 供 VocabularySetPanel 等教材編輯器使用（老師個人 + 組織教材皆共用同一元件）。
 *
 * 本元件只負責「擷取 + 預覽 + 回傳選取項目」，不直接寫入 DB；
 * 插入後由呼叫端併入現有的存檔流程。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Upload, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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

type Mode = "image_first" | "ai";

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

interface MagicPasteDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (items: MagicPasteItem[]) => void;
  /** CEFR 程度，供 AI 生成例句參考（僅 vocabulary 模式用得到） */
  level?: string;
  /** 擷取模式，預設 vocabulary（單字集） */
  extractMode?: MagicPasteExtractMode;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

export default function MagicPasteDialog({
  open,
  onClose,
  onInsert,
  level = "A1",
  extractMode = "vocabulary",
}: MagicPasteDialogProps) {
  const isSentenceMode = extractMode === "sentence";
  const [file, setFile] = useState<File | null>(null);
  const [translateMode, setTranslateMode] = useState<Mode>("image_first");
  const [exampleMode, setExampleMode] = useState<Mode>("image_first");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MagicPasteItem[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [overLimit, setOverLimit] = useState(false);

  // 重置 + 開啟時抓配額
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setItems([]);
    setSelected({});
    setOverLimit(false);
    apiClient
      .getMagicPasteQuota()
      .then((q) => setQuota(q))
      .catch(() => setQuota(null));
  }, [open]);

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
      formData.append("translate_mode", translateMode);
      formData.append("example_mode", exampleMode);
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
      const err = e as { status?: number; detail?: unknown; message?: string };
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
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            魔術貼上：從圖片 / PDF 擷取教材
          </DialogTitle>
          <DialogDescription>
            {isSentenceMode
              ? "上傳一張圖片或 PDF，AI 會自動擷取句子與翻譯，預覽確認後再插入。"
              : "上傳一張圖片或 PDF，AI 會自動擷取單字、翻譯與例句，預覽確認後再插入。"}
          </DialogDescription>
        </DialogHeader>

        {/* 配額提示 */}
        {quota && (
          <p className="text-sm text-gray-500">
            本月免費剩餘{" "}
            <span className="font-semibold text-purple-600">
              {quota.free_remaining}
            </span>{" "}
            / {quota.free_limit} 張，超額將以點數計費
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 上傳區 */}
          <label
            className="flex flex-col items-center justify-center border-2 border-dashed
              border-gray-300 rounded-lg p-6 cursor-pointer hover:border-purple-400"
          >
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              data-testid="magic-paste-file-input"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Upload className="h-6 w-6 text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">
              {file ? file.name : "選擇圖片或 PDF（一次一張）"}
            </span>
          </label>

          {/* 設定（例句集只需要翻譯設定，沒有「例句」欄位） */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium mb-1">翻譯</p>
              <ModeToggle
                value={translateMode}
                onChange={setTranslateMode}
                imageLabel="圖片擷取"
                aiLabel="AI 翻譯"
              />
            </div>
            {!isSentenceMode && (
              <div>
                <p className="font-medium mb-1">例句</p>
                <ModeToggle
                  value={exampleMode}
                  onChange={setExampleMode}
                  imageLabel="圖片擷取"
                  aiLabel="AI 生成"
                />
              </div>
            )}
          </div>

          {/* 超額提示 */}
          {overLimit && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
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
            <div className="space-y-2">
              <p className="text-sm font-medium">
                擷取結果（勾選要插入的項目，可直接修改）
              </p>
              {items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 border rounded-md p-2"
                >
                  <Checkbox
                    checked={!!selected[i]}
                    onCheckedChange={(c) =>
                      setSelected((s) => ({ ...s, [i]: !!c }))
                    }
                    className="mt-2"
                  />
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input
                      className={`border rounded px-2 py-1 text-sm ${
                        isSentenceMode ? "col-span-2" : ""
                      }`}
                      value={it.text}
                      placeholder={isSentenceMode ? "句子" : "單字"}
                      onChange={(e) => updateItem(i, { text: e.target.value })}
                    />
                    <input
                      className={`border rounded px-2 py-1 text-sm ${
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
                        className="border rounded px-2 py-1 text-sm col-span-2"
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
        </div>

        <DialogFooter className="gap-2">
          {items.length === 0 ? (
            <Button
              onClick={handleExtract}
              disabled={!file || loading || (quota ? !quota.can_use : false)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
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
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              插入 {selectedItems.length} 個項目
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeToggle({
  value,
  onChange,
  imageLabel,
  aiLabel,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
  imageLabel: string;
  aiLabel: string;
}) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      <button
        type="button"
        className={`px-3 py-1 ${
          value === "image_first"
            ? "bg-purple-600 text-white"
            : "bg-white text-gray-600"
        }`}
        onClick={() => onChange("image_first")}
      >
        {imageLabel}
      </button>
      <button
        type="button"
        className={`px-3 py-1 ${
          value === "ai" ? "bg-purple-600 text-white" : "bg-white text-gray-600"
        }`}
        onClick={() => onChange("ai")}
      >
        {aiLabel}
      </button>
    </div>
  );
}

/**
 * ContentDownloadSheet - 單字集下載學習單 Sheet（教材卡片三點選單入口）
 *
 * 用途：老師從「我的教材」點 Download 開啟，選擇下載「單字選擇」或「克漏字」
 *       格式的 A4 學習單 PDF。
 *
 * === 資料流 ===
 * open=true 時呼叫 getContentDetail(contentId) 取完整 items（含 distractors / example_sentence）
 * → 映射為 PrintQuestion[]
 * → 交給 PrintPdfSheet 處理預覽與下載
 *
 * === PDF 類型 ===
 * - 單字選擇（預設）：EN text + 圖 → 選 4 個中文選項（AI distractors + translation）
 * - 克漏字：EN 例句挖空 → 填入 EN text（或選英文選項）
 *
 * === Distractors Fallback ===
 * 若某 item 的 distractors 為空（AI 生成失敗），用同集其他 translation 補位。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import {
  PrintPdfSheet,
  type PrintQuestion,
  type ActivityTypeOption,
  type PrintActivityType,
} from "@/components/activities/shared/PrintPdfSheet";

interface ContentDetailItem {
  id: number;
  text: string;
  translation?: string;
  definition?: string;
  // 當前語言的翻譯內容（存在 item_metadata）— 老師切換語言後這個會更新，
  // 但 item.translation DB 欄位未必同步，所以 UI/PDF 應優先讀這個
  vocabulary_translation?: string;
  vocabulary_translation_lang?: string;
  distractors?: string[];
  example_sentence?: string;
  example_sentence_translation?: string;
  image_url?: string;
  part_of_speech?: string;
}

/**
 * 取當前語言的 translation — 優先用 metadata 的 vocabulary_translation
 * （反映老師目前選擇的語言），fallback 到 DB translation 欄位。
 */
function getDisplayTranslation(item: ContentDetailItem): string | undefined {
  return item.vocabulary_translation || item.translation || item.definition;
}

interface ContentDownloadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: number | null;
  contentTitle?: string;
}

/**
 * Fisher-Yates shuffle (non-mutating)
 */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 依序嘗試單字的各種常見變化形態，找出哪一種實際出現在例句中
 * 涵蓋：原型（含片語整組）、複數/三人稱單數、-es、-ies、過去式、-ing
 *
 * 回傳實際出現在例句的字形（保留原本大小寫）或 null（找不到 → 無法挖空）
 * 不規則變化（go/went, man/men）不在此涵蓋範圍
 */
function findAnswerInSentence(
  text: string,
  sentence: string,
): string | null {
  const base = text.trim();
  if (!base || !sentence) return null;

  // 依序嘗試的候選形態
  const candidates = new Set<string>([
    base,
    base + "s",
    base + "es",
    base + "ed",
    base + "d",
    base + "ing",
  ]);
  // -y → -ies / -ied（e.g. study → studies/studied）
  if (base.endsWith("y") && base.length > 1) {
    const stem = base.slice(0, -1);
    candidates.add(stem + "ies");
    candidates.add(stem + "ied");
  }
  // -e 結尾動詞：make → making（去 e 加 ing）
  if (base.endsWith("e") && base.length > 1) {
    candidates.add(base.slice(0, -1) + "ing");
  }

  // 以長度由長到短嘗試，避免「swim」先命中「swimming」子字串誤判
  const sorted = [...candidates].sort((a, b) => b.length - a.length);

  for (const form of sorted) {
    // \b word-boundary + case-insensitive
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    const match = sentence.match(re);
    if (match) return match[0]; // 保留例句中原本的大小寫
  }

  return null;
}

/**
 * 把例句以實際字形切成 before / answer / after 三段
 * 若找不到合適變形 → 回傳 null，呼叫端降級處理
 */
function buildClozeParts(
  text: string,
  sentence: string,
): { before: string; answer: string; after: string } | null {
  const answer = findAnswerInSentence(text, sentence);
  if (!answer) return null;
  const idx = sentence.toLowerCase().indexOf(answer.toLowerCase());
  if (idx < 0) return null;
  return {
    before: sentence.slice(0, idx),
    answer,
    after: sentence.slice(idx + answer.length),
  };
}

/**
 * 取得某 item 的選項（正解 + 3 個干擾項）
 *
 * 策略：永遠從同集其他單字的 translation 隨機挑 3 個當干擾項
 * （不使用 DB 儲存的 AI distractors，避免語言不一致 — 例如老師把翻譯
 * 從中文改成英文，但舊 distractors 還是 AI 生的中文）
 *
 * 這個策略與後端作業派發 [crud.py:230-259] 和 [instant_practice.py:157-177]
 * 完全一致 — 語言自動跟 item.translation 對齊。
 */
function buildOptions(
  item: ContentDetailItem,
  allItems: ContentDetailItem[],
  choiceCount: number,
): string[] | undefined {
  const correct = getDisplayTranslation(item);
  if (!correct) return undefined;

  const others = allItems
    .filter((x) => x.id !== item.id)
    .map((x) => getDisplayTranslation(x))
    .filter((t): t is string => !!t && t !== correct);

  const shuffled = shuffle(others).slice(0, choiceCount - 1);
  return [correct, ...shuffled];
}

export function ContentDownloadSheet({
  open,
  onOpenChange,
  contentId,
  contentTitle,
}: ContentDownloadSheetProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ContentDetailItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !contentId) {
      setItems(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiClient
      .getContentDetail(contentId)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items as ContentDetailItem[]);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load content detail:", err);
        toast.error(
          t(
            "contentDownload.loadError",
            "載入單字集失敗，請稍後再試",
          ),
        );
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contentId, onOpenChange, t]);

  // 先為每個 item 推導「例句中實際出現的字形」（克漏字用），失敗則 fallback 到 text
  const clozeInfo = useMemo(() => {
    if (!items) return new Map<number, { parts: ReturnType<typeof buildClozeParts>; answer: string }>();
    const map = new Map<number, { parts: ReturnType<typeof buildClozeParts>; answer: string }>();
    for (const item of items) {
      const parts = item.example_sentence
        ? buildClozeParts(item.text, item.example_sentence)
        : null;
      map.set(item.id, { parts, answer: parts?.answer ?? item.text });
    }
    return map;
  }, [items]);

  const questions = useMemo<PrintQuestion[]>(() => {
    if (!items) return [];
    return items.map((item, i) => {
      const info = clozeInfo.get(item.id);
      const answerInSentence = info?.answer ?? item.text;
      const clozeSentence = info?.parts
        ? `${info.parts.before}______${info.parts.after}`
        : item.example_sentence; // 無法挖空時整句照顯示

      return {
        index: i + 1,
        // 克漏字用實際字形當正解；word_selection 不依賴此欄位但保持一致
        correctAnswer: answerInSentence,
        text: item.text,
        translation: getDisplayTranslation(item),
        partOfSpeech: item.part_of_speech,
        sentence: clozeSentence,
        sentenceTranslation: item.example_sentence_translation,
        answerLength: answerInSentence.length,
        imageUrl: item.image_url,
        options: buildOptions(item, items, 4),
      };
    });
  }, [items, clozeInfo]);

  // 克漏字 choice 模式的 answerPool = 所有例句中實際字形（帶時態/複數）
  const answerPool = useMemo(
    () =>
      (items ?? []).map((it) => clozeInfo.get(it.id)?.answer ?? it.text),
    [items, clozeInfo],
  );

  const activityTypeOptions: ActivityTypeOption[] = useMemo(
    () => [
      {
        value: "word_selection",
        label: t("contentDownload.types.wordSelection", "單字選擇"),
      },
      {
        value: "cloze",
        label: t("contentDownload.types.cloze", "克漏字"),
      },
    ],
    [t],
  );

  const activityTypeHintModes: Partial<Record<PrintActivityType, string>> = {
    word_selection: "choice",
    cloze: "wordbank",
  };

  // 克漏字的 hintMode 選項（wordbank / choice，沒有 audio 因為 PDF 不能播音檔）
  const hintModeOptions = useMemo(
    () => [
      { value: "wordbank", label: t("contentDownload.hintMode.wordbank") },
      { value: "choice", label: t("contentDownload.hintMode.choice") },
    ],
    [t],
  );

  // Always render so Sheet 的 open→true 動畫會觸發；loading 時 questions=[]
  return (
    <>
      <PrintPdfSheet
        open={open}
        onOpenChange={onOpenChange}
        activityType="word_selection"
        title={contentTitle || t("contentDownload.defaultTitle", "單字學習單")}
        questions={questions}
        hintMode="choice"
        hintModeOptions={hintModeOptions}
        answerPool={answerPool}
        choiceCount={4}
        showImage={true}
        showLetterCount={false}
        shuffleQuestions={false}
        activityTypeOptions={activityTypeOptions}
        activityTypeHintModes={activityTypeHintModes}
      />
      {/* Loading overlay — 覆蓋在 Sheet 上方，避免看到空白預覽 */}
      {open && loading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/10 pointer-events-none">
          <div className="rounded-lg bg-white px-6 py-4 shadow-lg">
            <span className="text-sm text-gray-600">
              {t("contentDownload.loading", "載入中...")}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export default ContentDownloadSheet;

/**
 * PrintPdfSheet - 列印 PDF 面板（共用元件）
 *
 * 供老師列印學習單時使用，目前用於：
 * - 單字拼寫（WordSpellingSample）
 * - 單字克漏字（WordClozeSample）
 *
 * === 功能 ===
 * - 右側滑入 Sheet，顯示條件重選面板 + 即時多頁 A4 預覽（所見即所得）
 * - 可重選：提示方式、顯示圖片、顯示字母數、打亂題目、字體大小
 * - 預覽分頁：useLayoutEffect 量測每題高度，動態計算每頁可放的題目數
 * - 下載按鈕：html2canvas 逐頁擷取 → jsPDF 合併為 PDF 檔
 * - 每頁 Header：每頁均有標題，第 1 頁額外顯示班級/座號/姓名（置中）
 * - 每頁 Footer：Duotopia logo（左）+ 頁碼「第 N 頁 / 共 M 頁」（右）
 *
 * === PDF 版面與預覽一致的關鍵 ===
 * 擷取來源（pageRefs）使用「隱藏擷取區」（position:fixed，在所有 CSS transform 之外），
 * 確保 html2canvas 取得 794×1123 的原始 DOM 尺寸，而非預覽縮放後的視覺尺寸。
 * 下載前 await document.fonts.ready，確保 Noto Serif TC 已載入。
 *
 * === PDF 題目格式 ===
 * - Spelling：單字卡，每列 2 卡，卡片內置中顯示圖片、翻譯、答案槽/選項
 * - Cloze + wordbank：題目上方顯示 Word Bank 框（answerPool 字母排序，置中）
 * - Cloze：1. [sentence with ______]
 *           （若 showSentenceTranslation）  [sentenceTranslation]
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Download, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  ActivitySettingsPanel,
  type HintModeOption,
} from "./ActivitySettingsPanel";

// ── Types ──────────────────────────────────────────────────────────────────

export type PrintActivityType = "spelling" | "cloze" | "word_selection";

export interface PrintQuestion {
  index: number;
  correctAnswer: string;
  translation?: string;
  partOfSpeech?: string;
  sentence?: string;
  sentenceTranslation?: string;
  answerLength: number;
  imageUrl?: string;
  // word_selection：英文單字（當 prompt），與 translation（中文答案）反向
  text?: string;
  // 預先計算好的選項（優先使用，否則從 answerPool 隨機產生）
  options?: string[];
}

export interface ActivityTypeOption {
  value: PrintActivityType;
  label: string;
}

export interface PrintPdfSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityType: PrintActivityType;
  title: string;
  questions: PrintQuestion[];
  hintModeOptions: HintModeOption[];
  answerPool: string[];
  hintMode: string;
  choiceCount: number;
  showImage: boolean;
  showLetterCount: boolean;
  shuffleQuestions: boolean;
  showSentenceTranslation?: boolean;
  showDrawingArea?: boolean;
  // 傳入才渲染頂層 PDF 類型切換器（例如單字集下載：單字選擇/克漏字）
  activityTypeOptions?: ActivityTypeOption[];
  // 每個 activityType 對應的 hintMode 預設值（切換類型時同步重置 hintMode）
  activityTypeHintModes?: Partial<Record<PrintActivityType, string>>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const LOGO_URL =
  "https://storage.googleapis.com/duotopia-social-media-videos/website/logo/logo_row_nobg.png";
const LOGO_ASPECT_RATIO = 4.5;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.7;

const FONT_MIN = 10;
const FONT_MAX = 22;
const FONT_DEFAULT = 14;

const PAPER_W = 794;
const PAPER_H = 1123;
const PAPER_PAD_TOP = 57;
const PAPER_PAD_SIDE = 64;
const PAPER_PAD_BOT = 96;
const FOOTER_H = 48;
const PAGE_GAP = 16;
const CONTENT_H = PAPER_H - PAPER_PAD_TOP - PAPER_PAD_BOT;
const Q_GAP = 16;
const CARD_ROW_GAP = 12; // 單字卡：格線間距（px）

const PAPER_FONT =
  '"Noto Serif TC", "Noto Serif", "Source Han Serif TC", serif';
const CHOICE_LABELS = ["A", "B", "C", "D"];

// ── Helpers ────────────────────────────────────────────────────────────────

function AnswerSlots({ count, visible }: { count: number; visible: boolean }) {
  if (!visible) {
    return (
      <span
        className="inline-block border-b-2 border-gray-700 w-32"
        style={{ height: 24 }}
      />
    );
  }
  return (
    <span className="inline-flex gap-0.5 align-bottom">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="inline-block w-5 h-5 border-b-2 border-gray-700"
        />
      ))}
    </span>
  );
}

// ── SpellingCard ──────────────────────────────────────────────────────────
// 單字拼寫 PDF 用的單字卡（2 卡 / 列，置中排版）

function SpellingCard({
  q,
  activityType,
  hintMode,
  showImage,
  showLetterCount,
  showDrawingArea,
  choiceOptions,
}: {
  q: PrintQuestion;
  activityType: PrintActivityType;
  hintMode: string;
  showImage: boolean;
  showLetterCount: boolean;
  showDrawingArea: boolean;
  choiceOptions?: string[];
}) {
  // word_selection 版型：EN text 當 prompt，options 為中文（translation + distractors）
  // spelling 版型：中文 translation 當 prompt，options 為英文
  const isWordSelection = activityType === "word_selection";
  const isChoice =
    (isWordSelection || hintMode === "choice") && !!choiceOptions;
  const promptText = isWordSelection ? q.text : q.translation;
  return (
    <div
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 8,
        padding: "10px 12px 12px",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        minHeight: 90,
      }}
    >
      {/* 題號 + 選擇模式括號（學生寫 A/B/C/D） */}
      <span
        style={{
          position: "absolute",
          top: 7,
          left: 10,
          fontSize: "0.78em",
          color: "#9ca3af",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "baseline",
          gap: 3,
        }}
      >
        <span>{q.index}.</span>
        {isChoice && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              fontSize: "1.25em",
              color: "#374151",
            }}
          >
            <span>(</span>
            <span style={{ display: "inline-block", width: 24 }} />
            <span>)</span>
          </span>
        )}
      </span>
      {/* 圖片（無圖時保留 144x144 空間供畫圖，不顯示框線或「圖片」字樣） */}
      {showImage &&
        (q.imageUrl ? (
          <img
            src={q.imageUrl}
            alt=""
            style={{
              width: 144,
              height: 144,
              objectFit: "cover",
              borderRadius: 4,
            }}
          />
        ) : (
          <div style={{ width: 144, height: 144 }} />
        ))}
      {/* Prompt：word_selection=英文 text、spelling=中文 translation */}
      <div
        style={{
          textAlign: "center",
          color: "#374151",
          fontWeight: isWordSelection ? 600 : undefined,
        }}
      >
        {promptText}
        {!isWordSelection && q.partOfSpeech && (
          <span style={{ marginLeft: 4, fontSize: "0.85em", color: "#9ca3af" }}>
            {q.partOfSpeech}
          </span>
        )}
      </div>
      {/* 答案槽（加上頂部間距，確保有書寫空間）*/}
      <div
        style={{
          marginTop: 6,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        {isChoice ? (
          // 選擇模式：只顯示選項（括號已在題號旁邊）
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "2px 12px",
              fontSize: "0.9em",
            }}
          >
            {choiceOptions!.map((opt, i) => (
              <span key={i} style={{ color: "#374151" }}>
                <span style={{ fontWeight: 600 }}>{CHOICE_LABELS[i]}.</span>{" "}
                {opt}
              </span>
            ))}
          </div>
        ) : (
          <AnswerSlots count={q.answerLength} visible={showLetterCount} />
        )}
        {/* 作畫區：提供手寫作答空間 */}
        {showDrawingArea && (
          <div style={{ width: "100%", height: 160, marginTop: 8 }} />
        )}
      </div>
    </div>
  );
}

// ── PaperPage sub-component ────────────────────────────────────────────────
// 供預覽和擷取共用：完整的 A4 紙張渲染

interface PaperPageProps {
  pageIndex: number;
  totalPages: number;
  qIndices: number[];
  displayQuestions: PrintQuestion[];
  activityType: PrintActivityType;
  title: string;
  fontSize: number;
  localHintMode: string;
  localShowImage: boolean;
  localShowLetterCount: boolean;
  localShowSentenceTranslation: boolean;
  localShowDrawingArea: boolean;
  localTwoColumn: boolean;
  answerPool: string[];
  questionChoiceOptions: Record<number, string[]>;
  logoBase64: string | null;
  // ref 只有擷取版需要
  divRef?: (el: HTMLDivElement | null) => void;
  // 預覽版有 shadow，擷取版無
  withShadow?: boolean;
}

function PaperPage({
  pageIndex,
  totalPages,
  qIndices,
  displayQuestions,
  activityType,
  title,
  fontSize,
  localHintMode,
  localShowImage,
  localShowLetterCount,
  localShowSentenceTranslation,
  localShowDrawingArea,
  localTwoColumn,
  answerPool,
  questionChoiceOptions,
  logoBase64,
  divRef,
  withShadow = false,
}: PaperPageProps) {
  const titleFontSize = Math.round((fontSize * 22) / 14);
  const infoFontSize = Math.round((fontSize * 13) / 14);

  // 克漏字底線寬度：以本集最長可能答案為準，所有題目統一寬度（wordbank 已公開長度，非資訊洩漏）
  const maxAnswerLen = Math.max(...answerPool.map((a) => a.length), 4);
  const blankWidthEm = maxAnswerLen * 0.55 + 1; // 粗估字寬 + 左右緩衝

  const paperStyle: React.CSSProperties = {
    width: PAPER_W,
    height: PAPER_H,
    position: "relative",
    fontFamily: PAPER_FONT,
    boxSizing: "border-box",
    background: "#fff",
    overflow: "hidden",
    padding: `${PAPER_PAD_TOP}px ${PAPER_PAD_SIDE}px ${PAPER_PAD_BOT}px`,
  };

  return (
    <div
      ref={divRef}
      className={withShadow ? "shadow-md" : undefined}
      style={paperStyle}
    >
      {/* 表頭 */}
      {pageIndex === 0 ? (
        <div>
          <h1
            className="mb-3 text-center font-bold"
            style={{ fontSize: titleFontSize }}
          >
            {title}
          </h1>
          <div
            className="mb-3 flex justify-center gap-12"
            style={{ fontSize: infoFontSize }}
          >
            <span>
              Class:
              <span className="inline-block w-24 border-b border-gray-700 align-bottom" />
            </span>
            <span>
              No.:
              <span className="inline-block w-16 border-b border-gray-700 align-bottom" />
            </span>
            <span>
              Name:
              <span className="inline-block w-28 border-b border-gray-700 align-bottom" />
            </span>
          </div>
        </div>
      ) : (
        <div>
          <h1
            className="mb-3 text-center font-bold"
            style={{ fontSize: titleFontSize }}
          >
            {title}
          </h1>
          <hr className="mb-8 border-gray-400" />
        </div>
      )}

      {/* Word Bank（第 1 頁，wordbank 模式）*/}
      {pageIndex === 0 && localHintMode === "wordbank" && (
        <div
          className="mb-4 rounded border border-gray-300 px-4 py-3"
          style={{ fontSize: infoFontSize }}
        >
          <div className="mb-1.5 text-center font-semibold text-gray-600">
            Word Bank
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-gray-800">
            {[...answerPool].sort().map((word, i) => (
              <span key={i}>{word}</span>
            ))}
          </div>
        </div>
      )}

      {/* 題目列表：根據 localTwoColumn 切換雙欄/單欄
          注意：pageDistribution 和 displayQuestions 的狀態更新有一個 render 的時間差
          （例如 sheet 關閉時 questions 變空但 pageDistribution 還是舊的），需過濾 undefined */}
      {activityType === "spelling" || activityType === "word_selection" ? (
        // 單字卡
        <div
          style={{
            display: "grid",
            gridTemplateColumns: localTwoColumn ? "1fr 1fr" : "1fr",
            gap: CARD_ROW_GAP,
            fontSize,
          }}
        >
          {qIndices.map((qi) => {
            const q = displayQuestions[qi];
            if (!q) return null;
            return (
              <SpellingCard
                key={q.index}
                q={q}
                activityType={activityType}
                hintMode={localHintMode}
                showImage={localShowImage}
                showLetterCount={localShowLetterCount}
                showDrawingArea={localShowDrawingArea}
                choiceOptions={questionChoiceOptions[q.index]}
              />
            );
          })}
        </div>
      ) : localTwoColumn ? (
        // 克漏字：雙欄格線（題號 + 題目一組放入每格）
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: `${Q_GAP}px ${CARD_ROW_GAP}px`,
            fontSize,
          }}
        >
          {qIndices.map((qi) => {
            const q = displayQuestions[qi];
            if (!q) return null;
            return (
              <div key={q.index} className="flex gap-2">
                <span className="w-6 shrink-0 text-right font-medium text-gray-500">
                  {q.index}.
                </span>
                <div className="flex-1">
                  <ClozeQuestion
                    q={q}
                    showImage={localShowImage}
                    showSentenceTranslation={localShowSentenceTranslation}
                    choiceOptions={questionChoiceOptions[q.index]}
                    blankWidthEm={blankWidthEm}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // 克漏字：單欄編號列表（預設）
        <ol className="space-y-4" style={{ fontSize }}>
          {qIndices.map((qi) => {
            const q = displayQuestions[qi];
            if (!q) return null;
            return (
              <li key={q.index} className="flex gap-2">
                <span className="w-6 shrink-0 text-right font-medium text-gray-500">
                  {q.index}.
                </span>
                <div className="flex-1">
                  <ClozeQuestion
                    q={q}
                    showImage={localShowImage}
                    showSentenceTranslation={localShowSentenceTranslation}
                    choiceOptions={questionChoiceOptions[q.index]}
                    blankWidthEm={blankWidthEm}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: PAPER_PAD_SIDE,
          right: PAPER_PAD_SIDE,
          height: FOOTER_H,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid #e5e7eb",
          fontSize: 11,
          color: "#aaa",
        }}
      >
        {logoBase64 ? (
          <img
            src={logoBase64}
            alt="Duotopia"
            style={{
              height: 20,
              width: 20 * LOGO_ASPECT_RATIO,
              objectFit: "contain",
            }}
          />
        ) : (
          <span>Duotopia</span>
        )}
        <span>
          Page {pageIndex + 1} / {totalPages}
        </span>
      </div>
    </div>
  );
}

// ── PrintPdfSheet ──────────────────────────────────────────────────────────

export function PrintPdfSheet({
  open,
  onOpenChange,
  activityType,
  title,
  questions,
  hintMode,
  hintModeOptions,
  answerPool,
  choiceCount,
  showImage,
  showLetterCount,
  shuffleQuestions,
  showSentenceTranslation = false,
  showDrawingArea = false,
  activityTypeOptions,
  activityTypeHintModes,
}: PrintPdfSheetProps) {
  const { t } = useTranslation();
  const printableHintModeOptions = hintModeOptions.filter(
    (opt) => opt.value !== "audio",
  );

  // ── Local state ──────────────────────────────────────────────────────────
  const [localActivityType, setLocalActivityType] =
    useState<PrintActivityType>(activityType);
  // 雙欄排版：word_selection/spelling 預設雙欄、cloze 預設單欄
  const [localTwoColumn, setLocalTwoColumn] = useState<boolean>(
    activityType !== "cloze",
  );
  const initialHintMode =
    hintMode === "audio"
      ? (printableHintModeOptions[0]?.value ?? hintMode)
      : hintMode;
  const [localHintMode, setLocalHintMode] = useState(initialHintMode);
  const [localChoiceCount, setLocalChoiceCount] = useState(choiceCount);
  const [localShowImage, setLocalShowImage] = useState(showImage);
  const [localShowLetterCount, setLocalShowLetterCount] =
    useState(showLetterCount);
  const [localShuffle, setLocalShuffle] = useState(shuffleQuestions);
  const [localShowSentenceTranslation, setLocalShowSentenceTranslation] =
    useState(showSentenceTranslation);
  const [localShowDrawingArea, setLocalShowDrawingArea] =
    useState(showDrawingArea);
  const [displayQuestions, setDisplayQuestions] = useState(questions);
  const [isDownloading, setIsDownloading] = useState(false);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [fontSize, setFontSize] = useState(FONT_DEFAULT);
  const [pageDistribution, setPageDistribution] = useState<number[][]>([
    questions.map((_, i) => i),
  ]);
  const [logoBase64, setLogoBase64] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  // pageRefs → 隱藏擷取區的頁面 div（在所有 transform 之外）
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 量測 refs
  const fullHeaderMeasureRef = useRef<HTMLDivElement>(null);
  const pageHeaderMeasureRef = useRef<HTMLDivElement>(null);
  const wordBankMeasureRef = useRef<HTMLDivElement>(null);
  const qMeasureRefs = useRef<(HTMLElement | null)[]>([]);

  // ── Mount：fetch logo ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(LOGO_URL)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === "string") setLogoBase64(reader.result);
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
  }, []);

  // ── Sheet 開啟時同步父層設定 ──────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setLocalActivityType(activityType);
      setLocalTwoColumn(activityType !== "cloze");
      setLocalHintMode(
        hintMode === "audio"
          ? (printableHintModeOptions[0]?.value ?? hintMode)
          : hintMode,
      );
      setLocalChoiceCount(choiceCount);
      setLocalShowImage(showImage);
      setLocalShowLetterCount(showLetterCount);
      setLocalShuffle(shuffleQuestions);
      setLocalShowSentenceTranslation(showSentenceTranslation);
      setLocalShowDrawingArea(showDrawingArea);
    }
    // Intentionally sync only when dialog opens — parent props like hintMode, choiceCount
    // are captured once on open; subsequent parent re-renders should not reset local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── 打亂題目 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (localShuffle) {
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setDisplayQuestions(shuffled.map((q, i) => ({ ...q, index: i + 1 })));
    } else {
      setDisplayQuestions(questions.map((q, i) => ({ ...q, index: i + 1 })));
    }
  }, [localShuffle, questions]);

  // ── 選擇題選項（穩定洗牌：僅在題目或選項數變更時重新產生）────────────────
  const choicesCacheRef = useRef<{
    key: string;
    data: Record<number, string[]>;
  }>({ key: "", data: {} });

  // word_selection 一律當作 choice；cloze/spelling 看 hintMode
  const isChoiceMode =
    localActivityType === "word_selection" || localHintMode === "choice";

  const questionChoiceOptions = useMemo<Record<number, string[]>>(() => {
    if (!isChoiceMode) return {};

    // 穩定 key：題目 index + correctAnswer + choiceCount + activityType
    const cacheKey =
      displayQuestions
        .map(
          (q) =>
            `${q.index}:${q.correctAnswer}:${(q.options ?? []).join(",")}`,
        )
        .join("|") + `|cc=${localChoiceCount}|at=${localActivityType}`;

    if (choicesCacheRef.current.key === cacheKey) {
      return choicesCacheRef.current.data;
    }

    const result: Record<number, string[]> = {};
    // word_selection：q.options 為中文（translation + distractors），直接使用
    // spelling/cloze：從 answerPool 隨機產生英文選項
    const useQuestionOptions = localActivityType === "word_selection";
    displayQuestions.forEach((q) => {
      let options: string[];
      if (useQuestionOptions && q.options && q.options.length > 0) {
        // q.options 假定已包含正解；若不足則用 answerPool 補位
        options = q.options.slice(0, localChoiceCount);
        if (options.length < localChoiceCount) {
          const extras = answerPool
            .filter((a) => a !== q.correctAnswer && !options.includes(a))
            .slice();
          for (let i = extras.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [extras[i], extras[j]] = [extras[j], extras[i]];
          }
          options = [
            ...options,
            ...extras.slice(0, localChoiceCount - options.length),
          ];
        }
      } else {
        const distractors = answerPool
          .filter((a) => a !== q.correctAnswer)
          .slice();
        for (let i = distractors.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
        }
        options = [
          q.correctAnswer,
          ...distractors.slice(0, localChoiceCount - 1),
        ];
      }
      // 打亂順序
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      result[q.index] = options;
    });

    choicesCacheRef.current = { key: cacheKey, data: result };
    return result;
  }, [
    isChoiceMode,
    displayQuestions,
    localChoiceCount,
    answerPool,
    localActivityType,
  ]);

  // ── 量測題目高度 → 計算分頁 ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const fullHeaderH = fullHeaderMeasureRef.current?.offsetHeight ?? 0;
    const pageHeaderH = pageHeaderMeasureRef.current?.offsetHeight ?? 0;
    const wordBankH =
      localHintMode === "wordbank" && wordBankMeasureRef.current
        ? wordBankMeasureRef.current.offsetHeight + Q_GAP
        : 0;

    const qHeights = displayQuestions.map(
      (_, i) => qMeasureRefs.current[i]?.offsetHeight ?? 0,
    );

    const pages: number[][] = [[]];
    let usedH = fullHeaderH + wordBankH;

    if (localTwoColumn) {
      // 雙欄：每列 2 題，以整列為單位計算分頁
      const rowCount = Math.ceil(qHeights.length / 2);
      for (let row = 0; row < rowCount; row++) {
        const i1 = row * 2;
        const i2 = row * 2 + 1;
        const rowH = Math.max(
          qHeights[i1] ?? 0,
          i2 < qHeights.length ? (qHeights[i2] ?? 0) : 0,
        );
        const isFirstOnPage = pages[pages.length - 1].length === 0;
        const h = rowH + (isFirstOnPage ? 0 : CARD_ROW_GAP);
        if (!isFirstOnPage && usedH + h > CONTENT_H) {
          pages.push([i1, ...(i2 < qHeights.length ? [i2] : [])]);
          usedH = pageHeaderH + rowH;
        } else {
          pages[pages.length - 1].push(i1);
          if (i2 < qHeights.length) pages[pages.length - 1].push(i2);
          usedH += h;
        }
      }
    } else {
      // 單欄：每題單獨累計
      for (let i = 0; i < qHeights.length; i++) {
        const isFirstOnPage = pages[pages.length - 1].length === 0;
        const h = qHeights[i] + (isFirstOnPage ? 0 : Q_GAP);
        if (!isFirstOnPage && usedH + h > CONTENT_H) {
          pages.push([i]);
          usedH = pageHeaderH + qHeights[i];
        } else {
          pages[pages.length - 1].push(i);
          usedH += h;
        }
      }
    }
    if (pages[0].length === 0) {
      pages[0] = qHeights.map((_, i) => i);
    }

    setPageDistribution(pages);
  }, [
    localActivityType,
    displayQuestions,
    localHintMode,
    localShowImage,
    localShowLetterCount,
    localShowSentenceTranslation,
    localShowDrawingArea,
    localTwoColumn,
    localChoiceCount,
    fontSize,
    questionChoiceOptions,
  ]);

  // ── 下載 PDF ─────────────────────────────────────────────────────────────
  // 從「隱藏擷取區」逐頁 html2canvas，合入 jsPDF
  // 擷取區在所有 CSS transform 之外，確保 794×1123 原始尺寸
  const handleDownload = useCallback(async () => {
    const refs = pageRefs.current
      .slice(0, pageDistribution.length)
      .filter(Boolean) as HTMLDivElement[];
    if (refs.length === 0) return;
    setIsDownloading(true);
    try {
      // 等待字型（Noto Serif TC 等）載入，避免 fallback 字型造成版面跑位
      await document.fonts.ready;

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      for (let i = 0; i < refs.length; i++) {
        if (i > 0) pdf.addPage();
        const canvas = await html2canvas(refs[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
      }
      pdf.save("worksheet.pdf");
    } finally {
      setIsDownloading(false);
    }
  }, [pageDistribution.length]);

  // ── Shared props for PaperPage ────────────────────────────────────────────
  const totalPages = pageDistribution.length;
  // 克漏字底線寬度：以本集最長答案為準，所有題目統一寬度
  const sheetBlankWidthEm = useMemo(() => {
    const maxLen = Math.max(...answerPool.map((a) => a.length), 4);
    return maxLen * 0.55 + 1;
  }, [answerPool]);

  const sharedPageProps = {
    displayQuestions,
    activityType: localActivityType,
    title,
    fontSize,
    localHintMode,
    localShowImage,
    localShowLetterCount,
    localShowSentenceTranslation,
    localShowDrawingArea,
    localTwoColumn,
    answerPool,
    questionChoiceOptions,
    logoBase64,
    totalPages,
  };

  const totalH = totalPages * PAPER_H + (totalPages - 1) * PAGE_GAP;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[90vw] max-w-5xl flex-col p-0 sm:max-w-5xl"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle>{t("printPdf.sheetTitle")}</SheetTitle>
            <Button onClick={handleDownload} disabled={isDownloading} size="sm">
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t("printPdf.downloadButton")}
            </Button>
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── PDF 類型切換器（僅當父層提供 activityTypeOptions 時顯示）── */}
          {activityTypeOptions && activityTypeOptions.length > 1 && (
            <div className="shrink-0 border-b px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">
                  {t("printPdf.pdfType")}
                </span>
                <div className="flex gap-2">
                  {activityTypeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setLocalActivityType(opt.value);
                        // 切換類型時同步重置欄數預設（cloze 單欄、其他雙欄）
                        setLocalTwoColumn(opt.value !== "cloze");
                        // 切換類型時重置 hintMode（各類型有各自的預設）
                        const nextHint = activityTypeHintModes?.[opt.value];
                        if (nextHint) {
                          setLocalHintMode(nextHint);
                          if (nextHint === "choice")
                            setLocalShowLetterCount(false);
                        }
                      }}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        localActivityType === opt.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── 設定列 ── */}
          <div className="shrink-0 border-b px-4 pt-3">
            <ActivitySettingsPanel
              assignmentMode="practice"
              onAssignmentModeChange={() => {}}
              assignmentModeVisible={false}
              hintMode={localHintMode}
              hintModeOptions={printableHintModeOptions}
              hintModeVisible={localActivityType !== "word_selection"}
              onHintModeChange={(mode) => {
                setLocalHintMode(mode);
                if (mode === "choice") setLocalShowLetterCount(false);
              }}
              choiceCount={localChoiceCount}
              onChoiceCountChange={setLocalChoiceCount}
              choiceCountVisible={
                localActivityType === "word_selection" ||
                localHintMode === "choice"
              }
              showImage={localShowImage}
              onShowImageChange={(v) => {
                setLocalShowImage(v);
                if (v) setLocalShowDrawingArea(false);
              }}
              extraHintSettings={
                <>
                  {/* 雙欄顯示切換（cloze/word_selection/spelling 都支援） */}
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={localTwoColumn}
                      onChange={(e) => {
                        setLocalTwoColumn(e.target.checked);
                        e.target.blur();
                      }}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {t("printPdf.twoColumn")}
                  </label>
                  {localActivityType === "cloze" &&
                    (localHintMode === "wordbank" ||
                      localHintMode === "choice") && (
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={localShowSentenceTranslation}
                          onChange={(e) => {
                            setLocalShowSentenceTranslation(e.target.checked);
                            e.target.blur();
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        {t("printPdf.showSentenceTranslation")}
                      </label>
                    )}
                  {localActivityType === "spelling" && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={localShowDrawingArea}
                        onChange={(e) => {
                          setLocalShowDrawingArea(e.target.checked);
                          if (e.target.checked) setLocalShowImage(false);
                          e.target.blur();
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      {t("printPdf.drawingArea")}
                    </label>
                  )}
                </>
              }
              showLetterCount={localShowLetterCount}
              onShowLetterCountChange={setLocalShowLetterCount}
              showLetterCountVisible={
                localActivityType === "spelling" && localHintMode !== "choice"
              }
              forceVirtualKeyboard={false}
              onForceVirtualKeyboardChange={() => {}}
              forceVirtualKeyboardVisible={false}
              inputMethodVisible={false}
              shuffleQuestions={localShuffle}
              onShuffleQuestionsChange={setLocalShuffle}
              questionTimeLimit={null}
              onQuestionTimeLimitChange={() => {}}
              questionTimeLimitVisible={false}
              examTimeValue="00:10"
              onExamTimeValueChange={() => {}}
              showExamAnswers={false}
              onShowExamAnswersChange={() => {}}
            />
          </div>

          {/* ── 縮放 + 字體大小 控制列 ── */}
          <div className="flex shrink-0 items-center justify-center gap-6 border-b bg-gray-100 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {t("printPdf.zoomLabel")}
              </span>
              <button
                onClick={() =>
                  setZoom((z) =>
                    parseFloat(Math.max(ZOOM_MIN, z - ZOOM_STEP).toFixed(1)),
                  )
                }
                disabled={zoom <= ZOOM_MIN}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label={t("printPdf.zoomOut")}
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-sm text-gray-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() =>
                  setZoom((z) =>
                    parseFloat(Math.min(ZOOM_MAX, z + ZOOM_STEP).toFixed(1)),
                  )
                }
                disabled={zoom >= ZOOM_MAX}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label={t("printPdf.zoomIn")}
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            <div className="h-4 w-px bg-gray-300" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {t("printPdf.fontLabel")}
              </span>
              <button
                onClick={() => setFontSize((f) => Math.max(FONT_MIN, f - 1))}
                disabled={fontSize <= FONT_MIN}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label={t("printPdf.fontDown")}
              >
                <span className="text-xs font-bold leading-none">A−</span>
              </button>
              <input
                type="range"
                min={FONT_MIN}
                max={FONT_MAX}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-24 accent-blue-500"
                aria-label={t("printPdf.fontSlider")}
              />
              <button
                onClick={() => setFontSize((f) => Math.min(FONT_MAX, f + 1))}
                disabled={fontSize >= FONT_MAX}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label={t("printPdf.fontUp")}
              >
                <span className="text-xs font-bold leading-none">A+</span>
              </button>
              <span className="w-7 text-center text-sm text-gray-600">
                {fontSize}
              </span>
            </div>
          </div>

          {/* ── A4 多頁預覽（視覺，含 shadow，無 pageRefs）── */}
          <div className="flex-1 overflow-auto bg-gray-200 p-6">
            <div
              style={{
                width: PAPER_W * zoom,
                height: totalH * zoom,
                margin: "0 auto",
              }}
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  width: PAPER_W,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: PAGE_GAP,
                  }}
                >
                  {pageDistribution.map((qIndices, pageIndex) => (
                    <PaperPage
                      key={pageIndex}
                      pageIndex={pageIndex}
                      qIndices={qIndices}
                      withShadow
                      {...sharedPageProps}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>

      {/* ── 隱藏擷取區 ────────────────────────────────────────────────────────
          position:fixed 脫離文件流，不在任何 CSS transform 之內。
          html2canvas 從此擷取，取得 794×1123 的原始 DOM 尺寸，
          保證 PDF 與預覽版面完全一致。
          ─────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          top: -20000,
          left: -10000,
          width: PAPER_W,
          pointerEvents: "none",
          // visibility: hidden 不可用 — html2canvas 不渲染 visibility:hidden 的元素，會產生全空白 PDF
          // position:fixed + 負座標已足夠讓元素不出現在畫面上
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: PAGE_GAP }}
        >
          {pageDistribution.map((qIndices, pageIndex) => (
            <PaperPage
              key={pageIndex}
              pageIndex={pageIndex}
              qIndices={qIndices}
              divRef={(el) => {
                pageRefs.current[pageIndex] = el;
              }}
              {...sharedPageProps}
            />
          ))}
        </div>
      </div>

      {/* ── 隱藏量測區（量測各元素高度，供 useLayoutEffect 計算分頁）── */}
      <div
        style={{
          position: "fixed",
          top: -10000,
          left: -10000,
          width: PAPER_W,
          padding: `${PAPER_PAD_TOP}px ${PAPER_PAD_SIDE}px`,
          fontFamily: PAPER_FONT,
          background: "#fff",
          boxSizing: "border-box",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        <div ref={fullHeaderMeasureRef}>
          <h1
            className="mb-3 text-center font-bold"
            style={{ fontSize: Math.round((fontSize * 22) / 14) }}
          >
            {title}
          </h1>
          <div
            className="mb-3"
            style={{ fontSize: Math.round((fontSize * 13) / 14) }}
          >
            Class:______ No.:______ Name:______
          </div>
        </div>

        <div ref={pageHeaderMeasureRef}>
          <h1
            className="mb-3 text-center font-bold"
            style={{ fontSize: Math.round((fontSize * 22) / 14) }}
          >
            {title}
          </h1>
          <hr className="mb-8 border-gray-400" />
        </div>

        {localHintMode === "wordbank" && (
          <div
            ref={wordBankMeasureRef}
            className="mb-4 rounded border border-gray-300 px-4 py-3"
            style={{ fontSize: Math.round((fontSize * 13) / 14) }}
          >
            <div className="mb-1.5 text-center font-semibold text-gray-600">
              Word Bank
            </div>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
              {[...answerPool].sort().map((word, i) => (
                <span key={i}>{word}</span>
              ))}
            </div>
          </div>
        )}

        {(() => {
          const measureWidth = localTwoColumn
            ? (PAPER_W - 2 * PAPER_PAD_SIDE - CARD_ROW_GAP) / 2
            : PAPER_W - 2 * PAPER_PAD_SIDE;
          if (
            localActivityType === "spelling" ||
            localActivityType === "word_selection"
          ) {
            return displayQuestions.map((q, i) => (
              <div
                key={q.index}
                ref={(el) => {
                  qMeasureRefs.current[i] = el;
                }}
                style={{ width: measureWidth, fontSize }}
              >
                <SpellingCard
                  q={q}
                  activityType={localActivityType}
                  hintMode={localHintMode}
                  showImage={localShowImage}
                  showLetterCount={localShowLetterCount}
                  showDrawingArea={localShowDrawingArea}
                  choiceOptions={questionChoiceOptions[q.index]}
                />
              </div>
            ));
          }
          // 克漏字量測
          return displayQuestions.map((q, i) => (
            <div
              key={q.index}
              ref={(el) => {
                qMeasureRefs.current[i] = el;
              }}
              className="flex gap-2"
              style={{ width: measureWidth, fontSize, marginBottom: Q_GAP }}
            >
              <span className="w-6 shrink-0 text-right font-medium text-gray-500">
                {q.index}.
              </span>
              <div className="flex-1">
                <ClozeQuestion
                  q={q}
                  showImage={localShowImage}
                  showSentenceTranslation={localShowSentenceTranslation}
                  choiceOptions={questionChoiceOptions[q.index]}
                  blankWidthEm={sheetBlankWidthEm}
                />
              </div>
            </div>
          ));
        })()}
      </div>
    </Sheet>
  );
}

// ── ClozeQuestion ─────────────────────────────────────────────────────────

function ClozeQuestion({
  q,
  showImage,
  showSentenceTranslation,
  choiceOptions,
  blankWidthEm,
}: {
  q: PrintQuestion;
  showImage: boolean;
  showSentenceTranslation?: boolean;
  choiceOptions?: string[];
  // 句中底線寬度（em）— 以本集最長答案算出，所有題目統一寬度
  blankWidthEm?: number;
}) {
  const isChoice = !!choiceOptions;
  // 把 q.sentence 裡的 `______` 拆成 before/after，讓底線用統一寬度渲染
  const raw = q.sentence ?? "—";
  const blankMarker = /_{3,}/;
  const matchIdx = raw.search(blankMarker);
  const hasBlank = matchIdx >= 0 && blankWidthEm != null;
  let beforeBlank = raw;
  let afterBlank = "";
  if (hasBlank) {
    const matched = raw.match(blankMarker)![0];
    beforeBlank = raw.slice(0, matchIdx);
    afterBlank = raw.slice(matchIdx + matched.length);
  }
  return (
    <div className="flex items-start gap-3">
      {showImage && q.imageUrl && (
        <img
          src={q.imageUrl}
          alt=""
          className="shrink-0 rounded object-cover"
          style={{ width: 72, height: 72 }}
        />
      )}
      <div className="flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-1 leading-relaxed text-gray-800">
          {/* 選擇模式：題目開頭括號讓學生寫 A/B/C/D（括號內留白） */}
          {isChoice && (
            <span className="inline-flex items-baseline mr-1 shrink-0">
              <span>(</span>
              <span className="inline-block" style={{ width: 24 }} />
              <span>)</span>
            </span>
          )}
          {hasBlank ? (
            <span>
              {beforeBlank}
              <span
                style={{
                  display: "inline-block",
                  borderBottom: "1.5px solid #374151",
                  width: `${blankWidthEm}em`,
                  marginLeft: 2,
                  marginRight: 2,
                }}
              />
              {afterBlank}
            </span>
          ) : (
            <span>{raw}</span>
          )}
        </div>
        {showSentenceTranslation && q.sentenceTranslation && (
          <p className="text-gray-400" style={{ fontSize: "0.86em" }}>
            {q.sentenceTranslation}
          </p>
        )}
        {isChoice && choiceOptions && (
          <div
            className="flex flex-wrap gap-x-6 gap-y-1"
            style={{ fontSize: "0.93em" }}
          >
            {choiceOptions.map((opt, i) => (
              <span key={i} className="text-gray-700">
                <span className="font-medium">{CHOICE_LABELS[i]}.</span> {opt}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

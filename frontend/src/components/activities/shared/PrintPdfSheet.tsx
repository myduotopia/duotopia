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

export interface PrintQuestion {
  index: number;
  correctAnswer: string;
  translation?: string;
  partOfSpeech?: string;
  sentence?: string;
  sentenceTranslation?: string;
  answerLength: number;
  imageUrl?: string;
}

export interface PrintPdfSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activityType: "spelling" | "cloze";
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
  hintMode,
  showImage,
  showLetterCount,
  showDrawingArea,
  choiceOptions,
}: {
  q: PrintQuestion;
  hintMode: string;
  showImage: boolean;
  showLetterCount: boolean;
  showDrawingArea: boolean;
  choiceOptions?: string[];
}) {
  const isChoice = hintMode === "choice" && !!choiceOptions;
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
      {/* 題號 */}
      <span
        style={{
          position: "absolute",
          top: 7,
          left: 10,
          fontSize: "0.78em",
          color: "#9ca3af",
          fontWeight: 600,
        }}
      >
        {q.index}.
      </span>
      {/* 圖片 */}
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
          <div
            style={{
              width: 144,
              height: 144,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed #d1d5db",
              borderRadius: 4,
              color: "#d1d5db",
              fontSize: "0.75em",
            }}
          >
            圖片
          </div>
        ))}
      {/* 翻譯 + 詞性 */}
      <div style={{ textAlign: "center", color: "#374151" }}>
        {q.translation}
        {q.partOfSpeech && (
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
          <>
            <span
              style={{
                display: "inline-block",
                borderBottom: "2px solid #374151",
                width: 40,
                height: 24,
              }}
            />
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
          </>
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
  activityType: "spelling" | "cloze";
  title: string;
  fontSize: number;
  localHintMode: string;
  localShowImage: boolean;
  localShowLetterCount: boolean;
  localShowSentenceTranslation: boolean;
  localShowDrawingArea: boolean;
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
  answerPool,
  questionChoiceOptions,
  logoBase64,
  divRef,
  withShadow = false,
}: PaperPageProps) {
  const titleFontSize = Math.round((fontSize * 22) / 14);
  const infoFontSize = Math.round((fontSize * 13) / 14);

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
              班級：
              <span className="inline-block w-24 border-b border-gray-700 align-bottom" />
            </span>
            <span>
              座號：
              <span className="inline-block w-16 border-b border-gray-700 align-bottom" />
            </span>
            <span>
              姓名：
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

      {/* 題目列表 */}
      {activityType === "spelling" ? (
        // 單字卡：2 欄格線
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: CARD_ROW_GAP,
            fontSize,
          }}
        >
          {qIndices.map((qi) => {
            const q = displayQuestions[qi];
            return (
              <SpellingCard
                key={q.index}
                q={q}
                hintMode={localHintMode}
                showImage={localShowImage}
                showLetterCount={localShowLetterCount}
                showDrawingArea={localShowDrawingArea}
                choiceOptions={questionChoiceOptions[q.index]}
              />
            );
          })}
        </div>
      ) : (
        // 克漏字：編號列表
        <ol className="space-y-4" style={{ fontSize }}>
          {qIndices.map((qi) => {
            const q = displayQuestions[qi];
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
          第 {pageIndex + 1} 頁 / 共 {totalPages} 頁
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
}: PrintPdfSheetProps) {
  const printableHintModeOptions = hintModeOptions.filter(
    (opt) => opt.value !== "audio",
  );

  // ── Local state ──────────────────────────────────────────────────────────
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

  // ── 選擇題選項 ────────────────────────────────────────────────────────────
  const questionChoiceOptions = useMemo<Record<number, string[]>>(() => {
    if (localHintMode !== "choice") return {};
    const result: Record<number, string[]> = {};
    displayQuestions.forEach((q) => {
      const distractors = answerPool
        .filter((a) => a !== q.correctAnswer)
        .slice();
      for (let i = distractors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
      }
      const options = [
        q.correctAnswer,
        ...distractors.slice(0, localChoiceCount - 1),
      ];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      result[q.index] = options;
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHintMode, displayQuestions, localChoiceCount]);

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

    if (activityType === "spelling") {
      // 單字卡：每列 2 卡，以整列為單位計算分頁
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
    activityType,
    displayQuestions,
    localHintMode,
    localShowImage,
    localShowLetterCount,
    localShowSentenceTranslation,
    localShowDrawingArea,
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
  const sharedPageProps = {
    displayQuestions,
    activityType,
    title,
    fontSize,
    localHintMode,
    localShowImage,
    localShowLetterCount,
    localShowSentenceTranslation,
    localShowDrawingArea,
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
            <SheetTitle>列印設定</SheetTitle>
            <Button onClick={handleDownload} disabled={isDownloading} size="sm">
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              下載 PDF
            </Button>
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── 設定列 ── */}
          <div className="shrink-0 border-b px-4 pt-3">
            <ActivitySettingsPanel
              assignmentMode="practice"
              onAssignmentModeChange={() => {}}
              assignmentModeVisible={false}
              hintMode={localHintMode}
              hintModeOptions={printableHintModeOptions}
              onHintModeChange={(mode) => {
                setLocalHintMode(mode);
                if (mode === "choice") setLocalShowLetterCount(false);
              }}
              choiceCount={localChoiceCount}
              onChoiceCountChange={setLocalChoiceCount}
              choiceCountVisible={localHintMode === "choice"}
              showImage={localShowImage}
              onShowImageChange={(v) => {
                setLocalShowImage(v);
                if (v) setLocalShowDrawingArea(false);
              }}
              extraHintSettings={
                <>
                  {activityType === "cloze" &&
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
                        顯示句子翻譯
                      </label>
                    )}
                  {activityType === "spelling" && (
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
                      作畫區
                    </label>
                  )}
                </>
              }
              showLetterCount={localShowLetterCount}
              onShowLetterCountChange={setLocalShowLetterCount}
              showLetterCountVisible={
                activityType === "spelling" && localHintMode !== "choice"
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
              <span className="text-xs text-gray-400">預覽</span>
              <button
                onClick={() =>
                  setZoom((z) =>
                    parseFloat(Math.max(ZOOM_MIN, z - ZOOM_STEP).toFixed(1)),
                  )
                }
                disabled={zoom <= ZOOM_MIN}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label="縮小預覽"
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
                aria-label="放大預覽"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            <div className="h-4 w-px bg-gray-300" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">字級</span>
              <button
                onClick={() => setFontSize((f) => Math.max(FONT_MIN, f - 1))}
                disabled={fontSize <= FONT_MIN}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label="縮小字體"
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
                aria-label="字體大小"
              />
              <button
                onClick={() => setFontSize((f) => Math.min(FONT_MAX, f + 1))}
                disabled={fontSize >= FONT_MAX}
                className="rounded p-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30"
                aria-label="放大字體"
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
            班級：______ 座號：______ 姓名：______
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

        {activityType === "spelling" ? (
          // 以半欄寬量測每張卡片，供 useLayoutEffect 行高計算
          displayQuestions.map((q, i) => (
            <div
              key={q.index}
              ref={(el) => {
                qMeasureRefs.current[i] = el;
              }}
              style={{
                width: (PAPER_W - 2 * PAPER_PAD_SIDE - CARD_ROW_GAP) / 2,
                fontSize,
              }}
            >
              <SpellingCard
                q={q}
                hintMode={localHintMode}
                showImage={localShowImage}
                showLetterCount={localShowLetterCount}
                showDrawingArea={localShowDrawingArea}
                choiceOptions={questionChoiceOptions[q.index]}
              />
            </div>
          ))
        ) : (
          <ol className="space-y-4" style={{ fontSize }}>
            {displayQuestions.map((q, i) => (
              <li
                key={q.index}
                ref={(el) => {
                  qMeasureRefs.current[i] = el;
                }}
                className="flex gap-2"
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
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
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
}: {
  q: PrintQuestion;
  showImage: boolean;
  showSentenceTranslation?: boolean;
  choiceOptions?: string[];
}) {
  const isChoice = !!choiceOptions;
  return (
    <div className="flex items-start gap-3">
      {showImage &&
        (q.imageUrl ? (
          <img
            src={q.imageUrl}
            alt=""
            className="shrink-0 rounded object-cover"
            style={{ width: 72, height: 72 }}
          />
        ) : (
          <div
            className="flex shrink-0 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-300"
            style={{ width: 72, height: 72 }}
          >
            圖片
          </div>
        ))}
      <div className="flex-1 space-y-1.5">
        <div className="flex flex-wrap items-end gap-2 leading-relaxed text-gray-800">
          <span>{q.sentence ?? "—"}</span>
          {isChoice && (
            <span
              className="inline-block border-b-2 border-gray-700 align-bottom"
              style={{ width: 32 }}
            />
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

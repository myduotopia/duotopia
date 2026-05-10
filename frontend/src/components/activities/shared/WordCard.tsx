/**
 * WordCard - 單字卡（共用元件）
 *
 * 用途：作為單字拼寫 / 克漏字活動「答對後」的正解揭示卡（正面 = 完整單字資訊）。
 *
 * === 結構 ===
 * 兩面卡片（CSS 3D rotateY 翻面）
 * ├── 正面（front）= WordCard 元件本身渲染
 * │   ├── 圖片（可選）
 * │   ├── 單字（大字） + 單字音檔播放按鈕
 * │   ├── 詞性 Badge（灰色膠囊，可選）
 * │   ├── 中譯
 * │   ├── 例句（高亮目標單字） + 例句音檔播放按鈕
 * │   └── 例句翻譯
 * └── 背面（back）= 由父層透過 `back` prop 傳入（通常是答題 UI，例如 WordActivityCard）
 *
 * === 翻卡互動 ===
 * - 受控（controlled）：父層用 `face` 控制顯示哪一面
 * - 答題流程：face="back"（顯示答題 UI）→ 學生答對 → 父層改為 face="front" → 自動翻面
 * - 翻面動畫 600ms（Y 軸），動畫結束觸發 onFlipped 回呼（給父層接 ScoreOverlay）
 * - 只有 back → front 走動畫；front → back（切換上/下一張）瞬間 snap，避免閃現正面（=答案）
 *
 * === 左右導覽（上一張 / 下一張單字卡）===
 * - 卡片左右兩側顯示箭頭按鈕（ChevronLeft / ChevronRight）
 * - hasPrev=false 不顯示上一張箭頭；hasNext=false 不顯示下一張箭頭
 *
 * === 響應式 ===
 * - viewMode="mobile"：直式（圖片在上、文字在下），寬度撐滿；箭頭貼卡片內側
 * - viewMode="desktop"：橫式（圖片左 30%、文字在右）；箭頭外側懸浮
 *
 * === 設計規範對齊 ===
 * 樣式對齊 WordActivityCard.tsx（同 Card 元件、同圓角/陰影/padding/字級）
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WordCardProps {
  // Layout
  viewMode: "mobile" | "desktop";

  // 翻面控制（受控）
  face: "front" | "back";
  /** 翻面動畫結束時觸發 */
  onFlipped?: () => void;

  // 圖片（可選）
  imageUrl?: string;

  // 單字資訊（正面）
  word: string;
  partOfSpeech?: string;
  translation?: string;
  audioUrl?: string;
  exampleSentence?: string;
  exampleSentenceTranslation?: string;
  exampleSentenceAudioUrl?: string;

  // 背面內容 — 由父層提供（通常是答題 UI）
  back?: ReactNode;

  // 左右導覽（上一張 / 下一張單字卡）— has*=false 則不顯示對應箭頭
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;

  // 額外覆蓋區（如答對動畫提示）— 渲染在卡片下方
  footer?: ReactNode;
}

export function WordCard({
  viewMode,
  face,
  onFlipped,
  imageUrl,
  word,
  partOfSpeech,
  translation,
  audioUrl,
  exampleSentence,
  exampleSentenceTranslation,
  exampleSentenceAudioUrl,
  back,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  footer,
}: WordCardProps) {
  const isBack = face === "back";
  const showPrev = Boolean(hasPrev && onPrev);
  const showNext = Boolean(hasNext && onNext);

  // 只有 back → front（答對揭示）走 600ms 翻面動畫；
  // front → back（切換到下一題）瞬間 snap，避免閃現正面。
  const lastFaceRef = useRef(face);
  const [animateFlip, setAnimateFlip] = useState(false);
  const flipPlaybackRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (lastFaceRef.current === face) return;
    const goingToFront = face === "front";
    lastFaceRef.current = face;
    setAnimateFlip(goingToFront);
    if (!goingToFront) return;
    const timer = window.setTimeout(() => {
      onFlipped?.();
      // Issue #715: 翻到正面後自動播放一次單字音檔（不播例句）
      if (audioUrl) {
        try {
          flipPlaybackRef.current = new Audio(audioUrl);
          void flipPlaybackRef.current.play();
        } catch {
          /* ignore play errors (e.g. autoplay blocked) */
        }
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [face, onFlipped, audioUrl]);

  return (
    <div className="w-full">
      <div className="relative w-full" style={{ perspective: "1200px" }}>
        {showPrev && <NavArrow direction="prev" onClick={onPrev!} />}
        {showNext && <NavArrow direction="next" onClick={onNext!} />}
        <div
          className={cn(
            "relative w-full grid",
            animateFlip && "transition-transform duration-[600ms] ease-in-out",
          )}
          style={{
            transformStyle: "preserve-3d",
            transform: isBack ? "rotateY(180deg)" : "rotateY(0deg)",
            gridTemplateAreas: '"stack"',
          }}
        >
          <CardFace>
            <WordCardFront
              viewMode={viewMode}
              imageUrl={imageUrl}
              word={word}
              partOfSpeech={partOfSpeech}
              translation={translation}
              audioUrl={audioUrl}
              exampleSentence={exampleSentence}
              exampleSentenceTranslation={exampleSentenceTranslation}
              exampleSentenceAudioUrl={exampleSentenceAudioUrl}
            />
          </CardFace>

          <CardFace rotated>
            <Card className="overflow-hidden h-full flex flex-col">
              <CardContent className="flex-1 p-6 flex flex-col justify-center">
                {back}
              </CardContent>
            </Card>
          </CardFace>
        </div>
      </div>

      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}

function NavArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "上一張" : "下一張"}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 z-10",
        "flex items-center justify-center",
        "h-10 w-10 md:h-12 md:w-12 rounded-full",
        "bg-white/90 hover:bg-white border border-gray-200 shadow-md",
        "text-gray-600 hover:text-gray-900 transition-colors",
        isPrev ? "left-2 md:-left-6" : "right-2 md:-right-6",
      )}
    >
      {isPrev ? (
        <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" />
      ) : (
        <ChevronRight className="h-5 w-5 md:h-6 md:w-6" />
      )}
    </button>
  );
}

function CardFace({
  rotated = false,
  children,
}: {
  rotated?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        gridArea: "stack",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: rotated ? "rotateY(180deg)" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function PlayAudioButton({
  audioUrl,
  size = "md",
  ariaLabel,
}: {
  audioUrl?: string;
  size?: "sm" | "md";
  ariaLabel: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handleClick = () => {
    if (!audioUrl) return;
    if (!audioRef.current) audioRef.current = new Audio(audioUrl);
    audioRef.current.currentTime = 0;
    void audioRef.current.play();
  };
  const dim = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const icon = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!audioUrl}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center transition-colors shrink-0 bg-transparent",
        dim,
        audioUrl
          ? "text-blue-500 hover:text-blue-600"
          : "text-gray-300 cursor-not-allowed",
      )}
    >
      <Volume2 className={icon} />
    </button>
  );
}

function WordCardFront({
  viewMode,
  imageUrl,
  word,
  partOfSpeech,
  translation,
  audioUrl,
  exampleSentence,
  exampleSentenceTranslation,
  exampleSentenceAudioUrl,
}: {
  viewMode: "mobile" | "desktop";
  imageUrl?: string;
  word: string;
  partOfSpeech?: string;
  translation?: string;
  audioUrl?: string;
  exampleSentence?: string;
  exampleSentenceTranslation?: string;
  exampleSentenceAudioUrl?: string;
}) {
  const showImage = Boolean(imageUrl);
  const hasExample = Boolean(exampleSentence);

  return (
    <Card
      className={cn(
        "overflow-hidden h-full flex",
        viewMode === "desktop" && showImage ? "flex-row" : "flex-col",
      )}
    >
      {showImage && (
        <div
          className={cn(
            "flex items-center justify-center bg-gray-100 select-none pointer-events-none",
            viewMode === "mobile"
              ? "h-48 w-full"
              : "w-[30%] min-w-64 min-h-[200px]",
          )}
        >
          <img
            src={imageUrl}
            alt=""
            title=""
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}

      <CardContent
        className={cn(
          "flex-1 p-6 select-none flex flex-col justify-center",
          viewMode === "desktop" && showImage && "p-8",
        )}
      >
        {/* 單字區（區塊置中、內容左對齊） */}
        <div className="flex flex-col gap-2 max-w-md w-full mx-auto text-left">
          {/* 第一行：播放鈕 + 單字 */}
          <div className="flex items-center gap-2">
            <PlayAudioButton
              audioUrl={audioUrl}
              size="sm"
              ariaLabel="播放單字音檔"
            />
            <h2 className="text-lg font-bold text-gray-900 break-all">
              {word}
            </h2>
          </div>

          {/* 第二行：詞性 + 翻譯 */}
          {(partOfSpeech || translation) && (
            <div className="flex items-center gap-2 flex-wrap">
              {partOfSpeech && (
                <Badge
                  variant="secondary"
                  className="bg-gray-200 text-gray-700 hover:bg-gray-200 font-normal"
                >
                  {partOfSpeech}
                </Badge>
              )}
              {translation && (
                <p className="text-sm md:text-base text-gray-700">
                  {translation}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 分隔線 */}
        {hasExample && (
          <div className="my-5 border-t border-gray-200 max-w-md w-full mx-auto" />
        )}

        {/* 例句區（區塊置中、內容左對齊） */}
        {hasExample && (
          <div className="flex flex-col gap-2 max-w-md w-full mx-auto text-left">
            <div className="flex items-start gap-2">
              <PlayAudioButton
                audioUrl={exampleSentenceAudioUrl}
                size="sm"
                ariaLabel="播放例句音檔"
              />
              <p className="flex-1 text-base leading-relaxed text-gray-900">
                <HighlightedSentence
                  sentence={exampleSentence!}
                  target={word}
                />
              </p>
            </div>
            {exampleSentenceTranslation && (
              <p className="text-sm text-gray-600 leading-relaxed pl-10">
                {exampleSentenceTranslation}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 把例句中所有目標單字（不分大小寫，整詞 word boundary）標成藍色粗體。
 */
function HighlightedSentence({
  sentence,
  target,
}: {
  sentence: string;
  target: string;
}) {
  if (!target.trim()) return <>{sentence}</>;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = sentence.split(new RegExp(`\\b(${escaped})\\b`, "gi"));
  const targetLower = target.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === targetLower ? (
          <span key={i} className="text-blue-600 font-bold">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

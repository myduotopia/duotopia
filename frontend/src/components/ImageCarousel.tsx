/**
 * ImageCarousel — 圖片輪播（左右箭頭、圓點、觸控滑動、鍵盤左右鍵）。
 *
 * 預設外觀給首頁功能特色輪播用（Home.tsx）：圓點在上、圖片下方有說明文字區。
 * #1133 情境對話加 `compact` 選用模式（預設關閉，首頁不受影響）：圓點移到圖片下方、
 * 不留說明文字區、箭頭縮小並加白底、只有一張時不顯示箭頭與圓點；
 * `zoomable` 讓圖片可點擊放大（沿用 question-bank 的 ZoomableImage）。放大視窗是 portal，
 * React 事件仍會冒泡回輪播；觸控與鍵盤處理只接受輪播自己 DOM 內的事件，
 * 放大視窗裡滑動／按左右鍵不會讓背後輪播換張。
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ZoomableImage } from "@/components/question-bank/LayoutRenderer";

const SWIPE_THRESHOLD = 50; // pixels
const TRANSITION_DURATION = 300; // milliseconds

interface ImageCarouselProps {
  images: { src: string; caption?: string }[];
  /** 精簡模式：圓點在圖下、無說明文字區、單張不顯示控制（預設 false＝首頁外觀） */
  compact?: boolean;
  /** 點圖放大（預設 false） */
  zoomable?: boolean;
  /** 圖片額外 class（例如限制高度） */
  imageClassName?: string;
  /** 覆寫輪播區的 aria-label（預設為首頁文案） */
  ariaLabel?: string;
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  images,
  compact = false,
  zoomable = false,
  imageClassName,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    if (!isTransitioning) return;
    const timer = setTimeout(
      () => setIsTransitioning(false),
      TRANSITION_DURATION,
    );
    return () => clearTimeout(timer);
  }, [isTransitioning]);

  const goTo = useCallback(
    (idx: number) => {
      if (isTransitioning || idx === current) return;
      setIsTransitioning(true);
      setCurrent(idx);
    },
    [current, isTransitioning],
  );

  const prev = useCallback(
    () => goTo(current === 0 ? images.length - 1 : current - 1),
    [current, images.length, goTo],
  );

  const next = useCallback(
    () => goTo(current === images.length - 1 ? 0 : current + 1),
    [current, images.length, goTo],
  );

  /** 事件來自放大視窗（portal）時不處理 */
  const fromOutside = (e: React.SyntheticEvent) =>
    !e.currentTarget.contains(e.target as Node);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (fromOutside(e)) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (fromOutside(e)) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (fromOutside(e)) return;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > SWIPE_THRESHOLD) {
      if (diff > 0) next();
      else prev();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (fromOutside(e)) return;
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  };

  const single = images.length <= 1;
  const showControls = !(compact && single);
  const safeIndex = Math.min(current, Math.max(images.length - 1, 0));
  const slide = images[safeIndex];
  if (!slide) return null;

  const dots = (
    <div className={cn("flex", compact ? "gap-2 mt-2" : "gap-2.5 mb-3")}>
      {images.map((_, idx) => (
        <button
          key={idx}
          type={compact ? "button" : undefined}
          className={cn(
            "rounded-full transition-all duration-300",
            compact ? "w-2 h-2" : "w-3 h-3",
            safeIndex === idx
              ? "bg-blue-600 scale-125"
              : "bg-gray-300 hover:bg-gray-400",
          )}
          onClick={() => goTo(idx)}
          aria-label={t("home.features.carousel.goToSlide", {
            number: idx + 1,
          })}
        />
      ))}
    </div>
  );

  const arrowClass = compact
    ? "absolute top-1/2 -translate-y-1/2 z-10 bg-white/80 hover:bg-white rounded-full p-1.5 shadow"
    : "absolute top-1/2 -translate-y-1/2 z-10 bg-transparent hover:bg-white/80 rounded-full p-2 hover:shadow-md transition-all";
  const imgClass = cn(
    "w-full rounded-2xl transition-opacity duration-300",
    compact && "rounded-lg",
    imageClassName,
  );
  const imgStyle = { opacity: isTransitioning ? 0.6 : 1 };
  const alt = slide.caption || `slide ${safeIndex + 1}`;

  return (
    <div className="w-full flex flex-col items-center">
      {/* Dot indicators */}
      {!compact && dots}

      <div
        className="relative w-full flex items-center justify-center select-none outline-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={ariaLabel ?? t("home.features.carousel.label")}
      >
        {/* Left arrow */}
        {showControls && (
          <button
            type={compact ? "button" : undefined}
            className={cn(arrowClass, compact ? "left-1" : "left-2")}
            onClick={prev}
            aria-label={t("home.features.carousel.prev")}
          >
            <ChevronLeft
              className={cn("text-gray-700", compact ? "h-5 w-5" : "h-6 w-6")}
            />
          </button>
        )}

        {/* Image */}
        {zoomable ? (
          // ZoomableImage 外層是 <button>，要撐滿寬度圖片才不會溢出
          <div className="w-full [&>button]:block [&>button]:w-full">
            <ZoomableImage
              src={slide.src}
              alt={alt}
              className={imgClass}
              style={imgStyle}
            />
          </div>
        ) : (
          <img
            src={slide.src}
            alt={alt}
            className={imgClass}
            style={imgStyle}
            draggable={false}
          />
        )}

        {/* Right arrow */}
        {showControls && (
          <button
            type={compact ? "button" : undefined}
            className={cn(arrowClass, compact ? "right-1" : "right-2")}
            onClick={next}
            aria-label={t("home.features.carousel.next")}
          >
            <ChevronRight
              className={cn("text-gray-700", compact ? "h-5 w-5" : "h-6 w-6")}
            />
          </button>
        )}
      </div>

      {compact && showControls && dots}

      {/* Caption area */}
      {!compact && (
        <div
          className="mt-2 min-h-[2.5rem] text-center text-lg text-gray-700 whitespace-pre-line"
          aria-live="polite"
          aria-atomic="true"
        >
          {slide.caption || <span className="text-gray-400">&nbsp;</span>}
        </div>
      )}
    </div>
  );
};

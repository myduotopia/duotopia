/**
 * CardContent — issue #892 朗讀卡片內容。
 *
 * 依 variant 渲染卡片本體：
 * - word     ：音標 → 單字（放大） → 詞性徽章 → 翻譯
 * - sentence ：例句（放大） → 翻譯
 * - paragraph：段落 → 翻譯（直立圖；本 issue 先預留，未完整實作）
 *
 * 有圖：桌機左右並排、手機上下堆疊，圖片方形 1:1 錨點頂部；無圖：文字置中放大。
 * 卡片高度以 min-height 固定，避免換題跳動。翻譯評測時可弱化（translationDimmed）。
 * 文字染色（WordWithScoreColor）與分數徽章由 Stage 4 透過 textSlot / scoreBadge 注入。
 *
 * 設計依據：docs/design/recording-card-redesign.pen（A1/A2 word、C1/C4 sentence）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CardVariant = "word" | "sentence" | "paragraph";

export interface CardContentProps {
  variant: CardVariant;
  /** 朗讀本體（單字 / 例句 / 段落）；textSlot 存在時作為 alt / fallback */
  text: string;
  translation?: string | null;
  showTranslation?: boolean;
  imageUrl?: string | null;
  showImage?: boolean;
  /** word variant：音標 */
  ipa?: string | null;
  /** word variant：詞性 */
  partOfSpeech?: string | null;
  /** 覆寫渲染的朗讀本體（Stage 4 傳入 WordWithScoreColor 染色版） */
  textSlot?: ReactNode;
  /** 卡片右上角分數徽章（Stage 4 傳入 ScoreBadge） */
  scoreBadge?: ReactNode;
  /** 評測時翻譯弱化變淡灰 */
  translationDimmed?: boolean;
  className?: string;
}

const TEXT_SIZE_CLASS: Record<CardVariant, { plain: string; withImage: string }> =
  {
    word: { plain: "recording-word", withImage: "recording-word-image" },
    sentence: { plain: "recording-sentence", withImage: "recording-sentence" },
    paragraph: {
      plain: "recording-paragraph",
      withImage: "recording-paragraph",
    },
  };

export const CardContent = ({
  variant,
  text,
  translation,
  showTranslation = true,
  imageUrl,
  showImage = true,
  ipa,
  partOfSpeech,
  textSlot,
  scoreBadge,
  translationDimmed = false,
  className,
}: CardContentProps) => {
  const [imageError, setImageError] = useState(false);

  // 換題時重置圖片錯誤狀態
  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  const hasImage = showImage && !!imageUrl && !imageError;
  const isWord = variant === "word";
  const textSizeClass = hasImage
    ? TEXT_SIZE_CLASS[variant].withImage
    : TEXT_SIZE_CLASS[variant].plain;

  return (
    <div
      data-testid="card-content"
      data-variant={variant}
      data-has-image={hasImage}
      className={cn(
        "relative mx-auto flex min-h-[360px] w-full max-w-[960px] rounded-[32px] bg-recording-card p-6 shadow-[0_8px_32px_rgba(0,0,0,0.08)] sm:min-h-[440px] sm:p-10",
        className,
      )}
    >
      {scoreBadge && (
        <div className="absolute -top-3 right-6 z-10">{scoreBadge}</div>
      )}

      <div
        className={cn(
          "flex w-full gap-6 sm:gap-10",
          hasImage
            ? "flex-col items-center sm:flex-row"
            : "flex-col items-center justify-center",
        )}
      >
        {hasImage && (
          <div className="mx-auto flex-shrink-0 sm:mx-0">
            <img
              data-testid="card-image"
              src={imageUrl ?? undefined}
              alt={text}
              onError={() => setImageError(true)}
              className="aspect-square w-full max-w-[280px] rounded-2xl object-cover object-top sm:w-[300px] sm:max-w-none"
            />
          </div>
        )}

        <div
          className={cn(
            "flex min-w-0 flex-col gap-3",
            hasImage
              ? "flex-1 items-start text-left"
              : "items-center text-center",
          )}
        >
          {isWord && ipa && (
            <span
              data-testid="card-ipa"
              className="text-lg text-recording-text-secondary sm:text-2xl"
            >
              {ipa}
            </span>
          )}

          <div
            className={cn(
              "font-bold text-recording-text-primary",
              textSizeClass,
            )}
          >
            {textSlot ?? text}
          </div>

          {isWord && partOfSpeech && (
            <span
              data-testid="card-pos"
              className="rounded-full bg-recording-accent-soft px-3.5 py-1.5 text-sm font-bold text-recording-accent-deep"
            >
              {partOfSpeech}
            </span>
          )}

          {showTranslation && translation && (
            <span
              data-testid="card-translation"
              data-dimmed={translationDimmed}
              className={cn(
                "font-medium",
                isWord ? "text-2xl sm:text-3xl" : "text-lg sm:text-2xl",
                translationDimmed
                  ? "text-recording-text-translation"
                  : "text-recording-text-secondary",
              )}
            >
              {translation}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CardContent;

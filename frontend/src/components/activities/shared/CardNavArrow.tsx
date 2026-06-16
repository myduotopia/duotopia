/**
 * CardNavArrow — 卡片左右兩側的上一題 / 下一題箭頭（#830）
 *
 * 樣式對齊一般單字卡 WordCard 內的 NavArrow（shared/WordCard.tsx），讓三個小考
 * Activity 的上下題切換改成跟一般單字卡一致的「左右兩側懸浮箭頭」。
 * 需放在 position: relative 的容器內。disabled 時灰階、不可點。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Props {
  direction: "prev" | "next";
  onClick: () => void;
  disabled?: boolean;
}

export default function CardNavArrow({ direction, onClick, disabled }: Props) {
  const { t } = useTranslation();
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={
        isPrev ? t("wordQuiz.prev") || "上一題" : t("wordQuiz.next") || "下一題"
      }
      className={cn(
        "absolute top-1/2 -translate-y-1/2 z-10",
        "flex items-center justify-center",
        "h-10 w-10 md:h-12 md:w-12",
        "transition-colors",
        isPrev ? "left-0" : "right-0",
        disabled
          ? "text-gray-200 cursor-not-allowed"
          : "text-gray-400 hover:text-gray-700",
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

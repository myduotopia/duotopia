/**
 * SpeakableWords — 一句英文拆成一個個可點的單字，點了只唸那個字（`utils/speakEnglish`）。
 *
 * 從例句朗讀（GroupedQuestionsTemplate 題目文字「點擊發音」）抽出來共用，情境對話 AI 建議
 * 說法也用這一份（#1158 E2）。樣式沿用原本的：滑過藍字＋底線；唸的時候該字維持藍字＋底線
 * （播放中標示，唸完、出錯、被下一個字打斷都會清掉）。
 *
 * - 以空白切字，畫面照原樣顯示（含標點）；唸的時候去掉字首字尾的標點（`wordToSpeak`），
 *   字中間的撇號保留（I'm、don't），大小寫不動。只有標點的片段（例如「—」）不能點。
 * - 每個字是 `<button>`（可用鍵盤），aria-label／title：「點擊發音: word」。
 * - 字與字之間放空白字元：一般文字流裡就是正常的字距；外層傳 flex 版面（例如
 *   `flex flex-wrap gap-1`）時空白字元不佔位，以 gap 為準。
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { speakEnglish } from "@/utils/speakEnglish";

/** 唸的時候用的字：去掉字首字尾的標點（字中間的撇號、連字號保留） */
export function wordToSpeak(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

interface Props {
  text: string;
  /** 外層 span 的 class（例如 flex 版面） */
  className?: string;
  /** 每個字的額外 class（例如 px-1） */
  wordClassName?: string;
}

export function SpeakableWords({ text, className, wordClassName }: Props) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState<number | null>(null);
  // 每次點擊換一個號碼：前一個字被打斷時的 onEnd 不會清掉新點的字
  const clickRef = useRef(0);
  useEffect(
    () => () => {
      clickRef.current += 1;
    },
    [],
  );

  const tokens = text.split(/\s+/).filter(Boolean);

  const speakWord = (index: number, word: string) => {
    clickRef.current += 1;
    const click = clickRef.current;
    setPlaying(index);
    speakEnglish(word, {
      onEnd: () => {
        if (clickRef.current === click) setPlaying(null);
      },
    });
  };

  return (
    <span className={className}>
      {tokens.map((token, i) => {
        const word = wordToSpeak(token);
        const sep = i > 0 ? " " : null;
        if (!word) {
          return (
            <Fragment key={i}>
              {sep}
              <span className={wordClassName}>{token}</span>
            </Fragment>
          );
        }
        const label = `${t("groupedQuestionsTemplate.labels.clickToPronounciate")}: ${word}`;
        const isPlaying = playing === i;
        return (
          <Fragment key={i}>
            {sep}
            <button
              type="button"
              className={cn(
                "cursor-pointer transition-colors hover:text-blue-600 hover:underline",
                isPlaying && "text-blue-600 underline",
                wordClassName,
              )}
              onClick={() => speakWord(i, word)}
              aria-label={label}
              title={label}
              data-playing={isPlaying ? "true" : undefined}
            >
              {token}
            </button>
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * ClozeBlankText — 克漏字句子的挑空渲染元件
 *
 * #867：把句子裡的底線挑空（連續的 `_`）換成圓角淡色方塊，取代生硬的底線
 * 字元，視覺更好看。方塊為「非互動」（無內容、無 caret），明確不是輸入框；
 * 實際作答仍在下方的 QuizAnswerInput。
 *
 * #880：一個底線串 = 一個方格，讓挖空格數等於答案的「單字數量」（不是字母數）。
 * 後端 `build_blank()` 對片語答案以空白分隔各字（如 "_ _ _ _"），每個底線各成
 * 一格，字間的空白落在文字段，自然形成字與字之間的間隔。
 *
 * 方格尺寸用 em，跟著外層 clamp 字級一起縮放。
 *
 * 用法：放在原本顯示 blanked_sentence 的 <p> 內，取代純文字 `{sentence}`。
 */
import React from "react";

interface Props {
  /** 含底線挑空的句子，例如 "I want to _ photos." */
  text: string;
}

export default function ClozeBlankText({ text }: Props) {
  if (!text) return null;

  // 以「連續底線」為分隔切開，每個底線串換成一個方格，其餘維持原文字
  const parts = text.split(/(_+)/);
  return (
    <>
      {parts.map((part, i) =>
        /^_+$/.test(part) ? (
          <span
            key={i}
            aria-hidden="true"
            data-testid="cloze-blank-slot"
            className="inline-block w-[3em] h-[1.4em] rounded-md bg-indigo-50 border border-indigo-200 mx-1 align-middle select-none"
          />
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

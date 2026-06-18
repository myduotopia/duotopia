/**
 * ClozeBlankText — 克漏字句子的挑空渲染元件
 *
 * #867：把句子裡的底線挑空（連續的 `_`，如 `_____`）換成圓角淡色方塊，
 * 取代生硬的底線字元，視覺更好看。方塊為「非互動」（無內容、無 caret），
 * 明確不是輸入框；實際作答仍在下方的 QuizAnswerInput。
 *
 * 用法：放在原本顯示 blanked_sentence 的 <p> 內，取代純文字 `{sentence}`。
 */
import React from "react";

interface Props {
  /** 含底線挑空的句子，例如 "I want to _____ photos." */
  text: string;
}

export default function ClozeBlankText({ text }: Props) {
  if (!text) return null;

  // 以「連續底線」為分隔切開，底線段換成方塊，其餘維持原文字
  const parts = text.split(/(_+)/);
  return (
    <>
      {parts.map((part, i) =>
        /^_+$/.test(part) ? (
          <span
            key={i}
            aria-hidden="true"
            className="inline-block rounded-md bg-indigo-50 border border-indigo-200 px-[3.125rem] py-0.5 mx-1 align-middle select-none"
          >
            {" "}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

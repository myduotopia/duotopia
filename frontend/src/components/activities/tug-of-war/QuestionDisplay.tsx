/**
 * QuestionDisplay - 題目顯示區（issue #920 起改為純顯示，每隊一份）
 *
 * 顯示在各隊選項上方。依題型顯示圖片 / 英文 / 翻譯 / 克漏字例句。
 * 音檔已上提由場景中央懸掛看板統一播放（見 useQuestionAudio），此元件不再處理音檔。
 */

import type { Question } from "./types";

interface QuestionDisplayProps {
  question: Question;
  /** false 時（該題已被作答）顯示正解。 */
  showPrompt: boolean;
  /** 克漏字：是否顯示例句翻譯。 */
  showSentenceTranslation?: boolean;
}

export function QuestionDisplay({
  question,
  showPrompt,
  showSentenceTranslation = false,
}: QuestionDisplayProps) {
  // Answered — reveal the correct answer
  if (!showPrompt) {
    return (
      <div className="flex h-full items-center justify-center px-2 text-center">
        <span className="handwrite-font text-3xl font-bold text-green-600 md:text-4xl">
          {question.correctAnswer}
        </span>
      </div>
    );
  }

  if (question.hasImage) {
    const imageUrl = question.vocabItem.image_url;
    return (
      <div className="flex h-full items-center justify-center overflow-hidden p-1">
        {imageUrl ? (
          // 無框；等比縮放、寬高雙向受限 → 不過大、寬度自動配合高度
          <img
            src={imageUrl}
            alt=""
            className="h-auto w-auto max-h-[92%] max-w-full object-contain"
          />
        ) : (
          <span className="handwrite-font text-3xl font-bold md:text-4xl">
            {question.vocabItem.text}
          </span>
        )}
      </div>
    );
  }

  if (question.hasCloze) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
        <span className="text-xl font-semibold leading-snug text-gray-800 md:text-2xl lg:text-3xl">
          {question.clozeSentence}
        </span>
        {showSentenceTranslation && question.clozeTranslation && (
          <span className="text-sm text-gray-600 md:text-base">
            {question.clozeTranslation}
          </span>
        )}
      </div>
    );
  }

  // Text prompt (english_to_chinese / chinese_to_english)
  return (
    <div className="flex h-full items-center justify-center px-2 text-center">
      <span className="handwrite-font text-3xl font-bold md:text-4xl lg:text-5xl">
        {question.prompt}
      </span>
    </div>
  );
}

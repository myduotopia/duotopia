/**
 * WordCardSample - 單字卡 Sample 頁面（純前端設計稿）
 *
 * 用途：展示 WordCard 元件在各種狀態下的呈現，供工程師對照實作。
 *
 * === 卡片模型 ===
 * - 背面（back）= 答題 UI（學生作答畫面）
 * - 正面（front）= 完整單字資訊（單字 + 詞性 + 中譯 + 例句 + 例句翻譯 + 兩個音檔播放鈕）
 *
 * === 互動流程 ===
 * 1. 預設 face="back"，學生在背面作答
 * 2. 答對 → 父層改 face="front" → 自動翻面（600ms）
 * 3. onFlipped 觸發 → 顯示 ScoreOverlay 答對動畫
 * 4. 動畫結束 → 顯示完整單字卡正面，學生用左右箭頭切換上一張/下一張
 *
 * === 參考 Issue ===
 * #715 - 單字拼寫 / 克漏字拼寫 新增單字卡元件（翻卡形式）
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { WordCard } from "@/components/activities/shared/WordCard";
import ScoreOverlay from "@/components/activities/shared/ScoreOverlay";

const SAMPLE_WORD = {
  word: "apple",
  partOfSpeech: "n.",
  translation: "蘋果",
  audioUrl: undefined as string | undefined,
  exampleSentence: "I eat an apple every morning for breakfast.",
  exampleSentenceTranslation: "我每天早上吃一顆蘋果當早餐。",
  exampleSentenceAudioUrl: undefined as string | undefined,
};

const DECK = [
  SAMPLE_WORD,
  {
    word: "banana",
    partOfSpeech: "n.",
    translation: "香蕉",
    audioUrl: undefined,
    exampleSentence: "The monkey loves to eat banana.",
    exampleSentenceTranslation: "猴子喜歡吃香蕉。",
    exampleSentenceAudioUrl: undefined,
  },
  {
    word: "celebrate",
    partOfSpeech: "v.",
    translation: "慶祝",
    audioUrl: undefined,
    exampleSentence: "We celebrate the new year with fireworks.",
    exampleSentenceTranslation: "我們用煙火慶祝新年。",
    exampleSentenceAudioUrl: undefined,
  },
];

const NO_POS_WORD = {
  ...SAMPLE_WORD,
  word: "running",
  partOfSpeech: undefined as string | undefined,
  translation: "跑步",
  exampleSentence: "She is running to catch the bus.",
  exampleSentenceTranslation: "她正在跑去趕公車。",
};

const NO_EXAMPLE_WORD = {
  ...SAMPLE_WORD,
  word: "ephemeral",
  partOfSpeech: "adj.",
  translation: "短暫的",
  exampleSentence: undefined as string | undefined,
  exampleSentenceTranslation: undefined as string | undefined,
};

export default function WordCardSample() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-12">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            單字卡（WordCard）Sample
          </h1>
          <p className="text-sm text-gray-600">
            背面 = 答題 UI；正面 = 完整單字資訊。點「模擬答對」觀察翻面流程。
          </p>
        </header>

        <Section title="互動範例：背面答題 → 答對自動翻面 → 動畫 → 左右切換上/下一張">
          <FlipFlowDemo />
        </Section>

        <Section title="Desktop 正面（完整單字資訊一張）">
          <div className="max-w-2xl">
            <WordCard viewMode="desktop" face="front" {...SAMPLE_WORD} />
          </div>
        </Section>

        <Section title="Mobile 正面">
          <div className="max-w-sm">
            <WordCard viewMode="mobile" face="front" {...SAMPLE_WORD} />
          </div>
        </Section>

        <Section title="邊界：無詞性">
          <div className="max-w-2xl">
            <WordCard viewMode="desktop" face="front" {...NO_POS_WORD} />
          </div>
        </Section>

        <Section title="邊界：無例句（只顯示單字 + 詞性 + 翻譯）">
          <div className="max-w-2xl">
            <WordCard viewMode="desktop" face="front" {...NO_EXAMPLE_WORD} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </section>
  );
}

/**
 * 模擬 Mock 答題 UI（背面）— 真正整合時會替換成 WordActivityCard
 */
function MockAnswerUI({
  word,
  onCorrect,
}: {
  word: string;
  onCorrect: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-8 text-center">
        <p className="text-sm text-gray-500 mb-4">（這裡是答題 UI 的位置）</p>
        <p className="text-base text-gray-700 mb-6">
          請拼出 <span className="font-semibold">{word}</span>
        </p>
        <Button onClick={onCorrect} className="bg-green-500 hover:bg-green-600">
          <CheckCircle className="h-4 w-4 mr-2" />
          模擬答對
        </Button>
      </CardContent>
    </Card>
  );
}

function FlipFlowDemo() {
  const [index, setIndex] = useState(0);
  const [face, setFace] = useState<"front" | "back">("back");
  const [showScore, setShowScore] = useState(false);

  const current = DECK[index];

  const handleCorrect = () => {
    setFace("front");
  };

  const handleFlipped = () => {
    if (face !== "front") return;
    setShowScore(true);
  };

  const handleScoreEnd = () => {
    setShowScore(false);
  };

  const goPrev = () => {
    if (index === 0) return;
    setShowScore(false);
    setFace("back");
    setIndex((i) => i - 1);
  };

  const goNext = () => {
    if (index === DECK.length - 1) return;
    setShowScore(false);
    setFace("back");
    setIndex((i) => i + 1);
  };

  return (
    <div className="max-w-2xl">
      <WordCard
        viewMode="desktop"
        face={face}
        onFlipped={handleFlipped}
        {...current}
        back={<MockAnswerUI word={current.word} onCorrect={handleCorrect} />}
        hasPrev={face === "front" && index > 0}
        hasNext={face === "front" && index < DECK.length - 1}
        onPrev={goPrev}
        onNext={goNext}
        footer={
          face === "front" ? (
            <div className="text-center text-sm text-gray-500">
              第 {index + 1} / {DECK.length} 張 — 用左右箭頭切換
            </div>
          ) : null
        }
      />

      <ScoreOverlay
        open={showScore}
        score={100}
        isError={false}
        onComplete={handleScoreEnd}
      />
    </div>
  );
}

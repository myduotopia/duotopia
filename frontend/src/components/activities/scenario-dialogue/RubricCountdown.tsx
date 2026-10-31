/**
 * 作答要求倒數（#1158 E-3）：按「開始對話」後先讓學生看作答要求，倒數完才唸第 1 題。
 *
 * - `rubricCountdownSeconds(rubric)`：基本 5 秒；字多時依字數拉長（約每 8 個字 1 秒），最多 12 秒。
 * - `RubricIntro`：對話最上方熊熊說「先看一下作答要求 👇」（AI 氣泡，與 ChatTranscript 共用
 *   aiBubbleClass）＋作答要求卡（RubricCard，沿用開始前那張）。
 *   `counting` 為真時卡片底部有進度條與「N 秒後開始」，不能跳過；`paused`（手機橫放）時暫停，
 *   轉回直立接著倒數；倒數到 0 呼叫 onDone 一次。倒數完留在對話裡當紀錄（不再有進度條）。
 *   倒數的每 100ms 進度只存在這個元件裡（修正 E3），外層只知道「倒數中／倒數完」，
 *   不會整個作答畫面跟著每 100ms 重繪。之後點上方「作答要求」膠囊也能再看。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { RubricCard } from "./ScenarioContextCard";
import { AiRow, aiBubbleClass } from "./TypingIndicator";

export const RUBRIC_MIN_SECONDS = 5;
export const RUBRIC_MAX_SECONDS = 12;
/** 大約每幾個字多 1 秒（小學生閱讀速度抓寬一點） */
const CHARS_PER_SECOND = 8;
const TICK_MS = 100;

/** 依作答要求字數算倒數秒數（5～12 秒） */
export function rubricCountdownSeconds(rubric: string): number {
  const chars = rubric.replace(/\s+/g, "").length;
  const sec = Math.ceil(chars / CHARS_PER_SECOND);
  return Math.min(RUBRIC_MAX_SECONDS, Math.max(RUBRIC_MIN_SECONDS, sec));
}

interface IntroProps {
  rubric: string;
  /** 倒數中；false＝倒數完，只留卡片 */
  counting: boolean;
  /** 暫停倒數（手機橫放） */
  paused: boolean;
  /** 倒數到 0 時呼叫一次 */
  onDone: () => void;
}

export function RubricIntro({ rubric, counting, paused, onDone }: IntroProps) {
  const { t } = useTranslation();
  const totalMs = rubricCountdownSeconds(rubric) * 1000;
  const [leftMs, setLeftMs] = useState(totalMs);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(false);

  useEffect(() => {
    if (!counting || paused) return;
    const id = setInterval(() => {
      setLeftMs((ms) => ms - TICK_MS);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [counting, paused]);

  useEffect(() => {
    if (!counting || leftMs > 0 || doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, [counting, leftMs]);

  const showTimer = counting && leftMs > 0;
  const seconds = Math.max(1, Math.ceil(leftMs / 1000));
  return (
    <div className="space-y-2" data-testid="scenario-rubric-intro">
      <AiRow>
        <div className={`${aiBubbleClass} text-sm text-gray-700`}>
          {t("scenarioDialogue.chat.rubricIntro")}
        </div>
      </AiRow>
      <div className="pl-12">
        <RubricCard rubric={rubric}>
          {showTimer && (
            <div className="mt-3 flex items-center gap-3" role="timer">
              <Progress
                value={(leftMs / totalMs) * 100}
                className="h-1.5 flex-1"
                aria-hidden
              />
              <span className="whitespace-nowrap text-sm font-bold text-blue-700">
                {t("scenarioDialogue.chat.rubricCountdown", { count: seconds })}
              </span>
            </div>
          )}
        </RubricCard>
      </div>
    </div>
  );
}

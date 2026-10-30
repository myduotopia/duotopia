/**
 * 作答要求倒數（#1158 E-3）：按「開始對話」後先讓學生看作答要求，倒數完才唸第 1 題。
 *
 * - `rubricCountdownSeconds(rubric)`：基本 5 秒；字多時依字數拉長（約每 8 個字 1 秒），最多 12 秒。
 * - `useRubricCountdown({ paused, onDone })`：`begin(rubric)` 開始倒數；不能跳過；`paused`（手機橫放）
 *   時暫停，轉回直立接著倒數；倒數到 0 呼叫 onDone 一次。卸載時停止。
 * - `RubricIntro`：對話最上方熊熊說「先看一下作答要求 👇」＋作答要求卡（RubricCard，沿用開始前那張）；
 *   倒數中卡片底部有進度條與「N 秒後開始」，倒數完留在對話裡當紀錄（不再有進度條）。
 *   之後點上方「作答要求」膠囊也能再看。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { RubricCard } from "./ScenarioContextCard";
import { AiRow } from "./TypingIndicator";

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

export interface RubricCountdownState {
  totalMs: number;
  leftMs: number;
}

export function useRubricCountdown({
  paused,
  onDone,
}: {
  paused: boolean;
  onDone: () => void;
}) {
  const [state, setState] = useState<RubricCountdownState | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const running = state !== null;

  useEffect(() => {
    if (!running || paused) return;
    const id = setInterval(() => {
      setState((s) => (s ? { ...s, leftMs: s.leftMs - TICK_MS } : s));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, paused]);

  useEffect(() => {
    if (state && state.leftMs <= 0) {
      setState(null);
      onDoneRef.current();
    }
  }, [state]);

  const begin = useCallback((rubric: string) => {
    const ms = rubricCountdownSeconds(rubric) * 1000;
    setState({ totalMs: ms, leftMs: ms });
  }, []);

  return { countdown: state, begin };
}

interface IntroProps {
  rubric: string;
  /** 倒數中才傳；null＝倒數完，只留卡片 */
  countdown: RubricCountdownState | null;
}

export function RubricIntro({ rubric, countdown }: IntroProps) {
  const { t } = useTranslation();
  const seconds = countdown
    ? Math.max(1, Math.ceil(countdown.leftMs / 1000))
    : 0;
  return (
    <div className="space-y-2" data-testid="scenario-rubric-intro">
      <AiRow>
        <div className="inline-block rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          {t("scenarioDialogue.chat.rubricIntro")}
        </div>
      </AiRow>
      <div className="pl-12">
        <RubricCard rubric={rubric}>
          {countdown && (
            <div className="mt-3 flex items-center gap-3" role="timer">
              <Progress
                value={(countdown.leftMs / countdown.totalMs) * 100}
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

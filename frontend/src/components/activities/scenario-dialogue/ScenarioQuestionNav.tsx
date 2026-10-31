/**
 * ScenarioQuestionNav — 情境對話的題號方格（#1158 E 段）。
 *
 * 對話內的小圓點（QuestionDots）拿掉後，切題改由題號方格負責。這支是方格的**唯一一份**
 * 規則與外觀，三個地方共用，不各寫一份：
 * - 學生作答頁／老師預覽真實作業（StudentActivityPageContent）：方格在頁面外框的題號列，
 *   逐格用 `ScenarioNavButton`，提示用 `useScenarioNavHint`＋`ScenarioNavHintText`。
 * - 派發預覽欄（ScenarioDialoguePreview，compact）與 sample 頁：整列用 `ScenarioQuestionNav`，
 *   搭配 `useScenarioNavBridge` 接到 ScenarioChatActivity 的 onNavChange／onProgressChange／navigateRef。
 *
 * 規則（`scenarioNavCell`）：
 * - 已出現在對話裡的題目：可點，學生捲到那一題；老師預覽開始對話後（canJump）任一題都能點、跳題。
 * - 還沒到的題目：看得到但不能點（aria-disabled），點了提示「還沒到這題」。
 * - 答過（綠）但對話還沒走到（重新進入有部分答案的作業時）：一樣不能點，提示改成
 *   「已作答，對話到這題後可查看」，aria-label／title 同義（#1158 E-1 Review 低 2）。
 * - 目前這題：藍色粗框＋aria-current="step"，跟著對話進度更新。
 * - 顏色沿用學生頁方格的既有規則：答過＝綠，其餘白底灰框（標準色系 green／gray／blue）。
 *
 * 提示顯示 2 秒；連點時計時器重算（用遞增的 tick 當 effect 依賴，#1158 E-1 Review 低 3）。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ScenarioChatNav } from "./ScenarioChatActivity";

export type ScenarioNavLockReason = "notYet" | "answeredLater";

export interface ScenarioNavCellState {
  locked: boolean;
  lockReason: ScenarioNavLockReason | null;
  isCurrent: boolean;
}

/** 一格的狀態（純函式，方便測試） */
export function scenarioNavCell(
  nav: ScenarioChatNav | null,
  index: number,
  done: boolean,
): ScenarioNavCellState {
  const reached = !!nav && nav.started && index < nav.revealedCount;
  const locked = !reached && !nav?.canJump;
  return {
    locked,
    lockReason: locked ? (done ? "answeredLater" : "notYet") : null,
    isCurrent: nav?.current === index,
  };
}

/** 提示「還沒到這題」等文字：顯示 2 秒，連點時重新計時 */
export function useScenarioNavHint(durationMs = 2000) {
  const [hint, setHint] = useState<{
    reason: ScenarioNavLockReason;
    tick: number;
  } | null>(null);
  const tickRef = useRef(0);
  const show = useCallback((reason: ScenarioNavLockReason) => {
    tickRef.current += 1;
    setHint({ reason, tick: tickRef.current });
  }, []);
  const tick = hint?.tick;
  useEffect(() => {
    if (tick === undefined) return;
    const id = setTimeout(() => setHint(null), durationMs);
    return () => clearTimeout(id);
  }, [tick, durationMs]);
  return { hint: hint?.reason ?? null, show };
}

const HINT_KEY: Record<ScenarioNavLockReason, string> = {
  notYet: "scenarioDialogue.chat.notYet",
  answeredLater: "scenarioDialogue.chat.answeredNotReached",
};

export function ScenarioNavHintText({
  reason,
}: {
  reason: ScenarioNavLockReason | null;
}) {
  const { t } = useTranslation();
  if (!reason) return null;
  return (
    <p className="text-xs text-gray-500 whitespace-nowrap" role="status">
      {t(HINT_KEY[reason])}
    </p>
  );
}

interface NavButtonProps {
  /** 0 起算 */
  index: number;
  nav: ScenarioChatNav | null;
  /** 答過（綠） */
  done: boolean;
  onNavigate: (index: number) => void;
  onLocked: (reason: ScenarioNavLockReason) => void;
}

export function ScenarioNavButton({
  index,
  nav,
  done,
  onNavigate,
  onLocked,
}: NavButtonProps) {
  const { t } = useTranslation();
  const { locked, lockReason, isCurrent } = scenarioNavCell(nav, index, done);
  const no = index + 1;
  const label =
    lockReason === "answeredLater"
      ? t("scenarioDialogue.chat.dotAnsweredLocked", { no })
      : lockReason === "notYet"
        ? t("scenarioDialogue.chat.dotLocked", { no })
        : isCurrent
          ? t("scenarioDialogue.chat.currentQuestion", { no })
          : nav?.canJump
            ? t("scenarioDialogue.chat.jumpToNo", { no })
            : t("scenarioDialogue.chat.goToNo", { no });
  return (
    <button
      type="button"
      data-testid={`scenario-nav-${no}`}
      onClick={() => {
        if (lockReason) {
          onLocked(lockReason);
          return;
        }
        onNavigate(index);
      }}
      aria-disabled={locked || undefined}
      aria-current={isCurrent ? "step" : undefined}
      className={cn(
        "relative w-8 h-8 sm:w-8 sm:h-8 rounded border transition-all",
        "flex items-center justify-center text-sm sm:text-xs font-medium",
        "min-w-[32px]",
        done
          ? "bg-green-100 text-green-800 border-green-400"
          : "bg-white text-gray-600 border-gray-300",
        locked ? "cursor-not-allowed" : !done && "hover:border-blue-400",
        isCurrent && "border-2 border-blue-600",
      )}
      title={label}
      aria-label={label}
    >
      {no}
    </button>
  );
}

/**
 * 接 ScenarioChatActivity 的三個回報口：對話進度（onNavChange）、每題答過沒
 * （onProgressChange）、外層點方格時叫對話捲動／跳題（navigateRef）。
 */
export function useScenarioNavBridge() {
  const [nav, setNav] = useState<ScenarioChatNav | null>(null);
  const [answered, setAnswered] = useState<boolean[]>([]);
  const navigateRef = useRef<((index: number) => void) | null>(null);
  return { nav, setNav, answered, setAnswered, navigateRef };
}

interface NavRowProps {
  count: number;
  nav: ScenarioChatNav | null;
  answered: boolean[];
  navigateRef: MutableRefObject<((index: number) => void) | null>;
  className?: string;
}

/** 整列方格＋提示（派發預覽欄、sample 頁用；學生頁方格嵌在既有題號列，逐格用 ScenarioNavButton） */
export function ScenarioQuestionNav({
  count,
  nav,
  answered,
  navigateRef,
  className,
}: NavRowProps) {
  const { t } = useTranslation();
  const { hint, show } = useScenarioNavHint();
  return (
    <nav
      aria-label={t("scenarioDialogue.chat.questionNav")}
      className={cn("flex flex-wrap items-center gap-1", className)}
      data-testid="scenario-question-nav"
    >
      {Array.from({ length: count }, (_, i) => (
        <ScenarioNavButton
          key={i}
          index={i}
          nav={nav}
          done={Boolean(answered[i])}
          onNavigate={(idx) => navigateRef.current?.(idx)}
          onLocked={show}
        />
      ))}
      <ScenarioNavHintText reason={hint} />
    </nav>
  );
}
